import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FormaPagamento,
  OrigemAtendimento,
  Papel,
  StatusAtendimento,
  StatusPagamento,
} from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import {
  INTENCAO_DE_PAGAMENTO_REPOSITORY,
  IntencaoDePagamentoRepository,
} from '../../payments/domain/intencao-de-pagamento.repository';
import { Atendimento } from '../domain/atendimento.aggregate';
import { RepositoriosTransacionais } from '../../../shared/application/unit-of-work';

/**
 * Código de erro que o front usa pra abrir o modal de justificativa. Vai no
 * corpo do 409 porque a mensagem é texto pra humano, não contrato.
 */
export const CONCLUSAO_ANTECIPADA_EXIGE_MOTIVO = 'CONCLUSAO_ANTECIPADA_EXIGE_MOTIVO';

export interface ConcluirAtendimentoInput {
  atendimentoId: string;
  formaPagamento?: FormaPagamento;
  usuario: UsuarioAutenticado;
  /**
   * Justificativa para concluir ANTES do horário marcado (2026-08-20). Só é
   * lida nesse caso; num atendimento cujo horário já passou, é ignorada.
   */
  motivoConclusaoAntecipada?: string;
  /** Injetável para teste; em produção é sempre o relógio do processo. */
  agora?: Date;
}

export interface ConcluirAtendimentoResultado {
  /**
   * `false` quando a conclusão foi antecipada e ficou pendente de aprovação —
   * nada de dinheiro aconteceu ainda.
   */
  concluido: boolean;
}

@Injectable()
export class ConcluirAtendimentoUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(INTENCAO_DE_PAGAMENTO_REPOSITORY) private readonly intencoes: IntencaoDePagamentoRepository,
  ) {}

  async executar(input: ConcluirAtendimentoInput): Promise<ConcluirAtendimentoResultado> {
    const eventos: DomainEvent[] = [];
    const agora = input.agora ?? new Date();

    const concluido = await this.uow.transacao(async (repos) => {
      const atendimento = await repos.atendimentos.porId(input.atendimentoId);
      if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
        throw new NotFoundException('Atendimento não encontrado');
      }
      autorizarDonoOuAdmin(atendimento.barbeiroId, input.usuario);

      // Já pedido e esperando decisão: a mensagem certa é essa, não "informe o
      // motivo" (ele já informou) nem um erro de transição de estado cru.
      if (atendimento.status === StatusAtendimento.CONCLUSAO_PENDENTE) {
        throw new ConflictException(
          'Este atendimento já está aguardando aprovação do administrador para ser concluído',
        );
      }

      // Item 2 da sessão 2026-07-16: se há IntencaoDePagamento PAGA vinculada,
      // a parte já paga não exige forma de pagamento — a aplicação (não o
      // domínio, §2.2) sabe disso porque consulta o outro agregado aqui.
      // Se sobrou valor além do que foi pago online (itens/produtos
      // adicionados na conclusão, item 3/4a), a conclusão AINDA exige a forma
      // de pagamento — mas só para cobrir esse adicional.
      //
      // FASE 4a (sessão-E, §8.7): mesmo raciocínio pro abatimento de saldo
      // residual — `valorAbatidoSaldo` (snapshot no agendamento) também
      // cobre parte (ou tudo) do total, exatamente como o pago online.
      const intencaoPaga = await this.intencaoPagaDoAtendimento(atendimento.id);
      const valorTotal = atendimento.valorTotal().centavos;
      const valorPagoOnline = intencaoPaga?.valor.centavos ?? 0;
      const valorAbatido = atendimento.valorAbatidoSaldo.centavos;
      const valorCoberto = valorPagoOnline + valorAbatido;
      const semAdicional = valorCoberto > 0 && valorTotal <= valorCoberto;
      const formaPagamentoCoberta = valorPagoOnline > 0 ? FormaPagamento.PIX_ONLINE : FormaPagamento.SALDO_RESIDUAL;

      const forma = semAdicional ? formaPagamentoCoberta : input.formaPagamento;

      // TRAVA DE CONCLUSÃO ANTECIPADA (2026-08-20): o barbeiro não conclui
      // sozinho um atendimento cujo horário ainda não chegou. Precisa
      // justificar, e o admin aprova. Sem isso, bastava concluir a agenda da
      // semana inteira pra inflar a comissão.
      //
      // Admin conclui direto: é ele quem aprovaria, e pedir que ele
      // justifique pra si mesmo não protege ninguém. Política de aplicação
      // (quem pode), não invariante de domínio (o que é válido).
      if (this.exigeAprovacao(atendimento, input.usuario, agora)) {
        if (!input.motivoConclusaoAntecipada?.trim()) {
          throw new ConflictException({
            codigo: CONCLUSAO_ANTECIPADA_EXIGE_MOTIVO,
            message:
              'Este atendimento ainda não começou. Informe o motivo para concluir antes do horário.',
            inicio: atendimento.intervalo.inicio.toISOString(),
          });
        }
        atendimento.solicitarConclusaoAntecipada({
          motivo: input.motivoConclusaoAntecipada,
          solicitadaPorId: input.usuario.barbeiroId ?? atendimento.barbeiroId,
          agora,
          formaPagamento: forma,
        });
        await repos.atendimentos.salvar(atendimento);
        // Nenhum evento, nenhum crédito consumido: a conclusão não aconteceu.
        return false;
      }

      atendimento.concluir(forma);
      await repos.atendimentos.salvar(atendimento);
      eventos.push(...atendimento.puxarEventos());
      eventos.push(...(await consumirCreditosDePacote(atendimento, repos, agora)));
      return true;
    });

    // Comissão reage ao evento (§2.3) — handler do Payroll
    await this.publisher.publicar(eventos);
    return { concluido };
  }

  private exigeAprovacao(atendimento: Atendimento, usuario: UsuarioAutenticado, agora: Date): boolean {
    if (usuario.papeis.includes(Papel.ADMIN)) return false;
    // DECISAO_PENDENTE: tolerância para concluir minutos antes do horário
    // (cliente que chegou adiantado). Hoje a comparação é estrita.
    return agora.getTime() < atendimento.intervalo.inicio.getTime();
  }

  private async intencaoPagaDoAtendimento(atendimentoId: string) {
    const intencao = await this.intencoes.porReferenciaAtendimento(atendimentoId);
    return intencao && intencao.status === StatusPagamento.PAGO ? intencao : null;
  }
}

export function autorizarDonoOuAdmin(barbeiroId: string, usuario: UsuarioAutenticado): void {
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  if (!ehAdmin && usuario.barbeiroId !== barbeiroId) {
    throw new ForbiddenException('Apenas o barbeiro dono do atendimento ou um admin');
  }
}

/**
 * §8.3 passo 5: crédito de pacote vira CONSUMIDO na mesma transação da
 * conclusão. Compartilhado com a aprovação de conclusão antecipada — é o mesmo
 * fato ("este atendimento concluiu"), e duas cópias divergiriam.
 */
export async function consumirCreditosDePacote(
  atendimento: Atendimento,
  repos: RepositoriosTransacionais,
  /**
   * Instante REAL do consumo — não o `fim` do atendimento. Concluir antes do
   * horário marcado é rotina, e o status do Bigod's Club (§4.5) depende de saber
   * quando o crédito deixou de existir de fato.
   */
  agora: Date = new Date(),
): Promise<DomainEvent[]> {
  if (atendimento.origem !== OrigemAtendimento.CREDITO_PACOTE) return [];
  const eventos: DomainEvent[] = [];
  for (const item of atendimento.itens) {
    if (!item.itemDoPacoteId) continue;
    const venda = await repos.vendasDePacote.porItemId(item.itemDoPacoteId);
    if (!venda) {
      throw new NotFoundException(`Pacote do item ${item.itemDoPacoteId} não encontrado`);
    }
    venda.consumirItem(item.itemDoPacoteId, agora);
    await repos.vendasDePacote.salvar(venda);
    eventos.push(...venda.puxarEventos());
  }
  return eventos;
}

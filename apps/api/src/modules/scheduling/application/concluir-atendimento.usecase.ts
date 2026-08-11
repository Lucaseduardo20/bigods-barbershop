import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { FormaPagamento, OrigemAtendimento, Papel, StatusPagamento } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import {
  INTENCAO_DE_PAGAMENTO_REPOSITORY,
  IntencaoDePagamentoRepository,
} from '../../payments/domain/intencao-de-pagamento.repository';

export interface ConcluirAtendimentoInput {
  atendimentoId: string;
  formaPagamento?: FormaPagamento;
  usuario: UsuarioAutenticado;
}

@Injectable()
export class ConcluirAtendimentoUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(INTENCAO_DE_PAGAMENTO_REPOSITORY) private readonly intencoes: IntencaoDePagamentoRepository,
  ) {}

  async executar(input: ConcluirAtendimentoInput): Promise<void> {
    const eventos: DomainEvent[] = [];

    await this.uow.transacao(async (repos) => {
      const atendimento = await repos.atendimentos.porId(input.atendimentoId);
      if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
        throw new NotFoundException('Atendimento não encontrado');
      }
      autorizarDonoOuAdmin(atendimento.barbeiroId, input.usuario);

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

      atendimento.concluir(semAdicional ? formaPagamentoCoberta : input.formaPagamento);
      await repos.atendimentos.salvar(atendimento);
      eventos.push(...atendimento.puxarEventos());

      // §8.3 passo 5: crédito de pacote vira CONSUMIDO na mesma transação
      if (atendimento.origem === OrigemAtendimento.CREDITO_PACOTE) {
        for (const item of atendimento.itens) {
          if (!item.itemDoPacoteId) continue;
          const venda = await repos.vendasDePacote.porItemId(item.itemDoPacoteId);
          if (!venda) {
            throw new NotFoundException(`Pacote do item ${item.itemDoPacoteId} não encontrado`);
          }
          venda.consumirItem(item.itemDoPacoteId);
          await repos.vendasDePacote.salvar(venda);
          eventos.push(...venda.puxarEventos());
        }
      }
    });

    // Comissão reage ao evento (§2.3) — handler do Payroll
    await this.publisher.publicar(eventos);
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

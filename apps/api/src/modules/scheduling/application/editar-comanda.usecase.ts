import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { StatusPagamento } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork, RepositoriosTransacionais } from '../../../shared/application/unit-of-work';
import { EVENT_PUBLISHER, EventPublisher } from '../../../shared/events/event-publisher';
import { DomainEvent } from '../../../shared/events/domain-event';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { Atendimento } from '../domain/atendimento.aggregate';
import { autorizarDonoOuAdmin } from './concluir-atendimento.usecase';

export interface RemoverItemDaComandaInput {
  atendimentoId: string;
  /** Posição na lista de itens, como o painel a exibe. */
  indice: number;
  /** Qual serviço o painel ACHA que está nessa posição — ver `Atendimento.removerItem`. */
  servicoId: string;
  usuario: UsuarioAutenticado;
}

export interface RemoverProdutoDaComandaInput {
  atendimentoId: string;
  indice: number;
  produtoId: string;
  usuario: UsuarioAutenticado;
}

/**
 * COMANDA EDITÁVEL (2026-08-25, FASE 1) — remover serviço/produto antes de
 * concluir, com o total recalculado sobre a composição final.
 *
 * ## Por que remoção é um caso de uso próprio, e adicionar não era
 *
 * Adicionar mexe num agregado só. Remover pode mexer em DOIS: se o serviço veio
 * de um crédito de pacote, o crédito tem que voltar para o cliente — e ele vive
 * em `VendaDePacote`. Um agregado não chama o outro (§2.2), então quem
 * orquestra é aqui, numa transação só: ou a comanda encolhe E o crédito volta,
 * ou nada acontece. Um crédito que some porque a segunda escrita falhou é um
 * pacote pago que o cliente não pode usar.
 *
 * ## Só presencial
 *
 * Remover item de comanda com dinheiro já recebido é estorno, e estorno não
 * existe neste sistema. Duas situações caem nisso e são RECUSADAS com mensagem
 * explícita, em vez de gerarem um crédito fantasma:
 *
 *  - **pago online** (`IntencaoDePagamento` PAGA): o cliente já transferiu;
 *  - **saldo residual abatido**: parte do valor já foi consumida de um saldo que
 *    veio de outro pacote, e desfazer isso é mexer naquela outra venda.
 *
 * Ver DECISOES_PENDENTES #55.
 */
@Injectable()
export class EditarComandaUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  async removerItem(input: RemoverItemDaComandaInput): Promise<void> {
    const tabela = await this.parametros.tabelaDeDesconto(input.usuario.companyId);
    const eventos: DomainEvent[] = [];

    await this.uow.transacao(async (repos) => {
      const atendimento = await this.carregar(repos, input.atendimentoId, input.usuario);
      await this.exigirComandaSemDinheiroRecebido(repos, atendimento);

      const removido = atendimento.removerItem(input.indice, input.servicoId);

      if (removido.itemDoPacoteId) {
        // O crédito volta pro cliente. `liberarItem` é a MESMA transição que o
        // cancelamento antecipado usa (§4.2): AGENDADO → DISPONIVEL, ou
        // SEGUNDA_CHANCE quando o item já tinha uma falta — voltar a DISPONIVEL
        // apagaria o prazo e viraria uma forma de escapar da expiração.
        const venda = await repos.vendasDePacote.porItemId(removido.itemDoPacoteId);
        if (!venda) {
          throw new NotFoundException(`Pacote do item ${removido.itemDoPacoteId} não encontrado`);
        }
        venda.liberarItem(removido.itemDoPacoteId);
        await repos.vendasDePacote.salvar(venda);
        eventos.push(...venda.puxarEventos());
      }

      atendimento.reprecificarAvulsos(tabela);
      await repos.atendimentos.salvar(atendimento);
    });

    await this.publisher.publicar(eventos);
  }

  async removerProduto(input: RemoverProdutoDaComandaInput): Promise<void> {
    const tabela = await this.parametros.tabelaDeDesconto(input.usuario.companyId);

    await this.uow.transacao(async (repos) => {
      const atendimento = await this.carregar(repos, input.atendimentoId, input.usuario);
      await this.exigirComandaSemDinheiroRecebido(repos, atendimento);

      atendimento.removerProduto(input.indice, input.produtoId);
      // Produto não entra na escada, mas a comanda é reprecificada mesmo assim:
      // é o mesmo caminho para toda edição, e um caminho só não diverge.
      atendimento.reprecificarAvulsos(tabela);
      await repos.atendimentos.salvar(atendimento);
    });
  }

  private async carregar(
    repos: RepositoriosTransacionais,
    atendimentoId: string,
    usuario: UsuarioAutenticado,
  ): Promise<Atendimento> {
    const atendimento = await repos.atendimentos.porId(atendimentoId);
    if (!atendimento || atendimento.companyId !== usuario.companyId) {
      throw new NotFoundException('Atendimento não encontrado');
    }
    autorizarDonoOuAdmin(atendimento.barbeiroId, usuario);
    return atendimento;
  }

  private async exigirComandaSemDinheiroRecebido(
    repos: RepositoriosTransacionais,
    atendimento: Atendimento,
  ): Promise<void> {
    const motivo = await motivoParaNaoMexerNoValor(atendimento, repos.intencoesDePagamento);
    if (motivo) throw new BadRequestException(motivo);
  }
}

/**
 * Por que esta comanda não pode ter o valor mexido — ou `null` quando pode.
 *
 * A MESMA pergunta serve a dois usos, e é por isso que ela mora sozinha:
 * remover item **recusa** quando há motivo, e adicionar item apenas **deixa de
 * reprecificar** (adicionar sempre pode; o que não pode é o preço do que já foi
 * pago mudar embaixo de um pagamento fechado).
 *
 * Ver DECISOES_PENDENTES #55 — estorno não existe neste sistema.
 */
export async function motivoParaNaoMexerNoValor(
  atendimento: Atendimento,
  intencoes: { porReferenciaAtendimento(id: string): Promise<{ status: StatusPagamento } | null> },
): Promise<string | null> {
  if (atendimento.valorAbatidoSaldo.centavos > 0) {
    return (
      'Este atendimento usou saldo residual de um pacote. Mexer no valor exigiria devolver ' +
      'esse saldo, o que o sistema ainda não faz — cancele o atendimento e refaça, ou ajuste ' +
      'no acerto.'
    );
  }
  const intencao = await intencoes.porReferenciaAtendimento(atendimento.id);
  if (intencao && intencao.status === StatusPagamento.PAGO) {
    return (
      'Este atendimento já foi pago online. Mexer no valor exigiria estorno, o que o sistema ' +
      'ainda não faz — combine a devolução por fora e registre no acerto.'
    );
  }
  return null;
}

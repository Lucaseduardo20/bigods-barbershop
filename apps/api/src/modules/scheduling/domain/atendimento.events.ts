import { DomainEvent } from '../../../shared/events/domain-event';
import { OrigemAtendimento } from '@bigods/contracts';
import {
  AtendimentoId,
  BarbeiroId,
  ClienteId,
  CompanyId,
  ItemDoPacoteId,
  ProdutoId,
  ServicoId,
} from '../../../shared/domain/ids';

export interface ItemAtendidoSnapshot {
  servicoId: ServicoId;
  valorCobradoCentavos: number;
  duracaoMinutos: number;
  itemDoPacoteId: ItemDoPacoteId | null;
}

export interface ItemProdutoAtendidoSnapshot {
  produtoId: ProdutoId;
  quantidade: number;
  /** Preço UNITÁRIO snapshot — a linha total é `valorUnitarioCentavos * quantidade`. */
  valorUnitarioCentavos: number;
}

export class AtendimentoAgendado implements DomainEvent {
  readonly nome = 'AtendimentoAgendado';
  readonly ocorridoEm = new Date();
  constructor(
    readonly atendimentoId: AtendimentoId,
    readonly companyId: CompanyId,
    readonly clienteId: ClienteId,
    readonly barbeiroId: BarbeiroId,
    readonly inicio: Date,
    readonly fim: Date,
  ) {}
}

export class AtendimentoConcluido implements DomainEvent {
  readonly nome = 'AtendimentoConcluido';
  readonly ocorridoEm = new Date();
  constructor(
    readonly atendimentoId: AtendimentoId,
    readonly companyId: CompanyId,
    readonly barbeiroId: BarbeiroId,
    readonly origem: OrigemAtendimento,
    readonly itens: ItemAtendidoSnapshot[],
    readonly produtos: ItemProdutoAtendidoSnapshot[],
    /**
     * FASE 3 (2026-08-25): ajustes DECLARADOS no fechamento. Viajam no evento
     * porque é o Payroll que os transforma em lançamento — o Atendimento não
     * conhece o ledger (§2.3), e o ledger não vai ler o atendimento para
     * descobrir isso.
     */
    readonly caixinhaCentavos: number = 0,
    readonly descontoConcedidoCentavos: number = 0,
    /**
     * FASE 8 (2026-08-27): a taxa que o gateway retém do pagamento online deste
     * atendimento, em centavos. Zero quando não houve pagamento online.
     *
     * Viaja no evento pela MESMA razão de caixinha e desconto: é o Payroll que a
     * transforma em lançamento, e o Payroll não pode ler `IntencaoDePagamento`
     * (agregado nunca chama agregado, §2.3). Quem sabe dos dois lados é a camada de
     * aplicação, e é ela que preenche este número.
     */
    readonly taxaPagamentoOnlineCentavos: number = 0,
  ) {}
}

export class AtendimentoCancelado implements DomainEvent {
  readonly nome = 'AtendimentoCancelado';
  readonly ocorridoEm = new Date();
  constructor(
    readonly atendimentoId: AtendimentoId,
    readonly companyId: CompanyId,
    readonly origem: OrigemAtendimento,
    readonly motivo: string,
    readonly itensDoPacote: ItemDoPacoteId[],
    /**
     * true se cancelado antes do início do atendimento (não conta falta).
     * DECISAO_PENDENTE: spec não define o prazo limite — usamos o início do atendimento.
     */
    readonly antecipado: boolean,
  ) {}
}

export class ClienteFaltou implements DomainEvent {
  readonly nome = 'ClienteFaltou';
  readonly ocorridoEm = new Date();
  constructor(
    readonly atendimentoId: AtendimentoId,
    readonly companyId: CompanyId,
    readonly clienteId: ClienteId,
    readonly origem: OrigemAtendimento,
    readonly itensDoPacote: ItemDoPacoteId[],
  ) {}
}

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

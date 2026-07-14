import { DomainEvent } from '../../../shared/events/domain-event';
import { OrigemAtendimento } from '@bigods/contracts';
import {
  AtendimentoId,
  BarbeiroId,
  ClienteId,
  CompanyId,
  ItemDoPacoteId,
  ServicoId,
} from '../../../shared/domain/ids';

export interface ItemAtendidoSnapshot {
  servicoId: ServicoId;
  valorCobradoCentavos: number;
  duracaoMinutos: number;
  itemDoPacoteId: ItemDoPacoteId | null;
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

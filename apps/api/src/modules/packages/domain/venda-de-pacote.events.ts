import { DomainEvent } from '../../../shared/events/domain-event';
import {
  ClienteId,
  CompanyId,
  ItemDoPacoteId,
  VendaDePacoteId,
} from '../../../shared/domain/ids';

export class PacoteVendido implements DomainEvent {
  readonly nome = 'PacoteVendido';
  readonly ocorridoEm = new Date();
  constructor(
    readonly vendaId: VendaDePacoteId,
    readonly companyId: CompanyId,
    readonly clienteId: ClienteId,
    readonly valorPagoCentavos: number,
  ) {}
}

export class ItemDoPacoteConsumido implements DomainEvent {
  readonly nome = 'ItemDoPacoteConsumido';
  readonly ocorridoEm = new Date();
  constructor(
    readonly vendaId: VendaDePacoteId,
    readonly itemId: ItemDoPacoteId,
  ) {}
}

export class ItemDoPacoteExpirado implements DomainEvent {
  readonly nome = 'ItemDoPacoteExpirado';
  readonly ocorridoEm = new Date();
  constructor(
    readonly vendaId: VendaDePacoteId,
    readonly itemId: ItemDoPacoteId,
    readonly valorMigradoCentavos: number,
  ) {}
}

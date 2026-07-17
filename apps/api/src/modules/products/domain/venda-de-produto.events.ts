import { DomainEvent } from '../../../shared/events/domain-event';
import { FormaPagamento } from '@bigods/contracts';
import { BarbeiroId, ClienteId, CompanyId, ProdutoId, VendaDeProdutoId } from '../../../shared/domain/ids';

export interface ItemVendaDeProdutoSnapshot {
  produtoId: ProdutoId;
  quantidade: number;
  valorUnitarioCentavos: number;
}

export class VendaDeProdutoRegistrada implements DomainEvent {
  readonly nome = 'VendaDeProdutoRegistrada';
  readonly ocorridoEm = new Date();
  constructor(
    readonly vendaId: VendaDeProdutoId,
    readonly companyId: CompanyId,
    readonly barbeiroId: BarbeiroId,
    readonly clienteId: ClienteId | null,
    readonly itens: ItemVendaDeProdutoSnapshot[],
    readonly formaPagamento: FormaPagamento,
    readonly vendidoEm: Date,
  ) {}
}

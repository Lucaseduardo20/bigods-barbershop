import { CompanyId } from '../../../shared/domain/ids';
import { ItemDeOrderBump, TipoItemDeOrderBump } from './item-de-order-bump.aggregate';

export interface ItemDeOrderBumpRepository {
  listarPorEmpresa(companyId: CompanyId): Promise<ItemDeOrderBump[]>;
  porReferencia(
    companyId: CompanyId,
    tipo: TipoItemDeOrderBump,
    referenciaId: string,
  ): Promise<ItemDeOrderBump | null>;
  salvar(item: ItemDeOrderBump): Promise<void>;
}

export const ITEM_DE_ORDER_BUMP_REPOSITORY = Symbol('ItemDeOrderBumpRepository');

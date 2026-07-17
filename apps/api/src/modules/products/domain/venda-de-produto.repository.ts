import { VendaDeProduto } from './venda-de-produto.aggregate';
import { CompanyId, VendaDeProdutoId } from '../../../shared/domain/ids';

export interface VendaDeProdutoRepository {
  porId(id: VendaDeProdutoId): Promise<VendaDeProduto | null>;
  listar(companyId: CompanyId): Promise<VendaDeProduto[]>;
  salvar(venda: VendaDeProduto): Promise<void>;
}

export const VENDA_DE_PRODUTO_REPOSITORY = Symbol('VendaDeProdutoRepository');

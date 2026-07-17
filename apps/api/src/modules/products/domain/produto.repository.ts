import { Produto } from './produto.aggregate';
import { CompanyId, ProdutoId } from '../../../shared/domain/ids';

export interface ProdutoRepository {
  porId(id: ProdutoId): Promise<Produto | null>;
  porIds(ids: ProdutoId[]): Promise<Produto[]>;
  listar(companyId: CompanyId): Promise<Produto[]>;
  salvar(produto: Produto): Promise<void>;
}

export const PRODUTO_REPOSITORY = Symbol('ProdutoRepository');

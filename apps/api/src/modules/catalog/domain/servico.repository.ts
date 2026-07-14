import { Servico } from './servico.aggregate';
import { CompanyId, ServicoId } from '../../../shared/domain/ids';

export interface ServicoRepository {
  porId(id: ServicoId): Promise<Servico | null>;
  porIds(ids: ServicoId[]): Promise<Servico[]>;
  listar(companyId: CompanyId): Promise<Servico[]>;
  salvar(servico: Servico): Promise<void>;
}

export const SERVICO_REPOSITORY = Symbol('ServicoRepository');

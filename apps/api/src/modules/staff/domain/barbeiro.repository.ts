import { Barbeiro } from './barbeiro.aggregate';
import { BarbeiroId, CompanyId } from '../../../shared/domain/ids';

export interface BarbeiroRepository {
  porId(id: BarbeiroId): Promise<Barbeiro | null>;
  listar(companyId: CompanyId): Promise<Barbeiro[]>;
  salvar(barbeiro: Barbeiro): Promise<void>;
}

export const BARBEIRO_REPOSITORY = Symbol('BarbeiroRepository');

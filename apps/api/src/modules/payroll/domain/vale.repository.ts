import { Vale } from './vale.aggregate';
import { BarbeiroId, CompanyId, ValeId } from '../../../shared/domain/ids';

export interface ValeRepository {
  porId(id: ValeId): Promise<Vale | null>;
  porBarbeiro(barbeiroId: BarbeiroId): Promise<Vale[]>;
  listar(companyId: CompanyId): Promise<Vale[]>;
  salvar(vale: Vale): Promise<void>;
}

export const VALE_REPOSITORY = Symbol('ValeRepository');

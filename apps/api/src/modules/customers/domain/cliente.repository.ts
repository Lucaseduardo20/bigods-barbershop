import { Cliente } from './cliente.aggregate';
import { Telefone } from '../../../shared/domain/telefone';
import { ClienteId, CompanyId } from '../../../shared/domain/ids';

export interface ClienteRepository {
  porId(id: ClienteId): Promise<Cliente | null>;
  porTelefone(companyId: CompanyId, telefone: Telefone): Promise<Cliente | null>;
  listar(companyId: CompanyId): Promise<Cliente[]>;
  salvar(cliente: Cliente): Promise<void>;
}

export const CLIENTE_REPOSITORY = Symbol('ClienteRepository');

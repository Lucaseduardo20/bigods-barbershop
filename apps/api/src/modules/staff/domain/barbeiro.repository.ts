import { Barbeiro } from './barbeiro.aggregate';
import { BarbeiroId, CompanyId } from '../../../shared/domain/ids';

export interface BarbeiroRepository {
  porId(id: BarbeiroId): Promise<Barbeiro | null>;
  /** Link pessoal de marketing (§4b) — slug inválido/inexistente devolve null (nunca 404 feio pro cliente). */
  porSlug(companyId: CompanyId, slug: string): Promise<Barbeiro | null>;
  listar(companyId: CompanyId): Promise<Barbeiro[]>;
  /** TODO o staff da empresa, qualquer papel (inclusive admin puro) — gestão de usuários. `listar` fica reservado a quem atende (agenda/booking). */
  listarTodos(companyId: CompanyId): Promise<Barbeiro[]>;
  salvar(barbeiro: Barbeiro): Promise<void>;
}

export const BARBEIRO_REPOSITORY = Symbol('BarbeiroRepository');

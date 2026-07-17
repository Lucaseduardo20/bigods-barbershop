import { ExpedienteSemanal } from './expediente-semanal.aggregate';
import { BarbeiroId } from '../../../shared/domain/ids';

export interface ExpedienteSemanalRepository {
  porBarbeiro(barbeiroId: BarbeiroId): Promise<ExpedienteSemanal | null>;
  /** Todos os expedientes definidos de uma empresa (para materialização em lote). */
  listarPorEmpresa(companyId: string): Promise<ExpedienteSemanal[]>;
  salvar(expediente: ExpedienteSemanal): Promise<void>;
}

export const EXPEDIENTE_SEMANAL_REPOSITORY = Symbol('ExpedienteSemanalRepository');

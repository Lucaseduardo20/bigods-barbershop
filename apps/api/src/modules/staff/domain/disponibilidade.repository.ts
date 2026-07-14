import { DisponibilidadeBarbeiro } from './disponibilidade.aggregate';
import { BarbeiroId, DisponibilidadeId } from '../../../shared/domain/ids';

export interface DisponibilidadeRepository {
  porId(id: DisponibilidadeId): Promise<DisponibilidadeBarbeiro | null>;
  porBarbeiroEData(barbeiroId: BarbeiroId, data: string): Promise<DisponibilidadeBarbeiro[]>;
  porBarbeiro(barbeiroId: BarbeiroId): Promise<DisponibilidadeBarbeiro[]>;
  salvar(disponibilidade: DisponibilidadeBarbeiro): Promise<void>;
  remover(id: DisponibilidadeId): Promise<void>;
}

export const DISPONIBILIDADE_REPOSITORY = Symbol('DisponibilidadeRepository');

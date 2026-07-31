import { PacoteOferta } from './pacote-oferta.aggregate';
import { BarbeiroId, CompanyId, PacoteOfertaId } from '../../../shared/domain/ids';

export interface PacoteOfertaRepository {
  porId(id: PacoteOfertaId): Promise<PacoteOferta | null>;
  listarPorEmpresa(companyId: CompanyId): Promise<PacoteOferta[]>;
  listarPorBarbeiro(barbeiroId: BarbeiroId): Promise<PacoteOferta[]>;
  salvar(oferta: PacoteOferta): Promise<void>;
}

export const PACOTE_OFERTA_REPOSITORY = Symbol('PacoteOfertaRepository');

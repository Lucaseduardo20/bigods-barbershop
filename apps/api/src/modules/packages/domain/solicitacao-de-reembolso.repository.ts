import { SolicitacaoDeReembolso, SolicitacaoDeReembolsoId } from './solicitacao-de-reembolso.aggregate';
import { CompanyId } from '../../../shared/domain/ids';

export interface SolicitacaoDeReembolsoRepository {
  porId(id: SolicitacaoDeReembolsoId): Promise<SolicitacaoDeReembolso | null>;
  pendentes(companyId: CompanyId): Promise<SolicitacaoDeReembolso[]>;
  salvar(solicitacao: SolicitacaoDeReembolso): Promise<void>;
}

export const SOLICITACAO_DE_REEMBOLSO_REPOSITORY = Symbol('SolicitacaoDeReembolsoRepository');

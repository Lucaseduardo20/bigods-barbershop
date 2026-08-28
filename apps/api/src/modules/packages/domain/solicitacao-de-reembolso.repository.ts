import { StatusSolicitacaoReembolso } from '@bigods/contracts';
import { SolicitacaoDeReembolso, SolicitacaoDeReembolsoId } from './solicitacao-de-reembolso.aggregate';
import { CompanyId } from '../../../shared/domain/ids';

export interface SolicitacaoDeReembolsoRepository {
  porId(id: SolicitacaoDeReembolsoId): Promise<SolicitacaoDeReembolso | null>;
  pendentes(companyId: CompanyId): Promise<SolicitacaoDeReembolso[]>;
  porStatus(companyId: CompanyId, status: StatusSolicitacaoReembolso): Promise<SolicitacaoDeReembolso[]>;
  /**
   * Agendamentos cujo prazo já venceu, do mais antigo primeiro, no máximo `limite`.
   *
   * ## Por que atravessa empresas
   *
   * Não recebe `companyId`: é um job de sistema, e varrer por empresa exigiria
   * primeiro listar empresas — o que reintroduz resolução dinâmica de tenant, que
   * o DOMAIN.md §2.4 proíbe. Cada solicitação carrega o seu `companyId`, e a
   * execução usa o dela; o que não existe é um "tenant atual" implícito.
   *
   * ## Por que ordenado e limitado
   *
   * Mais antigo primeiro porque é dinheiro de cliente esperando, e o limite existe
   * pelo rate limit do gateway: um lote grande tomaria 429 justamente quando mais
   * precisa funcionar. O que sobrar vem no próximo tick.
   */
  agendadosVencidos(agora: Date, limite: number): Promise<SolicitacaoDeReembolso[]>;
  salvar(solicitacao: SolicitacaoDeReembolso): Promise<void>;
}

export const SOLICITACAO_DE_REEMBOLSO_REPOSITORY = Symbol('SolicitacaoDeReembolsoRepository');

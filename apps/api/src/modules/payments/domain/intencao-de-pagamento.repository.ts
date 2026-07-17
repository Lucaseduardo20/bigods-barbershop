import { IntencaoDePagamento } from './intencao-de-pagamento.aggregate';
import { AtendimentoId, IntencaoDePagamentoId } from '../../../shared/domain/ids';

export interface IntencaoDePagamentoRepository {
  porId(id: IntencaoDePagamentoId): Promise<IntencaoDePagamento | null>;
  porExternalId(externalId: string): Promise<IntencaoDePagamento | null>;
  /**
   * A intenção vinculada a um Atendimento (referencia ATENDIMENTO), se
   * existir — usada na conclusão para saber se o atendimento foi pago online
   * (item 2 da sessão 2026-07-16). No máximo uma por atendimento hoje.
   */
  porReferenciaAtendimento(atendimentoId: AtendimentoId): Promise<IntencaoDePagamento | null>;
  salvar(intencao: IntencaoDePagamento): Promise<void>;
}

export const INTENCAO_DE_PAGAMENTO_REPOSITORY = Symbol('IntencaoDePagamentoRepository');

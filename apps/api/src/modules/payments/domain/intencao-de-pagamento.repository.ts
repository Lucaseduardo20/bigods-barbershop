import { IntencaoDePagamento } from './intencao-de-pagamento.aggregate';
import { IntencaoDePagamentoId } from '../../../shared/domain/ids';

export interface IntencaoDePagamentoRepository {
  porId(id: IntencaoDePagamentoId): Promise<IntencaoDePagamento | null>;
  porExternalId(externalId: string): Promise<IntencaoDePagamento | null>;
  salvar(intencao: IntencaoDePagamento): Promise<void>;
}

export const INTENCAO_DE_PAGAMENTO_REPOSITORY = Symbol('IntencaoDePagamentoRepository');

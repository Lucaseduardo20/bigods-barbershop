import { IntencaoDePagamentoId } from '../../../shared/domain/ids';
import { TentativaDePagamento } from './tentativa-de-pagamento.aggregate';

export interface TentativaDePagamentoRepository {
  porId(id: string): Promise<TentativaDePagamento | null>;
  /**
   * Todas as tentativas de uma intenção, da mais recente para a mais antiga.
   *
   * Usada para duas coisas: impedir DUAS tentativas vivas ao mesmo tempo (sem
   * isso, dois cartões poderiam aprovar e a barbearia cobraria duas vezes) e
   * mostrar o histórico no admin.
   */
  porIntencao(intencaoId: IntencaoDePagamentoId): Promise<TentativaDePagamento[]>;
  salvar(tentativa: TentativaDePagamento): Promise<void>;
}

export const TENTATIVA_DE_PAGAMENTO_REPOSITORY = Symbol('TentativaDePagamentoRepository');

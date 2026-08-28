import { IntencaoDePagamento } from './intencao-de-pagamento.aggregate';
import { AtendimentoId, IntencaoDePagamentoId, VendaDePacoteId } from '../../../shared/domain/ids';

export interface IntencaoDePagamentoRepository {
  porId(id: IntencaoDePagamentoId): Promise<IntencaoDePagamento | null>;
  porExternalId(externalId: string): Promise<IntencaoDePagamento | null>;
  /**
   * A intenção vinculada a um Atendimento (referencia ATENDIMENTO), se
   * existir — usada na conclusão para saber se o atendimento foi pago online
   * (item 2 da sessão 2026-07-16). No máximo uma por atendimento hoje.
   */
  porReferenciaAtendimento(atendimentoId: AtendimentoId): Promise<IntencaoDePagamento | null>;
  /**
   * A intenção vinculada a uma VendaDePacote (referencia VENDA_DE_PACOTE) —
   * usada pela confirmação manual de pagamento presencial (bug 8), o mesmo
   * caminho idempotente do webhook, só que disparado pelo admin.
   */
  porReferenciaVendaDePacote(vendaDePacoteId: VendaDePacoteId): Promise<IntencaoDePagamento | null>;
  /**
   * A intenção cujo `gatewayId` é este — a rota de recuperação quando a
   * notificação do Mercado Pago não permite chegar pelo `externalId`.
   *
   * Existe porque o webhook dele é um PING: traz só o id da order, sem status e
   * sem o nosso `external_reference`. O caminho normal é ler o
   * `external_reference` da resposta do `GET /v1/orders/{id}`; este é o plano B
   * para quando o gateway não o ecoa.
   */
  porGatewayId(gatewayId: string): Promise<IntencaoDePagamento | null>;
  /**
   * Intenções com estorno EM VOO: pedido feito e sem confirmação do gateway
   * (`estornoSolicitadoEm != null && estornoGatewayId == null`).
   *
   * É o estado que existe porque a chamada ao gateway acontece FORA da transação
   * que marcou o pedido — um crash entre as duas deixa a devolução travada. Sem
   * esta varredura, o cliente descobriria antes da barbearia.
   *
   * `limite` existe para o job não puxar a tabela inteira nem estourar o rate
   * limit do gateway num lote grande; a ordenação é do mais ANTIGO primeiro,
   * porque quem espera mais tem prioridade.
   */
  comEstornoEmVoo(limite: number): Promise<IntencaoDePagamento[]>;
  salvar(intencao: IntencaoDePagamento): Promise<void>;
}

export const INTENCAO_DE_PAGAMENTO_REPOSITORY = Symbol('IntencaoDePagamentoRepository');

import { Dinheiro } from '../../../shared/domain/dinheiro';

export interface CobrancaPix {
  /** id da cobrança no gateway */
  gatewayId: string;
  qrCode: string;
  copiaECola: string;
}

/**
 * Porta do gateway de pagamento (AbacatePay).
 * O domínio cria a IntencaoDePagamento ANTES; a infra chama o gateway
 * passando nosso externalId como metadata — o webhook o devolve.
 */
export interface PaymentGateway {
  criarCobrancaPix(params: {
    valor: Dinheiro;
    descricao: string;
    externalId: string;
  }): Promise<CobrancaPix>;
}

export const PAYMENT_GATEWAY = Symbol('PaymentGateway');

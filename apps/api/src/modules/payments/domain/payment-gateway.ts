import { Dinheiro } from '../../../shared/domain/dinheiro';

export interface CobrancaPix {
  /** id da cobrança no gateway (Checkout Transparente) */
  gatewayId: string;
  qrCode: string;
  copiaECola: string;
  /** Quando o QR Code expira sem pagamento — devolvido pelo próprio gateway. */
  expiresAt: Date;
}

/**
 * Porta do gateway de pagamento (AbacatePay, Checkout Transparente v2).
 * O domínio cria a IntencaoDePagamento ANTES; a infra chama o gateway
 * passando nosso externalId — o webhook o devolve em `data.transparent.externalId`.
 */
export interface PaymentGateway {
  /**
   * Segundos até a cobrança PIX expirar — a mesma janela pedida ao gateway
   * (`expiresIn`) e usada localmente para expirar por timeout (§3.8, FASE 4
   * da sessão de pagamento online: não existe webhook de "PIX expirado" na
   * AbacatePay, só de disputa perdida — ver `regra-expiracao-pagamento.ts`).
   */
  readonly expiraEmSegundos: number;
  criarCobrancaPix(params: {
    valor: Dinheiro;
    descricao: string;
    externalId: string;
    /**
     * Override da janela padrão do gateway (`expiraEmSegundos`) — usado pela
     * reserva temporária (sessão de OTP+reserva) pra pedir à AbacatePay
     * exatamente a mesma janela da reserva local, nunca mais longa: um PIX
     * que a AbacatePay ainda aceitasse depois que já desistimos da reserva
     * seria um split-brain (pagamento confirma uma reserva que já expirou).
     */
    expiraEmSegundos?: number;
  }): Promise<CobrancaPix>;
}

export const PAYMENT_GATEWAY = Symbol('PaymentGateway');

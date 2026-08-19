/**
 * Modo de pagamento manual por WhatsApp — TEMPORÁRIO (2026-08-18).
 *
 * O AbacatePay leva ~7 dias úteis para liberar produção. Até lá, o "pagar
 * online" do funil não gera PIX: manda o cliente pro WhatsApp da barbearia com
 * a comanda pronta, e o dono confirma no admin quando o PIX cair por fora.
 *
 * Ligar/desligar é SÓ esta variável de ambiente. O código do gateway continua
 * intacto — quando a AbacatePay liberar, `PAGAMENTO_MANUAL_WHATSAPP=false` (ou
 * remover a variável) devolve o fluxo normal sem outra sessão de trabalho.
 * Ver DECISOES_PENDENTES.
 */

export interface ConfigPagamentoManual {
  ativo: boolean;
  /** Destino da comanda — E.164 só com dígitos (ex.: "5511990036469"). */
  whatsappNumero: string;
}

export const CONFIG_PAGAMENTO_MANUAL = Symbol('ConfigPagamentoManual');

export function lerConfigPagamentoManual(
  env: NodeJS.ProcessEnv = process.env,
): ConfigPagamentoManual {
  const ativo = env.PAGAMENTO_MANUAL_WHATSAPP === 'true';
  const whatsappNumero = (env.PAGAMENTO_MANUAL_WHATSAPP_NUMERO ?? '').replace(/\D/g, '');
  return { ativo, whatsappNumero };
}

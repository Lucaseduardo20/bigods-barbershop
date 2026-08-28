/**
 * Configuração do Mercado Pago (Orders API), lida UMA vez no boot.
 *
 * Segue o padrão de `pagamento-manual.ts`: função pura sobre um mapa de env, para
 * ser testável sem processo, e um símbolo de DI para que o ponto de uso receba
 * configuração em vez de ler `process.env` no meio do fluxo.
 *
 * A validação de obrigatoriedade NÃO está aqui — está em `config-seguranca.ts`,
 * que derruba o boot antes de qualquer coisa subir. Aqui a leitura é tolerante de
 * propósito: com `PAYMENT_GATEWAY` diferente de `mercadopago`, nada disto existe
 * e não é erro.
 */

export interface ConfigMercadoPago {
  accessToken: string;
  /** Chave pública — servida ao frontend pela API, nunca por uma VITE_. */
  publicKey: string;
  /** Segredo do webhook, POR APLICAÇÃO (staging e produção têm o seu). */
  webhookSecret: string;
  /** Número da aplicação, conferido contra `application_id` da notificação. */
  applicationId: string;
  /** Id do vendedor, conferido contra `user_id` da notificação. */
  userId: string;
  baseUrl: string;
  expiraEmSegundos: number;
  statementDescriptor: string;
  emailPadraoDoPagador: string;
  timeoutMs: number;
  /**
   * `MERCADOPAGO_ENV === 'producao'`.
   *
   * ★ EXPLÍCITO, nunca inferido. O Access Token de teste e o de produção começam
   * AMBOS com `APP_USR-` (a conta de teste de vendedor nasce junto com a
   * aplicação e suas credenciais viram as "credenciais de teste"), e não existe
   * host de sandbox — os dois ambientes falam com `api.mercadopago.com`. Sem esta
   * flag não há como recusar uma notificação com `live_mode` divergente, que é o
   * único sinal de aplicação cruzada entre ambientes.
   */
  ambienteEhProducao: boolean;
  /**
   * Tolerância de atraso da assinatura, em segundos. `undefined` = desligada
   * (default) — ver `mercadopago-webhook.verifier.ts` para o porquê.
   */
  toleranciaAssinaturaSegundos?: number;
}

export const CONFIG_MERCADO_PAGO = Symbol('ConfigMercadoPago');

const BASE_URL_PADRAO = 'https://api.mercadopago.com';
/** Mínimo do Mercado Pago para PIX: 30 minutos. */
const EXPIRA_PADRAO_SEGUNDOS = 1800;
const TIMEOUT_PADRAO_MS = 8000;
const DESCRITOR_PADRAO = 'BIGODS_BARBERSHOP_F1';

function inteiroOuPadrao(valor: string | undefined, padrao: number): number {
  const n = Number(valor ?? '');
  return Number.isInteger(n) && n > 0 ? n : padrao;
}

export function lerConfigMercadoPago(env: NodeJS.ProcessEnv = process.env): ConfigMercadoPago {
  const tolerancia = Number(env.MERCADOPAGO_TOLERANCIA_ASSINATURA_SEGUNDOS ?? '');
  return {
    accessToken: env.MERCADOPAGO_ACCESS_TOKEN ?? '',
    publicKey: env.MERCADOPAGO_PUBLIC_KEY ?? '',
    webhookSecret: env.MERCADOPAGO_WEBHOOK_SECRET ?? '',
    applicationId: env.MERCADOPAGO_APPLICATION_ID ?? '',
    userId: env.MERCADOPAGO_USER_ID ?? '',
    baseUrl: env.MERCADOPAGO_BASE_URL ?? BASE_URL_PADRAO,
    expiraEmSegundos: inteiroOuPadrao(env.MERCADOPAGO_EXPIRA_SEGUNDOS, EXPIRA_PADRAO_SEGUNDOS),
    statementDescriptor: (env.MERCADOPAGO_STATEMENT_DESCRIPTOR ?? DESCRITOR_PADRAO).slice(0, 50),
    emailPadraoDoPagador: env.MERCADOPAGO_EMAIL_PADRAO ?? '',
    timeoutMs: inteiroOuPadrao(env.MERCADOPAGO_TIMEOUT_MS, TIMEOUT_PADRAO_MS),
    ambienteEhProducao: (env.MERCADOPAGO_ENV ?? '').toLowerCase() === 'producao',
    ...(Number.isInteger(tolerancia) && tolerancia > 0
      ? { toleranciaAssinaturaSegundos: tolerancia }
      : {}),
  };
}

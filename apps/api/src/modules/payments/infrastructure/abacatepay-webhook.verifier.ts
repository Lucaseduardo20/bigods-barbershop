import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificação da origem de um webhook do AbacatePay v2. Pura (sem Nest/Prisma)
 * para ser testável isoladamente.
 *
 * Confirmado contra a documentação oficial (`/pages/webhooks/security`), NÃO
 * presumido: a AbacatePay usa DOIS mecanismos INDEPENDENTES, e o próprio
 * checklist deles diz "use os dois juntos" — aqui os dois são OBRIGATÓRIOS
 * (AND, não OR):
 *
 * 1. **Secret na query string** (`?webhookSecret=...`) — o segredo que NÓS
 *    escolhemos ao cadastrar o webhook (`ABACATEPAY_WEBHOOK_SECRET`). Prova
 *    que a requisição veio pra ESTE webhook específico.
 * 2. **Assinatura HMAC-SHA256** no header `X-Webhook-Signature`, em BASE64,
 *    sobre o corpo CRU — calculada com a CHAVE PÚBLICA da própria AbacatePay
 *    (constante, igual pra toda conta — publicada na doc deles, não é o
 *    `ABACATEPAY_WEBHOOK_SECRET`, que é só a prova #1). Prova que o corpo não
 *    foi alterado em trânsito e veio da infraestrutura deles.
 *
 * Diferenças reais do que uma implementação "ingênua" assumiria (documentadas
 * aqui porque já causaram um bug real nesta sessão): a assinatura NÃO usa o
 * nosso secret como chave HMAC, e o digest é BASE64, não hex.
 *
 * Regra inegociável: NUNCA usar comparação `===` num hash/segredo (vaza tempo).
 * A validação é INCONDICIONAL — não existe atalho por ambiente/devMode.
 */

/**
 * Chave pública da AbacatePay para verificar a assinatura HMAC dos webhooks —
 * a mesma para toda conta (não é um segredo nosso, é publicada na doc deles:
 * docs.abacatepay.com/pages/webhooks/security). NÃO é `ABACATEPAY_WEBHOOK_SECRET`
 * — aquele vive só na query string (prova #1 acima), nunca aqui.
 */
const ABACATEPAY_PUBLIC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9';

export interface EntradaVerificacaoWebhook {
  /** Corpo cru exatamente como recebido (o HMAC é calculado sobre estes bytes). */
  corpoCru: Buffer | string;
  /** Header `X-Webhook-Signature` (base64 do HMAC-SHA256), se presente. */
  assinaturaHeader?: string;
  /** Query param `webhookSecret`, se presente. */
  segredoQuery?: string;
  /** Segredo do webhook configurado (env `ABACATEPAY_WEBHOOK_SECRET`) — validado contra `segredoQuery`. */
  segredo: string;
}

export function verificarWebhookAbacatePay(entrada: EntradaVerificacaoWebhook): boolean {
  if (!entrada.segredo) return false; // sem segredo configurado → falha fechada

  // Prova 1: secret compartilhado na query string — tem que bater com o nosso.
  if (!entrada.segredoQuery || !comparaSegura(entrada.segredoQuery, entrada.segredo)) {
    return false;
  }

  // Prova 2: assinatura HMAC-SHA256 (base64) do corpo cru, com a chave PÚBLICA da AbacatePay.
  if (!entrada.assinaturaHeader) return false;
  const esperado = createHmac('sha256', ABACATEPAY_PUBLIC_KEY).update(entrada.corpoCru).digest('base64');
  return comparaSegura(entrada.assinaturaHeader, esperado);
}

/** Comparação em tempo constante. Difere no tamanho → false, sem vazar por timing. */
function comparaSegura(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

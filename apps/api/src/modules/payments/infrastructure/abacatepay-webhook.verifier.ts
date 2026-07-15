import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificação da origem de um webhook do AbacatePay. Pura (sem Nest/Prisma) para
 * ser testável isoladamente.
 *
 * A AbacatePay assina cada webhook com HMAC-SHA256 sobre o CORPO CRU da
 * requisição, no header `X-Webhook-Signature`, e também emite um segredo pela
 * query string (`?webhookSecret=...`). Aceitamos qualquer uma das duas provas —
 * ambas comparadas em tempo constante — e rejeitamos tudo o mais.
 *
 * Regra inegociável: NUNCA usar comparação `===` num hash/segredo (vaza tempo).
 * A validação é INCONDICIONAL — não existe atalho por ambiente.
 */
export interface EntradaVerificacaoWebhook {
  /** Corpo cru exatamente como recebido (o HMAC é calculado sobre estes bytes). */
  corpoCru: Buffer | string;
  /** Header `X-Webhook-Signature` (hex do HMAC-SHA256), se presente. */
  assinaturaHeader?: string;
  /** Query param `webhookSecret`, se presente. */
  segredoQuery?: string;
  /** Segredo do webhook configurado (env `ABACATEPAY_WEBHOOK_SECRET`). */
  segredo: string;
}

export function verificarWebhookAbacatePay(entrada: EntradaVerificacaoWebhook): boolean {
  if (!entrada.segredo) return false; // sem segredo configurado → falha fechada

  // Prova 1: assinatura HMAC-SHA256 do corpo cru.
  if (entrada.assinaturaHeader) {
    const esperado = createHmac('sha256', entrada.segredo)
      .update(entrada.corpoCru)
      .digest('hex');
    if (comparaSegura(entrada.assinaturaHeader, esperado)) return true;
  }

  // Prova 2: segredo compartilhado na query string (comparação em tempo constante).
  if (entrada.segredoQuery && comparaSegura(entrada.segredoQuery, entrada.segredo)) {
    return true;
  }

  return false;
}

/** Comparação em tempo constante. Difere no tamanho → false, sem vazar por timing. */
function comparaSegura(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

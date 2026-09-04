import { timingSafeEqual } from 'node:crypto';

/**
 * Comparação em tempo constante. Tamanhos diferentes → `false`, sem vazar por
 * timing.
 *
 * Extraída de `abacatepay-webhook.verifier.ts` em 2026-08-27, quando o
 * verificador do Mercado Pago passou a precisar da mesma coisa. Uma cópia em
 * cada verificador seria a mesma regra em dois lugares — e é regra de segurança,
 * onde divergir é pior.
 *
 * ## Por que `Buffer.length` e não `string.length`
 *
 * Um `v1` de 64 CARACTERES que contenha um caractere multibyte tem mais de 64
 * BYTES. Comparando por caracteres, o guard de tamanho passa e o
 * `timingSafeEqual` estoura `RangeError: Input buffers must have the same byte
 * length` — que escapa do catch de assinatura e vira **500 em vez de 401**. O
 * header é controlado por quem chama, então isso é entrada hostil, não hipótese:
 * é exatamente o bug que o SDK oficial do Mercado Pago teve (issue #459).
 */
export function comparaSegura(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

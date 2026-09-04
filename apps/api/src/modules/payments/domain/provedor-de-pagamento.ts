/**
 * Qual adapter criou uma cobrança.
 *
 * União de literais em vez do enum do Prisma de propósito: o domínio não importa
 * tipo de ORM (CLAUDE.md §2). A infra mapeia explicitamente Prisma ↔ este tipo,
 * como já faz com todo o resto.
 *
 * `null` no banco significa "linha anterior a 2026-08-27" ou "modo manual por
 * WhatsApp", que não chama gateway nenhum.
 */
export const PROVEDORES_DE_PAGAMENTO = ['ABACATEPAY', 'MERCADOPAGO', 'FAKE'] as const;

export type ProvedorDePagamento = (typeof PROVEDORES_DE_PAGAMENTO)[number];

export function ehProvedorDePagamento(valor: unknown): valor is ProvedorDePagamento {
  return (
    typeof valor === 'string' &&
    (PROVEDORES_DE_PAGAMENTO as readonly string[]).includes(valor)
  );
}

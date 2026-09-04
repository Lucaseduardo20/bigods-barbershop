-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 8 — tipos novos. SÓ `ADD VALUE`, nenhum uso.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ★ Separada da migration de colunas de propósito, e é a terceira vez que este
-- projeto tropeça nisso (ver `20260820010000` e `20260825020000`): o Postgres
-- **não permite usar** um valor de enum na MESMA transação em que ele foi
-- criado, e migration do Prisma roda em transação. Um `ALTER TYPE ... ADD VALUE`
-- seguido de qualquer `WHERE tipo = 'NOVO'` falha com
-- "unsafe use of new value of enum type".
--
-- Aditiva: acrescentar valor a um enum não reescreve linha nenhuma e não invalida
-- nada existente.

-- Parte da taxa do gateway absorvida pelo barbeiro. Subtrai no saldo, como
-- VALE / PAGAMENTO / DESCONTO_CONCEDIDO — `sinalDoTipo` devolve -1 para tudo que
-- não é COMISSAO, então nenhum código de saldo precisa mudar.
ALTER TYPE "TipoLancamento" ADD VALUE IF NOT EXISTS 'TAXA_PAGAMENTO_ONLINE';

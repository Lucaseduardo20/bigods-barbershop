-- FASE 3 (2026-08-25): caixinha e desconto no fechamento.
--
-- Os valores do enum vêm numa migration SEPARADA da que os USA, de propósito:
-- no Postgres, um valor criado por ALTER TYPE ... ADD VALUE não pode ser
-- utilizado na MESMA transação em que foi criado, e o Prisma roda cada
-- migration numa transação. Já queimamos essa lição em
-- 20260820010000_conclusao_pendente_enum.
ALTER TYPE "OrigemComissao" ADD VALUE IF NOT EXISTS 'CAIXINHA';
ALTER TYPE "TipoLancamento" ADD VALUE IF NOT EXISTS 'DESCONTO_CONCEDIDO';

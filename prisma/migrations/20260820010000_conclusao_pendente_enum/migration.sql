-- Estado novo: conclusão ANTECIPADA aguardando aprovação do admin (2026-08-20).
--
-- Em migration SEPARADA de propósito: o Postgres permite `ALTER TYPE ... ADD
-- VALUE` dentro de uma transação, mas NÃO permite USAR o valor novo na mesma
-- transação. A constraint EXCLUDE da migration seguinte referencia este valor,
-- então ele precisa já estar comitado.
ALTER TYPE "StatusAtendimento" ADD VALUE IF NOT EXISTS 'CONCLUSAO_PENDENTE';

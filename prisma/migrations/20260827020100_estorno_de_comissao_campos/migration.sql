-- O vínculo do estorno com o lançamento que ele anula (2026-08-27).
--
-- Sem @relation, mesmo padrão dos outros ids de auditoria do schema
-- (atendimentoId, valeId): é referência para leitura e conferência, não FK
-- rígida. NULL em todo lançamento que não é estorno — que são quase todos.
ALTER TABLE "LancamentoComissao" ADD COLUMN "estornoDeId" TEXT;
CREATE INDEX "LancamentoComissao_estornoDeId_idx" ON "LancamentoComissao"("estornoDeId");

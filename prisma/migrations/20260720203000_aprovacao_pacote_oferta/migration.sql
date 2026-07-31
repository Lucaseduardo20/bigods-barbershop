-- Workflow de aprovação de PacoteOferta (sessão-B, Fase 3): RASCUNHO →
-- PENDENTE_APROVACAO → APROVADO | REJEITADO. Só APROVADO aparece no funil
-- público. Ofertas existentes (criadas antes desta sessão) já são tratadas
-- como APROVADO (default) — não somem do funil por causa desta migration.

CREATE TYPE "StatusAprovacaoPacoteOferta" AS ENUM ('RASCUNHO', 'PENDENTE_APROVACAO', 'APROVADO', 'REJEITADO');

ALTER TABLE "PacoteOferta" ADD COLUMN "statusAprovacao" "StatusAprovacaoPacoteOferta" NOT NULL DEFAULT 'APROVADO';
ALTER TABLE "PacoteOferta" ADD COLUMN "motivoRejeicao" TEXT;

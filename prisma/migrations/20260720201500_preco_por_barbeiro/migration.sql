-- Preço por barbeiro (sessão-B, Fase 2): ExcecaoPreco (override por barbeiro+
-- serviço, mesmo padrão de ExcecaoComissao) + VendaDePacote.barbeiroId
-- (backfill best-effort para vendas existentes: primeiro barbeiro da mesma
-- empresa — não havia dono antes desta sessão).

CREATE TABLE "ExcecaoPreco" (
    "barbeiroId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "precoCentavos" INTEGER NOT NULL,
    CONSTRAINT "ExcecaoPreco_pkey" PRIMARY KEY ("barbeiroId", "servicoId")
);
ALTER TABLE "ExcecaoPreco" ADD CONSTRAINT "ExcecaoPreco_barbeiroId_fkey"
    FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendaDePacote" ADD COLUMN "barbeiroId" TEXT;
UPDATE "VendaDePacote" v
SET "barbeiroId" = (
    SELECT b."id" FROM "Barbeiro" b
    WHERE b."companyId" = v."companyId"
    ORDER BY b."id"
    LIMIT 1
);
ALTER TABLE "VendaDePacote" ALTER COLUMN "barbeiroId" SET NOT NULL;
CREATE INDEX "VendaDePacote_barbeiroId_idx" ON "VendaDePacote"("barbeiroId");
ALTER TABLE "VendaDePacote" ADD CONSTRAINT "VendaDePacote_barbeiroId_fkey"
    FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

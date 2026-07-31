-- PacoteOferta vira agregado de domínio: dono (barbeiroId) + composição mista
-- (PacoteOfertaItem, N serviços distintos). Migração preserva as ofertas
-- semeadas existentes: cada uma vira 1 PacoteOfertaItem (servicoId,
-- quantidade antigos) e ganha barbeiroId = primeiro barbeiro ativo da mesma
-- empresa (dado que não existia antes desta sessão — melhor esforço para não
-- perder as ofertas já cadastradas).

-- 1) Nova tabela de composição
CREATE TABLE "PacoteOfertaItem" (
    "id" TEXT NOT NULL,
    "ofertaId" TEXT NOT NULL,
    "servicoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    CONSTRAINT "PacoteOfertaItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PacoteOfertaItem_ofertaId_idx" ON "PacoteOfertaItem"("ofertaId");
ALTER TABLE "PacoteOfertaItem" ADD CONSTRAINT "PacoteOfertaItem_ofertaId_fkey"
    FOREIGN KEY ("ofertaId") REFERENCES "PacoteOferta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) Migra a composição existente (servicoId/quantidade) para a nova tabela
INSERT INTO "PacoteOfertaItem" ("id", "ofertaId", "servicoId", "quantidade")
SELECT gen_random_uuid()::text, "id", "servicoId", "quantidade"
FROM "PacoteOferta";

-- 3) Adiciona barbeiroId (nullable por enquanto, backfill em seguida)
ALTER TABLE "PacoteOferta" ADD COLUMN "barbeiroId" TEXT;
UPDATE "PacoteOferta" o
SET "barbeiroId" = (
    SELECT b."id" FROM "Barbeiro" b
    WHERE b."companyId" = o."companyId"
    ORDER BY b."id"
    LIMIT 1
);
ALTER TABLE "PacoteOferta" ALTER COLUMN "barbeiroId" SET NOT NULL;
CREATE INDEX "PacoteOferta_barbeiroId_idx" ON "PacoteOferta"("barbeiroId");
ALTER TABLE "PacoteOferta" ADD CONSTRAINT "PacoteOferta_barbeiroId_fkey"
    FOREIGN KEY ("barbeiroId") REFERENCES "Barbeiro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PacoteOferta" ADD CONSTRAINT "PacoteOferta_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) Composição antiga sai da tabela principal (já migrada para PacoteOfertaItem)
ALTER TABLE "PacoteOferta" DROP COLUMN "servicoId";
ALTER TABLE "PacoteOferta" DROP COLUMN "quantidade";

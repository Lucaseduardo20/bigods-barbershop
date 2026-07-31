-- Fase 4b/4c (sessão-B): slug legível por barbeiro (link pessoal de
-- marketing) + registro de origemLink em Atendimento/VendaDePacote (de qual
-- link pessoal veio o agendamento/compra, se veio de algum).

CREATE EXTENSION IF NOT EXISTS unaccent;

-- 1) slug: backfill best-effort a partir do nome (kebab-case, sem acento).
-- Barbeiros cadastrados depois disso sempre recebem um slug gerado na hora
-- (com desambiguação de colisão feita na aplicação, não aqui).
ALTER TABLE "Barbeiro" ADD COLUMN "slug" TEXT;
UPDATE "Barbeiro"
SET "slug" = trim(both '-' from lower(regexp_replace(unaccent("nome"), '[^a-zA-Z0-9]+', '-', 'g')))
WHERE "slug" IS NULL;
-- Desambigua colisões do backfill (ex.: dois barbeiros chamados "João"):
-- sufixo -2, -3... por ordem de id, dentro da mesma empresa.
WITH duplicados AS (
  SELECT "id", "slug",
         ROW_NUMBER() OVER (PARTITION BY "companyId", "slug" ORDER BY "id") AS rn
  FROM "Barbeiro"
)
UPDATE "Barbeiro" b
SET "slug" = b."slug" || '-' || d.rn
FROM duplicados d
WHERE b."id" = d."id" AND d.rn > 1;

ALTER TABLE "Barbeiro" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Barbeiro_companyId_slug_key" ON "Barbeiro"("companyId", "slug");

-- 2) origemLink — só registro, totalmente aditivo/nullable.
ALTER TABLE "Atendimento" ADD COLUMN "origemLinkBarbeiroId" TEXT;
ALTER TABLE "VendaDePacote" ADD COLUMN "origemLinkBarbeiroId" TEXT;

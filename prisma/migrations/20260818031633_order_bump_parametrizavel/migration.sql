-- CreateEnum
CREATE TYPE "TipoItemDeOrderBump" AS ENUM ('SERVICO', 'PRODUTO');

-- CreateTable
CREATE TABLE "ItemDeOrderBump" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tipo" "TipoItemDeOrderBump" NOT NULL,
    "referenciaId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "precoPromocionalCentavos" INTEGER,
    "mensagem" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ItemDeOrderBump_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemDeOrderBump_companyId_ativo_idx" ON "ItemDeOrderBump"("companyId", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "ItemDeOrderBump_companyId_tipo_referenciaId_key" ON "ItemDeOrderBump"("companyId", "tipo", "referenciaId");

-- AddForeignKey
ALTER TABLE "ItemDeOrderBump" ADD CONSTRAINT "ItemDeOrderBump_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: o que já estava marcado como sugestão de bump (Servico.sugeridoNoBump
-- / Produto.sugeridoNoBump, sessão 2026-08-17 Parte 1) vira uma linha aqui, sem
-- promoção/mensagem — a vitrine em produção continua exatamente igual depois
-- do deploy. As colunas antigas ficam no banco (deprecadas, ninguém lê) só
-- para rollback seguro; remover numa migration futura.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "ItemDeOrderBump" ("id", "companyId", "tipo", "referenciaId", "ativo", "ordem")
SELECT gen_random_uuid()::text, s."companyId", 'SERVICO'::"TipoItemDeOrderBump", s."id", true, 0
FROM "Servico" s
WHERE s."sugeridoNoBump" = true
ON CONFLICT ("companyId", "tipo", "referenciaId") DO NOTHING;

INSERT INTO "ItemDeOrderBump" ("id", "companyId", "tipo", "referenciaId", "ativo", "ordem")
SELECT gen_random_uuid()::text, p."companyId", 'PRODUTO'::"TipoItemDeOrderBump", p."id", true, 0
FROM "Produto" p
WHERE p."sugeridoNoBump" = true
ON CONFLICT ("companyId", "tipo", "referenciaId") DO NOTHING;

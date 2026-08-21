-- Bigod's Club: status de membro + log append-only de transições (2026-08-21).
--
-- ADITIVA. Nenhuma coluna existente muda de tipo, nada é apagado, e o status do
-- cliente NÃO ganha coluna nenhuma — ele é sempre calculado (`statusDoClube`).

-- ── 1. Quando o atendimento foi MARCADO ──────────────────────────────────────
-- Distinto de `inicio` (quando ele acontece). O status do clube depende disto:
-- um avulso marcado por quem TINHA crédito não pode rebaixá-lo depois, e usar
-- `inicio` faria exatamente isso quando o avulso estivesse agendado pra frente.
--
-- Backfill com `inicio`: é a melhor aproximação possível para as linhas antigas,
-- porque a informação real (o instante do clique) nunca foi gravada. Assumir
-- `now()` para o histórico seria pior — diria que todo atendimento passado foi
-- marcado hoje, e isso mudaria o status de quem já é membro.
ALTER TABLE "Atendimento" ADD COLUMN "criadoEm" TIMESTAMPTZ(3);
UPDATE "Atendimento" SET "criadoEm" = "inicio" WHERE "criadoEm" IS NULL;
ALTER TABLE "Atendimento" ALTER COLUMN "criadoEm" SET NOT NULL;
ALTER TABLE "Atendimento" ALTER COLUMN "criadoEm" SET DEFAULT now();

-- ── 2. Log append-only das transições ────────────────────────────────────────
-- `CREATE TYPE` e uso na mesma transação é permitido no Postgres; a restrição
-- que exige migration separada vale só para `ALTER TYPE ... ADD VALUE`.
CREATE TYPE "TipoEventoClube" AS ENUM ('ENTROU_CLUBE', 'VIROU_INATIVO', 'SAIU_CLUBE', 'RENOVOU');

CREATE TABLE "EventoDoClube" (
  "id"             TEXT NOT NULL,
  "companyId"      TEXT NOT NULL,
  "clienteId"      TEXT NOT NULL,
  "tipo"           "TipoEventoClube" NOT NULL,
  "statusAnterior" TEXT NOT NULL,
  "statusNovo"     TEXT NOT NULL,
  "causa"          TEXT NOT NULL,
  "ocorridoEm"     TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "EventoDoClube_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventoDoClube_clienteId_ocorridoEm_idx" ON "EventoDoClube"("clienteId", "ocorridoEm");
CREATE INDEX "EventoDoClube_companyId_tipo_idx" ON "EventoDoClube"("companyId", "tipo");

ALTER TABLE "EventoDoClube"
  ADD CONSTRAINT "EventoDoClube_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

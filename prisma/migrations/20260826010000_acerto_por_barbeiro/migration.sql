-- ACERTO POR BARBEIRO (2026-08-26): caixinha e desconto deixam de ser derivados
-- e viram percentuais CONFIGURÁVEIS por barbeiro, editáveis pelo admin.
--
-- Antes:
--   caixinha  → 100% do barbeiro, cravado no código;
--   desconto  → o barbeiro absorvia a fração da COMISSÃO dele, rateada por
--               linha da comanda (serviço a 45%, produto à taxa da empresa…).
--
-- Agora os dois saem destes campos, e só deles.
--
-- ★ O BACKFILL PRESERVA O COMPORTAMENTO DE HOJE, barbeiro a barbeiro:
--
--   percentualCaixinhaBp = 10000 (100%)  → exatamente o que era cravado;
--   percentualDescontoBp = comissaoPadraoBp → o mesmo número que o rateio
--       derivava para a comanda comum (um serviço, sem exceção). Quem tinha
--       exceção por serviço vai divergir um pouco a partir de agora — é a
--       consequência aceita de trocar um cálculo por linha por um percentual
--       único, e o admin ajusta na tela se quiser outro valor.
--
-- Ninguém acorda com número diferente por causa desta migration; o que muda é
-- que agora dá para mudar.
ALTER TABLE "Barbeiro" ADD COLUMN "percentualCaixinhaBp" INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE "Barbeiro" ADD COLUMN "percentualDescontoBp" INTEGER NOT NULL DEFAULT 0;

UPDATE "Barbeiro" SET "percentualDescontoBp" = "comissaoPadraoBp";

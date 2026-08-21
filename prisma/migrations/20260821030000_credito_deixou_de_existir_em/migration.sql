-- Instante REAL em que um crédito de pacote deixou de existir (2026-08-21).
--
-- ADITIVA: uma coluna nullable, nada muda de tipo, nada é apagado.
--
-- POR QUE: o status do Bigod's Club (§4.5) precisa saber quando o cliente ficou
-- sem crédito, para decidir se um avulso posterior significa "não vou renovar".
-- A primeira versão derivava isso do `fim` do atendimento que consumiu o
-- crédito — e isso está ERRADO sempre que a conclusão não acontece no horário
-- marcado. Concluir antes do horário é rotina (§4.1, conclusão antecipada) e o
-- admin sempre pôde: concluir hoje quatro atendimentos marcados pra semana que
-- vem fazia os créditos "morrerem" na semana que vem, e nenhum avulso marcado
-- no meio rebaixava o cliente. Bug reportado em produção.
ALTER TABLE "ItemDoPacote" ADD COLUMN "deixouDeExistirEm" TIMESTAMPTZ(3);

-- Backfill do histórico. O instante real não foi gravado, então usamos o melhor
-- disponível — e para o caso que gerou o bug (atendimento concluído com `fim`
-- no futuro) limitamos a AGORA: se o crédito já está consumido, ele morreu no
-- máximo agora, nunca depois.
UPDATE "ItemDoPacote" i
   SET "deixouDeExistirEm" = LEAST(a."fim", now())
  FROM "Atendimento" a
 WHERE i."atendimentoId" = a."id"
   AND i."status" = 'CONSUMIDO'
   AND i."deixouDeExistirEm" IS NULL;

-- Expirado: o prazo é o instante que o matou, e ele já é um instante absoluto.
UPDATE "ItemDoPacote"
   SET "deixouDeExistirEm" = "prazoReagendamentoAte"
 WHERE "status" = 'EXPIRADO'
   AND "prazoReagendamentoAte" IS NOT NULL
   AND "deixouDeExistirEm" IS NULL;

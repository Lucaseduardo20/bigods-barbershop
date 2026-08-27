-- REATRIBUIR O BARBEIRO DE UM ATENDIMENTO (2026-08-27).
--
-- Caso real de produção: o cliente agenda com o barbeiro A, mas quem atende é o
-- B (A ficou ocupado, o cliente aceitou trocar). A comissão ia parar no nome
-- errado e desbalanceava o financeiro.
--
-- Auditoria da troca feita ANTES de concluir: de quem era, quem transferiu e
-- quando. Todas nuláveis — atendimento que nunca trocou de mãos não tem nada
-- aqui, e `null` é exatamente isso.
--
-- `barbeiroId` continua sendo a verdade sobre quem atende; estas colunas são o
-- rastro de que ele mudou, e é o que responde "por que a comissão deste
-- atendimento é do B se o cliente marcou com o A?".
ALTER TABLE "Atendimento" ADD COLUMN "reatribuidoDeId" TEXT;
ALTER TABLE "Atendimento" ADD COLUMN "reatribuidoPorId" TEXT;
ALTER TABLE "Atendimento" ADD COLUMN "reatribuidoEm" TIMESTAMPTZ(3);

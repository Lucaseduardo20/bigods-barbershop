-- FASE 4 (2026-08-25): o admin reativa um agendamento cancelado por engano,
-- pelo painel — tirando o UPDATE na mão do banco, que foi o que aconteceu em
-- produção quando um agendamento do PAI do cliente foi cancelado achando que
-- era duplicata.
--
-- Auditoria: quem reativou e quando. Sem isto, um atendimento que voltou do
-- cancelamento é indistinguível de um que nunca foi cancelado — e "quem
-- ressuscitou este atendimento?" precisa ter resposta, porque a operação
-- devolve dinheiro (comissão) ao ledger quando ele for concluído.
--
-- `motivoCancelamento` NÃO é apagado: é o registro do que aconteceu. Os três
-- campos juntos contam a história inteira — foi cancelado por X, e Y trouxe de
-- volta em Z.
ALTER TABLE "Atendimento" ADD COLUMN "reativadoPorId" TEXT;
ALTER TABLE "Atendimento" ADD COLUMN "reativadoEm" TIMESTAMPTZ(3);

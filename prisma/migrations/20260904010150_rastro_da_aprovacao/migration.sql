-- Rastro da decisão humana (contingência de OTP, 2026-09-04).
--
-- Quem aprovou (ou recusou) um agendamento que entrou sem verificação de
-- telefone, e quando. É uma decisão de gente no lugar de uma trava automática;
-- daqui a um mês alguém vai querer saber de quem foi.
--
-- ADITIVA: duas colunas nuláveis. NULL em todo atendimento que nunca passou
-- pela contingência — que é a esmagadora maioria.
ALTER TABLE "Atendimento" ADD COLUMN IF NOT EXISTS "aprovadoPorId" TEXT;
ALTER TABLE "Atendimento" ADD COLUMN IF NOT EXISTS "aprovadoEm" TIMESTAMPTZ(3);

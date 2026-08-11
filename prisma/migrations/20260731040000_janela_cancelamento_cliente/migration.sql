-- sessão-E, FASE 2: janela (em horas) até a qual o CLIENTE pode cancelar o
-- próprio agendamento sozinho pelo cockpit. Aditiva, com default seguro (2h).
ALTER TABLE "Company" ADD COLUMN "janelaCancelamentoHoras" INTEGER NOT NULL DEFAULT 2;

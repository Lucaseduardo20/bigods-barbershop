-- sessão-E, FASE 3: janela (em horas) até a qual o CLIENTE pode reagendar o
-- próprio agendamento sozinho pelo cockpit. Aditiva, com default seguro (12h).
ALTER TABLE "Company" ADD COLUMN "janelaReagendamentoHoras" INTEGER NOT NULL DEFAULT 12;

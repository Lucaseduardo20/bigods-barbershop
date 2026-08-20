-- Sessão de OTP+reserva (Problema 2): a rede de segurança física contra
-- sobreposição (DOMAIN.md §2.1) precisa cobrir RESERVADO também, não só
-- AGENDADO — senão duas reservas temporárias concorrentes pro mesmo horário
-- poderiam ambas ser criadas (a invariante do domínio já barra isso em
-- memória, mas sob concorrência real quem barra de verdade é o banco).
ALTER TABLE "Atendimento" DROP CONSTRAINT IF EXISTS atendimento_sem_sobreposicao;

ALTER TABLE "Atendimento"
  ADD CONSTRAINT atendimento_sem_sobreposicao
  EXCLUDE USING gist (
    "barbeiroId" WITH =,
    tstzrange("inicio", "fim", '[)') WITH &&
  )
  WHERE (status = 'AGENDADO' OR status = 'RESERVADO');

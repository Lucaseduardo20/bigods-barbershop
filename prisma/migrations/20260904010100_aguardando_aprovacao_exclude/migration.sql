-- CONTINGÊNCIA DE OTP (2026-09-04) — o novo estado passa a OCUPAR horário.
--
-- Dois pedidos para o mesmo horário não podem ambos ficar esperando aprovação:
-- aprovar o segundo derrubaria o primeiro, e o cliente que agendou antes
-- descobriria só na cadeira. Enquanto espera decisão, o horário é dele.
--
-- A recusa (AGUARDANDO_APROVACAO → CANCELADO) libera o horário, exatamente como
-- a recusa de conclusão antecipada devolve o atendimento para AGENDADO.
ALTER TABLE "Atendimento" DROP CONSTRAINT IF EXISTS atendimento_sem_sobreposicao;

ALTER TABLE "Atendimento"
  ADD CONSTRAINT atendimento_sem_sobreposicao
  EXCLUDE USING gist (
    "barbeiroId" WITH =,
    tstzrange("inicio", "fim", '[)') WITH &&
  )
  WHERE (
    status = 'AGENDADO'
    OR status = 'RESERVADO'
    OR status = 'CONCLUSAO_PENDENTE'
    OR status = 'AGUARDANDO_APROVACAO'
  );


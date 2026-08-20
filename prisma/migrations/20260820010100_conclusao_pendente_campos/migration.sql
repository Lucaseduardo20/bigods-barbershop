-- Campos da conclusão antecipada + a constraint EXCLUDE passando a cobrir o
-- estado novo (2026-08-20).
--
-- ADITIVA: quatro colunas nulláveis, sem default, sem backfill.
ALTER TABLE "Atendimento" ADD COLUMN "conclusaoAntecipadaMotivo" TEXT;
ALTER TABLE "Atendimento" ADD COLUMN "conclusaoSolicitadaPorId" TEXT;
ALTER TABLE "Atendimento" ADD COLUMN "conclusaoSolicitadaEm" TIMESTAMPTZ(3);
ALTER TABLE "Atendimento" ADD COLUMN "conclusaoFormaPagamento" "FormaPagamento";

-- ★ CONCLUSAO_PENDENTE precisa entrar na rede de proteção física contra
-- sobreposição. Sem isto, o horário de um atendimento com conclusão pendente
-- ficaria livre para outro cliente — e a RECUSA (que devolve o atendimento pra
-- AGENDADO) não teria para onde voltar, ou voltaria sobrepondo o novo.
ALTER TABLE "Atendimento" DROP CONSTRAINT IF EXISTS atendimento_sem_sobreposicao;

ALTER TABLE "Atendimento"
  ADD CONSTRAINT atendimento_sem_sobreposicao
  EXCLUDE USING gist (
    "barbeiroId" WITH =,
    tstzrange("inicio", "fim", '[)') WITH &&
  )
  WHERE (status = 'AGENDADO' OR status = 'RESERVADO' OR status = 'CONCLUSAO_PENDENTE');

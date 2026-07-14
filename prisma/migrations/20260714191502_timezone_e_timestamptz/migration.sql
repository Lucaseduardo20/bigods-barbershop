-- Timezone é propriedade da Company (IANA), não constante global. Validado
-- como IANA válido na borda (VO Timezone do domínio), não por constraint de banco.
ALTER TABLE "Company" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- A constraint EXCLUDE usa tsrange() sobre inicio/fim; tsrange() só aceita
-- "timestamp without time zone". Precisa ser removida antes de converter as
-- colunas e recriada com tstzrange() depois.
ALTER TABLE "Atendimento" DROP CONSTRAINT IF EXISTS atendimento_sem_sobreposicao;

-- Todas as colunas de data/hora viram timestamptz (estavam, incorretamente,
-- "timestamp without time zone"). Os valores existentes já são instantes UTC
-- (é assim que a aplicação sempre os escreveu) — por isso a conversão usa
-- "AT TIME ZONE 'UTC'" explicitamente, em vez do cast implícito do Postgres
-- (que reinterpretaria os valores conforme o TimeZone da sessão da migration,
-- podendo deslocá-los se essa sessão não estiver em UTC).
ALTER TABLE "Atendimento"
  ALTER COLUMN "inicio" TYPE TIMESTAMPTZ(3) USING "inicio" AT TIME ZONE 'UTC',
  ALTER COLUMN "fim"    TYPE TIMESTAMPTZ(3) USING "fim"    AT TIME ZONE 'UTC';

ALTER TABLE "Disponibilidade"
  ALTER COLUMN "inicio" TYPE TIMESTAMPTZ(3) USING "inicio" AT TIME ZONE 'UTC',
  ALTER COLUMN "fim"    TYPE TIMESTAMPTZ(3) USING "fim"    AT TIME ZONE 'UTC';

ALTER TABLE "ItemDoPacote"
  ALTER COLUMN "prazoReagendamentoAte" TYPE TIMESTAMPTZ(3) USING "prazoReagendamentoAte" AT TIME ZONE 'UTC';

ALTER TABLE "LancamentoComissao"
  ALTER COLUMN "ocorridoEm" TYPE TIMESTAMPTZ(3) USING "ocorridoEm" AT TIME ZONE 'UTC';

ALTER TABLE "VendaDePacote"
  ALTER COLUMN "compradoEm" TYPE TIMESTAMPTZ(3) USING "compradoEm" AT TIME ZONE 'UTC';

-- Recria a rede de segurança física contra sobreposição (DOMAIN.md §2.1),
-- agora com tstzrange sobre colunas timestamptz. A regra em si não muda:
-- sobreposição é sobreposição em qualquer fuso, porque compara instantes
-- absolutos — só o tipo de coluna estava errado.
ALTER TABLE "Atendimento"
  ADD CONSTRAINT atendimento_sem_sobreposicao
  EXCLUDE USING gist (
    "barbeiroId" WITH =,
    tstzrange("inicio", "fim", '[)') WITH &&
  )
  WHERE (status = 'AGENDADO');

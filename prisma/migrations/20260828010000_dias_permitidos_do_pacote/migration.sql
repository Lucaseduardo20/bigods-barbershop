-- DIAS EM QUE UM CRÉDITO DE PACOTE PODE SER USADO (2026-08-28).
--
-- Pacote econômico (4 cortes por R$145) não deveria consumir a agenda de sexta e
-- sábado: o preço baixo não se justifica no horário mais disputado da casa.
--
-- DUAS colunas, e não uma, porque são dois fatos diferentes:
--
--   PacoteOferta.diasPermitidos   a regra ATUAL do catálogo, que o admin edita;
--   VendaDePacote.diasPermitidos  o SNAPSHOT do que o cliente comprou.
--
-- Mudar a oferta depois NÃO pode mexer no que já foi vendido — mesma disciplina
-- do rateio congelado (§3.6) e do `valorCobrado` do atendimento (§3.5). Quem
-- comprou sem restrição continua sem restrição, para sempre.
--
-- DEFAULT com os sete dias: toda oferta e toda venda que já existem passam a
-- valer "qualquer dia", que é exatamente o que valia antes desta regra. Ninguém
-- perde um crédito por causa desta migration.
--
-- Convenção 0=domingo … 6=sábado, a mesma de `Date.getUTCDay()` e de
-- `diaDaSemanaCivil`.
ALTER TABLE "PacoteOferta"
  ADD COLUMN "diasPermitidos" INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6];

ALTER TABLE "VendaDePacote"
  ADD COLUMN "diasPermitidos" INTEGER[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6];

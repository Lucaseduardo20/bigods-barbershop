-- SENHA DO CLIENTE + AUDITORIA DE OTP (2026-08-28).
--
-- Incidente que trouxe isto: o provedor de SMS não entrega mais que ~2 códigos
-- por número em curto período (confirmado no painel deles). Como o login do
-- cliente era 100% OTP, quem precisava de um segundo código no mesmo dia ficava
-- trancado para fora da própria conta.
--
-- A saída é reduzir o OTP ao mínimo: ele passa a existir só onde prova posse do
-- telefone (confirmar agendamento) e no "esqueci a senha". O login do dia a dia
-- vira telefone + senha, que não gasta SMS nenhum.
--
-- ADITIVA em tudo: duas colunas nuláveis e um tipo novo. Nada é reescrito,
-- nada é removido, e a API anterior continua funcionando com este banco
-- durante a janela de deploy — cliente sem senha (`senhaHash IS NULL`) é
-- exatamente o estado de todo mundo hoje, e continua entrando por OTP.

-- Hash no MESMO formato do login de staff (`sal:hash`, scrypt) — o motor é o
-- mesmo módulo `senha.ts`. NULL = ainda não definiu senha.
ALTER TABLE "Cliente" ADD COLUMN "senhaHash" TEXT;

-- ★ AUDITORIA: para que serviu cada código enviado.
--
-- A tabela já registrava o essencial (`criadoEm`, `consumidoEm`, `tentativas`)
-- e o código sempre esteve hasheado — nunca houve, e não passa a haver, código
-- em claro em lugar nenhum. O que faltava era a FINALIDADE: quando um cliente
-- liga dizendo "não recebi", o dono precisa saber se o código era de
-- recuperação de senha (caminho raro, e o que dói) ou da confirmação de um
-- agendamento.
CREATE TYPE "FinalidadeOtp" AS ENUM ('CONFIRMAR_AGENDAMENTO', 'RECUPERAR_SENHA', 'ACESSO_A_CONTA');

-- NULL nos desafios que já existem: eles são anteriores a esta distinção, e
-- inventar uma finalidade para eles seria inventar dado.
ALTER TABLE "DemoDesafioLogin" ADD COLUMN "finalidade" "FinalidadeOtp";

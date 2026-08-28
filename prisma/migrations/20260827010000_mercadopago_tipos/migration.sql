-- Mercado Pago (Orders API) — FASE 1b: SÓ os tipos. (2026-08-27)
--
-- Os valores de enum EXISTENTE vêm numa migration SEPARADA da que os USA, de
-- propósito: no Postgres, um valor criado por `ALTER TYPE ... ADD VALUE` não
-- pode ser utilizado na MESMA transação em que foi criado, e o Prisma roda cada
-- migration numa transação. Já queimamos essa lição duas vezes
-- (20260820010000_conclusao_pendente_enum e 20260825020000_caixinha_desconto_enums).
--
-- `CREATE TYPE` não tem essa restrição — poderia ir junto com o uso. Está aqui
-- só para manter "toda mudança de tipo numa migration, toda mudança de tabela na
-- seguinte", que é mais fácil de revisar do que a regra do Postgres.
--
-- ADITIVA: nenhum valor é removido nem renomeado, nenhuma tabela é tocada.

-- ── Novos tipos ──────────────────────────────────────────────────────────────

-- Qual adapter criou a cobrança. Com dois gateways reais a conviver, um webhook
-- do Mercado Pago não pode confirmar uma intenção criada pela AbacatePay — e o
-- estorno precisa saber para qual gateway ligar.
CREATE TYPE "ProvedorPagamento" AS ENUM ('ABACATEPAY', 'MERCADOPAGO', 'FAKE');

-- Meio de uma tentativa. Débito NÃO entra: no Brasil o Checkout Transparente só
-- oferece débito virtual Caixa (Elo), e o dono tirou débito do escopo.
CREATE TYPE "MeioDePagamentoOnline" AS ENUM ('PIX', 'CARTAO_CREDITO');

-- ── Valores novos em tipos existentes ────────────────────────────────────────

-- Cartão em análise pelo emissor: `status=processing` / `status_detail=in_process`
-- na Orders API. Não é AGUARDANDO (o cliente já fez a parte dele) nem FALHOU.
-- O desafio 3DS (`pending_challenge`) NÃO usa este valor — ali o cliente ainda
-- tem ação a tomar e a janela de 30 min segue correndo, então é AGUARDANDO.
ALTER TYPE "StatusPagamento" ADD VALUE IF NOT EXISTS 'EM_ANALISE';

-- Estorno decidido pelo admin mas com execução AGENDADA (default 31 dias).
ALTER TYPE "StatusSolicitacaoReembolso" ADD VALUE IF NOT EXISTS 'AGENDADO';

-- A execução agendada chamou o gateway e falhou. Motivo mais provável: saldo
-- insuficiente na conta do Mercado Pago no dia da execução — a doc é explícita
-- que o estorno exige saldo disponível, e a operação saca o saldo para pagar
-- barbeiro. Sem este estado o estorno sumiria em silêncio (followup.md #1).
ALTER TYPE "StatusSolicitacaoReembolso" ADD VALUE IF NOT EXISTS 'FALHOU';

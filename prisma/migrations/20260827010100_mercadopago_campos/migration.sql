-- Mercado Pago (Orders API) — FASE 1a: colunas e tabela de tentativas. (2026-08-27)
--
-- ADITIVA. Toda coluna nova em tabela existente é NULÁVEL (ou tem DEFAULT), sem
-- backfill: o sistema já roda em produção e nenhuma linha antiga tem esses
-- dados. NULL aqui significa "não se aplica" — cobrança criada antes desta
-- migration, ou pelo modo manual por WhatsApp, que não chama gateway nenhum.
--
-- Nenhum índice ÚNICO sobre dado existente entra aqui. Os índices parciais que a
-- decisão de concorrência pede (no máximo uma intenção AGUARDANDO por
-- referência) ficam para uma migration própria, DEPOIS de um diagnóstico
-- read-only em produção — se já existirem duplicatas, um CREATE UNIQUE INDEX
-- derruba o deploy. Ver scripts/diagnostico-intencoes-duplicadas.sql.

-- ── 1. IntencaoDePagamento ───────────────────────────────────────────────────

ALTER TABLE "IntencaoDePagamento" ADD COLUMN "gateway" "ProvedorPagamento";

-- Id da cobrança NO GATEWAY. Para o Mercado Pago é o id da order (`ORD01…`) e é
-- a ÚNICA chave que o webhook dele entrega: a notificação traz só `data.id`, sem
-- status e sem o nosso `external_reference`. Sem esta coluna, achar a intenção
-- exigiria um GET na API antes de saber se o evento é sequer nosso.
ALTER TABLE "IntencaoDePagamento" ADD COLUMN "gatewayId" TEXT;

-- `status_detail` cru. O Mercado Pago tem duas camadas de status e ~13
-- combinações; sem o detalhe, AGUARDANDO e EM_ANALISE viram caixa-preta na hora
-- de investigar um pagamento travado. NUNCA vai na resposta pública: `high_risk`
-- e `rejected_by_issuer` ensinariam o fraudador a calibrar a próxima tentativa.
ALTER TABLE "IntencaoDePagamento" ADD COLUMN "statusDetalhe" TEXT;

-- Valor LÍQUIDO, já descontada a taxa do gateway — a comissão do barbeiro passa
-- a incidir sobre ele em todo pagamento online (decisão do dono). O Mercado Pago
-- informa em `paid_amount` (distinto de `amount`); a AbacatePay não expõe
-- líquido em lugar nenhum, e para ela o valor é derivado de taxa configurada.
ALTER TABLE "IntencaoDePagamento" ADD COLUMN "valorLiquidoCentavos" INTEGER;

-- Instante em que o estorno automático foi SOLICITADO (não executado). Gravado
-- ANTES de chamar o gateway, na mesma transação que lê a intenção: é o que
-- impede um webhook reenviado (o Mercado Pago retenta a cada 15 min) de estornar
-- o mesmo pagamento duas vezes. Ver followup.md #4.
ALTER TABLE "IntencaoDePagamento" ADD COLUMN "estornoSolicitadoEm" TIMESTAMPTZ(3);

-- ── 2. SolicitacaoDeReembolso: estorno agendado ──────────────────────────────

-- Quando executar. Default 31 dias, parametrizável POR SOLICITAÇÃO (não
-- configuração global escondida) e 0 = imediato. NULL nas solicitações
-- anteriores, que eram todas manuais.
ALTER TABLE "SolicitacaoDeReembolso" ADD COLUMN "agendadaPara" TIMESTAMPTZ(3);

-- Quando o GATEWAY confirmou. Distinto de `reembolsadaEm`, que registra o ato
-- administrativo de dar por devolvido (o fluxo manual, dinheiro voltando por
-- fora do sistema).
ALTER TABLE "SolicitacaoDeReembolso" ADD COLUMN "executadaEm" TIMESTAMPTZ(3);

-- Prova de que o estorno aconteceu — é o que permite reconciliar sem estornar
-- de novo depois de um crash no meio.
ALTER TABLE "SolicitacaoDeReembolso" ADD COLUMN "gatewayRefundId" TEXT;

-- NOT NULL com DEFAULT 0: "nunca tentou" é zero, não nulo, e assim nenhuma
-- leitura precisa tratar o caso ausente (mesma disciplina de
-- 20260825020100_caixinha_desconto_campos).
ALTER TABLE "SolicitacaoDeReembolso" ADD COLUMN "tentativas" INTEGER NOT NULL DEFAULT 0;

-- Mensagem crua do gateway na última falha. Traduzida para linguagem de operação
-- na tela do admin; nunca mostrada crua ao cliente.
ALTER TABLE "SolicitacaoDeReembolso" ADD COLUMN "ultimoErro" TEXT;

-- O job de estorno agendado varre por (status, agendadaPara) a cada tick. Índice
-- NÃO-único: não pode falhar por dado preexistente.
CREATE INDEX "SolicitacaoDeReembolso_status_agendadaPara_idx"
  ON "SolicitacaoDeReembolso"("status", "agendadaPara");

-- ── 3. TentativaDePagamento ──────────────────────────────────────────────────
--
-- Uma intenção pode ter VÁRIAS tentativas: cartão recusado permite nova
-- tentativa (o cliente troca de cartão, sem renovar a janela de 30 min), e cada
-- tentativa é uma order NOVA no Mercado Pago com uma chave de idempotência NOVA
-- — porque reenviar a mesma chave devolve HTTP 409 `idempotency_key_already_used`,
-- não a order original: a Orders API não tem semântica de replay.
--
-- Se `gatewayId`/`idempotencyKey` morassem em IntencaoDePagamento, a segunda
-- tentativa sobrescreveria a primeira e um webhook atrasado da primeira order
-- não encontraria vínculo. Criar isto depois custaria migration de dados com
-- pagamentos reais em produção.
CREATE TABLE "TentativaDePagamento" (
  "id"                    TEXT NOT NULL,
  "companyId"             TEXT NOT NULL,
  "intencaoDePagamentoId" TEXT NOT NULL,
  "gateway"               "ProvedorPagamento" NOT NULL,
  -- NULL entre o INSERT e a resposta do gateway: a linha nasce ANTES da chamada
  -- HTTP, para que um crash no meio deixe rastro em vez de uma order órfã.
  "gatewayId"             TEXT,
  "idempotencyKey"        TEXT NOT NULL,
  "meio"                  "MeioDePagamentoOnline" NOT NULL,
  "status"                "StatusPagamento" NOT NULL,
  "statusDetalhe"         TEXT,
  "valorLiquidoCentavos"  INTEGER,
  "criadaEm"              TIMESTAMPTZ(3) NOT NULL,
  "atualizadaEm"          TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "TentativaDePagamento_pkey" PRIMARY KEY ("id")
);

-- Transforma "nunca reutilizar a chave de idempotência" de convenção em
-- invariante de banco. Tabela NOVA e vazia: não há como falhar por dado antigo.
CREATE UNIQUE INDEX "TentativaDePagamento_idempotencyKey_key"
  ON "TentativaDePagamento"("idempotencyKey");

-- A mesma order não pode ser vinculada a duas tentativas. NULLs são distintos no
-- Postgres, então várias tentativas ainda sem `gatewayId` convivem — que é
-- exatamente o desejado.
CREATE UNIQUE INDEX "TentativaDePagamento_gateway_gatewayId_key"
  ON "TentativaDePagamento"("gateway", "gatewayId");

CREATE INDEX "TentativaDePagamento_intencaoDePagamentoId_idx"
  ON "TentativaDePagamento"("intencaoDePagamentoId");

CREATE INDEX "TentativaDePagamento_companyId_status_idx"
  ON "TentativaDePagamento"("companyId", "status");

ALTER TABLE "TentativaDePagamento"
  ADD CONSTRAINT "TentativaDePagamento_intencaoDePagamentoId_fkey"
  FOREIGN KEY ("intencaoDePagamentoId") REFERENCES "IntencaoDePagamento"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

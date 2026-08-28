-- Diagnóstico READ-ONLY: existem duas IntencaoDePagamento AGUARDANDO para a
-- mesma referência? (2026-08-27, Mercado Pago FASE 1c)
--
-- POR QUE ISTO EXISTE
--
-- A decisão de concorrência do plano é "no máximo uma IntencaoDePagamento
-- AGUARDANDO por referência", e a trava correta é um índice parcial ÚNICO no
-- Postgres. Só que o sistema roda em produção HOJE sem essa trava, e o fluxo
-- "alterar pedido" do funil cria intenção nova sem garantia de matar a anterior.
-- Se já houver duplicata, o `CREATE UNIQUE INDEX` FALHA e derruba o deploy —
-- e migration que trava deploy num sistema de pagamento é o pior momento
-- possível para descobrir isso.
--
-- Este script não altera NADA. Rode antes da migration de índices.
--
-- COMO RODAR
--
--   psql "$DATABASE_URL" -f scripts/diagnostico-intencoes-duplicadas.sql
--
-- COMO LER O RESULTADO
--
--   Se as duas primeiras consultas voltarem VAZIAS, está liberado: crie a
--   migration de índices parciais e siga.
--   Se voltarem linhas, NÃO crie o índice ainda — decida com o dono o que fazer
--   com cada duplicata (a candidata natural é expirar a mais antiga, mas isso é
--   mutação de dado financeiro em produção e não se faz sem decisão explícita).

\echo ''
\echo '=== 1. ATENDIMENTO com mais de uma intenção AGUARDANDO ==='
SELECT
  "atendimentoId",
  count(*)                              AS intencoes_aguardando,
  min("expiraEm")                       AS expira_primeira,
  max("expiraEm")                       AS expira_ultima,
  string_agg("id", ', ' ORDER BY "id")  AS ids
FROM "IntencaoDePagamento"
WHERE "status" = 'AGUARDANDO'
  AND "atendimentoId" IS NOT NULL
GROUP BY "atendimentoId"
HAVING count(*) > 1
ORDER BY count(*) DESC;

\echo ''
\echo '=== 2. VENDA_DE_PACOTE com mais de uma intenção AGUARDANDO ==='
SELECT
  "vendaDePacoteId",
  count(*)                              AS intencoes_aguardando,
  min("expiraEm")                       AS expira_primeira,
  max("expiraEm")                       AS expira_ultima,
  string_agg("id", ', ' ORDER BY "id")  AS ids
FROM "IntencaoDePagamento"
WHERE "status" = 'AGUARDANDO'
  AND "vendaDePacoteId" IS NOT NULL
GROUP BY "vendaDePacoteId"
HAVING count(*) > 1
ORDER BY count(*) DESC;

\echo ''
\echo '=== 3. Contexto: distribuição de status (para saber o tamanho do problema) ==='
SELECT
  "status",
  count(*)                                                          AS total,
  count(*) FILTER (WHERE "expiraEm" IS NOT NULL AND "expiraEm" < now()) AS vencidas_por_tempo
FROM "IntencaoDePagamento"
GROUP BY "status"
ORDER BY total DESC;

\echo ''
\echo '=== 4. Quantas AGUARDANDO já passaram do prazo (candidatas naturais a EXPIRADO) ==='
-- Estas são inofensivas: o próprio sistema as expiraria na próxima leitura de
-- status (ExpirarPagamentoVencidoUseCase, disparado pelo polling do funil). Se
-- TODA duplicata das consultas 1 e 2 estiver aqui, o saneamento é só aplicar a
-- regra que já existe, e não uma decisão nova.
SELECT count(*) AS aguardando_vencidas
FROM "IntencaoDePagamento"
WHERE "status" = 'AGUARDANDO'
  AND "expiraEm" IS NOT NULL
  AND "expiraEm" < now();

\echo ''
\echo '=== FIM. Consultas 1 e 2 vazias => liberado para criar os índices parciais. ==='

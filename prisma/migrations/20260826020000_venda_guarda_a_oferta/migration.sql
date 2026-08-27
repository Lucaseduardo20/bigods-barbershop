-- A VENDA PASSA A LEMBRAR DE QUAL OFERTA VEIO (2026-08-26).
--
-- A conta do cliente mostrava "Pacote", genérico, porque o nome não existia em
-- lugar nenhum: `VenderPacoteUseCase` recebe a oferta já EXPANDIDA em
-- `servicoIds`, e o nome ("Combo 4 Cortes Simples") se perdia no caminho.
--
-- `nomeOferta` é SNAPSHOT, não join: renomear a oferta no catálogo não pode
-- reescrever o que o cliente comprou (§3.5). `ofertaId` fica ao lado só como
-- rastro — para relatório e para saber de onde veio.
ALTER TABLE "VendaDePacote" ADD COLUMN "ofertaId" TEXT;
ALTER TABLE "VendaDePacote" ADD COLUMN "nomeOferta" TEXT;

-- ★ BACKFILL das vendas que já existem, por COMPOSIÇÃO.
--
-- Sem `ofertaId` gravado, a única pista é o conjunto de serviços vendidos. Uma
-- venda casa com uma oferta quando as duas expandem exatamente na mesma
-- multiset de serviços (mesmos ids, mesmas quantidades).
--
-- A regra é deliberadamente CONSERVADORA: só preenche quando existe UMA única
-- oferta compatível. Havendo duas ofertas com a mesma composição e nomes
-- diferentes ("Combo 4 Cortes" e "Promo 4 Cortes"), não há como saber qual foi
-- — e chutar escreveria no histórico do cliente um nome que ele nunca viu.
-- Nesses casos fica NULL, e a tela cai no rótulo derivado da composição.
WITH composicao_da_venda AS (
  SELECT i."vendaId" AS venda_id,
         array_agg(i."servicoId" ORDER BY i."servicoId") AS servicos
  FROM "ItemDoPacote" i
  GROUP BY i."vendaId"
),
composicao_da_oferta AS (
  -- `generate_series` expande a quantidade: 4 cortes viram quatro linhas, do
  -- mesmo jeito que a venda os materializou em quatro ItemDoPacote.
  SELECT oi."ofertaId" AS oferta_id,
         array_agg(oi."servicoId" ORDER BY oi."servicoId") AS servicos
  FROM (
    SELECT pi."ofertaId", pi."servicoId"
    FROM "PacoteOfertaItem" pi,
         generate_series(1, pi."quantidade")
  ) oi
  GROUP BY oi."ofertaId"
),
match_unico AS (
  SELECT cv.venda_id,
         MIN(co.oferta_id) AS oferta_id,
         COUNT(*)          AS candidatas
  FROM composicao_da_venda cv
  JOIN composicao_da_oferta co ON co.servicos = cv.servicos
  GROUP BY cv.venda_id
  HAVING COUNT(*) = 1
)
UPDATE "VendaDePacote" v
SET "ofertaId"  = o.id,
    "nomeOferta" = o.nome
FROM match_unico m
JOIN "PacoteOferta" o ON o.id = m.oferta_id
WHERE v.id = m.venda_id;

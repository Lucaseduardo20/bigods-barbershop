-- Refina o backfill de `ItemDoPacote.deixouDeExistirEm` (2026-08-21).
--
-- A migration anterior usou `LEAST(atendimento.fim, now())` — correto no
-- limite, mas grosseiro: para todo crédito consumido com atendimento marcado no
-- futuro, ela gravou "agora" (o instante da própria migration). Consequência
-- prática: um avulso marcado ANTES da migration passa a parecer anterior à morte
-- do crédito, e o cliente fica MEMBRO_INATIVO quando deveria ser NAO_MEMBRO.
--
-- Existe fonte melhor, e ela já estava no banco: `LancamentoComissao` é criado
-- NA CONCLUSÃO do atendimento (handler de AtendimentoConcluido), então o seu
-- `ocorridoEm` é o instante real em que o crédito foi consumido. Usamos o menor
-- lançamento de cada atendimento — todos os créditos de uma visita são
-- consumidos na mesma transação.
--
-- Onde não há lançamento (atendimento sem comissão registrada), o valor da
-- migration anterior fica como está: não há de onde tirar nada melhor.
UPDATE "ItemDoPacote" i
   SET "deixouDeExistirEm" = lc."quando"
  FROM (
    SELECT "atendimentoId", MIN("ocorridoEm") AS "quando"
      FROM "LancamentoComissao"
     WHERE "atendimentoId" IS NOT NULL
     GROUP BY "atendimentoId"
  ) lc
 WHERE i."atendimentoId" = lc."atendimentoId"
   AND i."status" = 'CONSUMIDO';

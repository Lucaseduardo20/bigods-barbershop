# Decisões Pendentes

Regras de negócio não cobertas pela spec (DOMAIN.md / CLAUDE.md). Implementado o mínimo que não bloqueia; confirmar com o negócio.

## 1. O que é "cancelamento antecipado" de um item de pacote?

O diagrama §4.2 distingue "cancela ANTES do prazo limite (não conta falta)" de "cancelamento tardio (conta falta)", mas o prazo limite não está definido em lugar nenhum.

**Mínimo implementado:** cancelamento feito **antes do horário de início do atendimento** é antecipado (libera o item sem falta); cancelamento após o início, ou não-comparecimento, conta falta. Ver `cancelar-atendimento.usecase.ts`.

## 2. Retorno de item em segunda chance após cancelamento antecipado

O diagrama §4.2 mostra o cancelamento antecipado devolvendo o item a `DISPONIVEL`. Se o item já tinha 1 falta (estava em `SEGUNDA_CHANCE` e foi reagendado), voltar a `DISPONIVEL` apagaria o prazo — o cliente escaparia da expiração agendando e cancelando em loop.

**Mínimo implementado:** com `faltasComputadas == 1`, o cancelamento antecipado devolve o item a `SEGUNDA_CHANCE` preservando `prazoReagendamentoAte`. Ver `VendaDePacote.liberarItem` (`venda-de-pacote.aggregate.ts`).

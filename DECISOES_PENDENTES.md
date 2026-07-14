# Decisões Pendentes

Regras de negócio não cobertas pela spec (DOMAIN.md / CLAUDE.md). Implementado o mínimo que não bloqueia; confirmar com o negócio.

## 1. O que é "cancelamento antecipado" de um item de pacote?

O diagrama §4.2 distinguia "cancela ANTES do prazo limite (não conta falta)" de "cancelamento tardio (conta falta)", mas o prazo limite não estava definido em lugar nenhum.

**Mínimo implementado:** cancelamento feito **antes do horário de início do atendimento** é antecipado (libera o item sem falta); cancelamento após o início, ou não-comparecimento, conta falta. Ver `cancelar-atendimento.usecase.ts`.

Já refletido em `docs/DOMAIN.md` §3.5/§4.2 como a regra vigente — a pendência que resta é confirmar com o negócio se esse é de fato o critério desejado, não a falta de uma regra.

## 2. Retorno de item em segunda chance após cancelamento antecipado

O diagrama §4.2 mostrava o cancelamento antecipado devolvendo o item a `DISPONIVEL` incondicionalmente. Se o item já tinha 1 falta (estava em `SEGUNDA_CHANCE` e foi reagendado), voltar a `DISPONIVEL` apagaria o prazo — o cliente escaparia da expiração agendando e cancelando em loop.

**Mínimo implementado:** com `faltasComputadas == 1`, o cancelamento antecipado devolve o item a `SEGUNDA_CHANCE` preservando `prazoReagendamentoAte`. Ver `VendaDePacote.liberarItem` (`venda-de-pacote.aggregate.ts`).

Já refletido em `docs/DOMAIN.md` §4.2 (diagrama atualizado + nota "Cancelamento antecipado — para onde volta") — a pendência que resta é a mesma: confirmar com o negócio, não falta de documentação.

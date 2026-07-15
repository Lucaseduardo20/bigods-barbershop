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

## 3. Granularidade do grid de horários do funil público

O funil oferece horários de início de 15 em 15 minutos dentro da janela de disponibilidade. A spec não define a granularidade — a listagem de horários livres é uma **projeção** (DOMAIN.md §2.1), não regra de domínio, então isso não bloqueia. Marcado `// DECISAO_PENDENTE` em `horarios-disponiveis-query.service.ts` (`PASSO_MINUTOS`).

**A confirmar com o negócio:** passo de 15 min (atual), alinhamento a horários "redondos" (:00/:30), ou passo = duração do serviço. Como é só leitura, mudar depois é trivial e não afeta invariante (a escrita rejeita qualquer conflito).

## 4. Foto do barbeiro no funil

A etapa de seleção de barbeiro no protótipo mostra foto do profissional, mas o agregado `Barbeiro` (DOMAIN.md §3.2) **não modela foto**. Não inventei um campo de domínio.

**Mínimo implementado:** avatar com iniciais do nome (mesmo componente visual do admin). Se o negócio quiser fotos, entra como um campo novo no agregado/perfil do barbeiro numa sessão futura.

## 5. "1 mês" como período máximo de consulta da agenda

O pedido foi "poder filtrar por período de no máximo 1 mês", sem precisar se é mês-calendário (28–31 dias variável, ex: de 15/fev a 15/mar) ou uma janela fixa de dias corridos.

**Mínimo implementado:** 31 dias corridos fixos, inclusive nas duas pontas (`PERIODO_MAXIMO_DIAS` em `atendimentos.controller.ts`). É uma regra de projeção de leitura (DOMAIN.md §2.1), não invariante de domínio — trivial de ajustar depois se o negócio quiser outro critério.

## 6. "Admins" vs. "barbeiros" no seed — acumulam papel ou não?

O pedido diz "2 admins... e 2 barbeiros fictícios", em contraste com o Gabriel já existente, que acumula `ADMIN`+`BARBEIRO` (é sócio e corta cabelo). Não havia como saber se os 2 novos admins deveriam também atender clientes.

**Mínimo implementado:** LKT e Rafael Grigio têm **só** o papel `ADMIN` — acesso total ao painel, mas não aparecem nos seletores de barbeiro para agendar (comissão padrão 0%, sem `servicosAtendidos`, sem disponibilidade). Os seletores de barbeiro para agendamento (`Agenda`, `Pacotes`) e a lista/filtro de comissão agora filtram por `papeis.includes('BARBEIRO')`, para não oferecer um admin puro como opção de quem vai cortar o cabelo. Se o negócio quiser que LKT/Rafael também atendam, basta adicionar o papel `BARBEIRO` + serviços + disponibilidade (a estrutura já suporta, sem migração).

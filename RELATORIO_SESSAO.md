# Relatório da Sessão — Bigod's Barber v2

Sessão original (2026-07-14): todas as 4 fases concluídas, 84 testes verdes.
Sessão de correção de fuso horário (2026-07-14, continuação): ver seção
dedicada abaixo. **100 testes verdes** (91 de domínio puro + 9 de integração
com Postgres), idênticos sob `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo`.

## Fase 1 — Fundação do monorepo ✅

- npm workspaces + Turborepo (`turbo.json` com pipelines build/test/lint/dev).
- `apps/api` (NestJS 11 + Vitest), `apps/admin` (React 18 + Vite 6 + Tailwind 3), `packages/contracts` (dual CJS/ESM), `packages/config` (tsconfig/prettier compartilhados).
- `apps/booking` e `apps/account`: apenas esqueleto (package.json + index), como pedido.
- `docker-compose.yml` com Postgres 16.

## Fase 2 — Domínio puro ✅

TypeScript puro, **zero import de framework** em `domain/` (verificado por grep).

- VOs: `Dinheiro` (centavos int), `Percentual` (pontos-base int — sem float em comissão), `Telefone` (E.164, chave de reconciliação), `Duracao`, `IntervaloDeTempo` (semiaberto `[inicio, fim)`).
- Agregados: `Servico`, `Barbeiro` (matriz de comissão: padrão + exceções por serviço), `DisponibilidadeBarbeiro`, `Cliente` (promoção a usuário), `Atendimento` (máquina §4.1, invariantes §3.5, snapshot de valores), `VendaDePacote`/`ItemDoPacote` (máquina §4.2, rateio congelado com resíduo no último item, invariante `Σ rateado(não-expirados) + saldoResidual == valorPago` verificada a cada mutação), `LancamentoComissao` (ledger imutável), `IntencaoDePagamento` (confirmação idempotente).
- Eventos §5 completos e interfaces de repositório por módulo.
- Testes de invariante: rateio (incl. casos hostis de arredondamento e fuzz determinístico), TODAS as transições legais/ilegais do item de pacote, comissão (padrão/exceção/base rateada/snapshot), sobreposição de horário.

## Fase 3 — Aplicação + Infraestrutura ✅

- Schema Prisma completo (dinheiro como inteiro de centavos, percentuais em bp) + migration com **`EXCLUDE USING gist`** (btree_gist, `tsrange(inicio, fim, '[)')`, parcial `WHERE status='AGENDADO'`) — verificada no banco.
- Repositórios Prisma com mapeamento explícito (tipos do Prisma não vazam); `UnitOfWork` (porta) + `PrismaUnitOfWork` (`$transaction`) para escritas multi-passo; eventos publicados **após o commit** via EventEmitter.
- Casos de uso §8: agendar avulso (passos 4–6 em uma transação; cobrança PIX opcional), agendar com crédito (**venda + atendimento na mesma transação**, valorCobrado = rateado), concluir (item vira CONSUMIDO na transação; comissão via handler de evento §2.3, idempotente), cancelar (antecipado libera item / tardio computa falta, via handlers §5), não-comparecimento. Job cron diário (03:00) expira itens em SEGUNDA_CHANCE vencidos.
- Auth: interface `AuthProvider` (Cognito pluga aqui depois) + `LocalAuthProvider` (scrypt + token HMAC). **Guard global**: toda rota exige Bearer, exceto `@Publico()` (login, webhook). Papéis por enum via `@Papeis(...)`. Nenhum endpoint de escrita sem guard.
- `PaymentGateway` (porta) + `FakeAbacatePayGateway`; webhook `POST /webhooks/abacatepay` idempotente por `externalId`.
- Seed: Company "bigods", Gabriel (ADMIN+BARBEIRO, 45%, login `gabriel`/`bigods123`), Corte R$40/30min, Barba R$30/20min, 30 dias de disponibilidade (9h–18h UTC), 1 pacote exemplo PAGO (R$60 → rateio 34,29 + 25,71).
- Testes de integração (exigem o Postgres do docker no ar): EXCLUDE rejeita inserções sobrepostas concorrentes (e respeita parcialidade/semiaberto), rollback completo da transação de crédito, webhook processado 2× sem efeito duplo.
- Smoke test manual completo via curl (login → agendar → conflito 422 → concluir → ledger → crédito de pacote → comissão sobre rateado → item CONSUMIDO).

## Fase 4 — Painel admin ✅

Design importado do Claude Design (`ui_kits/admin-panel` + `tokens/*`) via MCP; tokens de cor/tipografia (Manrope/Rye, paleta ink/gold) replicados em `apps/admin/src/index.css`; shell mobile 430px com bottom nav (Agenda/Pacotes/Comissão/Ajustes), como no protótipo.

- Tipos de API 100% de `@bigods/contracts` (nenhum tipo redeclarado).
- Visibilidade por papel: barbeiro não-admin só vê a própria agenda e a própria comissão; gestão de serviços/parâmetros e seleção de barbeiro são só admin.
- Comissão: **saldo real** (card escuro, "atendimentos concluídos") e **projeção futura** (card tracejado, "pode ser cancelada") — separados e rotulados, nunca somados.
- Agenda: atendimento de crédito de pacote com borda/fundo dourados + badge "Pacote"; avulso neutro + badge "Avulso".
- Loading/erro (com retry)/vazio em toda tela (`useApi`).
- Fluxos: agendar avulso, vender pacote (PIX fake ou pagamento presencial), agendar item com crédito, concluir/cancelar/falta, CRUD de serviços, prazo de reagendamento.

Divergência consciente do protótipo (DOMAIN.md vence): o mock mostrava pacotes como catálogo e comissão mensal agregada; implementei o modelo real (vendas por cliente com ciclo de vida por item; ledger + projeção separados).

## Correção de fuso horário (sessão 2026-07-14, continuação) ✅

**Bloqueador de produção corrigido:** o sistema operava em UTC ponta a ponta —
"disponibilidade das 9h às 18h" seedada como UTC virava 6h–15h no horário real
do Gabriel (America/Sao_Paulo, UTC-3). Princípio seguido: o banco continua
guardando instantes absolutos (timestamptz); a empresa tem um timezone IANA
próprio (não uma constante global — outras barbearias em outros fusos vão usar
o sistema); toda fronteira converte; o domínio permanece puro e nunca presume
fuso implícito (recebe `Timezone` como parâmetro explícito quando precisa
raciocinar sobre dias civis).

**Domínio (`apps/api/src/shared/domain/`):**
- `Timezone` — VO que valida fuso IANA via `Intl.DateTimeFormat` (TS puro, sem lib externa).
- `calendario.ts` — funções puras usando só `Intl.DateTimeFormat`: `instanteDeLocal`/`instanteDeDataHoraLocal` (local→UTC, robusto a DST via a técnica padrão de 2 iterações), `diaCivilChave` (dia civil no fuso dado), `limitesDoDiaCivil` (intervalo `[00:00 local, 00:00 local do dia seguinte)` para consultas de agenda), `fimDoDiaCivilMaisDias` (prazo em **dias civis**, não em N×24h — usado pelo prazo de reagendamento).
- `VendaDePacote.computarFalta` agora recebe `tz: Timezone` explícito e usa `fimDoDiaCivilMaisDias` — o prazo vence no fim do dia civil local. A **checagem** de vencimento (`expirarItensVencidos`) continua sendo comparação pura de instantes UTC, porque o prazo já foi congelado corretamente no momento da falta — nenhuma tz é necessária de novo ali.

**Banco/Prisma:**
- `Company.timezone` (IANA, default `"America/Sao_Paulo"`).
- Auditoria completa: **todas** as colunas `DateTime` (`Atendimento.inicio/fim`, `Disponibilidade.inicio/fim`, `VendaDePacote.compradoEm`, `ItemDoPacote.prazoReagendamentoAte`, `LancamentoComissao.ocorridoEm`) estavam como `timestamp without time zone` — corrigidas para `@db.Timestamptz(3)`. Migration usa `AT TIME ZONE 'UTC'` explícito na conversão (não o cast implícito do Postgres, que reinterpretaria os valores conforme o `TimeZone` da sessão da migration). A constraint `EXCLUDE` foi recriada com `tstzrange` (era `tsrange`, que não aceita `timestamptz`).

**Aplicação/infraestrutura:**
- `ParametrosDaEmpresaRepository.timezone(companyId)` — nova porta, sem tenant explícito → erro (nunca fallback, DOMAIN.md §2.4).
- `AgendarAvulsoUseCase`/`AgendarComCreditoUseCase`: a busca de disponibilidade por "data" usava `inicio.toISOString().slice(0,10)` (dia **UTC** do instante) — trocado por `diaCivilChave(inicio, tz)`. Esse era exatamente o bug: um atendimento às 23h30 local cairia no dia UTC seguinte e não encontraria a disponibilidade certa.
- `AgendaQueryService.listar` passou a receber `diaLocal` + `tz` e usa `limitesDoDiaCivil` para o range de consulta — "a agenda de hoje" agora é o dia civil local, não o dia UTC bruto.
- Controllers (`atendimentos`, `disponibilidades`, `parametros`) convertem na borda: requests recebem `data` (YYYY-MM-DD local) + `horaInicio`/`inicio`/`fim` (HH:mm, horário de parede local) em vez de ISO pré-construído; o servidor busca o tz da empresa e converte com `instanteDeDataHoraLocal`. Respostas continuam ISO 8601 UTC (`Z`), formato único documentado nos contracts.
- `ExpirarItensJob`: comentário explícito de que a correção da expiração **não depende** do horário exato do cron (o prazo já é um instante absoluto correto); o cron roda às 3h `America/Sao_Paulo` por conveniência operacional, não por necessidade de correção.
- Seed corrigido para construir os instantes de disponibilidade via `instanteDeDataHoraLocal(data, '09:00'|'18:00', tz)` — **achado durante a verificação manual**: o `upsert` original usava `update: {}` (no-op), então rodar o seed de novo não corrigia disponibilidades já existentes da sessão anterior (bug mascarado). Corrigido para `update` real (seed autocorretivo).

**Frontend (`apps/admin`):**
- `TimezoneProvider`/`useTimezone()` — busca `/parametros` uma vez após login e disponibiliza o fuso da empresa via contexto; toda tela usa esse fuso para formatar horas/datas, nunca `Intl`/`Date` sem `timeZone` explícito (o que usaria o fuso do navegador — um admin viajando não pode ver a agenda deslocada).
- `hora`/`dataCurta`/`hojeISO` em `lib/format.ts` agora exigem `tz` explícito.
- Diálogos de agendar avulso, agendar com crédito e disponibilidade enviam `data` + horário local (`HH:mm`) em vez de montar `${data}T${hora}:00.000Z` no cliente (que hardcodava UTC).

**Testes (o que provaria a regressão se alguém revertesse a correção):**
1. `calendario.spec.ts` — 9h/18h local de SP → 12:00Z/21:00Z; 23:30 local → instante UTC do dia seguinte mas `diaCivilChave` correto; `limitesDoDiaCivil` classifica corretamente um atendimento de 23:30 no seu próprio dia.
2. `calendario.spec.ts` — **DST real**: atravessando o início do horário de verão em `America/New_York` (2024-03-10), prova que dia civil é aritmética de calendário (2 dias civis) e não 48h corridas (na verdade 47h, porque 03-10 tem só 23h em NY).
3. `venda-de-pacote.spec.ts` — prazo de 10 dias vence no fim do dia civil, não em `hoje + 240h`; caso explícito de falta às 23h local cujo prazo vence "hoje" local mas cairia em dia diferente em UTC.
4. `test/integration/fuso-horario.spec.ts` (exige Postgres): disponibilidade "9h" local persiste como `12:00:00.000Z` no banco (timestamptz real); atendimento às 23:30 local aparece na consulta de agenda do seu dia civil correto e NÃO no dia seguinte; `ExpirarItensJob` não expira um item antes do fim do dia civil local mesmo quando esse instante já é "outro dia" em UTC.
5. **Independência de TZ do processo**: `npm run test:multitz` (novo script, roda a suíte inteira 3× com `TZ=UTC`, `TZ=America/Sao_Paulo`, `TZ=Asia/Tokyo`) — **100/100 testes idênticos nos três fusos**, provando que nada depende do `TZ` do runtime.

**Fora de escopo (como pedido):** seleção de timezone na UI de configuração — o modelo suporta (`ParametrosDTO.timezone` já é retornado pela API), mas não há tela para trocá-lo; a empresa seedada é única.

## Decisões pendentes (DECISOES_PENDENTES.md)

1. **Prazo limite do "cancelamento antecipado"** não definido na spec — usei "antes do início do atendimento".
2. **Retorno de item em 2ª chance após cancelamento antecipado** — preservo SEGUNDA_CHANCE+prazo (o diagrama sugere DISPONIVEL, mas isso permitiria escapar da expiração em loop).

## Pendências / limitações conhecidas

- `apps/booking` e `apps/account`: esqueletos (fora do escopo da sessão).
- Cognito e AbacatePay reais: plugar via `AuthProvider`, `IdentityProvider` e `PaymentGateway` (fakes locais em uso).
- `npm run test` inclui os testes de integração → exige o Postgres do docker-compose rodando e migrado.
- Notificação WhatsApp: não implementada (Fase 2 do produto), mas `AtendimentoAgendado` já é emitido.
- Timezone corrigido nesta sessão (ver seção dedicada acima): banco em `timestamptz`, `Company.timezone` = `America/Sao_Paulo`, toda fronteira converte. Não há UI para trocar o timezone (fora de escopo combinado).

## Como rodar localmente

```bash
# 1. Dependências
npm install

# 2. Banco (Postgres 16 em localhost:5432, user/senha/db = bigods)
docker-compose up -d

# 3. Variáveis (o repositório já tem .env; ou copie o exemplo)
cp .env.example .env   # DATABASE_URL + AUTH_SECRET

# 4. Migrations + client + seed
npm run db:migrate -w @bigods/api    # aplica migrations (inclui EXCLUDE gist)
npm run db:generate -w @bigods/api   # gera o Prisma Client
npm run db:seed -w @bigods/api       # Company, Gabriel, serviços, pacote exemplo

# (se DATABASE_URL não estiver no ambiente, prefixe os comandos acima com:
#  DATABASE_URL="postgresql://bigods:bigods@localhost:5432/bigods")

# 5. Build + testes
npm run build
npm run test                          # 100 testes (integração exige o banco no ar)
npm run test:multitz -w @bigods/api   # a suíte inteira em TZ=UTC/America/Sao_Paulo/Asia/Tokyo

# 6. API (porta 3000)
npm run dev -w @bigods/api           # ou: node apps/api/dist/main.js

# 7. Painel admin (porta 5173, proxy /api → :3000)
npm run dev -w @bigods/admin
# → http://localhost:5173 — login: gabriel / senha: bigods123

# Webhook fake de pagamento (confirmar um PIX gerado):
# curl -X POST localhost:3000/webhooks/abacatepay -H 'Content-Type: application/json' \
#   -d '{"event":"billing.paid","data":{"metadata":{"externalId":"<externalId da intenção>"}}}'
```

# Relatório da Sessão — Bigod's Barber v2

Data: 2026-07-14. Todas as 4 fases concluídas. **84 testes verdes** (79 de domínio puro + 5 de integração com Postgres). 5 commits convencionais.

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

## Decisões pendentes (DECISOES_PENDENTES.md)

1. **Prazo limite do "cancelamento antecipado"** não definido na spec — usei "antes do início do atendimento".
2. **Retorno de item em 2ª chance após cancelamento antecipado** — preservo SEGUNDA_CHANCE+prazo (o diagrama sugere DISPONIVEL, mas isso permitiria escapar da expiração em loop).

## Pendências / limitações conhecidas

- `apps/booking` e `apps/account`: esqueletos (fora do escopo da sessão).
- Cognito e AbacatePay reais: plugar via `AuthProvider`, `IdentityProvider` e `PaymentGateway` (fakes locais em uso).
- Horários tratados em UTC ponta a ponta (seed 9h–18h UTC); ajustar timezone da barbearia quando for a produção.
- `npm run test` inclui os testes de integração → exige o Postgres do docker-compose rodando e migrado.
- Notificação WhatsApp: não implementada (Fase 2 do produto), mas `AtendimentoAgendado` já é emitido.

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
npm run test          # 84 testes (integração exige o banco no ar)

# 6. API (porta 3000)
npm run dev -w @bigods/api           # ou: node apps/api/dist/main.js

# 7. Painel admin (porta 5173, proxy /api → :3000)
npm run dev -w @bigods/admin
# → http://localhost:5173 — login: gabriel / senha: bigods123

# Webhook fake de pagamento (confirmar um PIX gerado):
# curl -X POST localhost:3000/webhooks/abacatepay -H 'Content-Type: application/json' \
#   -d '{"event":"billing.paid","data":{"metadata":{"externalId":"<externalId da intenção>"}}}'
```

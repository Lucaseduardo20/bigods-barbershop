# Pagamentos (PIX via AbacatePay — Checkout Transparente v2)

Gateway de pagamento atrás da porta `PaymentGateway` (domínio). O adapter ativo é
escolhido por **variável de ambiente** — trocar `fake ↔ abacatepay` não muda uma
linha de domínio/aplicação.

**Modo Checkout Transparente** (QR Code + copia-e-cola exibidos dentro do próprio
funil) é obrigatório nesta conta — nunca o modo hospedado (redirecionamento pra
página da AbacatePay): o webhook cadastrado só assina eventos `transparent.*`; o
modo hospedado emitiria `checkout.*`, que não está assinado, e o pagamento nunca
confirmaria (falha silenciosa). Ver DECISOES_PENDENTES.md #10.

## Adapters

| `PAYMENT_GATEWAY` | Adapter | Webhook exposto? |
|---|---|---|
| `fake` (default fora de produção) | `FakeAbacatePayGateway` | **Não** — nenhuma superfície de webhook é montada |
| `abacatepay` (default em produção) | `AbacatePayGateway` (real, v2) | Sim, `POST /webhooks/abacatepay` com validação de assinatura |

Variáveis (ver `.env.example`): `ABACATEPAY_API_KEY`, `ABACATEPAY_WEBHOOK_SECRET`
(ambas **obrigatórias** com o gateway real — a app recusa subir sem elas),
`ABACATEPAY_BASE_URL` (default `https://api.abacatepay.com/v2`),
`ABACATEPAY_EXPIRA_SEGUNDOS` (default 3600 — janela da cobrança PIX, também usada
para calcular `IntencaoDePagamento.expiraEm`, ver expiração abaixo).

## Endpoints da AbacatePay usados

- `POST /v2/transparents/create` — cria a cobrança. Corpo:
  `{ method: "PIX", data: { amount, expiresIn, description, externalId } }`.
  `externalId` é campo **direto** de `data` (não `data.metadata.externalId`).
  Resposta: `{ data: { id, brCode, brCodeBase64, status, expiresAt } }`, mapeada
  para `CobrancaPix { gatewayId, copiaECola: brCode, qrCode: brCodeBase64, expiresAt }`.
- `POST /v2/transparents/simulate-payment?id=<gatewayId>` — só sandbox, simula o
  pagamento (`AbacatePayGateway.simularPagamento`).

## Validação de assinatura do webhook (inegociável)

Cada webhook do AbacatePay é validado **antes** de qualquer processamento
(`AbacatePayWebhookGuard` → `verificarWebhookAbacatePay`). São **DOIS mecanismos
obrigatórios, AND** (confirmado contra a doc oficial — o próprio checklist deles
manda usar os dois juntos):

1. **Secret compartilhado** na query string (`?webhookSecret=...`), comparado em
   tempo constante com `ABACATEPAY_WEBHOOK_SECRET`.
2. **HMAC-SHA256 em base64** sobre o **corpo cru** (por isso o bootstrap usa
   `NestFactory.create(AppModule, { rawBody: true })`), no header
   `X-Webhook-Signature`, calculado com a **chave pública fixa da AbacatePay**
   (constante, igual para toda conta, publicada na doc deles — NÃO é o nosso
   `ABACATEPAY_WEBHOOK_SECRET`). Comparado em tempo constante
   (`crypto.timingSafeEqual`, nunca `===`).

Falha em qualquer uma das duas provas → **401**, sem tocar em nenhuma entidade de
domínio. A validação é **incondicional**: roda sempre que o endpoint real está
exposto, em qualquer ambiente (dev com túnel, homologação, produção, sandbox).
Não existe branch de "pular validação em dev" nem por `devMode: true` no payload.
Quem não quer expor o webhook usa `PAYMENT_GATEWAY=fake`.

Sandbox e produção rodam o **mesmo** código e o **mesmo** caminho de validação; a
única diferença permitida é qual `ABACATEPAY_API_KEY` / `ABACATEPAY_WEBHOOK_SECRET`
estão carregados.

## Eventos assinados nesta conta

Só `transparent.completed` e `transparent.lost` (Checkout Transparente). Qualquer
outro evento (`checkout.*`, `refunded`, `disputed`, `subscription.*`, `payout.*`,
`transfer.*`) é ignorado graciosamente pelo controller — 200/201, sem efeito, sem
erro (nunca 4xx/5xx por evento desconhecido, senão a AbacatePay fica retentando).

- **`transparent.completed`** → busca a intenção por `data.transparent.externalId`
  → `ProcessarWebhookUseCase` transiciona `AGUARDANDO → PAGO` (idempotente) e
  libera o pacote/atendimento na mesma transação.
- **`transparent.lost`** → **disputa/chargeback PERDIDO sobre uma cobrança já
  PAGA** — NÃO é "PIX expirou sem pagamento" (não existe esse evento na
  AbacatePay v2; ver DECISOES_PENDENTES.md #27). Tratado como no-op seguro: log
  de warning com o `externalId`, zero mutação de entidade. Reverter crédito
  já liberado é decisão financeira que não foi pedida — fica para revisão manual.

## Expiração de PIX não pago (timeout local, sem webhook)

A AbacatePay não emite nenhum webhook para "PIX gerado e nunca pago, expirou
sozinho". Por isso `IntencaoDePagamento.expiraEm` (mesma janela pedida ao gateway
via `expiresIn`) é conferido a cada leitura de status
(`ExpirarPagamentoVencidoUseCase`, chamado por `GET /public/pagamentos/:id` antes
de responder) — se `AGUARDANDO` e o prazo já passou, transiciona pra `EXPIRADO`
ali mesmo. O próprio polling do funil (pacote ou avulso) é o gatilho; não há job
nem cron separado.

## Política do funil (decisão do dono)

- **Pacote**: pagamento online é **obrigatório** — o funil público não oferece
  mais "pagar na barbearia" nessa trilha (garante caixa adiantado antes de
  liberar crédito). `formaPagamento` nem existe mais no DTO de venda pública.
- **Avulso**: o cliente **escolhe** entre online (PIX antecipado) ou presencial
  (paga na conclusão).

## Testar o webhook localmente (sem HTTPS pública)

### Opção A — payload v2 assinado à mão (sem túnel)

Com o gateway real ativo e um `ABACATEPAY_WEBHOOK_SECRET` conhecido, assine o
corpo com a **chave pública fixa da AbacatePay** (não o seu secret — essa vive só
na query string):

```bash
PUBLIC_KEY="t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9"
QUERY_SECRET="seu-webhook-secret"
BODY='{"event":"transparent.completed","apiVersion":2,"devMode":true,"data":{"transparent":{"id":"tr_x","externalId":"<ID_DA_INTENCAO>","status":"PAID"}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PUBLIC_KEY" -binary | base64)

curl -sS -X POST "http://localhost:3000/webhooks/abacatepay?webhookSecret=$QUERY_SECRET" \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIG" \
  --data "$BODY"
```

O `externalId` é o `externalId` da `IntencaoDePagamento` criada na venda (não o
`intencaoId` da resposta — busque no banco ou use `cobranca.intencaoId` para
consultar via Prisma). É exatamente o que os testes automatizados
(`test/integration/webhook-abacatepay.e2e.spec.ts`,
`test/integration/pacote-publico.e2e.spec.ts`) fazem.

### Opção B — sandbox real do AbacatePay (dashboard aberto)

1. Configure `ABACATEPAY_API_KEY`/`ABACATEPAY_WEBHOOK_SECRET` de sandbox e
   `PAYMENT_GATEWAY=abacatepay`.
2. Gere uma cobrança pelo app (funil público → compra de pacote, ou avulso com
   pagamento online).
3. Simule o pagamento (`AbacatePayGateway.simularPagamento(gatewayId)` →
   `POST /v2/transparents/simulate-payment?id=...`) pelo endpoint ou pelo painel.
4. O AbacatePay dispara o webhook `transparent.completed` real → o pacote/
   atendimento libera.
5. Ver o roteiro completo de smoke test manual em `RELATORIO_SESSAO.md`.

## Fluxo ponta a ponta (venda de pacote, sempre "online")

`vender pacote (pagamentoImediato:false)` → `AbacatePayGateway.criarCobrancaPix`
(QR Code + copia-e-cola, `externalId` = id da intenção enviado em `data.externalId`)
→ cliente paga / `simularPagamento` no sandbox → webhook `transparent.completed`
assinado → `ProcessarWebhookUseCase` (idempotente por `externalId`) transiciona a
intenção para `PAGO` e libera a `VendaDePacote` na mesma transação. Se o cliente
não pagar dentro da janela, o próximo polling de status expira a intenção
localmente (sem depender de webhook).

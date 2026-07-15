# Pagamentos (PIX via AbacatePay)

Gateway de pagamento atrás da porta `PaymentGateway` (domínio). O adapter ativo é
escolhido por **variável de ambiente** — trocar `fake ↔ abacatepay` não muda uma
linha de domínio/aplicação.

## Adapters

| `PAYMENT_GATEWAY` | Adapter | Webhook exposto? |
|---|---|---|
| `fake` (default fora de produção) | `FakeAbacatePayGateway` | **Não** — nenhuma superfície de webhook é montada |
| `abacatepay` (default em produção) | `AbacatePayGateway` (real) | Sim, `POST /webhooks/abacatepay` com validação de assinatura |

Variáveis (ver `.env.example`): `ABACATEPAY_API_KEY`, `ABACATEPAY_WEBHOOK_SECRET`
(ambas **obrigatórias** com o gateway real — a app recusa subir sem elas),
`ABACATEPAY_BASE_URL` (default `https://api.abacatepay.com/v1`),
`ABACATEPAY_EXPIRA_SEGUNDOS`.

## Validação de assinatura do webhook (inegociável)

Cada webhook do AbacatePay é validado **antes** de qualquer processamento
(`AbacatePayWebhookGuard` → `verificarWebhookAbacatePay`):

- HMAC-SHA256 sobre o **corpo cru** da requisição (por isso o bootstrap usa
  `NestFactory.create(AppModule, { rawBody: true })`), comparado com o header
  `X-Webhook-Signature` em **tempo constante** (`crypto.timingSafeEqual`, nunca `===`).
- Alternativamente, o segredo compartilhado na query string (`?webhookSecret=...`),
  também comparado em tempo constante.
- Falha na verificação → **401**, sem tocar em nenhuma entidade de domínio.

A validação é **incondicional**: roda sempre que o endpoint real está exposto, em
qualquer ambiente (dev com túnel, homologação, produção). Não existe branch de
"pular validação em dev". Quem não quer expor o webhook usa `PAYMENT_GATEWAY=fake`.

Homologação e produção rodam o **mesmo** código; a única diferença permitida é
qual `ABACATEPAY_API_KEY` / `ABACATEPAY_WEBHOOK_SECRET` estão carregados.

## Testar o webhook localmente (sem HTTPS pública)

### Opção A — payload assinado à mão (sem túnel)

Com o gateway real ativo e um `ABACATEPAY_WEBHOOK_SECRET` conhecido, assine o
corpo você mesmo:

```bash
SECRET="seu-webhook-secret"
BODY='{"event":"billing.paid","data":{"metadata":{"externalId":"<ID_DA_INTENCAO>"}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -sS -X POST http://localhost:3000/webhooks/abacatepay \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIG" \
  --data "$BODY"
```

O `externalId` é o `id` da `IntencaoDePagamento` criada na venda (retornado em
`cobranca.intencaoId`). É exatamente o que o teste automatizado
`test/integration/webhook-abacatepay.e2e.spec.ts` faz.

### Opção B — túnel (ngrok) contra o sandbox do AbacatePay

1. `ngrok http 3000` → copie a URL pública.
2. No painel do AbacatePay, cadastre o webhook apontando para
   `https://<sub>.ngrok.io/webhooks/abacatepay?webhookSecret=<seu-secret>` e use o
   mesmo secret em `ABACATEPAY_WEBHOOK_SECRET`.
3. Gere uma cobrança pelo app (venda de pacote "online").
4. Simule o pagamento no sandbox (`AbacatePayGateway.simularPagamento(gatewayId)`
   → `POST /pixQrCode/simulate-payment?id=...`) ou pelo painel.
5. O AbacatePay dispara o webhook assinado → o pacote libera os créditos.

## Fluxo ponta a ponta (venda "online")

`vender pacote (pagamentoImediato:false)` → `AbacatePayGateway.criarCobrancaPix`
(QR Code + copia-e-cola, `metadata.externalId` = id da intenção) → cliente paga /
`simularPagamento` no sandbox → webhook assinado → `ProcessarWebhookUseCase`
(idempotente por `externalId`) transiciona a intenção para `PAGO` e libera a
`VendaDePacote` na mesma transação.

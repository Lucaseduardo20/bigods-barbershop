# Integração Mercado Pago (Orders API) — plano de implementação

## Context

O Bigod's cobra online hoje só por PIX, via AbacatePay, atrás da porta `PaymentGateway`.
Falta cartão de crédito, e a AbacatePay foi para produção com atraso — o que motivou a ponte
temporária de pagamento manual por WhatsApp que ainda existe.

Esta sessão adiciona o **Mercado Pago como terceiro adapter**, cobrindo **PIX e cartão de
crédito à vista**. AbacatePay e o modo manual **permanecem intactos**: a troca continua sendo
uma variável de ambiente. O sistema **já roda em produção**, então toda migration é aditiva.

A pesquisa completa da API (contrato dos endpoints, tabelas de status, assinatura de webhook,
armadilhas) está em `RELATORIO_SESSAO.md` §"Mercado Pago via Orders API (2026-08-26)", e as
pendências conscientes em `followup.md`. Este plano não repete aquilo — assume como dado.

Resultado esperado: cliente paga por PIX ou cartão no funil, o pagamento confirma por webhook
verificado, a comissão do barbeiro passa a incidir sobre o líquido, e o admin ganha uma tela
de reembolso com agendamento.

---

## Decisões que governam o plano

Fechadas com o dono; não reabrir durante a implementação.

| Tema | Decisão |
|---|---|
| Meios | PIX + crédito **à vista** (`installments: 1`). Sem débito, sem boleto |
| Convivência | MP **não sobe junto** com `PAGAMENTO_MANUAL_WHATSAPP=true` — fail-fast no boot |
| Captura | `capture_mode: automatic` — cobra na hora |
| 3DS | Ligado: `validation: on_fraud_risk`, `liability_shift: required` |
| Janela | 30 min, **não renova** em nova tentativa de cartão |
| 3DS vs janela | Sem regra especial — quem estourar cai no estorno automático |
| Fora da janela | Pagamento tardio é **estornado automaticamente** + cliente avisado para reagendar |
| Status novo | `EM_ANALISE` (para `processing/in_process`). `pending_challenge` cai em `AGUARDANDO` |
| Estorno/chargeback | Sem estados novos nesta fase (`followup.md` #3) |
| Concorrência | No máximo **uma** `IntencaoDePagamento` `AGUARDANDO` por referência |
| Comissão | Sobre o **líquido**, em **todo pagamento online** — Mercado Pago **e AbacatePay** |
| `statement_descriptor` | `BIGODS_BARBERSHOP_F1` |
| OTP no cartão | **Dispensa só se o telefone já tem cadastro**; telefone novo exige OTP |
| Admin | **Não faz checkout online.** Cartão presencial é na maquininha; o barbeiro só confirma o pagamento, como já hoje. O que o admin ganha é a **tela de reembolso** e visibilidade dos pagamentos online |
| Account | Cliente **vê** o reembolso e o estorno automático; **não** cancela nem antecipa |
| Reembolso | Agendado para **31 dias**, prazo parametrizável, com opção de executar imediato |

---

## Variáveis de ambiente

Nomes a criar. **Valores nunca vão para o repositório** — `.env.example` recebe placeholders
inequívocos (`APP_USR-0000...`), e os valores reais vivem no `.env` local, no SSM (AWS) ou no
gerenciador de senhas.

```bash
# ── Mercado Pago (PAYMENT_GATEWAY=mercadopago) ──────────────────────────────
MERCADOPAGO_ENV=                 # "producao" | "staging" — EXPLÍCITO.
                                 # Nunca inferir ambiente pelo prefixo do token:
                                 # teste e produção usam ambos APP_USR-.
MERCADOPAGO_ACCESS_TOKEN=        # backend, secreto. Authorization: Bearer
MERCADOPAGO_PUBLIC_KEY=          # tokenização no browser. Servido pela API, não por VITE_
MERCADOPAGO_WEBHOOK_SECRET=      # gerado no painel ao salvar o webhook. HMAC da notificação
MERCADOPAGO_APPLICATION_ID=      # "número da aplicação" — validado contra body.application_id
MERCADOPAGO_USER_ID=             # id do vendedor — conferência do webhook
MERCADOPAGO_CLIENT_ID=           # OAuth (não usado no runtime hoje; guardar)
MERCADOPAGO_CLIENT_SECRET=       # OAuth (idem)
MERCADOPAGO_BASE_URL=https://api.mercadopago.com
MERCADOPAGO_EXPIRA_SEGUNDOS=1800 # mínimo do PIX no MP é 30 min
MERCADOPAGO_TAXA_BASIS_POINTS=   # taxa efetiva p/ derivar líquido quando o gateway não informa
REEMBOLSO_PRAZO_DIAS=31          # parametrizável; 0 = imediato
```

Credenciais de **teste manual** (usuário de teste, senha, código de verificação) **não são
lidas pelo runtime** — não entram no `.env` da API. Ficam em `docs/` não-versionado ou no
gerenciador de senhas, e o `.env.example` só cita onde encontrá-las.

**Uma aplicação MP por ambiente.** A `notification_url` é por aplicação, não vai no corpo da
order — staging e produção precisam de aplicações, credenciais e secrets distintos.

Arquivos a tocar: `.env.example`, `.env.docker.example`, `.env.aws.example`, e o loop de
opcionais em `scripts/fetch-secrets-ssm.sh`. Os `docker-compose.*.yml` usam `env_file` — nada
a fazer neles.

---

## Fases

Cada fase termina com `npm run build && npm run test` e
`npm run test:multitz -w @bigods/api` verdes. O gateway novo só é reconhecido na Fase 4 — até
lá é código morto testável, revertível por `git revert` sem risco.

### Fase 0 — Scrubbing, fail-fast e envs
Antes de qualquer código de pagamento, para não vazar token durante a própria depuração.
- `packages/contracts/src/sentry-scrubbing.ts`: acrescentar a `CHAVES_SENSIVEIS`
  `signature`, `idempotency`, `cvv`, `security_code`, `card_number`, `cardnumber`,
  `numerocartao`, `pan`, `cardholder`, `titular`, `expiration`, `validade`, `qr_code`,
  `qrcode`, `copiaecola`, `brcode`, `device_id`, `session_id`.
  **Não** acrescentar `public_key` (é pública) nem `x-request-id` (é o que o suporte do MP
  pede). Evitar `card` puro — apagaria campos legítimos.
- `apps/api/src/shared/config/config-seguranca.ts`: reconhecer `mercadopago`; exigir
  `MERCADOPAGO_ACCESS_TOKEN` + `MERCADOPAGO_WEBHOOK_SECRET` + `MERCADOPAGO_ENV`; recusar boot
  com `PAGAMENTO_MANUAL_WHATSAPP=true`; assert de que `MERCADOPAGO_PUBLIC_KEY ≠
  MERCADOPAGO_ACCESS_TOKEN` (fecha a falha mais cara: colar o token no frontend).
- Espelhar a checagem em `scripts/deploy.sh` — falhar **antes** de subir container, não depois.

### Fase 1 — Migrations aditivas (três, separadas)
- **1a** colunas nuláveis em `IntencaoDePagamento` (`gateway`, `gatewayId`, `statusDetalhe`,
  `valorLiquidoCentavos`, `estornoSolicitadoEm`); campos em `SolicitacaoDeReembolso`
  (`agendadaPara`, `executadaEm`, `gatewayRefundId`, `tentativas`, `ultimoErro`); e a tabela
  nova **`TentativaDePagamento`** (`intencaoId`, `gateway`, `gatewayId`, `idempotencyKey`,
  `meio`, `status`, `statusDetalhe`, `valorLiquidoCentavos`, `criadaEm`) com
  `@@unique([gateway, gatewayId])` e `idempotencyKey @unique`.
  *Por que a tabela:* cartão recusado gera **N orders para uma mesma intenção**, cada uma com
  sua chave de idempotência. Sem ela, a segunda tentativa sobrescreve a primeira e um webhook
  atrasado da primeira não encontra vínculo. Fazer depois custa migration de dados com
  pagamentos reais.
- **1b** `ALTER TYPE` dos enums, **sem nenhum uso do valor** — o Postgres não deixa usar um
  valor de enum na mesma transação em que foi criado, e o projeto já queimou essa lição duas
  vezes (ver `20260820010000` e `20260825020000`).
- **1c** índices parciais únicos em SQL cru (o Prisma não os expressa): um por
  `atendimentoId`, outro por `vendaDePacoteId`, `WHERE status = 'AGUARDANDO'`; e um em
  `TentativaDePagamento WHERE status IN ('AGUARDANDO','EM_ANALISE')` por `intencaoId`.
  **Antes disso, um diagnóstico read-only em produção** — se já existirem duplicatas, o
  `CREATE UNIQUE INDEX` derruba o deploy. Havendo, migration de saneamento primeiro.
  `CONCURRENTLY` não é opção (migration roda em transação).

### Fase 2 — Domínio puro (zero rede, zero framework)
Em `apps/api/src/modules/payments/domain/`:
- `mercadopago-dinheiro.ts` — `Dinheiro` ↔ string de reais, **sem `parseFloat`** (regex +
  inteiro). A string `"50.00"` é conversão de borda; centavos nunca saem do domínio.
- `mercadopago-status.ts` — mapa exaustivo `status × status_detail → StatusPagamento`, com
  `default` que **lança**. Status desconhecido tem que quebrar teste, não virar `PAGO`.
- `mercadopago-manifesto.ts` — manifesto da assinatura, puro.
- `duracao-iso8601.ts` — segundos → `PT30M`.
- `vinculo-order-intencao.ts` — as três amarrações da §Segurança.
- `intencao-de-pagamento.aggregate.ts`: `EM_ANALISE` na máquina de estado;
  **`confirmarPagamento(valorPago: Dinheiro)`** passa a exigir o valor;
  `marcarEmAnalise()`, `registrarValorLiquido()`, `solicitarEstornoAutomatico()` idempotente.

A mudança de assinatura de `confirmarPagamento` ondula para `processar-webhook.usecase.ts` e
para os dois `confirmar-pagamento` de admin — é a ondulação desejada, e acontece nesta fase.

### Fase 3 — Adapter Mercado Pago (PIX), com `fetch` injetado, ainda não plugado
- `payment-gateway.ts` cresce: `criarCobranca({ meio })`, `consultarCobranca(gatewayId)`,
  `estornar(...)`. `AbacatePayGateway` e o fake declaram os novos como **não suportados**, com
  erro nomeado — nunca `undefined` silencioso.
- `infrastructure/mercadopago.gateway.ts` espelhando `abacatepay.gateway.ts:13,35`
  (`FetchLike` injetado — nenhum teste chama a rede). Acrescentar sobre o molde:
  `AbortSignal.timeout`, leitura de `Retry-After` no 429, log do `x-request-id`, e `redigir()`
  do `payment_method.token` antes de qualquer log.

### Fase 4 — Ligar PIX ponta a ponta
- `gatewayAtivo()` em `payments.module.ts:24` vira união de três + fail-closed (molde:
  `identity.module.ts:67`). Atenção: a lista de controllers (`:54`) é avaliada **no import**.
- `mercadopago-webhook.verifier.ts` (**função pura**), `.guard.ts`, `.controller.ts`.
- `ProcessarWebhookMercadoPagoUseCase`: faz o `GET /v1/orders/{id}` **fora** da transação,
  valida o vínculo, e delega ao `ProcessarWebhookUseCase.executar({ externalId })` já
  existente e já idempotente — reusar, não reescrever.

**Marco:** a partir daqui dá para virar staging com PIX real.

### Fase 5 — Job de reconciliação + auto-estorno fora da janela
`reconciliar-pagamentos.job.ts` (molde `expirar-itens.job.ts:22-58`). É a rede que torna o
fail-closed do webhook aceitável — sem ele, "o webhook nunca chegou" é dinheiro perdido em
silêncio. Auto-estorno em três tempos (§Segurança).

### Fase 6 — Cartão de crédito no backend
`POST /public/pagamentos/:intencaoId/cartao` — **sob o prefixo `/public/pagamentos`**, que já
está em `ROTAS_COM_CORPO_SENSIVEL` do scrubbing. Nascer sob `/public/agendamentos` mandaria o
token inteiro para o Sentry. Payload do MP com bandeira + token + `installments: 1` +
`statement_descriptor` + `transaction_security`, header `X-meli-session-id` (Device ID).

### Fase 7 — Booking: checkout de cartão
- SDK carregado **sob demanda** (não no `index.html`), com fallback para PIX se não carregar —
  a CSP do CloudFront é ação do dono (`followup.md` #7) e pode não estar aplicada.
- **Secure Fields** do MercadoPago.js V2, não inputs comuns: o PAN vive num iframe de
  `sdk.mercadopago.com` e nunca entra no nosso heap.
- `components/CartaoCheckout.tsx` novo, montado por early return no `App.tsx` como
  `PixAguardando` já faz — **sem receber `patch` como prop** (a ausência é a barreira).
- OTP condicional: telefone já cadastrado dispensa; telefone novo exige.

### Fase 8 — Comissão sobre o líquido (bloqueante para produção)
Sozinha, porque o ledger `LancamentoComissao` é **imutável** — depois do primeiro lançamento
só se corrige por lançamento de ajuste, um por atendimento.
- Vale para **os dois** gateways online. O MP informa `paid_amount`; a AbacatePay **não expõe
  líquido**, então para ela o líquido é derivado de uma taxa configurável
  (`ABACATEPAY_TAXA_BASIS_POINTS`). Presencial e dinheiro seguem no bruto.
- Se o líquido ainda não for conhecido na conclusão, **adiar o lançamento** em vez de lançar
  bruto — o handler já tem guarda de idempotência (`porAtendimento`) que suporta isso.

### Fase 9 — Reembolso agendado (backend + job)
`SolicitacaoDeReembolso` ganha `AGENDADO` e `FALHOU`; use cases de agendar / antecipar /
cancelar; `executar-reembolsos-agendados.job.ts` com retentativa, `tentativas` e `ultimoErro`.
Cobre `followup.md` #1 (saldo insuficiente) desde o primeiro dia.

### Fase 10 — Admin: reembolso e visibilidade
**Não há checkout online no admin** — cartão presencial continua na maquininha, e o barbeiro só
confirma o pagamento pelo fluxo que já existe em `FecharComandaDialog.tsx`.
`screens/Reembolsos.tsx` cresce para três abas (`Tabs` já existe em `components/ui.tsx`):
- **Pendentes** — `Agendar estorno (31 dias)` primário, `Estornar agora` como `btn-ghost`
  atrás de `Dialog` de confirmação (estorno de cartão é irreversível).
- **Agendados** — ordenados por `agendadaPara`, com `Antecipar` e `Cancelar agendamento`; o
  prazo é editável por solicitação, não configuração global escondida.
- **Falhados** — a aba que `followup.md` #1 exige. `ultimoErro` traduzido para linguagem de
  operação ("saldo insuficiente na conta Mercado Pago"), com `Tentar de novo`.
`Badge` de tom `danger` na aba e contador na Home quando houver falhados — falha financeira não
pode depender de alguém lembrar de abrir a tela.
Mais: `statusDetalhe` cru e `gatewayId` visíveis **só aqui** (admin-only).

### Fase 11 — Account: o que o cliente vê
- Card de reembolso na Home com linha do tempo em texto: `PENDENTE` → "Pedido recebido";
  `AGENDADO` → "Devolução programada para DD/MM" (**data explícita**, nunca "em breve");
  `REEMBOLSADO` → "Devolvido em DD/MM, pode levar até 2 dias úteis para aparecer na fatura";
  `FALHOU` → **não** dizer "falhou" — "Estamos concluindo sua devolução" + botão de WhatsApp.
- Texto por meio de pagamento: crédito volta **na fatura**, não por PIX. O DTO carrega o meio;
  a regra mora em `apps/account/src/lib/textos.ts`, que já existe e tem spec.
- Card do **estorno automático**: "Seu pagamento chegou depois do prazo e foi devolvido. Vamos
  remarcar?", com CTA para `onAgendar(servicoId)` que já existe. O cliente pagou e perdeu o
  horário — a tela não pode ser um aviso passivo.
- O cliente **não** cancela nem antecipa reembolso. A ação dele é o WhatsApp.

---

## Segurança

O dono pediu explicitamente: sem vazamento de dados, e o usuário não pode "assinar um valor e
pagar outro".

**Adulteração de valor.** Hoje o cliente já não envia preço (`AgendarPublicoDto` não tem campo
monetário; `VenderPacotePublicoDto` recebe `ofertaId` e o valor vem do servidor). Três travas
novas: (a) o DTO do cartão **não tem campo de dinheiro** — `{ companyId, token,
paymentMethodId, deviceId? }`, e `installments: 1` é constante do adapter; (b) a porta é
tipada em `Dinheiro`, o que torna "passar o número do request" erro de compilação; (c)
**`confirmarPagamento(valorPago)` lança se o valor não bater** — nenhum caminho (webhook,
confirmação de admin, demo) confirma sem provar quanto entrou. Divergência responde **200** com
log de alerta e intenção intocada, nunca 4xx (senão o MP retenta para sempre).

**Confusão de intenção.** Antes de qualquer mutação: `order.external_reference ===
intencao.externalId`, `intencao.gatewayId === order.id`, e o valor bate. Mais duas amarrações
baratas: `body.application_id === MERCADOPAGO_APPLICATION_ID` e `body.live_mode ===
(MERCADOPAGO_ENV === 'producao')` — isso pega o cenário mais provável de todos, a aplicação de
staging apontada para a URL de produção, indetectável de outra forma porque ambos usam o mesmo
host e tokens `APP_USR`.

**Replay e duplicação.** Webhook reenviado já é no-op. Auto-estorno em **três tempos**:
T1 transação marca `estornoSolicitadoEm` (se já marcado, sai), T2 chama o gateway **fora** da
transação, T3 grava desfecho. Morte entre T1 e T2 deixa a linha exatamente no estado que o job
da Fase 5 varre. Dois cliques: o índice parcial gera `P2002` — o caso de uso **captura e relê**,
devolvendo a intenção existente, nunca um 500.

**Dados de cartão.** `funnel-state.ts` serializa o estado inteiro em `sessionStorage`; se
alguém acrescentar `cvv` ou `numeroCartao` ali, o PAN vai para o disco do celular — e o
scrubbing do Sentry **não pegaria**. Defesas: Secure Fields (o PAN nunca existe no nosso JS);
estado do cartão fora do `FunnelState`; **teste-cadeado** em `funnel-state.spec.ts` comparando
as chaves com uma lista congelada; e assert em `salvarEstado` que recusa gravar se o JSON casar
`/(?<!\d)\d{13,19}(?!\d)/`.

**Oráculo de status.** `GET /public/pagamentos/:id` **não** pode passar a devolver
`statusDetalhe` cru: `high_risk` e `rejected_by_issuer` ensinam o fraudador a calibrar a próxima
tentativa. O público recebe um enum nosso, pequeno e propositalmente vago
(`RECUSADO_DADOS | RECUSADO_SALDO | RECUSADO_EMISSOR | RECUSADO_GENERICO | DESAFIO_3DS |
EM_ANALISE`); o detalhe cru fica no admin.

**Webhook.** Validação incondicional antes de tocar em entidade, `timingSafeEqual`, fail-closed.
`data.id` vem de `req.query['data.id']` — **chave literal com ponto**, porque o `qs` do Express
não interpreta pontos; ler do corpo dá manifesto vazio e 401 em 100% das notificações. As duas
caixas do `data.id` são testadas sem short-circuit. Códigos: assinatura inválida ⇒ **401**;
assinatura válida com qualquer desfecho de negócio ⇒ **200**; falha de infra nossa ou do `GET`
⇒ **5xx** (o retry do MP é a fila). O `GET` usa `AbortSignal.timeout(8000)` e roda **fora** de
`uow.transacao()`, cujo `$transaction` tem timeout de 5s.

**Autorização.** Throttle **por `intencaoId`** no endpoint de cartão (não só por origem); 404
genérico em divergência de `companyId`, nunca 403 (403 confirma que o id existe); `intencaoId`
só em path, nunca em query. Reembolso: agendar/antecipar/cancelar é `@Papeis(Papel.ADMIN)`; o
cliente vê só os próprios, filtrados pelo `clienteId` **da sessão**.

---

## Testes

Prioridade do CLAUDE.md: o valor está no domínio, não em controller.

**Domínio puro** — conversão `Dinheiro` ↔ string de reais (centavos terminando em zero, valores
primos, < R$1, zero, e round-trip fuzz determinístico); mapeamento de status cobrindo **todos**
os valores das duas tabelas, mais um teste provando que status desconhecido **não** vira `PAGO`;
duração ISO 8601; manifesto da assinatura; máquina de estado com `EM_ANALISE`; idempotência de
`confirmarPagamento` e de `solicitarEstornoAutomatico`; e o teste de que `externalId` cabe em 64
chars com o charset do `external_reference`.

**Adapter com `fetch` mockado** (molde `abacatepay.gateway.spec.ts`) — payload de PIX
(`{ id: 'pix', type: 'bank_transfer' }` + `expiration_time: 'PT30M'`); payload de crédito
(`installments: 1`, `statement_descriptor`, `token`); **`total_amount === "100.00"` para
`Dinheiro.deCentavos(10000)`**; `X-Idempotency-Key` presente e **diferente entre duas chamadas**;
`total_amount === Σ amounts`; 400/401/402/429-com-`Retry-After`/5xx; e `GET /v1/orders/{id}`.

**Verificador de assinatura** — válida, inválida, header ausente, `ts` não numérico, as duas
caixas do `data.id`, `x-request-id` ausente (omite a parte, não falha). O teste monta o
manifesto **à mão, com string literal**, sem importar `mercadopago-manifesto.ts` — senão um bug
no construtor passa despercebido dos dois lados (é a disciplina que
`webhook-abacatepay.e2e.spec.ts` já pratica).

**E2E** (novo arquivo `webhook-mercadopago.e2e.spec.ts`; **não** alterar
`webhook-abacatepay.e2e.spec.ts`, que é a prova de não-regressão) — idempotência com o mesmo
evento em `Promise.all` provando **um único** refund; order desconhecida ⇒ 200; valor divergente
⇒ 200 e intenção intocada; `live_mode` errado ⇒ 200 e nada muda; adulteração de valor no DTO do
cartão; dois `POST` idênticos em `Promise.all` ⇒ uma linha e o mesmo `intencaoId`; latência de
6s no fetch provando que o `GET` está fora da transação; `high_risk` **não** aparece na resposta
pública mas aparece no admin.

**Regressão obrigatória** — a suíte inteira verde com `PAYMENT_GATEWAY` em **cada um dos três
valores**, mais `npm run test:multitz -w @bigods/api`.

---

## Verificação

```bash
npm run build                        # obrigatório: dist stale de contracts derruba 58 testes
npm run test                         # suíte inteira (integração exige Postgres no ar)
npm run test:multitz -w @bigods/api  # TZ=UTC / America/Sao_Paulo / Asia/Tokyo

# banco, se necessário
open -a Docker && docker compose up -d && npm run db:migrate -w @bigods/api
```

Baseline conhecido antes desta sessão: **618 testes verdes** (448 domínio/unit da api nos três
fusos, 74 contracts, 49 booking, 21 account, 26 admin), mais 475 de integração que exigem banco.

Fim a fim em staging, depois da Fase 4: criar cobrança PIX real, pagar, e ver a intenção
transicionar para `PAGO` pelo webhook. Antes disso, validar a **caixa do `data.id`** com
"Simular notificação" no painel (`followup.md` #8) — embora o verificador aceite as duas formas,
saber qual é a real permite simplificar depois.

---

## Riscos

| # | Risco | Mitigação |
|---|---|---|
| R1 | Índice parcial único **falha no deploy** se produção já tiver duplicatas | Diagnóstico read-only antes da 1c; saneamento se houver |
| R2 | Valor de enum usado na migration que o cria | Fase 1b só faz `ADD VALUE`, sem uso |
| R3 | N orders por intenção quebram o vínculo | `TentativaDePagamento` desde a 1a |
| R4 | Webhook respondendo 4xx ⇒ MP retenta para sempre | Regra de códigos no controller + e2e de order desconhecida |
| R5 | `GET` dentro de `uow.transacao()` (timeout 5s) | Ordem `GET` → transação + teste com latência de 6s |
| R6 | `data.id` lido do corpo ⇒ 401 em 100% | Teste de guard com o request como o Express monta |
| R7 | Comissão líquida decidida depois do 1º lançamento | Líquido persistido desde a Fase 4; Fase 8 bloqueante |
| R8 | AbacatePay **não expõe líquido** | Taxa configurável por env; a conferir com o dono |
| R9 | CSP não aplicada antes do 1º teste de cartão | Front detecta SDK ausente e cai em PIX com mensagem clara |
| R10 | `PAGAMENTO_MANUAL_WHATSAPP` ligado quando o MP subir ⇒ **app não sobe** | Espelhar a checagem em `scripts/deploy.sh` |
| R11 | 429 do MP barra o job de reconciliação | Respeitar `Retry-After`, lote limitado, mais antigo primeiro |

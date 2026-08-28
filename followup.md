# Follow-up — pendências conhecidas e adiadas

Itens levantados e **conscientemente adiados**, para não sumirem. Não é backlog de ideias:
é o que já sabemos que precisa de tratamento e decidimos não tratar agora.

Formato: cada item diz **o que é**, **por que foi adiado** e **o que dispara a retomada**.

---

## 1. Estorno agendado pode falhar por saldo insuficiente

**Contexto:** decisão de 2026-08-26 — quando o admin solicita reembolso, ele é **agendado
para 31 dias** (prazo parametrizável, com opção de executar na hora).

**O problema:** a documentação do Mercado Pago é explícita:

> *"Account balance: you must have sufficient balance available in your account to process
> the refund; otherwise, the transaction will not be completed."*
> — [refunds-cancellations](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/refunds-cancellations)

Um estorno agendado para daqui a 31 dias **falha** se, no dia da execução, o saldo da conta
Mercado Pago tiver sido sacado. Não é hipótese remota: a operação saca para pagar barbeiro.

**Precisa de:** tratamento de falha na execução agendada — realerta ao admin, retentativa, e
uma tela onde estornos agendados que falharam fiquem visíveis. Sem isso o estorno some em
silêncio e o cliente cobra a barbearia.

**Retomada:** junto com a implementação do agendamento de reembolso.

---

### ✅ RESOLVIDO em 2026-08-27 (Fase 9) — e foi tratado desde o primeiro dia

A falha não some em silêncio. `SolicitacaoDeReembolso` ganhou `tentativas`,
`ultimoErro` e o estado `FALHOU`:

- cada falha conta uma tentativa, guarda o erro CRU do gateway e **reagenda** com
  backoff crescente (30 min dobrando, teto de 6 h);
- `MAX_TENTATIVAS_DE_ESTORNO = 8` cobre mais de 24 h — tempo suficiente para a
  causa provável (saldo) se resolver;
- no teto, vai para **`FALHOU`** e PARA. Parar é o ponto: retentar para sempre
  esconderia atrás de um log a única coisa que precisa de gente. `FALHOU` é uma aba
  própria em `GET /pacotes/reembolsos?status=FALHOU`, e o log sobe de WARN para
  ERROR nessa transição;
- reagendar de `FALHOU` **zera** o contador — é uma nova rodada decidida por um
  humano que provavelmente resolveu a causa.

A classificação do erro cru em linguagem de operação
(`motivoOperacionalDoEstorno`, em `contracts`) distingue `SALDO_INSUFICIENTE` —
que o dono resolve sozinho — de `PRAZO_VENCIDO`, `INDISPONIVEL` e `DESCONHECIDO`.
O default é `DESCONHECIDO`, não `INDISPONIVEL`: tratar erro novo como "retentar
resolve" faria o job bater no gateway para sempre por um motivo que nunca vai
passar.

---

## 2. A premissa do prazo de 31 dias não se confirma na documentação

**Contexto:** o prazo de 31 dias foi justificado como "receber juros do valor para pagar a
taxa do Mercado Pago que tivemos de prejuízo".

**O que a documentação diz:** o Mercado Pago **estorna a taxa de venda** junto com o
reembolso, e não cobra tarifa pelo processo
([ajuda/devolver-pagamento](https://www.mercadopago.com.br/ajuda/devolver-pagamento_449),
[ajuda/15863](https://www.mercadopago.com.br/ajuda/15863)). Não há taxa perdida a compensar.

**Status:** o dono foi informado e **manteve a decisão** de ter o agendamento. Fica
registrado para que a justificativa não seja tomada como fato técnico no futuro. O
agendamento continua útil por outros motivos (janela de arrependimento, conferência manual).

**Retomada:** se alguém questionar por que existe o prazo.

---

## 3. Estados de estorno e chargeback não são modelados

**Contexto:** `StatusPagamento` tem `AGUARDANDO | PAGO | EXPIRADO | FALHOU` e, desde
2026-08-26, `EM_ANALISE`. Não há `ESTORNADO` nem `CHARGEBACK`.

**O buraco existe nos dois gateways:**
- AbacatePay: `transparent.lost` (disputa perdida) é no-op com log — DECISOES_PENDENTES #27.
- Mercado Pago: `order.status` inclui `refunded` e `charged_back` (com três `status_detail`:
  `in_process`, `settled`, `reimbursed`), todos hoje sem correspondente.

**Por que foi adiado:** reverter pagamento confirmado é decisão **financeira** — estornar
comissão já lançada, revogar crédito de pacote já consumido. Merece sessão própria.

**Retomada:** primeiro chargeback real, ou quando a integração de reembolso do admin
(item 5) for feita.

---

## 4. O auto-estorno de pagamento fora da janela precisa ser idempotente

**Contexto:** decisão de 2026-08-26 — se o pagamento chega **depois** da janela de 30 min
expirar, o sistema deve **estornar automaticamente** e avisar o cliente para reagendar.

**O risco:** webhooks são reenviados (o Mercado Pago retenta a cada 15 min até receber
200/201). Se o handler dispara o estorno sem registrar que já disparou, **o mesmo pagamento
é estornado duas vezes** — e a segunda chamada falha ou, pior, estorna outra coisa.

**Precisa de:** persistir que o estorno automático já foi solicitado, antes de chamar o
gateway, na mesma transação que marca a intenção. É a mesma disciplina do
`ProcessarWebhookUseCase`, que já é idempotente para confirmação.

**Retomada:** obrigatório na implementação do item 20 — não é adiável, está aqui só para
não ser esquecido no meio do adapter.

---

## 5. Reembolso na tela de admin

**Contexto:** hoje a tela de Reembolsos do admin é **manual** — registra que o dinheiro
voltou, sem chamar gateway nenhum.

**Decidido em 2026-08-26:** integrar com `POST /v1/orders/{id}/refund`, com agendamento
(itens 1 e 2).

**Prazos do Mercado Pago:** crédito **180 dias**, PIX **90 dias**, débito 24 h. Estorno
total (corpo vazio) ou parcial (com `amount` e o id da transação).

**Retomada:** ~~sessão própria~~ — **✅ FEITO em 2026-08-27 (Fase 9)**, no backend.

`POST /pacotes/reembolsos/:id/agendar` (os três botões: agendar com o prazo padrão,
antecipar com `prazoDias: 0`, tentar de novo depois de `FALHOU`),
`POST .../cancelar-agendamento`, e `GET /pacotes/reembolsos?status=…` para as abas.
A execução é do job `ExecutarReembolsosAgendadosJob` (a cada 10 min), com estorno
**parcial** (o saldo residual, não o pagamento inteiro) e chave de idempotência
estável — sem ela um job de 10 em 10 minutos devolveria em dobro.

**A TELA foi feita na Fase 10** (2026-08-27): três abas em
`apps/admin/src/screens/Reembolsos.tsx`, com o selo vermelho de contagem na aba
"Falhados" e a pendência na home do admin. Fechado.

Cobertura: 31 testes de domínio, 24 de aplicação, 13 de config, 6 em contracts, 8
da tabela de ações do admin, e 11 e2e (10 no fluxo de estorno + 1 na home).

---

## 6. Cartão salvo (tokenização recorrente)

**Contexto:** fora de escopo por decisão de 2026-08-26. A Orders API suporta
(`/v1/customers`, `/v1/customers/{id}/cards`).

**O que foi feito agora:** a porta `PaymentGateway` deve ser desenhada de modo a acomodar
isso depois **sem reforma** — mas nada foi implementado.

**Retomada:** quando houver demanda real de recompra rápida.

---

## 7. CSP e CloudFront — ação do dono, fora do código

**Contexto:** os frontends servem por CloudFront. O cartão de crédito exige carregar o SDK
do Mercado Pago no browser e abrir um iframe de 3DS.

**Domínios a liberar** (detalhamento na seção do Mercado Pago em `RELATORIO_SESSAO.md`):

| diretiva CSP | domínio | para quê |
|---|---|---|
| `script-src` | `https://sdk.mercadopago.com` | SDK JS v2 (`/js/v2`) |
| `connect-src` | `https://api.mercadopago.com` | tokenização do cartão pelo browser |
| `frame-src` | `https://www.mercadopago.com.br` | iframe do desafio 3DS |
| `img-src` | `https://http2.mlstatic.com`, `https://img.mlstatic.com` | logos de bandeira |

Nota: **não é preciso** adicionar o `security.js` do Device ID separadamente — a
documentação diz que, usando o SDK JS, o Device ID já é obtido por padrão.

**Retomada:** antes do primeiro teste de cartão em staging.

---

## 8. Caixa do `data.id` na assinatura — risco mitigado, validação vira confirmação

**Contexto:** a documentação do Mercado Pago manda **minusculizar** o `data.id` no manifesto
(`ORD01J…` → `ord01j…`). O SDK oficial Node ≥3.2.0 **removeu** essa minusculização (PR #439),
assinando o valor cru. Como todo id de Order chega em caixa alta, as duas leituras divergem em
**100%** das notificações — e uma das duas está errada.

**Solução adotada (2026-08-26):** o verificador aceita **as duas variantes**. Ele monta o
manifesto com o `data.id` minúsculo e com o cru, e aprova se qualquer um dos dois HMACs bater.

**Por que isso não afrouxa a autenticação:** as duas variantes derivam do **mesmo dado
recebido**, e o atacante continua tendo que forjar um HMAC-SHA256 válido **com o secret**. O
ganho para um ataque de força bruta é um fator 2 sobre um espaço de 256 bits — irrelevante.
O que se elimina é o risco real: escolher a variante errada e ter **todo webhook respondendo
401, com nenhum pagamento confirmando** — falha silenciosa, a mesma classe de bug que o
DOMAIN.md §3.8 documenta para a AbacatePay.

**O que ainda vale fazer (não bloqueante):** confirmar empiricamente qual variante o Mercado
Pago usa de fato, via "Simular notificação" no painel ou pela tool
`notifications_history_diagnostics` do MCP Server. Serve para registrar a verdade e, no
futuro, simplificar o verificador para uma variante só.

---

## 11. A suíte de integração é FLAKY sob carga — e isso não é do Mercado Pago

**Medido em 2026-08-27**, com Postgres local no ar:

| cenário | falhas por rodada |
|---|---|
| suíte **sem** `webhook-mercadopago.e2e.spec.ts` | 1, 0 |
| suíte **com** ele | 2, 1, 13 |

As falhas são sempre `ECONNRESET` ou `Timeout`, sempre em arquivos
PRÉ-EXISTENTES (concentradas em `sem-preferencia.e2e.spec.ts`), e **nunca** em
asserção de lógica. Testes diferentes falham a cada rodada.

**Por que é starvation, e não lentidão:** o teste que mais falha leva **90ms**
isolado, contra um `testTimeout` default de **5000ms**. Um timeout ali sob carga é
55× a duração normal — isso é fila por recurso, não código lento.

**A causa estrutural:** 95 arquivos e2e rodam no MESMO processo
(`fileParallelism: false`, necessário porque compartilham um Postgres), cada um
criando seu app Nest e seu pool do Prisma. O pool default do Prisma é
`cpus*2+1` (21 nesta máquina) e o `max_connections` do Postgres é 100. A margem é
estreita, e cada arquivo novo a reduz.

**O que já foi feito:** o e2e do Mercado Pago foi reescrito para reaproveitar UMA
venda de pacote com reset da intenção via Prisma, em vez de 20 vendas por HTTP.
Ajudou, mas não resolveu — o custo é a existência do arquivo (um app + um pool),
não o número de requisições dentro dele.

**O que NÃO funciona:** `connection_limit=5` na `DATABASE_URL` piora muito
(centenas de testes *skipped* em cascata, porque hooks começam a falhar).

**Precisa de:** decisão de infraestrutura de teste, não de código de produção.
Candidatos, do mais simples ao mais invasivo: (a) `testTimeout` maior para a pasta
`test/integration`; (b) `connection_limit` ajustado com medição, entre 5 e 21;
(c) `max_connections` maior no compose de dev; (d) agrupar e2e em menos arquivos,
compartilhando um app.

**Por que importa:** enquanto isso não for resolvido, "todos os testes verdes"
não é uma afirmação verificável nesta suíte — o resultado varia entre execuções
idênticas.

---

### ✅ RESOLVIDO em 2026-08-27 (Fase 8) — duas causas, as duas medidas

O que faltava era o diagnóstico, não a coragem de mexer. A medição decisiva:

| como roda | resultado |
|---|---|
| só `@bigods/api` (`npx vitest run`) | **1362/1362 verde, repetidamente** |
| pelo `turbo` (5 pacotes de teste em paralelo) | 2 a 4 falhas por rodada |

Arquivos DIFERENTES a cada execução, nunca falha de asserção. Dois sintomas
distintos, com causas distintas:

**1. `Test timed out in 5000ms`** — com tempos de 5003 e 5006 ms, batendo exatamente
no limite. Os mesmos testes levam **menos de 100 ms** isolados. Não são lentos: são
99 apps Nest num processo competindo por CPU com outros quatro processos de vitest.
O limite de 5 s era uma aposta sobre a velocidade da máquina, não sobre a correção
do teste. → `testTimeout: 20_000` em `apps/api/vitest.config.ts`. Não esconde
lentidão: o vitest imprime a duração de cada teste, e algo que passe a levar 20 s é
bug de verdade.

**2. `ECONNRESET: Connection reset by peer`, em 8 ms** — não é lentidão, é conexão
recusada. `max_connections` estava no default (**100**), e cada um dos 99 arquivos
e2e sobe o AppModule com o seu pool do Prisma. Com `fileParallelism: false` roda um
por vez, mas o `app.close()` libera as conexões de forma assíncrona: elas acumulam
mais rápido do que drenam. → `command: postgres -c max_connections=300` no
`docker-compose.yml`. **Desenvolvimento apenas** — produção é RDS, com parameter
group próprio.

`connection_limit` menor no Prisma foi tentado antes e **piorou** (centenas de skips
em cascata) — está registrado aqui para ninguém repetir.

**3. A causa RAIZ, que as duas primeiras só mascaravam: `fsync`.** Achada no log do
próprio Postgres, e é o achado que explica tudo:

```
checkpoint complete: wrote 334 buffers (2.0%); write=34.627 s, total=34.650 s
checkpoint complete: wrote 265 buffers (1.6%); write=27.665 s, total=27.692 s
```

**27 a 35 segundos** para escrever ~2 MB, com `docker stats` mostrando 3% de CPU e
48 MB de RAM. Não falta CPU nem memória — falta `fsync`: o volume do Docker Desktop
no macOS é virtualizado e tem throughput de sincronização péssimo. Enquanto um
checkpoint desses roda, TODA escrita bloqueia, e o teste que estava no ar naquele
instante estoura. Daí a aleatoriedade aparente: o arquivo que falha é simplesmente
o que teve o azar de coincidir com o checkpoint.

→ `fsync=off`, `synchronous_commit=off`, `full_page_writes=off`,
`max_wal_size=2GB`, `checkpoint_timeout=30min` no `docker-compose.yml`. Num banco de
desenvolvimento cuja recuperação é `docker compose down -v && migrate deploy`, perder
durabilidade não é risco — é o procedimento normal. **Produção é RDS**, configurada
por parameter group; este arquivo não a toca.

**Resultado medido:** 14 falhas → 1, e os checkpoints lentos desapareceram do log.

### Estado atual (honesto)

| comando | resultado |
|---|---|
| `npm run test` (a suíte canônica do monorepo) | **1592/1592 verde**, repetidamente |
| `npm run test:multitz` — 1ª TZ | **1362/1362 verde** |
| `npm run test:multitz` — 2ª e 3ª TZ | **1 falha intermitente**, sempre em `sem-preferencia.e2e.spec.ts` |

**O que sobrou, e o que já se sabe dele:** o `test:multitz` roda três suítes inteiras
em sequência contra o MESMO banco, sem intervalo. A primeira passa limpa; uma
subsequente falha um teste de `sem-preferencia.e2e.spec.ts` em ~10 ms — rápido demais
para ser timeout, e o `afterAll` do arquivo limpa por `companyId`, que é UUID novo a
cada rodada. Ou seja: **não é mais o mesmo problema**, e a hipótese de sobra de dados
entre rodadas não se sustenta como estava.

Também vale registrar que boa parte das medições anteriores desta investigação foram
poluídas por rodar `vitest` do diretório errado (a raiz do monorepo, que globa todos
os workspaces e produz cascatas de `skipped` sem relação com o problema). Qualquer
medição nova precisa ser feita de `apps/api` ou pelo script do package.

### Medição adicional em 2026-08-27 (Fase 9)

A afirmação de que `npm run test` era determinístico **não se sustentou**. Com a
suíte crescida (1438 testes na api), a incidência medida em 6 execuções foi de
**cerca de 1 falha a cada 3 ou 4 rodadas**, e três rodadas seguidas verdes não
provam nada — foi exatamente o que aconteceu ao tentar reproduzir sob demanda.

O padrão não mudou: quase sempre `sem-preferencia.e2e.spec.ts`, ocasionalmente
`conta-cockpit` ou `order-bump`, com `socket hang up`, timeout ou 500 vindo direto
do Prisma. Nunca falha de asserção, nunca o mesmo teste duas vezes.

**Descartado nesta rodada:** o job novo da Fase 9
(`ExecutarReembolsosAgendadosJob`) era suspeito por ser o primeiro `@Cron` de 10
minutos registrado incondicionalmente — todo e2e que sobe o `AppModule` passa a
registrá-lo. Não é ele: a mesma flakiness aparece em arquivos que não tocam
reembolso, e `sem-preferencia` já falhava assim antes da Fase 7.

### ★ A mensagem de erro FOI capturada — e corrige um diagnóstico anterior

```
FAIL  test/integration/sem-preferencia.e2e.spec.ts
      > Atribuição na confirmação > ninguém livre no horário
Error: ECONNRESET: Connection reset by peer
 ❯ Test.assert          node_modules/supertest/lib/test.js:187:20
 ❯ localAssert          node_modules/supertest/lib/test.js:138:14
 ❯ fn                   node_modules/supertest/lib/test.js:156:7
 ❯ Test.callback        node_modules/superagent/src/node/index.js:904:3
 ❯ ClientRequest.<anon> node_modules/superagent/src/node/index.js:817:10
```

**A pilha é inteira do `supertest`/`superagent`.** Ou seja: a conexão que foi
resetada é a **HTTP, entre o supertest e o servidor Nest em processo** — não uma
conexão com o Postgres.

★ Isso **corrige** o que ficou escrito acima. O `ECONNRESET` foi atribuído a
esgotamento de `max_connections` do Postgres, e o teto foi subido para 300 nessa
base. A mudança pode ter ajudado outros sintomas (e é inofensiva), mas **a razão
declarada estava errada para este erro**: o socket que morre é de loopback HTTP, e
morre em 13 ms.

**O que isso muda na investigação:** a hipótese útil passa a ser do lado do
servidor HTTP em processo — app Nest fechado com requisição em voo, `keepAlive`
do Node, ou esgotamento de descritores de arquivo com 102 servidores efêmeros
criados no mesmo processo. Nada disso tem a ver com banco, e é por isso que
`fsync=off` e `max_connections=300` reduziram mas não zeraram.

**Retomada:** antes de confiar em qualquer suíte com banco como gate de CI. O
próximo passo concreto agora é instrumentar o lado do servidor —
`server.on('clientError')` e contagem de handles abertos entre arquivos — em vez de
seguir mexendo em Postgres, que já foi descartado como causa deste sintoma.

---

## 9. Throttle do endpoint de cartão é por ORIGEM, não por intenção

**Contexto:** `POST /public/pagamentos/:intencaoId/cartao` (2026-08-27) limita 10
tentativas por 10 minutos **por IP**, usando o `@Throttle` que o projeto já usa.

**O que fica de fora:** um throttle por `intencaoId`. O `intencaoId` é a
*capability* deste fluxo — quem o obtém (print, URL compartilhada, extensão de
browser) consegue **queimar a intenção** disparando tentativas até estourar o
limite do gateway, mesmo sem conseguir pagar. Com cartão e `capture_mode:
automatic` isso é pior que no PIX, onde o dano de vazamento era nulo.

**O que já protege:** o id é `randomUUID()` (adivinhar é inviável); há trava de
"uma tentativa viva por vez"; a janela de 30 min não renova; e o gateway devolve
`max_attempts_exceeded`, que o backend traduz em `podeTentarNovamente: false`.

**Precisa de:** um tracker próprio no `ThrottlerGuard` que use o parâmetro de rota
como chave em vez do IP. Não é difícil, mas é código de infraestrutura de
throttling que o projeto ainda não tem, e a proteção acima cobre o caso realista.

**Retomada:** se aparecer abuso real, ou junto de qualquer outra necessidade de
throttle por recurso.

---

## 10. Contradição na documentação: tamanho do `X-Idempotency-Key`

A referência do `create-order` diz, **na mesma página**, dois valores diferentes: a descrição
do header diz "between 1 and 64 characters"; a tabela de erros, no código
`invalid_idempotency_key_length`, diz "between 1 and 150 characters". Os demais endpoints
(cancel, refund, capture, add-transaction, update-transaction) todos dizem 64.

**Mitigação já adotada:** usar UUID v4 (36 caracteres), que cabe nos dois limites. Nenhuma
ação necessária — registrado para que ninguém "otimize" a chave para algo maior depois.

---

## 12. Qual CAMADA de status o Mercado Pago realmente devolve

**Contexto:** a tabela de `mercadopago-status.ts` passou a aceitar DUAS grafias do
mesmo fato (2026-08-27): a da camada de `order` (`failed/high_risk`) e a da camada
de `transactions.payments[]` (`rejected/cc_rejected_high_risk`). São 49 entradas
onde a doc de order sozinha justificaria 25.

**Por que foi feito assim:** o adapter lê `transactions.payments[0].status` ANTES
de `order.status`, e a documentação mistura as camadas — a própria tabela de order
tem `failed/cc_rejected_3ds_challenge`, uma chave mista vinda do guia de 3DS. Com a
tabela estrita, **todo cartão recusado** caía no `throw` de combinação desconhecida
e o cliente recebia **503**. A assimetria decidiu: aceitar e o gateway nunca mandar
custa entradas mortas; recusar e ele mandar custa 503 no caminho mais comum de
recusa. Mesma disciplina da caixa do `data.id` (#8).

**O que fazer em staging:** com uma cobrança de cartão recusada de verdade (o painel
tem cartões de teste que forçam recusa), ler no banco o `statusDetalhe` gravado em
`TentativaDePagamento` e conferir qual grafia chegou. Aí apagar a metade que não
vem, e o cadeado de contagem (`toHaveLength(49)`) força a decisão a passar por
revisão.

**Não é urgente:** as entradas extras não mudam desfecho nenhum — as duas grafias do
mesmo fato mapeiam para o mesmo `StatusPagamento`, e há teste provando isso.

---

## 13. ✅ RESOLVIDO — pagamento com cartão era registrado como `FormaPagamento.PIX_ONLINE`

**Fechado em 2026-08-27, junto da Fase 8**, como previsto. `IntencaoDePagamento`
ganhou a coluna `meio` (migration aditiva `20260827040100_comissao_liquida_campos`),
preenchida na criação da cobrança — que é o instante em que o trilho fica decidido.
`ConcluirAtendimentoUseCase` passou a traduzi-la (`formaDoTrilhoOnline`): cartão grava
`CARTAO_CREDITO`, PIX grava `PIX_ONLINE`, e `null` (linha antiga ou modo manual) cai
em `PIX_ONLINE`, que é o que essas linhas de fato foram — sem backfill.

Coberto por dois e2e em `caixinha-e-desconto.e2e.spec.ts`: o caso do cartão e a
não-regressão do PIX.

O texto original fica abaixo, como registro do que era o problema.

### (original)

**Onde:** `concluir-atendimento.usecase.ts:103` —
`valorPagoOnline > 0 ? FormaPagamento.PIX_ONLINE : FormaPagamento.SALDO_RESIDUAL`.

**O problema:** com o trilho de cartão (2026-08-27) existe pagamento online que NÃO
é PIX, e o atendimento é registrado como se fosse. Não afeta dinheiro nem comissão —
o valor é o mesmo —, mas polui qualquer leitura futura por forma de pagamento, e o
enum `FormaPagamento` já tem `CARTAO_CREDITO`.

**Por que não foi corrigido agora:** a informação de QUAL trilho pagou vive em
`TentativaDePagamento.meio` / `IntencaoDePagamento`, e levá-la até a conclusão do
atendimento é a mesma costura que a **Fase 8** (comissão sobre o líquido) já vai
abrir naquele arquivo. Fazer duas vezes o mesmo caminho no ledger imutável de
comissão é pior que fazer uma.

**Retomada:** junto da Fase 8, no mesmo commit que passa o líquido para o
lançamento.

---

## 14. O WhatsApp da barbearia ainda está hardcoded no funil

**Onde:** `apps/booking/src/lib/barbearia.ts` — `whatsapp: 5511990036469`.

**O que mudou em 2026-08-27 (Fase 11):** a conta do cliente precisou do mesmo
número (botão "falar com a barbearia" no card de reembolso em análise), e em vez
de copiá-lo para um segundo bundle ele passou a ser servido pela API em
`/public/empresa`, a partir de `BARBEARIA_WHATSAPP` (com fallback para
`PAGAMENTO_MANUAL_WHATSAPP_NUMERO`, que é o mesmo telefone).

**O que fica pendente:** o funil continua lendo do arquivo hardcoded. Não é
urgente — é o mesmo número —, mas são duas fontes para o mesmo fato, e o dia em
que a barbearia trocar de telefone só uma delas vai ser atualizada.

**Retomada:** junto de qualquer mexida em `barbearia.ts`, ou quando os outros
campos dele (endereço, Instagram) também virarem cadastro.

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

## 4. Foto do barbeiro no funil — ✅ RESOLVIDO (2026-08-19)

A etapa de seleção de barbeiro no protótipo mostra foto do profissional, mas o agregado `Barbeiro` (DOMAIN.md §3.2) **não modelava foto**. Não inventei um campo de domínio.

**Resolvido em 2026-08-19:** `Barbeiro.fotoUrl` (e `Produto.fotoUrl`), com camada de storage em S3 — validação por conteúdo, otimização para WebP 512px e "trocar apaga a anterior". Ver DOMAIN.md §3.14. O avatar de iniciais **continua existindo** como fallback: foto é opcional, e imagem quebrada nunca aparece.

O que destravou: um bucket de uploads **separado** dos buckets de frontend. O impedimento antigo era que o deploy dos frontends roda `aws s3 sync --delete` e apagaria as fotos.

## 5. "1 mês" como período máximo de consulta da agenda

O pedido foi "poder filtrar por período de no máximo 1 mês", sem precisar se é mês-calendário (28–31 dias variável, ex: de 15/fev a 15/mar) ou uma janela fixa de dias corridos.

**Mínimo implementado:** 31 dias corridos fixos, inclusive nas duas pontas (`PERIODO_MAXIMO_DIAS` em `atendimentos.controller.ts`). É uma regra de projeção de leitura (DOMAIN.md §2.1), não invariante de domínio — trivial de ajustar depois se o negócio quiser outro critério.

## 6. "Admins" vs. "barbeiros" no seed — acumulam papel ou não?

O pedido diz "2 admins... e 2 barbeiros fictícios", em contraste com o Gabriel já existente, que acumula `ADMIN`+`BARBEIRO` (é sócio e corta cabelo). Não havia como saber se os 2 novos admins deveriam também atender clientes.

**Mínimo implementado:** LKT e Rafael Grigio têm **só** o papel `ADMIN` — acesso total ao painel, mas não aparecem nos seletores de barbeiro para agendar (comissão padrão 0%, sem `servicosAtendidos`, sem disponibilidade). Os seletores de barbeiro para agendamento (`Agenda`, `Pacotes`) e a lista/filtro de comissão agora filtram por `papeis.includes('BARBEIRO')`, para não oferecer um admin puro como opção de quem vai cortar o cabelo. Se o negócio quiser que LKT/Rafael também atendam, basta adicionar o papel `BARBEIRO` + serviços + disponibilidade (a estrutura já suporta, sem migração).

## 7. Momento exato em que `Cliente.cognitoSub` é preenchido

O DOMAIN.md §3.4 diz que o cliente "vira usuário Cognito (cognitoSub preenchido) no momento em que compra um pacote". A infraestrutura de identidade desta sessão **refina** isso por segurança: comprar o pacote **provisiona** o usuário externo (cria a possibilidade de login), mas o `cognitoSub` só é gravado quando o cliente **confirma o código OTP** e prova posse do telefone. Preencher antes permitiria "sequestrar" o telefone de outra pessoa (basta comprar um pacote informando o número alheio).

**Implementado:** `OnPacoteVendidoHandler` chama `identity.provisionarUsuario(...)` (não seta cognitoSub); `ConfirmarLoginClienteUseCase` chama `promoverParaUsuario(sub)` na confirmação. A `docs/DOMAIN.md` §3.4 continua válida no espírito (compra de pacote = ganha direito a login); a pendência é só confirmar com o negócio se o refinamento "cognitoSub na confirmação, não na compra" está ok — é a leitura segura e foi pedida explicitamente no brief desta sessão.

## 8. Fluxo do Cognito: Custom Auth Challenge vs. SMS_OTP nativo

Para o login sem senha por telefone no Cognito, há duas abordagens: **(a)** Custom Auth Challenge (`CUSTOM_AUTH`) com 3 Lambda triggers, ou **(b)** o novo fluxo nativo `USER_AUTH`/`SMS_OTP` (sem Lambdas, mas exige tier Essentials/Plus e feature recente habilitada).

**Implementado:** abordagem (a) — `CognitoIdentityProvider` usa `CUSTOM_AUTH`, e os Lambdas estão prontos em `infra/cognito-triggers/`. Escolha por **portabilidade**: roda em qualquer User Pool, é o padrão universalmente documentado, e o brief antecipou os Lambda triggers como artefato.

**A confirmar com o Rafael quando o pool estiver pronto:** se o pool já tiver o `SMS_OTP` nativo disponível, ele é operacionalmente mais simples (não há Lambdas para manter). Migrar para ele mexe **só** no `CognitoIdentityProvider` (trocar os comandos do SDK) — a interface `IdentityProvider` e todo o resto ficam iguais. Decisão de operação, não de domínio.

## 9. Teste ponta-a-ponta contra o SANDBOX real do AbacatePay — AINDA PENDENTE DE CREDENCIAL (atualizado, sessão de ligação do pagamento online)

O gateway real (`AbacatePayGateway`, Checkout Transparente v2) e o webhook
validado por assinatura estão implementados e cobertos por testes com HTTP
mockado (`abacatepay.gateway.spec.ts`, `abacatepay-webhook.verifier.spec.ts`)
e por e2e com payload v2 assinado à mão, secret de query + HMAC com a chave
pública real da AbacatePay (`webhook-abacatepay.e2e.spec.ts`,
`pacote-publico.e2e.spec.ts`). **Não** existe ainda o teste que gera uma
cobrança real no sandbox do AbacatePay e simula o pagamento pelo endpoint
deles, porque **não há credencial de sandbox** (`ABACATEPAY_API_KEY`/
`ABACATEPAY_WEBHOOK_SECRET` de teste) no ambiente onde os testes rodam —
confirmado ausentes tanto em `.env` quanto nas variáveis de ambiente do shell
nesta sessão.

**Ação:** assim que a key de sandbox estiver disponível no ambiente de teste,
esse é o **primeiro** teste a rodar de verdade — cobrança real via
`POST /v2/transparents/create` → `simularPagamento(gatewayId)`
(`POST /v2/transparents/simulate-payment?id=...`) → webhook `transparent.completed`
real confirma → pacote libera créditos. A infraestrutura já está pronta
(`AbacatePayGateway.simularPagamento` existe justamente para isso); ver o
roteiro de smoke test manual em `RELATORIO_SESSAO.md` para o dono rodar com o
dashboard da AbacatePay aberto.

## 10. Versão/base da API do AbacatePay — ✅ RESOLVIDO (sessão de ligação do pagamento online): v2, Checkout Transparente

Confirmado contra a documentação oficial + OpenAPI da AbacatePay (clonados e
lidos, não presumidos): a conta está configurada com webhook **v2**, assinando
**apenas** `transparent.completed` e `transparent.lost` (Checkout Transparente).
O modo hospedado (`checkout.*`) emitiria eventos que não estão assinados nesta
conta — usá-lo faria o pagamento nunca confirmar (falha silenciosa). Adotado
definitivamente:

- Base: `https://api.abacatepay.com/v2` (default de `AbacatePayGateway`,
  overridável por `ABACATEPAY_BASE_URL`).
- Criação: `POST /transparents/create`, corpo
  `{ method: "PIX", data: { amount, expiresIn, description, externalId } }` —
  `externalId` é campo **direto** de `data` (não `data.metadata.externalId`
  como se presumia antes desta sessão).
- Resposta: `{ data: { id, brCode, brCodeBase64, status, expiresAt, ... } }`,
  mapeados para `CobrancaPix.{gatewayId, copiaECola, qrCode, expiresAt}`.
- Simulação sandbox: `POST /transparents/simulate-payment?id=<gatewayId>`.
- Webhook v2: `{ id, event, apiVersion: 2, devMode, data: { transparent: { id,
  externalId, amount, paidAmount, status, ... } } }` — `externalId` sempre lido
  de `data.transparent.externalId` (ver `webhooks.controller.ts`).
- Assinatura: **dois mecanismos obrigatórios (AND)** — secret compartilhado na
  query string `?webhookSecret=...` (nosso `ABACATEPAY_WEBHOOK_SECRET`) **e**
  HMAC-SHA256 em base64 no header `X-Webhook-Signature`, calculado com a
  **chave pública fixa da AbacatePay** (não o nosso secret) — ver
  `abacatepay-webhook.verifier.ts`.

Nada disso é mais uma suposição a confirmar — é a configuração real cadastrada
pelo dono no dashboard da AbacatePay.

## 12. Catálogo de ofertas de pacote (`PacoteOferta`) não é modelado no domínio — ✅ RESOLVIDO (sessão-B, Fase 1)

~~O funil pede "ofereça pacotes daquele serviço com o desconto vs. avulso visível~~
~~(dado que já existe no catálogo)". Mas o DOMAIN.md não modela template/catálogo~~
~~de pacote...~~

**Resolvido na sessão-B:** `PacoteOferta` virou agregado de domínio de primeira
classe (§3.11 do DOMAIN.md) — dono (`barbeiroId`), composição MISTA, preço como
única fonte de verdade (percentual sempre derivado), workflow de aprovação
(§4.3), CRUD completo no admin. Todas as três perguntas abertas aqui foram
respondidas pelo brief explícito da sessão-B: (a) preço é sempre o que se
persiste, dois modos de ENTRADA (%/R$) só no frontend; (b) CRUD implementado
(barbeiro dono ou admin criam/editam; só admin aprova); (c) sim, virou catálogo
de primeira classe. Mantido aqui riscado por histórico — não reabrir sem motivo novo.

## 11. Webhook do AbacatePay só é MONTADO com o gateway real

Com `PAYMENT_GATEWAY=fake` (default fora de produção) o `WebhooksController` **não
é montado** — nenhuma superfície de webhook é exposta em demo, como pedido. A
decisão de montar lê `PAYMENT_GATEWAY` na avaliação do módulo; em produção (build
CommonJS) a ordem de carga garante que a env já está setada. Além disso, mesmo se
exposto, o guard **falha fechado** sem `ABACATEPAY_WEBHOOK_SECRET` (401), e o boot
recusa subir com o gateway real sem o secret — dupla proteção.

## 13. Produtos: SEM controle de estoque (decisão consciente, pedida explicitamente)

O brief da sessão 2026-07-16 pediu venda de produto "mínima, SEM estoque" de forma
explícita — não é uma pendência de descoberta, é uma restrição de escopo dada. Documentado
aqui só para reforçar: **não implementar** quantidade, fornecedor, entrada/saída de
estoque nem alerta de reposição, mesmo que pareça óbvio depois de ter o CRUD de produto
pronto. Ver DOMAIN.md §11 (fora de escopo).

**Quando reconsiderar:** se o volume de venda de produto justificar controlar quantidade
(medir primeiro, mesma filosofia do §4.2 sobre `saldoResidual` — não automatizar um
caminho antes de saber a frequência real).

## 14. CRUD de ofertas de pacote (DECISOES #10) e CRUD de produtos: consistência a médio prazo — ✅ RESOLVIDO (sessão-B, Fase 1)

~~A sessão de pacotes (2026-07-15) deixou PacoteOferta como read model só-seed...~~

**Resolvido:** `PacoteOferta` ganhou CRUD completo no admin (sessão-B, ver #12
acima) — já não é mais a exceção "só editável no banco/seed". Consistente com
`Produto`/`Servico` (mesmo padrão de soft-disable + CRUD).

## 15. Granularidade do expediente: uma janela por dia na UI do admin

O agregado `ExpedienteSemanal` suporta **múltiplas janelas por dia** (ex.: manhã e
tarde com intervalo no meio) — a invariante de domínio já cobre isso (sem sobreposição
entre janelas do mesmo dia). A UI de admin implementada nesta sessão (`Ajustes →
Expediente semanal`) permite editar só **uma janela por dia**, o suficiente para os
casos reais do seed (Gabriel/Lucas/Pedro, cada um com um único turno). Se a barbearia
precisar de um barbeiro com dois turnos separados por um intervalo (ex.: 9h–12h e
14h–18h), o backend já suporta via API (`PUT /expediente/:barbeiroId` aceita array de
janelas por dia) — só a UI precisa de um "+ adicionar janela" por dia, deixado de fora
por não haver caso de uso real observado ainda (mesma filosofia de "medir antes de
automatizar" do §4.2).

## 16. Nome placeholder para Cliente criado só pelo login (bug 2, sessão 2026-07-20)

Corrigindo o bug de telefone sem conta ficar preso no OTP, o login por telefone passou
a criar um `Cliente` na hora da confirmação do código, mesmo quando a pessoa nunca
comprou nada (nem pacote, nem avulso) — antes disso só existiam dois caminhos de criação
de `Cliente`, ambos com nome vindo de um formulário de compra (`agendar-avulso` /
`vender-pacote`). Login sozinho não coleta nome nenhum.

**Mínimo implementado:** `nome: 'Cliente'` fixo (`confirmar-login-cliente.usecase.ts`).
Não há tela de edição de perfil no cockpit para a pessoa corrigir isso depois.

**Quando reconsiderar:** se esse caminho (login sem compra prévia) virar comum na
prática — hoje ele existe mais como rede de segurança de UX (não deixar ninguém preso no
OTP) do que como um fluxo de cadastro esperado — vale adicionar um passo de "como você se
chama?" no onboarding do cockpit, ou uma tela de editar nome/perfil.

## 17. RASCUNHO de `PacoteOferta`: nenhum gatilho de UI o produz (sessão-B, Fase 3)

O brief da sessão-B listou os 4 estados da máquina de aprovação (RASCUNHO →
PENDENTE_APROVACAO → APROVADO | REJEITADO) mas só descreveu o gatilho de criação
como "barbeiro cria/edita → PENDENTE" — nenhuma menção a um fluxo de "salvar
como rascunho" separado de "enviar pra aprovação". Por CLAUDE.md ("não invente
decisão de domínio"), implementei o mínimo que a máquina de estado exige
(`RASCUNHO` existe, `enviarParaAprovacao()` existe e é testado) sem inventar
uma tela/checkbox de "salvar rascunho" no admin.

**Mínimo implementado:** `PacoteOferta.criar()` sempre nasce em
`PENDENTE_APROVACAO` por padrão; `RASCUNHO` só é alcançável passando o status
explicitamente (hoje, só usado em teste de domínio). Nenhuma UI cria um
rascunho.

**A confirmar com o negócio:** se barbeiros vão querer montar uma oferta aos
poucos (nome + composição parcial) antes de mandar pra aprovação — se sim, cabe
um botão "salvar rascunho" separado de "enviar" na UI, usando o
`enviarParaAprovacao()` que já existe no domínio.

## 18. Preço por barbeiro (`precoPara`) estendido ao agendamento avulso direto — ✅ RESOLVIDO (sessão-C)

~~O brief da Fase 2 pediu explicitamente: "o rateio de pacote passa a usar o
preço DO BARBEIRO". Não pediu (e eu não estendi) o mesmo pro preço de um
`Atendimento` avulso agendado direto — inconsistência observável: dois
barbeiros com preços diferentes pro mesmo serviço cobravam igual no avulso,
mas o mesmo pacote rateava diferente entre eles.~~

**Resolvido na sessão-C:** decisão de negócio confirmada pelo dono — preço
por barbeiro vale GERAL, inclusive avulso. `precoDeReferencia(servico,
barbeiro)` (antes só usada no rateio de pacote) agora também alimenta:
`AgendarAvulsoUseCase` (valorCobrado do item), `AdicionarItemAtendimentoUseCase`
(walk-in add-on) e `GET /public/servicos` (preço exibido no funil, já
filtrado pelo barbeiro escolhido). `AgendarComCreditoUseCase` **não precisou
mudar** — já usava `item.valorRateado`, o valor congelado na venda, nunca
recalculado do catálogo (snapshot, §3.5). Testado ponta-a-ponta (não só a
função isolada) em `preco-por-barbeiro.e2e.spec.ts`: mesmo serviço com preço
diferente entre dois barbeiros via `GET /public/servicos`; mesma composição de
oferta comprada com dois barbeiros gera rateios diferentes; avulso pelo funil
público cobra o override, não a referência.

## 19. Resgate cruzado de crédito entre barbeiros (sessão-B, Fase 2 — fora de escopo explícito)

`VendaDePacote.barbeiroId` (Fase 2) trava o consumo do crédito ao barbeiro
dono — `agendarItem` recusa qualquer outro barbeiro
(`InvarianteVioladaError`). O brief pediu explicitamente que isso ficasse
**fora desta sessão**, registrado como decisão futura. Ver DOMAIN.md §11.

**Quando reconsiderar:** se um cliente comprar um pacote com um barbeiro e
depois quiser (ou precisar, por exemplo se o barbeiro sair da empresa) usar o
crédito com outro, alguém vai ter que decidir como isso afeta o rateio já
congelado (recalcular? manter o valor rateado original mesmo cobrando de um
barbeiro diferente pro qual o serviço custa outra coisa?). Não é só destravar
a invariante — é uma decisão de precificação nova.

## 20. Slug do barbeiro: unicidade só por empresa, não global (sessão-B, Fase 4b)

`Barbeiro.slug` é único por `(companyId, slug)`, não globalmente — decisão de
implementação (não de domínio) consistente com a costura de multi-tenant do
resto do sistema (§2.4: `companyId` em todo agregado, sem isolamento dinâmico
de tenant). Como só existe uma `Company` semeada hoje, essa distinção não é
observável na prática, mas fica registrada pra não ser "corrigida" por engano
numa sessão futura que mexa em multi-tenant de verdade.

## 21. Prazo de 45 dias para reembolso quando a venda tem MÚLTIPLOS itens expirados em datas diferentes (sessão-E, FASE 4b)

O brief pediu "prazo de 45 dias a contar da EXPIRAÇÃO do item que gerou o saldo" — frase que
pressupõe implicitamente um único item/uma única expiração. `saldoResidual` é um **pool fungível**
(§3.6): quando um segundo item do mesmo pacote expira meses depois do primeiro, os dois valores se
somam no mesmo `saldoResidual`, sem rastro de qual centavo veio de qual item.

**Mínimo implementado:** `VendaDePacote.saldoResidualDesde` guarda a expiração **mais recente**
(atualizado toda vez que `expirarItem` roda) e o prazo de 45 dias conta a partir dela — a leitura
mais **generosa** possível ao cliente (a alternativa, contar da mais antiga, encurtaria o prazo
disponível pra parte do saldo). Ver `docs/DOMAIN.md` §8.7.

**A confirmar com o negócio:** se o critério correto for por item (cada fatia do saldo com seu
próprio prazo, exigindo rastrear a origem de cada centavo dentro do pool) ou a partir da data do
**pedido** de reembolso em vez da expiração — qualquer um dos dois exigiria um redesenho do
`saldoResidual` de "pool único" para "lista de créditos com prazo individual", mudança de modelo,
não só de regra.

## 22. Reagendar (cockpit) de um avulso PAGO ONLINE não devolve nem reaplica o pagamento (sessão-E, FASE 3)

`ReagendarAtendimentoClienteUseCase`, caminho `AVULSO`: cria o novo atendimento via
`AgendarAvulsoUseCase` com `gerarCobranca: false` (nunca cobra de novo) e cancela o antigo. Se o
atendimento antigo tinha sido **pago antecipadamente online** (PIX_ONLINE, §8.1) antes do
reagendamento, esse valor já pago **não é** transferido pro novo atendimento nem estornado — o
`Atendimento` cancelado guarda o histórico de que foi pago (snapshot, §3.5), mas o novo nasce sem
nenhum registro de pagamento prévio. Marcado inline com `// DECISAO_PENDENTE` em
`reagendar-atendimento-cliente.usecase.ts`.

**Por que não bloqueei:** o caminho mais comum (reagendar um avulso comum, sem pagamento online
antecipado) funciona corretamente hoje, e cobrar duas vezes por engano seria pior que deixar o caso
raro sem solução automática — a barbearia consegue resolver manualmente (webhook/painel) até essa
decisão ser tomada.

**A confirmar com o negócio:** se o valor pago online deveria migrar automaticamente pro novo
atendimento (viraria uma espécie de "abatimento" parecido com o de saldo residual, §8.7) ou se o
fluxo correto é orientar o cliente a pedir reembolso do pagamento antecipado separadamente.

## 23. Cognito removido do fluxo de produção — substituído por WhatsApp (sessão de lançamento, 2026-07-31)

O pedido desta sessão foi explícito: lançar em produção o mais rápido possível, com OTP por
WhatsApp no lugar do Cognito, e "nada além disso". O brief permitia duas leituras —
manter o Cognito como opção paralela, ou tirá-lo do fluxo — dando a escolha de implementação para
quem executasse ("não precisa deletar o arquivo se for trabalhoso — basta não ser mais uma opção
default e sair do fluxo").

**Implementado:** tirei o Cognito da `identity.module.ts` inteiramente — `IDENTITY_PROVIDER=cognito`
agora lança erro explícito no boot (`IDENTITY_PROVIDER='cognito' desconhecido`), em vez de cair
silenciosamente no provider demo (o que seria um fallback perigoso, contra o princípio já usado no
resto do sistema de "sem configuração explícita → erro, nunca chute"). O arquivo
`cognito-identity.provider.ts` e sua suíte de testes (9 casos) continuam no repositório, intactos e
verdes — só não são mais alcançáveis por nenhuma variável de ambiente. `assertConfiguracaoSegura`
(boot-guard) também passou a aceitar só `whatsapp` como provider válido em produção.

**Por que tirei em vez de manter as duas opções:** o brief pediu "substituindo o Cognito" (não
"além do Cognito"), o lançamento é presencial-only sem nenhuma dependência de AWS por decisão
explícita, e manter os dois caminhos simultaneamente como opções de produção "vivas" adicionaria
superfície de configuração (dois conjuntos de env vars válidos, dois caminhos a testar em produção)
sem nenhum caso de uso pedido nesta sessão para justificar.

**A confirmar com o negócio:** se algum dia fizer sentido oferecer Cognito de novo (ex.: outra
barbearia cliente que já tem AWS configurada), a reintegração é só devolver o branch `'cognito'` na
factory de `identity.module.ts` — a classe e os testes já existem prontos, não precisa reescrever
nada.

## 24. Tabelas `DemoIdentidade`/`DemoDesafioLogin` agora guardam identidade de produção real (nome desatualizado, não renomeado)

A lógica de código-com-hash/expiração/uso-único/rate-limit foi extraída para
`OtpIdentityProviderBase` e agora é compartilhada por `DemoIdentityProvider` **e**
`WhatsAppIdentityProvider` — ou seja, em produção, dados reais de clientes passam a viver em
tabelas chamadas `DemoIdentidade`/`DemoDesafioLogin`, nome que ficou de quando só o modo demo
existia.

**Por que não renomeei:** renomear exigiria uma migration de tabela + tocar ~18 pontos do código e
dos testes e2e que já referenciam esses nomes (incluindo fixtures desta e de sessões anteriores) —
risco/esforço desproporcional para uma sessão marcada como "nada além do essencial, o mais rápido
possível". O prefixo do `sub` gerado já foi diferenciado (`demo-<uuid>` vs `whatsapp-<uuid>`) para
que registros de produção pelo menos sejam identificáveis na tabela, mesmo com o nome da tabela em
si desatualizado.

**Quando reconsiderar:** numa sessão sem pressão de lançamento, vale uma migration simples
(`ALTER TABLE ... RENAME TO ...`, o Prisma suporta via `@@map`) para `IdentidadeExterna`/
`DesafioDeLogin` ou nomes equivalentes — puramente cosmético/organizacional, sem risco de dado.

## 25. `services/whatsapp-otp` trocou de `@open-wa/wa-automate` pra Baileys (2026-08-10)

Ao testar o fluxo de OTP com WhatsApp de verdade (usuário escaneando o QR pra valer, não mais um
teste automatizado), dois problemas reais apareceram na lib original — nenhum dos dois era o que a
sessão de lançamento suspeitava ("rede do ambiente de teste"), ver `RELATORIO_SESSAO.md` (seção
"Migração open-wa → Baileys") pro relato completo da investigação:

1. **QR nunca aparecia** — bug real na lib: ela embute um User-Agent com `Chrome/104.0.0.0`
   hardcoded, e o WhatsApp Web hoje rejeita isso ("atualize seu Chrome"). A opção de config pra
   sobrescrever (`customUserAgent`) tem, no código-fonte da lib, um bug próprio — só é lida se
   você também passar `inDocker: true`, mesmo fora de Docker. Achado lendo o source publicado no
   npm diretamente, não estava documentado.
2. **"Not a contact"** — a versão gratuita da lib bloqueia mandar mensagem pra quem não é contato
   salvo no WhatsApp. Isso inviabiliza o caso de uso inteiro (clientes da barbearia nunca vão estar
   salvos no chip descartável). Desbloquear exige uma licença paga (~£10-15/mês) sujeita a
   aprovação externa de prazo incerto.

**Decisão tomada com o dono:** reescrever `services/whatsapp-otp` sobre
[Baileys](https://github.com/WhiskeySockets/Baileys) (`baileys` no npm, MIT, pinado na versão
estável `6.7.24`) — implementa o protocolo do WhatsApp direto por WebSocket, sem navegador/Chrome,
sem a trava de contato, e busca a versão do protocolo mais recente a cada boot (elimina de raiz o
tipo de bug do item 1, já que não há mais nenhuma versão hardcoded pra ficar desatualizada). O
contrato HTTP externo do serviço (`GET /status`, `POST /enviar`) não mudou — o resto do sistema
(`WhatsAppIdentityProvider`, `HttpWhatsAppOtpClient`, Docker Compose) não precisou de nenhuma
alteração além do próprio `services/whatsapp-otp/Dockerfile` (ficou bem mais simples, sem instalar
Chrome). Confirmado funcionando de ponta a ponta com WhatsApp real: QR escaneado, mensagem de OTP
de produção recebida de verdade num número que não era contato salvo.

**Efeito colateral positivo:** imagem Docker e `node_modules` muito mais enxutos (153 pacotes / 0
vulnerabilidades reportadas, contra 933 pacotes / 37 vulnerabilidades com
open-wa+Puppeteer+Chrome) — não era o objetivo da troca, mas reforçou que era a escolha certa.

**A confirmar com o negócio:** nenhuma pendência de domínio aqui — decisão de biblioteca/implementação
(CLAUDE.md: "decisões de implementação... você toma sozinho"), registrada por ter sido uma mudança
grande de rumo dentro da mesma sessão de lançamento, não por exigir aprovação de regra de negócio.

## 26. `Vale`: sem transição de cancelar (PENDENTE) nem reverter aprovação (APROVADO→PENDENTE) (sessão de vale/pagamento)

A máquina de estado implementada (DOMAIN.md §4.4) só tem as transições explicitamente pedidas:
`PENDENTE → APROVADO`, `PENDENTE → NEGADO`, `APROVADO → PAGO`. Duas lacunas reais de operação não
foram especificadas e por isso não foram inventadas:

1. **Barbeiro desiste do próprio pedido enquanto `PENDENTE`** — hoje não há como cancelar; o único
   jeito de "encerrar" é o admin negar (o que grava um `motivoNegacao` que não é bem "o barbeiro
   desistiu").
2. **Admin aprovou por engano e quer reverter antes de pagar** — hoje `APROVADO` só anda pra
   frente (`marcarPago`); não existe `APROVADO → PENDENTE` nem `APROVADO → NEGADO`.

Nenhum dos dois afeta o ledger (ambos os casos hipotéticos ficam antes do `PAGO`, que é onde o
dinheiro realmente nasce) — a lacuna é só de conveniência operacional, não de integridade
financeira. Se aparecer necessidade real, é uma transição nova pequena no agregado `Vale`
(`cancelar()` e/ou `reverterAprovacao()`), sem tocar `LancamentoComissao`.

**A confirmar com o negócio:** se/quando isso incomodar no dia a dia (ex.: admin aprova errado com
frequência), decidir se cabe reverter aprovação, ou se o processo operacional é só "negar e pedir
de novo" — depende de quão comum é o erro na prática, informação que só a operação real vai dar.

## 27. `transparent.lost` do AbacatePay é DISPUTA PERDIDA, não "PIX expirou" — desvio deliberado da instrução literal (sessão de ligação do pagamento online)

A instrução original desta sessão pedia, ao receber `transparent.lost`: "marca
a intenção como EXPIRADA/FALHOU; feedback no funil ('seu PIX expirou, gere um
novo')". Ao confirmar contra a documentação oficial da AbacatePay (não
presumida — clonada e lida página por página), essa interpretação está
**factualmente errada**: `transparent.lost` é "Disputa de pagamento
transparente perdida" — um chargeback perdido sobre uma cobrança que **já
estava PAGA**. Não existe, em toda a tabela de eventos v2 da AbacatePay,
nenhum evento de webhook para "PIX gerado e nunca pago, expirou sozinho".

Seguir a instrução literal marcaria como EXPIRADO/FALHOU uma intenção que na
verdade já foi **paga e depois disputada** — arriscando reverter crédito de
pacote já liberado ou comissão já contabilizada, sem que isso tenha sido
pedido como regra de estorno nesta sessão. Isso violaria o princípio de nunca
inventar regra de negócio financeira.

**O que foi implementado em vez disso** (`webhooks.controller.ts`):
- `transparent.lost` → log de warning com o `externalId`, **zero mutação** de
  qualquer entidade, resposta 200/201 `processado: false`. Marcado inline
  `★ DECISAO_PENDENTE`.
- Expiração de PIX não pago passou a ser detectada por **timeout local**: novo
  campo `IntencaoDePagamento.expiraEm` (mesma janela pedida ao gateway via
  `expiresIn`), verificado a cada leitura de status pelo
  `ExpirarPagamentoVencidoUseCase` — chamado antes de todo polling em
  `GET /public/pagamentos/:id`, sem depender de nenhum webhook.

**A confirmar com o negócio:** o que fazer quando `transparent.lost` chegar de
verdade (reverter o crédito de pacote já consumido? notificar o admin
manualmente? estornar comissão?) é uma decisão financeira que precisa vir do
dono — hoje fica só registrado em log para revisão manual.

## 28. Janela de pagamento do PACOTE — ✅ RESOLVIDO: de volta a 1h, desacoplada do avulso online (2026-08-14)

**Estava:** a sessão de OTP+reserva unificou o prazo de pagamento do pacote
com `PRAZO_RESERVA_SEGUNDOS` (10min, a mesma constante do avulso online),
interpretando a spec original ("AVULSO ONLINE ou PACOTE... reserva TEMPORÁRIA
(10 min)") como aplicável aos dois. Registrado ali mesmo como decisão própria
a confirmar, não como regra certa.

**Confirmado pelo dono: estava errado.** Os 10 minutos existem por causa da
RESERVA DE HORÁRIO (Problema 2 — evitar um slot preso esperando pagamento).
`VendaDePacote` não reserva horário nenhum — não existe slot pra proteger.
Além disso pacote é ticket mais alto; o cliente precisa de mais tempo pra
pagar.

**Correção aplicada:** os dois prazos voltaram a ser **conceitos e constantes
separados**, cada um com seu próprio motivo de existir:
- **Avulso online**: `PRAZO_RESERVA_SEGUNDOS` (10 min, fixo,
  `apps/api/src/modules/payments/domain/prazo-reserva.ts`) — ligado à reserva
  de horário (`Atendimento.reservaOnlineExpiraEm`). Inalterado.
- **Pacote**: `gateway.expiraEmSegundos` (1h, configurável via
  `ABACATEPAY_EXPIRA_SEGUNDOS`) — o mesmo valor usado antes da sessão de
  OTP+reserva, sem reserva de horário nenhuma envolvida.

`vender-pacote.usecase.ts` voltou a usar `this.gateway.expiraEmSegundos`
(não importa mais `PRAZO_RESERVA_SEGUNDOS`); o comentário em `prazo-reserva.ts`
foi reforçado explicitamente avisando pra NÃO reunificar os dois por engano de
novo — são coincidentemente relacionados (os dois "prazo de pagamento online"),
não a mesma regra. Testado explicitamente:
`test/integration/pacote-publico.e2e.spec.ts` (cobrança nasce com ~1h de
`expiraEm`) e `test/integration/otp-reserva.e2e.spec.ts` (avulso online
continua com ~10min, tanto na reserva quanto na cobrança).

## 29. Cota de presenciais (Problema 3) não vale pro admin nem pro reagendar — decisão minha (sessão de OTP+reserva)

A spec diz "vale pra logado e não-logado igualmente" — na minha leitura,
"logado" se refere ao cliente autenticado no cockpit (`@ContaCliente()`),
não ao admin/staff. `AgendarAvulsoUseCase` é compartilhado entre o funil
público, o cockpit do cliente E o painel admin (`POST /atendimentos`) —
apliquei a cota só nos dois primeiros (`aplicarCotaPresencial: true`,
default), e o controller do admin passa `aplicarCotaPresencial: false`
explicitamente.

**Por quê:** a cota existe pra conter abuso de auto-atendimento (um cliente
com telefone verificado entupindo a agenda sozinho) — não pra limitar o
julgamento operacional do staff (exceção pra cliente VIP, situação
especial, etc.). Apliquei a mesma lógica ao `ReagendarAtendimentoClienteUseCase`:
como ele cria o novo atendimento ANTES de cancelar o antigo (pra nunca
deixar o cliente sem os dois se o novo horário falhar), contar a cota nesse
meio-tempo bloquearia incorretamente um cliente no limite tentando só mover
um agendamento que já tinha — por isso reagendar também passa
`aplicarCotaPresencial: false`.

**A confirmar com o negócio:** se o admin também deveria ter algum limite
(ex.: um staff mal-intencionado ou descuidado criando dezenas de presenciais
fantasma) — hoje não há trava nenhuma pro admin, por design (autonomia de
julgamento), mas isso presume que o acesso ao painel admin já é
suficientemente controlado (só quem tem login de staff chega lá).

---

## 29. Comissão do barbeiro sobre o valor COM ou SEM desconto progressivo?

**Decisão minha, a confirmar** (sessão do funil único + desconto progressivo).

**O que está implementado:** o desconto progressivo abate o valor de cada
`ItemAtendido` (`valorCobrado`), e a comissão sai desse valor
(`on-atendimento-concluido.handler.ts`: `valorBase = item.valorCobradoCentavos`).
Na prática, **o barbeiro divide o desconto com a casa**: num carrinho de
corte R$50 + barba R$25 com R$10 de desconto, a comissão incide sobre R$65,
não sobre R$75.

**Por quê:** é a consequência natural de `valorCobrado` ser o snapshot do que
foi REALMENTE cobrado do cliente — a mesma disciplina que vale no resto do
sistema. Fazer diferente exigiria guardar dois valores por item (cheio e
cobrado) e escolher qual alimenta a comissão, o que só se justifica se o
negócio quiser mesmo essa separação.

**A confirmar com o dono:** quem banca o desconto?
- **Dividido** (hoje): comissão sobre o valor cobrado. Simples, e o barbeiro
  participa do incentivo que traz mais serviços por visita.
- **Casa banca sozinha**: comissão sobre o preço cheio. Exige `precoCheio`
  como segundo snapshot no item e mudar a base do handler de comissão.

Enquanto não confirmado, vale o comportamento atual. Nenhuma comissão já
lançada muda — o ledger é imutável e os snapshots antigos seguem intactos.

---

## 30. "Bigod's Club" como membership/assinatura recorrente?

**Fora de escopo nesta sessão, registrado como futuro possível.**

O que existe hoje é só **rótulo de marca + vitrine**: a seção "Bigod's Club"
no topo do funil apresenta as `PacoteOferta` que já existiam, com pegada de
clube de benefícios. Não há — e não foi modelado — nada de:
mensalidade/assinatura recorrente, status de membro, benefício contínuo,
renovação automática, nível/tier.

**A discutir com o dono, se ele quiser evoluir para membership de verdade:**
- cobrança recorrente (o gateway hoje só faz PIX avulso, sem recorrência);
- o que o membro ganha por ser membro (desconto permanente? prioridade de
  horário? serviços inclusos por mês?);
- o que acontece quando ele para de pagar (créditos já comprados vencem?);
- se membership e pacote coexistem ou um substitui o outro.

Cada uma dessas respostas muda o modelo de domínio — por isso não foi
antecipado nada. O nome hoje não cria dívida: é texto de apresentação sobre
um agregado que já existe.

---

## 31. "Menor comissão" na atribuição sem preferência: em reais ou em percentual?

**Decisão minha, a confirmar** (sessão de barbeiro/aprovação, Fase 2).

O 1º critério da cascata de "não tenho preferência" é "o de MENOR comissão para
os serviços em questão". Com preço TAMBÉM por barbeiro (§3.2.2), isso tem duas
leituras possíveis:

- **Em centavos (implementado):** Σ (preço dele × percentual efetivo dele) por
  serviço. É o custo real da casa naquele atendimento. Um barbeiro com 40% sobre
  R$50 (R$20) ganha de outro com 30% sobre R$80 (R$24).
- **Em percentual puro:** compara só o `percentualPara(servico)`. Mais simples de
  explicar ("vai pro que tem a menor porcentagem"), mas pode mandar o cliente
  para quem custa mais caro à casa.

Fui de centavos porque "menor comissão" só tem significado econômico em dinheiro
— e porque o preço por barbeiro já existe e seria estranho ignorá-lo justamente
no critério de custo. Trocar é mudar só o número que entra na cascata; a ordem
dos critérios e os testes de desempate não mudam.

---

## 32. Order-bump com regras condicionais / segmentação (sessão 2026-08-17)

**Fora de escopo nesta sessão, decisão explícita do dono ("Começar SIMPLES").**

O order-bump ("Adicione à sua visita", DOMAIN.md §8.13) é uma vitrine curada à mão pelo admin —
`ItemDeOrderBump` (§3.13), uma lista geral, igual para todo cliente (só filtrada pelo que o
barbeiro escolhido atende e pelo que já está no carrinho).

**A Parte 2 da sessão (2026-08-17) trouxe PARAMETRIZAÇÃO por item** — preço promocional, mensagem
e ordem de exibição. Isso NÃO é motor de regras: continua sendo "este item, sempre, para todo
mundo, com esta oferta". Segue fora de escopo:

- motor de regras condicionais ("se o carrinho tem corte, ofereça barba"; "se é a primeira visita,
  ofereça X");
- segmentação por serviço selecionado, por barbeiro, por histórico do cliente, por horário;
- limite de uso da oferta (validade, primeira compra, N por cliente).

**A discutir com o dono, se ele quiser evoluir:**
- vale a pena medir conversão da vitrine parametrizada atual antes de investir num motor de regras?
- regras por serviço (matriz servico→sugestões) ou por atributo (categoria de serviço)?
- quem edita as regras — ainda o admin, numa tela nova, ou fica hardcoded?

Não modelei nada disso agora porque cada resposta muda a forma de configuração (schema novo,
tela nova) — melhor esperar a vitrine parametrizada provar (ou não) que vale a pena investir mais.

---

## 33. Upsell de troca-pra-cima (serviço premium) (sessão 2026-08-17)

**Fora de escopo nesta sessão.**

O order-bump (DOMAIN.md §8.13) só ADICIONA itens ao carrinho — nunca substitui um serviço já
selecionado por uma versão mais cara dele ("troca seu corte simples por um corte + tratamento").
Isso é um mecanismo diferente: precisaria saber qual serviço "vira" qual (uma relação de
upgrade/substituição), e a UX de trocar (não somar) é distinta da de adicionar com um toque.

**O mecanismo atual já comporta um serviço premium como item comum de bump** — se a barbearia
cadastrar "Corte Premium" como `Servico` com `sugeridoNoBump: true`, ele aparece na vitrine e pode
ser ADICIONADO ao lado do corte normal (não troca por ele). Trocar de verdade é decisão de UX/
negócio futura: precisa decidir se o upgrade remove o item original do carrinho, como isso afeta
o desconto progressivo (§3.2.3, muda a composição do carrinho no meio do fluxo), e se faz sentido
ter dois preços "concorrendo" na mesma vitrine.

---

## 34. Pacote é da empresa: crédito resgatável com qualquer barbeiro — ✅ RESOLVIDO (2026-08-17)

**Decisão confirmada pelo dono**, em resposta a bug reportado ("as ofertas e pacotes não precisam
ter vínculo com o barbeiro, é da empresa em si"). Duas opções foram apresentadas:

1. Crédito resgatável com QUALQUER barbeiro ativo da casa que atenda o serviço — o dono da
   oferta/venda vira só a base de preço do rateio, sem restringir consumo.
2. Vitrine deixa de filtrar por barbeiro, mas a venda continua amarrada a um "dono" que
   exclusivamente pode atender aquele crédito.

**Escolhida a opção 1.** Implementado em `VendaDePacote.agendarItem` (parou de exigir
`barbeiroId === venda.barbeiroId`) e em `GET /public/pacotes` (parou de filtrar por barbeiro
escolhido no funil — sempre devolve a vitrine inteira da empresa). Documentado em DOMAIN.md §8.14.
`barbeiroId` de `PacoteOferta`/`VendaDePacote` NÃO foi removido do schema — continua como base de
preço do rateio (congelado) e autoria/CRUD (§3.11, §4.3), só parou de restringir visibilidade e
consumo. Ver também DOMAIN.md §11 (linha "Resgate cruzado de crédito entre barbeiros", marcada
resolvida).

---

## 35. Colunas `sugeridoNoBump` deprecadas no banco (2026-08-17, Parte 2)

**Dívida técnica consciente, com prazo em aberto.**

`Servico.sugeridoNoBump` e `Produto.sugeridoNoBump` (criadas na Parte 1 desta mesma sessão) foram
substituídas por `ItemDeOrderBump` (DOMAIN.md §3.13), que guarda o mesmo "aparece: sim/não" mais
preço promocional, mensagem e ordem. A migration `20260818031633_order_bump_parametrizavel` copiou
todo `sugeridoNoBump = true` para a tabela nova.

**As colunas antigas continuam no banco, sem nenhum leitor.** Motivo: o sistema está em produção e
a migration foi feita aditiva — se o deploy precisasse voltar atrás, a configuração antiga ainda
estaria lá. Estão marcadas como DEPRECADO no `schema.prisma` e no DOMAIN.md.

**O que falta decidir:** quando dropar. Sugestão: depois de uma semana de produção estável com a
vitrine nova, numa migration de limpeza. Enquanto isso, o risco é baixo (coluna morta) mas o
incômodo é real — alguém lendo o schema pode achar que ainda vale.

---

## 36. `PacoteOferta.barbeiroId` deprecado no banco (2026-08-18)

**Mesma dívida do #35, outra coluna.**

Com o pacote virando da empresa (DOMAIN.md §8.14), `PacoteOferta.barbeiroId` deixou de existir no
domínio — a oferta não tem dono, não tem base de preço por barbeiro, e o cadastro é admin-only. A
migration `20260818162756_pacote_sem_dono` apenas **relaxou** a coluna para nulável (nenhum dado
perdido, nenhum drop), e o código parou de ler/escrever.

`VendaDePacote.barbeiroId` também virou nulável, mas esse campo **continua vivo e com significado
novo**: é o barbeiro que o cliente escolheu na compra, a única trava de consumo que sobrou.

**O que falta decidir:** quando dropar `PacoteOferta.barbeiroId`. Sugestão: junto da limpeza do
#35, depois de uma semana estável. Enquanto isso o risco é baixo (coluna morta, nulável), mas quem
ler o schema pode achar que ainda vale.

---

## 39. Bucket de uploads é público para leitura — e é público mesmo (2026-08-19)

> (Os números 37 e 38 estão reservados: #37 nasceu na branch `feat/otp-sms-cognito` e #38 na
> `feat/pagamento-manual-whatsapp`. Pulados de propósito para as três não colidirem no merge.)


O bucket de fotos (DOMAIN.md §3.14) é público para LEITURA, como pedido: o funil mostra a foto
do barbeiro sem autenticar nada, e é a forma mais simples de servir imagem para um site público.

**A consequência, dita em voz alta:** quem tiver a URL vê a imagem, para sempre, mesmo depois de
"removida" do sistema. Remover a foto apaga o objeto do bucket, então a URL morre — mas se
alguém já baixou ou compartilhou o arquivo antes, isso está fora do nosso alcance. Nome de objeto
é UUID aleatório, então ninguém varre o bucket adivinhando, e não há como listar o conteúdo.

Para foto de perfil de barbeiro e foto de produto de vitrine, isso é aceitável — é material que
existe para ser visto. **Não guarde outra coisa neste bucket** (documento de cliente, comprovante,
qualquer imagem que não seja para o público) sem antes trocar o modelo de acesso.

**Se um dia precisar fechar:** CloudFront com Origin Access Control na frente e bucket privado —
o mesmo desenho que os três buckets de frontend já usam. `UPLOADS_BASE_URL` existe exatamente
para essa troca: as URLs já gravadas no banco continuam válidas, sem migração de dado.

## 40. Foto de produto exige salvar o produto antes (2026-08-19)

No CRUD de produto, o bloco de foto só aparece ao **editar** — criar → salvar → reabrir para pôr
a foto. Motivo: o upload é um endpoint por id (`POST /produtos/:id/foto`), e um produto que ainda
não foi salvo não tem id.

**Alternativa não implementada:** segurar os bytes em memória no navegador e subir junto do
"Salvar". Não fiz porque é estado extra na tela para economizar um clique, e porque o upload
falharia *depois* de o produto já ter sido criado — dois caminhos de erro em vez de um.

**O que falta decidir:** se o clique a mais incomoda na operação real. Se incomodar, o caminho é
o formulário guardar o arquivo e disparar o upload logo após o POST de criação.
## 38. Modo de pagamento manual por WhatsApp é TEMPORÁRIO — precisa ser desligado (2026-08-18)

> (O #37 nasceu na branch `feat/otp-sms-cognito` e chega aqui quando ela for mergeada — o número
> foi pulado de propósito para as duas não colidirem.)

A AbacatePay leva ~7 dias úteis para liberar produção. Até lá, `PAGAMENTO_MANUAL_WHATSAPP=true`
faz o "pagar online" mandar o cliente pro WhatsApp da barbearia com a comanda pronta, em vez de
gerar PIX (DOMAIN.md §3.8). A confirmação é manual, pelo admin.

**Isto não é uma decisão de arquitetura — é um andaime.** O código do gateway continua intacto e
testado; a flag só desvia a chamada num ponto (`CobrancaOnlineService.gerar()`).

**O que falta fazer** — quando a AbacatePay liberar produção:
1. `PAGAMENTO_MANUAL_WHATSAPP=false` (ou remover a variável) e reiniciar a API. **Só isso**
   devolve o fluxo de PIX — não precisa de deploy de código nem de sessão de trabalho.
2. Confira uma compra de pacote e um avulso online de ponta a ponta com o gateway real.
3. Só então decida se apaga o modo manual. Vale a pena **manter** enquanto o gateway for novo:
   é o plano B se a AbacatePay cair, e o custo de mantê-lo é uma flag desligada.

**Se for apagar um dia:** `CobrancaOnlineService` volta a ser a chamada direta ao gateway, e saem
`comanda-whatsapp.ts`, `pagamento-manual.ts`, `PagamentoManualAguardando.tsx` e o ramo
`pagamentoManual` dos dois casos de uso. Os endpoints de confirmação manual **ficam** — eles são
do bug 8 (pagamento no balcão), não deste modo.

---

## 41. Um teste falhou uma vez e não reproduziu (2026-08-19)

Numa corrida da suíte às 15:53, **1 de 727** falhou. Nas **5 corridas seguintes**, 727/727.
Não sei qual era: o comando estava com `| tail -5`, que cortou justamente o nome do teste.

**O que se sabe:** foi durante a sessão em que o graphify foi instalado, com o assistente
disparando comandos em paralelo — os hooks novos sobem um processo Python (~208 ms) a cada
`Bash`/`Grep`/`Read`/`Glob`. A hipótese mais provável é disputa de CPU com os 8 workers do
vitest afetando algum e2e sensível a tempo, mas é hipótese, não diagnóstico.

**Segunda hipótese:** os e2e derivam telefone/login de `String(Date.now()).slice(-6)`, que
repete a cada ~16,7 min. Duas corridas separadas por um múltiplo exato disso colidiriam no
banco. Improvável, mas é o tipo de coisa que falha uma vez em vinte.

**O que fazer se voltar:** rodar `npx vitest run` SEM `| tail` e guardar a saída inteira — o
nome do teste é o que falta. Com ele, dá para decidir entre estabilizar o teste ou tornar os
sufixos realmente únicos (`randomUUID()` em vez de fatia de timestamp).

---

## 41. `Barbeiro.comissaoProdutosBp` deprecado no banco (2026-08-19)

**Terceira dívida do mesmo tipo (#35, #36).**

A comissão de produto virou taxa única da empresa (DOMAIN.md §3.9.1), então
`Barbeiro.comissaoProdutosBp` não é lido por ninguém para calcular. A migration
`20260819190000_comissao_produto_global` foi **aditiva**: criou `Company.comissaoProdutosBp` e
não tocou na coluna do barbeiro, para o rollback do código não perder dado.

O endpoint `PUT /barbeiros/:id/comissao` **ainda aceita e grava** o campo (compatibilidade), mas
nenhuma tela o envia e nenhum cálculo o lê. O DTO está marcado como deprecado.

**O que falta decidir:** quando dropar. Sugestão: junto da limpeza do #35 e #36. Enquanto isso o
risco é baixo (coluna morta), mas quem ler o schema pode achar que ainda vale.

## 42. A taxa de comissão de produto começa em 0% — alguém precisa definir o número (2026-08-19)

A decisão dos sócios definiu **como** a comissão de produto passa a funcionar (taxa única da
empresa, sobre o preço de venda), mas **não disse qual é o percentual**. Não inventei um número:
a migration cria a coluna com **default 0**, e o sistema não paga comissão de produto até alguém
configurar em Ajustes → Parâmetros.

**Consequência prática, dita em voz alta:** antes desta mudança, o Gabriel tinha 10% de comissão
de produto configurado no perfil dele (os outros dois barbeiros tinham 0%). Com a taxa global em
0, ele deixa de receber sobre produto até o admin definir a taxa da casa. **Nenhum lançamento
existente foi afetado** — não havia nenhum lançamento de comissão de produto no banco no momento
da mudança (conferido).

**O que falta decidir:** o percentual. É uma decisão de negócio dos sócios, não de implementação.

## 43. Testes liam o `.env` da máquina de quem rodava (2026-08-19) — ✅ RESOLVIDO

Achado ao rodar a suíte depois da mudança de comissão: 25 testes de PIX falhavam sem que o código
testado tivesse mudado.

**Causa:** o `@prisma/client` carrega o `.env` da raiz **sozinho**, quando é importado. Como todo
e2e importa o `AppModule`, que puxa o Prisma, toda configuração local vazava para os testes — em
particular `PAGAMENTO_MANUAL_WHATSAPP=true`, que é o estado normal da máquina de quem está tocando
essa feature.

**Por que ninguém tinha visto:** o arquivo `pagamento-manual-whatsapp.e2e.spec.ts` *deleta* essa
variável no `afterAll`, e os arquivos rodam no mesmo processo (`fileParallelism: false`). Quem
rodava **depois** dele herdava a limpeza e passava. A suíte estava verde por acidente de ordem —
bastou um arquivo novo mudar a ordenação para 25 testes quebrarem.

**Corrigido:** `apps/api/test/setup-env.ts`, registrado em `setupFiles`, fixa as variáveis que
mudam comportamento de negócio antes de cada arquivo. Quem quer o comportamento ligado liga no
próprio teste.

**O que fica de lição:** qualquer env nova que mude comportamento de negócio precisa de valor
explícito nesse arquivo. Senão a suíte volta a depender da máquina de quem executa.

---

## 44. Faturamento da home NÃO inclui venda de pacote (2026-08-19)

A home de gestão mostra "quanto entrou hoje" e o ticket médio. Os dois usam a MESMA definição de
faturamento (DOMAIN.md §3.15):

    atendimentos CONCLUÍDOS no período (serviços + produtos, pelo valor congelado)
  + vendas avulsas de produto no período

**Venda de pacote não entra.** O dinheiro do pacote aparece quando o crédito é consumido, no
atendimento — contar também na venda somaria o mesmo dinheiro duas vezes, e o ticket médio (que
é por VISITA) ficaria distorcido por uma venda que não é visita.

**A consequência, dita em voz alta:** o dia em que a barbearia vende muito pacote mostra
faturamento baixo na home, e os dias seguintes mostram alto conforme os créditos são usados. Para
quem olha o número como "quanto entrou no caixa hoje", isso pode parecer errado.

**O que falta decidir:** se o dono prefere ver o caixa do dia (dinheiro que entrou de fato, com a
venda de pacote no dia da compra) em vez do faturamento por visita. São duas perguntas diferentes
e ambas legítimas — a segunda exigiria um card separado, porque não dá pra usar o mesmo número
para as duas coisas sem mentir numa delas.

## 45. "Pendências" da home lista até 5 de cada tipo (2026-08-19)

O card "Esperando você" busca no máximo 5 pacotes aguardando + 5 atendimentos aguardando
pagamento. Com mais que isso, a home mostra os mais recentes e o "ver tudo" leva pra seção.

Não há contagem total ao lado (ex.: "5 de 12"), porque exigiria duas queries a mais numa tela que
carrega a cada login. **O que falta decidir:** se o dono precisa do total exato na home. Se
precisar, é um `count` por tipo — barato, mas hoje não pedido.

## 46. Conclusão antecipada não tem tolerância de minutos (2026-08-20)

A trava dispara com comparação **estrita**: se `agora < inicio`, o barbeiro precisa justificar.
Sem margem nenhuma.

Isso significa que concluir às 08:58 um atendimento marcado para 09:00 — cliente que chegou
adiantado, situação corriqueira numa barbearia — abre o modal de justificativa. Funciona, mas é
atrito num caso legítimo e frequente.

**O que falta decidir:** se existe uma tolerância, e de quanto. Candidatos naturais: 15 min
(cabe "chegou adiantado" sem abrir espaço pra concluir a agenda da tarde), ou a duração do
próprio atendimento. Marcado no código como `// DECISAO_PENDENTE` em
`concluir-atendimento.usecase.ts` (`exigeAprovacao`) — é uma constante e um comentário, não uma
refatoração.

**Por que não inventei um número:** tolerância grande demais reabre exatamente o buraco que a
trava fechou (concluir atendimentos que não aconteceram para inflar comissão), e o tamanho certo
depende de como a casa opera. É decisão de negócio.

## 47. Recusa de conclusão antecipada não avisa o barbeiro (2026-08-20)

Quando o admin recusa, o atendimento volta para `AGENDADO` e o barbeiro descobre olhando a
agenda. Não há notificação, e a recusa não registra motivo — o admin só clica "Recusar".

**O que falta decidir:** se a recusa deve exigir justificativa do admin (simétrico ao motivo que
o barbeiro é obrigado a dar) e se o barbeiro deve ser avisado. Hoje o ledger de comissão não
registra nada nesse fluxo, então não há rastro de que houve um pedido recusado depois que os
campos são limpos — só o log da aplicação.

**Por que ficou assim:** o pedido não move dinheiro, então não há nada a auditar no ledger; e
notificação (WhatsApp) é Fase 2, fora de escopo (DOMAIN.md §11). Se a recusa virar rotina, isso
muda de peso.

## 48. Cancelar só UM crédito de uma visita múltipla (2026-08-21)

A visita de vários créditos (corte + barba numa ida) é cancelada e reagendada **inteira**. Não
existe "tirar só a barba desta visita".

O mínimo sensato foi tratar os créditos como um bloco: cancelar devolve todos conforme a regra de
falta/segunda-chance que já existia, reagendar move todos para o novo horário. É o que corresponde
ao que o cliente fez — ele marcou uma visita, não dois compromissos.

**O que falta decidir:** se o cliente (ou o admin) precisa remover um serviço de uma visita já
marcada. Hoje o caminho é cancelar a visita e montar de novo, o que é aceitável enquanto o
cancelamento for antecipado (nenhum crédito é perdido). Se for tardio, cancelar cobra falta nos
DOIS créditos — e aí "queria tirar só a barba" custa caro. Se isso aparecer na operação, o desenho
natural é remover o item do atendimento (existe `adicionarItem`; falta o inverso) devolvendo o
crédito correspondente, sem passar pelo cancelamento.

## 49. Dois créditos do MESMO serviço numa visita são recusados (2026-08-21)

Um pacote de 5 cortes não permite marcar dois cortes na mesma visita. O erro é explícito
("agende um por vez"), não um silêncio.

Duas razões, e a segunda é técnica: (a) ninguém corta o cabelo duas vezes numa sentada; (b) a
projeção pública de horários (`horarios-disponiveis-query.service.ts`) calcula a duração sobre os
serviços **distintos** do carrinho — ela busca os serviços por `id IN (...)` e soma o resultado.
Com `[corte, corte]` ela somaria 30 min, ofereceria um vão de 30 min, e o domínio criaria um bloco
de 60 min: a projeção diria "livre" para um horário que o banco recusa.

**O que falta decidir:** se dois créditos do mesmo serviço na mesma visita têm caso de uso real
(dois filhos atendidos em sequência com um pacote só?). Se tiver, a projeção precisa somar **por
item** antes de a trava sair — nesta ordem, não na inversa.

**Nota:** o mesmo buraco existe hoje, latente, para o avulso: `/public/horarios?servicoIds=a,a`
devolveria a duração de um único serviço. Nenhuma UI manda duplicata, então nunca apareceu.

## 50. Bigod's Club como membership/assinatura recorrente (2026-08-21)

O status de membro (§4.5) deriva de **ter pacote**, não de uma assinatura. Não existe
mensalidade, cobrança recorrente, nível de membro, nem benefício fora dos créditos comprados —
"Bigod's Club" continua sendo o rótulo de marca sobre os pacotes que já existiam (ver #30).

O que a feature de hoje adiciona é a **leitura social** disso: o cliente se reconhece como membro,
e quem esgotou recebe um convite pra voltar em vez de simplesmente sumir do clube.

**O que falta decidir:** se o clube vira assinatura de verdade (cobrança recorrente, benefício
contínuo, talvez níveis). Isso mudaria o status de derivado para atributo de um contrato — e aí a
função `statusDoClube` deixa de ser a fonte, porque passaria a existir um fato ("assinatura ativa")
que não se deriva de crédito nenhum. É evolução futura, não dívida.

## 51. Quando o crédito "morreu" era aproximado por `fim`/prazo (2026-08-21) — ✅ RESOLVIDO NO MESMO DIA

Para decidir se um avulso é posterior ao esgotamento, o cálculo usa o instante em que o último
crédito deixou de existir: o `fim` do atendimento que o consumiu, ou o `prazoReagendamentoAte` que
o expirou. Nenhum dos dois é o instante do FATO — não existe `consumidoEm` no `ItemDoPacote` nem
`concluidoEm` no `Atendimento`.

Na prática coincide: um atendimento é concluído quando acontece. Onde diverge é na **conclusão
antecipada** (§4.1): ali o crédito é consumido antes do `fim`, então o cálculo considera o crédito
vivo por algumas horas a mais do que foi. O erro é conservador — mantém o cliente no clube.

**O que aconteceu:** não era "diferença de horas", era bug. O dono reportou no mesmo dia um
cliente que esgotou o pacote, marcou avulso e continuava membro. Causa: os quatro créditos foram
consumidos numa tarde, para atendimentos marcados em 24, 26 e 27 de agosto — então o "instante da
morte" derivado do `fim` ficou **no futuro**, e o avulso marcado no meio parecia anterior a ele.
Não era um caso de borda: concluir antes do horário é rotina desde a trava de conclusão
antecipada, e o admin sempre pôde concluir qualquer atendimento.

**Resolvido** com `ItemDoPacote.deixouDeExistirEm` (migration aditiva), gravado no consumo e na
expiração, com o instante recebido de fora — nunca `new Date()` dentro do agregado.

Backfill em duas etapas, porque a primeira era grosseira: `LEAST(fim, now())` gravava "agora" para
todo crédito com atendimento futuro, o que fazia qualquer avulso ANTERIOR à migration parecer
anterior à morte do crédito. A segunda etapa usa `LancamentoComissao.ocorridoEm` — o lançamento é
criado NA CONCLUSÃO, então é o instante real, e já estava no banco.

**O que ainda falta decidir:** se o `Atendimento` também deveria guardar `concluidoEm`. Hoje o
instante da conclusão é recuperável indiretamente (pelo lançamento de comissão) e nada mais precisa
dele — mas a comissão é um caminho torto para uma pergunta simples.

## 52. Log do clube não tem relatório, e pode atrasar (2026-08-21)

O `EventoDoClube` é gravado por reconciliação em cima de eventos de domínio. Se um caminho novo
mudar o status sem passar por nenhum dos eventos ouvidos (`clube.handlers.ts`), a linha do log só
aparece no próximo fato daquele cliente. O status mostrado ao cliente não é afetado — ele é
calculado.

**O que falta decidir:** (a) se vale um job de reconciliação periódica pra fechar essa janela; (b)
o relatório de retenção em si (quantos inativos renovam vs. viram avulso), que é o motivo do log
existir e foi explicitamente deixado pra depois.


## 53. O funil sabe se um telefone já é cliente — e isso é um oráculo (2026-08-21)

`GET /public/clientes/conhecido` responde se um número já tem cadastro na casa. É o que permite não
perguntar o nome a quem já é cliente (§8.1.1), e é a peça que fecha o buraco de o funil reescrever
cadastro alheio.

O custo: **enumeração**. Quem tiver paciência descobre quais telefones são clientes da barbearia.
Mitigado, não eliminado:

- devolve **booleano**, nunca o nome — o nome exige OTP;
- limite de 20 consultas por 10 minutos por origem;
- quem só fez login (placeholder) responde `false`, então nem "tem login aqui" vaza.

Isso contraria, em espírito, a neutralidade deliberada de `/conta/login/iniciar`, que responde
igual para todo mundo justamente para não revelar existência de conta.

**A alternativa sem oráculo** seria mandar OTP para TODO MUNDO ao digitar o telefone, e descobrir o
nome só depois de confirmar. Ela foi descartada porque adicionaria OTP ao avulso ONLINE, que hoje
dispensa por decisão do dono (o pagamento já é a trava contra agenda falsa) — seria trocar um
vazamento pequeno por atrito em todo cliente novo.

**O que falta decidir:** se o vazamento incomoda. Se incomodar, o caminho é o OTP universal acima,
aceitando o atrito.

## 54. Cliente não consegue corrigir o próprio nome (2026-08-21)

Com o funil parando de sobrescrever (§8.1.1), quem está cadastrado com o nome errado não tem como
corrigir: não existe edição de perfil no app do cliente. Só o admin, pelo painel.

Antes ele "corrigia" reagendando e digitando outro nome — e era exatamente esse mecanismo que
permitia qualquer um bagunçar o cadastro. Trocamos um problema por um menor, de propósito.

**O que falta decidir:** onde mora a edição de perfil. O lugar natural é a conta do cliente
(`apps/account`), que já autentica por OTP — ali o próprio dono do telefone edita o próprio nome,
que é a única pessoa que deveria poder.

## 55. Remover item de comanda já paga online exige estorno (2026-08-25)

A comanda ficou editável (FASE 1): o barbeiro remove e troca serviços/produtos antes de concluir, e o
total é refeito sobre a composição final. Isso funciona enquanto o dinheiro ainda não entrou.

Quando **já entrou**, remover item significa devolver dinheiro, e devolução não existe neste sistema.
Duas situações caem nisso:

- **pago online** (`IntencaoDePagamento` PAGA): o cliente transferiu via PIX. Estornar exige chamar o
  gateway, tratar estorno parcial, lidar com estorno que falha, e registrar tudo isso no ledger —
  nada disso está escrito;
- **saldo residual abatido** (`Atendimento.valorAbatidoSaldo > 0`): parte do valor veio de um saldo
  de outro pacote. Desfazer é devolver saldo àquela outra venda, que já foi fechada.

**O que foi feito:** a remoção é RECUSADA com mensagem explícita, e o painel esconde o botão
(`AtendimentoDTO.podeEditarComanda`). Adicionar continua liberado nos dois casos — o adicional é
cobrado presencialmente — mas a comanda NÃO é reprecificada, para o preço do que já foi pago não
mudar embaixo de um pagamento fechado.

**O que falta decidir:** se vale escrever o fluxo de estorno, ou se a saída operacional (devolver por
fora e registrar no acerto) basta. Enquanto o pagamento online for majoritariamente o modo manual por
WhatsApp, "por fora" já é o normal — o gateway nem está no caminho.

## 56. Trocar serviço é remover + adicionar, sem operação atômica (2026-08-25)

A comanda ficou editável (FASE 1), e "trocar o serviço errado pelo certo" se faz em dois passos:
adiciona o certo, remove o errado. Entre um e outro a comanda existe com os dois — e, se o barbeiro
parar no meio, ela fica errada de um jeito diferente.

Não virou uma operação `trocarItem` atômica porque o caso não pede: a comanda só é lida na conclusão,
que é o passo seguinte, e um estado intermediário de dois segundos na tela de quem está editando não
tem leitor. Uma operação nova seria mais superfície de API para um problema que ninguém tem.

**O que falta decidir:** se, na prática, o barbeiro remove primeiro e esquece de adicionar. Se isso
aparecer, o conserto barato não é a operação atômica — é a tela pedir confirmação ao sair da etapa 1
com menos serviços do que entrou.

## 57. Caixinha por forma de pagamento (2026-08-25)

A caixinha é declarada como um valor só, e vai 100% para o barbeiro no ledger. Na vida real ela pode
chegar em dinheiro (fica direto com o barbeiro, e a casa nunca a viu) ou junto do PIX/cartão (entra
no caixa da casa, que depois repassa). Hoje o sistema trata as duas igual: lança a favor do barbeiro
e não distingue.

Para o EXTRATO isso é indiferente — o barbeiro tem R$7 a receber dos dois jeitos. Para o
FECHAMENTO/repasse não é: no primeiro caso a casa já "pagou" sem passar pelo caixa.

**O que falta decidir:** se o fechamento precisa dessa distinção. Se precisar, o caminho é a caixinha
carregar a forma de pagamento dela (não a da comanda) e o fechamento abater a que veio em espécie.

## 58. Desfazer um consumo de crédito registrado por engano (2026-08-28)

O consumo no balcão (§8.15) cria um atendimento **CONCLUIDO**, que é estado final: se o
admin registrar o crédito errado, o barbeiro errado ou a caixinha errada, não há caminho de
volta pelo painel.

Existe meio caminho: `CorrigirBarbeiroDoAtendimentoUseCase` já sabe estornar comissão e
relançar no nome certo. Falta o resto — devolver o crédito para DISPONIVEL e anular o
atendimento sem apagá-lo do ledger.

**Por que não entrou agora:** a feature subiu como correção urgente de um caso em produção,
e o desfazer dobraria o tamanho dela.

**O risco de deixar assim, dito com todas as letras:** o jeito de corrigir um consumo errado
continua sendo mexer no banco — que é exatamente o que causou o incidente que originou a
feature. Se acontecer uma vez, é sinal de que isto virou prioridade.

## 59. Trocar a senha estando logado, sabendo a senha atual (2026-08-28)

Hoje o cliente define a senha em dois momentos: primeiro acesso (com verificação recente) e
"esqueci a senha" (com código). **Não existe** "trocar minha senha" dentro da conta para
quem já está logado e lembra da atual.

Quem quiser trocar por precaução passa pelo fluxo do código — que gasta um SMS, justamente
o recurso escasso que motivou toda esta mudança.

**O que falta decidir:** se vale um `PUT /conta/senha` que aceite `senhaAtual` + `senhaNova`
sem código, como o `PUT /auth/senha` do staff já faz. É barato e reusa o mesmo motor; ficou
de fora porque a urgência era destravar o login, e ninguém pediu troca voluntária ainda.

## 60. Sessão do cliente não é revogável (2026-08-28)

O token de sessão do cliente é um HMAC autocontido de 30 dias: não há lista de sessões
ativas nem revogação. Trocar a senha (inclusive por "esqueci") **não derruba** as sessões
antigas daquele cliente — quem estiver logado em outro aparelho continua logado.

Isso não era gritante quando a única forma de entrar era um código de uso único. Com senha,
o cenário "emprestei o celular e quero cortar o acesso" fica pensável.

**O que falta decidir:** se a conta do cliente precisa de revogação (ex.: um `tokenVersao` no
`Cliente`, incrementado ao trocar a senha, conferido pelo guard). É uma coluna e uma
checagem; não entrou porque exige migration e mais superfície num deploy de urgência.

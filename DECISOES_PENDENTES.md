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

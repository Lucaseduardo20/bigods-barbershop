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

## 9. Teste ponta-a-ponta contra o SANDBOX real do AbacatePay — PENDENTE DE CREDENCIAL

O gateway real (`AbacatePayGateway`) e o webhook validado por assinatura estão
implementados e cobertos por testes com HTTP mockado (`abacatepay.gateway.spec.ts`,
`abacatepay-webhook.verifier.spec.ts`) e por um e2e do webhook com payload assinado
à mão (`webhook-abacatepay.e2e.spec.ts`). **Não** existe ainda o teste que gera uma
cobrança real no sandbox do AbacatePay e simula o pagamento pelo endpoint deles,
porque **não há credencial de sandbox** (`ABACATEPAY_API_KEY` de teste) nas variáveis
de ambiente.

**Ação:** assim que a key de sandbox chegar, esse é o **primeiro** teste a rodar —
cobrança real → `simularPagamento(gatewayId)` (`POST /pixQrCode/simulate-payment`)
→ webhook confirma → pacote libera créditos. A infraestrutura já está pronta
(`AbacatePayGateway.simularPagamento` existe justamente para isso).

## 10. Versão/base da API do AbacatePay assumida (`/v1`, `pixQrCode`)

A documentação do AbacatePay mudou entre v1 e v2 (a base chegou a ser anunciada
como `.../v2` com `/transparents/*`). Adotei o caminho **estável e público**
`https://api.abacatepay.com/v1` + `pixQrCode/create` + `pixQrCode/simulate-payment`,
que suporta `metadata.externalId` direto e retorna `brCode`/`brCodeBase64`. A base
é **overridável** por `ABACATEPAY_BASE_URL` sem tocar código.

**A confirmar no primeiro contato com o sandbox real:** se a conta usar outra
versão/base, ajustar `ABACATEPAY_BASE_URL` (e, se os nomes dos campos diferirem,
apenas o mapeamento em `AbacatePayGateway` — a porta `PaymentGateway` não muda).

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

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

## 12. Catálogo de ofertas de pacote (`PacoteOferta`) não é modelado no domínio

O funil pede "ofereça pacotes daquele serviço com o desconto vs. avulso visível
(dado que já existe no catálogo)". Mas o **DOMAIN.md não modela template/catálogo
de pacote** — §3.6 `VendaDePacote` é uma venda ad-hoc, e §11 não lista "template
de pacote" nem "precificação/desconto de pacote". Ou seja: **de onde sai o preço
com desconto e a composição do pacote não estava especificado.** Por CLAUDE.md
("não invente decisão de domínio"), NÃO criei regra de precificação dentro de um
agregado.

**Mínimo implementado:** um **read model** `PacoteOferta` (id, nome, servicoId,
quantidade, precoCentavos, ativo) — puro catálogo de leitura, **fora dos
agregados**. A venda pública expande a oferta nos serviços reais
(`Array(quantidade).fill(servicoId)`) e passa pelo `VendaDePacoteUseCase`/rateio
(§3.6) sem tocar em nada do domínio. As ofertas são **semeadas** (2 exemplos no
`seed.ts`); o `precoAvulsoTotalCentavos` (referência do desconto) é derivado do
catálogo vigente, não congelado.

**A confirmar com o negócio:** (a) política de desconto/preço dos pacotes; (b) se
o admin deve ter CRUD de ofertas (hoje: só seed — **CRUD no admin fica pendente**,
não bloqueia o funil); (c) se "pacote" deveria virar um conceito de catálogo de
primeira classe (aí entra no DOMAIN.md como agregado/entidade nova). Enquanto
isso, mudar oferta = editar o seed / a tabela, sem migração de domínio.

## 11. Webhook do AbacatePay só é MONTADO com o gateway real

Com `PAYMENT_GATEWAY=fake` (default fora de produção) o `WebhooksController` **não
é montado** — nenhuma superfície de webhook é exposta em demo, como pedido. A
decisão de montar lê `PAYMENT_GATEWAY` na avaliação do módulo; em produção (build
CommonJS) a ordem de carga garante que a env já está setada. Além disso, mesmo se
exposto, o guard **falha fechado** sem `ABACATEPAY_WEBHOOK_SECRET` (401), e o boot
recusa subir com o gateway real sem o secret — dupla proteção.

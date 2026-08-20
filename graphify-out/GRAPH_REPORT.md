# Graph Report - bigods-barber-v2  (2026-08-20)

## Corpus Check
- 426 files · ~474,389 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3882 nodes · 8775 edges · 243 communities (215 shown, 28 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 130 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4b282934`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- account/src/App.tsx
- dinheiro.ts
- BarbeiroId
- agendar-avulso.usecase.ts
- PrismaService
- dto.ts
- s3-armazenamento.ts
- Barbeiro
- shared.module.ts
- VendaDePacote
- conta-cliente.e2e.spec.ts
- UnitOfWork
- Cliente
- devDependencies
- payments.module.ts
- PacoteOferta
- Atendimento
- booking/src/App.tsx
- IdentityProvider
- UsuarioAutenticado
- booking/src/components/ui.tsx
- booking-publico.controller.ts
- DisponibilidadeBarbeiro
- Servico
- payroll.module.ts
- barbeiros.controller.ts
- webhooks.controller.ts
- IntencaoDePagamento
- staff.module.ts
- calendario.ts
- api
- app.module.ts
- cliente.guard.ts
- produtos.controller.ts
- dependencies
- .criar
- Vale
- CriarBarbeiroDto
- cognito-triggers.spec.ts
- admin/src/components/ui.tsx
- Decisões Pendentes
- admin/src/App.tsx
- Sucesso.tsx
- devDependencies
- Agenda.tsx
- dinheiro
- Relatório da Sessão — Bigod's Barber v2
- ExpedienteSemanal
- compilerOptions
- ClienteAutenticado
- atendimento.spec.ts
- AgendaQueryService
- What You Must Do When Invoked
- scripts
- PacotesQueryService
- CompanyId
- HorariosDisponiveisQueryService
- Pacotes.tsx
- identity.module.ts
- vendas-produto.controller.ts
- VendaDeProduto
- Confirmacao.tsx
- PacoteOfertasController
- AgendarAvulsoDto
- whatsapp-otp/package.json
- desconto.ts
- devDependencies
- HomeQueryService
- enums.ts
- .atualizar
- Publico
- vales.controller.ts
- AgendarPublicoDto
- compilerOptions
- compilerOptions
- ClientesController
- .vender
- 3. Agregados
- tsconfig.build.json
- compilerOptions
- Estratégia de infraestrutura na AWS — documento de decisão
- scripts
- compilerOptions
- tasks
- materializar-expediente.usecase.ts
- RegistrarPagamentoDto
- Passo a passo do deploy
- AtualizarPacoteOfertaDto
- VenderPacoteDto
- DefinirDescontoDto
- precificacao-pacote.ts
- 8. Casos de uso principais
- ItemDeOrderBump
- LoginDto
- 2. Funil público — o que o cliente vê (porta 5174)
- Produto
- static-server/package.json
- contracts/package.json
- prompt-sessao-B.md
- devDependencies
- booking/src/lib/format.ts
- prisma
- Ligação do pagamento online — AbacatePay em SANDBOX, Checkout Transparente v2 (2026-08-13) ✅
- PacoteAtendimentoHandlers
- cobranca-online.service.ts
- ExpirarPagamentoVencidoUseCase
- AtualizarServicoDto
- ConfigurarDto
- LocalAuthProvider
- PrismaParametrosRepository
- DiaDeExpedienteDto
- otp-sem-conta.e2e.spec.ts
- config/package.json
- Upload de imagens — foto de barbeiro e de produto (2026-08-19) ✅
- gerar-icones.mjs
- nest-cli.json
- empresa-publica-query.service.ts
- Pagamentos (PIX via AbacatePay — Checkout Transparente v2)
- vale.aggregate.ts
- .definir
- CLAUDE.md — Bigod's Barber
- .ehPositivo
- CobrancaOnlineService
- PrismaProdutoRepository
- AgendamentosClienteQueryService
- server.js
- Papel
- deploy.sh
- index.js
- Deploy — Bigod's Barber
- whatsapp-otp-service
- S3Espiao
- PaymentGateway
- env-up.sh
- WebhooksController
- Bigod's Barber — Especificação de Domínio
- deploy-frontends.sh
- env-down.sh
- fetch-secrets-ssm.sh
- Roteiro de QA — antes de todo deploy
- .deCentavos
- BLOCO 1 — Funil público avulso (booking, sem login)
- BLOCO 4 — Admin: agenda e conclusão (onde dinheiro é registrado)
- contracts/tsconfig.json
- lancamento-comissao.spec.ts
- Correção de bugs de smoke test manual (sessão 2026-07-20) ✅
- DefinirExpedienteUseCase
- webhook-abacatepay.e2e.spec.ts
- AtualizarProdutoDto
- graphify reference: extra exports and benchmark
- BLOCO D — Funil reordenado + link pessoal
- resultado-bateria-testes1.md
- BLOCO 3 — Cockpit do cliente (account)
- Pagamento manual por WhatsApp — ponte TEMPORÁRIA (2026-08-18) ✅
- Comissão de produto — taxa única da empresa (2026-08-19) ✅
- Pacote é da empresa — barbeiro dono extinto (2026-08-18) ✅
- RolesGuard
- Sessão de lançamento (2026-07-31) — OTP por WhatsApp + produção presencial-only ✅
- Sessão-E (2026-07-31) — autonomia do cliente no cockpit ✅
- Vale, pagamento e fechamento — ledger de 3 direções (2026-08-13) ✅
- BLOCO A — CRUD de oferta de pacote (novo)
- BLOCO E — Re-teste: pacote + pagamento (bloco 2 do smoke anterior)
- 4. Painel administrativo (porta 5173)
- BLOCO 2 — Funil de PACOTE + pagamento online (maior risco financeiro)
- compilerOptions
- Trava de conclusão antecipada (2026-08-20) ✅
- PacoteOferta como agregado + preço por barbeiro + aprovação + funil reordenado (sessão-B, 2026-07-20/21) ✅
- PrismaPacoteOfertaRepository
- conclusao-antecipada.e2e.spec.ts
- BLOCO C — Workflow de aprovação
- BLOCO F — Re-teste: conclusão e comissão (bloco 4 do smoke anterior)
- 2. Decisões arquiteturais travadas
- 8.14 Pacote é da empresa — o barbeiro só existe na COMPRA (2026-08-18)
- QA go-live — 2026-08-19 — commit `5445919`
- Achados — nenhum bloqueante
- Polimento pré-go-live (2026-08-19) ✅
- Home do painel — primeira tela depois do login (2026-08-19) ✅
- Correção pós-smoke: preço por barbeiro ponta-a-ponta + 10 bugs (sessão-C) ✅
- Funil único + desconto progressivo (2026-08-14) ✅
- OTP obrigatório + reserva temporária + cota de presenciais (2026-08-13) ✅
- PacoteOfertaRepository
- Onboarding.tsx
- graphify reference: query, path, explain
- BLOCO B — Preço por barbeiro
- BLOCO G — Re-teste: ciclo do pacote (bloco 5 do smoke anterior)
- BLOCO 5 — Ciclo de vida do pacote (máquina de estado sutil)
- Expediente semanal + PIX_ONLINE + walk-in add-on + produtos (sessão 2026-07-16) ✅
- Order-bump rico — Parte 2 (2026-08-17) ✅
- Ajustes no funil público (2026-08-14) ✅
- Barbeiro e aprovação — Fases 2 e 3 (2026-08-14) ✅ / Fases 1 e 4 bloqueadas ⛔
- Grafo de conhecimento (graphify) — 2026-08-19 ✅
- booking/src/lib/telefone.ts
- bateria-testes-2.md
- 3.2 `Barbeiro` (raiz)
- 4. Máquinas de estado
- 5. Minha conta — cockpit do cliente (porta 5175)
- Reorganização do admin — Parte 1 (2026-08-17) ✅
- Correção do teste de expediente (sessão 2026-07-20, continuação) ✅
- Migração open-wa → Baileys (2026-08-10) ✅
- Tela de comissão do barbeiro (2026-08-20) ✅
- Re-smoke: 2 bugs bloqueantes + reorganização de navegação do admin (sessão-D) ✅
- api/package.json
- graphify reference: add a URL and watch a folder
- graphify reference: commit hook and native CLAUDE.md integration
- graphify reference: incremental update and cluster-only
- 3.15 Home do painel — projeção de leitura (2026-08-19)
- BLOCO 0 — Setup e sanidade
- TipoLancamento
- Deploy abstraído: um comando pra local/staging/produção (2026-08-10) ✅
- Gate de envio de OTP removido + rate limit por origem (2026-08-14) ✅
- graphify reference: GitHub clone and cross-repo merge
- graphify reference: transcribe video and audio
- desconto-progressivo.ts
- class-validator
- dotenv
- @nestjs/event-emitter
- @nestjs/platform-express
- reflect-metadata
- .claude/CLAUDE.md
- extraction-spec.md
- MarcarDaCasaDto
- .login
- JanelaExpedienteDto
- @aws-sdk/client-s3
- StatusItemPacote

## God Nodes (most connected - your core abstractions)
1. `CompanyId` - 135 edges
2. `Dinheiro` - 120 edges
3. `UsuarioAutenticado` - 114 edges
4. `UsuarioAtual` - 90 edges
5. `PrismaService` - 86 edges
6. `BarbeiroId` - 75 edges
7. `Barbeiro` - 62 edges
8. `api()` - 60 edges
9. `Atendimento` - 59 edges
10. `InvarianteVioladaError` - 51 edges

## Surprising Connections (you probably didn't know these)
- `RegistrarPagamentoDialog()` --calls--> `api()`  [EXTRACTED]
  apps/admin/src/screens/Fechamento.tsx → apps/admin/src/lib/api.ts
- `LinhaDoFechamento()` --calls--> `dinheiro()`  [EXTRACTED]
  apps/admin/src/screens/Fechamento.tsx → apps/admin/src/lib/format.ts
- `Metrica()` --calls--> `dinheiro()`  [EXTRACTED]
  apps/admin/src/screens/Fechamento.tsx → apps/admin/src/lib/format.ts
- `CarrinhoPrecificado` --references--> `Dinheiro`  [EXTRACTED]
  apps/api/src/modules/catalog/domain/desconto-progressivo.ts → apps/api/src/shared/domain/dinheiro.ts
- `AdicionarItemAtendimentoInput` --references--> `UsuarioAutenticado`  [EXTRACTED]
  apps/api/src/modules/scheduling/application/adicionar-item-atendimento.usecase.ts → apps/api/src/modules/identity/domain/auth-provider.ts

## Import Cycles
- None detected.

## Communities (243 total, 28 thin omitted)

### Community 0 - "account/src/App.tsx"
Cohesion: 0.06
Nodes (66): App(), CockpitOuBook(), Conta(), confirmarLogin(), Tela, QuandoBloco(), AvatarBarbeiro(), ErroEstado() (+58 more)

### Community 1 - "dinheiro.ts"
Cohesion: 0.14
Nodes (13): BASE, agora, depois, solicitar(), assertNaoExcedeCotaPresencial(), LIMITE_PRESENCIAIS_FUTUROS_ATIVOS, ConflitoDeHorarioError, DomainError (+5 more)

### Community 2 - "BarbeiroId"
Cohesion: 0.06
Nodes (28): CLIENTE_DA_CASA_REPOSITORY, ClienteDaCasaRepository, PrismaClienteDaCasaRepository, Injectable, Inject, OnAtendimentoConcluidoHandler, Inject, Injectable (+20 more)

### Community 3 - "agendar-avulso.usecase.ts"
Cohesion: 0.05
Nodes (52): ConfirmarLoginClienteUseCase, Injectable, THROTTLE_LOGIN, Inject, SolicitarReembolsoInput, SolicitarReembolsoOutput, SolicitarReembolsoUseCase, Inject (+44 more)

### Community 4 - "PrismaService"
Cohesion: 0.04
Nodes (34): AppModule, Module, AuthProvider, hashSenha(), Inject, PagamentoStatusQueryService, Injectable, PrismaService (+26 more)

### Community 5 - "dto.ts"
Cohesion: 0.03
Nodes (78): AdicionarItemAtendimentoRequest, AdicionarProdutoAtendimentoRequest, AgendarAvulsoRequest, AgendarComCreditoContaRequest, AgendarComCreditoContaResponse, AgendarComCreditoRequest, AgendarPublicoRequest, AgendarPublicoResponse (+70 more)

### Community 6 - "s3-armazenamento.ts"
Cohesion: 0.06
Nodes (40): Inject, DonoDeFoto, GerenciarFotoUseCase, Inject, Injectable, ARMAZENAMENTO_DE_IMAGENS, ArmazenamentoDeImagens, ASSINATURAS (+32 more)

### Community 7 - "Barbeiro"
Cohesion: 0.05
Nodes (5): Barbeiro, paraDominio(), PrismaBarbeiroRepository, ServicoId, Percentual

### Community 8 - "shared.module.ts"
Cohesion: 0.06
Nodes (20): paraDominio(), PrismaItemDeOrderBumpRepository, SolicitacaoDeReembolso, SolicitacaoDeReembolsoId, SolicitacaoDeReembolsoProps, SOLICITACAO_DE_REEMBOLSO_REPOSITORY, SolicitacaoDeReembolsoRepository, paraDominio() (+12 more)

### Community 9 - "VendaDePacote"
Cohesion: 0.07
Nodes (3): VendaDePacote, paraDominio(), PrismaVendaDePacoteRepository

### Community 10 - "conta-cliente.e2e.spec.ts"
Cohesion: 0.05
Nodes (21): DIA, e164(), sufixo, DIA_FUTURO, e164(), sufixo, e164(), foneExpira (+13 more)

### Community 11 - "UnitOfWork"
Cohesion: 0.07
Nodes (39): Inject, ConfirmarReembolsoInput, Inject, Injectable, VenderPacoteInput, VenderPacoteOutput, VenderPacoteUseCase, ExpirarItensJob (+31 more)

### Community 12 - "Cliente"
Cohesion: 0.09
Nodes (9): Cliente, ClienteProps, ClienteRepository, paraDominio(), PrismaClienteRepository, ConfirmarLoginClienteInput, ConfirmarLoginClienteOutput, IDENTITY_PROVIDER (+1 more)

### Community 13 - "devDependencies"
Cohesion: 0.06
Nodes (35): dependencies, @bigods/contracts, react, react-dom, devDependencies, autoprefixer, postcss, tailwindcss (+27 more)

### Community 14 - "payments.module.ts"
Cohesion: 0.38
Nodes (6): PAYMENT_GATEWAY, criarPaymentGateway(), exigir(), gatewayAtivo(), PaymentsModule, Module

### Community 16 - "Atendimento"
Cohesion: 0.06
Nodes (3): Atendimento, paraDominio(), PrismaAtendimentoRepository

### Community 17 - "booking/src/App.tsx"
Cohesion: 0.13
Nodes (34): App(), Funil(), limparParametroDeLinkNaUrl(), limparParametroDePacoteNaUrl(), ROTULOS_PASSO, slugDoLinkNaUrl(), veioPorPacoteNaUrl(), alternarProdutoNoBump() (+26 more)

### Community 18 - "IdentityProvider"
Cohesion: 0.07
Nodes (20): IniciarLoginClienteInput, IniciarLoginClienteOutput, IniciarLoginClienteUseCase, Inject, Injectable, OnPacoteVendidoHandler, Inject, Injectable (+12 more)

### Community 19 - "UsuarioAutenticado"
Cohesion: 0.10
Nodes (26): UsuarioAutenticado, Get, Put, UsuarioAtual, ParametrosController, Body, Controller, Get (+18 more)

### Community 20 - "booking/src/components/ui.tsx"
Cohesion: 0.15
Nodes (19): BigodsClub(), OtpVerificacao(), PagamentoManualAguardando(), PixAguardando(), AlertaErro(), Avatar(), ErroEstado(), Loading() (+11 more)

### Community 21 - "booking-publico.controller.ts"
Cohesion: 0.08
Nodes (24): SERVICO_REPOSITORY, ServicoRepository, TipoItemDeOrderBump, ITEM_DE_ORDER_BUMP_REPOSITORY, ItemDeOrderBumpRepository, OrderBumpConfigController, Body, Controller (+16 more)

### Community 22 - "DisponibilidadeBarbeiro"
Cohesion: 0.13
Nodes (5): DisponibilidadeBarbeiro, DisponibilidadeRepository, paraDominio(), PrismaDisponibilidadeRepository, DisponibilidadeId

### Community 23 - "Servico"
Cohesion: 0.11
Nodes (3): Servico, paraDominio(), PrismaServicoRepository

### Community 24 - "payroll.module.ts"
Cohesion: 0.08
Nodes (21): RegistrarPagamentoUseCase, Injectable, acumularEm(), FechamentoQueryService, Totais, totaisVazios(), Injectable, ComissaoController (+13 more)

### Community 25 - "barbeiros.controller.ts"
Cohesion: 0.16
Nodes (19): Papeis(), assertNaoRemoveUltimoAdminAtivo(), slugDoNome(), slugUnico(), AlterarStatusDto, BarbeirosController, ehColisaoDeLogin(), paraDTO() (+11 more)

### Community 26 - "webhooks.controller.ts"
Cohesion: 0.24
Nodes (7): comparaSegura(), EntradaVerificacaoWebhook, assinaturaValida, corpo, verificarWebhookAbacatePay(), AbacatePayWebhookGuard, Injectable

### Community 27 - "IntencaoDePagamento"
Cohesion: 0.11
Nodes (4): IntencaoDePagamento, IntencaoDePagamentoRepository, paraDominio(), PrismaIntencaoDePagamentoRepository

### Community 28 - "staff.module.ts"
Cohesion: 0.15
Nodes (8): MaterializarExpedienteUseCase, Inject, Injectable, MaterializarExpedienteJob, Cron, Injectable, StaffModule, Module

### Community 29 - "calendario.ts"
Cohesion: 0.09
Nodes (34): AtendimentoComItens, DataHoraLocal, diaCivilChave(), diaCivilMaisDias(), diaDaSemanaCivil(), diferencaDiasCivis(), fimDoDiaCivilMaisDias(), horaLocalHHmm() (+26 more)

### Community 30 - "api"
Cohesion: 0.10
Nodes (34): Foto(), FotoUpload(), iniciais(), useApi(), api(), apiUpload(), token(), BOOKING_URL (+26 more)

### Community 31 - "app.module.ts"
Cohesion: 0.05
Nodes (25): THROTTLER_OTP_ORIGEM, CatalogModule, Module, CustomersModule, Module, FunnelModule, Module, ENVIA_OTP (+17 more)

### Community 32 - "cliente.guard.ts"
Cohesion: 0.12
Nodes (12): Inject, ClienteSessaoService, Injectable, ClienteAtualOpcional, ClienteGuard, ClienteGuardOpcional, ContaClienteOpcional(), Inject (+4 more)

### Community 33 - "produtos.controller.ts"
Cohesion: 0.14
Nodes (14): paraDTO(), ProdutosController, Body, Controller, Delete, Get, Inject, Param (+6 more)

### Community 34 - "dependencies"
Cohesion: 0.10
Nodes (21): dependencies, @aws-sdk/client-cognito-identity-provider, @bigods/contracts, class-transformer, @nestjs/common, @nestjs/core, @nestjs/schedule, @nestjs/throttler (+13 more)

### Community 35 - ".criar"
Cohesion: 0.15
Nodes (11): autorizarProprioOuAdmin(), DisponibilidadesController, paraDTO(), Body, Controller, Delete, Get, Inject (+3 more)

### Community 36 - "Vale"
Cohesion: 0.07
Nodes (7): Inject, Inject, Inject, Vale, ValeRepository, paraDominio(), PrismaValeRepository

### Community 37 - "CriarBarbeiroDto"
Cohesion: 0.19
Nodes (20): AtualizarComissaoDto, AtualizarCredenciaisDto, AtualizarPrecosDto, AtualizarServicosDto, AtualizarSlugDto, AtualizarUsuarioDto, CriarBarbeiroDto, ExcecaoDto (+12 more)

### Community 38 - "cognito-triggers.spec.ts"
Cohesion: 0.10
Nodes (16): create, define, verify, CONFIG, { enviarSms, paraE164, SmsGateError, ENDPOINT_PADRAO }, crypto, { enviarSms }, handler() (+8 more)

### Community 39 - "admin/src/components/ui.tsx"
Cohesion: 0.24
Nodes (12): BotaoAtualizar(), Dialog(), ErroEstado(), Loading(), Vazio(), ApiError, TimezoneContext, Fechamento() (+4 more)

### Community 40 - "Decisões Pendentes"
Cohesion: 0.04
Nodes (49): 10. Versão/base da API do AbacatePay — ✅ RESOLVIDO (sessão de ligação do pagamento online): v2, Checkout Transparente, 11. Webhook do AbacatePay só é MONTADO com o gateway real, 12. Catálogo de ofertas de pacote (`PacoteOferta`) não é modelado no domínio — ✅ RESOLVIDO (sessão-B, Fase 1), 13. Produtos: SEM controle de estoque (decisão consciente, pedida explicitamente), 14. CRUD de ofertas de pacote (DECISOES #10) e CRUD de produtos: consistência a médio prazo — ✅ RESOLVIDO (sessão-B, Fase 1), 15. Granularidade do expediente: uma janela por dia na UI do admin, 16. Nome placeholder para Cliente criado só pelo login (bug 2, sessão 2026-07-20), 17. RASCUNHO de `PacoteOferta`: nenhum gatilho de UI o produz (sessão-B, Fase 3) (+41 more)

### Community 41 - "admin/src/App.tsx"
Cohesion: 0.13
Nodes (16): Aba, ABAS_ADMIN, ABAS_BARBEIRO_NAO_ADMIN, App(), FotoDoUsuario(), icones, rotulos, BotaoSair() (+8 more)

### Community 42 - "Sucesso.tsx"
Cohesion: 0.12
Nodes (21): IconeDeMarca(), IconeWhatsapp(), Props, baixarIcs(), conteudoIcs(), escaparIcs(), EventoDeAgenda, fim() (+13 more)

### Community 43 - "devDependencies"
Cohesion: 0.06
Nodes (35): dependencies, @bigods/contracts, react, react-dom, devDependencies, autoprefixer, postcss, tailwindcss (+27 more)

### Community 44 - "Agenda.tsx"
Cohesion: 0.19
Nodes (16): AtendimentoDetalheDialog(), labelStatus, toneStatus, valorACobrarNaConclusao(), valorNaoCobertoPorCredito(), diferencaDias(), ehHoje(), hojeISO() (+8 more)

### Community 45 - "dinheiro"
Cohesion: 0.16
Nodes (18): dataCurta(), dinheiro(), idEfetivo(), useTimezone(), ehDebito(), Extrato(), LinhaDoExtrato(), SaldoLiquido() (+10 more)

### Community 46 - "Relatório da Sessão — Bigod's Barber v2"
Cohesion: 0.08
Nodes (25): Ajustes no painel admin (sessão 2026-07-15) ✅, Avulso online dispensa o OTP (2026-08-14) ✅, Checklist de smoke test manual (ponta a ponta — rodar antes do dia 20), Como rodar localmente, Correção de fuso horário (sessão 2026-07-14, continuação) ✅, Correção: prazo de pagamento do pacote volta a ser 1h (2026-08-14) ✅, CRUD de usuários staff/admin no painel (2026-08-12) ✅, Decisões pendentes (DECISOES_PENDENTES.md) (+17 more)

### Community 47 - "ExpedienteSemanal"
Cohesion: 0.16
Nodes (5): ExpedienteSemanal, validarJanelas(), agruparPorBarbeiro(), paraDominio(), PrismaExpedienteSemanalRepository

### Community 48 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, baseUrl, declaration, emitDecoratorMetadata, experimentalDecorators, outDir, types, extends (+5 more)

### Community 49 - "ClienteAutenticado"
Cohesion: 0.26
Nodes (10): ClienteAutenticado, ClienteAtual, ContaCliente(), ContaClienteController, Body, Controller, Get, Param (+2 more)

### Community 50 - "atendimento.spec.ts"
Cohesion: 0.10
Nodes (14): ServicoProps, base, agendar(), barbeiro, disponibilidade, itemCorte(), t(), DisponibilidadeProps (+6 more)

### Community 52 - "What You Must Do When Invoked"
Cohesion: 0.08
Nodes (24): For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify, Honesty Rules, Interpreter guard for subcommands, Part A - Structural extraction for code files (+16 more)

### Community 53 - "scripts"
Cohesion: 0.07
Nodes (26): dependencies, @prisma/client, devDependencies, prisma, turbo, @types/node, prisma, @prisma/client (+18 more)

### Community 54 - "PacotesQueryService"
Cohesion: 0.11
Nodes (14): ConfirmarPagamentoPresencialUseCase, Injectable, ConfirmarReembolsoUseCase, Inject, Injectable, PacotesQueryService, Injectable, PacotesController (+6 more)

### Community 55 - "CompanyId"
Cohesion: 0.06
Nodes (41): ItemDeOrderBumpProps, MAX_MENSAGEM_BUMP, ContextoValidacaoPacoteOferta, PacoteOfertaProps, PACOTE_OFERTA_REPOSITORY, ParametrosDaEmpresaRepository, ItemDoPacote, ItemParaVenda (+33 more)

### Community 56 - "HorariosDisponiveisQueryService"
Cohesion: 0.18
Nodes (6): assertDentroDaJanelaDeAgendamento(), somarDias(), HorariosDisponiveisQueryService, Inject, Injectable, sufixo

### Community 57 - "Pacotes.tsx"
Cohesion: 0.10
Nodes (26): AcaoDeItem, BadgeDeItem, CabecalhoDeCatalogo(), EstadoDaLista(), ItemDeCatalogo(), Badge(), CurrencyInput(), Tabs() (+18 more)

### Community 58 - "identity.module.ts"
Cohesion: 0.07
Nodes (22): AUTH_PROVIDER, criarIdentityProvider(), exigir(), IdentityModule, Global, Module, DemoIdentityProvider, Injectable (+14 more)

### Community 59 - "vendas-produto.controller.ts"
Cohesion: 0.10
Nodes (21): Injectable, VenderProdutoAvulsoUseCase, Injectable, VendasProdutoQueryService, ItemVendaDto, ArrayNotEmpty, Controller, Get (+13 more)

### Community 60 - "VendaDeProduto"
Cohesion: 0.10
Nodes (10): CLIENTE_REPOSITORY, Inject, VenderProdutoAvulsoInput, VendaDeProduto, VENDA_DE_PRODUTO_REPOSITORY, VendaDeProdutoRepository, include, paraDominio() (+2 more)

### Community 61 - "Confirmacao.tsx"
Cohesion: 0.20
Nodes (11): SummaryBar(), CartaoDeBump(), OrderBump(), ResumoDoDesconto(), useEmpresa(), dinheiro(), CarrinhoFunil, FunnelState (+3 more)

### Community 62 - "PacoteOfertasController"
Cohesion: 0.24
Nodes (10): somaDeReferenciaDaCasa(), PacoteOfertasController, paraDTO(), Body, Controller, Get, Inject, Param (+2 more)

### Community 63 - "AgendarAvulsoDto"
Cohesion: 0.14
Nodes (20): AdicionarItemDto, AdicionarProdutoDto, AgendarAvulsoDto, AgendarComCreditoDto, CancelarDto, ClienteInlineDto, ConcluirDto, ArrayNotEmpty (+12 more)

### Community 64 - "whatsapp-otp/package.json"
Cohesion: 0.11
Nodes (17): baileys, pino, qrcode-terminal, dependencies, baileys, express, pino, qrcode-terminal (+9 more)

### Community 65 - "desconto.ts"
Cohesion: 0.18
Nodes (14): calcularDescontoProgressivo(), CarrinhoDoFunilCalculado, DegrauDeDescontoDTO, DescontoCalculado, descontoNominalCentavos(), indiceDoMaiorPeso(), ItemDoCarrinhoParaPreco, ItemDoCarrinhoPrecificado (+6 more)

### Community 66 - "devDependencies"
Cohesion: 0.09
Nodes (23): devDependencies, @bigods/config, @nestjs/cli, @nestjs/testing, supertest, @swc/core, tsx, @types/node (+15 more)

### Community 67 - "HomeQueryService"
Cohesion: 0.13
Nodes (7): ticketMedioCentavos(), ComissaoQueryService, Injectable, HomeQueryService, Injectable, Inject, Inject

### Community 68 - "enums.ts"
Cohesion: 0.10
Nodes (20): AgendamentoClienteDTO, AtendimentoDTO, ConcluirAtendimentoRequest, DisponibilidadeDTO, HomeAgendamentoDTO, PacoteOfertaDTO, PagamentoStatusDTO, SolicitacaoDeReembolsoDTO (+12 more)

### Community 69 - ".atualizar"
Cohesion: 0.17
Nodes (9): paraDTO(), ServicosController, Body, Controller, Get, Inject, Param, Patch (+1 more)

### Community 70 - "Publico"
Cohesion: 0.37
Nodes (5): Publico(), BookingPublicoController, Controller, Get, Query

### Community 71 - "vales.controller.ts"
Cohesion: 0.08
Nodes (24): AprovarValeUseCase, Injectable, MarcarValePagoUseCase, Inject, Injectable, NegarValeUseCase, Injectable, SolicitarValeUseCase (+16 more)

### Community 72 - "AgendarPublicoDto"
Cohesion: 0.06
Nodes (46): AgendarAvulsoContaDto, AgendarComCreditoContaDto, ConfirmarLoginDto, IniciarLoginDto, ReagendarContaDto, ArrayNotEmpty, IsArray, IsOptional (+38 more)

### Community 73 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noImplicitOverride (+7 more)

### Community 74 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module, moduleResolution (+12 more)

### Community 75 - "ClientesController"
Cohesion: 0.22
Nodes (8): ClientesController, Body, Controller, Delete, Get, Param, Post, Query

### Community 76 - ".vender"
Cohesion: 0.19
Nodes (9): paraDTO(), PacotesPublicoController, Body, Controller, Get, Param, Post, Query (+1 more)

### Community 77 - "3. Agregados"
Cohesion: 0.12
Nodes (17): 3.10 `VendaDeProduto` (raiz) — item 4b da sessão 2026-07-16, 3.11 `PacoteOferta` (raiz) — sessão-B (Fases 1 e 3), 3.12 `Vale` (raiz) — adiantamento de comissão (sessão de vale/pagamento), 3.13 `ItemDeOrderBump` (raiz) — sessão 2026-08-17, Parte 2, 3.14 Imagens de upload — foto de barbeiro e de produto (2026-08-19), 3.1 `Servico` (raiz), 3.3.1 `ExpedienteSemanal` (item 1 da sessão 2026-07-16), 3.3 `DisponibilidadeBarbeiro` (raiz) (+9 more)

### Community 78 - "tsconfig.build.json"
Cohesion: 0.25
Nodes (7): exclude, extends, include, src, test, ./tsconfig.json, **/*.spec.ts

### Community 79 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module, moduleResolution (+14 more)

### Community 80 - "Estratégia de infraestrutura na AWS — documento de decisão"
Cohesion: 0.12
Nodes (15): 10. Backups e observabilidade, 11. Decisões que precisam da sua palavra final, 1. O que existe hoje (e o que isso implica pra AWS), 2. Mapeamento componente → serviço AWS, 3. As três estratégias, em detalhe, 4. Recomendação, 5. Estimativa de custo mensal (aproximada — confirme na calculadora oficial da AWS antes de decidir), 6. Rede: como evitar o NAT Gateway sem abrir mão de segurança (+7 more)

### Community 81 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, db:generate, db:migrate, db:seed, dev, start, test (+2 more)

### Community 82 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib, module, moduleResolution (+14 more)

### Community 83 - "tasks"
Cohesion: 0.15
Nodes (13): ^build, dist/**, dependsOn, outputs, cache, persistent, $schema, tasks (+5 more)

### Community 84 - "materializar-expediente.usecase.ts"
Cohesion: 0.33
Nodes (6): DefinirExpedienteInput, MaterializarExpedienteInput, DiaSemana, JanelaExpediente, EXPEDIENTE_SEMANAL_REPOSITORY, ExpedienteSemanalRepository

### Community 85 - "RegistrarPagamentoDto"
Cohesion: 0.33
Nodes (6): RegistrarPagamentoDto, IsNumber, IsOptional, IsString, Min, IsISO8601

### Community 86 - "Passo a passo do deploy"
Cohesion: 0.12
Nodes (15): 1. Criar as 3 funções Lambda, 2. Env vars da `create-auth`, 3. Timeout da `create-auth`, 4. Permitir que o Cognito invoque as Lambdas, 5. Ligar os triggers no User Pool, 6. Habilitar CUSTOM_AUTH no App Client, 7. Permissão da API (IAM), 8. Variáveis da API (+7 more)

### Community 87 - "AtualizarPacoteOfertaDto"
Cohesion: 0.33
Nodes (12): AtualizarPacoteOfertaDto, CriarPacoteOfertaDto, ItemComposicaoDto, RejeitarPacoteOfertaDto, ArrayNotEmpty, IsArray, IsInt, IsPositive (+4 more)

### Community 88 - "VenderPacoteDto"
Cohesion: 0.18
Nodes (12): ClienteInlineDto, ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsOptional, IsPositive, IsString (+4 more)

### Community 89 - "DefinirDescontoDto"
Cohesion: 0.21
Nodes (12): AtualizarParametrosDto, DefinirDescontoDto, DegrauDto, IsArray, IsInt, IsOptional, IsPositive, Max (+4 more)

### Community 90 - "precificacao-pacote.ts"
Cohesion: 0.18
Nodes (6): ItemComposicaoPacote, precoDeReferencia(), somaDeReferencia(), CandidatoAAtribuicao, escolherBarbeiroSemPreferencia(), Sorteio

### Community 91 - "8. Casos de uso principais"
Cohesion: 0.14
Nodes (14): 8.11 Funil único — apresentação unificada, transações separadas, 8.12 "Não tenho preferência" — horários globais e atribuição na confirmação, 8.13 Order-bump — "Adicione à sua visita" (sessão 2026-08-17), 8.1 Agendar avulso (funil público) — sessão de OTP+reserva, 8.2 Agendar consumindo crédito (área logada), 8.3 Concluir atendimento (painel), 8.4 Cliente falta, 8.5 Funil público — ordem das etapas e link pessoal de barbeiro (sessão-B, Fase 4) (+6 more)

### Community 93 - "LoginDto"
Cohesion: 0.67
Nodes (4): LoginDto, TrocarSenhaDto, IsString, MinLength

### Community 94 - "2. Funil público — o que o cliente vê (porta 5174)"
Cohesion: 0.15
Nodes (13): 2. Funil público — o que o cliente vê (porta 5174), Caso 10 — Link pessoal do barbeiro, Caso 11 — Aviso de sessão ativa, Caso 12 — Mobile, Caso 1 — Landing e identidade, Caso 2 — Escolha de barbeiro, com foto ★, Caso 3 — Foto quebrada cai nas iniciais ★, Caso 4 — Desconto progressivo (+5 more)

### Community 96 - "static-server/package.json"
Cohesion: 0.18
Nodes (10): dependencies, express, http-proxy-middleware, description, express, main, name, private (+2 more)

### Community 97 - "contracts/package.json"
Cohesion: 0.11
Nodes (17): devDependencies, @bigods/config, typescript, vitest, exports, @bigods/config, typescript, vitest (+9 more)

### Community 98 - "prompt-sessao-B.md"
Cohesion: 0.15
Nodes (12): 4a. Reordenação, 4b. Link próprio do barbeiro (marketing individual), 4c. Registrar a origem do agendamento, Demais requisitos da fase, Economia visível para o cliente, FASE 1 — PacoteOferta vira domínio de primeira classe, FASE 2 — Preço por barbeiro (★ a parte mais sensível), FASE 3 — Workflow de aprovação de PacoteOferta (+4 more)

### Community 99 - "devDependencies"
Cohesion: 0.06
Nodes (35): dependencies, @bigods/contracts, react, react-dom, devDependencies, autoprefixer, postcss, tailwindcss (+27 more)

### Community 100 - "booking/src/lib/format.ts"
Cohesion: 0.35
Nodes (9): SlotSkeleton(), Vazio(), diasDaSemana(), hojeISO(), proximosDias(), rotuloDia(), rotuloSemana(), somarDias() (+1 more)

### Community 102 - "Ligação do pagamento online — AbacatePay em SANDBOX, Checkout Transparente v2 (2026-08-13) ✅"
Cohesion: 0.15
Nodes (13): Assinatura do webhook — o esquema real é diferente do que o código anterior fazia, Confirmação do formato v2, ⚠️ Desvio deliberado da instrução original — `transparent.lost`, ★ FASE 1 — modo do gateway: era v1/hospedado presumido, virou v2 Checkout Transparente, FASE 2 — boot e configuração segura, FASE 3 — política do funil (decisão do dono), FASE 4 — cobrança e expiração, FASE 5 — testes (+5 more)

### Community 103 - "PacoteAtendimentoHandlers"
Cohesion: 0.52
Nodes (3): PacoteAtendimentoHandlers, Injectable, OnEvent

### Community 104 - "cobranca-online.service.ts"
Cohesion: 0.33
Nodes (7): ResultadoDaCobranca, DadosDaComanda, dinheiro(), LinhaDaComanda, linkDaComanda(), montarComanda(), AVULSO

### Community 105 - "ExpirarPagamentoVencidoUseCase"
Cohesion: 0.40
Nodes (3): ExpirarPagamentoVencidoUseCase, Inject, Injectable

### Community 106 - "AtualizarServicoDto"
Cohesion: 0.36
Nodes (8): AtualizarServicoDto, CriarServicoDto, IsBoolean, IsInt, IsOptional, IsPositive, IsString, MinLength

### Community 107 - "ConfigurarDto"
Cohesion: 0.25
Nodes (8): ConfigurarDto, IsBoolean, IsInt, IsOptional, IsPositive, IsString, MaxLength, Min

### Community 108 - "LocalAuthProvider"
Cohesion: 0.32
Nodes (3): LocalAuthProvider, Injectable, verificaSenha()

### Community 110 - "DiaDeExpedienteDto"
Cohesion: 0.32
Nodes (8): DefinirExpedienteDto, DiaDeExpedienteDto, IsArray, IsInt, Max, Min, Type, ValidateNested

### Community 111 - "otp-sem-conta.e2e.spec.ts"
Cohesion: 0.32
Nodes (6): DIA, e164(), garantirInedito(), iniciarOtp(), loginCompleto(), sufixo

### Community 112 - "config/package.json"
Cohesion: 0.25
Nodes (7): files, name, private, version, eslint.config.js, prettier.config.js, tsconfig.base.json

### Community 113 - "Upload de imagens — foto de barbeiro e de produto (2026-08-19) ✅"
Cohesion: 0.15
Nodes (13): Fallback — nunca imagem quebrada, Migration, O que conferir no deploy, Onde a foto aparece, Otimização — os números escolhidos e por quê, Quando o upload falha: como descobrir por quê, Rodando com upload em DEV, Roteiro de smoke test manual (+5 more)

### Community 114 - "gerar-icones.mjs"
Cohesion: 0.25
Nodes (4): APPS, PNGS, RAIZ, TAMANHOS_ICO

### Community 115 - "nest-cli.json"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, tsConfigPath, $schema, sourceRoot

### Community 116 - "empresa-publica-query.service.ts"
Cohesion: 0.31
Nodes (5): bootstrap(), assertConfiguracaoSegura(), ConfiguracaoInseguraError, CONFIG_PAGAMENTO_MANUAL, lerConfigPagamentoManual()

### Community 117 - "Pagamentos (PIX via AbacatePay — Checkout Transparente v2)"
Cohesion: 0.17
Nodes (11): Adapters, Endpoints da AbacatePay usados, Eventos assinados nesta conta, Expiração de PIX não pago (timeout local, sem webhook), Fluxo ponta a ponta (venda de pacote, sempre "online"), Opção A — payload v2 assinado à mão (sem túnel), Opção B — sandbox real do AbacatePay (dashboard aberto), Pagamentos (PIX via AbacatePay — Checkout Transparente v2) (+3 more)

### Community 118 - "vale.aggregate.ts"
Cohesion: 0.28
Nodes (6): AprovarValeInput, NegarValeInput, SolicitarValeInput, ValeProps, VALE_REPOSITORY, ValeId

### Community 119 - ".definir"
Cohesion: 0.28
Nodes (7): autorizarProprioOuAdmin(), ExpedienteController, Body, Controller, Get, Param, Put

### Community 120 - "CLAUDE.md — Bigod's Barber"
Cohesion: 0.17
Nodes (11): Anti-padrões proibidos (erros reais da v1 — DOMAIN.md §10), Arquitetura — regras invioláveis, CLAUDE.md — Bigod's Barber, Convenções, Fora de escopo (não implementar mesmo que pareça óbvio — DOMAIN.md §11), graphify, O grafo NÃO substitui o DOMAIN.md, O que é este projeto (+3 more)

### Community 122 - "CobrancaOnlineService"
Cohesion: 0.25
Nodes (5): Inject, CobrancaOnlineService, Inject, Injectable, ConfigPagamentoManual

### Community 125 - "server.js"
Cohesion: 0.33
Nodes (5): app, { createProxyMiddleware }, express, path, PORT

### Community 126 - "Papel"
Cohesion: 0.33
Nodes (6): AtualizarUsuarioRequest, BarbeiroDTO, CriarBarbeiroRequest, UsuarioDTO, UsuarioStaffDTO, Papel

### Community 127 - "deploy.sh"
Cohesion: 0.60
Nodes (4): checar_var(), erro(), info(), deploy.sh script

### Community 128 - "index.js"
Cohesion: 0.33
Nodes (3): app, logger, PORT

### Community 129 - "Deploy — Bigod's Barber"
Cohesion: 0.18
Nodes (10): Deploy — Bigod's Barber, `.env` — três arquivos-molde diferentes, propositalmente, Frontends (admin/booking/account) — deploy SEPARADO, não roda na EC2, Local (dev), No dia a dia (redeploy), O que sobe onde, Produção (AWS — EC2 + RDS + S3/CloudFront), Pré-requisitos na máquina de staging/produção (+2 more)

### Community 130 - "whatsapp-otp-service"
Cohesion: 0.18
Nodes (10): Como o backend se conecta a este serviço, Como rodar, Direto (sem Docker), Endpoints, Rodando de verdade (produção, fora do Docker), Troubleshooting, ⚠️ Use um número DESCARTÁVEL, Variáveis de ambiente (+2 more)

### Community 132 - "PaymentGateway"
Cohesion: 0.17
Nodes (8): CobrancaPix, PaymentGateway, AbacatePayConfig, AbacatePayGateway, FetchLike, config, FakeAbacatePayGateway, Injectable

### Community 133 - "env-up.sh"
Cohesion: 0.60
Nodes (3): derrubar_servidores(), matar_arvore(), env-up.sh script

### Community 134 - "WebhooksController"
Cohesion: 0.20
Nodes (7): extrairExternalId(), Body, Controller, Post, Throttle, WebhooksController, UseGuards

### Community 135 - "Bigod's Barber — Especificação de Domínio"
Cohesion: 0.20
Nodes (9): 10. Anti-padrões — o que NÃO fazer, 11. Fora de escopo no MVP (decidido, não esquecido), 1. Contexto do negócio, 5. Eventos de domínio, 6. Camadas e regra de dependência, 7. Estrutura de pastas (monorepo), 9. Testes — onde investir, Bigod's Barber — Especificação de Domínio (+1 more)

### Community 136 - "deploy-frontends.sh"
Cohesion: 0.60
Nodes (3): deploy_app(), info(), deploy-frontends.sh script

### Community 137 - "env-down.sh"
Cohesion: 0.83
Nodes (3): derrubar_servidores(), matar_arvore(), env-down.sh script

### Community 139 - "Roteiro de QA — antes de todo deploy"
Cohesion: 0.20
Nodes (10): 0. Pré-condições — o agente PARA se qualquer uma falhar, 1. Verificações transversais — valem em TODA tela, 3. Pacote / Bigod's Club (porta 5174), 6. Saúde geral, 7. O que este roteiro NÃO cobre — de propósito, 8. Relatório final — o formato que decide o deploy, Caso 13 — Comprar pacote ★, Caso 25 — Lighthouse no funil (+2 more)

### Community 140 - ".deCentavos"
Cohesion: 0.08
Nodes (12): precificarCarrinho(), criar(), contexto(), hoje, item(), prazo10, tz, vender() (+4 more)

### Community 141 - "BLOCO 1 — Funil público avulso (booking, sem login)"
Cohesion: 0.20
Nodes (10): 1.1 — Caminho feliz (avulso presencial), 1.2 — Fuso horário (já pegou bug antes), 1.3 — Multi-serviço, 1.4 — Conflito de horário, 1.5 — Reconciliação por telefone, 1.6 — Refresh no meio do funil, 1.7 — Slot que encheu enquanto olhava, 1.8 — Barbearia fechada (+2 more)

### Community 142 - "BLOCO 4 — Admin: agenda e conclusão (onde dinheiro é registrado)"
Cohesion: 0.20
Nodes (10): 4.1 — Concluir avulso presencial, 4.2 — ★ Concluir pago-online (bug corrigido), 4.3 — Walk-in add-on, 4.4 — ★ Add-on em atendimento pago-online, 4.5 — ★ Add-on em atendimento de CRÉDITO de pacote (lacuna que acharam), 4.6 — ★ Comissão rateada, 4.7 — Comissão com exceção por serviço, 4.8 — Cancelar antecipado (+2 more)

### Community 159 - "contracts/tsconfig.json"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, rootDir, exclude, extends, include, @bigods/config/tsconfig.base.json, src (+1 more)

### Community 160 - "lancamento-comissao.spec.ts"
Cohesion: 0.14
Nodes (13): barbeiro, criar(), ocorridoEm, calcularSaldoCentavos(), sinalDoTipo(), comissao(), ocorridoEm, pagamento() (+5 more)

### Community 161 - "Correção de bugs de smoke test manual (sessão 2026-07-20) ✅"
Cohesion: 0.20
Nodes (10): Bug 1 — OTP duplo pós-compra e loop de repagamento (crítico), Bug 2 — telefone sem conta ficava preso no OTP sem feedback, Bug 3 — mensagem crua de conflito de horário, Bug 4 — comissão não carregava com o primeiro barbeiro do select, Bug 5 — add-on em atendimento de crédito não mostrava o valor a cobrar, Bug 6 — prazo de segunda chance mostrava 11 dias em vez de 10, Bug 7 — mensagens com gênero/plural errados no cockpit, Bug 8 — admin não conseguia confirmar pagamento presencial de pacote (+2 more)

### Community 162 - "DefinirExpedienteUseCase"
Cohesion: 0.33
Nodes (4): DefinirExpedienteUseCase, Inject, Injectable, Inject

### Community 164 - "AtualizarProdutoDto"
Cohesion: 0.36
Nodes (8): AtualizarProdutoDto, CriarProdutoDto, IsBoolean, IsInt, IsOptional, IsPositive, IsString, MinLength

### Community 165 - "graphify reference: extra exports and benchmark"
Cohesion: 0.22
Nodes (8): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7a - FalkorDB export (only if --falkordb or --falkordb-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 166 - "BLOCO D — Funil reordenado + link pessoal"
Cohesion: 0.22
Nodes (9): BLOCO D — Funil reordenado + link pessoal, D.1 — Barbeiro vem PRIMEIRO, D.2 — Skip automático com um só barbeiro, D.3 — ★ Link pessoal do barbeiro, D.4 — ★ Link vence estado salvo (armadilha clássica), D.5 — Saída "ver outros profissionais", D.6 — Slug inválido, D.7 — Origem registrada (+1 more)

### Community 167 - "resultado-bateria-testes1.md"
Cohesion: 0.22
Nodes (8): 6.1 — Disponibilidade por barbeiro, 6.2 — Isolamento de agenda por barbeiro, 6.3 — Editar expediente reflete na disponibilidade, Anotações livres (bugs/ideias que não se encaixam em nenhum cenário), BLOCO 6 — Multi-barbeiro (ensaio pra Sessão B), Regras de ouro enquanto testa, Resumo (preencher no fim), Smoke Test Manual — Bigod's Barber v2

### Community 168 - "BLOCO 3 — Cockpit do cliente (account)"
Cohesion: 0.22
Nodes (9): 3.1 — Login OTP feliz, 3.2 — ★ Telefone sem conta / cliente só-avulso, 3.3 — Agendar com crédito, 3.4 — Fichas com estados diferentes, 3.5 — Alerta de segunda chance, 3.6 — Saldo residual, 3.7 — Cliente sem nenhum pacote, 3.8 — Segurança: pacote de outro cliente (+1 more)

### Community 169 - "Pagamento manual por WhatsApp — ponte TEMPORÁRIA (2026-08-18) ✅"
Cohesion: 0.22
Nodes (9): A comanda, A flag, ON vs OFF — o que muda de fato, Onde a decisão mora, Pagamento manual por WhatsApp — ponte TEMPORÁRIA (2026-08-18) ✅, Quando a AbacatePay liberar, Reuso, não reconstrução, Roteiro de smoke test manual (+1 more)

### Community 170 - "Comissão de produto — taxa única da empresa (2026-08-19) ✅"
Cohesion: 0.22
Nodes (9): A prova do snapshot, ⚠️ A taxa começa em ZERO — alguém precisa definir o número, ⚠️ Antes de tudo: a premissa do pedido estava incorreta, Comissão de produto — taxa única da empresa (2026-08-19) ✅, Confirmação de que serviço não regrediu, Migration, Onde a comissão de produto era calculada — e o que mudou, Roteiro de smoke test manual (+1 more)

### Community 171 - "Pacote é da empresa — barbeiro dono extinto (2026-08-18) ✅"
Cohesion: 0.22
Nodes (9): A única regra que sobrou, ACL do barbeiro (segunda rodada, mesmo dia), Duas decisões de dinheiro, confirmadas antes de mexer, Migration, O que foi extinto, Onde aparece, Pacote é da empresa — barbeiro dono extinto (2026-08-18) ✅, Roteiro de smoke test manual (+1 more)

### Community 172 - "RolesGuard"
Cohesion: 0.40
Nodes (3): RolesGuard, Inject, Injectable

### Community 173 - "Sessão de lançamento (2026-07-31) — OTP por WhatsApp + produção presencial-only ✅"
Cohesion: 0.22
Nodes (9): Como rodar o serviço OpenWA e conectar o número, Confirmação: produção sobe com whatsapp+presencial, sem AWS, O que precisa de smoke test manual, PARTE 1 — OTP por WhatsApp via OpenWA, PARTE 2 — Produção sobe com pagamento online desligado, Sessão de lançamento (2026-07-31) — OTP por WhatsApp + produção presencial-only ✅, Testes, Variáveis de ambiente que mudaram (+1 more)

### Community 174 - "Sessão-E (2026-07-31) — autonomia do cliente no cockpit ✅"
Cohesion: 0.22
Nodes (9): FASE 1 — Histórico e detalhe no cockpit (leitura pura), FASE 2 — Cancelar pelo cockpit (§8.6), FASE 3 — Reagendar pelo cockpit (§8.6), FASE 4a — Abater saldo residual em avulso (§8.7) 💰, FASE 4b — Reembolso manual (SolicitacaoDeReembolso, §8.7) 💰, FASE 5 — DOMAIN.md atualizado, O que precisa de smoke test manual, Sessão-E (2026-07-31) — autonomia do cliente no cockpit ✅ (+1 more)

### Community 175 - "Vale, pagamento e fechamento — ledger de 3 direções (2026-08-13) ✅"
Cohesion: 0.22
Nodes (9): FASE 1 — Vale (solicitação → aprovação → pagamento), FASE 2 — Pagamento ao barbeiro, FASE 3 — Extrato (`Financeiro.tsx`, sub-aba "Extrato"), FASE 4 — Fechamento (gestão, admin only), FASE 5 — App do barbeiro = mesmo painel, versão reduzida, FASE 6 — DOMAIN.md, Reorganização de navegação (efeito colateral desta sessão), Smoke test manual (pendente — precisa de humano com dinheiro fictício) (+1 more)

### Community 176 - "BLOCO A — CRUD de oferta de pacote (novo)"
Cohesion: 0.25
Nodes (8): A.1 — Criar oferta simples (um serviço), A.2 — ★ Criar oferta MISTA (o que não dava pra testar antes), A.3 — ★ Modo de entrada por PERCENTUAL, A.4 — ★ Preço é a fonte de verdade (teste chave), A.5 — Invariantes de cadastro, A.6 — Serviço que o barbeiro não atende, A.7 — Desativar oferta, BLOCO A — CRUD de oferta de pacote (novo)

### Community 177 - "BLOCO E — Re-teste: pacote + pagamento (bloco 2 do smoke anterior)"
Cohesion: 0.25
Nodes (8): BLOCO E — Re-teste: pacote + pagamento (bloco 2 do smoke anterior), E.1 — ★ Comprar pacote MISTO online, ponta a ponta, E.2 — ★★ Rateio do pacote misto (centavo a centavo), E.3 — Economia visível no funil, E.4 — Pagou mas não confirmou, E.5 — Idempotência do pagamento, E.6 — Pacote presencial + confirmação no admin (bug 8 corrigido), E.7 — OTP único pós-compra (bug 1 corrigido)

### Community 178 - "4. Painel administrativo (porta 5173)"
Cohesion: 0.25
Nodes (8): 4. Painel administrativo (porta 5173), Caso 14 — Aprovar o pagamento do avulso ★, Caso 15 — Aprovar duas vezes não duplica, Caso 16 — Liberar os créditos do pacote ★, Caso 17 — Foto do barbeiro: subir, trocar, remover ★, Caso 18 — Foto do produto, Caso 19 — Concluir atendimento, Caso 20 — ACL do barbeiro não-admin ★★

### Community 179 - "BLOCO 2 — Funil de PACOTE + pagamento online (maior risco financeiro)"
Cohesion: 0.25
Nodes (8): 2.1 — Compra de pacote online (feliz), 2.2 — ★ CRÍTICO: gerou PIX mas NÃO pagou, 2.3 — ★ Idempotência do pagamento, 2.4 — Pacote presencial, 2.5 — ★ Rateio (conferir o número), 2.6 — Onboarding pós-compra, 2.7 — Expiração de PIX, BLOCO 2 — Funil de PACOTE + pagamento online (maior risco financeiro)

### Community 180 - "compilerOptions"
Cohesion: 0.25
Nodes (7): compilerOptions, declaration, module, moduleResolution, outDir, extends, ./tsconfig.json

### Community 181 - "Trava de conclusão antecipada (2026-08-20) ✅"
Cohesion: 0.25
Nodes (8): A regra, Decisões deixadas em aberto, Migrations (duas, aditivas), Onde isso aparece, Smoke test manual, Testes, Trava de conclusão antecipada (2026-08-20) ✅, Três decisões que não são óbvias

### Community 182 - "PacoteOferta como agregado + preço por barbeiro + aprovação + funil reordenado (sessão-B, 2026-07-20/21) ✅"
Cohesion: 0.25
Nodes (8): Fase 1 — `PacoteOferta` vira domínio de primeira classe, Fase 2 — Preço por barbeiro (parte mais sensível), Fase 3 — Workflow de aprovação de `PacoteOferta`, Fase 4 — Funil: barbeiro primeiro + link próprio, Fase 5 — `docs/DOMAIN.md` atualizado, Migrações aplicadas, O que precisa de smoke test manual, PacoteOferta como agregado + preço por barbeiro + aprovação + funil reordenado (sessão-B, 2026-07-20/21) ✅

### Community 184 - "conclusao-antecipada.e2e.spec.ts"
Cohesion: 0.38
Nodes (4): agendar(), agendarComCredito(), DIA, proximoHorario()

### Community 185 - "BLOCO C — Workflow de aprovação"
Cohesion: 0.29
Nodes (7): BLOCO C — Workflow de aprovação, C.1 — Barbeiro cria → fica pendente, C.2 — Admin aprova, C.3 — Admin rejeita com motivo, C.4 — Editar aprovado volta pra pendente, C.5 — Gabriel aprova a própria oferta, C.6 — Barbeiro não aprova oferta alheia

### Community 186 - "BLOCO F — Re-teste: conclusão e comissão (bloco 4 do smoke anterior)"
Cohesion: 0.29
Nodes (7): BLOCO F — Re-teste: conclusão e comissão (bloco 4 do smoke anterior), F.1 — ★ Comissão sobre valor rateado (com preço por barbeiro), F.2 — Concluir pago-online não pede pagamento, F.3 — Add-on em pago-online mostra só o adicional, F.4 — Add-on em crédito mostra o valor a cobrar (bug 5 corrigido), F.5 — Comissão carrega no primeiro select (bug 4 corrigido), F.6 — Saldo real vs projeção separados

### Community 187 - "2. Decisões arquiteturais travadas"
Cohesion: 0.29
Nodes (7): 2.1 Conflito de horário: invariante no domínio + constraint no banco, 2.2 Atendimento e Pacote: agregados separados, transação única, 2.3 Comissão: evento de domínio, 2.4 Multi-tenancy: costura, não implementação, 2.5 Dinheiro e Percentual, 2.6 Fuso horário: costura na `Company`, conversão sempre na fronteira, 2. Decisões arquiteturais travadas

### Community 188 - "8.14 Pacote é da empresa — o barbeiro só existe na COMPRA (2026-08-18)"
Cohesion: 0.29
Nodes (7): 8.14 Pacote é da empresa — o barbeiro só existe na COMPRA (2026-08-18), A única regra que sobrou, ACL do barbeiro sobre pacotes (2026-08-18), Migration, O que deixou de existir, Onde isso aparece, Por que o rateio usa a referência da casa

### Community 189 - "QA go-live — 2026-08-19 — commit `5445919`"
Cohesion: 0.29
Nodes (5): Bloqueiam o go-live, Correções feitas no roteiro durante a execução, Não executado, O que ficou provado nos casos críticos, QA go-live — 2026-08-19 — commit `5445919`

### Community 190 - "Achados — nenhum bloqueante"
Cohesion: 0.29
Nodes (7): A. Dois números de WhatsApp diferentes — confirmar qual recebe o dinheiro, Achados — nenhum bloqueante, B. A barra de resumo cobre dois serviços — e o toque cai no "Continuar", C. "5 de 5 serviços disponíveis" com um já agendado, D. Nove elementos abaixo do contraste mínimo (Lighthouse: a11y 92), E. SEO 83 — faltam três coisas baratas, F. Reserva expirada aparece no histórico ao lado do agendamento confirmado

### Community 191 - "Polimento pré-go-live (2026-08-19) ✅"
Cohesion: 0.29
Nodes (7): 0. Número do WhatsApp da comanda — o caminho do dinheiro, 1. A barra de resumo cobria o fim da lista de serviços, 2. Contraste do texto secundário, 3. "5 de 5 disponíveis" contava o item já agendado, 4. Reserva expirada sumiu do histórico do cliente, 5. SEO e landmarks, Polimento pré-go-live (2026-08-19) ✅

### Community 192 - "Home do painel — primeira tela depois do login (2026-08-19) ✅"
Cohesion: 0.29
Nodes (7): ACL, Faturamento — de quais registros soma, Home do painel — primeira tela depois do login (2026-08-19) ✅, O que cada card lê — e de qual fonte, O que NÃO foi criado de novo, Smoke test manual, Ticket médio — a regra

### Community 193 - "Correção pós-smoke: preço por barbeiro ponta-a-ponta + 10 bugs (sessão-C) ✅"
Cohesion: 0.29
Nodes (7): BUG-RAIZ — preço por barbeiro não estava plugado nos caminhos reais, Correção pós-smoke: preço por barbeiro ponta-a-ponta + 10 bugs (sessão-C) ✅, Investigação E.7 — "caí logado numa conta que já estava logada", Investigação: "invariante furada" (oferta aceitando serviço que o barbeiro não atende), O que precisa de smoke test manual, Outros bugs corrigidos, Verificação

### Community 194 - "Funil único + desconto progressivo (2026-08-14) ✅"
Cohesion: 0.29
Nodes (7): ⚠️ Decisão que precisa da sua confirmação, Fase 1 — A regra do desconto, Fase 2 — Funil único, Funil único + desconto progressivo (2026-08-14) ✅, O que aconteceu com os combos antigos, Roteiro de smoke test manual, Testes (+30)

### Community 195 - "OTP obrigatório + reserva temporária + cota de presenciais (2026-08-13) ✅"
Cohesion: 0.29
Nodes (7): Matriz implementada, OTP obrigatório + reserva temporária + cota de presenciais (2026-08-13) ✅, Problema 1 — agenda falsa (qualquer telefone reservava sem provar posse), Problema 2 — buraco na agenda (PIX nunca pago prendia o horário pra sempre), Problema 3 — enxurrada de presenciais (OTP prova telefone real, não impede volume), Roteiro de smoke test manual (para o dono rodar), Testes

### Community 198 - "graphify reference: query, path, explain"
Cohesion: 0.33
Nodes (5): For /graphify explain, For /graphify path, graphify reference: query, path, explain, Step 0 — Constrained query expansion (REQUIRED before traversal), Step 1 — Traversal

### Community 199 - "BLOCO B — Preço por barbeiro"
Cohesion: 0.33
Nodes (6): B.1 — Cadastrar override de preço, B.2 — ★ Rateio usa o preço DO BARBEIRO, B.3 — ★★ Snapshot protegido (o teste mais importante do dia), B.4 — Crédito só com o barbeiro dono, B.5 — Inconsistência conhecida (DECISÃO #18 — confirmar, não é bug), BLOCO B — Preço por barbeiro

### Community 200 - "BLOCO G — Re-teste: ciclo do pacote (bloco 5 do smoke anterior)"
Cohesion: 0.33
Nodes (6): BLOCO G — Re-teste: ciclo do pacote (bloco 5 do smoke anterior), G.1 — Falta simples → segunda chance com prazo de 10 dias (bug 6 corrigido), G.2 — Reagendar na segunda chance, G.3 — Segunda falta expira + saldo residual com plural correto (bug 7 corrigido), G.4 — Cancelar antecipado com falta computada (loophole), G.5 — Texto de segunda chance sem erro de gênero (bug 7 corrigido)

### Community 201 - "BLOCO 5 — Ciclo de vida do pacote (máquina de estado sutil)"
Cohesion: 0.33
Nodes (6): 5.1 — Falta simples, 5.2 — Reagendar na segunda chance, 5.3 — Segunda falta = expira, 5.4 — ★ Cancelar antecipado com falta já computada (loophole fechado), 5.5 — Produto avulso + comissão, BLOCO 5 — Ciclo de vida do pacote (máquina de estado sutil)

### Community 202 - "Expediente semanal + PIX_ONLINE + walk-in add-on + produtos (sessão 2026-07-16) ✅"
Cohesion: 0.33
Nodes (6): 1. Expediente semanal recorrente (bug operacional corrigido), 2. Atendimento pago online não pede forma de pagamento, 3. Adicionar serviço/produto na conclusão (walk-in add-on), 4. Produtos (mínimo viável, SEM estoque), Expediente semanal + PIX_ONLINE + walk-in add-on + produtos (sessão 2026-07-16) ✅, Testes e verificação

### Community 203 - "Order-bump rico — Parte 2 (2026-08-17) ✅"
Cohesion: 0.33
Nodes (6): ★ A regra de preço do bump de serviço (o ponto mais delicado), Modelagem, Order-bump rico — Parte 2 (2026-08-17) ✅, Remoção sem refazer o funil, Roteiro de smoke test manual (foco em cálculo e remoção), Testes (+46)

### Community 204 - "Ajustes no funil público (2026-08-14) ✅"
Cohesion: 0.33
Nodes (6): Ajustes no funil público (2026-08-14) ✅, Fallout nos testes existentes (esperado, e corrigido), ⚠️ O que falta você preencher, Onde ficou cada validação, Seleção de data/horário, Telas de resumo, sucesso e inicial

### Community 205 - "Barbeiro e aprovação — Fases 2 e 3 (2026-08-14) ✅ / Fases 1 e 4 bloqueadas ⛔"
Cohesion: 0.33
Nodes (6): Barbeiro e aprovação — Fases 2 e 3 (2026-08-14) ✅ / Fases 1 e 4 bloqueadas ⛔, ⛔ FASE 1 (fotos) — PAREI, como você pediu, ✅ FASE 2 — "Não tenho preferência" (commit `bcc33bb`), ✅ FASE 3 — Cliente "da casa", ⛔ FASE 4 — o enunciado chegou truncado, Testes (+28)

### Community 206 - "Grafo de conhecimento (graphify) — 2026-08-19 ✅"
Cohesion: 0.33
Nodes (6): Decisões deste setup, Estado do grafo, Grafo de conhecimento (graphify) — 2026-08-19 ✅, O que falta decidir, O que foi instalado, Uso

### Community 208 - "bateria-testes-2.md"
Cohesion: 0.40
Nodes (4): Anotações livres, Regras de ouro, Resumo, Smoke Test — Sessão B (preço por barbeiro + pacote + link)

### Community 209 - "3.2 `Barbeiro` (raiz)"
Cohesion: 0.40
Nodes (5): 3.2.1 Slug — link pessoal de marketing (sessão-B, Fase 4b), 3.2.2 Preço por barbeiro — `precoPara` (sessão-B, Fase 2), 3.2.3 Desconto progressivo do avulso (substituiu os combos fixos), 3.2.4 "Cliente da casa" — relação, não atributo, 3.2 `Barbeiro` (raiz)

### Community 210 - "4. Máquinas de estado"
Cohesion: 0.40
Nodes (5): 4.1 `Atendimento`, 4.2 `ItemDoPacote`, 4.3 `PacoteOferta` — workflow de aprovação (sessão-B, Fase 3), 4.4 `Vale` (sessão de vale/pagamento), 4. Máquinas de estado

### Community 211 - "5. Minha conta — cockpit do cliente (porta 5175)"
Cohesion: 0.40
Nodes (5): 5. Minha conta — cockpit do cliente (porta 5175), Caso 21 — Login e créditos, Caso 22 — Agendar com crédito ★, Caso 23 — Cancelar e reagendar, Caso 24 — Reembolso de saldo residual

### Community 212 - "Reorganização do admin — Parte 1 (2026-08-17) ✅"
Cohesion: 0.40
Nodes (5): 1a. CRUD de catálogo padronizado (serviços, produtos e ofertas), 1b. Reembolsos: de "Pacotes & Ofertas" para o Financeiro, 1c. Nova seção "Funil de Vendas", Reorganização do admin — Parte 1 (2026-08-17) ✅, Testes (+8)

### Community 213 - "Correção do teste de expediente (sessão 2026-07-20, continuação) ✅"
Cohesion: 0.40
Nodes (5): Correção, Correção do teste de expediente (sessão 2026-07-20, continuação) ✅, Diagnóstico, Janela deslizante de materialização (confirmado, sem alteração), Verificação

### Community 214 - "Migração open-wa → Baileys (2026-08-10) ✅"
Cohesion: 0.40
Nodes (5): Decisão (com o dono): trocar pra Baileys, Migração open-wa → Baileys (2026-08-10) ✅, Problema 1: `@open-wa/wa-automate` nunca gerava o QR (nem em Docker, nem fora), Problema 2: "Not a contact" — trava comercial que inviabiliza o caso de uso, Verificado de ponta a ponta, com WhatsApp real (não mockado)

### Community 215 - "Tela de comissão do barbeiro (2026-08-20) ✅"
Cohesion: 0.40
Nodes (5): O que a tela faz, O que existia e o que faltava, Smoke test manual, Tela de comissão do barbeiro (2026-08-20) ✅, Verificado na tela, com o dado real

### Community 216 - "Re-smoke: 2 bugs bloqueantes + reorganização de navegação do admin (sessão-D) ✅"
Cohesion: 0.40
Nodes (5): O que precisa de smoke test manual, PARTE 1 — Bugs, PARTE 2 — Reorganização da navegação do admin (nenhuma lógica/endpoint mudou), Re-smoke: 2 bugs bloqueantes + reorganização de navegação do admin (sessão-D) ✅, Verificação

### Community 217 - "api/package.json"
Cohesion: 0.50
Nodes (3): name, private, version

### Community 218 - "graphify reference: add a URL and watch a folder"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 219 - "graphify reference: commit hook and native CLAUDE.md integration"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 220 - "graphify reference: incremental update and cluster-only"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 221 - "3.15 Home do painel — projeção de leitura (2026-08-19)"
Cohesion: 0.50
Nodes (4): 3.15 Home do painel — projeção de leitura (2026-08-19), Faturamento — de quais registros soma, Pendências, Ticket médio — a única métrica calculada

### Community 222 - "BLOCO 0 — Setup e sanidade"
Cohesion: 0.50
Nodes (4): 0.1 — Subir tudo do zero, 0.2 — Login dos 3 perfis de staff, 0.3 — Domingo fechado, BLOCO 0 — Setup e sanidade

### Community 223 - "TipoLancamento"
Cohesion: 0.50
Nodes (4): HomeLancamentoDTO, LancamentoComissaoDTO, OrigemComissao, TipoLancamento

### Community 224 - "Deploy abstraído: um comando pra local/staging/produção (2026-08-10) ✅"
Cohesion: 0.50
Nodes (4): Deploy abstraído: um comando pra local/staging/produção (2026-08-10) ✅, O que precisa de smoke test manual, Testado de verdade nesta máquina (não só escrito), Verificação

### Community 225 - "Gate de envio de OTP removido + rate limit por origem (2026-08-14) ✅"
Cohesion: 0.50
Nodes (4): Gate de envio de OTP removido + rate limit por origem (2026-08-14) ✅, Onde estava o gate, ★ Rate limit — o que existia e o que faltava, Testes (+11)

### Community 228 - "desconto-progressivo.ts"
Cohesion: 0.67
Nodes (3): CarrinhoPrecificado, ItemDoCarrinho, ItemPrecificado

### Community 238 - "MarcarDaCasaDto"
Cohesion: 0.50
Nodes (4): MarcarDaCasaDto, IsOptional, IsString, MinLength

### Community 240 - "JanelaExpedienteDto"
Cohesion: 0.67
Nodes (3): JanelaExpedienteDto, Matches, MaxLength

## Knowledge Gaps
- **1092 isolated node(s):** `name`, `version`, `private`, `type`, `build` (+1087 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `UsuarioAutenticado` connect `UsuarioAutenticado` to `BarbeiroId`, `agendar-avulso.usecase.ts`, `PrismaService`, `UnitOfWork`, `Atendimento`, `booking-publico.controller.ts`, `payroll.module.ts`, `barbeiros.controller.ts`, `produtos.controller.ts`, `.criar`, `atendimento.spec.ts`, `PacotesQueryService`, `CompanyId`, `vendas-produto.controller.ts`, `PacoteOfertasController`, `.atualizar`, `vales.controller.ts`, `ClientesController`, `materializar-expediente.usecase.ts`, `LocalAuthProvider`, `.definir`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `Cliente` connect `Cliente` to `account/src/App.tsx`, `dinheiro.ts`, `agendar-avulso.usecase.ts`, `UnitOfWork`, `.deCentavos`, `CompanyId`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _1092 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `account/src/App.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06056701030927835 - nodes in this community are weakly interconnected._
- **Should `dinheiro.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13781512605042018 - nodes in this community are weakly interconnected._
- **Should `BarbeiroId` be split into smaller, more focused modules?**
  _Cohesion score 0.060759493670886074 - nodes in this community are weakly interconnected._
- **Should `agendar-avulso.usecase.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05253077975376197 - nodes in this community are weakly interconnected._
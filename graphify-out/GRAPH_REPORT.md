# Graph Report - bigods-barber-v2  (2026-08-19)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 3091 nodes · 7840 edges · 173 communities (163 shown, 10 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 121 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ae38cbea`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- account/src/App.tsx
- dinheiro.ts
- AtendimentoId
- conta-cliente.controller.ts
- PrismaService
- dto.ts
- s3-armazenamento.ts
- Barbeiro
- shared.module.ts
- VendaDePacote
- Telefone
- UnitOfWork
- Cliente
- devDependencies
- payments.module.ts
- PacoteOferta
- Atendimento
- booking/src/App.tsx
- identity-provider.ts
- UsuarioAutenticado
- booking/src/components/ui.tsx
- agendar-avulso.usecase.ts
- DisponibilidadeBarbeiro
- Servico
- UsuarioAtual
- barbeiros.controller.ts
- ProcessarWebhookUseCase
- IntencaoDePagamento
- staff.module.ts
- calendario.ts
- api
- app.module.ts
- identity.module.ts
- produtos.controller.ts
- dependencies
- CompanyId
- Vale
- CriarBarbeiroDto
- cognito-triggers.spec.ts
- dinheiro
- payroll.module.ts
- admin/src/App.tsx
- Sucesso.tsx
- account/package.json
- Agenda.tsx
- Catalogo.tsx
- .deCentavos
- materializar-expediente.usecase.ts
- compilerOptions
- ClienteAutenticado
- .vender
- Timezone
- pacotes-publico.controller.ts
- scripts
- packages.module.ts
- pacote-ofertas.controller.ts
- HorariosDisponiveisQueryService
- Pacotes.tsx
- whatsapp-identity.provider.ts
- vendas-produto.controller.ts
- VendaDeProduto
- Confirmacao.tsx
- AgendarAvulsoContaDto
- AgendarAvulsoDto
- whatsapp-otp/package.json
- desconto.ts
- devDependencies
- NestEventPublisher
- enums.ts
- .atualizar
- Publico
- ValesController
- AgendarPublicoDto
- compilerOptions
- compilerOptions
- ClientesController
- BarbeiroId
- fechamento-query.service.ts
- compilerOptions
- compilerOptions
- admin/package.json
- scripts
- compilerOptions
- tasks
- PacotesController
- RegistrarPagamentoDto
- venda-de-pacote.spec.ts
- AtualizarPacoteOfertaDto
- VenderPacoteDto
- DefinirDescontoDto
- VenderProdutoAvulsoDto
- typescript
- .configurar
- AuthController
- ValeRepository
- Produto
- static-server/package.json
- contracts/package.json
- lib
- booking/package.json
- booking/src/lib/format.ts
- devDependencies
- cliente.guard.ts
- atendimento.events.ts
- .gerar
- integration.spec.ts
- AtualizarServicoDto
- ConfigurarDto
- LocalAuthProvider
- .criar
- DiaDeExpedienteDto
- otp-sem-conta.e2e.spec.ts
- config/package.json
- FormaPagamento
- gerar-icones.mjs
- nest-cli.json
- config-seguranca.ts
- ComissaoQueryService
- SolicitarValeDto
- .definir
- conta-cockpit.e2e.spec.ts
- PagamentoManualAguardando.tsx
- ExpirarItensJob
- AgendamentosClienteQueryService
- sem-preferencia.e2e.spec.ts
- server.js
- Papel
- deploy.sh
- index.js
- SolicitarReembolsoUseCase
- .constructor
- S3Espiao
- booking/src/lib/telefone.ts
- env-up.sh
- vite/client
- MarcarDaCasaDto
- deploy-frontends.sh
- env-down.sh
- fetch-secrets-ssm.sh
- account/tsconfig.json
- Dinheiro
- JanelaExpedienteDto
- booking/tsconfig.json
- BarbeiroRepository
- ParametrosController
- IntervaloDeTempo
- validacao.ts
- seed.ts
- AtualizarProdutoDto
- regra-atribuicao-de-barbeiro.ts
- ConcluirAtendimentoUseCase
- webhook-abacatepay.e2e.spec.ts
- ExpirarPagamentoVencidoUseCase
- domain-error.filter.ts
- OnAtendimentoConcluidoHandler
- OnVendaDeProdutoRegistradaHandler
- StatusPagamento

## God Nodes (most connected - your core abstractions)
1. `CompanyId` - 131 edges
2. `Dinheiro` - 120 edges
3. `UsuarioAutenticado` - 106 edges
4. `UsuarioAtual` - 85 edges
5. `PrismaService` - 81 edges
6. `BarbeiroId` - 74 edges
7. `Barbeiro` - 62 edges
8. `api()` - 54 edges
9. `InvarianteVioladaError` - 51 edges
10. `VendaDePacote` - 50 edges

## Surprising Connections (you probably didn't know these)
- `diaLocalMaisDias()` --calls--> `diaCivilChave()`  [EXTRACTED]
  prisma/seed.ts → apps/api/src/shared/domain/calendario.ts
- `seedarExpediente()` --calls--> `instanteDeDataHoraLocal()`  [EXTRACTED]
  prisma/seed.ts → apps/api/src/shared/domain/calendario.ts
- `CancelarAtendimentoInput` --references--> `UsuarioAutenticado`  [EXTRACTED]
  apps/api/src/modules/scheduling/application/cancelar-atendimento.usecase.ts → apps/api/src/modules/identity/domain/auth-provider.ts
- `ConcluirAtendimentoInput` --references--> `UsuarioAutenticado`  [EXTRACTED]
  apps/api/src/modules/scheduling/application/concluir-atendimento.usecase.ts → apps/api/src/modules/identity/domain/auth-provider.ts
- `ItemProdutoAtendidoSnapshot` --references--> `ProdutoId`  [EXTRACTED]
  apps/api/src/modules/scheduling/domain/atendimento.events.ts → apps/api/src/shared/domain/ids.ts

## Import Cycles
- None detected.

## Communities (173 total, 10 thin omitted)

### Community 0 - "account/src/App.tsx"
Cohesion: 0.06
Nodes (64): App(), CockpitOuBook(), Conta(), confirmarLogin(), Tela, QuandoBloco(), AvatarBarbeiro(), ErroEstado() (+56 more)

### Community 1 - "dinheiro.ts"
Cohesion: 0.11
Nodes (22): base, BASE, IntencaoDePagamentoProps, ReferenciaDePagamento, RegistrarPagamentoInput, barbeiro, ocorridoEm, ocorridoEm (+14 more)

### Community 2 - "AtendimentoId"
Cohesion: 0.08
Nodes (16): OnEvent, OnEvent, RegistrarPagamentoUseCase, Inject, Injectable, LancamentoComissao, LancamentoComissaoRepository, criar() (+8 more)

### Community 3 - "conta-cliente.controller.ts"
Cohesion: 0.09
Nodes (35): THROTTLE_LOGIN, Inject, PARAMETROS_DA_EMPRESA_REPOSITORY, VENDA_DE_PACOTE_REPOSITORY, VendaDePacoteRepository, AdicionarItemAtendimentoUseCase, Inject, Injectable (+27 more)

### Community 4 - "PrismaService"
Cohesion: 0.05
Nodes (30): AppModule, Module, hashSenha(), PrismaService, Injectable, DIA, sufixo, DIA (+22 more)

### Community 5 - "dto.ts"
Cohesion: 0.03
Nodes (75): AdicionarItemAtendimentoRequest, AdicionarProdutoAtendimentoRequest, AgendarAvulsoRequest, AgendarComCreditoContaRequest, AgendarComCreditoContaResponse, AgendarComCreditoRequest, AgendarPublicoRequest, AgendarPublicoResponse (+67 more)

### Community 6 - "s3-armazenamento.ts"
Cohesion: 0.06
Nodes (41): Inject, Inject, DonoDeFoto, GerenciarFotoUseCase, Inject, Injectable, ARMAZENAMENTO_DE_IMAGENS, ArmazenamentoDeImagens (+33 more)

### Community 7 - "Barbeiro"
Cohesion: 0.06
Nodes (6): Barbeiro, BarbeiroProps, paraDominio(), PrismaBarbeiroRepository, ServicoId, Percentual

### Community 8 - "shared.module.ts"
Cohesion: 0.08
Nodes (17): SolicitacaoDeReembolso, SolicitacaoDeReembolsoId, SOLICITACAO_DE_REEMBOLSO_REPOSITORY, SolicitacaoDeReembolsoRepository, paraDominio(), PrismaSolicitacaoDeReembolsoRepository, include, Row (+9 more)

### Community 9 - "VendaDePacote"
Cohesion: 0.06
Nodes (5): VendaDePacote, paraDominio(), PrismaVendaDePacoteRepository, ItemAtendidoSnapshot, ItemDoPacoteId

### Community 10 - "Telefone"
Cohesion: 0.06
Nodes (23): ClienteProps, criar(), ConfirmarLoginClienteInput, ConfirmarLoginClienteOutput, Telefone, DIA, e164(), sufixo (+15 more)

### Community 11 - "UnitOfWork"
Cohesion: 0.17
Nodes (17): VenderPacoteInput, VenderPacoteOutput, ItemDoPacoteConsumido, ItemDoPacoteExpirado, PacoteVendido, CancelarAtendimentoClienteInput, Inject, CancelarAtendimentoInput (+9 more)

### Community 12 - "Cliente"
Cohesion: 0.09
Nodes (6): Cliente, ClienteRepository, paraDominio(), PrismaClienteRepository, Inject, Inject

### Community 13 - "devDependencies"
Cohesion: 0.06
Nodes (42): devDependencies, autoprefixer, postcss, tailwindcss, @types/react, @types/react-dom, vite, @vitejs/plugin-react (+34 more)

### Community 14 - "payments.module.ts"
Cohesion: 0.10
Nodes (19): Inject, CobrancaOnlineService, ResultadoDaCobranca, Inject, Injectable, CobrancaPix, PAYMENT_GATEWAY, PaymentGateway (+11 more)

### Community 15 - "PacoteOferta"
Cohesion: 0.09
Nodes (11): PacoteOferta, criar(), somaDeReferenciaDaCasa(), PacoteOfertasController, paraDTO(), Body, Controller, Get (+3 more)

### Community 16 - "Atendimento"
Cohesion: 0.07
Nodes (3): Atendimento, paraDominio(), PrismaAtendimentoRepository

### Community 17 - "booking/src/App.tsx"
Cohesion: 0.14
Nodes (31): App(), Funil(), limparParametroDeLinkNaUrl(), ROTULOS_PASSO, slugDoLinkNaUrl(), alternarProdutoNoBump(), alternarServicoNoBump(), aplicarBarbeiroDoLink() (+23 more)

### Community 18 - "identity-provider.ts"
Cohesion: 0.11
Nodes (12): ConfirmarLoginInput, DesafioLogin, IniciarLoginInput, ProvisionarUsuarioInput, ResultadoConfirmacao, CognitoConfig, CognitoIdentityProvider, base (+4 more)

### Community 19 - "UsuarioAutenticado"
Cohesion: 0.19
Nodes (11): UsuarioAutenticado, AdicionarItemAtendimentoInput, AdicionarProdutoAtendimentoInput, autorizarDonoOuAdmin(), AtendimentosController, Body, Controller, Get (+3 more)

### Community 20 - "booking/src/components/ui.tsx"
Cohesion: 0.12
Nodes (21): BigodsClub(), Onboarding(), OtpVerificacao(), AlertaErro(), Avatar(), ErroEstado(), Loading(), SlotSkeleton() (+13 more)

### Community 21 - "agendar-avulso.usecase.ts"
Cohesion: 0.07
Nodes (23): SERVICO_REPOSITORY, ServicoRepository, ItemDeOrderBump, MAX_MENSAGEM_BUMP, TipoItemDeOrderBump, ITEM_DE_ORDER_BUMP_REPOSITORY, ItemDeOrderBumpRepository, paraDominio() (+15 more)

### Community 22 - "DisponibilidadeBarbeiro"
Cohesion: 0.12
Nodes (6): DisponibilidadeBarbeiro, DisponibilidadeRepository, paraDominio(), PrismaDisponibilidadeRepository, Inject, DisponibilidadeId

### Community 23 - "Servico"
Cohesion: 0.08
Nodes (6): Servico, ServicoProps, paraDominio(), PrismaServicoRepository, ItemAtendido, Duracao

### Community 24 - "UsuarioAtual"
Cohesion: 0.08
Nodes (25): AUTH_PROVIDER, AuthProvider, LoginDto, TrocarSenhaDto, IsString, MinLength, PAPEIS_KEY, PUBLICO_KEY (+17 more)

### Community 25 - "barbeiros.controller.ts"
Cohesion: 0.15
Nodes (19): Papeis(), assertNaoRemoveUltimoAdminAtivo(), slugDoNome(), slugUnico(), AlterarStatusDto, BarbeirosController, ehColisaoDeLogin(), paraDTO() (+11 more)

### Community 26 - "ProcessarWebhookUseCase"
Cohesion: 0.09
Nodes (18): Inject, ProcessarWebhookUseCase, Inject, Injectable, comparaSegura(), EntradaVerificacaoWebhook, assinaturaValida, corpo (+10 more)

### Community 27 - "IntencaoDePagamento"
Cohesion: 0.09
Nodes (6): IntencaoDePagamento, PagamentoConfirmado, IntencaoDePagamentoRepository, paraDominio(), PrismaIntencaoDePagamentoRepository, IntencaoDePagamentoId

### Community 28 - "staff.module.ts"
Cohesion: 0.16
Nodes (8): MaterializarExpedienteUseCase, Inject, Injectable, MaterializarExpedienteJob, Cron, Injectable, StaffModule, Module

### Community 29 - "calendario.ts"
Cohesion: 0.13
Nodes (24): AtendimentoComItens, DataHoraLocal, diaCivilChave(), diaCivilMaisDias(), diaDaSemanaCivil(), diferencaDiasCivis(), fimDoDiaCivilMaisDias(), horaLocalHHmm() (+16 more)

### Community 30 - "api"
Cohesion: 0.13
Nodes (25): Foto(), FotoUpload(), iniciais(), useApi(), api(), BOOKING_URL, VendaDeProdutoDialog(), DescontoProgressivo() (+17 more)

### Community 31 - "app.module.ts"
Cohesion: 0.07
Nodes (21): THROTTLER_OTP_ORIGEM, CatalogModule, Module, CustomersModule, Module, FunnelModule, Module, ENVIA_OTP (+13 more)

### Community 32 - "identity.module.ts"
Cohesion: 0.06
Nodes (29): ConfirmarLoginClienteUseCase, Inject, Injectable, IniciarLoginClienteInput, IniciarLoginClienteOutput, IniciarLoginClienteUseCase, Inject, Injectable (+21 more)

### Community 33 - "produtos.controller.ts"
Cohesion: 0.17
Nodes (13): paraDTO(), ProdutosController, Body, Controller, Delete, Get, Param, Patch (+5 more)

### Community 34 - "dependencies"
Cohesion: 0.07
Nodes (29): dependencies, @aws-sdk/client-cognito-identity-provider, @aws-sdk/client-s3, class-transformer, class-validator, dotenv, @nestjs/common, @nestjs/core (+21 more)

### Community 35 - "CompanyId"
Cohesion: 0.14
Nodes (5): ItemDeOrderBumpProps, ParametrosDaEmpresaRepository, PrismaParametrosRepository, Injectable, CompanyId

### Community 36 - "Vale"
Cohesion: 0.10
Nodes (3): Vale, paraDominio(), PrismaValeRepository

### Community 37 - "CriarBarbeiroDto"
Cohesion: 0.19
Nodes (20): AtualizarComissaoDto, AtualizarCredenciaisDto, AtualizarPrecosDto, AtualizarServicosDto, AtualizarSlugDto, AtualizarUsuarioDto, CriarBarbeiroDto, ExcecaoDto (+12 more)

### Community 38 - "cognito-triggers.spec.ts"
Cohesion: 0.10
Nodes (16): create, define, verify, CONFIG, { enviarSms, paraE164, SmsGateError, ENDPOINT_PADRAO }, crypto, { enviarSms }, handler() (+8 more)

### Community 39 - "dinheiro"
Cohesion: 0.21
Nodes (21): BotaoAtualizar(), ErroEstado(), Loading(), Vazio(), dataCurta(), dinheiro(), TimezoneContext, useTimezone() (+13 more)

### Community 40 - "payroll.module.ts"
Cohesion: 0.14
Nodes (17): AprovarValeInput, AprovarValeUseCase, Injectable, MarcarValePagoInput, MarcarValePagoUseCase, Inject, Injectable, NegarValeInput (+9 more)

### Community 41 - "admin/src/App.tsx"
Cohesion: 0.15
Nodes (17): Aba, ABAS_ADMIN, ABAS_BARBEIRO_NAO_ADMIN, App(), icones, rotulos, BotaoSair(), apiUpload() (+9 more)

### Community 42 - "Sucesso.tsx"
Cohesion: 0.15
Nodes (18): IconeDeMarca(), baixarIcs(), conteudoIcs(), escaparIcs(), EventoDeAgenda, fim(), linkGoogleAgenda(), paraFormatoUtc() (+10 more)

### Community 43 - "account/package.json"
Cohesion: 0.14
Nodes (13): dependencies, @bigods/contracts, react, react, name, private, scripts, build (+5 more)

### Community 44 - "Agenda.tsx"
Cohesion: 0.19
Nodes (16): AtendimentoDetalheDialog(), labelStatus, toneStatus, valorACobrarNaConclusao(), valorNaoCobertoPorCredito(), diferencaDias(), ehHoje(), hojeISO() (+8 more)

### Community 45 - "Catalogo.tsx"
Cohesion: 0.13
Nodes (19): AcaoDeItem, BadgeDeItem, CabecalhoDeCatalogo(), EstadoDaLista(), ItemDeCatalogo(), Badge(), Dialog(), Tabs() (+11 more)

### Community 46 - ".deCentavos"
Cohesion: 0.10
Nodes (11): precificarCarrinho(), contexto(), criar(), comissao(), solicitar(), criar(), assertNaoExcedeCotaPresencial(), LIMITE_PRESENCIAIS_FUTUROS_ATIVOS (+3 more)

### Community 47 - "materializar-expediente.usecase.ts"
Cohesion: 0.11
Nodes (15): DefinirExpedienteInput, DefinirExpedienteUseCase, Inject, Injectable, MaterializarExpedienteInput, DiaSemana, ExpedienteSemanal, JanelaExpediente (+7 more)

### Community 48 - "compilerOptions"
Cohesion: 0.09
Nodes (21): compilerOptions, baseUrl, declaration, emitDecoratorMetadata, experimentalDecorators, outDir, types, extends (+13 more)

### Community 49 - "ClienteAutenticado"
Cohesion: 0.22
Nodes (10): ClienteAutenticado, ClienteAtual, ContaCliente(), ContaClienteController, Body, Controller, Get, Param (+2 more)

### Community 50 - ".vender"
Cohesion: 0.12
Nodes (13): PacoteOfertasQueryService, paraDTO(), Injectable, PacotesPublicoController, Body, Controller, Get, Param (+5 more)

### Community 51 - "Timezone"
Cohesion: 0.22
Nodes (3): AgendaQueryService, Injectable, Timezone

### Community 52 - "pacotes-publico.controller.ts"
Cohesion: 0.23
Nodes (10): ClientePublicoDto, IsOptional, IsString, MaxLength, MinLength, Type, ValidateNested, VenderPacotePublicoDto (+2 more)

### Community 53 - "scripts"
Cohesion: 0.10
Nodes (20): @prisma/client, dependencies, @prisma/client, @prisma/client, name, packageManager, private, scripts (+12 more)

### Community 54 - "packages.module.ts"
Cohesion: 0.12
Nodes (14): ConfirmarPagamentoPresencialUseCase, Inject, Injectable, ConfirmarReembolsoInput, ConfirmarReembolsoUseCase, Inject, Injectable, Injectable (+6 more)

### Community 55 - "pacote-ofertas.controller.ts"
Cohesion: 0.15
Nodes (10): PACOTE_OFERTA_REPOSITORY, PacoteOfertaRepository, Inject, LinhaComItens, paraDominio(), PrismaPacoteOfertaRepository, AtualizarStatusPacoteOfertaDto, Inject (+2 more)

### Community 56 - "HorariosDisponiveisQueryService"
Cohesion: 0.22
Nodes (5): assertDentroDaJanelaDeAgendamento(), somarDias(), HorariosDisponiveisQueryService, Inject, Injectable

### Community 57 - "Pacotes.tsx"
Cohesion: 0.14
Nodes (16): CurrencyInput(), ApiError, centavosParaTextoMoeda(), textoParaCentavosMoeda(), idEfetivo(), Aba, AgendarCreditoDialog(), CatalogoDeOfertas() (+8 more)

### Community 58 - "whatsapp-identity.provider.ts"
Cohesion: 0.17
Nodes (7): WhatsAppIdentityProvider, HttpWhatsAppOtpClient, TelefoneSemWhatsAppError, WhatsAppEnvioIndisponivelError, WhatsAppOtpClient, FakeWhatsAppOtpClient, sufixo

### Community 59 - "vendas-produto.controller.ts"
Cohesion: 0.15
Nodes (10): Injectable, VenderProdutoAvulsoUseCase, registrar(), Injectable, VendasProdutoQueryService, Body, Controller, Get (+2 more)

### Community 60 - "VendaDeProduto"
Cohesion: 0.12
Nodes (9): VendaDeProduto, VendaDeProdutoProps, VendaDeProdutoRegistrada, VendaDeProdutoRepository, include, paraDominio(), PrismaVendaDeProdutoRepository, Row (+1 more)

### Community 61 - "Confirmacao.tsx"
Cohesion: 0.16
Nodes (14): SummaryBar(), CartaoDeBump(), OrderBump(), PixAguardando(), ResumoDoDesconto(), useEmpresa(), dinheiro(), CarrinhoFunil (+6 more)

### Community 62 - "AgendarAvulsoContaDto"
Cohesion: 0.23
Nodes (13): AgendarAvulsoContaDto, AgendarComCreditoContaDto, ConfirmarLoginDto, IniciarLoginDto, ReagendarContaDto, ArrayNotEmpty, IsArray, IsOptional (+5 more)

### Community 63 - "AgendarAvulsoDto"
Cohesion: 0.13
Nodes (19): AdicionarItemDto, AdicionarProdutoDto, AgendarAvulsoDto, AgendarComCreditoDto, CancelarDto, ClienteInlineDto, ConcluirDto, ArrayNotEmpty (+11 more)

### Community 64 - "whatsapp-otp/package.json"
Cohesion: 0.11
Nodes (17): baileys, pino, qrcode-terminal, dependencies, baileys, express, pino, qrcode-terminal (+9 more)

### Community 65 - "desconto.ts"
Cohesion: 0.16
Nodes (14): calcularDescontoProgressivo(), CarrinhoDoFunilCalculado, DegrauDeDescontoDTO, DescontoCalculado, descontoNominalCentavos(), indiceDoMaiorPeso(), ItemDoCarrinhoParaPreco, ItemDoCarrinhoPrecificado (+6 more)

### Community 66 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, @nestjs/cli, @nestjs/testing, supertest, @swc/core, tsx, @types/supertest, unplugin-swc (+9 more)

### Community 68 - "enums.ts"
Cohesion: 0.15
Nodes (13): DisponibilidadeDTO, ItemDoPacoteDTO, LancamentoComissaoDTO, PacoteOfertaDTO, SolicitacaoDeReembolsoDTO, ValeDTO, OrigemComissao, OrigemDisponibilidade (+5 more)

### Community 69 - ".atualizar"
Cohesion: 0.17
Nodes (9): paraDTO(), ServicosController, Body, Controller, Get, Inject, Param, Patch (+1 more)

### Community 70 - "Publico"
Cohesion: 0.30
Nodes (5): Publico(), BookingPublicoController, Controller, Get, Query

### Community 71 - "ValesController"
Cohesion: 0.24
Nodes (7): Body, Controller, Get, Param, Patch, Post, ValesController

### Community 72 - "AgendarPublicoDto"
Cohesion: 0.15
Nodes (16): AgendarPublicoDto, CancelarReservaDto, ClientePublicoDto, ProdutoBumpDto, ArrayNotEmpty, IsArray, IsInt, IsOptional (+8 more)

### Community 73 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, noImplicitOverride (+7 more)

### Community 74 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, module, moduleResolution, noEmit (+6 more)

### Community 75 - "ClientesController"
Cohesion: 0.22
Nodes (8): ClientesController, Body, Controller, Delete, Get, Param, Post, Query

### Community 76 - "BarbeiroId"
Cohesion: 0.12
Nodes (14): ClienteDaCasaRepository, PrismaClienteDaCasaRepository, Injectable, SolicitarReembolsoInput, SolicitarReembolsoOutput, PRAZO_REEMBOLSO_DIAS, SolicitacaoDeReembolsoProps, ItemDoPacote (+6 more)

### Community 77 - "fechamento-query.service.ts"
Cohesion: 0.19
Nodes (9): calcularSaldoCentavos(), sinalDoTipo(), SaldoComissao, acumularEm(), FechamentoQueryService, Totais, totaisVazios(), Injectable (+1 more)

### Community 78 - "compilerOptions"
Cohesion: 0.13
Nodes (13): exclude, extends, include, src, test, ./tsconfig.json, compilerOptions, declaration (+5 more)

### Community 79 - "compilerOptions"
Cohesion: 0.14
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, module, moduleResolution, noEmit (+6 more)

### Community 80 - "admin/package.json"
Cohesion: 0.09
Nodes (23): react-dom, dependencies, @bigods/contracts, react, react-dom, react, react-dom, name (+15 more)

### Community 81 - "scripts"
Cohesion: 0.14
Nodes (13): name, private, scripts, build, db:generate, db:migrate, db:seed, dev (+5 more)

### Community 82 - "compilerOptions"
Cohesion: 0.14
Nodes (14): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, module, moduleResolution, noEmit (+6 more)

### Community 83 - "tasks"
Cohesion: 0.15
Nodes (13): ^build, dist/**, dependsOn, outputs, cache, persistent, $schema, tasks (+5 more)

### Community 84 - "PacotesController"
Cohesion: 0.21
Nodes (7): PacotesController, Body, Controller, Get, Param, Post, Query

### Community 85 - "RegistrarPagamentoDto"
Cohesion: 0.33
Nodes (6): RegistrarPagamentoDto, IsNumber, IsOptional, IsString, Min, IsISO8601

### Community 86 - "venda-de-pacote.spec.ts"
Cohesion: 0.20
Nodes (6): hoje, item(), prazo10, tz, vender(), venderPago()

### Community 87 - "AtualizarPacoteOfertaDto"
Cohesion: 0.33
Nodes (12): AtualizarPacoteOfertaDto, CriarPacoteOfertaDto, ItemComposicaoDto, RejeitarPacoteOfertaDto, ArrayNotEmpty, IsArray, IsInt, IsPositive (+4 more)

### Community 88 - "VenderPacoteDto"
Cohesion: 0.18
Nodes (12): ClienteInlineDto, ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsOptional, IsPositive, IsString (+4 more)

### Community 89 - "DefinirDescontoDto"
Cohesion: 0.18
Nodes (12): AtualizarParametrosDto, DefinirDescontoDto, DegrauDto, IsArray, IsInt, IsOptional, IsPositive, Max (+4 more)

### Community 90 - "VenderProdutoAvulsoDto"
Cohesion: 0.18
Nodes (12): ItemVendaDto, ArrayNotEmpty, IsArray, IsEnum, IsInt, IsOptional, IsPositive, IsString (+4 more)

### Community 91 - "typescript"
Cohesion: 0.18
Nodes (11): typescript, @bigods/config, typescript, @bigods/config, typescript, typescript, devDependencies, @bigods/config (+3 more)

### Community 92 - ".configurar"
Cohesion: 0.25
Nodes (6): OrderBumpConfigController, Body, Controller, Get, Param, Put

### Community 93 - "AuthController"
Cohesion: 0.20
Nodes (7): AuthController, Body, Controller, Get, Inject, Post, Put

### Community 94 - "ValeRepository"
Cohesion: 0.18
Nodes (4): Inject, Inject, Inject, ValeRepository

### Community 95 - "Produto"
Cohesion: 0.10
Nodes (6): Produto, ItemVendaDeProduto, ItemVendaDeProdutoSnapshot, paraDominio(), PrismaProdutoRepository, ProdutoId

### Community 96 - "static-server/package.json"
Cohesion: 0.18
Nodes (10): dependencies, express, http-proxy-middleware, description, express, main, name, private (+2 more)

### Community 97 - "contracts/package.json"
Cohesion: 0.18
Nodes (10): exports, main, module, name, private, scripts, build, test (+2 more)

### Community 98 - "lib"
Cohesion: 0.20
Nodes (10): lib, DOM, ES2022, lib, DOM, DOM.Iterable, ES2022, lib (+2 more)

### Community 99 - "booking/package.json"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, preview, test, type (+1 more)

### Community 100 - "booking/src/lib/format.ts"
Cohesion: 0.47
Nodes (7): diasDaSemana(), hojeISO(), proximosDias(), rotuloDia(), rotuloSemana(), somarDias(), DataHora()

### Community 101 - "devDependencies"
Cohesion: 0.22
Nodes (9): prisma, @types/node, devDependencies, prisma, turbo, @types/node, prisma, turbo (+1 more)

### Community 102 - "cliente.guard.ts"
Cohesion: 0.27
Nodes (5): ClienteAtualOpcional, ContaClienteOpcional(), Body, Post, Throttle

### Community 103 - "atendimento.events.ts"
Cohesion: 0.21
Nodes (8): PacoteAtendimentoHandlers, Inject, Injectable, OnEvent, AtendimentoAgendado, AtendimentoCancelado, ClienteFaltou, ItemProdutoAtendidoSnapshot

### Community 104 - ".gerar"
Cohesion: 0.36
Nodes (6): DadosDaComanda, dinheiro(), LinhaDaComanda, linkDaComanda(), montarComanda(), AVULSO

### Community 105 - "integration.spec.ts"
Cohesion: 0.22
Nodes (5): PrismaUnitOfWork, Injectable, prisma, publisherSilencioso, uow

### Community 106 - "AtualizarServicoDto"
Cohesion: 0.36
Nodes (8): AtualizarServicoDto, CriarServicoDto, IsBoolean, IsInt, IsOptional, IsPositive, IsString, MinLength

### Community 107 - "ConfigurarDto"
Cohesion: 0.25
Nodes (8): ConfigurarDto, IsBoolean, IsInt, IsOptional, IsPositive, IsString, MaxLength, Min

### Community 108 - "LocalAuthProvider"
Cohesion: 0.32
Nodes (3): LocalAuthProvider, Injectable, verificaSenha()

### Community 109 - ".criar"
Cohesion: 0.16
Nodes (10): autorizarProprioOuAdmin(), DisponibilidadesController, paraDTO(), Body, Controller, Delete, Get, Param (+2 more)

### Community 110 - "DiaDeExpedienteDto"
Cohesion: 0.32
Nodes (8): DefinirExpedienteDto, DiaDeExpedienteDto, IsArray, IsInt, Max, Min, Type, ValidateNested

### Community 111 - "otp-sem-conta.e2e.spec.ts"
Cohesion: 0.32
Nodes (6): DIA, e164(), garantirInedito(), iniciarOtp(), loginCompleto(), sufixo

### Community 112 - "config/package.json"
Cohesion: 0.25
Nodes (7): files, name, private, version, eslint.config.js, prettier.config.js, tsconfig.base.json

### Community 113 - "FormaPagamento"
Cohesion: 0.29
Nodes (8): AgendamentoClienteDTO, AtendimentoDTO, ConcluirAtendimentoRequest, VendaDeProdutoDTO, VenderProdutoAvulsoRequest, FormaPagamento, OrigemAtendimento, StatusAtendimento

### Community 114 - "gerar-icones.mjs"
Cohesion: 0.25
Nodes (4): APPS, PNGS, RAIZ, TAMANHOS_ICO

### Community 115 - "nest-cli.json"
Cohesion: 0.29
Nodes (6): collection, compilerOptions, deleteOutDir, tsConfigPath, $schema, sourceRoot

### Community 116 - "config-seguranca.ts"
Cohesion: 0.43
Nodes (4): bootstrap(), assertConfiguracaoSegura(), ConfiguracaoInseguraError, lerConfigPagamentoManual()

### Community 117 - "ComissaoQueryService"
Cohesion: 0.33
Nodes (3): ComissaoQueryService, Injectable, Inject

### Community 118 - "SolicitarValeDto"
Cohesion: 0.29
Nodes (7): NegarValeDto, SolicitarValeDto, IsNumber, IsOptional, IsString, Min, MinLength

### Community 119 - ".definir"
Cohesion: 0.28
Nodes (7): autorizarProprioOuAdmin(), ExpedienteController, Body, Controller, Get, Param, Put

### Community 120 - "conta-cockpit.e2e.spec.ts"
Cohesion: 0.33
Nodes (4): DIA, e164(), provisionarCliente(), sufixo

### Community 121 - "PagamentoManualAguardando.tsx"
Cohesion: 0.33
Nodes (3): IconeWhatsapp(), Props, PagamentoManualAguardando()

### Community 122 - "ExpirarItensJob"
Cohesion: 0.33
Nodes (4): ExpirarItensJob, Cron, Inject, Injectable

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

### Community 129 - "SolicitarReembolsoUseCase"
Cohesion: 0.40
Nodes (3): SolicitarReembolsoUseCase, Inject, Injectable

### Community 133 - "env-up.sh"
Cohesion: 0.60
Nodes (3): derrubar_servidores(), matar_arvore(), env-up.sh script

### Community 134 - "vite/client"
Cohesion: 0.50
Nodes (4): types, types, vite/client, types

### Community 135 - "MarcarDaCasaDto"
Cohesion: 0.50
Nodes (4): MarcarDaCasaDto, IsOptional, IsString, MinLength

### Community 136 - "deploy-frontends.sh"
Cohesion: 0.83
Nodes (3): deploy_app(), info(), deploy-frontends.sh script

### Community 137 - "env-down.sh"
Cohesion: 0.83
Nodes (3): derrubar_servidores(), matar_arvore(), env-down.sh script

### Community 140 - "Dinheiro"
Cohesion: 0.12
Nodes (10): CarrinhoPrecificado, ItemDoCarrinho, ItemPrecificado, criar(), ContextoValidacaoPacoteOferta, ItemComposicaoPacote, PacoteOfertaProps, ProdutoProps (+2 more)

### Community 141 - "JanelaExpedienteDto"
Cohesion: 0.67
Nodes (3): JanelaExpedienteDto, Matches, MaxLength

### Community 159 - "BarbeiroRepository"
Cohesion: 0.22
Nodes (7): CLIENTE_DA_CASA_REPOSITORY, CLIENTE_REPOSITORY, LANCAMENTO_COMISSAO_REPOSITORY, VenderProdutoAvulsoInput, VENDA_DE_PRODUTO_REPOSITORY, BARBEIRO_REPOSITORY, BarbeiroRepository

### Community 160 - "ParametrosController"
Cohesion: 0.20
Nodes (7): ParametrosController, Body, Controller, Get, Inject, Patch, Put

### Community 161 - "IntervaloDeTempo"
Cohesion: 0.22
Nodes (4): AtendimentoProps, DisponibilidadeProps, janela(), IntervaloDeTempo

### Community 162 - "validacao.ts"
Cohesion: 0.36
Nodes (7): celularBrasileiroValido(), emailValido(), LIMITE_DIAS_AGENDAMENTO, MAX_SOBRE_VOCE, nomeDeClienteValido(), preenchido(), somenteDigitos()

### Community 163 - "seed.ts"
Cohesion: 0.33
Nodes (8): diaDaSemana(), diaLocalMaisDias(), hashSenha(), main(), prisma, seedarExpediente(), SEG_A_SAB, tz

### Community 164 - "AtualizarProdutoDto"
Cohesion: 0.36
Nodes (8): AtualizarProdutoDto, CriarProdutoDto, IsBoolean, IsInt, IsOptional, IsPositive, IsString, MinLength

### Community 165 - "regra-atribuicao-de-barbeiro.ts"
Cohesion: 0.32
Nodes (3): CandidatoAAtribuicao, escolherBarbeiroSemPreferencia(), Sorteio

### Community 166 - "ConcluirAtendimentoUseCase"
Cohesion: 0.40
Nodes (3): ConcluirAtendimentoUseCase, Inject, Injectable

### Community 168 - "ExpirarPagamentoVencidoUseCase"
Cohesion: 0.40
Nodes (3): ExpirarPagamentoVencidoUseCase, Inject, Injectable

### Community 169 - "domain-error.filter.ts"
Cohesion: 0.40
Nodes (3): DomainErrorFilter, MENSAGEM_AMIGAVEL, Catch

### Community 170 - "OnAtendimentoConcluidoHandler"
Cohesion: 0.50
Nodes (3): OnAtendimentoConcluidoHandler, Inject, Injectable

### Community 171 - "OnVendaDeProdutoRegistradaHandler"
Cohesion: 0.50
Nodes (3): OnVendaDeProdutoRegistradaHandler, Inject, Injectable

### Community 172 - "StatusPagamento"
Cohesion: 0.67
Nodes (3): PagamentoStatusDTO, VendaDePacoteDTO, StatusPagamento

## Knowledge Gaps
- **493 isolated node(s):** `Tela`, `CreditoLivre`, `SolicitarReembolsoInput`, `SolicitarReembolsoOutput`, `ConfirmarLoginClienteInput` (+488 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `UsuarioAutenticado` connect `UsuarioAutenticado` to `conta-cliente.controller.ts`, `PrismaService`, `UnitOfWork`, `PacoteOferta`, `agendar-avulso.usecase.ts`, `UsuarioAtual`, `barbeiros.controller.ts`, `BarbeiroRepository`, `ParametrosController`, `produtos.controller.ts`, `CompanyId`, `payroll.module.ts`, `materializar-expediente.usecase.ts`, `packages.module.ts`, `pacote-ofertas.controller.ts`, `vendas-produto.controller.ts`, `.atualizar`, `ValesController`, `ClientesController`, `BarbeiroId`, `PacotesController`, `.configurar`, `AuthController`, `LocalAuthProvider`, `.criar`, `.definir`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `CompanyId` connect `CompanyId` to `dinheiro.ts`, `AtendimentoId`, `conta-cliente.controller.ts`, `Barbeiro`, `shared.module.ts`, `VendaDePacote`, `Telefone`, `UnitOfWork`, `Cliente`, `Dinheiro`, `Atendimento`, `UsuarioAutenticado`, `agendar-avulso.usecase.ts`, `Servico`, `UsuarioAtual`, `IntencaoDePagamento`, `BarbeiroRepository`, `IntervaloDeTempo`, `Vale`, `payroll.module.ts`, `.deCentavos`, `materializar-expediente.usecase.ts`, `Timezone`, `pacote-ofertas.controller.ts`, `VendaDeProduto`, `BarbeiroId`, `fechamento-query.service.ts`, `ValeRepository`, `Produto`, `atendimento.events.ts`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Why does `Cliente` connect `Cliente` to `account/src/App.tsx`, `dinheiro.ts`, `shared.module.ts`, `Telefone`, `UnitOfWork`, `agendar-avulso.usecase.ts`, `BarbeiroRepository`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **What connects `Tela`, `CreditoLivre`, `SolicitarReembolsoInput` to the rest of the system?**
  _493 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `account/src/App.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.062038073908174694 - nodes in this community are weakly interconnected._
- **Should `dinheiro.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10505050505050505 - nodes in this community are weakly interconnected._
- **Should `AtendimentoId` be split into smaller, more focused modules?**
  _Cohesion score 0.08461538461538462 - nodes in this community are weakly interconnected._
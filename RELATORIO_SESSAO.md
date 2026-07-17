# Relatório da Sessão — Bigod's Barber v2

Sessão original (2026-07-14): todas as 4 fases concluídas, 84 testes verdes.
Sessão de correção de fuso horário (2026-07-14, continuação): ver seção
dedicada abaixo. **100 testes verdes** (91 de domínio puro + 9 de integração
com Postgres), idênticos sob `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo`.

Sessão mais recente (2026-07-16, "expediente + PIX_ONLINE + produtos" — ver
seção dedicada perto do fim deste arquivo): **229 testes verdes**, idênticos
sob os mesmos 3 fusos.

## Fase 1 — Fundação do monorepo ✅

- npm workspaces + Turborepo (`turbo.json` com pipelines build/test/lint/dev).
- `apps/api` (NestJS 11 + Vitest), `apps/admin` (React 18 + Vite 6 + Tailwind 3), `packages/contracts` (dual CJS/ESM), `packages/config` (tsconfig/prettier compartilhados).
- `apps/booking` e `apps/account`: apenas esqueleto (package.json + index), como pedido.
- `docker-compose.yml` com Postgres 16.

## Fase 2 — Domínio puro ✅

TypeScript puro, **zero import de framework** em `domain/` (verificado por grep).

- VOs: `Dinheiro` (centavos int), `Percentual` (pontos-base int — sem float em comissão), `Telefone` (E.164, chave de reconciliação), `Duracao`, `IntervaloDeTempo` (semiaberto `[inicio, fim)`).
- Agregados: `Servico`, `Barbeiro` (matriz de comissão: padrão + exceções por serviço), `DisponibilidadeBarbeiro`, `Cliente` (promoção a usuário), `Atendimento` (máquina §4.1, invariantes §3.5, snapshot de valores), `VendaDePacote`/`ItemDoPacote` (máquina §4.2, rateio congelado com resíduo no último item, invariante `Σ rateado(não-expirados) + saldoResidual == valorPago` verificada a cada mutação), `LancamentoComissao` (ledger imutável), `IntencaoDePagamento` (confirmação idempotente).
- Eventos §5 completos e interfaces de repositório por módulo.
- Testes de invariante: rateio (incl. casos hostis de arredondamento e fuzz determinístico), TODAS as transições legais/ilegais do item de pacote, comissão (padrão/exceção/base rateada/snapshot), sobreposição de horário.

## Fase 3 — Aplicação + Infraestrutura ✅

- Schema Prisma completo (dinheiro como inteiro de centavos, percentuais em bp) + migration com **`EXCLUDE USING gist`** (btree_gist, `tsrange(inicio, fim, '[)')`, parcial `WHERE status='AGENDADO'`) — verificada no banco.
- Repositórios Prisma com mapeamento explícito (tipos do Prisma não vazam); `UnitOfWork` (porta) + `PrismaUnitOfWork` (`$transaction`) para escritas multi-passo; eventos publicados **após o commit** via EventEmitter.
- Casos de uso §8: agendar avulso (passos 4–6 em uma transação; cobrança PIX opcional), agendar com crédito (**venda + atendimento na mesma transação**, valorCobrado = rateado), concluir (item vira CONSUMIDO na transação; comissão via handler de evento §2.3, idempotente), cancelar (antecipado libera item / tardio computa falta, via handlers §5), não-comparecimento. Job cron diário (03:00) expira itens em SEGUNDA_CHANCE vencidos.
- Auth: interface `AuthProvider` (Cognito pluga aqui depois) + `LocalAuthProvider` (scrypt + token HMAC). **Guard global**: toda rota exige Bearer, exceto `@Publico()` (login, webhook). Papéis por enum via `@Papeis(...)`. Nenhum endpoint de escrita sem guard.
- `PaymentGateway` (porta) + `FakeAbacatePayGateway`; webhook `POST /webhooks/abacatepay` idempotente por `externalId`.
- Seed: Company "bigods", Gabriel (ADMIN+BARBEIRO, 45%, login `gabriel`/`bigods123`), Corte R$40/30min, Barba R$30/20min, 30 dias de disponibilidade (9h–18h UTC), 1 pacote exemplo PAGO (R$60 → rateio 34,29 + 25,71).
- Testes de integração (exigem o Postgres do docker no ar): EXCLUDE rejeita inserções sobrepostas concorrentes (e respeita parcialidade/semiaberto), rollback completo da transação de crédito, webhook processado 2× sem efeito duplo.
- Smoke test manual completo via curl (login → agendar → conflito 422 → concluir → ledger → crédito de pacote → comissão sobre rateado → item CONSUMIDO).

## Fase 4 — Painel admin ✅

Design importado do Claude Design (`ui_kits/admin-panel` + `tokens/*`) via MCP; tokens de cor/tipografia (Manrope/Rye, paleta ink/gold) replicados em `apps/admin/src/index.css`; shell mobile 430px com bottom nav (Agenda/Pacotes/Comissão/Ajustes), como no protótipo.

- Tipos de API 100% de `@bigods/contracts` (nenhum tipo redeclarado).
- Visibilidade por papel: barbeiro não-admin só vê a própria agenda e a própria comissão; gestão de serviços/parâmetros e seleção de barbeiro são só admin.
- Comissão: **saldo real** (card escuro, "atendimentos concluídos") e **projeção futura** (card tracejado, "pode ser cancelada") — separados e rotulados, nunca somados.
- Agenda: atendimento de crédito de pacote com borda/fundo dourados + badge "Pacote"; avulso neutro + badge "Avulso".
- Loading/erro (com retry)/vazio em toda tela (`useApi`).
- Fluxos: agendar avulso, vender pacote (PIX fake ou pagamento presencial), agendar item com crédito, concluir/cancelar/falta, CRUD de serviços, prazo de reagendamento.

Divergência consciente do protótipo (DOMAIN.md vence): o mock mostrava pacotes como catálogo e comissão mensal agregada; implementei o modelo real (vendas por cliente com ciclo de vida por item; ledger + projeção separados).

## Correção de fuso horário (sessão 2026-07-14, continuação) ✅

**Bloqueador de produção corrigido:** o sistema operava em UTC ponta a ponta —
"disponibilidade das 9h às 18h" seedada como UTC virava 6h–15h no horário real
do Gabriel (America/Sao_Paulo, UTC-3). Princípio seguido: o banco continua
guardando instantes absolutos (timestamptz); a empresa tem um timezone IANA
próprio (não uma constante global — outras barbearias em outros fusos vão usar
o sistema); toda fronteira converte; o domínio permanece puro e nunca presume
fuso implícito (recebe `Timezone` como parâmetro explícito quando precisa
raciocinar sobre dias civis).

**Domínio (`apps/api/src/shared/domain/`):**
- `Timezone` — VO que valida fuso IANA via `Intl.DateTimeFormat` (TS puro, sem lib externa).
- `calendario.ts` — funções puras usando só `Intl.DateTimeFormat`: `instanteDeLocal`/`instanteDeDataHoraLocal` (local→UTC, robusto a DST via a técnica padrão de 2 iterações), `diaCivilChave` (dia civil no fuso dado), `limitesDoDiaCivil` (intervalo `[00:00 local, 00:00 local do dia seguinte)` para consultas de agenda), `fimDoDiaCivilMaisDias` (prazo em **dias civis**, não em N×24h — usado pelo prazo de reagendamento).
- `VendaDePacote.computarFalta` agora recebe `tz: Timezone` explícito e usa `fimDoDiaCivilMaisDias` — o prazo vence no fim do dia civil local. A **checagem** de vencimento (`expirarItensVencidos`) continua sendo comparação pura de instantes UTC, porque o prazo já foi congelado corretamente no momento da falta — nenhuma tz é necessária de novo ali.

**Banco/Prisma:**
- `Company.timezone` (IANA, default `"America/Sao_Paulo"`).
- Auditoria completa: **todas** as colunas `DateTime` (`Atendimento.inicio/fim`, `Disponibilidade.inicio/fim`, `VendaDePacote.compradoEm`, `ItemDoPacote.prazoReagendamentoAte`, `LancamentoComissao.ocorridoEm`) estavam como `timestamp without time zone` — corrigidas para `@db.Timestamptz(3)`. Migration usa `AT TIME ZONE 'UTC'` explícito na conversão (não o cast implícito do Postgres, que reinterpretaria os valores conforme o `TimeZone` da sessão da migration). A constraint `EXCLUDE` foi recriada com `tstzrange` (era `tsrange`, que não aceita `timestamptz`).

**Aplicação/infraestrutura:**
- `ParametrosDaEmpresaRepository.timezone(companyId)` — nova porta, sem tenant explícito → erro (nunca fallback, DOMAIN.md §2.4).
- `AgendarAvulsoUseCase`/`AgendarComCreditoUseCase`: a busca de disponibilidade por "data" usava `inicio.toISOString().slice(0,10)` (dia **UTC** do instante) — trocado por `diaCivilChave(inicio, tz)`. Esse era exatamente o bug: um atendimento às 23h30 local cairia no dia UTC seguinte e não encontraria a disponibilidade certa.
- `AgendaQueryService.listar` passou a receber `diaLocal` + `tz` e usa `limitesDoDiaCivil` para o range de consulta — "a agenda de hoje" agora é o dia civil local, não o dia UTC bruto.
- Controllers (`atendimentos`, `disponibilidades`, `parametros`) convertem na borda: requests recebem `data` (YYYY-MM-DD local) + `horaInicio`/`inicio`/`fim` (HH:mm, horário de parede local) em vez de ISO pré-construído; o servidor busca o tz da empresa e converte com `instanteDeDataHoraLocal`. Respostas continuam ISO 8601 UTC (`Z`), formato único documentado nos contracts.
- `ExpirarItensJob`: comentário explícito de que a correção da expiração **não depende** do horário exato do cron (o prazo já é um instante absoluto correto); o cron roda às 3h `America/Sao_Paulo` por conveniência operacional, não por necessidade de correção.
- Seed corrigido para construir os instantes de disponibilidade via `instanteDeDataHoraLocal(data, '09:00'|'18:00', tz)` — **achado durante a verificação manual**: o `upsert` original usava `update: {}` (no-op), então rodar o seed de novo não corrigia disponibilidades já existentes da sessão anterior (bug mascarado). Corrigido para `update` real (seed autocorretivo).

**Frontend (`apps/admin`):**
- `TimezoneProvider`/`useTimezone()` — busca `/parametros` uma vez após login e disponibiliza o fuso da empresa via contexto; toda tela usa esse fuso para formatar horas/datas, nunca `Intl`/`Date` sem `timeZone` explícito (o que usaria o fuso do navegador — um admin viajando não pode ver a agenda deslocada).
- `hora`/`dataCurta`/`hojeISO` em `lib/format.ts` agora exigem `tz` explícito.
- Diálogos de agendar avulso, agendar com crédito e disponibilidade enviam `data` + horário local (`HH:mm`) em vez de montar `${data}T${hora}:00.000Z` no cliente (que hardcodava UTC).

**Testes (o que provaria a regressão se alguém revertesse a correção):**
1. `calendario.spec.ts` — 9h/18h local de SP → 12:00Z/21:00Z; 23:30 local → instante UTC do dia seguinte mas `diaCivilChave` correto; `limitesDoDiaCivil` classifica corretamente um atendimento de 23:30 no seu próprio dia.
2. `calendario.spec.ts` — **DST real**: atravessando o início do horário de verão em `America/New_York` (2024-03-10), prova que dia civil é aritmética de calendário (2 dias civis) e não 48h corridas (na verdade 47h, porque 03-10 tem só 23h em NY).
3. `venda-de-pacote.spec.ts` — prazo de 10 dias vence no fim do dia civil, não em `hoje + 240h`; caso explícito de falta às 23h local cujo prazo vence "hoje" local mas cairia em dia diferente em UTC.
4. `test/integration/fuso-horario.spec.ts` (exige Postgres): disponibilidade "9h" local persiste como `12:00:00.000Z` no banco (timestamptz real); atendimento às 23:30 local aparece na consulta de agenda do seu dia civil correto e NÃO no dia seguinte; `ExpirarItensJob` não expira um item antes do fim do dia civil local mesmo quando esse instante já é "outro dia" em UTC.
5. **Independência de TZ do processo**: `npm run test:multitz` (novo script, roda a suíte inteira 3× com `TZ=UTC`, `TZ=America/Sao_Paulo`, `TZ=Asia/Tokyo`) — **100/100 testes idênticos nos três fusos**, provando que nada depende do `TZ` do runtime.

**Fora de escopo (como pedido):** seleção de timezone na UI de configuração — o modelo suporta (`ParametrosDTO.timezone` já é retornado pela API), mas não há tela para trocá-lo; a empresa seedada é única.

## Funil público de agendamento avulso (sessão 2026-07-14, continuação) ✅

Implementado o `apps/booking` como o funil público de agendamento **avulso**, consumindo a API real. Cliente não autenticado marca um horário (nome + telefone), paga **presencialmente** (cobrado na conclusão pelo painel, como o fluxo avulso já existente), e o atendimento **aparece na agenda do Gabriel no admin** — ciclo fechado, sem mocks. Escopo estrito: nada de Cognito, AbacatePay, pacotes ou área do cliente.

**Backend — superfície pública (`modules/scheduling`, endpoints `@Publico()` atrás do guard global):**
- `GET /public/empresa?companyId=` → marca + fuso (`EmpresaPublicaQueryService`). Empresa inexistente → 404, nunca fallback (§2.4).
- `GET /public/servicos?companyId=` → serviços ativos.
- `GET /public/barbeiros?companyId=&servicoIds=` → barbeiros ativos que atendem **todos** os serviços escolhidos.
- `GET /public/horarios?companyId=&barbeiroId=&data=&servicoIds=` → **projeção** de horários livres (`HorariosDisponiveisQueryService`): slots que cabem numa janela de disponibilidade e não colidem com atendimento AGENDADO. Dia civil **local**, horários renderizados no fuso da empresa (novo helper puro `horaLocalHHmm` em `calendario.ts`). Grade de 15 min (decisão pendente #3).
- `POST /public/agendamentos` → **reusa `AgendarAvulsoUseCase`** com `gerarCobranca=false`. Nenhuma invariante é pulada: serviço ativo, barbeiro atende, disponibilidade por dia civil local, conflito de horário (invariante + EXCLUDE), encontrar-ou-criar cliente por telefone — tudo na transação que já existia.

**Decisão registrada (endpoint público vs. guard global):** o endpoint de agendar do painel exige autenticação (guard global). Em vez de afrouxar o guard ou duplicar regra, criei um endpoint `@Publico()` dedicado que **orquestra o mesmo caso de uso** — a escrita pública passa exatamente pelas mesmas validações de domínio (evita o anti-padrão §10 "rota pública de escrita sem validação"). O **tenant é explícito**: o funil carrega `companyId` (constante de build, `VITE_COMPANY_ID`, default `bigods`) e o envia em toda chamada — sem resolução implícita de empresa no servidor.

**Frontend (`apps/booking`, React+Vite+Tailwind, tokens compartilhados do design system, porta 5174):**
- Etapas: Landing → Serviços (multi-seleção, total+duração sempre visíveis) → Barbeiro (pré-selecionado e pulado quando só há um que atende os serviços) → Data/Horário (day picker + slots reais agrupados manhã/tarde) → Dados (nome + telefone com máscara) → Confirmação (resumo + aviso "pagamento na barbearia") → Sucesso.
- Datas/horas **sempre no fuso da empresa** (via `/public/empresa`, mesmo princípio do `TimezoneProvider` do admin) — nunca o fuso do navegador.
- Progresso persiste a refresh (`sessionStorage`, chave `bigods.booking.v1` — não é o banco); voltar sem perder o preenchido; indicador de progresso (stepper).
- Estados de loading/erro (com retry)/vazio em toda etapa. Tipos 100% de `@bigods/contracts`.
- Layout novo (superfície de conversão mobile-first, responsivo), linguagem visual compartilhada com o admin (ink/gold, Manrope/Rye, cards/botões/inputs).

**Divergências conscientes do protótipo** (implementação, não domínio): sem upsell de pacote e sem PIX/cartão (fora de escopo — pagamento presencial); hero da landing com gradiente de marca em vez da imagem `barber-background.jpg`, e sucesso com checkmark SVG animado em vez do `success-animation.json` (Lottie) — mantém o app self-contained, sem dependência/asset externo (a cláusula "se encaixar" do brief). Foto de barbeiro: avatar de iniciais, pois o domínio não modela foto (decisão pendente #4).

**Testes:** e2e do endpoint público (`booking-publico.e2e.spec.ts`, Supertest + AppModule real, 12 casos) — bypass do guard sem token, cliente novo por telefone, conflito 422, fora da disponibilidade 422, **reconciliação por telefone** (dois agendamentos, mesmo telefone → um só cliente), horários no fuso local. Vitest passou a usar **SWC** (`unplugin-swc`) para emitir metadata de decorator e permitir bootar a DI do Nest nos testes. Total: **112 testes** (91 domínio/unit + 21 integração/e2e).

## Ajustes no painel admin (sessão 2026-07-15) ✅

Quatro pedidos pontuais no `apps/admin`, todos implementados e testados manualmente contra a API real.

**1. Agenda — de "um dia" para "semana/período" (`Agenda.tsx`):**
- Removido o filtro de dia único. Agora tem dois modos: **Semana** (padrão — segunda a domingo da semana atual, com navegação "◀ anterior / próxima ▶") e **Período** (dois inputs de data, validado `de <= ate` e no máximo **31 dias** — decisão pendente #5).
- Lista agrupada por dia civil local, com cabeçalho de seção por dia ("Segunda-feira, 14 de julho") e cada card mostrando a hora — nunca ambíguo qual dia/horário é cada agendamento.
- Novo filtro de barbeiro (só para admin, só aparece com mais de um barbeiro atendendo) — passa `barbeiroId` para a API.
- Backend: `GET /atendimentos` trocou o parâmetro único `data` por `de`/`ate` (dias civis, inclusive nas duas pontas); `AgendaQueryService.listar` recebe `deLocal`/`ateLocal` em vez de `diaLocal`. **Breaking change de contrato** — só tinha um consumidor (o admin), atualizado junto.

**2. Detalhe do agendamento sempre com cliente + data + hora:**
- Extraído `AtendimentoDetalheDialog` (`apps/admin/src/components/`), um componente **compartilhado** que busca o atendimento por id (novo `GET /atendimentos/:id`, com a mesma autorização da listagem: barbeiro só vê os próprios, admin vê tudo) e sempre mostra nome+telefone do cliente num bloco destacado, mais **data** (antes só mostrava a hora) e hora de início/fim.
- Reusado tanto pela Agenda (clicar num card) quanto pela Comissão (item 3) — literalmente o mesmo componente, não uma cópia.

**3. Histórico de comissão com mais contexto (`Comissao.tsx`):**
- Cada lançamento agora mostra o **nome do cliente** inline (novo campo `clienteNome` em `LancamentoComissaoDTO`) e a **data real do atendimento** (`atendimentoInicio` — importante: é diferente de `ocorridoEm`, que é o instante em que o atendimento foi *concluído*/lançado no ledger; um atendimento pode ser concluído em outro momento do dia). Um botão de informações (ⓘ) abre o mesmo `AtendimentoDetalheDialog` do item 2, trazendo telefone e o resto do detalhe.
- `ComissaoController` agora faz um join em lote (Atendimento → Cliente) para preencher esses campos sem N+1.

**4. Seletor de barbeiro filtrado por papel:** como consequência direta do item 4 do seed (abaixo), os seletores de "escolher barbeiro para agendar" (Agenda, Pacotes) e o seletor de comissão agora filtram por `papeis.includes('BARBEIRO')` — um admin puro (que não atende) não aparece mais como opção de quem vai cortar o cabelo (decisão pendente #6).

**5. Seed fortalecido — mais usuários para testar o fluxo completo:**
- **2 admins puros** (só gestão, não atendem): `lkt` / `rafaelgrigio`, senha `bigods123` (mesma senha de todos os logins seedados, só para dev local).
- **2 barbeiros fictícios** (só atendem, não são admin), com atributos propositalmente diferentes de Gabriel para exercitar a matriz de comissão e a disponibilidade por dia civil:
  - **Lucas Andrade** — 40% de comissão padrão, atende Corte+Barba, expediente **12h–20h** (tarde/noite).
  - **Pedro Martins** — 35% de comissão padrão, atende Corte+Barba, **exceção de comissão: Barba = 60%** (testa `Barbeiro.percentualPara` com override por serviço), expediente **9h–13h** (só manhã).
- Seed continua idempotente (upserts com `update` real, não `{}`) — rodar de novo não duplica nem perde dados.

## Infraestrutura de identidade do cliente (sessão 2026-07-15) ✅

Módulo `identity` do CLIENTE final: login sem senha por telefone (OTP), com um **modo demo 100% funcional sem AWS** e o adapter real do Cognito **pronto para plugar** — a troca é só variável de ambiente. Não toquei no `AuthProvider` de staff/admin (preocupação separada).

**Porta única (`IdentityProvider`, domínio TS puro):** `provisionarUsuario` / `iniciarLogin` / `confirmarLogin`. A aplicação e o domínio dependem só desta interface; os dois adapters são o único lugar que conhece "demo vs. cognito".

**`DemoIdentityProvider` (`IDENTITY_PROVIDER=demo`, default em dev):** código de 6 dígitos, guardado **com hash** (HMAC) numa tabela própria (`DemoDesafioLogin`), expira em poucos minutos, uso único, com limite de tentativas por desafio. NUNCA envia SMS; só devolve o código na resposta quando `DEMO_MODE=true`. O "user pool" demo é a tabela `DemoIdentidade` (sub estável por telefone).

**`CognitoIdentityProvider` (`IDENTITY_PROVIDER=cognito`):** AWS SDK v3, login sem senha via **Custom Auth Challenge** (`CUSTOM_AUTH`). Cliente do SDK injetado para ser mockável (nenhum teste toca a AWS). Escolha do fluxo e alternativa (SMS_OTP nativo) documentadas na decisão pendente #8. Os 3 Lambda triggers (Define/Create/Verify) estão prontos em **`infra/cognito-triggers/`** com um README de deploy — **não publiquei nada** (sem acesso à conta AWS), é só o Rafael aplicar.

**Rede de segurança de configuração:** `assertConfiguracaoSegura()` roda no boot (`main.ts`) e **recusa subir** se `DEMO_MODE=true` e `NODE_ENV=production` juntos (o código OTP vazaria) — também recusa `IDENTITY_PROVIDER=demo` em produção (não haveria SMS real). Verificado: `NODE_ENV=production DEMO_MODE=true node dist/main.js` sai com erro antes de instanciar qualquer coisa.

**Promoção do cliente (§3.4, refinada — decisão pendente #7):** `PacoteVendido` → `OnPacoteVendidoHandler` só **provisiona** o usuário externo (idempotente). O `Cliente.cognitoSub` só é preenchido na **confirmação do código** (`ConfirmarLoginClienteUseCase.promoverParaUsuario`), quando o cliente prova posse do telefone — nunca antes. Comprar outro pacote não duplica usuário nem cliente (reconciliação por telefone).

**Endpoints (área logada do cliente, `/conta`):** `POST /conta/login/iniciar`, `POST /conta/login/confirmar` (retorna token de sessão próprio da app — provider-agnóstico), `GET /conta/perfil` (cliente + pacotes, reusando o read model de pacotes). Sessão do cliente via `ClienteGuard` + token HMAC próprio (separado do guard de staff).

**Rate limiting (`@nestjs/throttler`):** guard global que chaveia por **telefone** quando presente (senão por IP). Login (`iniciar`/`confirmar`): **5 tentativas por telefone / 10 min** — freia força bruta de código e esgotamento de custo de SMS. O endpoint público de agendamento da sessão anterior (que estava **sem proteção**) ganhou **30/10 min por IP**.

**Troca demo→produção é SÓ variável de ambiente** (confirmado): sobe `IDENTITY_PROVIDER=cognito`, preenche as vars do Cognito (abaixo), remove `DEMO_MODE`. Nenhum arquivo de aplicação/domínio muda — a factory em `identity.module.ts` é o único ponto que escolhe o adapter.

**Variáveis que o Rafael preenche quando o User Pool estiver pronto** (documentadas em `.env.example`): `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` (app client sem secret, com `ALLOW_CUSTOM_AUTH`), `COGNITO_OTP_TTL_MINUTOS` (opcional), e credenciais AWS pela cadeia padrão do SDK (IAM Role em prod). A role do backend precisa de `AdminCreateUser`, `AdminSetUserPassword`, `InitiateAuth`, `RespondToAuthChallenge`.

**Testes (25 novos, total 137):** config guard (6, unit); `CognitoIdentityProvider` com SDK mockado (9); e2e do fluxo demo (10) — provisão-sem-promoção, iniciar→código errado(401)→código certo(promove), uso único, expirado(401), telefone não provisionado (resposta neutra), perfil autenticado, e rate limit (6ª tentativa → 429). Smoke manual confirmou o fluxo HTTP ponta a ponta e o `cognitoSub` preenchido só na confirmação.

## Gateway de pagamento real (AbacatePay) + webhook validado (sessão 2026-07-15) ✅

Substituído o `FakeAbacatePayGateway` pelo gateway real **atrás da mesma porta
`PaymentGateway`** — trocar `fake ↔ abacatepay` é só a variável `PAYMENT_GATEWAY`
(default `abacatepay` em produção, `fake` fora dela), zero mudança de domínio/aplicação.

- **`AbacatePayGateway`** (`infrastructure/abacatepay.gateway.ts`): cria cobrança PIX
  (Checkout Transparente, `POST /pixQrCode/create`) com QR Code + copia-e-cola, sem
  redirecionar o cliente. `externalId` (= id da nossa `IntencaoDePagamento`) viaja em
  `metadata.externalId` — a chave que o webhook devolve (§3.8). `fetch` **injetado/mockável**;
  nenhum teste toca a rede. Tem `simularPagamento(gatewayId)` para o e2e de sandbox.
- **Validação de assinatura do webhook (falha de segurança real corrigida):** o
  `AbacatePayWebhookGuard` valida **antes** de qualquer processamento — HMAC-SHA256 do
  **corpo cru** (bootstrap com `rawBody: true`) contra `X-Webhook-Signature`, comparado
  em **tempo constante** (`crypto.timingSafeEqual`, nunca `===`); aceita também o
  `?webhookSecret=` em tempo constante. Payload não-verificado → **401**, sem tocar em
  nenhuma entidade. Idempotência por `externalId` preservada (não regrediu).
- **Modelo de ambientes:** validação de assinatura é **incondicional** — sem branch de
  "pular em dev". Homologação e produção rodam o mesmo código; a única diferença é a
  API key / webhook secret. O `config-seguranca` **recusa o boot** com `PAYMENT_GATEWAY=abacatepay`
  sem `ABACATEPAY_API_KEY` ou `ABACATEPAY_WEBHOOK_SECRET`. Com `fake`, o webhook nem é montado.
- **Rate limit** no webhook (`@Throttle` 60/min) além da assinatura.

**Variáveis a preencher** (em `.env.example`, seção "Pagamento"): `ABACATEPAY_API_KEY`
(painel → Integrar → API Keys) e `ABACATEPAY_WEBHOOK_SECRET` (painel → Webhooks, ao criar
o endpoint) — **ambas obrigatórias** com o gateway real. Opcionais: `ABACATEPAY_BASE_URL`
(default `https://api.abacatepay.com/v1`), `ABACATEPAY_EXPIRA_SEGUNDOS`. **Credenciais de
sandbox:** obter no painel do AbacatePay em modo dev/teste — a mesma base, só troca a key.
Como testar o webhook local sem HTTPS pública (payload assinado à mão ou ngrok): ver
`apps/api/src/modules/payments/README.md`.

**Confirmação:** trocar fake→real é **só variável de ambiente** — `PAYMENT_GATEWAY=abacatepay`
+ as duas keys; nenhum código de domínio/aplicação muda.

**Testes (23 novos, total 160):** verificador de assinatura (8, unit — HMAC válido/inválido/
adulterado/ausente/segredo vazio/query); `AbacatePayGateway` com `fetch` mockado (5 — mapeamento
brCode/brCodeBase64, envio de `metadata.externalId`+centavos+Bearer, erros HTTP/error, simulate);
config guard do gateway (novos casos); e2e do webhook (5 — assinatura válida confirma e libera,
ausente/inválida → 401 sem tocar na intenção, idempotência 2x). Boot verificado: recusa
`PAYMENT_GATEWAY=abacatepay` sem webhook secret (exit 1). **Pendente:** e2e contra o sandbox
real, aguardando a key de teste (DECISOES_PENDENTES #9 — primeiro a rodar quando chegar).

## Fechamento do produto: cockpit do cliente + trilha de pacote + pagamento online (sessão 2026-07-15) ✅

Esta sessão fecha o ciclo: o cliente compra pacote no funil, paga online, loga na
sua conta e usa os créditos — tudo consumindo a infraestrutura já pronta (identidade
demo/Cognito, AbacatePay real + webhook validado). Nenhuma infra nova foi inventada.

**Backend (contratos + endpoints, reusando casos de uso existentes):**
- `POST /public/pacotes` (trilha de pacote pública) + `GET /public/pacotes` (ofertas).
  Reusa `VenderPacoteUseCase` — zero regra duplicada; tenant explícito; rate limit
  igual ao agendamento (30/10min). `online` gera cobrança PIX real; `presencial` fica
  AGUARDANDO.
- `GET /public/pagamentos/:intencaoId` — status da intenção (§3.8) para o **polling**
  do funil online. Leitura pura, escopada por `companyId` (§2.4), idempotente.
- `POST /public/agendamentos` ganhou `formaPagamento` (online→PIX / presencial).
- `POST /conta/agendamentos` — agendar com crédito na área logada (client-authed),
  reusa `AgendarComCreditoUseCase` (§8.2, dois agregados numa transação); confere que
  o pacote é do próprio cliente (403 se não).
- `GET /conta/perfil` enriquecido com `proximosAgendamentos` (novo read model
  `AgendamentosClienteQueryService`).
- `VenderPacoteUseCase` ganhou `gerarCobranca` (online/presencial) e passou a expor
  `intencaoId` sempre.

**`PacoteOferta` (read model, não é domínio):** o funil precisava de "pacotes com
desconto", mas o DOMAIN.md não modela template/precificação de pacote. Implementado
como catálogo de leitura semeado, fora dos agregados; a venda expande nos serviços
reais e passa pelo rateio (§3.6). Registrado em DECISOES_PENDENTES #12.

**apps/account (cockpit do cliente — era esqueleto, agora app React completo):**
login por telefone → OTP (reusa `/conta/login/*`, com resposta neutra para telefone
sem conta), home com hierarquia estrita (alerta de 2ª chance com prazo → próximo
agendamento/CTA → pacotes com **estado real por ficha de crédito** disponível/agendado/
consumido/2ª chance + saldo residual → histórico), e fluxo "usar crédito" (serviço →
barbeiro auto/escolha → dia/hora → confirmação "sem cobrança" → sucesso). Design do
Claude Design (`ui_kits/client-area`), tokens/componentes reusados do admin/booking.

**apps/booking (trilha de pacote + pagamento):** Landing com duas portas (agendar /
comprar pacote) + link "já é cliente". Trilha de pacote como **bifurcação** do funil
avulso (reusa Dados e Confirmação). Escolha **online/presencial** na confirmação dos
**dois** funis. Online → tela de **PIX com QR + copia-e-cola + polling** do status até
PAGO (trata EXPIRADO/FALHOU com "tentar de novo"). **Onboarding pós-compra**: na tela
de sucesso do pacote pago, "criar seu acesso agora" dispara o mesmo OTP inline.

**Testes (10 novos, total 170):** `pacote-publico.e2e` (6 — ofertas com desconto,
compra online→webhook assinado libera créditos, reconciliação por telefone,
**polling idempotente**, presencial fica AGUARDANDO, tenant no status); `conta-cockpit.e2e`
(4 — sem-pacote, fixtures segunda-chance/esgotado/residual, agendar com crédito reflete
no perfil, 403 para pacote alheio). Full build dos 5 pacotes verde.

### Checklist de smoke test manual (ponta a ponta — rodar antes do dia 20)

Pré: `docker compose up -d`, `npx prisma migrate deploy`, `npx tsx prisma/seed.ts`,
API no ar (`PAYMENT_GATEWAY=fake` OU `abacatepay` + credenciais para testar PIX real),
`DEMO_MODE=true` para ver o código OTP. Apps: `npm run dev` em admin(5173)/booking(5174)/account(5175).

1. **Comprar pacote público (online):** booking → "Comprar um pacote" → escolher "5 Cortes"
   → dados (nome + telefone) → confirmar com "Pagar agora (PIX)" → ver QR + copia-e-cola.
2. **Confirmar pagamento:** em `DEMO_MODE=true` a tela de PIX mostra o botão **"Simular
   pagamento (demo)"** — clicar confirma via `POST /public/pagamentos/:id/confirmar-demo`
   (reusa o caso de uso do webhook, idempotente) e a tela **avança sozinha**. Com gateway
   real, simule no sandbox do AbacatePay (ou dispare o webhook assinado). O botão demo é
   inerte em produção (só responde com `DEMO_MODE=true`).
3. **Onboarding:** na tela de sucesso do pacote, "criar seu acesso agora" → digitar o
   código OTP (demo: aparece na tela) → "acesso criado".
4. **Logar no cockpit:** account (5175) → telefone → código OTP → ver o pacote recém-comprado
   com 5 fichas **disponíveis**.
5. **Agendar com crédito:** no cockpit, "Usar um crédito · Agendar" → dia/hora → confirmar
   ("sem cobrança") → ver o próximo agendamento no topo e a ficha virar **agendada**.
6. **Concluir no painel do Gabriel:** admin (5173) → agenda → abrir o atendimento do cliente
   → concluir.
7. **Ver a comissão rateada:** admin → comissão do barbeiro → o lançamento aparece com
   **valor base = rateado do pacote** (não o avulso), no extrato auditável.

## Decisões pendentes (DECISOES_PENDENTES.md)

1. **Prazo limite do "cancelamento antecipado"** não definido na spec — usei "antes do início do atendimento".
2. **Retorno de item em 2ª chance após cancelamento antecipado** — preservo SEGUNDA_CHANCE+prazo (o diagrama sugere DISPONIVEL, mas isso permitiria escapar da expiração em loop).
3. **Granularidade do grid de horários do funil** (15 min) — projeção, não regra de domínio; confirmar com o negócio.
4. **Foto do barbeiro no funil** — domínio não modela foto; usei avatar de iniciais.
5. **"1 mês" como período máximo da agenda** — usei 31 dias corridos fixos (não mês-calendário).
6. **Admins puros não atendem** — LKT e Rafael Grigio têm só papel ADMIN, sem `servicosAtendidos`; seletores de barbeiro filtram por papel BARBEIRO.
7. **`cognitoSub` preenchido na confirmação do OTP, não na compra do pacote** — refinamento de segurança do §3.4 (compra provisiona; posse do telefone promove).
8. **Fluxo do Cognito: Custom Auth Challenge (implementado) vs. SMS_OTP nativo** — escolhi o portável; migrar mexe só no adapter.
9. **E2E contra o sandbox real do AbacatePay** — pendente de credencial de teste; primeiro a rodar quando chegar.
10. **Versão/base da API do AbacatePay** — adotei `/v1` + `pixQrCode` (overridável por `ABACATEPAY_BASE_URL`); confirmar no sandbox.
11. **Webhook só montado com o gateway real** — em `fake` nenhuma superfície é exposta; guard falha fechado sem secret.
12. **Catálogo de ofertas de pacote (`PacoteOferta`) não é domínio** — read model semeado; template/desconto e CRUD no admin ficam pendentes de decisão do negócio.

## Pendências / limitações conhecidas

- `apps/account` (cockpit do cliente): **implementado** nesta sessão (login OTP, home com fichas de crédito por estado, agendar com crédito). CRUD de ofertas de pacote no admin continua fora de escopo (DECISOES #12).
- `apps/booking`: funil **avulso e de pacote**, com escolha online/presencial e PIX com polling. Onboarding pós-compra inline.
- Cognito: adapter real pronto (`IDENTITY_PROVIDER=cognito`) + Lambdas em `infra/cognito-triggers/`; falta o Rafael publicar na AWS e preencher as env vars.
- AbacatePay: **gateway real e webhook validado implementados** (`PAYMENT_GATEWAY=abacatepay`). Falta só preencher `ABACATEPAY_API_KEY`/`ABACATEPAY_WEBHOOK_SECRET` e rodar o e2e contra o sandbox quando a key chegar. Em dev, `PAYMENT_GATEWAY=fake` (sem webhook exposto).
- `npm run test` inclui os testes de integração → exige o Postgres do docker-compose rodando e migrado.
- Notificação WhatsApp: não implementada (Fase 2 do produto), mas `AtendimentoAgendado` já é emitido.
- Timezone corrigido nesta sessão (ver seção dedicada acima): banco em `timestamptz`, `Company.timezone` = `America/Sao_Paulo`, toda fronteira converte. Não há UI para trocar o timezone (fora de escopo combinado).
- Disponibilidade por dia da semana (Gabriel só aparecia agendável na semana atual, nunca em domingo fechado corretamente) e produtos/comissão: **resolvidos na sessão 2026-07-16**, ver seção dedicada abaixo.

## Expediente semanal + PIX_ONLINE + walk-in add-on + produtos (sessão 2026-07-16) ✅

Sessão de correção de três inconsistências operacionais + venda de produtos mínima
(sem estoque). Escopo estritamente respeitado: **não mexeu** em preço-por-barbeiro
nem no cockpit do cliente (sessões separadas).

### 1. Expediente semanal recorrente (bug operacional corrigido)

Antes: disponibilidade era criada dia a dia (o seed gerava 30 dias corridos,
**incluindo domingo** — barbearia fechada aparecia agendável). Agora:

- **`ExpedienteSemanal`** (novo agregado, `staff/domain`): por barbeiro, para cada
  dia da semana (0=domingo..6=sábado), zero ou mais janelas de horário LOCAL.
  Invariantes: formato `HH:mm`, `inicio < fim`, sem sobreposição no mesmo dia.
- **Materialização** (`MaterializarExpedienteUseCase`): gera `Disponibilidade` dos
  próximos ~45 dias a partir do expediente. Roda via **job diário** (cron 4h,
  `MaterializarExpedienteJob`) e **imediatamente** ao salvar o expediente
  (`DefinirExpedienteUseCase`). Regra de conflito: um dia com QUALQUER
  disponibilidade de origem `MANUAL` **nunca** é tocado pela materialização — o
  expediente é o gerador, o dia é a exceção, exceção sempre vence padrão.
- `Disponibilidade` ganhou `origem: EXPEDIENTE | MANUAL` (migration com default
  `MANUAL` — linhas existentes tratadas como edição manual, sem retrofit).
- **Admin UI** (`Ajustes → Expediente semanal`): edição por barbeiro, toggle
  atende/fechado por dia, "aplicar horário aos dias marcados" (edição em lote),
  salva e materializa na hora.
- **Endpoints:** `GET/PUT /expediente/:barbeiroId`.
- **Seed corrigido:** Gabriel, Lucas Andrade e Pedro Martins agora seg-sáb, domingo
  **sem expediente** (fechado). Confirmado via SQL direto: 0 registros de
  disponibilidade aos domingos, 26 dias úteis em 30 dias corridos.

### 2. Atendimento pago online não pede forma de pagamento

- Novo valor de enum `FormaPagamento.PIX_ONLINE`, distinto do `PIX` presencial.
- `ConcluirAtendimentoUseCase` consulta a `IntencaoDePagamento` vinculada ao
  atendimento (`IntencaoDePagamentoRepository.porReferenciaAtendimento`, novo
  método); se está **PAGA** e não sobrou valor adicional, chama
  `atendimento.concluir(PIX_ONLINE)` automaticamente — o domínio não sabe de
  `IntencaoDePagamento` (§2.2, agregados não se chamam), quem decide é a aplicação.
- **Admin UI:** badge "Pago online" no card da agenda (visível mesmo antes de
  concluir, via `AtendimentoDTO.pagoOnline`) e no diálogo de conclusão, que pula a
  pergunta de forma de pagamento quando não há adicional.

### 3. Adicionar serviço/produto na conclusão (walk-in add-on)

- `Atendimento.adicionarItem(servicoId, ...)` e `.adicionarProduto(produtoId,
  quantidade, ...)`: permitem registrar, **antes de concluir**, um serviço ou
  produto que o cliente pediu na cadeira além do agendado. Só com `AGENDADO`.
  
- **Decisão consciente documentada em DOMAIN.md §3.5:** NÃO revalidam
  sobreposição de horário — o `intervalo` não muda; a invariante de sobreposição
  protege agendamentos *futuros*, não o registro retroativo de um atendimento em
  curso.
- **Regra de forma de pagamento generalizada:** deixou de depender só de `origem`
  e passou a depender do que há de fato pra cobrar (`algum item com
  itemDoPacoteId===null` OU `produtos.length>0`). Isso fecha uma lacuna real: antes,
  um item avulso adicionado a um atendimento `CREDITO_PACOTE` **não seria cobrado**
  (o domínio zerava `formaPagamento` só por olhar `origem`). Testado explicitamente.
- Pago-online + item/produto adicionado: a conclusão pede forma de pagamento **só
  do adicional** — a UI mostra "R$X já pago online + R$Y a cobrar agora".
- Comissão flui pelo caminho existente: o evento final `AtendimentoConcluido`
  carrega os itens/produtos completos, então `OnAtendimentoConcluidoHandler`
  (generalizado) gera lançamento pra cada um, sem duplicar lógica.
- **Endpoints:** `POST /atendimentos/:id/itens`, `POST /atendimentos/:id/produtos`.
- **Admin UI:** seção "Adicionar à conta" no diálogo de conclusão (serviço + produto
  com quantidade), habilitada só enquanto `AGENDADO`.

### 4. Produtos (mínimo viável, SEM estoque)

- **`Produto`** (novo agregado, `products/domain`): id, nome, preço, ativo —
  soft-disable como `Servico`. **Sem** quantidade/fornecedor/estoque (decisão
  consciente, DECISOES_PENDENTES #13).
- Venda em dois lugares, nunca uma terceira forma: (a) anexada a um Atendimento na
  conclusão (`ItemProdutoAtendido`, item 3 acima) ou (b) **venda avulsa**
  (`VendaDeProduto`, novo agregado — "alguém entrou só pra comprar": produto(s),
  barbeiro que vendeu, forma de pagamento, cliente **opcional**).
- **Comissão de produto:** novo campo `Barbeiro.comissaoProdutos` — percentual
  **único** para todos os produtos, sem matriz por produto (decisão consciente: a
  matriz por serviço existe por margem de mão de obra distinta; produto é revenda).
- **Ledger generalizado** (`LancamentoComissao`, §3.7): ganhou `origem` (`SERVICO`
  \| `PRODUTO`), `produtoId`, `vendaDeProdutoId`; `atendimentoId`/`servicoId`
  viraram opcionais via migration **aditiva** (`DROP NOT NULL` + novas colunas com
  default) — lançamentos existentes preservados, testado explicitamente
  (`produtos.e2e.spec.ts`: insere um lançamento no formato pré-migration e confirma
  que o extrato continua lendo corretamente).
- **Admin UI:** CRUD de produtos em `Ajustes`; botão "+ Venda de produto" na Agenda
  abrindo um diálogo simples; extrato de comissão distingue origem (badge
  "Produto") e mostra o nome certo (produto ou serviço).
- **Endpoints:** `GET/POST /produtos`, `PATCH /produtos/:id`, `GET/POST
  /vendas-produto`.

### Testes e verificação

**16 testes de integração novos**, em 3 arquivos:
- `expediente.e2e.spec.ts` (4): dia sem janela não gera slots públicos; edição
  manual sobrevive à rematerialização (via `MaterializarExpedienteUseCase`
  chamado diretamente no teste).
- `conclusao-avancada.e2e.spec.ts` (7): presencial continua exigindo forma de
  pagamento; pago-online sem adicional conclui com `PIX_ONLINE` automático; badge
  `pagoOnline` visível antes de concluir; adicionar serviço gera comissão correta;
  pago-online + adicional pede pagamento só do adicional; adicionar produto usa
  `comissaoProdutos`; não é possível adicionar após concluído.
- `produtos.e2e.spec.ts` (5): CRUD; venda avulsa gera comissão com origem
  distinta no extrato (incl. teste de **idempotência** do handler, reprocessar o
  mesmo evento não duplica); cliente opcional; produto inativo não pode ser
  vendido; **migration preserva lançamento pré-existente** (inserido direto via
  Prisma no formato antigo, lido corretamente pelo extrato).

**229 testes totais** (166 domínio/unit + 63 integração), suíte inteira idêntica
sob `TZ=UTC`, `TZ=America/Sao_Paulo`, `TZ=Asia/Tokyo` (`npm run test:multitz`).
Build dos 5 pacotes (contracts/api/admin/booking/account) verde. Smoke test manual
via HTTP real contra Postgres real: login → expediente (domingo 0 janelas
confirmado por SQL) → produtos → venda avulsa → extrato de comissão mostrando o
**snapshot correto do percentual** (venda antiga preserva o percentual antigo
mesmo depois do cadastro do barbeiro mudar — ledger imutável funcionando).

## Como rodar localmente

```bash
# 1. Dependências
npm install

# 2. Banco (Postgres 16 em localhost:5432, user/senha/db = bigods)
docker-compose up -d

# 3. Variáveis (o repositório já tem .env; ou copie o exemplo)
cp .env.example .env   # DATABASE_URL + AUTH_SECRET

# 4. Migrations + client + seed
npm run db:migrate -w @bigods/api    # aplica migrations (inclui EXCLUDE gist)
npm run db:generate -w @bigods/api   # gera o Prisma Client
npm run db:seed -w @bigods/api       # Company, Gabriel, serviços, pacote exemplo

# (se DATABASE_URL não estiver no ambiente, prefixe os comandos acima com:
#  DATABASE_URL="postgresql://bigods:bigods@localhost:5432/bigods")

# 5. Build + testes
npm run build
npm run test                          # 160 testes (integração/e2e exigem o banco no ar)
npm run test:multitz -w @bigods/api   # a suíte inteira em TZ=UTC/America/Sao_Paulo/Asia/Tokyo

# 6. API (porta 3000)
npm run dev -w @bigods/api           # ou: node apps/api/dist/main.js

# 7. Painel admin (porta 5173, proxy /api → :3000)
npm run dev -w @bigods/admin
# → http://localhost:5173 — senha de todos os logins: bigods123
#   gabriel       (admin + barbeiro, 45%, 9h–18h)
#   lkt           (admin puro, não atende)
#   rafaelgrigio  (admin puro, não atende)
#   barbeiros fictícios sem login próprio (só aparecem na agenda/comissão):
#     Lucas Andrade (40%, 12h–20h) · Pedro Martins (35%, barba 60%, 9h–13h)

# 8. Funil público de agendamento (porta 5174, proxy /api → :3000)
npm run dev -w @bigods/booking
# → http://localhost:5174 — sem login. Marque um horário; ele aparece na agenda
#   do painel admin (passo 7) no mesmo dia. Pagamento é presencial (na conclusão).
#   Tenant: VITE_COMPANY_ID (default "bigods").

# Webhook fake de pagamento (confirmar um PIX gerado):
# curl -X POST localhost:3000/webhooks/abacatepay -H 'Content-Type: application/json' \
#   -d '{"event":"billing.paid","data":{"metadata":{"externalId":"<externalId da intenção>"}}}'

# Login OTP do cliente (modo demo — o código volta na resposta, sem SMS):
# 1) admin vende um pacote pro telefone (provisiona o usuário)
# 2) curl -X POST localhost:3000/conta/login/iniciar -H 'Content-Type: application/json' \
#      -d '{"companyId":"bigods","telefone":"11 98888-7777"}'   # → { desafio, codigoDemo }
# 3) curl -X POST localhost:3000/conta/login/confirmar -H 'Content-Type: application/json' \
#      -d '{"companyId":"bigods","telefone":"11 98888-7777","codigo":"<codigoDemo>","desafio":"<desafio>"}'
#    → { token }  (usar como Bearer em GET /conta/perfil)
# Produção: IDENTITY_PROVIDER=cognito + vars do Cognito (ver .env.example e infra/cognito-triggers/).
```

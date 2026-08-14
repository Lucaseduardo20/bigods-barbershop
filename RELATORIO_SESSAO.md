# Relatório da Sessão — Bigod's Barber v2

Sessão original (2026-07-14): todas as 4 fases concluídas, 84 testes verdes.
Sessão de correção de fuso horário (2026-07-14, continuação): ver seção
dedicada abaixo. **100 testes verdes** (91 de domínio puro + 9 de integração
com Postgres), idênticos sob `TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo`.

Sessão mais recente (2026-07-16, "expediente + PIX_ONLINE + produtos" — ver
seção dedicada perto do fim deste arquivo): **229 testes verdes**, idênticos
sob os mesmos 3 fusos.

Sessão de correção de bugs de smoke test (2026-07-20 — ver seção dedicada perto
do fim deste arquivo): 8 bugs corrigidos, cada um com teste que reproduziu o
problema antes da correção. Suítes novas de testes puros em `apps/booking`,
`apps/account` e `apps/admin` (13 testes) para lógica de frontend que antes não
tinha nenhuma cobertura.

Sessão de correção do teste de expediente (2026-07-20, continuação — ver seção
dedicada perto do fim deste arquivo): a falha pré-existente mencionada acima
foi diagnosticada (causa C: teste mal dimensionado no tempo, não bug de
produção) e corrigida. **233 testes verdes no backend, 100%**, idênticos sob
`TZ=UTC`, `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo` (`npm run test:multitz`).

Sessão-E (2026-07-31, "autonomia do cliente no cockpit" — ver seção dedicada
perto do fim deste arquivo): 5 fases (histórico/detalhe, cancelar, reagendar,
abater saldo residual em avulso, reembolso manual), cada uma fechada com a
suíte verde antes de avançar para a próxima. **328 testes verdes no backend**
(21 novos e2e num arquivo dedicado, 33 de domínio de `VendaDePacote`, incluindo
7 novos de `reservarSaldoParaReembolso`/`confirmarReembolso`), idênticos sob os
3 fusos (`npm run test:multitz`). `turbo run build` verde nos 5 pacotes.

Sessão de lançamento (2026-07-31/2026-08-10, "OTP por WhatsApp + produção
presencial-only + deploy abstraído" — ver seções dedicadas perto do fim deste
arquivo): Cognito substituído por OTP via WhatsApp, novo serviço separado em
`services/whatsapp-otp/` (primeiro com `@open-wa/wa-automate`, depois trocado
por **Baileys** — sem Chrome, sem a trava de "só manda pra contato salvo" que
inviabilizava o open-wa gratuito, ver DECISOES_PENDENTES #23/#25), produção
confirmada subindo com `IDENTITY_PROVIDER=whatsapp` + `PAYMENT_GATEWAY=fake`,
sem nenhuma dependência de AWS, e testada de ponta a ponta com WhatsApp REAL
(QR escaneado, mensagem de OTP recebida de verdade). **344 testes verdes no
backend**, idênticos sob os 3 fusos. `turbo run build` verde. Deploy abstraído
num comando só (`scripts/deploy.sh local|staging|production` — ver `DEPLOY.md`).

Sessão de CRUD de usuários (2026-08-12, ver seção dedicada perto do fim deste
arquivo): admin agora cria/edita/desativa barbeiro e/ou admin pelo painel, sem
mexer no banco à mão — inclui trava de segurança pra nunca ficar sem admin
ativo, soft-disable (nunca deleta) e permissão real no endpoint (não só
escondida na UI). **369 testes verdes no backend**, idênticos sob os 3 fusos.
`turbo run build` verde nos 5 pacotes.

Sessão de vale/pagamento (2026-08-13, ver seção dedicada perto do fim deste
arquivo): `LancamentoComissao` virou um ledger de **3 direções** (COMISSAO +,
VALE −, PAGAMENTO −) — vale segue solicitação→aprovação→pagamento (débito só
nasce quando pago de fato), pagamento é livre e sem trava de saldo (saldo pode
ficar negativo, decisão do dono), e ganhou uma visão de gestão (Fechamento)
que separa claramente acumulado histórico de movimento do período. Item que
estava explicitamente fora de escopo (DOMAIN.md §11) entrou por necessidade
real da operação. **415 testes verdes no backend**, idênticos sob os 3 fusos.
`turbo run build` verde nos 5 pacotes.

Sessão de ligação do pagamento online (2026-08-13, "acordar o AbacatePay em
SANDBOX" — ver seção dedicada perto do fim deste arquivo): o gateway real
(Checkout Transparente **v2**, não v1/hospedado como presumido em sessões
anteriores) foi corrigido ponta a ponta contra a documentação oficial da
AbacatePay — endpoint, payload, e principalmente a verificação de assinatura do
webhook, que usava um esquema inteiramente diferente do real (chave pública
fixa + query secret em AND, não o nosso secret sozinho em hex). Política do
funil aplicada: pacote força pagamento online, avulso mantém a escolha.
Expiração de PIX não pago passou a ser detectada por timeout local (a
AbacatePay não emite webhook nenhum pra isso). **Desvio deliberado e reportado**
da instrução original sobre `transparent.lost` — ver DECISOES_PENDENTES.md #27.
**428 testes verdes no backend**, idênticos sob os 3 fusos (`npm run
test:multitz`). `turbo run build` verde nos 5 pacotes.

Sessão de OTP+reserva (2026-08-13, "agenda falsa + buraco na agenda +
enxurrada de presenciais" — ver seção dedicada perto do fim deste arquivo):
três problemas do funil anônimo, três travas distintas. OTP obrigatório na
confirmação do agendamento/compra pra quem não tem sessão (reusa o mecanismo
de login do cockpit, zero OTP novo construído); avulso online passou a nascer
`RESERVADO` (novo estado, temporário) em vez de `AGENDADO` firme, expira
sozinho em 10 min sem pagamento e libera o horário; cota de 3 presenciais
futuros ativos por cliente, só no canal de auto-atendimento (não vale pro
admin). **Dois desvios/decisões próprias reportados com destaque**: a janela
de pagamento do pacote encolheu de 1h pra 10min (DECISOES_PENDENTES.md #28) e
a cota de presenciais não se aplica ao admin/reagendar (DECISOES_PENDENTES.md
#29). **456 testes verdes no backend**, idênticos sob os 3 fusos. `turbo run
build` verde nos 5 pacotes.

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

## Correção de bugs de smoke test manual (sessão 2026-07-20) ✅

Sessão de correção pura — sem features novas, sem mexer em preço-por-barbeiro,
catálogo de pacotes ou cancelar/reagendar pelo cliente (sessões B/C separadas).
Para cada bug: teste que reproduz o problema primeiro, depois a correção.

### Bug 1 — OTP duplo pós-compra e loop de repagamento (crítico)

Dois defeitos distintos no mesmo fluxo:

- **Loop de repagamento**: `apps/booking` persistia o `FunnelState` inteiro em
  `sessionStorage`, mas `concluido`/`pago` viviam em `useState` separado, nunca
  persistido. Um refresh depois de pagar restaurava `step: CONFIRMACAO` com os
  dados antigos (`ofertaId`, `formaPagamento`...) e o cliente caía de novo na
  tela de pagamento de um pacote **já PAGO**, podendo comprar em dobro.
  Correção: `concluido` passou a ser campo do próprio `FunnelState` persistido;
  `sanitizarEstadoCarregado()` (função pura, `funnel-state.ts`) descarta o
  estado salvo e volta para `LANDING` sempre que `concluido: true` — uma compra
  concluída nunca mais é resumida no meio do funil.
- **Segundo OTP**: o onboarding pós-compra (`Onboarding.tsx`, booking) já
  confirmava o código e ganhava um token de sessão real, mas só linkava para
  `ACCOUNT_URL` sem repassar nada — a área do cliente (origem diferente, sem
  acesso ao `localStorage` de lá) não tinha sessão e pedia OTP de novo.
  Correção: `linkDeContaComSessao()` (booking) embute token+cliente na
  querystring do link; `sessaoDaQuery()` (account, `session.ts`) lê e
  estabelece a sessão no primeiro carregamento, limpando a URL depois — um
  único OTP já deixa a conta logada.
- Testes novos (pure functions, sem harness de render): `funnel-state.spec.ts`,
  `handoff.spec.ts` (booking), `session.spec.ts` (account).

### Bug 2 — telefone sem conta ficava preso no OTP sem feedback

Login OTP só provisionava identidade (Cognito/`DemoIdentidade`) na compra de um
pacote (`OnPacoteVendidoHandler`) — um telefone que só agendou avulso, ou nunca
comprou nada, recebia `desafio=''` (código nenhum) e ficava preso digitando um
código que nunca existiu, sem nunca saber por quê.

Correção: `IniciarLoginClienteUseCase` agora chama
`identity.provisionarUsuario(...)` (idempotente nos dois providers) **antes**
de iniciar o desafio — qualquer telefone recebe um código de verdade; a
neutralidade (não revelar existência de conta) continua garantida porque a
resposta do "iniciar" é sempre a mesma forma. `ConfirmarLoginClienteUseCase`
não barra mais com 401 quando não há `Cliente` — cria a conta na hora, já que o
código provou posse do telefone; a área logada mostra a home vazia normal
("sem pacotes, agende seu primeiro horário", tela que já existia). `// DECISAO_PENDENTE`
sobre o nome placeholder (`'Cliente'`) enquanto não existe edição de perfil —
ver DECISOES_PENDENTES.md #16.

Teste: `conta-cliente.e2e.spec.ts` — telefone nunca usado recebe código real;
confirmar cria `Cliente` e devolve perfil vazio (não erro/loop).

### Bug 3 — mensagem crua de conflito de horário

`Conflito de horário: barbeiro já tem atendimento <uuid> sobreposto` chegava
verbatim à tela do cliente (o `DomainErrorFilter` reenviava `exception.message`
sem filtro). Correção: novo subtipo `ConflitoDeHorarioError extends
InvarianteVioladaError` (mensagem técnica preservada para o domínio/logs); o
filtro mapeia esse tipo para uma mensagem amigável ("Esse horário acabou de ser
preenchido. Escolha outro, por favor.") e loga o detalhe técnico via `Logger`,
nunca expondo UUID/jargão na resposta HTTP.

No frontend (`apps/booking`): `voltar()` limpa `erroEnvio` — o erro de uma
tentativa não fica mais grudado ao refazer o fluxo com outro horário. Novo
componente `AlertaErro` (alerta visível, não uma div solta) usado tanto no
conflito quanto na validação de telefone incompleto em `Dados.tsx` (antes só
desabilitava o botão sem explicar por quê).

Teste: `booking-publico.e2e.spec.ts` — resposta do conflito não contém UUID
nem "sobreposto", é a mensagem amigável exata.

### Bug 4 — comissão não carregava com o primeiro barbeiro do select

`Comissao.tsx` inicializava `barbeiroId` com `usuario.barbeiroId` (que pode não
bater com nenhum barbeiro da lista, ex.: admin puro) — o `<select>` renderizava
visualmente o primeiro item (comportamento padrão do DOM quando o `value`
controlado não casa com nenhuma `<option>`), mas o fetch continuava usando o
valor antigo/inválido, só corrigindo ao trocar manualmente. Correção: função
pura `idEfetivo()` (`apps/admin/src/lib/selecao.ts`) cai no primeiro item da
lista carregada quando o valor atual é nulo ou não existe mais — usada tanto no
`value` do select quanto na chave do fetch.

Teste: `selecao.spec.ts` (admin).

### Bug 5 — add-on em atendimento de crédito não mostrava o valor a cobrar

No diálogo de conclusão (`AtendimentoDetalheDialog.tsx`), o rótulo "forma de
pagamento" só mostrava o valor a cobrar quando `a.pagoOnline` era verdadeiro —
um serviço avulso adicionado a um atendimento de **crédito de pacote** (nunca
pago online) passava a exigir forma de pagamento (correto) mas sem dizer
quanto. Como `valorAdicional = valorTotal - valorPagoOnlineCentavos` já era
calculado corretamente para os dois casos (0 quando não é pago online), a
correção foi só remover a condição — o rótulo sempre mostra "(R$X a cobrar
agora)".

Teste: `conclusao-avancada.e2e.spec.ts` — asserta `valorPagoOnlineCentavos`
zerado e `valorTotal - valorPagoOnlineCentavos` igual ao total cheio quando não
há pagamento online.

### Bug 6 — prazo de segunda chance mostrava 11 dias em vez de 10

`diasRestantes()` (cockpit) fazia `Math.ceil((prazoMs - agoraMs) / 86400000)`.
Como `prazoReagendamentoAte` é sempre **fim do dia civil** N
(`fimDoDiaCivilMaisDias`, já testado) e "agora" é tipicamente meio do dia, a
diferença bruta em ms é quase N+1 dias — o `ceil` arredondava para cima.
Correção: `diasCivisRestantes()` (`apps/account/src/lib/format.ts`) compara
**datas civis** (hoje vs. dia civil do prazo, no fuso da empresa), não
milissegundos brutos — um prazo de 10 dias mostra 10 do início ao fim do dia de
hoje, nunca 11.

Teste: `format.spec.ts` — prazo de 10 dias consultado às 14h mostra 10 (o
cálculo antigo, verificado manualmente, dava 11 no mesmo cenário); mostra 0 no
último dia; nunca negativo.

### Bug 7 — mensagens com gênero/plural errados no cockpit

(a) "sua corte" / "você perde a corte" concordava sempre no feminino, mas o
nome do serviço é texto livre cadastrado pelo admin (ex.: "Corte" é
masculino) — não há gênero gramatical modelado no domínio, e não dá pra
adivinhar. Correção: reescrita para usar "o horário de {serviço}" como núcleo
da frase (sempre masculino, invariante a qualquer nome de serviço) — sem
inventar heurística de gênero nenhuma.
(b) saldo residual de múltiplos itens expirados sempre dizia "um serviço
perdeu o prazo", mesmo com 2+ itens. Correção: conta real de itens
`EXPIRADO` do pacote, pluralização correta ("2 serviços perderam o prazo").

Ambas extraídas para funções puras (`apps/account/src/lib/textos.ts`):
`fraseSegundaChance()` e `fraseSaldoResidual()`.

Teste: `textos.spec.ts`.

### Bug 8 — admin não conseguia confirmar pagamento presencial de pacote

Pacote comprado como "pagar na barbearia" ficava `AGUARDANDO` para sempre — não
havia nenhuma ação no admin para o barbeiro/admin confirmar o recebimento e
liberar os créditos (só existia "marcar como pago" ao **criar** uma venda
nova). Correção: novo `ConfirmarPagamentoPresencialUseCase` reusa o **mesmo**
caminho idempotente do webhook (`IntencaoDePagamento.confirmarPagamento()` +
`VendaDePacote.confirmarPagamento()`, ambos já testados) — só troca o gatilho
(admin em vez do gateway). Novo endpoint `POST /pacotes/:id/confirmar-pagamento`;
novo método `porReferenciaVendaDePacote` no repositório de intenções (mesmo
padrão de `porReferenciaAtendimento`, já existente). Admin: botão "Confirmar
pagamento presencial" ao lado do badge `AGUARDANDO` em `Pacotes.tsx`.

Teste: `conta-cliente.e2e.spec.ts` — venda presencial fica `AGUARDANDO`;
confirmar libera os créditos; confirmar de novo é idempotente (`processado:
false`); venda inexistente → 404.

### Verificação

**232 testes no backend** (231 passam; 1 falha pré-existente e **fora de
escopo** — `expediente.e2e.spec.ts`, "edição manual sobrevive à
rematerialização" — confirmado via `git stash` que já falhava antes desta
sessão, em qualquer um dos 3 fusos; não é um dos 8 bugs pedidos e não foi
tocado nesta sessão). Suíte inteira idêntica sob `TZ=UTC`, `TZ=America/Sao_Paulo`,
`TZ=Asia/Tokyo`. Novas suítes de teste puro (sem harness de render, só lógica
extraída para funções testáveis) nos 3 frontends, que antes não tinham nenhum
teste configurado: `apps/booking` (3 testes), `apps/account` (10 testes),
`apps/admin` (4 testes) — `vitest.config.ts` + `"test": "vitest run"`
adicionados aos 3 `package.json`. Build dos 5 pacotes (`turbo run build`)
verde.

**Atualização (mesma data, sessão seguinte):** a falha pré-existente acima foi
diagnosticada e corrigida — ver "Correção do teste de expediente" logo abaixo.
A suíte do backend está 100% verde agora (233/233).

## Correção do teste de expediente (sessão 2026-07-20, continuação) ✅

Objetivo único desta sessão: `expediente.e2e.spec.ts` → "edição manual de um
dia sobrevive à rematerialização" 100% verde, com diagnóstico explícito da
causa raiz antes de qualquer correção. Nada além disso foi tocado (preço por
barbeiro, catálogo de pacote e aprovação ficam para a próxima sessão).

### Diagnóstico

A falha era sempre na mesma linha (`expect(horarios.body.horarios.length).toBeGreaterThan(0)`),
**nunca** nas asserções anteriores que verificam a disponibilidade manual no
banco (`toHaveLength(1)`, `origem === 'MANUAL'`) — isso já isolava a causa
antes de qualquer suposição:

- **Causa (A) descartada**: a disponibilidade manual estava intacta no banco
  depois da rematerialização (asserções de banco passavam). A regra "dia com
  origem MANUAL nunca é tocado" (`MaterializarExpedienteUseCase.materializarUmDia`)
  funciona corretamente.
- **Causa (B) descartada**: a projeção pública (`HorariosDisponiveisQueryService`)
  não filtra por `origem` nenhuma — lê toda `Disponibilidade` do
  barbeiro/dia, sem distinção MANUAL/EXPEDIENTE.
- **Causa raiz = (C), mas não a hipótese literal do relato** (não era duração
  do serviço — 07:00-08:00 comporta um corte de 30min sem ambiguidade). O
  problema real: o helper `proximaSegundaEDomingo()` do teste começava a busca
  em `d=0` (hoje incluso) — se a suíte rodasse numa segunda-feira, "próxima
  segunda" resolvia para **hoje**. A projeção pública tem um filtro
  intencional e correto (`slotInicio <= agora.getTime()) continue` — "não
  oferecer horário passado"), e uma janela manual fixa de 07:00-08:00
  criada num dia que já é hoje fica inteiramente no passado assim que a
  suíte roda depois das 08:00. Confirmado: **hoje (2026-07-20) é
  segunda-feira**; a suíte estava rodando às 16h, muito depois das 08:00. O
  teste anterior no mesmo arquivo ("dia com janela gera slots públicos") usa
  o expediente 09:00-18:00 do mesmo dia e só não quebrava porque 18:00 ainda
  não tinha passado — o mesmo tipo de fragilidade, só que com margem maior.
  **Não é um bug de produção**: o filtro de horário passado é comportamento
  correto e desejado (não faz sentido oferecer um agendamento no passado).

### Correção

Nenhuma mudança em código de produção (era causa C — só o teste estava mal
dimensionado no tempo, não em duração). Correção no teste:

- `proximaSegundaEDomingo()` agora começa em `d=1` (nunca "hoje") — garante um
  dia **inteiramente futuro**, então nenhuma janela fixa de horário pode ser
  filtrada por já ter passado, não importa a hora do dia em que a suíte roda.
  Isso também blinda o teste "dia com janela gera slots públicos" contra a
  mesma fragilidade (ele não estava quebrado, mas tinha o mesmo risco latente).
- Teste "edição manual sobrevive à rematerialização" reescrito com:
  - janela manual folgada e sem ambiguidade: **06:00-08:00** (2h, bem longe do
    expediente 09:00-18:00 do mesmo dia — cenário real: barbeiro abre mais
    cedo num dia excepcional).
  - asserções separadas e específicas: (a) a disponibilidade manual continua
    no banco, `origem: 'MANUAL'`, com `inicio`/`fim` batendo **exatamente**
    com o instante esperado (antes a asserção só checava
    `inicio !== fim`, que seria verdade mesmo se a janela tivesse sido
    silenciosamente trocada por outra); (b) a projeção pública devolve slots,
    todos dentro de 06:00-08:00, e nenhum a partir de 09:00 (nunca do
    expediente padrão).
- Novo teste, caso inverso: **dia sem edição manual é rematerializado
  normalmente quando o expediente muda** — muda só terça-feira (10:00-14:00,
  mantendo seg/qua/qui/sex em 09-18) via `PUT /expediente`, confirma que a
  disponibilidade de terça reflete o novo horário (`origem: 'EXPEDIENTE'`,
  instantes exatos) **e** que a edição manual de segunda-feira (teste
  anterior) permanece intacta depois dessa rematerialização em massa — prova
  que a proteção de dias MANUAL não virou "a materialização nunca atualiza
  nada".

### Janela deslizante de materialização (confirmado, sem alteração)

`MaterializarExpedienteJob` roda diariamente (cron `EVERY_DAY_AT_4AM`,
`America/Sao_Paulo`) e chama `MaterializarExpedienteUseCase.executar({companyId})`
**sem** fixar `hoje` — o use case usa `input.hoje ?? new Date()` como base e
materializa `hoje..hoje+45`. Como o job roda todo dia com "hoje" real (nunca
fixo), a janela de fato desliza: a cada execução diária o horizonte avança um
dia (o dia 46 de ontem vira o dia 45 de hoje). Não havia bug aqui — comportamento
já estava correto, só confirmado por leitura de código (nenhum teste dedicado
a isso existia antes; não foi adicionado um agora por ser comportamento de
orquestração de cron, non-determinístico de testar sem mockar `Date`, e fora
do escopo estrito desta sessão — se quiser cobertura disso, é candidato pra
próxima sessão, não uma pendência aberta pela raiz do bug encontrado aqui).

### Verificação

`npm run test` (28 arquivos, **233/233 testes**) e `npm run test:multitz`
(`TZ=UTC`/`America/Sao_Paulo`/`Asia/Tokyo`) **100% verdes**, zero falhas. Build
dos 5 pacotes (`turbo run build`) verde.

## PacoteOferta como agregado + preço por barbeiro + aprovação + funil reordenado (sessão-B, 2026-07-20/21) ✅

Sessão estrutural em 5 fases, mexendo em precificação e rateio de pacote
(dinheiro) — prioridade absoluta era não corromper o que já funcionava
(233/233 no início). Suíte mantida verde ao fim de cada fase (254 → 262 → 276
→ 291) e 291/291 confirmado no fechamento em `npm run test`,
`npm run test:multitz` (UTC/América-São Paulo/Ásia-Tóquio) e `turbo run build`
dos 5 pacotes.

### Fase 1 — `PacoteOferta` vira domínio de primeira classe

Era um read-model semeado direto no banco; virou agregado próprio
(`pacote-oferta.aggregate.ts`) com invariantes reais: preço > 0, ≥1 item da
composição, quantidade > 0 por item, barbeiro dono atende todos os serviços
da composição, preço ≤ soma dos avulsos (nunca desconto negativo). Composição
é **mista** — lista de `{servicoId, quantidade}`, suporta pacotes tipo "2
cortes + 2 barbas", não só um serviço repetido.

**Regra central de precificação:** o preço em centavos é sempre o que
**persiste**; o percentual de desconto é sempre **derivado** na exibição
(`percentualDeEconomia(somaAvulsos, precoPacote)`), nunca fonte de verdade —
documentado em DOMAIN.md §3.11 com o motivo explícito: se o percentual fosse
persistido, mudar o preço de referência no futuro mudaria silenciosamente o
preço do pacote já vendido. Admin pode digitar por % ou por R$ (dois modos de
entrada no mesmo formulário, com preview ao vivo), mas o que grava é sempre o
preço.

Funil público (`Pacote.tsx`) agora mostra a economia lado a lado: preço do
pacote, quanto custaria avulso, economia em R$ e % (ex: "R$160 · em vez de
R$200 · economize R$40 (20%)").

CRUD completo no admin (`Ajustes.tsx` → `OfertasDePacote`/`OfertaDialog`).
Venda continua passando pelo rateio existente (§3.6), não reescrito.

### Fase 2 — Preço por barbeiro (parte mais sensível)

`Servico.precoAvulso` virou preço de **referência da casa**; cada barbeiro
pode ter override por serviço (`ExcecaoPreco`, mesmo padrão de
`comissaoPadrao` + exceções já existente). `precoPara(servico, barbeiro) =
override ?? referência`, centralizado em `precificacao-pacote.ts`.

Rateio de pacote passa a usar o preço **do barbeiro vigente na venda**.
Snapshots já congelados (`valorRateado`, `valorCobrado`, `percentualAplicado`)
não podem mudar retroativamente — coberto pelo teste obrigatório
(`preco-por-barbeiro.e2e.spec.ts`): cria venda, conclui atendimento (gera
comissão), muda o preço do barbeiro, confirma via `.toEqual()` que a venda e o
lançamento de comissão antigos continuam **byte a byte idênticos**.

`VendaDePacote` ganha `barbeiroId`; crédito só pode ser consumido com o
barbeiro dono (`agendarItem` recusa outro barbeiro com
`InvarianteVioladaError`). Resgate cruzado entre barbeiros ficou
explicitamente fora desta sessão — ver DECISOES_PENDENTES.md #19.

**Decisão registrada, não implementada:** `precoPara` não foi estendido ao
agendamento avulso direto (`Atendimento`) — só o rateio de pacote foi pedido.
Ver DECISOES_PENDENTES.md #18.

### Fase 3 — Workflow de aprovação de `PacoteOferta`

Estados: `RASCUNHO → PENDENTE_APROVACAO → APROVADO | REJEITADO`. Barbeiro
cria/edita → `PENDENTE_APROVACAO`; admin aprova ou rejeita (com motivo).
Editar um pacote `APROVADO` volta pra `PENDENTE_APROVACAO`. Só `APROVADO`
aparece no funil público (filtro em `pacote-ofertas-query.service.ts`). Admin
que também é barbeiro pode aprovar o próprio pacote (senão o fluxo trava com
o Gabriel, que é o único usuário real hoje). Painel de pendências no admin.

**Ambiguidade registrada:** o gatilho de criação de um `RASCUNHO` (vs. ir
direto pra `PENDENTE_APROVACAO`) não estava especificado — implementado o
mínimo (estado existe, transição `enviarParaAprovacao()` existe e testada),
sem inventar uma tela de "salvar rascunho". Ver DECISOES_PENDENTES.md #17.

### Fase 4 — Funil: barbeiro primeiro + link próprio

**4a:** Barbeiro passa a ser escolhido **antes** do serviço nas duas trilhas
(avulso e pacote) — necessário porque preço por barbeiro faz mostrar preço
antes de saber o barbeiro ser errado. Skip automático mantido quando só há um
barbeiro (`Barbeiro.tsx` auto-avança e não renderiza o seletor).

**4b:** Link pessoal por barbeiro via query string (`?barbeiro=slug`) —
escolhido em vez de rota (`/b/slug`) por não exigir React Router nem
configuração de SPA-fallback ainda não confirmada na hospedagem (decisão de
implementação, registrada em DECISOES_PENDENTES.md #20 quanto à unicidade do
slug ser só por empresa). Slug gerado no cadastro do barbeiro
(`slugDoNome`/`slugUnico`, normaliza acento), editável no admin. Entrar pelo
link pré-seleciona o barbeiro, pula a etapa de escolha, mostra "Agendando com
{nome}" no topo com saída discreta "ver outros profissionais". **Link sempre
vence estado salvo em sessionStorage** — `aplicarBarbeiroDoLink()` reseta o
funil inteiro (não faz merge) e isso é testado explicitamente
(`funnel-state.spec.ts`). Slug inválido/inexistente cai no funil normal, nunca
em erro 404 pro cliente (`GET /public/barbeiro-por-slug` retorna 404
internamente, o front trata como "sem link"). Admin mostra o link pronto de
cada barbeiro com botão de copiar (`LinksDeAgendamento`).

**4c:** `origemLinkBarbeiroId` registrado em `Atendimento` e `VendaDePacote`
quando o agendamento vem de um link de barbeiro — só registro, sem tela de
relatório (dado não recuperável retroativamente, não dá pra inventar métrica
agora).

### Fase 5 — `docs/DOMAIN.md` atualizado

§3.2/§3.2.1/§3.2.2 (preço por barbeiro e fronteira consciente com avulso),
§3.5/§3.6 (rateio usa preço do barbeiro), novo §3.11 (`PacoteOferta` como
agregado), novo §4.3 (máquina de estado de aprovação), §8.5 (nova ordem do
funil, link pessoal, `origemLink`), §11 (itens fora de escopo desta sessão:
resgate cruzado entre barbeiros, relatório de origem de link).

### Migrações aplicadas

`20260720195850_pacote_oferta_agregado`,
`20260720201500_preco_por_barbeiro`,
`20260720203000_aprovacao_pacote_oferta`,
`20260721000000_slug_barbeiro_origem_link` — todas com backfill (barbeiro
mais antigo da empresa como dono de ofertas/vendas pré-existentes; slug
gerado via `unaccent` + `ROW_NUMBER()` pra evitar colisão).

### O que precisa de smoke test manual

- Admin: criar oferta de pacote mista (2+ serviços diferentes), alternar entre
  entrada por % e por R$, confirmar preview de economia batendo antes de
  salvar.
- Admin: mudar preço de um barbeiro num serviço já usado numa venda antiga de
  pacote concluída — confirmar visualmente que a venda antiga na tela de
  cockpit/histórico não mudou de valor.
- Fluxo completo do link pessoal: abrir `/?barbeiro=<slug-do-gabriel>`,
  confirmar banner "Agendando com Gabriel", concluir um agendamento, e
  verificar no admin que a origem ficou registrada. Testar também "ver outros
  profissionais" a meio do funil.
- Barbeiro (usuário não-admin) criando e editando uma oferta de pacote — deve
  ir pra pendente, não pode aprovar a oferta de outro barbeiro, pode aprovar a
  própria se também for admin (caso do Gabriel).
- Slug inválido na URL (`/?barbeiro=xxxxx`) — confirmar que cai no funil
  normal sem tela de erro.

## Correção pós-smoke: preço por barbeiro ponta-a-ponta + 10 bugs (sessão-C) ✅

Sessão de correção pura, sem features novas. Contexto: a sessão-B passou
291/291 testes mas entregou o núcleo (preço por barbeiro) **quebrado** num
smoke test manual, porque os testes anteriores exercitavam `precoPara`
isolada no domínio, nunca o caminho real (funil público → rateio → avulso →
exibição no admin). Regra desta sessão: toda correção de bug de comportamento
teve teste no nível mais realista disponível (endpoint HTTP real quando
existe; função pura extraída da UI quando o bug é só de apresentação, sem
endpoint dedicado).

### BUG-RAIZ — preço por barbeiro não estava plugado nos caminhos reais

`precoDeReferencia(servico, barbeiro)` (override do barbeiro ?? referência
da casa) já existia e já era usada corretamente em **um** lugar (rateio de
`VendaDePacote` via `VenderPacoteUseCase`, e a composição/economia de
`PacoteOferta`). Faltava plugar em:

- **`GET /public/servicos`** — sempre devolvia `Servico.precoAvulso`
  (referência), ignorando o `barbeiroId` da query. Agora usa
  `precoDeReferencia` quando um barbeiro é informado.
- **`AgendarAvulsoUseCase`** (funil público E painel admin, que reusa o
  mesmo caso de uso) — `ItemAtendido.valorCobrado` usava sempre
  `servico.precoAvulso`.
- **`AdicionarItemAtendimentoUseCase`** (walk-in add-on na conclusão) — mesmo
  problema.

★ **Decisão de negócio confirmada pelo dono desta sessão:** preço por
barbeiro passa a valer **geral**, inclusive no agendamento avulso direto —
não só no rateio de pacote. Isso resolve `DECISOES_PENDENTES.md #18`
(estava documentado como fora de escopo na sessão-B; a decisão explícita
do dono nesta sessão reverte isso). `AgendarComCreditoUseCase` **não
precisou mudar** — já usava o valor rateado congelado na venda
(`item.valorRateado`), nunca recalculado do catálogo — snapshot, como deveria.

**Testes end-to-end (via HTTP real, banco real — não a função isolada)** em
`preco-por-barbeiro.e2e.spec.ts`, descrição "BUG-RAIZ (sessão-C)": dois
barbeiros com overrides diferentes para o mesmo serviço → `GET
/public/servicos` devolve preços diferentes; comprar a mesma composição de
oferta com os dois barbeiros → rateios diferentes, cada um batendo com
`round(valorPago × pesoDoBarbeiro / somaDoBarbeiro)`; agendar avulso pelo
funil público com barbeiro com override → cobra o override, não a
referência.

### Investigação: "invariante furada" (oferta aceitando serviço que o barbeiro não atende)

O relato do smoke dizia que uma oferta do Pedro Martins foi criada com um
serviço que ele não atende. **Reproduzido via curl contra o endpoint real
antes de qualquer mudança:** `POST /pacote-ofertas` com um serviço fora de
`barbeiro.servicosAtendidos` **já era rejeitado** com 422 e mensagem clara
("Barbeiro dono não atende o serviço ... da composição") — a invariante no
domínio (`PacoteOferta.validar`) está e sempre esteve correta neste código.

A causa mais provável do que o smoke viu: **não existia UI nenhuma** para
gerenciar quais serviços um barbeiro atende (só existia o endpoint `PUT
/barbeiros/:id/servicos`, sem tela) — então qualquer inconsistência nos
dados (ex.: seed antigo, ou dado herdado de uma migração) não tinha como
ser corrigida pelo admin, e a experiência de "criar oferta com serviço que
o barbeiro não deveria atender" podia acontecer se o cadastro de
`servicosAtendidos` já estivesse errado por outro motivo, não porque a
oferta burlou a validação. Corrigido:
- Nova tela **Ajustes → Serviços por barbeiro** (checkboxes, usa o endpoint
  que já existia).
- `OfertaDialog` (tela de oferta) agora **filtra** o seletor de serviço da
  composição pelos `servicosAtendidos` do barbeiro escolhido — evita o
  usuário montar uma composição que o backend vai recusar, mesmo que a
  validação de verdade continue sendo a do domínio.
- Regressão coberta em `preco-por-barbeiro.e2e.spec.ts`: criar serviço novo
  (que ninguém atende), tentar criar oferta pra um barbeiro existente com
  esse serviço → 422 via endpoint real, oferta não persiste.

### Outros bugs corrigidos

- **Mensagem de validação crua:** `composicao` vazia devolvia o texto
  técnico do class-validator ("composicao should not be empty") direto na
  tela — a mensagem amigável do domínio nunca era alcançada porque a
  validação do DTO roda antes, na borda. Adicionadas mensagens customizadas
  nos decorators (`ArrayNotEmpty`, `IsPositive` de quantidade/preço).
  Quantidade 0: o frontend já filtrava silenciosamente a linha antes de
  enviar — se sobrava composição vazia, caía no mesmo caso acima.
- **CRUD de preço de serviço no admin:** o backend já suportava editar
  `precoAvulsoCentavos` via `PATCH /servicos/:id`; só faltava o botão
  "Editar preço" na tela de Serviços (Ajustes). O override por barbeiro
  (`PrecosPorBarbeiro`) já existia desde a sessão-B — o motivo de "não dar
  pra testar" era o bug-raiz (o override existia mas não refletia em lugar
  nenhum), não a ausência da tela.
- **Workflow de aprovação pela metade:** só admin conseguia criar oferta —
  barbeiro não-admin não tinha tela nenhuma, o que tornava o fluxo
  "barbeiro propõe → admin aprova" sem sentido prático. `CatalogoDeOfertas`
  (nova localização, ver abaixo) agora é acessível a qualquer usuário
  logado: admin vê/gerencia o catálogo inteiro (painel de pendências,
  aprovar/rejeitar); barbeiro não-admin só vê e edita as PRÓPRIAS ofertas
  (mesma restrição de escopo já usada em agenda/comissão via
  `usuario.barbeiroId`), sempre nascendo como dono de si mesmo, sem
  aprovar/rejeitar (nem no backend: guard de dono-ou-admin). Endurecimento
  correlato: `PATCH /pacote-ofertas/:id/status` (ativo/inativo) não tinha
  NENHUMA checagem de autorização antes desta sessão — qualquer usuário
  logado podia desativar a oferta de qualquer barbeiro. Adicionado o mesmo
  guard `exigirDonoOuAdmin` que `criar`/`atualizar` já tinham.
- **Badge contraditório (Rejeitado + Ativo ao mesmo tempo):** `ativo` é uma
  flag independente de `statusAprovacao` no domínio (correto — soft-disable
  não é o mesmo conceito que aprovação) — mas só é *visível/relevante* de
  fato quando `APROVADO` (só oferta aprovada aparece no funil público). A
  tela agora só mostra o badge/toggle Ativo·Inativo quando
  `statusAprovacao === APROVADO`; para os outros estados, só o badge de
  aprovação aparece — um estado só por vez.
- **Tela branca no skip de barbeiro único:** com um único barbeiro na casa
  (caso mais comum, hoje só o Gabriel atende), o passo "Com quem?" pula
  sozinho — mas entre o barbeiro resolver e o passo seguinte (Serviços)
  buscar sua própria lista, havia uma janela sem NENHUM indicativo visual
  (nem loading, nem conteúdo). Corrigido: `Barbeiro.tsx` mostra `Loading`
  em vez de `null` durante o auto-avanço; `Servicos.tsx` passa a aceitar
  `carregando` do pai e mostra spinner em vez de lista vazia sem contexto.
- **BUG FINANCEIRO — add-on em crédito recobrava o item já pago:**
  `AtendimentoDetalheDialog` calculava "valor a cobrar agora" como
  `valorTotal - valorPagoOnline`, onde `valorTotal` soma TODOS os itens do
  atendimento — inclusive os com `itemDoPacoteId` preenchido, já cobertos
  pelo crédito do pacote. Um add-on (walk-in) num atendimento de crédito
  instruía o admin a cobrar o item original de novo, em cima do que o
  pacote já cobria. Extraído `lib/conclusao.ts`
  (`valorNaoCobertoPorCredito`/`valorACobrarNaConclusao`, mesmo critério de
  `exigeFormaPagamento` do domínio) e testado diretamente — é um bug de
  apresentação puro (o domínio nunca armazena "quanto cobrar", só a forma de
  pagamento; o valor exibido é o que orienta o que o barbeiro cobra em
  dinheiro/cartão de verdade).
- **UX — origem de link não aparecia no admin:** `origemLinkBarbeiroId`
  estava gravado no banco desde a sessão-B mas não saía em nenhum DTO.
  Adicionado `origemLinkBarbeiroNome` em `AtendimentoDTO`/`VendaDePacoteDTO`
  (resolvido via join com `Barbeiro`) e exibido no detalhe do atendimento e
  no card da venda de pacote ("via link de X" / "sem link de origem"). Sem
  tela de relatório/métrica — mesma decisão da sessão-B, só o dado visível.
- **UX — sem máscara de moeda:** campos de preço eram `<input>` de texto
  livre, fonte comum de erro de digitação com dinheiro. Novo componente
  `CurrencyInput` (`apps/admin/src/components/ui.tsx`) com máscara "por
  dígitos" (preenche da direita, sem depender de separador decimal digitado
  à mão — nunca ambíguo tipo "12,5"), aplicado em: criar/editar serviço,
  criar produto, overrides de preço por barbeiro, preço de oferta de pacote
  (modo R$), venda de pacote no admin.
- **UX — Pacotes duplicado:** "Ofertas de pacote" vivia dentro de Ajustes,
  mas já existia a aba "Pacotes" (vendidos) na navegação principal.
  Consolidado num `Tabs` dentro da aba Pacotes: "Vendidos" / "Catálogo de
  ofertas" — um lugar só, e a consolidação foi o que abriu espaço pra
  liberar o acesso do barbeiro não-admin (ver acima), já que Ajustes é
  visível só pra admin e Pacotes não.

### Investigação E.7 — "caí logado numa conta que já estava logada"

**Confirmado como (a): vazamento real de sessão entre clientes distintos —
bug de segurança, corrigido.** Causa raiz em `apps/account/src/App.tsx`: a
sessão inicial era resolvida como `carregarSessao() ?? sessaoDaQuery(...)`
— ou seja, uma sessão JÁ SALVA no navegador (localStorage) tinha
precedência sobre o handoff da URL (a prova fresca de identidade que
acabou de confirmar o OTP na compra). Num dispositivo compartilhado —
tablet da barbearia usado pra fechar a compra, celular do
barbeiro emprestado pro cliente "criar acesso" na hora — se um cliente A
já tinha sessão salva ali, o cliente B, que acabou de comprar e clicou no
link de handoff, caía DIRETO na conta de A: nome, telefone, pacotes e
créditos de outra pessoa visíveis.

Corrigido invertendo a precedência (`resolverSessaoInicial`): o handoff da
URL sempre vence a sessão salva, nunca o contrário — mesmo princípio já
usado no link pessoal de barbeiro do funil de agendamento ("prova nova
sempre vence estado salvo"). Testado em `session.spec.ts`: sessão de um
cliente A já salva + handoff de um cliente B na URL → resultado é sempre a
sessão de B, nunca a de A.

### Verificação

`npm run test` (33 arquivos, **295/295 testes**, incluindo os novos
end-to-end do bug-raiz) e `npm run test:multitz`
(`TZ=UTC`/`America/Sao_Paulo`/`Asia/Tokyo`) **100% verdes**. `turbo run
build` verde nos 5 pacotes (contracts, api, admin, booking, account) —
inclui `tsc --noEmit` de cada frontend. Testes novos de frontend (Vitest,
sem DOM, mesma disciplina de função pura + spec colocado já estabelecida):
`apps/admin/src/lib/moeda.spec.ts`, `apps/admin/src/lib/conclusao.spec.ts`,
`apps/account/src/lib/session.spec.ts` (bloco `resolverSessaoInicial`).

**Não testado interativamente num navegador real** — este ambiente não tem
ferramenta de automação de browser disponível. A verificação foi: `tsc
--noEmit` + `vite build` bem-sucedidos nos 3 frontends (garante que o
código compila e é sintaticamente válido), testes unitários das funções
extraídas especificamente para isolar a lógica de cada bug corrigido, e
testes de integração HTTP reais para tudo que tem endpoint. Os itens abaixo
precisam de smoke test manual num navegador antes de considerar esta sessão
100% fechada.

### O que precisa de smoke test manual

- Fluxo completo do funil público: escolher um barbeiro com override de
  preço, confirmar que o preço mostrado em "Serviços" já é o dele; comprar
  uma oferta de pacote e comparar o rateio com outro barbeiro.
- Cadastrar um serviço novo, criar/editar preço de referência (Ajustes →
  Serviços → "Editar preço"), cadastrar um override por barbeiro (Ajustes →
  Preços por barbeiro) e confirmar que aparece certo no funil.
- Marcar quais serviços um barbeiro atende (Ajustes → Serviços por
  barbeiro) e confirmar que a composição de oferta pra ele só oferece esses
  serviços.
- Logar como um barbeiro NÃO-admin e confirmar: consegue criar/editar a
  própria oferta (aba Pacotes → Catálogo de ofertas), NÃO vê ofertas de
  outros barbeiros, NÃO vê botão de aprovar/rejeitar.
- Criar um atendimento de crédito de pacote, adicionar um serviço avulso
  (walk-in) na conclusão, e confirmar que o valor pedido pra cobrar é só o
  do adicional — nunca o item já coberto pelo pacote.
- Testar o handoff pós-compra em dois navegadores/abas anônimas diferentes
  simulando dois clientes no mesmo dispositivo, confirmando que o segundo
  handoff sempre substitui a sessão do primeiro.
- Skip de barbeiro único: com só um barbeiro cadastrado, confirmar que não
  aparece nenhum frame em branco entre "Com quem?" e "O que vai ser?".
- Conferir a máscara de moeda em todos os campos de valor tocados (digitar
  rápido, apagar, colar um valor) — comportamento esperado é preencher da
  direita como uma calculadora de banco.

## Re-smoke: 2 bugs bloqueantes + reorganização de navegação do admin (sessão-D) ✅

Sessão em duas frentes separadas — bugs de comportamento primeiro (com a
suíte verde ao fim), reorganização de layout depois (sem tocar lógica).

### PARTE 1 — Bugs

**BUG 1 — funil não carrega serviços com barbeiro único/auto-selecionado ("loading eterno")**

Causa estrutural: a decisão de auto-selecionar o barbeiro (quando só existe
um na casa) morava DENTRO do componente filho `Barbeiro` — ele buscava
`/public/barbeiros` sozinho, e ao decidir auto-selecionar, avisava o pai
(`Funil`, em `App.tsx`) via callback (`onSelect`). Quem dispara a busca de
serviços por barbeiro (`servicosDoBarbeiroReq`, reage a `estado.barbeiroId`)
vive no PAI. Ou seja, o caminho "auto-select" e o caminho "clique manual"
pareciam equivalentes no código, mas o automático dependia de um
round-trip filho→callback→pai que o manual não precisa (o clique já
acontece dentro do próprio pai, via `escolherBarbeiro` direto).

Não foi possível reproduzir isto interativamente (sem ferramenta de
browser neste ambiente, e o seed de dev tem 3 barbeiros, não 1) — a busca
`/public/servicos?barbeiroId=` foi confirmada rápida e correta via curl
direto contra o backend real, então o problema não é de rede/backend.
Em vez de caçar o exato instante de dessincronia entre os dois componentes,
a correção **elimina a classe inteira do problema**: a busca de barbeiros e
a decisão de auto-selecionar foram movidas pra dentro do PRÓPRIO `Funil`
(`barbeiroParaAutoSelecionar`, função pura em `funnel-state.ts`), no MESMO
componente que já dispara `servicosDoBarbeiroReq` — sem callback, sem
round-trip entre componentes, sem depender de nenhuma ordem de efeitos
entre dois componentes diferentes. `Barbeiro.tsx` virou puramente
apresentacional (recebe a lista pronta via props).

Teste: `barbeiroParaAutoSelecionar` (`funnel-state.spec.ts`) cobre 1
barbeiro → resolve; 1 barbeiro já resolvido → não repete (evita loop); 2+
barbeiros → não resolve sozinho; sem dados ainda → não resolve. Não foi
possível cobrir no nível de integração/e2e real (exigiria driver de
browser, que este ambiente não tem) — mas a reestruturação em si (mover o
disparo pro mesmo componente) remove o mecanismo que causava o bug,
independente da causa exata não ter sido 100% isolada por observação direta.

**BUG 2 (dinheiro errado) — preço do barbeiro errado desde a PRIMEIRA tela do funil**

Confirmado pelo dono: já na tela de seleção de serviço, o total mostrado na
barra de resumo usava o preço de REFERÊNCIA da casa, não o override do
barbeiro — e como todas as telas seguintes (resumo, PIX, confirmação)
herdam o mesmo `estado`, o valor errado se propagava até o fim.

Causa raiz encontrada: `App.tsx` tinha DUAS listas de serviços —
`servicosReq` (sem `barbeiroId`, preço de referência — usada só pra gate de
loading/erro inicial da página) e `servicosDoBarbeiroReq` (com
`barbeiroId`, preço correto via `precoDeReferencia` do backend — usada só
pra RENDERIZAR a lista de serviços no passo "O que vai ser?"). O cálculo do
TOTAL (`totalCentavos(servicos, ...)`, usado na `SummaryBar`, no valor do
PIX e passado pra tela de Confirmação) usava `servicosReq` — a lista ERRADA
— mesmo a listagem de itens já usando a lista certa. Corrigido: todo
cálculo de preço/duração do avulso (`total`, `duracao`, `resumo`, valor do
PIX, prop `servicos` de `<Confirmacao>`) passou a usar exclusivamente
`servicosDoBarbeiroReq.dados` (`servicosParaPreco`, nunca cai de volta pra
`servicosReq` — fallback é lista vazia, nunca a lista errada).

Teste: `totalCentavos` (`funnel-state.spec.ts`) prova que o mesmo
`servicoId` com preço de override vs. preço de referência produz totais
diferentes — fixa o contrato de que a função SÓ deve ser alimentada com a
lista já precificada pelo barbeiro. A ponte "isso bate com o que o backend
realmente cobra" já está coberta do lado do backend
(`preco-por-barbeiro.e2e.spec.ts`, sessão anterior, prova que `GET
/public/servicos?barbeiroId=` devolve o preço certo) — não foi construído
um teste full-stack automatizado (exigiria driver de browser).

### PARTE 2 — Reorganização da navegação do admin (nenhuma lógica/endpoint mudou)

"Ajustes" tinha virado depósito (serviços, preços, serviços-por-barbeiro,
expediente, produtos — tudo junto, cada um com seu próprio seletor de
barbeiro repetido). Reorganizado em 6 abas com propósito claro — mesmos
endpoints, mesmo comportamento, só o agrupamento visual mudou:

- **Agenda** — inalterada. Ganhou o badge "via link de {barbeiro}" no CARD
  do agendamento (R.12), mesmo tratamento visual dos badges Pacote/Avulso/Pago
  online — antes só aparecia (discreto) no modal de detalhe.
- **Barbeiros** (nova) — tudo que é config de UM barbeiro, com um seletor
  ÚNICO no topo em vez de 4 dropdowns repetidos: dados (nome/papéis/ativo,
  somente leitura — nenhuma edição nova foi criada), link pessoal
  (slug), preços (override por serviço), serviços que atende, expediente
  semanal. Mesmos 5 endpoints de antes (`/barbeiros`, `/barbeiros/:id/slug`,
  `/barbeiros/:id/precos`, `/barbeiros/:id/servicos`, `/expediente/:id`),
  só consolidados numa tela.
  - `R.5`/`R.7` (re-smoke anterior) resolvidos por consequência: antes era
    fácil editar o preço/serviço do barbeiro errado por trocar de dropdown
    sem perceber (4 seletores independentes); agora é um seletor só,
    compartilhado por todas as seções.
- **Catálogo** (nova) — Serviços + Produtos (preço de referência da casa,
  ativar/desativar), com abas internas. O que a barbearia oferece "no
  geral", sem depender de barbeiro.
- **Pacotes & Ofertas** — renomeada (pedido do dono, R.14); já reunia
  Vendidos + Catálogo de ofertas desde a sessão anterior, sem mudança de
  conteúdo aqui.
- **Comissão** — inalterada.
- **Ajustes** — enxuta: usuário logado (nome/papéis/sair) + Parâmetros
  (prazo de reagendamento). Só isso sobrou depois da consolidação acima.

Permissões preservadas: Barbeiros e Catálogo são admin-only (mesmo gate
`ehAdmin` que existia dentro de Ajustes, replicado em cada tela nova — a
aba aparece pra todo mundo no menu, igual já acontecia com Ajustes, mas o
conteúdo mostra "restrito ao admin" pra quem não é). O acesso do barbeiro
não-admin ao próprio catálogo de ofertas (sessão anterior) não foi tocado.

### Verificação

`npm run test` (**295 backend / 15 admin / 9 booking / 13 account**, todos
verdes) e `npm run test:multitz` (`TZ=UTC`/`America/Sao_Paulo`/`Asia/Tokyo`)
**100% idênticos nos 3 fusos**. `turbo run build` verde nos 5 pacotes.
Confirmado ANTES de começar a Parte 1, e de novo ao fim da Parte 1 antes de
iniciar a Parte 2, e de novo ao final — suíte nunca ficou vermelha entre as
partes.

### O que precisa de smoke test manual

**Parte 1:**
- Com um único barbeiro cadastrado (ou testando o caminho manual com 2+):
  confirmar que a etapa "O que vai ser?" carrega a lista de serviços sem
  loading infinito, logo após o skip automático de "Com quem?".
- Escolher um barbeiro com override de preço, ver o total na barra de
  resumo JÁ na tela de seleção de serviço — comparar com o que o backend
  realmente cobra ao confirmar (checar no admin/agenda o valor do
  atendimento criado).

**Parte 2:**
- Navegar pelas novas abas Barbeiros/Catálogo como admin — confirmar que
  todos os 5 fluxos de antes (link, preços, serviços atendidos, expediente,
  criar/editar serviço e produto) continuam funcionando exatamente igual,
  só que num lugar novo.
- Logar como barbeiro não-admin — confirmar que Barbeiros/Catálogo mostram
  "restrito ao admin" e que o acesso ao próprio catálogo de ofertas
  (Pacotes & Ofertas) continua funcionando normalmente.
- Conferir o badge "via link de X" nos cards da Agenda pra um agendamento
  que veio de um link pessoal de barbeiro.

## Sessão-E (2026-07-31) — autonomia do cliente no cockpit ✅

Sessão grande, feita em 5 fases, suíte verde ao fim de **cada uma** (não só no
final) — pedido explícito do dono, dado que dinheiro está envolvido
(abatimento de saldo, reembolso). Regras de negócio confirmadas antes de
começar: cliente cancela sozinho até 2h antes; reagenda sozinho até 12h antes;
fora das janelas, mensagem orienta o WhatsApp da barbearia (sem inventar
canal); cancelamento/reagendamento de item de pacote reusa a regra de
falta/segunda-chance já existente; saldo residual pode abater um avulso OU
virar pedido de reembolso manual em até 45 dias — nunca as duas coisas sobre o
mesmo dinheiro.

### FASE 1 — Histórico e detalhe no cockpit (leitura pura)

`GET /conta/historico` (reusa o read model de `proximos`, mesmo
`AgendamentosClienteQueryService`) e `GET /conta/atendimentos/:id` (reusa o
read model rico do admin, `AgendaQueryService`, com posse conferida na borda).
Zero regra de domínio nova — só leitura. UI: `Historico.tsx` (lista) +
`AtendimentoDetalhe.tsx` (bottom sheet), acessíveis a partir de "ver histórico
completo" na Home do cockpit.

### FASE 2 — Cancelar pelo cockpit (§8.6)

`CancelarAtendimentoClienteUseCase`, caso de uso PRÓPRIO (audiência/janela
diferentes do cancelamento de staff) mas reusando o **mesmo** método de
domínio `Atendimento.cancelar()` — nenhuma regra duplicada. Janela de 2h
parametrizável em `Company` (`janelaCancelamentoHoras`, editável em Ajustes →
Parâmetros), nunca número mágico. Fora da janela: `422` com mensagem
orientando o WhatsApp. O evento `AtendimentoCancelado(antecipado=true)`
aciona o handler de pacote já existente — item de crédito libera sem falta,
mesma regra de sempre.

### FASE 3 — Reagendar pelo cockpit (§8.6)

`ReagendarAtendimentoClienteUseCase` — por baixo é cancelar + criar novo
(nunca existiu transição "reagendado" no `Atendimento`), mas pro cliente
parece só mover o horário. Janela de 12h (sempre maior que a de cancelamento,
por decisão de produto — evita qualquer conflito entre as duas checagens).
Ordem das transações é assimétrica por design: avulso cria o novo **antes** de
cancelar o antigo (nunca perde o agendamento se o novo horário falhar);
crédito de pacote cancela **antes** (o item não pode ser consumido 2x
`AGENDADO`) — se o novo falhar, o crédito volta pra `DISPONIVEL`/`SEGUNDA_CHANCE`,
nunca se perde. UI reusa o seletor de data/hora do funil, extraído para
`components/QuandoBloco.tsx` (generalizado de `servicoId` único para
`servicoIds[]`, compartilhado agora por 3 fluxos).

### FASE 4a — Abater saldo residual em avulso (§8.7) 💰

**Regra do resto**, testada nos dois casos ao centavo:
`valorAbatido = min(saldoResidual, preço)`. Saldo menor que o preço → abate
tudo, cliente paga a diferença, saldo zera. Saldo maior ou igual → abate só o
preço, serviço fica quitado, sobra saldo (nunca abate além do necessário).
`VendaDePacote.aplicarSaldoResidual()` move dinheiro de `saldoResidual` pra
`saldoUtilizado` na MESMA transação da criação do `Atendimento` — nunca
"flutua" entre os dois estados. `Atendimento` ganhou `valorAbatidoSaldo`/
`vendaAbatidaId` como snapshot (histórico nunca recalcula do saldo atual).
Novo `FormaPagamento.SALDO_RESIDUAL` estendendo o netting que já existia pra
`PIX_ONLINE` na conclusão — mesmo padrão, migration `ALTER TYPE ... ADD VALUE`.

**Testes de dinheiro (destacados, e2e + domínio):**
- `saldo MENOR que o preço do serviço: abate tudo, paga a diferença, saldo
  zera` e `saldo MAIOR OU IGUAL ao preço: serviço fica quitado, sobra saldo`
  (`cockpit-cliente-autonomia.e2e.spec.ts`) — os dois braços da regra do
  resto, ponta a ponta, com conferência de `saldoResidual + saldoUtilizado ==
  valorPago` ao centavo depois da operação.
- 5 testes de domínio em `venda-de-pacote.spec.ts` (`aplicarSaldoResidual`):
  abatimento parcial, abatimento total, nunca fica negativo (rejeita abater
  mais do que existe), rejeita valor zero/negativo, dois abatimentos
  sucessivos acumulam corretamente.
- `não é possível abater o saldo de OUTRO cliente — 403, nada muda`.

### FASE 4b — Reembolso manual (SolicitacaoDeReembolso, §8.7) 💰

Reembolso é sempre **manual** — sem gateway, sem estorno automático. Desenho
central: o **"balde reservado"**. `VendaDePacote.reservarSaldoParaReembolso()`
move TODO o `saldoResidual` pra `saldoReservadoReembolso` no momento do
**pedido** (não espera confirmação do admin) — isso torna abatimento (4a) e
reembolso (4b) mutuamente exclusivos **por construção**: depois de reservado,
`saldoResidual` é zero, e o abatimento só enxerga esse campo. Zero mudança
precisou ser feita no código da FASE 4a pra essa exclusão valer.
`confirmarReembolso()` move tudo de `saldoReservadoReembolso` pra
`saldoReembolsado` (só cresce — histórico de quanto já foi devolvido).
Invariante de soma estendida pros 4 baldes: `Σ itens ativos + saldoResidual +
saldoUtilizado + saldoReservadoReembolso + saldoReembolsado == valorPago`.

Prazo de 45 dias (fixo, não parametrizável — diferente das janelas de
cancelar/reagendar) conta a partir de `saldoResidualDesde`, atualizado toda
vez que um item expira; se vencido, `SolicitacaoDeReembolso.criar()` rejeita
**antes** de reservar qualquer saldo. Fluxo: cliente pede
(`POST /conta/pacotes/:vendaId/reembolso`) → reserva + cria a solicitação numa
transação → admin vê a fila (aba "Reembolsos" em Pacotes & Ofertas) → devolve
por fora (PIX manual) → confirma (`POST /pacotes/reembolsos/:id/confirmar`) →
saldo migra pra `saldoReembolsado`, solicitação fecha (`PENDENTE` →
`REEMBOLSADO`, estado final).

**Testes de dinheiro (destacados, e2e + domínio):**
- `pedir reembolso cria solicitação PENDENTE e reserva o saldo (some do
  saldoResidual)` — prova a reserva imediata.
- `admin marca como reembolsado: saldo reservado vira saldoReembolsado,
  solicitação fecha` — com conferência da soma dos 4 baldes == valorPago ao
  centavo.
- `não dá pra confirmar o mesmo reembolso duas vezes` (422 na segunda
  chamada) e `não dá pra abater um saldo que já foi reservado/reembolsado` —
  provam a exclusão mútua na prática, não só na leitura do código.
- `prazo de 45 dias vencido barra o pedido — 422 com orientação de WhatsApp,
  nada muda` — nada é reservado se o pedido falha.
- `pedir reembolso de saldo de OUTRO cliente é recusado — 403, nada muda`.
- 7 testes de domínio em `venda-de-pacote.spec.ts`
  (`reservarSaldoParaReembolso`/`confirmarReembolso`): reserva total,
  exclusão mútua com `aplicarSaldoResidual`, rejeita reservar sem saldo,
  confirma e move pro balde final, rejeita confirmar 2x, rejeita confirmar
  sem nada reservado, `saldoResidualDesde` registrado na expiração.

### FASE 5 — DOMAIN.md atualizado

Novas seções **§8.6** (janelas de cancelamento/reagendamento do cliente) e
**§8.7** (abatimento em avulso + `SolicitacaoDeReembolso`, com o desenho do
"balde reservado" explicado). Tabela de campos de `VendaDePacote` (§3.6)
estendida com os 4 baldes de saldo; invariante de soma atualizada. A nota
antiga "escopo MVP: aplicação de saldo residual é manual, não automatizar" foi
removida — o que ela descrevia como fora de escopo é exatamente o que esta
sessão implementou (o item correspondente em §11, "fora de escopo", também
foi atualizado, não deletado, pra manter o histórico da decisão).

Duas decisões novas em `DECISOES_PENDENTES.md`: **#21** (prazo de 45 dias
quando a venda tem múltiplos itens expirados em datas diferentes — usei a
expiração mais recente, mais generosa ao cliente, já que o brief não cobriu
esse caso) e **#22** (reagendar um avulso que foi pago online antecipadamente
não migra nem estorna o pagamento — caso raro, marcado inline no código com
`// DECISAO_PENDENTE`).

### Verificação

`npm run test` (**328 backend / 18 admin / 9 booking / 13 account**, todos
verdes) e `npm run test:multitz` (`TZ=UTC`/`America/Sao_Paulo`/`Asia/Tokyo`)
**100% idênticos nos 3 fusos**. `turbo run build` verde nos 5 pacotes. Suíte
confirmada verde ao final de CADA fase (1 a 4b), não só no final da sessão.

### O que precisa de smoke test manual

**FASE 1:** abrir "ver histórico completo" no cockpit, confirmar que
concluídos/cancelados/faltas aparecem do mais recente ao mais antigo e que
tocar num item abre o detalhe certo.

**FASE 2:** cancelar um agendamento de verdade dentro da janela de 2h (some da
agenda do admin); tentar cancelar um de amanhã cedo faltando menos de 2h e
conferir a mensagem de WhatsApp; cancelar um item de pacote e ver o crédito
voltar pro cockpit sem falta.

**FASE 3:** reagendar um avulso e um de crédito de pacote pelo cockpit,
conferir no admin que o antigo virou CANCELADO e o novo AGENDADO no horário
certo; tentar reagendar faltando menos de 12h e ver a mensagem de WhatsApp.

**FASE 4a:** gerar um saldo residual de verdade (2 faltas no mesmo item),
usar "Você tem saldo residual" no cockpit, agendar um avulso abatendo — nos
dois cenários (saldo cobre tudo / saldo cobre só parte) — e conferir no admin,
ao concluir o atendimento, que o valor cobrado na cadeira já desconta o
abatimento.

**FASE 4b:** com saldo residual disponível, escolher "Pedir reembolso" no
cockpit, ver o pedido cair na aba "Reembolsos" do admin (Pacotes & Ofertas),
clicar "Marcar como reembolsado" e confirmar que o saldo some da tela do
cliente. Verificar visualmente que, depois de pedir reembolso, o pacote some
da lista de "usar saldo" (porque `saldoResidualCentavos` virou 0).

## Sessão de lançamento (2026-07-31) — OTP por WhatsApp + produção presencial-only ✅

Contexto: a barbearia está operando com a agenda quebrada — objetivo era subir em produção **o
mais rápido possível** com o essencial (agendamento presencial, admin, cockpit do cliente) e OTP
de login por WhatsApp no lugar do Cognito. Escopo deliberadamente estreito: "nada além disso".

### PARTE 1 — OTP por WhatsApp via OpenWA

**Novo serviço separado, `services/whatsapp-otp/`** (fora do workspace npm de propósito — processo
Node próprio, dependências pesadas do OpenWA/Puppeteer isoladas do resto do monorepo). Mantém a
sessão do WhatsApp viva (`@open-wa/wa-automate`) e expõe só `POST /enviar` (protegido por um token
interno compartilhado, `X-Internal-Token`) e `GET /status`. Rodar como processo separado é
deliberado: se a sessão do WhatsApp cair (ela É instável — QR, browser headless, reconexão), quem
cai é esse processo, **nunca a API principal**.

**Lógica de OTP extraída pra ser reusada, não reescrita.** `OtpIdentityProviderBase` (novo) contém
a lógica que já existia só no `DemoIdentityProvider` — código de 6 dígitos, hash HMAC, expiração,
uso único, rate limit de 5 tentativas por desafio — e agora é herdada tanto por `DemoIdentityProvider`
quanto pelo novo `WhatsAppIdentityProvider`. Cada subclasse só decide COMO o código chega ao
cliente (`enviarCodigo`) e o que aparece no campo de depuração `codigoDemo` (sempre `null` no
WhatsApp real). `iniciarLogin` chama `enviarCodigo` **antes** de persistir o desafio no banco — se
o envio falhar, nada fica gravado (nunca existe um desafio "órfão" que o cliente não tem como
responder porque o código nunca chegou).

`WhatsAppIdentityProvider` fala com o serviço separado através de `HttpWhatsAppOtpClient` (POST
`/enviar`, timeout curto — default 8s, nunca trava o request de login) — mockável nos testes via a
interface `WhatsAppOtpClient`. Qualquer falha (timeout, conexão recusada, resposta não-OK) vira
`ServiceUnavailableException` com mensagem limpa ("Não foi possível enviar o código agora..."):
nunca a exceção crua (jargão de rede/HTTP) chega no cliente, e a API nunca cai por causa do
WhatsApp estar fora.

`identity.module.ts`: a factory ganhou o caso `'whatsapp'`; o Cognito **saiu do fluxo** (decisão
registrada — DECISOES_PENDENTES #23). Setar `IDENTITY_PROVIDER` pra qualquer valor desconhecido
(incluindo `'cognito'`) agora lança erro explícito no boot, em vez de cair silenciosamente no
provider demo — mesmo princípio de "fail closed" já usado no resto do sistema (tenant, gateway de
pagamento). O arquivo `cognito-identity.provider.ts` e seus 9 testes continuam no repositório,
intactos, só não são mais alcançáveis por env var.

### PARTE 2 — Produção sobe com pagamento online desligado

Nenhum código novo aqui — a app já suportava "presencial-only" desde a sessão de produtos
(DECISOES_PENDENTES #11: com `PAYMENT_GATEWAY=fake`, `PaymentsModule` nem monta o
`WebhooksController`). O trabalho desta parte foi **confirmar e provar** isso com um teste e2e de
verdade (não só ler o código): `whatsapp-otp-boot.e2e.spec.ts` sobe o `AppModule` completo com
`IDENTITY_PROVIDER=whatsapp` + `PAYMENT_GATEWAY=fake`, e verifica que `POST /webhooks/abacatepay`
devolve `404` (rota nem existe) enquanto o login OTP completo funciona normalmente.

**`assertConfiguracaoSegura` (boot-guard, chamado em `main.ts` antes de qualquer coisa subir):**
lista explícita de providers válidos em produção — hoje só `['whatsapp']` — em vez de só recusar
`'demo'` (a versão antiga aceitava implicitamente qualquer valor que não fosse `'demo'`, o que já
deixaria `'whatsapp'` passar sem ajuste nenhum, mas também deixaria qualquer erro de digitação
passar despercebido). A checagem de `DEMO_MODE=true` em produção continua igual.

### Testes

- `whatsapp-otp.client.spec.ts` (4 testes, `fetch` mockado): corpo/headers da requisição corretos,
  resposta não-OK, erro de rede e timeout — todos os três últimos convertidos pro mesmo erro limpo
  (`WhatsAppEnvioIndisponivelError`), nunca a exceção crua.
- `whatsapp-identity-provider.e2e.spec.ts` (6 testes, Postgres real, cliente OpenWA mockado em
  memória): provisiona + envia + confirma com sucesso; telefone não provisionado → resposta
  neutra, nada enviado; código errado falha e uso único (mesmo código não funciona 2×); código
  expirado falha; **rate limit — 5 tentativas erradas esgotam o desafio, a 6ª falha mesmo com o
  código certo**; falha no envio → erro limpo E nenhum desafio órfão persistido, provider segue
  funcionando depois. Testado direto no provider (sem HTTP) porque os endpoints `/conta/login/*`
  são limitados a 5 requisições/telefone/10min na borda (`TelefoneOuIpThrottlerGuard`) — testar o
  rate limit interno do desafio via HTTP estouraria esse throttle antes de chegar lá.
- `whatsapp-otp-boot.e2e.spec.ts` (3 testes, Postgres real + servidor HTTP local fazendo o papel do
  OpenWA): prova de fiação ponta a ponta — app sobe com `IDENTITY_PROVIDER=whatsapp` sem tocar AWS
  em nenhum ponto, login completo funciona contra o serviço mockado (com verificação do token
  interno enviado), webhook não monta com `PAYMENT_GATEWAY=fake`, e o cenário de resiliência:
  serviço OpenWA fora do ar → erro limpo (nunca 500 cru com stack/jargão), e a API continua
  respondendo normalmente pra próxima requisição.
- `config-seguranca.spec.ts` (14 testes, +5 novos/ajustados): `whatsapp+production` sobe;
  `demo+production` recusa; `cognito+production` recusa (saiu do fluxo); provider desconhecido em
  produção recusa (fail closed); `whatsapp+fake` (a combinação real de lançamento) aceita.

### Verificação

`npm run test` (**344 backend / 18 admin / 9 booking / 13 account**, todos verdes) e
`npm run test:multitz` (`TZ=UTC`/`America/Sao_Paulo`/`Asia/Tokyo`) **100% idênticos nos 3 fusos**.
`turbo run build` verde nos 5 pacotes do workspace (o novo `services/whatsapp-otp/` fica
propositalmente FORA do workspace — processo de deploy próprio, `npm install` separado, ver seu
README).

### Como rodar o serviço OpenWA e conectar o número

Resumo (detalhe completo em `services/whatsapp-otp/README.md`):

```bash
cd services/whatsapp-otp
npm install
export WHATSAPP_OTP_INTERNAL_TOKEN="<token longo aleatório — openssl rand -hex 32>"
npm start
```

Na primeira execução aparece um QR code em ASCII no terminal — escaneie com o WhatsApp do número
**descartável** (nunca o oficial da barbearia — risco de ban por automação, decisão do dono). A
sessão fica salva em `./session`; reinícios seguintes reconectam sozinhos, sem pedir QR de novo.
Para produção de verdade, rodar sob `pm2` (ou systemd) com auto-restart — instruções no README.

### Variáveis de ambiente que mudaram

- `IDENTITY_PROVIDER`: aceita `"demo"` (dev) ou `"whatsapp"` (produção). `"cognito"` não é mais
  aceito em nenhum ambiente.
- Removidas do `.env.example`: `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`,
  `COGNITO_OTP_TTL_MINUTOS`.
- Novas: `WHATSAPP_OTP_SERVICE_URL`, `WHATSAPP_OTP_INTERNAL_TOKEN`, `WHATSAPP_OTP_TIMEOUT_MS`
  (default 8000), `WHATSAPP_OTP_TTL_MINUTOS` (default 5).

### Confirmação: produção sobe com whatsapp+presencial, sem AWS

Provado por teste automatizado (`whatsapp-otp-boot.e2e.spec.ts`), não só por leitura de código: com
`IDENTITY_PROVIDER=whatsapp`, `identity.module.ts` nunca importa nem instancia nada do
`@aws-sdk/client-cognito-identity-provider` — o SDK da AWS simplesmente não entra no grafo de
módulos carregado. Com `PAYMENT_GATEWAY=fake`, nenhuma rota de webhook é exposta. O boot-guard
(`assertConfiguracaoSegura`, chamado em `main.ts`) recusa subir em produção com qualquer outra
combinação de `IDENTITY_PROVIDER`.

### O que precisa de smoke test manual

- **Essencial, com número de teste real:** rodar `services/whatsapp-otp` de verdade, escanear o QR
  com um chip descartável, configurar `IDENTITY_PROVIDER=whatsapp` + `WHATSAPP_OTP_SERVICE_URL` +
  `WHATSAPP_OTP_INTERNAL_TOKEN` na API, e completar um login OTP de ponta a ponta pelo cockpit
  (`apps/account`) — confirmar que a mensagem chega no WhatsApp de verdade, com o código certo, e
  que o login completa. Nenhum teste automatizado toca o WhatsApp real — isto é o único elo não
  coberto por CI.
- Derrubar o processo `whatsapp-otp` de propósito (Ctrl+C) e tentar logar pelo cockpit — confirmar
  que a tela mostra "não foi possível enviar o código agora" (não uma tela de erro genérica/branca),
  e que subir o serviço de novo volta a funcionar sem precisar reiniciar a API.
- Reiniciar o `services/whatsapp-otp` depois de já ter escaneado o QR uma vez — confirmar que
  reconecta sozinho, sem pedir QR de novo.
- Subir a API completa com `NODE_ENV=production` + `IDENTITY_PROVIDER=whatsapp` +
  `PAYMENT_GATEWAY=fake` num ambiente real (não só nos testes) e confirmar o fluxo de agendamento
  presencial ponta a ponta (funil público → admin → conclusão sem nenhum passo de pagamento
  online).

## Deploy abstraído: um comando pra local/staging/produção (2026-08-10) ✅

Pedido de continuação da sessão de lançamento (mesmo dia): abstrair o "subir o
ambiente" inteiro atrás de um único comando, cobrindo os 3 contextos. Decisões
de topologia fechadas com o dono antes de implementar (evitando arquitetura
errada por suposição, dado que o repo não tinha nenhum Dockerfile/CI/CD
prévio): staging/produção rodam **na própria máquina** (sem deploy remoto),
supervisionadas por **Docker** (`restart: unless-stopped`), frontends servidos
por um servidor estático mínimo em Node (não nginx).

**Entregue:** `scripts/deploy.sh <local|staging|production> [comando] [opções]`
— `local` delega pro fluxo de dev já existente (`env-up.sh`, sem Docker,
hot-reload); `staging`/`production` orquestram Docker Compose (5 imagens novas:
API, whatsapp-otp, admin, booking, account — Postgres já existia). Comandos
`up|down|status|logs [serviço]|migrate`; flags `--no-build`/`--seed`
(bloqueado em `production`, de propósito)/`--pull`. Detecta sozinho `docker
compose` v2 vs `docker-compose` v1 (esta máquina só tinha v1). Guard-rails
antes de tocar em Docker: `.env` ausente → copia de `.env.docker.example` e
PARA pedindo pra preencher segredos (nunca sobe com placeholder); variáveis
essenciais vazias/erradas (`AUTH_SECRET` default, `IDENTITY_PROVIDER` != 
whatsapp, `DATABASE_URL` apontando pra `localhost` em vez do serviço
`postgres`) bloqueiam antes do build; porta já ocupada por processo que não é
container deste stack também bloqueia com mensagem clara (aprendido testando
nesta máquina — ver "Testado de verdade" abaixo).

Frontends (`admin`/`booking`/`account`) só chamam a API por caminho relativo
`/api/...` (resolvido pelo proxy do Vite em dev) — em produção, sem Vite dev
server, algo precisa fazer esse proxy. Solução: `docker/static-server/`, um
Express mínimo (fora do workspace npm, como o whatsapp-otp) que serve o
`dist/` do Vite e faz proxy de `/api` pra API pelo nome do serviço Docker.
`VITE_COMPANY_ID`/`VITE_BOOKING_URL` são `ARG` de build (Vite embute em
build-time, não runtime — mudar exige rebuildar a imagem, documentado).

Dois `.env.*.example` propositalmente diferentes: `.env.example` (local, sem
Docker, `DATABASE_URL` com `localhost`) e `.env.docker.example` (staging/
produção, hostnames de serviço Docker: `postgres`, `whatsapp-otp`) — dentro de
um container, "localhost" é o PRÓPRIO container, nunca outro serviço.

### Testado de verdade nesta máquina (não só escrito)

- `apps/api/Dockerfile`: build ok; container rodou de verdade contra o
  `bigods-postgres` real (mesmo container/dados do dev local), respondeu `200`
  numa rota pública com dado real do banco. Bug pego e corrigido: a ordem
  original gerava o Prisma Client DEPOIS do `tsc`, e o build TS falhava
  ("no exported member") — client tem que vir antes.
- `apps/admin/Dockerfile` + `docker/static-server`: build ok; container
  serviu o `index.html` compilado, fez proxy de `/api/comissao/...` até a API
  de verdade (`401` correto, sem token — provando que o proxy chegou na API
  real, não um erro de rede) e de `/api/public/empresa` (dado real do banco).
  `apps/booking/Dockerfile`/`apps/account/Dockerfile` buildaram limpos
  (mesma estrutura, não repeti o teste de proxy nos 3).
- `services/whatsapp-otp/Dockerfile`: build ok; Chrome instala e sobe;
  Puppeteer navega até o WhatsApp Web e injeta os scripts de automação —
  mas a inicialização do WhatsApp Web (aparecimento de `window.Debug`, um
  objeto interno deles) travou em 30s sem nunca chegar a gerar o QR, de forma
  consistente (2 tentativas). Bug real encontrado e corrigido no caminho:
  o `apt-get purge`/`autoremove` depois de instalar o Chrome via `.deb` local
  estava REMOVENDO o Chrome de novo (apt não marcava o pacote como
  "instalado manualmente" do mesmo jeito que pacotes instalados por nome) —
  corrigido removendo o purge. Mas o travamento no carregamento do WhatsApp
  Web em si **não foi resolvido nem isolado** — não dá pra saber se é
  particularidade de rede/IP deste ambiente sandboxado (bem plausível — IPs
  de datacenter/cloud às vezes são tratados diferente pelo WhatsApp) ou algo
  que também acontece na máquina real de staging/produção. **Precisa ser
  testado na máquina real antes de considerar resolvido** — ver
  `services/whatsapp-otp/README.md` (seção de troubleshooting) e `DEPLOY.md`.
- `docker-compose.prod.yml` via `scripts/deploy.sh staging` de ponta a ponta:
  as 5 imagens buildaram, Postgres subiu saudável, mas o `api` esbarrou num
  conflito de porta real (3000 já estava em uso por um processo `node
  apps/api/dist/main` rodando fora do Docker desde antes deste teste — não foi
  morto, propositalmente, por poder ser algo do próprio usuário). Confirma que
  o script SURFACIA o erro de verdade do Docker em vez de mascarar — e motivou
  adicionar a checagem de porta ocupada citada acima. Ambiente de teste foi
  desfeito (`docker-compose down`, sem `-v` — dados preservados) e o `.env`
  local original restaurado ao final; confirmado que o Postgres do dev local
  voltou saudável com os mesmos dados de antes (contagem de `Cliente`
  conferida).

### Verificação

Suíte do backend não foi tocada nesta parte (é infraestrutura de deploy, não
código de domínio/aplicação) — `npm run test` continua nos mesmos 344/18/9/13
verdes de antes. `docker build` de todas as 5 imagens confirmado com sucesso
nesta máquina (ver acima).

### O que precisa de smoke test manual

- ~~Confirmar se o whatsapp-otp consegue de fato gerar o QR e conectar~~ —
  **resolvido na sessão seguinte** (ver "Migração open-wa → Baileys" abaixo):
  não era rede/sandbox, era um bug real na lib antiga. Testado com WhatsApp
  real, QR escaneado, mensagem de OTP recebida de verdade.
- Confirmar que `scripts/deploy.sh production --pull` funciona num redeploy
  real (`git pull` + rebuild + up) sem downtime inaceitável.
- Testar reinício da máquina inteira (reboot) e confirmar que os containers
  voltam sozinhos (`restart: unless-stopped` + Docker configurado pra iniciar
  no boot do SO, que é o comportamento padrão do daemon Docker mas vale
  confirmar no host real).

## Migração open-wa → Baileys (2026-08-10) ✅

Continuação direta da sessão de lançamento: testando o fluxo de OTP por
WhatsApp de ponta a ponta com o usuário escaneando o QR de verdade (não mais
num teste automatizado), dois problemas REAIS apareceram — nenhum dos dois era
o que a seção anterior suspeitava ("rede do sandbox").

### Problema 1: `@open-wa/wa-automate` nunca gerava o QR (nem em Docker, nem fora)

O mesmo travamento (`TimeoutError` esperando `window.Debug` aparecer, depois
de "Page loaded") reproduziu **idêntico** rodando direto na máquina, fora de
Docker — eliminando a suspeita de rede/container da sessão anterior.
Investigação com Puppeteer conectado à sessão do browser via CDP (Chrome
DevTools Protocol) revelou a causa real: a página estava mostrando a tela
"O WhatsApp funciona no Google Chrome 100 ou posterior" — a lib embute um
User-Agent com `Chrome/104.0.0.0` **hardcoded**, e o WhatsApp Web hoje rejeita
isso. `customUserAgent` existe na config da lib pra resolver exatamente isso,
mas tem um bug: a extração dessa opção (`customUserAgent = config.customUserAgent`)
está, no código-fonte, dentro do bloco `if (config.inDocker) {...}` — só é lida
se você TAMBÉM passar `inDocker: true`, mesmo rodando fora de container. Achado
lendo o source publicado no npm diretamente (`unpkg.com`), não documentado em
lugar nenhum. Com os dois ajustes (UA moderno + `inDocker: true`), o QR passou
a aparecer em segundos.

### Problema 2: "Not a contact" — trava comercial que inviabiliza o caso de uso

Com o QR resolvido e a sessão conectada de verdade, mandar uma mensagem de
teste pra um número que NÃO é contato salvo no WhatsApp descartável falhou:
`ERROR: Not a contact. Unlock this feature and support open-wa by getting a
license`. Confirmado por pesquisa: a versão gratuita do open-wa bloqueia
mensagem a não-contato de propósito — desbloquear exige uma "Restricted
License Key" (~£10-15/mês, **sujeita a aprovação**, prazo incerto). Isso
inviabiliza o open-wa gratuito pro caso de uso inteiro desta feature: o
objetivo é mandar OTP pra CLIENTES da barbearia, que nunca vão estar salvos
como contato no chip descartável.

### Decisão (com o dono): trocar pra Baileys

Apresentadas 3 opções (pagar a licença / trocar pra `whatsapp-web.js` — mesma
base Puppeteer/Chrome / trocar pra Baileys — protocolo direto, sem Chrome).
Escolhido **Baileys** (`baileys`, antigo `@whiskeysockets/baileys`, MIT,
pinado na versão estável `6.7.24` em vez do `7.0.0-rc*` que é release
candidate). `services/whatsapp-otp` foi reescrito do zero sobre essa lib:

- Mesmo contrato HTTP externo (`GET /status`, `POST /enviar` com
  `X-Internal-Token`) — **zero mudança** do lado da API (`WhatsAppIdentityProvider`/
  `HttpWhatsAppOtpClient` não sabem nem precisam saber qual lib está por
  baixo).
- `useMultiFileAuthState` (sessão em arquivos, análogo ao `sessionDataPath` de
  antes) + `fetchLatestBaileysVersion` (busca a versão do protocolo mais
  recente A CADA BOOT — elimina de raiz o tipo de bug de versão-hardcoded-
  desatualizada do Problema 1; não é possível esse bug específico acontecer de
  novo).
- JID de destino mudou de `@c.us` (open-wa/whatsapp-web.js) pra
  `@s.whatsapp.net` (Baileys) — confirmado direto no source da lib
  (`jid-utils.d.ts`), não por suposição.
- `package.json` da lib é `"type": "module"` (ESM-only) — o serviço inteiro
  foi convertido de CommonJS pra ESM (`import`/`export`), isolado, sem afetar
  o resto do monorepo (que continua CJS via `tsc`).
- Sem contato prévio necessário: mensagem enviada e recebida de verdade num
  número NÃO salvo, confirmando que o Problema 2 está resolvido.
- **Dockerfile drasticamente mais simples**: sem `apt-get install` de Chrome,
  sem `PUPPETEER_*` env vars, sem `--no-sandbox`/`chromiumArgs` — só Node puro.
  `npm install` local: **153 pacotes / 0 vulnerabilidades** (era 933 pacotes /
  37 vulnerabilidades com open-wa+Puppeteer).

### Verificado de ponta a ponta, com WhatsApp real (não mockado)

1. `npm start` local → QR apareceu em poucos segundos (sem abrir navegador).
2. Usuário escaneou com o número descartável de verdade.
3. `GET /status` → `{"conectado":true}`.
4. `POST /enviar` direto → mensagem chegou no WhatsApp real.
5. `.env` trocado pra `IDENTITY_PROVIDER=whatsapp`, API reiniciada.
6. Confirmado no log: `IdentityProvider: WhatsApp (Baileys)`.
7. Fluxo de login OTP real através da API (`/conta/login/iniciar`) enviando a
   mensagem de produção de verdade (não mais frase de teste) — pendente só de
   um clique final do usuário pra confirmar o código recebido (ver seção
   seguinte pra status exato).

Toda menção a "OpenWA"/`@open-wa/wa-automate` no código, testes, READMEs e
`.env.example`/`.env.docker.example` foi atualizada pra refletir Baileys —
histórico da lib anterior preservado só nos comentários que explicam O PORQUÊ
da troca (aqui, em `DECISOES_PENDENTES.md`, e no cabeçalho de
`services/whatsapp-otp/src/index.js`).

## CRUD de usuários staff/admin no painel (2026-08-12) ✅

Até esta sessão, usuário (barbeiro e/ou admin) só nascia do `seed` — criar
alguém novo em produção exigia mexer no banco à mão, insustentável com a
operação real rodando. Escopo estrito: só gestão de usuário (criar/editar/
desativar/credenciais); vale e pagamento ficam pra próxima sessão. Nenhuma
migration nova — `login`/`senhaHash`/`ativo` já existiam no schema desde a v1
da autenticação local.

**Domínio (`staff/domain/`):**
- `Barbeiro` ganhou `renomear`, `atualizarPapeis` (rejeita conjunto vazio,
  mesma invariante de `criar`), `ativar`/`desativar` (soft-disable — nunca
  deleta: comissão/atendimento/ledger seguem intactos e consultáveis).
- Nova função pura `regra-admin-minimo.ts` (`assertNaoRemoveUltimoAdminAtivo`):
  trava cross-agregado — nunca deixa a empresa sem NENHUM admin ativo, seja
  desativando o último admin ou removendo o papel ADMIN dele. Testada
  isoladamente (5 testes), sem tocar banco.
- `BarbeiroRepository` ganhou `listarTodos` (companyId, sem filtro de papel) —
  `listar` (já existente) continua filtrando só quem tem papel BARBEIRO, porque
  é usado por agenda/comissão/pacotes/funil público pra decidir quem atende;
  misturar os dois quebraria esses fluxos.

**Presentation (`barbeiros.controller.ts`, tudo `@Papeis(Papel.ADMIN)`):**
- `GET /barbeiros/usuarios` — lista TODO o staff (inclusive admin puro, que
  `GET /barbeiros` normal não devolve) com `login` incluso. `BarbeiroDTO`
  normal **não** ganhou `login` de propósito — `GET /barbeiros` é usado por
  qualquer staff autenticado (não só admin) e nunca deveria vazar username de
  terceiros; criado `UsuarioStaffDTO` (extends `BarbeiroDTO` + `login`) só pra
  este endpoint.
- `POST /barbeiros` — `login`/`senha` viraram **obrigatórios** (antes eram
  opcionais). Não existe fluxo de convite/self-service pro staff — sem
  credencial na criação, o usuário nasceria sem jeito nenhum de logar. Criação
  do barbeiro + credencial agora roda numa transação Prisma só
  (`$transaction`, reaproveitando `PrismaBarbeiroRepository` com o client
  transacional) — antes eram duas escritas separadas; virou anti-padrão
  explícito (CLAUDE.md) no momento em que a credencial passou a ser
  obrigatória, então foi corrigido nesta sessão.
- `PUT /barbeiros/:id` — nome + papéis (dados básicos). Comissão/preço/
  serviços/slug continuam nos endpoints próprios que já existiam.
- `PUT /barbeiros/:id/status` — ativar/desativar (soft-disable).
- `PUT /barbeiros/:id/credenciais` — admin reseta login e/ou senha (não existe
  "esqueci minha senha" pro staff — é sempre o admin que reseta).
- `PUT /:id`, `/status` e a criação sempre consultam `listarTodos` e chamam
  `assertNaoRemoveUltimoAdminAtivo` **antes** de persistir — a trava dá 422
  com mensagem clara, nunca deixa a operação passar silenciosamente.
- Login duplicado (constraint `@unique`) vira `409` com mensagem amigável, não
  vaza o erro cru do Postgres.

**Permissão — a trava real é no endpoint, não só no botão escondido:**
`RolesGuard` (global, `APP_GUARD`) já bloqueia qualquer rota `@Papeis(ADMIN)`
pra quem não tem o papel — isso sozinho garante que um barbeiro não-admin não
consegue se auto-promover: ele nem consegue *chamar* `PUT /barbeiros/:id`,
muito menos editar o próprio registro. Testado explicitamente (403 em todos os
5 endpoints de gestão, inclusive tentando o próprio barbeiro alterar o próprio
papel).

**Barbeiro desativado — as 3 consequências pedidas, todas no backend:**
1. Some do funil público (`GET /public/barbeiros` já filtrava `.ativo`) **e**
   das opções de agendamento do próprio admin — `Agenda.tsx` (dialogs de novo
   atendimento e nova venda de produto) não filtrava `ativo`, só papel
   BARBEIRO; corrigido. E, mais importante, o backend agora recusa a
   operação mesmo se alguém contornar a UI: `AgendarAvulsoUseCase` e
   `AgendarComCreditoUseCase` checam `barbeiro.ativo` e devolvem 400 —
   histórico do gap: antes desta sessão era possível `POST` um agendamento
   pra um barbeiro inativo direto na API, só escondido na tela.
2. Mantém extrato/comissão histórico: `GET /barbeiros` (usado por
   `Comissao.tsx`) e o filtro de calendário em `Agenda.tsx` continuam sem
   filtrar `ativo` de propósito — comentado no código pra próxima sessão não
   "corrigir" isso sem querer.
3. Não consegue mais logar: `LocalAuthProvider.validarCredenciais` já checava
   `barbeiro.ativo` desde antes desta sessão (nada mudou aqui, só confirmado
   com teste e2e).

**Como o usuário novo recebe o primeiro acesso:** não há convite por e-mail/
WhatsApp (fora de escopo — trilha de staff é separada da trilha OTP do
cliente, CLAUDE.md). O admin cadastra nome + papéis + login + senha inicial no
diálogo "Novo usuário" e **combina a senha diretamente com a pessoa** (verbal,
WhatsApp pessoal etc. — fora do sistema). Ela já consegue logar imediatamente
após a criação. Reset de senha depois é sempre via "Credenciais" (admin).

**Frontend (`apps/admin/src/screens/Barbeiros.tsx`):** nova seção "Usuários
(staff)" no topo da tela, acima da configuração por-barbeiro que já existia
(link pessoal/preços/serviços/expediente — inalterada). Lista todos com badges
de papel + status, e 3 diálogos: Novo usuário (nome, papéis, comissão +
serviços SE marcar Barbeiro, login+senha), Editar (nome + papéis só — o resto
tem tela própria), Credenciais (resetar login/senha). Botão inline Desativar/
Reativar por linha.

**Nenhum `DECISOES_PENDENTES.md` novo:** todas as regras desta sessão (trava
do último admin, as 3 consequências de desativar, soft-disable nunca deleta)
já vieram explícitas no pedido do dono — nada precisou ser inventado.

**Testes:** 25 novos no backend (5 em `barbeiro.spec.ts`, 5 em
`regra-admin-minimo.spec.ts`, 15 em `gestao-de-usuarios.e2e.spec.ts` — cobrindo
403 pra não-admin em todos os endpoints, criação com login obrigatório e login
duplicado, reset de credenciais, a trava do último admin nos dois formatos
[desativar e remover papel] e liberado com 2 admins, e as 3 consequências de
desativar). **369 testes verdes no backend**, idênticos sob `TZ=UTC`,
`TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo` (`npm run test:multitz`).
`turbo run build` verde nos 5 pacotes; `tsc --noEmit` limpo nos 3 frontends.

### Smoke test manual (pendente — precisa de humano com o painel aberto)

1. Login como admin → aba Barbeiros → "Usuários (staff)" mostra todo mundo
   (inclusive admin sem papel Barbeiro).
2. "+ Novo usuário": criar um barbeiro (papel Barbeiro, com login/senha) →
   confirmar que ele aparece na lista e que dá pra logar com o login/senha
   informados numa aba anônima.
3. Ele aparece na "Configuração por barbeiro" (embaixo) pra configurar
   serviços/preços/expediente, e aparece nas opções de barbeiro pra agendar
   (Agenda → Novo atendimento).
4. Ele aparece no funil público (`booking`) como opção de barbeiro.
5. Desativar esse barbeiro (botão "Desativar" na lista) → confirmar: (a) some
   do funil público e do dropdown de "Novo atendimento"/"Nova venda" na
   Agenda; (b) continua aparecendo em Comissão com o histórico dele intacto;
   (c) a aba anônima logada como ele é derrubada/não consegue relogar.
6. Reativar → volta a logar e a aparecer nas opções de agendamento.
7. Tentar desativar o ÚLTIMO admin ativo (ou remover o papel Admin dele) →
   confirmar que a API recusa com mensagem clara (a UI hoje só repassa o erro
   do backend, não tem um aviso preventivo próprio — funcional, mas vale
   polir numa próxima passada se incomodar no dia a dia).
8. Como não-admin (logar como um barbeiro comum): confirmar que a aba
   "Usuários (staff)" nem aparece (mensagem "restrita ao admin").

## Vale, pagamento e fechamento — ledger de 3 direções (2026-08-13) ✅

⚠️ Sessão em cima de sistema **em produção com dinheiro real dos sócios** — toda
migration foi aditiva/reversível (nada apagado nem reescrito em
`LancamentoComissao`), suíte confirmada verde ANTES de tocar em qualquer
código, e um teste de regressão pré-existente (`produtos.e2e.spec.ts`, da
sessão 2026-07-16) pegou um erro real numa das duas migrations desta sessão
antes de virar bug de produção — ver "Erro pego pela suíte" abaixo.

**Modelo:** o ledger (`LancamentoComissao`) que só tinha CRÉDITOS (comissão)
virou um ledger de **3 direções** — COMISSAO (+) | VALE (−) | PAGAMENTO (−).
Saldo do barbeiro continua sendo **sempre** a soma dos lançamentos, agora com
sinal por tipo; pode ficar **negativo** (barbeiro deve à casa), decisão
explícita do dono.

**Decisão de modelagem (pedida explicitamente: "pense se cabe no mesmo campo
ou é um campo novo"):** `tipo` (COMISSAO\|VALE\|PAGAMENTO) é um campo **novo**,
ortogonal a `origem` (SERVICO\|PRODUTO) — não uma extensão do mesmo enum.
`origem` responde "o que gerou a comissão" e só existe quando `tipo=COMISSAO`;
`tipo` responde "este lançamento soma ou subtrai". Colocar VALE/PAGAMENTO
dentro de `origem` misturaria as duas perguntas no mesmo campo. Mesmo raciocínio
de nomenclatura documentado em `DOMAIN.md` §3.7.

**Migration** (`prisma/migrations/20260813034104_.../20260813035004_...`, 2
arquivos — o segundo corrigindo o primeiro, ver abaixo): `tipo` novo
(`DEFAULT COMISSAO`, backfill automático em toda linha existente),
`valeId`/`registradoPorId` novos (nullable), `origem`/`valorBaseCentavos`/
`percentualAplicadoBp` viraram nullable (só fazem sentido pra COMISSAO) —
`origem` manteve `DEFAULT SERVICO`. Nova tabela `Vale`. **Nenhuma linha
existente foi reescrita ou apagada.**

**★ Erro pego pela suíte, não em produção:** a primeira versão da migration
removeu o `DEFAULT SERVICO` de `origem` (parecia certo — "por que ter default
se agora é opcional?"). Isso quebrou silenciosamente um teste de regressão
JÁ EXISTENTE de uma sessão anterior (`produtos.e2e.spec.ts`, "Migration do
ledger generalizado preserva lançamentos SERVICO antigos") que insere uma
linha SEM passar `origem`, simulando exatamente como uma linha pré-2026-07-16
teria sido escrita — e esperava o default `SERVICO`. Restaurado o `DEFAULT
SERVICO` (segunda migration) — um valor explícito continua vencendo o default
(VALE/PAGAMENTO passam `null` explicitamente), então não conflita com nada
novo. Fica documentado como lembrete: mexer num `DEFAULT` de coluna existente
é uma mudança que PARECE cosmética e não é — a suíte pegou, mas só porque o
teste de regressão da sessão anterior existia.

### FASE 1 — Vale (solicitação → aprovação → pagamento)

- Novo agregado `Vale` (`payroll/domain/vale.aggregate.ts`): máquina de
  estado `PENDENTE → APROVADO → PAGO` (final) \| `PENDENTE → NEGADO` (final,
  motivo obrigatório). **Só essas transições existem** — não há
  `APROVADO → NEGADO` nem cancelar um `PENDENTE` (não foi pedido; registrado
  em `DECISOES_PENDENTES.md` #26, sem afetar dinheiro nos dois casos).
- **Regra crítica implementada literalmente como pedida:** o débito no ledger
  (`LancamentoComissao.criarDeVale`) nasce **só** na transição
  `APROVADO → PAGO` (`MarcarValePagoUseCase`) — `aprovar()` sozinho não toca
  o ledger. `Vale` e `LancamentoComissao` mudam juntos na mesma transação
  Prisma (`UnitOfWork`, `vales` adicionado a `RepositoriosTransacionais` —
  mesmo padrão de `ConfirmarReembolsoUseCase` da sessão-E).
- Endpoints (`vales.controller.ts`): `POST /vales` (qualquer staff, sempre a
  PRÓPRIA solicitação — nunca em nome de outro), `GET /vales` (admin vê
  todos, não-admin só os próprios — filtro sempre server-side, nunca
  confiando em query), `PATCH /vales/:id/aprovar\|negar\|pagar` (admin only).
  Admin-barbeiro (Gabriel) pode aprovar/pagar o próprio vale — mesma decisão
  já tomada pra `PacoteOferta` (sessão-B): sem isso o fluxo trava com um
  único admin+barbeiro real.
- Login duplicado, motivo ausente em negar, vale de outra empresa: tudo
  validado com mensagem clara (400/404), nunca 500.

### FASE 2 — Pagamento ao barbeiro

- `RegistrarPagamentoUseCase`: single-aggregate (só cria um
  `LancamentoComissao` tipo=PAGAMENTO), sem `UnitOfWork` — não há segundo
  agregado pra manter em sincronia. **Sem trava de saldo, por decisão do
  dono** — testado explicitamente: pagar mais do que o saldo devido é aceito
  e deixa o saldo negativo.
- `POST /pagamentos` (admin only): `barbeiroId`, `valorCentavos`, `data`
  opcional (default agora). `registradoPorId` sempre preenchido (auditoria).

### FASE 3 — Extrato (`Financeiro.tsx`, sub-aba "Extrato")

- Saldo líquido em destaque **inequívoco por cor E label** (não só o sinal do
  número): positivo = dourado + "a receber"; negativo = vermelho + "barbeiro
  deve à casa" — o pedido explícito de "sem ambiguidade" levado ao pé da
  letra.
- Cada lançamento do extrato mostra a natureza (COMISSAO com cliente/serviço
  como já era; VALE/PAGAMENTO com "quem registrou" e sinal negativo visível).
- Projeção futura continua **separada** do saldo real (já era assim; vale e
  pagamento são sempre fatos consumados, nunca entram na projeção).
- Barbeiro não-admin só vê o próprio extrato (já era assim; sem mudança de
  comportamento, só confirmado com o resto da tela).

### FASE 4 — Fechamento (gestão, admin only)

- `FechamentoQueryService`: LEITURA pura sobre o ledger — nunca cria
  lançamento, nunca "fecha" nada de forma imutável (é uma foto consultável,
  como pedido). Devolve, por barbeiro, dois grupos **nomeados e separados**:
  acumulado (histórico total do ledger) e movimento do período consultado —
  a distinção que mais gera erro em relatório financeiro, testada
  explicitamente (um lançamento de 2020 aparece no acumulado mas não entra
  num período que consulta só 2026).
- `GET /fechamento?de=&ate=` (admin only) — datas em dia civil LOCAL (mesma
  disciplina de fuso de todo o resto do sistema, `limitesDoDiaCivil`).
- Tela `Fechamento.tsx`: seletor de período (default mês corrente), lista por
  barbeiro com saldo líquido em destaque + os 3 totais acumulados + os 3
  totais do período, lado a lado — e botão "Registrar pagamento" por linha
  (FASE 2 na prática).

### FASE 5 — App do barbeiro = mesmo painel, versão reduzida

`App.tsx`: navegação agora depende do papel — admin vê as 6 abas de sempre;
barbeiro não-admin vê **só** "Financeiro" (que por sua vez já restringe pra
extrato próprio + solicitar vale — sem sub-aba Fechamento pra quem não é
admin). Nenhum mecanismo novo de autorização — reaproveita `usuario.papeis`
que já existia; o controle **real** continua nos guards do backend (uma aba
escondida na UI não é proteção, é só não oferecer caminho morto).

### FASE 6 — DOMAIN.md

- §3.7 reescrita: ledger de 3 direções, fórmula do saldo, explicação da
  decisão `tipo` vs `origem`.
- §3.12 nova: agregado `Vale`.
- §4.4 nova: máquina de estado do `Vale` (diagrama + transições ilegais).
- §8.8 nova: fluxo ponta-a-ponta (vale → pagamento → fechamento) e a
  distinção acumulado vs. período.
- §11: removida a linha "Vale, saque, débito do barbeiro" da tabela de fora
  de escopo — ela **previa exatamente este design** ("lançamento negativo no
  ledger existente"), registrado como confirmado, não apagado da memória do
  documento.

### Reorganização de navegação (efeito colateral desta sessão)

"Comissão" virou **"Financeiro"** (ícone 💰 mantido) — extrato sozinho não
cobria mais tudo que passou a dizer respeito ao dinheiro do barbeiro. Sub-abas
por dentro (`Tabs`, mesmo padrão já usado em Catálogo/Pacotes — sem router):
Extrato \| Vales \| Fechamento (só admin). Evita crescer o bottom-nav pra 8
ícones num shell de 430px.

**Testes:** 46 novos no backend (7 em `saldo-do-barbeiro.spec.ts`, 7 novos em
`lancamento-comissao.spec.ts` incluindo o teste de regressão ★ pedido
explicitamente, 16 em `vale.spec.ts` cobrindo TODAS as transições legais e
ilegais, 16 em `vale-e-pagamento.e2e.spec.ts` cobrindo as 4 fases de ponta a
ponta). **415 testes verdes no backend**, idênticos sob `TZ=UTC`,
`TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo`. `turbo run build` verde nos 5
pacotes; `tsc --noEmit` limpo no admin.

### Smoke test manual (pendente — precisa de humano com dinheiro fictício)

1. Logar como barbeiro não-admin → confirmar que só aparece a aba
   "Financeiro", com sub-abas Extrato e Vales (sem Fechamento).
2. Nessa conta, ir em Vales → "Solicitar vale" → valor + motivo → confirmar
   que aparece como PENDENTE e que o saldo no Extrato NÃO muda.
3. Logar como admin → Financeiro → Vales → aprovar o vale solicitado →
   confirmar que ainda não afeta o saldo do barbeiro (Extrato dele).
4. Marcar o vale como pago → confirmar no Extrato do barbeiro: saldo caiu
   exatamente o valor do vale, aparece um lançamento "Vale pago" em vermelho.
5. Financeiro → Fechamento → conferir os números do barbeiro (comissão
   acumulada, vale pago, saldo líquido) → "Registrar pagamento" com um valor
   MAIOR que o saldo devido → confirmar que é aceito e o saldo fica negativo,
   exibido em vermelho com o label "deve à casa" (não só o sinal de menos).
6. Trocar o período de consulta do Fechamento pra um intervalo sem nenhum
   movimento → confirmar que os totais "no período" zeram mas o "acumulado"
   continua mostrando os números de sempre (a distinção não pode se perder).
7. Como não-admin, tentar (via requisição direta, não pela UI) aprovar/negar/
   pagar um vale ou acessar `/fechamento` → confirmar 403 em todos.

## Ligação do pagamento online — AbacatePay em SANDBOX, Checkout Transparente v2 (2026-08-13) ✅

Esta sessão **ligou** o pagamento online (`PAYMENT_GATEWAY=abacatepay`), até
então desligado (`fake`). A integração já existia de sessões anteriores mas
estava construída contra uma API que **não é a que o dono configurou de
verdade** — corrigida ponta a ponta contra a documentação oficial da AbacatePay
(clonada de `github.com/AbacatePay/documentation`, lida página por página, não
presumida). Suíte confirmada verde (`npm run test` + `test:multitz`) antes de
tocar em qualquer código, como pedido.

### ★ FASE 1 — modo do gateway: era v1/hospedado presumido, virou v2 Checkout Transparente

**Achado obrigatório de reportar primeiro:** o código anterior assumia a API
v1 (`https://api.abacatepay.com/v1`, endpoints `/pixQrCode/create` e
`/pixQrCode/simulate-payment`, `externalId` aninhado em `metadata`, HMAC em hex
com o nosso próprio secret). A conta real do dono está cadastrada como
**webhook v2**, assinando **apenas** `transparent.completed` e
`transparent.lost` — ou seja, **Checkout Transparente** (QR Code + copia-e-cola
dentro do próprio funil), nunca o modo hospedado (`checkout.*`, que não está
assinado nesta conta e faria o pagamento nunca confirmar, silenciosamente).

**Ficou:** `AbacatePayGateway` reescrito para `POST /v2/transparents/create` e
`POST /v2/transparents/simulate-payment`; `externalId` enviado **direto** em
`data.externalId` (nunca em `data.metadata`).

### Confirmação do formato v2

Payload do webhook confirmado contra `pages/webhooks/events/transparent.mdx`:
`{ id, event, apiVersion: 2, devMode, data: { transparent: { id, externalId,
amount, paidAmount, status, ... } } }`. `WebhookAbacatePayRequest`
(`packages/contracts/src/dto.ts`) foi reescrito pra esse shape real, com
fallbacks só defensivos (nunca usados pelo payload v2 real).

### Onde o `externalId` é gravado e lido

- **Gravado**: `IntencaoDePagamento.criar()` gera um `randomUUID()` como
  `externalId` (`vender-pacote.usecase.ts`, `agendar-avulso.usecase.ts`) —
  persistido na coluna `IntencaoDePagamento.externalId` (unique).
- **Enviado ao gateway**: `AbacatePayGateway.criarCobrancaPix` manda esse
  `externalId` em `data.externalId` na criação da cobrança
  (`abacatepay.gateway.ts`).
- **Lido de volta**: `webhooks.controller.ts` → `extrairExternalId()` lê
  `data.transparent.externalId` do payload do webhook, busca a intenção por
  esse valor (`IntencaoDePagamentoRepository.porExternalId`) e confirma.

### Assinatura do webhook — o esquema real é diferente do que o código anterior fazia

Confirmado contra `pages/webhooks/security.mdx`: **dois mecanismos
obrigatórios, AND** (não OR como estava, e não um só):
1. Secret compartilhado na query string `?webhookSecret=...` (nosso
   `ABACATEPAY_WEBHOOK_SECRET`).
2. HMAC-SHA256 em **base64** (não hex) no header `X-Webhook-Signature`,
   calculado com a **chave pública fixa da AbacatePay** — a mesma para toda
   conta, publicada na doc deles, **não** o nosso secret (que só entra na
   prova #1). `abacatepay-webhook.verifier.ts` reescrito para isso; validação
   incondicional, nunca pulada por `devMode: true`.

### FASE 2 — boot e configuração segura

`PAYMENT_GATEWAY=abacatepay` monta o `WebhooksController`, expõe o webhook, e
`assertConfiguracaoSegura` recusa subir sem **ambas** `ABACATEPAY_API_KEY` e
`ABACATEPAY_WEBHOOK_SECRET` — coberto em `config-seguranca.spec.ts` (14
testes, já existiam de sessão anterior, revalidados). Sandbox e produção
rodam exatamente o mesmo caminho de validação, sem atalho por ambiente.

### FASE 3 — política do funil (decisão do dono)

- **Pacote**: pagamento online agora **obrigatório**. `formaPagamento` foi
  **removido** de `VenderPacotePublicoRequest` (`packages/contracts/src/dto.ts`)
  — se um cliente antigo/cacheado ainda mandar o campo, o `ValidationPipe`
  (`whitelist: true`) o descarta silenciosamente sem quebrar. Frontend
  (`Confirmacao.tsx`, `App.tsx`) força `online=true` e esconde a escolha
  quando `ehPacote`.
- **Avulso**: continua com a escolha entre online (PIX antecipado) e
  presencial (na conclusão) — nada mudou aqui, já estava certo.

### FASE 4 — cobrança e expiração

O backend (`AgendarAvulsoUseCase`) e o frontend (`Confirmacao.tsx`,
`PixAguardando.tsx`) **já suportavam** pagamento online pro avulso de uma
sessão anterior — não precisou de UI nova, só a correção do protocolo v2
subjacente (gateway/webhook) beneficiou as duas trilhas de uma vez.

**Novo nesta sessão:** como a AbacatePay não emite webhook nenhum para "PIX
gerado e nunca pago, expirou sozinho" (confirmado varrendo a tabela completa
de eventos v2), a expiração passou a ser detectada por **timeout local**:
`IntencaoDePagamento.expiraEm` (mesma janela pedida ao gateway via
`expiresIn`) é conferido a cada leitura de status
(`ExpirarPagamentoVencidoUseCase`, chamado em `GET /public/pagamentos/:id`
antes de responder — usado tanto por pacote quanto avulso). O próprio polling
do funil é o gatilho; migration puramente aditiva (`expiraEm
TIMESTAMPTZ(3)` nullable).

### ⚠️ Desvio deliberado da instrução original — `transparent.lost`

A instrução pedia: ao receber `transparent.lost`, "marca a intenção como
EXPIRADA/FALHOU; feedback no funil ('seu PIX expirou, gere um novo')". Ao
confirmar contra a doc oficial, essa leitura está **factualmente errada**:
`transparent.lost` = disputa/chargeback **perdido** sobre uma cobrança **que
já estava PAGA** — não existe, em toda a tabela de eventos da AbacatePay v2,
nenhum evento para "PIX simplesmente não pago". Seguir a instrução ao pé da
letra teria o risco real de reverter (marcar EXPIRADO/FALHOU) uma intenção que
na verdade já foi paga e liberou crédito de pacote ou comissão — uma decisão
financeira de estorno que não foi pedida.

**Implementado em vez disso:** `transparent.lost` é um no-op seguro (log de
warning com o `externalId`, zero mutação, 200/201 `processado: false`),
marcado `★ DECISAO_PENDENTE` inline e registrado em
`DECISOES_PENDENTES.md` #27 — decisão de estorno fica para o dono decidir.
A expiração real de PIX não pago foi resolvida pelo timeout local acima (FASE
4), que não depende desse evento.

### FASE 5 — testes

Reescritos/adicionados para o protocolo v2: `abacatepay.gateway.spec.ts` (7
testes, endpoint/payload real), `abacatepay-webhook.verifier.spec.ts` (11
testes, secret+HMAC em AND, chave pública, base64), `webhook-abacatepay.e2e.spec.ts`
(8 testes: confirmação válida, 401 sem cada uma das duas provas, idempotência,
`transparent.lost` no-op, evento não assinado ignorado), `pacote-publico.e2e.spec.ts`
(8 testes, reescrito: política "pacote sempre online" mesmo mandando
`formaPagamento=presencial`, e um teste **real** de expiração por timeout via
polling), `intencao-de-pagamento.spec.ts` (+3 testes de `expirouPorTempo`).
Não havia credencial de sandbox real disponível no ambiente desta sessão
(confirmado ausente em `.env` e nas env vars do shell) — os testes usam
payload v2 assinado à mão com a chave pública real da AbacatePay, exatamente
como pedido para esse cenário; ver DECISOES_PENDENTES.md #9.

### FASE 6 — documentação

`docs/DOMAIN.md` §3.8 reescrita com o fluxo v2 completo (endpoint, payload,
assinatura AND, `expiraEm`, política do funil). `DECISOES_PENDENTES.md` #10
marcada ✅ RESOLVIDA (v2 confirmado como definitivo), #9 atualizada (ainda
pendente de credencial, agora com os detalhes v2), nova #27 registrando o
desvio do `transparent.lost`. `apps/api/src/modules/payments/README.md`
reescrito por completo. `.env.example`/`.env.docker.example`/`.env.aws.example`
atualizados (`ABACATEPAY_BASE_URL` de `/v1` para `/v2`) — só o template, o
`.env` real não foi tocado.

### Resultado final

**428 testes verdes no backend** (42 arquivos), idênticos sob
`TZ=UTC`/`America/Sao_Paulo`/`Asia/Tokyo` (`npm run test:multitz`, rodado 3×
completo). `turbo run build` verde nos 5 pacotes (`contracts`, `api`, `admin`,
`booking`, `account`). Nenhum teste pré-existente quebrou; nenhum arquivo fora
do escopo de pagamento foi tocado.

### Roteiro de smoke test manual — sandbox real (para o dono rodar)

Com o dashboard da AbacatePay aberto (sandbox) e o servidor com
`PAYMENT_GATEWAY=abacatepay` + `ABACATEPAY_API_KEY`/`ABACATEPAY_WEBHOOK_SECRET`
de sandbox carregados:

1. **Pacote (online obrigatório):** no funil público, comprar um pacote.
   Confirmar que a tela mostra QR Code + copia-e-cola sem nenhuma opção
   "pagar na barbearia".
2. **Avulso (com escolha):** agendar um avulso e confirmar que a tela oferece
   as duas opções — online e presencial.
3. **Pagar de verdade (Pix real ou simulação sandbox):** no dashboard da
   AbacatePay, encontrar a cobrança criada (mesmo `externalId`/`id` do passo
   1) e disparar a simulação de pagamento (ou pagar via Pix sandbox de
   verdade, se o app da AbacatePay permitir).
4. **Confirmar a UI:** a tela "aguardando confirmação" do funil deve sair
   sozinha do polling e mostrar sucesso em poucos segundos — sem precisar
   dar refresh.
5. **Conferir o painel admin:** o pacote deve aparecer com créditos
   liberados (5 itens DISPONIVEL, por exemplo); o avulso deve aparecer como
   PAGO.
6. **Testar expiração:** gerar uma cobrança e **não pagar**. Esperar o prazo
   configurado (`ABACATEPAY_EXPIRA_SEGUNDOS`, default 3600s — vale reduzir
   temporariamente essa env pra um valor pequeno só pra esse teste, tipo 30)
   e confirmar que a tela do funil detecta EXPIRADO e oferece gerar um PIX
   novo (ou, no avulso, cair pra presencial).
7. **Testar disputa (`transparent.lost`), se o sandbox da AbacatePay permitir
   simular**: confirmar nos logs do servidor que aparece o warning
   "transparent.lost (disputa perdida) recebido" e que o status da intenção
   **não muda** (continua PAGO) — é o comportamento esperado (no-op
   deliberado, ver seção acima).
8. **Assinatura inválida:** enviar manualmente um POST pra
   `/webhooks/abacatepay` sem header `X-Webhook-Signature` (ex.: via curl) e
   confirmar 401, sem nenhum efeito em nenhuma intenção.

## OTP obrigatório + reserva temporária + cota de presenciais (2026-08-13) ✅

Três problemas reais do funil de agendamento anônimo, cada um com sua trava específica —
suíte confirmada verde (428 testes) antes de tocar em qualquer código, como pedido.

### Matriz implementada

| Cenário | OTP | Reserva |
|---|---|---|
| Presencial, sem sessão | Exige OTP na confirmação | Firme direto após o OTP |
| Presencial, com sessão | Sem OTP | Firme direto |
| Online/pacote, sem sessão | Exige OTP na confirmação | Temporária (10 min) → firme no pagamento |
| Online/pacote, com sessão | Sem OTP | Temporária (10 min) → firme no pagamento |

### Problema 1 — agenda falsa (qualquer telefone reservava sem provar posse)

**Solução:** `POST /public/agendamentos` e `POST /public/pacotes` passaram de `@Publico()` pra
`@ContaCliente()` — mesma sessão de cliente do login do cockpit (`IdentityProvider` + OTP +
`ClienteSessaoService`), **zero mecanismo de OTP novo construído**. O telefone do request DTO foi
**removido** — vem sempre da sessão verificada, nunca do corpo (testado explicitamente: um
telefone forjado no body é ignorado). Sem sessão local válida, o front (`apps/booking`) roda
`/conta/login/iniciar` + `/conta/login/confirmar` — só depois de escolher barbeiro/serviço/
horário, nunca antes (protegendo conversão). Com sessão salva (token HMAC, 30 dias, localStorage
próprio de `apps/booking`), pula o OTP.

### Problema 2 — buraco na agenda (PIX nunca pago prendia o horário pra sempre)

**Solução:** novo estado `RESERVADO` em `StatusAtendimento` (+ `RESERVA_EXPIRADA`, final). Avulso
online nasce `RESERVADO`, não `AGENDADO` — participa da invariante de conflito de horário (domínio
+ constraint `EXCLUDE` do Postgres, estendida pra cobrir os dois status) igual a um agendamento
firme, mas expira sozinho se não pagar a tempo. `PRAZO_RESERVA_SEGUNDOS = 600` (10 min, constante
nomeada) alimenta, no MESMO instante calculado uma única vez: `Atendimento.reservaOnlineExpiraEm`,
`IntencaoDePagamento.expiraEm` e o `expiresIn` pedido de verdade à AbacatePay — nunca duas chamadas
a "agora" separadas, pra nunca haver split-brain entre "reserva expirou" e "intenção expirou", nem
a AbacatePay aceitar um pagamento depois que a reserva local já foi liberada.

`ExpirarPagamentoVencidoUseCase` (já existia da sessão do AbacatePay, só pra intenção) passou a
rodar numa transação que expira a intenção **e** a reserva do atendimento juntas — disparado pelo
próprio polling do funil (`GET /public/pagamentos/:id`), sem cron. `ProcessarWebhookUseCase` ganhou
um branch para `referencia.tipo === 'ATENDIMENTO'`: pagamento confirmado chama
`Atendimento.confirmarReserva()` (`RESERVADO → AGENDADO`) na mesma transação do
`IntencaoDePagamento.confirmarPagamento()`. A projeção pública de horários livres
(`GET /public/horarios`) também não mostra mais como ocupado um slot `RESERVADO` cujo prazo já
passou, mesmo que ninguém ainda tenha lido o status pra disparar a expiração de verdade.

**★ Pacote também passou a usar essa mesma janela de 10 min** (era 1h) — decisão minha, reportada
em detalhe em `DECISOES_PENDENTES.md` #28, porque `VendaDePacote` não tem horário pra reservar
(a spec agrupa avulso-online e pacote sob o mesmo prazo, mas isso é uma leitura minha, não um
número confirmado pelo dono pro caso do pacote especificamente).

### Problema 3 — enxurrada de presenciais (OTP prova telefone real, não impede volume)

**Solução:** `LIMITE_PRESENCIAIS_FUTUROS_ATIVOS = 3` (`regra-cota-presencial.ts`, domínio puro). Um
cliente não pode ter mais de 3 `Atendimento` `AGENDADO`, futuros, **presenciais** (nunca passaram
pelo canal online — detectado via `reservaOnlineExpiraEm IS NULL`, sem campo novo nem relação com
`IntencaoDePagamento`) ao mesmo tempo. Online nunca conta nem é limitado (pagamento já é a trava
natural). Só vale pro canal de auto-atendimento (funil público + cockpit) — **o admin e o
reagendar (cancela+cria) ficam de fora**, decisão minha detalhada em `DECISOES_PENDENTES.md` #29.

### Testes

**456 testes verdes no backend** (44 arquivos, +28 sobre a sessão anterior), idênticos sob
`TZ=UTC`/`America/Sao_Paulo`/`Asia/Tokyo`. Novo arquivo dedicado
`test/integration/otp-reserva.e2e.spec.ts` (8 testes: reserva nasce `RESERVADO` e ocupa o horário
na projeção pública, confirmação vira firme, duas reservas concorrentes pro mesmo slot → 422,
reserva expira e libera o slot pra uma nova reserva, webhook tardio numa reserva já expirada não
revive, e os 3 cenários de cota de presenciais). `atendimento.spec.ts` ganhou 10 testes de domínio
da máquina de reserva. Oito arquivos e2e pré-existentes precisaram de ajuste mecânico (obter uma
sessão de cliente via login OTP demo antes de chamar os endpoints públicos, já que passaram a
exigir `@ContaCliente()`) — nenhuma regra de negócio pré-existente mudou de comportamento nesses
arquivos, só a forma de autenticar a chamada de teste. `turbo run build` verde nos 5 pacotes —
incluiu corrigir 3 mapas exaustivos `Record<StatusAtendimento, ...>` no admin/account que não
cobriam os dois status novos (erro de compilação real, pego pelo build, não pelos testes).

### Roteiro de smoke test manual (para o dono rodar)

1. **Presencial sem sessão:** no funil público (`apps/booking`), escolher barbeiro/serviço/
   horário, marcar "pagar na barbearia", confirmar → aparece a tela de código OTP. Digitar o
   código (modo demo: aparece na tela; produção: chega por WhatsApp) → o agendamento confirma
   direto, sem reserva/PIX.
2. **Presencial com sessão:** repetir o fluxo acima no MESMO navegador — a segunda vez não deve
   pedir OTP de novo (sessão local salva).
3. **Avulso online:** escolher "pagar agora (PIX)" → confirmar (OTP se necessário) → tela de PIX
   aparece com **contagem regressiva** ("Seu horário está reservado por 9:59…"). Não pagar e
   esperar o prazo passar → a tela deve trocar sozinha pra "sua reserva expirou, gere um novo
   horário"; o mesmo horário deve voltar a aparecer disponível pra outro cliente.
4. **Avulso online, pagando a tempo:** repetir o passo 3, mas pagar (ou simular, em modo demo)
   dentro da janela — a tela avança pra sucesso e o atendimento aparece firme na agenda do admin.
5. **Pacote:** comprar um pacote → confirmar que também pede OTP (se sem sessão) e mostra a
   contagem regressiva do PIX — sem menção a "horário" (pacote não reserva agenda).
6. **Cota de presenciais:** com o MESMO telefone, marcar 3 presenciais em horários diferentes →
   tentar um 4º → deve recusar com a mensagem "você já tem 3 horários marcados...". Cancelar um
   dos 3 pelo cockpit (`apps/account`) → tentar de novo → deve aceitar.
7. **Cota não bloqueia online:** com o telefone do passo 6 já no limite de 3 presenciais, comprar
   um pacote ou marcar um avulso online → deve funcionar normalmente (a cota é só de presenciais).
8. **Admin sem cota:** pelo painel admin, criar mais de 3 presenciais pro mesmo cliente → não deve
   ser bloqueado (autonomia do staff, decisão registrada em DECISOES_PENDENTES.md #29).

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
#   do painel admin (passo 7) no mesmo dia. Avulso: cliente escolhe online (PIX)
#   ou presencial (na conclusão). Pacote: pagamento online é OBRIGATÓRIO.
#   Tenant: VITE_COMPANY_ID (default "bigods").

# Com PAYMENT_GATEWAY=fake (default fora de produção), o pacote/avulso online
# fica AGUARDANDO sem webhook real — confirme pelo endpoint demo (DEMO_MODE=true):
# curl -X POST "localhost:3000/public/pagamentos/<intencaoId>/confirmar-demo?companyId=bigods"

# Com PAYMENT_GATEWAY=abacatepay (Checkout Transparente v2, sandbox ou produção),
# o webhook exige assinatura real — ver apps/api/src/modules/payments/README.md
# ("Testar o webhook localmente") e o roteiro de smoke test manual sandbox na
# seção "Ligação do pagamento online" deste arquivo.

# Login OTP do cliente (modo demo — o código volta na resposta, sem SMS):
# 1) admin vende um pacote pro telefone (provisiona o usuário)
# 2) curl -X POST localhost:3000/conta/login/iniciar -H 'Content-Type: application/json' \
#      -d '{"companyId":"bigods","telefone":"11 98888-7777"}'   # → { desafio, codigoDemo }
# 3) curl -X POST localhost:3000/conta/login/confirmar -H 'Content-Type: application/json' \
#      -d '{"companyId":"bigods","telefone":"11 98888-7777","codigo":"<codigoDemo>","desafio":"<desafio>"}'
#    → { token }  (usar como Bearer em GET /conta/perfil)
# Produção: IDENTITY_PROVIDER=whatsapp + vars do WhatsApp OTP (ver .env.example
# e services/whatsapp-otp/README.md) + PAYMENT_GATEWAY=fake para presencial-only.
```

# Bigod's Barber — Especificação de Domínio

> Documento de referência arquitetural. Fonte de verdade para implementação.
> Toda decisão de código deve ser consistente com este documento. Quando houver
> conflito entre este documento e um protótipo visual, **este documento vence** —
> o protótipo descreve aparência, não regra de negócio.

---

## 1. Contexto do negócio

Barbearia física real (Bigod's Barber), operada por um dos sócios (barbeiro principal).
O software nasce da operação real, não de hipótese de mercado.

Duas naturezas de dinheiro coexistem e **não podem ser confundidas**:

- **Remuneração por trabalho** — comissão que o barbeiro recebe por atendimento realizado.
- **Remuneração por participação societária** — divisão de lucro entre sócios.

**Somente a primeira é domínio deste sistema.** A divisão de lucro entre sócios é
contabilidade da empresa, feita fora do produto, a partir dos números que este sistema
produz. Não modelar sócios, cotas ou distribuição de lucro aqui.

### Superfícies do produto

| Superfície | Usuário | Objetivo |
|---|---|---|
| Funil público | Cliente final (não autenticado) | Converter em agendamento pago, rápido |
| Área do cliente | Cliente autenticado (Cognito, OTP) | Consultar créditos, agendar usando pacote |
| Painel de gestão | Admin e Barbeiro (papel condicional) | Operar a agenda, auditar comissão, configurar |

---

## 2. Decisões arquiteturais travadas

Estas decisões foram tomadas explicitamente. Não reverter sem discussão.

### 2.1 Conflito de horário: invariante no domínio + constraint no banco

Dois consumidores da mesma regra:
- **Escrita** (criar agendamento): a invariante "não existem dois atendimentos sobrepostos
  para o mesmo barbeiro" é garantida no domínio **e** por uma constraint de exclusão no
  Postgres (`EXCLUDE USING gist` sobre um range temporal). O banco recusa fisicamente a
  sobreposição, mesmo sob concorrência. Cobre `status IN (AGENDADO, RESERVADO,
  CONCLUSAO_PENDENTE)` — a reserva
  TEMPORÁRIA de um avulso online (§3.5, §3.8) ocupa o horário igual a um agendamento firme,
  senão duas reservas concorrentes pro mesmo slot poderiam ambas nascer (sessão de OTP+reserva,
  Problema 2).
- **Leitura** (listar horários livres): é uma **projeção**, não a fonte da verdade. Pode ser
  otimizada livremente. Se ela errar por corrida, a escrita rejeita — sem inconsistência. Ao
  listar, uma `RESERVADO` cujo prazo já passou (`reservaOnlineExpiraEm`) NÃO conta como ocupada,
  mesmo que ainda não tenha sido lazy-expirada por ninguém (o EXCLUDE do banco só entende status,
  não timestamp — quem escreve um novo agendamento naquele slot é quem, na prática, força a
  reserva vencida a ceder, via a mesma invariante de conflito).

**Por quê:** na v1, essa regra foi implementada duas vezes (query SQL na criação, comparação
em memória na listagem) e as duas podiam divergir. A causa raiz foi não separar invariante de
projeção. Agora a regra tem uma dona única e uma rede de segurança física.

### 2.2 Atendimento e Pacote: agregados separados, transação única

`Atendimento` e `VendaDePacote` são agregados **separados** (fronteiras próprias, cada um
protege as próprias invariantes). Porém, o caso de uso "agendar consumindo um crédito de
pacote" executa dentro de **uma única transação de banco** na camada de aplicação.

**Trade-off consciente:** DDD ortodoxo pediria consistência eventual entre agregados. Estamos
optando por consistência transacional forte, porque:
- O sistema é um monólito com um único banco — o custo é baixo.
- O requisito é financeiro: não pode existir um atendimento consumindo um crédito que não foi
  marcado como usado. Uma janela de inconsistência aqui é dinheiro errado.

Isso é uma escolha, não um descuido. Se um dia os contextos forem separados fisicamente, esta
decisão precisa ser revisitada.

### 2.3 Comissão: evento de domínio

`Atendimento` não calcula comissão. Ele emite `AtendimentoConcluido`. Um handler no contexto de
Payroll escuta e cria o lançamento no ledger.

**Por quê:** hoje só a comissão reage à conclusão. Amanhã reagirão: métrica, notificação de
retorno, fidelidade. Se tudo virar método dentro de `Atendimento`, o agregado passa a saber
demais e vira o `Appointment::schedule()` da v1 de novo. Custo hoje: um event emitter
in-process (sem fila, sem broker). Ganho: extensibilidade sem tocar no agregado.

### 2.4 Multi-tenancy: costura, não implementação

Todo agregado relevante carrega um `CompanyId`, mesmo que hoje exista uma única empresa.
**Não implementar** resolução dinâmica de tenant, middleware de tenant, global scope ou
roteamento por subdomínio agora.

**Por quê:** a v1 tentou multi-tenancy cedo e gerou uma falha de segurança real (fallback
silencioso para a primeira empresa do banco quando o tenant não era identificado). Multi-tenancy
meio-pronta é pior que ausente. Queremos a **costura** (o campo existe, os agregados o respeitam)
sem o **mecanismo** (que só se prova com um segundo tenant real).

### 2.5 Dinheiro e Percentual

- **Nunca `float`.** Sempre `NUMERIC`/decimal no banco, e um Value Object `Dinheiro` no domínio
  (armazenado em centavos, inteiro). O mesmo vale para `Percentual` (comissão): armazenado em
  **pontos-base inteiros** (45% = 4500 bp), nunca como fração de ponto flutuante — a mesma
  disciplina de `Dinheiro`, pela mesma razão.
- **Arredondamento de rateio:** ao ratear o valor de um pacote entre seus itens, arredondar por
  item e garantir que **a soma dos itens arredondados bate exatamente com o valor pago**. O
  resíduo de centavos vai para o último item. Isso é uma invariante, não um detalhe.

### 2.6 Fuso horário: costura na `Company`, conversão sempre na fronteira

O banco guarda **instantes absolutos** (`timestamptz`) — isso não muda. Mas a empresa tem um
**fuso horário IANA próprio** (`Company.timezone`, ex.: `"America/Sao_Paulo"`), pela mesma lógica
de costura do `companyId` (§2.4): outras barbearias em outros fusos vão usar o sistema, então o
fuso nunca é uma constante global do código.

**Regra:** toda fronteira (controller, caso de uso) converte. Um horário informado pelo admin
("9h") significa 9h no fuso da empresa → vira o instante UTC correspondente antes de persistir. Um
instante lido do banco só volta a ser "9h" na hora de **renderizar**, no fuso da empresa — nunca no
fuso do navegador/dispositivo de quem está olhando.

**O domínio permanece puro e nunca presume fuso implícito.** Nenhum código de domínio lê
`process.env.TZ` nem trata `new Date()` como "agora" sem que isso seja um parâmetro explícito.
Quando uma regra precisa raciocinar sobre **dia civil** (não sobre duração absoluta em
milissegundos), ela recebe o `Timezone` como parâmetro — ex.:
`VendaDePacote.computarFalta(itemId, dias, hoje, tz)`. As funções puras que fazem essa conversão
(`instanteDeLocal`, `diaCivilChave`, `limitesDoDiaCivil`, `fimDoDiaCivilMaisDias`, todas em
`shared/domain/calendario.ts`) usam só `Intl.DateTimeFormat` — nenhuma dependência de framework —
e são robustas a transição de horário de verão.

**Prazo de reagendamento é dias civis, não N×24h.** "10 dias de prazo" vence no fim do 10º dia
civil local — se houver mudança de horário de verão no meio do intervalo, o número de **horas**
decorridas muda, o número de **dias** não. Uma vez congelado, `ItemDoPacote.prazoReagendamentoAte`
já é o instante absoluto correto: o job de expiração (§4.2) só compara instantes UTC depois disso,
sem precisar reconhecer fuso de novo.

**Por quê:** esta versão nasceu com tudo tratado em UTC ponta a ponta — "disponibilidade das 9h às
18h" seedada como UTC virava 6h às 15h no horário real do barbeiro (UTC-3). A causa raiz era
confundir **instante absoluto** com **dia civil**: os casos de uso de agendamento buscavam a
disponibilidade do dia via `instante.toISOString().slice(0,10)` — o dia **UTC** do instante, não o
dia local. Um corte marcado às 23h30 local caía no dia UTC seguinte e não encontrava a janela
certa. Corrigido trocando toda leitura de "que dia é esse instante" por `diaCivilChave(instante,
tz)`. Bloqueador de produção — não reintroduzir.

---

## 3. Agregados

### 3.1 `Servico` (raiz)

Serviço oferecido pela barbearia.

| Campo | Tipo | Nota |
|---|---|---|
| `id` | ServicoId | |
| `companyId` | CompanyId | costura de tenant |
| `nome` | string | |
| `precoAvulso` | Dinheiro | preço quando comprado individualmente |
| `duracao` | Duracao (minutos) | |
| `ativo` | boolean | soft-disable, nunca deletar (histórico depende dele) |
| ~~`sugeridoNoBump`~~ | boolean | **DEPRECADO** (2026-08-17, Parte 2) — substituído por `ItemDeOrderBump` (§3.13). Coluna mantida no banco só para rollback; ninguém lê |

**Invariantes:** preço > 0; duração > 0.

**Nota:** um `Servico` nunca é deletado, apenas desativado. Atendimentos históricos e itens de
pacote referenciam serviços — deletar quebraria a auditoria.

**Edição (nome, preço, duração):** todos editáveis, e nenhum reescreve o passado —
`ItemAtendido` guarda `valorCobrado` e `duracaoMinutos` como snapshot (§3.5), então mudar o
catálogo hoje só afeta agendamentos NOVOS. Renomear é seguro e desejável (é a mesma entidade,
com o nome corrigido). Até 2026-08-17 o `PATCH` aceitava `nome` e o descartava em silêncio — o
agregado não tinha `atualizarNome`; e duração não era editável. Corrigido na Parte 1 daquela
sessão.

---

### 3.2 `Barbeiro` (raiz)

Quem realiza atendimentos. Um `Barbeiro` pode também ser admin (papéis são ortogonais).

| Campo | Tipo | Nota |
|---|---|---|
| `id` | BarbeiroId | |
| `companyId` | CompanyId | |
| `nome` | string | |
| `slug` | string | link pessoal de marketing (§3.2.1) — único por empresa |
| `papeis` | Set\<Papel\> | `ADMIN` \| `BARBEIRO` — enum, nunca string livre |
| `comissaoPadrao` | Percentual | ex: 45% |
| `excecoesComissao` | Map\<ServicoId, Percentual\> | override por serviço |
| `servicosAtendidos` | Set\<ServicoId\> | quais serviços ele realiza |
| ~~`comissaoProdutos`~~ | Percentual | **DEPRECADO** (2026-08-19) — a comissão de produto virou taxa ÚNICA DA EMPRESA (§3.9.1). Coluna mantida no banco, sem leitor |
| `precosServicos` | Map\<ServicoId, Dinheiro\> | override de PREÇO por serviço (§3.2.2, sessão-B) — ausência = usa `Servico.precoAvulso` |
| `fotoUrl` | string \| null | foto de perfil (§3.14, 2026-08-19) — URL pública no bucket de uploads |
| `ativo` | boolean | |

**Regra de comissão (serviço):**
```
percentualPara(servicoId) =
  excecoesComissao.get(servicoId) ?? comissaoPadrao
```

**Regra de comissão (produto) — mudou em 2026-08-19:** a taxa NÃO é mais do barbeiro.
Virou uma **taxa única da EMPRESA** (§3.9.1). O campo `comissaoProdutos` do barbeiro está
deprecado e ninguém o lê para calcular.

**Invariantes:**
- `comissaoPadrao` entre 0% e 100%.
- Toda exceção também entre 0% e 100%.
- `comissaoProdutos` entre 0% e 100%.
- `slug`: só letras minúsculas, números e hífen, sem começar/terminar com hífen (formato validado no domínio; unicidade por empresa é responsabilidade do caller, que consulta o repositório).
- Só pode ser agendado para serviços em `servicosAtendidos`.

#### 3.2.1 Slug — link pessoal de marketing (sessão-B, Fase 4b)

Cada barbeiro tem um link público (`{BOOKING_URL}/?barbeiro={slug}`) pra divulgar em
status de WhatsApp, Instagram, cartão. Gerado automaticamente a partir do nome no
cadastro (kebab-case, sem acento — `slugDoNome`/`slugUnico` em `staff/domain/slug.ts`),
editável pelo admin depois. Slug inválido ou inexistente no funil público devolve 404
da API, mas o **frontend nunca mostra isso ao cliente** — cai silenciosamente no funil
normal (escolha de barbeiro), porque um link velho de um barbeiro que já saiu não pode
quebrar a experiência de quem clicou nele.

**Precedência sobre estado salvo:** o funil de agendamento persiste progresso em
`sessionStorage` entre visitas. Um link com barbeiro explícito **sempre vence** esse
estado salvo — mesmo que o cliente tivesse escolhido outro barbeiro numa visita
anterior, entrar por `/?barbeiro=gabriel` reinicia o funil com Gabriel fixado (e
descarta qualquer seleção de serviço da visita anterior, que pode não fazer sentido
para o novo barbeiro).

#### 3.2.2 Preço por barbeiro — `precoPara` (sessão-B, Fase 2)

`Servico.precoAvulso` passa a ser o preço de **referência da casa**. Cada barbeiro pode
ter um override por serviço (`precosServicos`, mesmo padrão de `excecoesComissao`):

```
precoPara(servico, barbeiro) =
  barbeiro.overridePrecoPara(servico.id) ?? servico.precoAvulso
```

`precoPara` é uma função da camada de aplicação (`packages/domain/precificacao-pacote.ts`),
não um método do agregado `Barbeiro` — o domínio do barbeiro só guarda o override, não
conhece `Servico`. **Onde isso é usado:** hoje, exclusivamente no rateio de
`VendaDePacote` (§3.6) e na composição/economia de `PacoteOferta` (§3.11). O preço do
**avulso agendado direto** (`Atendimento.ItemAtendido.valorCobrado`) continua usando
`Servico.precoAvulso` (referência da casa) — estender `precoPara` pra lá é decisão de
domínio não pedida nesta sessão, não implementada (ver DECISOES_PENDENTES).

**Nota v1:** o papel era string livre (`'admin'`, `'barber'`) comparada literalmente em vários
lugares. Aqui é enum, e autorização é centralizada (guard/policy), nunca comparação de string
espalhada.

---

#### 3.2.3 Desconto progressivo do avulso (substituiu os combos fixos)

Antes existiam **combos como itens de catálogo** ("Corte + Barba" por R$70, um `Servico` com
preço próprio). Isso criava uma decisão redundante: clicar no combo, ou clicar em corte e barba
separados? Dois caminhos para o mesmo resultado, com preços diferentes.

Agora o desconto é **automático e por POSIÇÃO no carrinho**, configurado pelo admin:

| Config | Onde vive | Significado |
|---|---|---|
| Degraus | `DegrauDeDesconto` (por empresa) | "o serviço na posição N abate R$X". Posição 1 nunca tem degrau |
| Teto | `Company.descontoTetoCentavos` | limite do desconto acumulado. `null` = sem teto |

A tabela é **global da empresa** (a mesma para todos os barbeiros), mas o desconto **incide
sobre o preço DAQUELE barbeiro** — ou seja, entra depois de `precoDeReferencia` (§3.2.2). Mesma
tabela, bases diferentes, resultados coerentes com cada uma.

**Ordem de aplicação — por que a pergunta se dissolve.** "Qual serviço é o 2º?" não afeta o
total: os degraus são valores **absolutos**, não percentuais, então o desconto total depende só
de **quantos** serviços o carrinho tem. O que resta decidir é como repartir esse desconto entre
os itens — e isso importa porque cada `ItemAtendido` guarda seu próprio `valorCobrado` (que é a
base da comissão, §3.9). O critério é **rateio proporcional ao preço de cada item**, o mesmo já
usado em `VendaDePacote` (§3.6). Consequências:

- **order-independent**: `{corte, barba}` e `{barba, corte}` produzem exatamente o mesmo
  resultado, item a item — não existe "dois cálculos para o mesmo carrinho";
- **máximo benefício**: o desconto configurado é sempre entregue por inteiro quando cabe;
- **nunca negativo**: quem é mais caro absorve mais desconto, então um item barato nunca "deve"
  dinheiro.

**Invariantes** (mesmo rigor do rateio de pacote): `Σ descontos == descontoTotal` (nenhum centavo
some ou aparece no arredondamento), nenhum item negativo, total nunca abaixo de zero — inclusive
com tabela mal configurada (degraus somando mais que o carrinho).

**Uma implementação só, duas pontas.** O cálculo vive em `packages/contracts/src/desconto.ts`
(centavos inteiros, sem framework) porque o funil precisa MOSTRAR ao cliente exatamente o número
que a API vai COBRAR. Duas implementações seriam duas verdades sobre dinheiro. O domínio da API
(`catalog/domain/desconto-progressivo.ts`) embrulha em `Dinheiro` e confere as invariantes antes
de o valor virar snapshot.

**Combos antigos:** são desativados pelo admin (`Servico.ativo = false`), **nunca deletados**.
Desativar só impede novos agendamentos; o `valorCobrado` dos atendimentos passados é snapshot e
não é recalculado por nada — nem por mudança de tabela, nem por desativação do serviço.

---

#### 3.2.4 "Cliente da casa" — relação, não atributo

Um barbeiro pode marcar um cliente como **da casa**. É uma relação
BARBEIRO ↔ CLIENTE (`ClienteDaCasa`, chave composta), nunca um flag no
`Cliente`: o cliente é "da casa DO Gabriel", e isso vale só na agenda do
Gabriel. O mesmo cliente não é da casa do Lucas até o Lucas também marcá-lo —
é relação de confiança pessoal, e um flag global faria a marca de um valer
para todos.

Sem status e sem soft-delete: ou a linha existe (é da casa) ou não existe.
Marcar/desmarcar são idempotentes.

**Autorização vive no backend, não em botão escondido:** um barbeiro só
cria/remove a marca da PRÓPRIA relação — mandar o `barbeiroId` de outro no
corpo devolve 403. O admin gerencia a de qualquer um, e é o único que enxerga
todas as relações de um cliente (para um barbeiro, de quem mais o cliente é
"da casa" não é informação dele).

Nas leituras, `daCasa` é sempre relativo a quem pergunta: em `ClienteDTO` é a
relação com o usuário autenticado; em `AtendimentoDTO.cliente` é a relação com
o barbeiro DAQUELE atendimento.

---

### 3.3 `DisponibilidadeBarbeiro` (raiz)

Janela de trabalho de um barbeiro.

| Campo | Tipo | Nota |
|---|---|---|
| `id` | DisponibilidadeId | |
| `barbeiroId` | BarbeiroId | |
| `data` | Data (YYYY-MM-DD) | **dia civil local** (fuso da empresa, §2.6) a que a janela pertence |
| `janela` | IntervaloDeTempo (inicio, fim) | instantes absolutos UTC — "9h–18h" é convertido na fronteira a partir do fuso da empresa, nunca tratado como UTC literal |

**Invariantes:** `inicio < fim`; janelas do mesmo barbeiro no mesmo dia não se sobrepõem.

**Origem:** `EXPEDIENTE` (gerada pela materialização de `ExpedienteSemanal`, abaixo) ou
`MANUAL` (criada/editada à mão pelo admin — folga pontual, feriado, exceção). Existe só
para a regra de conflito da materialização (§3.3.1); não muda o que a disponibilidade
*significa* nem sua invariante de não-sobreposição.

#### 3.3.1 `ExpedienteSemanal` (item 1 da sessão 2026-07-16)

Expediente recorrente de um barbeiro: para cada dia da semana (0=domingo..6=sábado, mesma
convenção de `Date.getUTCDay()` sobre a data civil), zero ou mais janelas de horário LOCAL.
**Não é uma tabela de disponibilidade** — é a regra que **gera** (materializa) as
`DisponibilidadeBarbeiro` dos próximos dias.

| Campo | Tipo | Nota |
|---|---|---|
| `barbeiroId` | BarbeiroId | |
| `companyId` | CompanyId | |
| `dias` | Map\<DiaSemana, JanelaExpediente[]\> | dia ausente do Map = fechado naquele dia |

**Invariantes (por dia):** janelas com formato `HH:mm` válido; `inicio < fim`; janelas do
mesmo dia não se sobrepõem (mesma disciplina de `DisponibilidadeBarbeiro`).

**Materialização (aplicação, não domínio):** para um horizonte de dias (job diário +
chamada imediata ao salvar o expediente), por barbeiro e por dia:
1. Se existe alguma `Disponibilidade` de origem `MANUAL` naquele dia → **não toca nada**
   (a edição manual do admin sempre vence).
2. Senão, substitui por completo as `Disponibilidade` de origem `EXPEDIENTE` daquele dia
   pelas janelas do dia da semana correspondente (zero janelas = dia fechado, nenhuma
   disponibilidade).

**Por quê "regra de conflito preserva manual":** sem isso, toda folga pontual ou horário
excepcional que o admin lançasse à mão seria apagado na próxima rodada do job — o
expediente é o **padrão**, a disponibilidade do dia é a **exceção**, e exceção sempre
vence padrão.

**Bug operacional corrigido nesta sessão:** antes do `ExpedienteSemanal`, a disponibilidade
era seedada/criada dia a dia sem noção de dia da semana — um domingo (barbearia fechada)
podia aparecer agendável só porque alguém rodou o mesmo script todo santo dia. Com o
expediente, "fechado aos domingos" é a regra, não uma omissão que alguém precisa lembrar de
repetir.

---

### 3.4 `Cliente` (raiz)

Cliente final da barbearia.

| Campo | Tipo | Nota |
|---|---|---|
| `id` | ClienteId | |
| `companyId` | CompanyId | |
| `nome` | string | |
| `telefone` | Telefone (VO, normalizado E.164) | identidade natural |
| `cognitoSub` | string \| null | **null enquanto não promovido a usuário** |

**Promoção a usuário autenticável:**
O funil público cria `Cliente` sem conta (só nome + telefone — atrito mínimo). O cliente vira
usuário (`cognitoSub` preenchido) **no momento em que prova posse do telefone**, ou seja, na
CONFIRMAÇÃO do código OTP — nunca antes. Não é a compra de pacote que promove: essa era a regra
original, quando "ter conta" dependia de comprar algo, e ela deixou quem só agendou avulso (ou
nunca comprou nada) sem acesso à própria área logada.

`telefone` é a chave de reconciliação: um cliente já existente (do funil) que depois confirma um
código é promovido no registro existente, nunca duplicado.

**Enviar o código NÃO depende de ter conta.** Qualquer telefone recebe OTP, em qualquer fluxo
(agendamento, compra, login do cockpit) — é o envio que PERMITE criar a primeira prova de posse,
então condicioná-lo a já existir `sub` inverte a ordem dos fatos e trava exatamente o cliente de
primeira viagem. Houve um gate assim em `OtpIdentityProviderBase.iniciarLogin` (telefone sem
identidade externa recebia desafio vazio, sem código); foi removido — a implementação provisiona
na hora e envia. **Não reintroduzir.**

Consequência consciente: a resposta do "iniciar" deixou de ser neutra quanto à existência de
conta (todo mundo recebe código, então não há o que esconder). "Ter conta" não é informação
sensível aqui — o dono aceitou essa troca. Com isso, a ÚNICA trava contra abuso de envio passou a
ser o rate limit da borda, em duas dimensões que resolvem abusos diferentes:

| Trava | Chave | Freia |
|---|---|---|
| `default` nas rotas de login | telefone (normalizado E.164) | martelar UM número — força bruta de código e incomodar um cliente |
| `otp-origem` (`@EnviaOtp()`) | origem/IP | varrer MIL números — spam, custo de SMS e queima da franquia/chip |

Só o segundo protege contra varredura: cada telefone novo ganha um balde próprio no primeiro, então
sem o limite por origem o volume é ilimitado na prática. O limite por origem depende de `req.ip`
ser o cliente real — ver `trust proxy` em `main.ts` e a sobrescrita de `X-Forwarded-For` no
`Caddyfile`. Com SMS o custo virou dinheiro direto (cada envio é um SMS pago pelo chip), o que
tornou esse limite mais crítico do que era no WhatsApp.

#### Canal do OTP: SMS via Cognito + SMS Gate (2026-08-18)

O canal padrão de produção passou a ser **SMS**, com o **AWS Cognito** como provedor de identidade
(`IDENTITY_PROVIDER=cognito`). O WhatsApp (`whatsapp`, Baileys) continua funcional como adapter,
mas deixou de ser o canal de OTP — fica reservado para transacional futuro.

```
funil → nossa API → Cognito InitiateAuth(CUSTOM_AUTH)
                       ├─ DefineAuthChallenge          orquestra
                       ├─ CreateAuthChallenge          gera o código e manda o SMS (SMS Gate)
                       └─ VerifyAuthChallengeResponse  confere
```

O frontend **nunca** fala com o Cognito: fala com a nossa API, como sempre. O Cognito entra como um
adapter da porta `IdentityProvider` que já existia — nenhum caminho paralelo.

**★ Quem é a fonte de verdade do código.** Depende do provider, e isso é deliberado:

| Provider | Gera/guarda/confere o código | Nossa base (`DemoDesafioLogin`) |
|---|---|---|
| `cognito` | o **Cognito**, via os triggers | não usada nesse fluxo |
| `whatsapp` / `demo` | **nós**, via `OtpIdentityProviderBase` | guarda o desafio (hash, TTL, uso único, tentativas) |

Nunca os dois ao mesmo tempo. Dois sistemas de código competindo pelo mesmo login é a receita para
"o código que chegou não é o que o servidor espera" — por isso `CognitoIdentityProvider` não herda
de `OtpIdentityProviderBase`: ele delega o desafio inteiro para a AWS e o `desafio` que devolve é a
`Session` opaca do Cognito.

**Consequência operacional:** com `cognito`, o limite de tentativas por desafio é o do
`DefineAuthChallenge` (3), não o `MAX_TENTATIVAS_POR_DESAFIO` da nossa base; e errar o código não
dispara SMS novo — o `CreateAuthChallenge` reaproveita o mesmo código entre as tentativas da mesma
sessão (cada SMS custa).

O envio em si (Basic Auth, E.164, timeout, erro limpo) mora em `infra/cognito-triggers/sms-gate.js`,
sem dependências, testado com `fetch` mockado. **Sem criptografia ponta-a-ponta** (decisão do dono):
o conteúdo é um código de 6 dígitos, curto e de uso único; se um dia trafegar link ou dado pessoal,
reavaliar.

---

### 3.5 `Atendimento` (raiz) — agregado central

Um serviço (ou conjunto de serviços) marcado com um barbeiro em um horário.

| Campo | Tipo | Nota |
|---|---|---|
| `id` | AtendimentoId | |
| `companyId` | CompanyId | |
| `clienteId` | ClienteId | |
| `barbeiroId` | BarbeiroId | |
| `itens` | List\<ItemAtendido\> | ver abaixo |
| `produtos` | List\<ItemProdutoAtendido\> | ver abaixo — item 4a, sessão 2026-07-16 |
| `intervalo` | IntervaloDeTempo | início + fim (calculado da duração dos itens **na criação** — produtos e itens adicionados depois NÃO alteram o intervalo, ver abaixo) |
| `status` | StatusAtendimento | máquina de estado — ver §4.1 |
| `origem` | OrigemAtendimento | `AVULSO` \| `CREDITO_PACOTE` |
| `formaPagamento` | FormaPagamento \| null | preenchido só na conclusão — ver regra generalizada abaixo |
| `motivoCancelamento` | string \| null | obrigatório se CANCELADO |
| `origemLinkBarbeiroId` | BarbeiroId \| null | Fase 4c — de qual link pessoal veio o agendamento, se veio de algum (só registro, ver §8.4) |
| `reservaOnlineExpiraEm` | Date \| null | sessão de OTP+reserva — setado SÓ na criação de um avulso ONLINE; ver §4.1 e §8.9 |

**`ItemAtendido`** (value object dentro do agregado):

| Campo | Tipo | Nota |
|---|---|---|
| `servicoId` | ServicoId | |
| `valorCobrado` | Dinheiro | **snapshot** — nunca recalcular do catálogo |
| `duracao` | Duracao | snapshot |
| `itemDoPacoteId` | ItemDoPacoteId \| null | preenchido se origem = CREDITO_PACOTE |

**`ItemProdutoAtendido`** (value object dentro do agregado — item 4a):

| Campo | Tipo | Nota |
|---|---|---|
| `produtoId` | ProdutoId | |
| `quantidade` | int positivo | |
| `valorUnitario` | Dinheiro | **snapshot** do preço no momento em que foi adicionado |

**Por que snapshot:** se o preço do corte mudar de R$40 para R$50 amanhã, o atendimento de
ontem continua valendo R$40. Sem snapshot, o histórico e o extrato de comissão mudariam
retroativamente — inaceitável num sistema que precisa ser auditável.

**Invariantes:**
- Não existem dois `Atendimento` com status ativo (`AGENDADO`, `RESERVADO` **ou**
  `CONCLUSAO_PENDENTE`, §4.1) sobrepostos
  no tempo para o mesmo `barbeiroId`. Garantido no domínio **e** por constraint `EXCLUDE` no
  Postgres. `IntervaloDeTempo` é **semiaberto** `[inicio, fim)`: dois atendimentos que apenas se
  tocam (o fim de um é igual ao início do outro) não conflitam.
- O `intervalo` deve estar contido em alguma `DisponibilidadeBarbeiro` daquele barbeiro naquela
  data — a disponibilidade é procurada pelo **dia civil local** do início do atendimento (§2.6),
  nunca pelo dia UTC bruto do instante.
- Todo `servicoId` dos itens deve estar em `barbeiro.servicosAtendidos`.
- Se `origem = CREDITO_PACOTE`, todo item **original** deve ter `itemDoPacoteId` preenchido e
  `valorCobrado` = valor rateado daquele item no pacote (não o preço avulso).
- Se `origem = AVULSO`, `itemDoPacoteId` é sempre null.
- `status = CANCELADO` exige `motivoCancelamento` não-vazio.

**Adicionar item/produto na conclusão (walk-in add-on — itens 3 e 4a, sessão 2026-07-16):**
`adicionarItem(servicoId, ...)` e `adicionarProduto(produtoId, quantidade, ...)` permitem
registrar, **antes de concluir**, um serviço ou produto que o cliente pediu na cadeira além
do que foi agendado (ex.: agendou corte, decidiu fazer a barba também). Só permitido com
`status = AGENDADO`. Itens adicionados por `adicionarItem` são **sempre avulsos**
(`itemDoPacoteId = null`) — crédito de pacote nunca é consumido retroativamente.

> **DECISÃO CONSCIENTE:** `adicionarItem`/`adicionarProduto` **NÃO revalidam sobreposição de
> horário** — o `intervalo` do atendimento não muda. A invariante de sobreposição (checada em
> `agendar()`) protege **agendamentos futuros**; aqui o barbeiro está registrando trabalho já
> realizado ou em andamento, não marcando um novo horário. Reaplicar a invariante de
> sobreposição seria proteger algo que já não está em risco.

**Forma de pagamento na conclusão — regra generalizada (item 2 e 3, sessão 2026-07-16):**
a exigência de `formaPagamento` deixou de depender só de `origem` e passou a depender do
que está sendo cobrado de fato:
```
exigeFormaPagamento =
  algum item tem itemDoPacoteId === null   // avulso, original ou adicionado
  OU produtos.length > 0                    // produto nunca é crédito de pacote
```
Isso generaliza corretamente o caso de um `Atendimento` de origem `CREDITO_PACOTE` que
recebeu um item/produto adicionado na conclusão (item 3/4a): antes dessa mudança, o domínio
olhava só `origem` e silenciosamente NÃO cobrava o adicional. Casos puros continuam
idênticos: AVULSO sem adicional sempre exige; CREDITO_PACOTE sem adicional nunca exige.

**PIX_ONLINE (item 2, sessão 2026-07-16):** quando o `Atendimento` tem uma
`IntencaoDePagamento` **PAGA** vinculada (§3.8) e não há valor adicional (nenhum
item/produto somado depois do pagamento), a **aplicação** (não o domínio — agregados não se
chamam entre si, §2.2) passa `formaPagamento = PIX_ONLINE` automaticamente ao concluir, sem
perguntar nada ao admin. `PIX_ONLINE` é um valor de `FormaPagamento` distinto do `PIX`
presencial — não se confundem no relatório/extrato. Se sobrou valor adicional (item/produto
somado depois de pago online), a conclusão AINDA pede forma de pagamento, mas só para cobrir
esse adicional — o valor já pago online continua registrado separadamente na
`IntencaoDePagamento` (a UI mostra "R$X já pago online + R$Y a cobrar agora").

**Eventos emitidos:**
- `AtendimentoAgendado`
- `AtendimentoConcluido` → **dispara cálculo de comissão** (§3.7), carregando também o
  snapshot dos `produtos` (comissão de produto usa `barbeiro.comissaoProdutos`, §3.2)
- `AtendimentoCancelado` (carrega `antecipado: boolean`)
- `ClienteFaltou`

**Nota v1:** o cancelamento setava `status = canceled` **e** fazia soft-delete simultaneamente —
dois mecanismos representando o mesmo fato. Aqui: **o status é a única verdade**. Nada de
soft-delete para representar cancelamento. Soft-delete, se existir, é para remoção administrativa,
que é um conceito diferente.

---

### 3.6 `VendaDePacote` (raiz)

Pacote pré-pago comprado por um cliente. **Não é um contador de créditos** — é um conjunto de
itens individuais, cada um com ciclo de vida próprio.

| Campo | Tipo | Nota |
|---|---|---|
| `id` | VendaDePacoteId | |
| `companyId` | CompanyId | |
| `clienteId` | ClienteId | |
| `barbeiroId` | BarbeiroId \| null | barbeiro **escolhido pelo cliente na compra** — a única regra de barbeiro que sobrou (§8.14). `null` = comprou sem escolher. NÃO é base de preço |
| `valorPago` | Dinheiro | valor total efetivamente pago |
| `itens` | List\<ItemDoPacote\> | entidades internas |
| `saldoResidual` | Dinheiro | acumula valor de itens expirados (§4.2); dinheiro **disponível** — pode ser abatido (§8.7) ou reembolsado (§8.7) |
| `saldoUtilizado` | Dinheiro | soma já abatida em agendamentos avulsos (§8.7) |
| `saldoReservadoReembolso` | Dinheiro | reservado por uma `SolicitacaoDeReembolso` PENDENTE (§8.7) — sai de `saldoResidual` no momento do pedido, antes da confirmação do admin |
| `saldoReembolsado` | Dinheiro | confirmado e devolvido manualmente pelo admin (§8.7) — só cresce |
| `saldoResidualDesde` | Instante \| null | expiração mais recente que alimentou `saldoResidual` — âncora do prazo de 45 dias pra reembolso (§8.7) |
| `compradoEm` | Timestamp | |
| `statusPagamento` | StatusPagamento | ver §3.8 |
| `origemLinkBarbeiroId` | BarbeiroId \| null | Fase 4c — de qual link pessoal veio a compra, se veio de algum (só registro, ver §8.4) |

**`barbeiroId` = o barbeiro que o CLIENTE escolheu ao comprar (2026-08-18).** Não é dono
do pacote e não é base de preço: a oferta é da empresa e o rateio usa a referência da casa
(abaixo). É só a trava de consumo — ver §8.14.

**`agendarItem` (a única regra de barbeiro que sobrou):**
- `barbeiroId !== null` ⇒ **só ele** atende os serviços daquele pacote. Foi com ele que o
  cliente decidiu se tratar; agendar com outro é `InvarianteVioladaError`.
- `barbeiroId === null` (comprou sem escolher) ⇒ qualquer barbeiro pode.

"O barbeiro atende este serviço" **não** é verificado aqui: é a MESMA invariante que
`Atendimento.agendar()` já aplica a qualquer atendimento (§3.5), e o use case cria os dois
agregados na mesma transação — não há brecha entre "agendou o item" e "criou um
Atendimento com barbeiro inválido".

**`ItemDoPacote`** (entidade dentro do agregado — **nunca manipulada fora da raiz**):

| Campo | Tipo | Nota |
|---|---|---|
| `id` | ItemDoPacoteId | |
| `servicoId` | ServicoId | |
| `valorRateado` | Dinheiro | **congelado na venda** — ver rateio abaixo |
| `status` | StatusItemPacote | máquina de estado — ver §4.2 |
| `faltasComputadas` | 0 \| 1 | quantas vezes o cliente já falhou neste item |
| `prazoReagendamentoAte` | Instante \| null | preenchido quando entra em segunda chance — **fim do dia civil local**, N dias depois (§2.6, §4.2), não `hoje + N×24h` |
| `atendimentoId` | AtendimentoId \| null | quando agendado/concluído |

**Rateio (calculado UMA vez, no momento da venda, e congelado):**

```
Para cada item i:
  pesoNominal(i) = servico(i).precoAvulso   // referência da CASA, vigente NA VENDA
  somaNominal    = Σ pesoNominal

  valorRateado(i) = arredonda( valorPago × pesoNominal(i) / somaNominal )

Resíduo de arredondamento vai para o último item, garantindo:
  Σ valorRateado == valorPago   (INVARIANTE)
```

O algoritmo do rateio **nunca mudou**; o peso nominal sim, duas vezes. A Fase 2 (sessão-B)
o trocou de `Servico.precoAvulso` para `precoPara` (override do barbeiro dono). Em
2026-08-18, com o pacote virando da EMPRESA, ele voltou a ser `Servico.precoAvulso` —
**decisão do dono**: existe UM preço de pacote para todo mundo, então o valor pago tem que
se dividir igual para todo mundo. Override de barbeiro (§3.2.2) vale para AVULSO, onde o
cliente de fato paga o preço daquele barbeiro; não para pacote, onde o preço é da casa.

**Congelado igual a qualquer outro snapshot:** mudar o preço do serviço DEPOIS de uma
venda não altera `valorRateado` das vendas já feitas. Testado explicitamente
(`preco-por-barbeiro.e2e.spec.ts`): cria venda + conclui atendimento (gera comissão) →
muda preço → venda antiga e lançamento de comissão permanecem byte a byte idênticos.

Exemplo (sem override, igual à referência): pacote com 1 corte (avulso R$40) + 1 barba
(avulso R$30), vendido por R$60.
- Corte: 60 × 40/70 = R$34,29
- Barba: 60 × 30/70 = R$25,71
- Soma: R$60,00 ✓

**Invariantes:**
- `Σ item.valorRateado (não expirado) + saldoResidual + saldoUtilizado + saldoReservadoReembolso + saldoReembolsado == valorPago` — **sempre**, em qualquer estado (§8.7).
- Um item nunca tem mais de 1 falta computada (na segunda, expira).
- Um item não pode ir para `AGENDADO` se não estiver `DISPONIVEL` ou `SEGUNDA_CHANCE`.
- Não é possível consumir item de um pacote com `statusPagamento != PAGO`.
- `agendarItem` exige o barbeiro da COMPRA quando houver um (2026-08-18); sem barbeiro na compra, aceita qualquer um. "Atende o serviço" é `Atendimento.agendar()` quem garante.

**Eventos emitidos:**
- `PacoteVendido`
- `ItemDoPacoteConsumido`
- `ItemDoPacoteExpirado`

---

### 3.7 `LancamentoComissao` (raiz) — ledger de 3 direções, auditável

**Requisito não-negociável de governança.** Cada centavo tem um lançamento rastreável até
o fato que o gerou (atendimento, venda de produto, vale pago ou pagamento registrado). Não
existe "saldo acumulado" como campo mutável — **saldo do barbeiro = soma dos lançamentos**,
sempre.

**Generalizado na sessão 2026-07-16 (item 4)** para cobrir origem `SERVICO` (via
`Atendimento`) e `PRODUTO` (via `Atendimento` — add-on, §3.5 — ou `VendaDeProduto` avulsa,
§3.10). **Generalizado de novo na sessão de vale/pagamento** para um ledger de **3
direções**: `tipo` é o eixo que decide o sinal no saldo.

```
saldo(barbeiro) = Σ valorComissao(COMISSAO) − Σ valorComissao(VALE) − Σ valorComissao(PAGAMENTO)
```

`tipo` (COMISSAO `+` | VALE `−` | PAGAMENTO `−`) é um eixo **ortogonal** a `origem`
(SERVICO | PRODUTO) — não é o mesmo campo generalizado de novo. `origem` responde "o que
gerou esta comissão" e só faz sentido quando `tipo = COMISSAO`; `tipo` responde "este
lançamento soma ou subtrai do saldo". Misturar os dois no mesmo enum faria `origem` ter
valores como `VALE` que não descrevem origem nenhuma — por isso é um campo novo, não uma
extensão do antigo. `valorBase`/`percentualAplicado` também só existem para `COMISSAO` (vale
e pagamento são um valor direto, sem "base × percentual").

| Campo | Tipo | Nota |
|---|---|---|
| `id` | LancamentoId | |
| `companyId` | CompanyId | |
| `barbeiroId` | BarbeiroId | |
| `tipo` | `COMISSAO` \| `VALE` \| `PAGAMENTO` | decide o sinal no saldo (ver fórmula acima) |
| `origem` | `SERVICO` \| `PRODUTO` \| null | só quando tipo=COMISSAO |
| `atendimentoId` | AtendimentoId \| null | preenchido quando a origem foi um Atendimento (serviço OU produto add-on) |
| `vendaDeProdutoId` | VendaDeProdutoId \| null | preenchido quando a origem foi uma venda avulsa de produto |
| `servicoId` | ServicoId \| null | preenchido só se origem = SERVICO |
| `produtoId` | ProdutoId \| null | preenchido só se origem = PRODUTO |
| `valeId` | ValeId \| null | só quando tipo=VALE — rastreia até o `Vale` (§3.12) que foi pago |
| `registradoPorId` | BarbeiroId \| null | só tipo=VALE\|PAGAMENTO — o admin que confirmou que o dinheiro se moveu. Null em COMISSAO (gerado pelo sistema) |
| `valorBase` | Dinheiro \| null | só COMISSAO. serviço: avulso OU rateado do pacote. Produto: unitário × quantidade |
| `percentualAplicado` | Percentual \| null | só COMISSAO — snapshot da regra vigente na conclusão/venda — `barbeiro.percentualPara(servicoId)` para serviço, `barbeiro.comissaoProdutos` (único, sem matriz) para produto |
| `valorComissao` | Dinheiro | **magnitude** do lançamento (sempre positiva) — `valorBase × percentualAplicado` se COMISSAO, valor direto se VALE/PAGAMENTO. O sinal no saldo vem de `tipo`, nunca deste campo |
| `ocorridoEm` | Timestamp | |

**Compatibilidade:** `atendimentoId`/`servicoId` (sessão 2026-07-16) e agora
`valorBase`/`percentualAplicado`/`origem` (sessão de vale/pagamento) viraram opcionais via
migrations aditivas (`ALTER COLUMN ... DROP NOT NULL`, `origem` mantém `DEFAULT SERVICO`
pra código que insere sem passar o campo continuar caindo em SERVICO, nunca NULL por
omissão). Lançamentos existentes **não mudam de forma nem de valor** — `tipo` ganhou
`DEFAULT COMISSAO`, preenchido retroativamente em toda linha existente.

**Saldo pode ser NEGATIVO** (barbeiro deve à casa) — por isso o saldo em si não é
representado como `Dinheiro` (VO que nunca é negativo por invariante), é um inteiro de
centavos com sinal, calculado na borda de leitura.

**Nota v1:** a comissão era um `+=` na coluna `commission` do `User`, sem histórico. Se o barbeiro
perguntasse "por que recebi X?", o sistema não sabia responder. Isso destrói confiança —
especialmente entre sócios. Aqui, o extrato é a fonte da verdade e o saldo é derivado.

**Projeção de comissão futura:** calculada como soma sobre atendimentos `AGENDADO` e
`CONCLUSAO_PENDENTE` (ainda não concluídos — no segundo caso, esperando aprovação do admin). **É uma query de leitura, não um lançamento.** Nunca somar projeção com saldo real —
na UI e na API, são números separados e rotulados. Agendamento futuro pode ser cancelado. Vale
e pagamento são sempre fatos **consumados** — nunca entram na projeção, só no saldo real.

---

### 3.8 `IntencaoDePagamento` (raiz)

Representa a intenção de pagar, criada **antes** de chamar o gateway (AbacatePay, Checkout
Transparente v2 — DECISOES_PENDENTES.md #10). Transparente = QR Code + copia-e-cola mostrados
dentro do próprio funil, nunca redirecionamento pra página hospedada da AbacatePay (o webhook
cadastrado só assina `transparent.*`; modo hospedado emitiria `checkout.*`, não assinado, e o
pagamento nunca confirmaria).

| Campo | Tipo |
|---|---|
| `id` | IntencaoDePagamentoId |
| `companyId` | CompanyId |
| `referencia` | AtendimentoId \| VendaDePacoteId |
| `valor` | Dinheiro |
| `status` | `AGUARDANDO` \| `PAGO` \| `EXPIRADO` \| `FALHOU` |
| `externalId` | string | enviado ao gateway como `data.externalId` (v2 — campo direto, não aninhado em `metadata`) |
| `expiraEm` | Date \| null | prazo local de expiração do PIX (null quando não é pagamento online, ex. presencial) — ver expiração abaixo |

**Fluxo:**
1. Domínio cria `IntencaoDePagamento` em `AGUARDANDO`, com `expiraEm` calculado localmente. A
   janela **depende da referência** (sessão de OTP+reserva — §8.9 — dois conceitos diferentes,
   não uma constante só):
   - `ATENDIMENTO` (avulso online): `agora + PRAZO_RESERVA_SEGUNDOS` (10 min) — o MESMO instante
     de `Atendimento.reservaOnlineExpiraEm`, calculado uma única vez.
   - `VENDA_DE_PACOTE` (pacote): `agora + gateway.expiraEmSegundos` (1h, via
     `ABACATEPAY_EXPIRA_SEGUNDOS`) — pacote não reserva horário, então o prazo curto da reserva
     não se aplica a ele (DECISOES_PENDENTES.md #28).
2. Infra chama `POST /v2/transparents/create` na AbacatePay, passando nosso `externalId` em
   `data.externalId`. Resposta devolve QR Code (`brCodeBase64`) e copia-e-cola (`brCode`).
3. Webhook `transparent.completed` chega → assinatura validada (ver abaixo) → busca a intenção
   pelo `externalId` (lido de `data.transparent.externalId`) → transiciona para `PAGO`.
4. Transição para `PAGO` emite `PagamentoConfirmado` → libera o pacote/atendimento.

**Assinatura do webhook — dois mecanismos OBRIGATÓRIOS (AND), confirmados contra a doc oficial da
AbacatePay:**
1. Secret compartilhado na query string `?webhookSecret=...` (nosso `ABACATEPAY_WEBHOOK_SECRET`).
2. HMAC-SHA256 em **base64** no header `X-Webhook-Signature`, calculado com a **chave pública fixa
   da AbacatePay** (a mesma para toda conta, publicada na doc deles — nunca o nosso secret).

Validação é **incondicional**, nunca pulada por `devMode: true` no sandbox. Payload não-verificado
é rejeitado com 401 sem tocar em nenhuma entidade.

**`transparent.lost` é disputa/chargeback PERDIDO sobre uma cobrança já PAGA — não "PIX expirou
sem pagamento"** (DECISOES_PENDENTES.md #27). Tratado como no-op seguro (log + zero mutação); a
AbacatePay não emite webhook nenhum para PIX simplesmente não pago.

**Expiração de PIX não pago é por TIMEOUT LOCAL**, não por webhook: `expiraEm` é conferido a cada
leitura de status (`GET /public/pagamentos/:id`, usado tanto pelo polling de pacote quanto de
avulso) — se `AGUARDANDO` e o prazo já passou, transiciona para `EXPIRADO` ali mesmo, antes de
responder. Sem cron, sem job separado: o próprio polling do cliente é o gatilho.

**Modo de pagamento manual por WhatsApp — TEMPORÁRIO (2026-08-18, flag):** enquanto a AbacatePay
não libera produção (~7 dias úteis), `PAGAMENTO_MANUAL_WHATSAPP=true` faz o "pagar online" **não
gerar PIX**: o funil manda o cliente para o WhatsApp da barbearia (`PAGAMENTO_MANUAL_WHATSAPP_NUMERO`)
com uma **comanda** pré-escrita (cliente, telefone, itens com valores, barbeiro, quando, total), e
o PIX acontece por fora do sistema.

A decisão vive num **único ponto** — `CobrancaOnlineService.gerar()`, exatamente onde antes havia
a chamada ao gateway. Nada mais no fluxo sabe da flag. **Tudo o que vem ANTES é idêntico nos dois
modos, de propósito:**
- a `IntencaoDePagamento` nasce igual, em `AGUARDANDO`, com o **mesmo `expiraEm`**;
- o avulso online continua nascendo `RESERVADO` com `reservaOnlineExpiraEm`;
- a expiração por timeout local (acima) segue valendo, com o mesmo gatilho de polling.

É isso que impede o **buraco de agenda**: cliente que clica "pagar", vai pro WhatsApp e some não
prende o horário — a reserva expira sozinha, como no fluxo com PIX de verdade.

A confirmação **não é um caminho novo**: reusa a aprovação manual que já existia
(`POST /pacotes/:id/confirmar-pagamento`, do bug 8) e a irmã dela para o avulso
(`POST /atendimentos/:id/confirmar-pagamento`), que chama o **mesmo `ProcessarWebhookUseCase`** do
gateway — portanto idempotente, admin-only, e `RESERVADO → AGENDADO` pela mesma transição de
sempre. O OTP continua exigido igual; a opção "pagar na barbearia" do avulso **não muda em nada**.

Desligar a flag devolve o PIX do gateway na hora — o código do gateway nunca sai do lugar
(DECISOES_PENDENTES.md #38).

**Política do funil (decisão do dono):** na trilha de **pacote**, pagamento online é
**obrigatório** — não existe mais opção "pagar na barbearia" no funil público, pra garantir caixa
adiantado antes de liberar crédito. Na trilha de **avulso**, o cliente **escolhe** entre pagar
online (PIX antecipado) ou presencial (na conclusão).

**Por quê:** o pagamento externo é um **evento de infraestrutura confirmando uma intenção que já
existe no domínio** — nunca o contrário. Isso evita o problema da v1, onde cadastro de cliente e
criação de agendamento eram duas chamadas independentes sem rollback (se a segunda falhasse, o
cliente ficava órfão).

**Webhook deve ser idempotente** — gateways reenviam. Processar duas vezes o mesmo `externalId`
não pode gerar dois efeitos.

---

### 3.9 `Produto` (raiz) — item 4 da sessão 2026-07-16

Catálogo MÍNIMO de produtos para revenda (pomada, gel, óleo de barba). **SEM controle de
estoque** — decisão consciente, não implementar (ver DECISOES_PENDENTES): sem quantidade,
sem fornecedor. Mesmo padrão de soft-disable de `Servico` (§3.1) — nunca deletado, só
desativado, porque histórico de venda/comissão depende dele.

| Campo | Tipo | Nota |
|---|---|---|
| `id` | ProdutoId | |
| `companyId` | CompanyId | |
| `nome` | string | |
| `preco` | Dinheiro | |
| `fotoUrl` | string \| null | foto do produto (§3.14, 2026-08-19) — URL pública no bucket de uploads |
| `ativo` | boolean | soft-disable |
| — | — | a **comissão** sobre este produto usa a taxa única da empresa (§3.9.1), não um campo do produto |
| ~~`sugeridoNoBump`~~ | boolean | **DEPRECADO** (2026-08-17, Parte 2) — substituído por `ItemDeOrderBump` (§3.13). Coluna mantida no banco só para rollback; ninguém lê |

**Invariantes:** nome não-vazio; `preco` positivo.

Produto é vendido de duas formas (nunca uma terceira): anexado a um `Atendimento` — na conclusão
(§3.5, `ItemProdutoAtendido`) ou já na criação, via order-bump (§8.13) — ou numa `VendaDeProduto`
avulsa (§3.10).

---

#### 3.9.1 Comissão de produto — taxa ÚNICA da empresa (2026-08-19, decisão dos sócios)

**A regra:** todo produto vendido, por qualquer barbeiro, em qualquer caminho, paga comissão
pela **mesma taxa**, guardada em `Company.comissaoProdutosBp` (pontos-base, inteiro — nunca
float). Não é por produto, não é por barbeiro. Configurável pelo admin em Ajustes → Parâmetros.

**Por quê separar da comissão de serviço:** serviço é quase toda margem — o que se paga ali é
habilidade e tempo. Produto é **revenda**: a empresa compra e revende, e a margem é uma fração
do preço. Pagar a taxa de serviço sobre o preço de venda de um produto pode custar mais do que a
margem daquele produto — o negócio perderia dinheiro a cada venda.

**Incide sobre o PREÇO DE VENDA**, não sobre a margem. Não é preferência: o sistema **não cadastra
custo de produto** (§3.9 — catálogo mínimo, sem estoque, sem fornecedor), então não existe o dado
para calcular margem. Um modelo de margem exigiria primeiro modelar custo, o que está fora de
escopo (§11).

**Por que global e não por barbeiro:** produto é o mesmo produto na mão de qualquer profissional —
não há a variação de esforço que justifica a matriz por serviço. A taxa por barbeiro que existia
antes acabava inconsistente na prática (um barbeiro com 10%, dois com 0%, sem ninguém ter
decidido isso).

**Onde incide** — todos os caminhos usam a mesma taxa:
- venda avulsa de produto (`VendaDeProduto`, §3.10);
- produto anexado ao atendimento na conclusão (walk-in add-on, §3.5);
- produto que entra pelo **order-bump** do funil (§8.13) — vira `ItemProdutoAtendido` e cai no
  mesmo handler de conclusão.

**★ Snapshot — o histórico é congelado.** O `LancamentoComissao` guarda `valorBase`,
`percentualAplicado` e `valorComissao` **do momento da venda** (§3.7). Mudar a taxa **não
recalcula nada** que já foi lançado: é dinheiro que o barbeiro já viu no extrato dele, e o extrato
não pode mudar por uma decisão tomada depois. A taxa nova vale para vendas **daqui pra frente**.

**Default 0.** Empresa sem taxa configurada não gera comissão de produto. O sistema nunca paga um
percentual que ninguém decidiu.

---

### 3.10 `VendaDeProduto` (raiz) — item 4b da sessão 2026-07-16

Venda AVULSA de produto — "alguém entrou só pra comprar", sem `Atendimento` associado.
Registro simples: produto(s), quem vendeu, forma de pagamento, cliente opcional. Distinta
do add-on em `ItemProdutoAtendido` (vendido *junto* de um atendimento, §3.5).

| Campo | Tipo | Nota |
|---|---|---|
| `id` | VendaDeProdutoId | |
| `companyId` | CompanyId | |
| `barbeiroId` | BarbeiroId | quem vendeu |
| `clienteId` | ClienteId \| null | **opcional** — cliente pode não estar cadastrado |
| `itens` | List\<ItemVendaDeProduto\> | `{ produtoId, quantidade, valorUnitario (snapshot) }` |
| `formaPagamento` | FormaPagamento | |
| `vendidoEm` | Timestamp | |

**Invariantes:** ao menos um item; toda `quantidade` inteiro positivo.

**Eventos emitidos:**
- `VendaDeProdutoRegistrada` → gera `LancamentoComissao` de origem `PRODUTO` por item,
  usando `barbeiro.comissaoProdutos` (§3.2, §3.7).

---

### 3.11 `PacoteOferta` (raiz) — sessão-B (Fases 1 e 3)

Catálogo de pacotes que a barbearia oferece à venda — **agregado de domínio de
primeira classe** desde esta sessão (antes era um read model só semeado, sem CRUD, ver
DECISOES_PENDENTES #12, resolvido). Define O QUE está à venda e por quanto; a venda em
si continua passando por `VendaDePacote`/rateio (§3.6) — este agregado nunca reescreve o
rateio, só é a fonte da composição e do preço que alimentam a venda.

| Campo | Tipo | Nota |
|---|---|---|
| `id` | PacoteOfertaId | |
| `companyId` | CompanyId | |
| `nome` | string | |
| `composicao` | List\<{servicoId, quantidade}\> | **MISTA**: N serviços distintos, cada um com sua quantidade (ex.: 2 cortes + 2 barbas no mesmo pacote) |
| `preco` | Dinheiro | **única fonte de verdade persistida** — ver regra de precificação abaixo |
| `ativo` | boolean | soft-disable, como `Servico`/`Produto` |
| `statusAprovacao` | StatusAprovacaoPacoteOferta | workflow de aprovação (§4.3, Fase 3) |
| `motivoRejeicao` | string \| null | preenchido só quando `REJEITADO` |

**★ Regra central de precificação — preço é sempre a fonte de verdade:** o admin (ou o
barbeiro dono) pode digitar o preço de duas formas na UI — (a) um percentual de
desconto sobre a soma dos preços de referência, ou (b) o preço final direto. **Qualquer
que seja o modo de entrada, o que se PERSISTE é sempre o preço em centavos** — o
percentual nunca é armazenado, é sempre DERIVADO na exibição a partir de
`(somaDeReferencia, preco)`. Se o percentual fosse a fonte de verdade, uma mudança
futura no preço avulso/override de referência alteraria o preço do pacote sozinha, sem
ninguém ter decidido isso — guardando o preço, ele só muda quando alguém edita, e o
percentual exibido se recalcula, revelando corretamente que o desconto real
encolheu/cresceu. Mesma disciplina de snapshot do resto do sistema (dinheiro é
congelado; o que é derivado, é sempre recalculado, nunca guardado). O modo (a)/(b) é
**só uma conveniência de entrada no frontend** — o backend só recebe e persiste
`precoCentavos`, sempre.

**Base de cálculo da soma de referência:** `Servico.precoAvulso` — o preço de REFERÊNCIA
DA CASA. Desde 2026-08-18 a oferta não tem barbeiro nenhum (§8.14): existe um preço de
pacote para todos, então a economia exibida é a mesma para todos. Override de barbeiro
(§3.2.2) vale para avulso, não para o catálogo de pacotes.

**Invariantes:**
- `nome` não-vazio.
- `composicao` tem ao menos um item; toda `quantidade` inteiro positivo.
- `preco` > 0.
- `preco` **não pode ser maior** que a soma dos preços de referência da composição — um
  "pacote" mais caro que comprar os mesmos serviços separado é erro de cadastro, não um
  desconto negativo.

**Autorização (2026-08-18): cadastro é ADMIN-ONLY.** Sem dono, não existe "as minhas
ofertas" para escopar — catálogo da empresa é responsabilidade do admin. O workflow de
aprovação (§4.3) continua: a oferta nasce PENDENTE e só aparece no funil depois de
APROVADA, o que na prática virou um "rascunho → publicado" (a trava que impede uma oferta
pela metade cair no funil público).

**A vitrine pública é sempre a empresa inteira** (`listarPorEmpresa`), independente de
qual barbeiro o cliente escolheu no funil.

**Uso na venda:** `expandirServicoIds()` repete cada `servicoId` da composição pela
`quantidade` — o mesmo array plano que `VenderPacoteUseCase` já aceitava antes desta
sessão (nenhuma mudança na assinatura do rateio, §3.6).

---

### 3.12 `Vale` (raiz) — adiantamento de comissão (sessão de vale/pagamento)

Item que estava explicitamente **fora de escopo** (§11, "só faz sentido com barbeiro
contratado; hoje o único barbeiro é sócio") — entrou nesta sessão porque a operação real
passou a ter barbeiro contratado pedindo adiantamento, deixando de ser hipotético.

| Campo | Tipo | Nota |
|---|---|---|
| `id` | ValeId | |
| `companyId` | CompanyId | |
| `barbeiroId` | BarbeiroId | quem solicitou/vai receber |
| `valor` | Dinheiro | sempre positivo |
| `motivo` | string \| null | opcional, do barbeiro, na solicitação |
| `status` | `PENDENTE` \| `APROVADO` \| `PAGO` \| `NEGADO` | ver máquina de estado, §4.4 |
| `solicitadoEm` | Timestamp | |
| `decididoPorId` | BarbeiroId \| null | admin que aprovou ou negou |
| `decididoEm` | Timestamp \| null | |
| `motivoNegacao` | string \| null | obrigatório quando NEGADO |
| `pagoPorId` | BarbeiroId \| null | admin que confirmou a entrega do dinheiro |
| `pagoEm` | Timestamp \| null | |

**Regra crítica: o débito no ledger nasce SÓ na transição APROVADO→PAGO**, nunca na
aprovação — um vale aprovado mas não pago é compromisso, não dinheiro movido, e o ledger
só registra dinheiro que se moveu de fato (§3.7). `Vale` e o `LancamentoComissao`
resultante mudam juntos na mesma transação (dois agregados, atomicidade exigida — §2.2).

**Autorização:** barbeiro (inclusive não-admin) solicita e vê **só os próprios** vales;
só admin vê todos, aprova, nega e marca como pago. Um admin que TAMBÉM é o barbeiro dono
do vale PODE aprovar/pagar o próprio (mesma decisão consciente já tomada pra aprovação de
`PacoteOferta`, §3.11/§4.3 — sem isso o fluxo trava com um único admin/barbeiro real).

**Pagamento da casa ao barbeiro** (`LancamentoComissao` tipo=PAGAMENTO) é mais simples e
**não** tem agregado próprio: é uma ação direta do admin (valor livre, sem aprovação
prévia), registrada como lançamento único no ledger, com `registradoPorId` para
auditoria. **Sem trava de saldo** — decisão do dono: o ledger reflete o que foi pago de
verdade, mesmo que o saldo fique negativo; não há validação "não pode pagar mais que o
saldo".

---

### 3.13 `ItemDeOrderBump` (raiz) — sessão 2026-08-17, Parte 2

Parametrização de um item na vitrine "Adicione à sua visita" do funil (§8.13): **merchandising**,
não cadastro. `Servico`/`Produto` respondem "o que a casa oferece e por quanto no geral"; este
agregado responde "o que é empurrado no fechamento do pedido, com que oferta".

| Campo | Tipo | Nota |
|---|---|---|
| `id` | ItemDeOrderBumpId | |
| `companyId` | CompanyId | |
| `tipo` | SERVICO \| PRODUTO | discriminador da referência |
| `referenciaId` | ServicoId \| ProdutoId | conforme `tipo` |
| `ativo` | boolean | aparece na vitrine do funil |
| `precoPromocional` | Dinheiro \| null | preço FINAL no bump. `null` = sem oferta, cobra o normal |
| `mensagem` | string \| null | chamada customizável ("Leve pra casa por só R$X"), máx. 90 |
| `ordem` | int ≥ 0 | ordem de exibição; empate desempata por nome |

**Por que tabela própria em vez de mais colunas em `Servico`/`Produto`:** a configuração e as
invariantes são as MESMAS para os dois tipos — duplicá-las nos dois agregados seria a mesma regra
implementada em dois lugares (§10). A relação é polimórfica de propósito (`tipo` + `referenciaId`,
sem FK): duas FKs nuláveis exigiriam uma checagem de "exatamente uma preenchida"; a existência é
validada na aplicação, que já carrega o catálogo de qualquer forma.

**Invariantes:**
- `precoPromocional`, quando presente: **> 0** e **≤ preço de catálogo** do item — oferta que
  ultrapassa o preço normal é acréscimo disfarçado, não desconto. (Brinde a R$0 é recusado: decisão
  consciente, não foi pedido.)
- `mensagem` aparada; vazia vira `null`. `ordem` inteiro não-negativo.

**`precoDeVenda(precoBase)` é o único lugar onde o preço do bump é decidido** — usado tanto pela
vitrine pública quanto pelo caso de uso que cobra, para serviço e para produto. Aplica
`min(promocional, precoBase)`, então promoção nunca vira acréscimo mesmo com preço por barbeiro
mais baixo que o promocional (§3.2.2). Ver a regra completa em §8.13.

O que se persiste é sempre o preço final em centavos; o "−30%" mostrado é **derivado** de
(preço base, promocional) — mesma disciplina de `PacoteOferta` (§3.11).

**Migração:** substituiu `Servico.sugeridoNoBump`/`Produto.sugeridoNoBump` (Parte 1 da mesma
sessão). A migration copiou todo `sugeridoNoBump = true` para cá; as colunas antigas ficaram no
banco, deprecadas e sem leitor, só para rollback seguro — remover numa migration futura
(DECISOES_PENDENTES).

---

### 3.14 Imagens de upload — foto de barbeiro e de produto (2026-08-19)

Resolve a DECISAO_PENDENTE #4 ("o protótipo mostra foto do profissional, mas o agregado não
modela foto").

**Onde a foto mora:** num bucket S3 **separado** dos três buckets de frontend. Não é preferência
de organização — o deploy dos frontends roda `aws s3 sync --delete`, que apagaria qualquer foto
guardada junto. Bucket público para LEITURA (o funil mostra a foto sem autenticar), escrita só
pela credencial IAM do backend (cadeia padrão do SDK, IAM Role em produção).
Configuração: `UPLOADS_BUCKET`, `UPLOADS_REGION`, `UPLOADS_BASE_URL` (opcional).

**O que o domínio guarda:** a **URL pública**, nada mais. `Barbeiro` e `Produto` não sabem o que
é um bucket. Os dois expõem o mesmo par de operações, e a assinatura é a regra:

```
definirFoto(url) -> URL anterior (ou null)
removerFoto()    -> URL anterior (ou null)
```

**Devolver a anterior em vez de apagá-la** é o que mantém o domínio sem I/O: quem chama é que
apaga o objeto (`GerenciarFotoUseCase`). Sem isso, ou o agregado faria rede, ou cada troca de
foto deixaria um objeto órfão no bucket — vazamento silencioso que só aparece na fatura.

**Ordem da troca (importa):** sobe a nova → aponta o agregado → **salva** → só então apaga a
antiga. Se o upload falhar, o dono continua com a foto que tinha; se o banco falhar, a foto
antiga ainda é a que vale, e apagá-la deixaria o registro apontando para um objeto morto.
Apagar a antiga **nunca** derruba a operação: falha ali vira log, porque a troca já deu certo.

**Validação — não confie no cliente.** Nome do arquivo, extensão e `Content-Type` vêm todos do
navegador de quem envia; qualquer um renomeia um script para `.jpg`. O que é checado é o
**conteúdo**: assinatura de bytes (magic bytes) de JPEG/PNG/WebP, e teto de 8 MB conferido
**antes** de qualquer decodificação. Recusa vira 422 com mensagem escrita para o usuário final
("Envie JPG, PNG ou WebP"), nunca 500.

**Otimização (`modules/storage/infrastructure/s3-armazenamento.ts`):** toda imagem sai como
**WebP, no máximo 512×512 (`fit: cover`, sem ampliar), qualidade 80**, com a orientação do EXIF
já aplicada. As duas fotos que existem aparecem em avatar redondo e miniatura de card — nenhuma
passa de ~120 px na tela, e 512 dá folga para retina. Foto de celular de 3–5 MB vira 20–40 KB:
é o que o cliente baixa no 4G da rua.

**Nome do objeto:** `pasta/uuid.webp` (`barbeiros/`, `produtos/`). UUID, **nunca** o nome que veio
do usuário — nome de cliente traz acento, espaço, `../`, e sobrescreve o arquivo de outra pessoa
se colidir. Aleatório também impede varrer o bucket adivinhando nomes. Chave nova a cada troca é
o que torna seguro marcar `Cache-Control: immutable`.

**Permissão:** foto de barbeiro é editada pelo **admin ou pelo próprio** (mesma régua do resto da
gestão de usuário); foto de produto é **admin-only**, como todo o catálogo.

**Fallback (invariante de UI):** foto é sempre opcional. Sem foto — **ou com a foto quebrada**, se
o objeto sumir do bucket — a interface mostra as iniciais (pessoa) ou um placeholder (produto).
Imagem quebrada na tela do cliente não é estado aceitável em lugar nenhum.

---

### 3.15 Home do painel — projeção de leitura (2026-08-19)

Primeira tela depois do login. **Não é um agregado nem uma fonte de verdade**: é uma projeção de
leitura sobre o que já existe, com uma única métrica calculada (o ticket médio).

**Duas variantes, por papel — nunca uma mistura.** ADMIN vê a home de GESTÃO; BARBEIRO não-admin
vê a PESSOAL. Quem acumula os dois papéis vê a de gestão (a visão pessoal continua nas seções).
São dois endpoints separados, e o de gestão é `@Papeis(ADMIN)`: um barbeiro comum não alcança dado
de gestão nem adivinhando a rota. Na home pessoal o `barbeiroId` vem do TOKEN, não da URL — não
existe "home pessoal de outro barbeiro" para pedir.

**A regra que rege a tela:** nenhum número da home pode divergir da seção detalhada
correspondente. Por isso o saldo do barbeiro é lido do **mesmo** `ComissaoQueryService` que o
Financeiro usa, e não de uma soma nova. Duas somas do mesmo dinheiro em dois lugares é como elas
começam a divergir.

#### Faturamento — de quais registros soma

    atendimentos CONCLUÍDOS no período (Σ ItemAtendido.valorCobrado + Σ ItemProdutoAtendido)
  + vendas avulsas de produto no período (Σ item.valorUnitario × quantidade)

Valores **congelados** no atendimento (§3.5) — nunca relidos do catálogo de hoje.

**Venda de PACOTE não entra**: o dinheiro do pacote aparece quando o crédito é consumido, no
atendimento. Contar também na venda somaria o mesmo dinheiro duas vezes (DECISOES_PENDENTES #44).

#### Ticket médio — a única métrica calculada

    ticket = faturamento do MÊS CORRENTE ÷ atendimentos CONCLUÍDOS no mês corrente

Mesmo faturamento definido acima — "faturamento da visita" é serviço(s) + produto(s). Centavos
inteiros, arredondado ao centavo mais próximo (a média de inteiros raramente é inteira). **Sem
atendimento concluído no mês, o resultado é `null`**, que a tela mostra como "—": dividir por zero
daria `Infinity`, e a barbearia veria um número sem sentido em vez de "ainda não houve movimento".

É número de **exibição**: não vira lançamento, não é somado a nada, não é base de pagamento a
ninguém. Se um dia virar base de pagamento, a regra de arredondamento passa a ser decisão do
negócio, não do `Math.round` (está escrito assim em `ticket-medio.ts`).

#### Pendências

O que espera decisão do admin: `VendaDePacote` em `AGUARDANDO` e `Atendimento` em `RESERVADO` —
exatamente as duas coisas que têm botão "confirmar pagamento recebido" no painel.

---

## 4. Máquinas de estado

Estados são **explícitos**. Nunca representar estado com combinação de flags booleanas ou
soft-delete (foi assim que a v1 acabou com cancelamento representado de duas formas ao mesmo tempo).

### 4.1 `Atendimento`

Sessão de OTP+reserva (Problema 2): avulso ONLINE nasce `RESERVADO` (temporário), não
`AGENDADO` — vira firme só quando o pagamento confirma, ou expira sozinho se não confirmar a
tempo. Presencial continua nascendo `AGENDADO` direto, como sempre.

```
   ┌────────────┐  pagamento     ┌─────────────┐
   │ RESERVADO  │ ─confirmado──▶ │  AGENDADO   │◄── presencial nasce direto aqui
   └──────┬─────┘                └──────┬──────┘
          │ timeout                     │
          ▼                ┌────────────┼───────────────┐
   ┌──────────────┐        ▼            ▼               ▼
   │ RESERVA_     │ ┌────────────┐┌────────────┐  ┌────────────┐
   │ EXPIRADA     │ │ CONCLUIDO  ││ CANCELADO  │  │ NAO_COMPA- │
   └──────────────┘ │            ││ (c/ motivo)│  │  RECEU     │
      (final)       └────────────┘└────────────┘  └────────────┘
                        (final)      (final)          (final)
```

Trava de conclusão antecipada (2026-08-20): o caminho `AGENDADO → CONCLUIDO` acima é o do
barbeiro concluindo na hora (ou depois). Concluir **antes** do horário marcado passa por um
desvio, e é o admin que fecha:

```
   ┌─────────────┐  conclui antes do horário   ┌────────────────────┐  aprova   ┌────────────┐
   │  AGENDADO   │ ───(motivo obrigatório)───▶ │ CONCLUSAO_PENDENTE │ ────────▶ │ CONCLUIDO  │
   └─────────────┘                             └────────────────────┘  (admin)  └────────────┘
          ▲                                               │                        (final)
          └──────────────── recusa (admin) ───────────────┘        ↑ só aqui nasce a comissão
```

- `RESERVADO → AGENDADO` (`confirmarReserva`): pagamento online confirmado (webhook
  `transparent.completed` ou `confirmar-demo`, §3.8). Só agora emite `AtendimentoAgendado` — não
  na criação da reserva, pra nunca notificar "você está agendado" antes de existir pagamento
  algum (Fase 2 de notificação, ainda não construída, mas o evento já existe pra ela plugar).
- `RESERVADO → RESERVA_EXPIRADA` (`expirarReserva`): prazo (`reservaOnlineExpiraEm`) vencido sem
  pagamento — libera o horário (não conflita mais, §2.1). Sempre disparado na MESMA transação em
  que a `IntencaoDePagamento` vinculada expira (`ExpirarPagamentoVencidoUseCase`), nunca isolado —
  senão intenção e reserva podem divergir (uma expirada, a outra não).
- `AGENDADO → CONCLUIDO`: emite `AtendimentoConcluido`. Exige `formaPagamento` se `AVULSO`.
- `AGENDADO → CONCLUSAO_PENDENTE` (`solicitarConclusaoAntecipada`, 2026-08-20): o barbeiro
  concluiu um atendimento cujo **horário ainda não chegou** e justificou (motivo obrigatório,
  não-vazio). **Não emite evento nenhum** — nenhuma comissão nasce, nenhum crédito de pacote é
  consumido. Era exatamente isso que a trava existe pra impedir: concluir a agenda da semana em
  série e inflar a comissão. A `formaPagamento` é validada e **guardada** no pedido
  (`conclusaoFormaPagamento`), não aplicada: quem sabe como o cliente pagou é o barbeiro, e
  descobrir que falta só na hora da aprovação deixaria o pedido travado sem quem resolvesse.
  Ocupa o horário exatamente como `AGENDADO` (invariante + `EXCLUDE`), porque a recusa devolve
  o atendimento pra lá e o horário precisa estar esperando.
  **Quem** precisa justificar é política de aplicação, não invariante: admin conclui direto — é
  ele quem aprovaria, e justificar pra si mesmo não protege ninguém.
- `CONCLUSAO_PENDENTE → CONCLUIDO` (`aprovarConclusaoAntecipada`, admin): **é aqui que o dinheiro
  nasce.** Só neste ponto sai o `AtendimentoConcluido` (comissão) e o crédito de pacote vira
  `CONSUMIDO`, na mesma transação. Usa a `formaPagamento` guardada no pedido.
  O **motivo, o autor e o instante do pedido permanecem** no atendimento concluído — é o rastro
  auditável de que aquela conclusão não aconteceu na hora marcada, e por quê. Apagar seria
  perder justamente o fato que a trava existe pra vigiar.
- `CONCLUSAO_PENDENTE → AGENDADO` (`recusarConclusaoAntecipada`, admin): volta como se o pedido
  não tivesse existido; os quatro campos do pedido são limpos. Não é estado final — o
  atendimento pode ser concluído normalmente quando a hora chegar.
- `AGENDADO → CANCELADO`: exige motivo. Emite `AtendimentoCancelado` com `antecipado: boolean`
  (`true` se cancelado antes do horário marcado) — usado pelo handler de Pacote para decidir se o
  item associado conta falta (§3.5, §4.2).
- `AGENDADO → NAO_COMPARECEU`: emite `ClienteFaltou`.
- **Estados finais não transicionam.** Reagendar = criar um novo `Atendimento`, não mutar o antigo.
  (Isso preserva a auditoria: o histórico mostra que houve uma falta.) `RESERVA_EXPIRADA` é final
  igual aos outros — uma reserva morta nunca revive, nem por um webhook tardio.

### 4.2 `ItemDoPacote`

Esta é a máquina de estado mais sutil do sistema. Ela existe porque a regra de negócio real
(validada na operação) é: **o cliente tem direito a uma segunda chance, com prazo.**

```
   ┌──────────────┐
   │  DISPONIVEL  │◄─────────────────────┐
   └──────┬───────┘                      │
          │ agenda                       │ cancela ANTES do horário marcado
          ▼                              │ (não conta falta — ver nota abaixo)
   ┌──────────────┐                      │
   │   AGENDADO   ├──────────────────────┘
   └──────┬───────┘
          │
    ┌─────┴──────┬─────────────────┐
    ▼            ▼                 ▼
┌─────────┐  ┌────────────────────────┐
│CONSUMIDO│  │  falta / cancelamento  │
│ (final) │  │      tardio            │
└─────────┘  └───────────┬────────────┘
                         │
              faltasComputadas += 1
                         │
          ┌──────────────┴──────────────┐
          │                             │
   faltas == 1                    faltas == 2
          │                             │
          ▼                             ▼
  ┌────────────────┐            ┌──────────────┐
  │ SEGUNDA_CHANCE │            │   EXPIRADO   │
  │ (prazo: N dias)│            │   (final)    │
  └───────┬────────┘            └──────┬───────┘
          │                            │
    ┌─────┴─────┐                      │ valorRateado migra para
    │           │                      ▼ pacote.saldoResidual
 reagenda   prazo estoura      (INVARIANTE: soma continua == valorPago)
    │           │
    ▼           ▼
AGENDADO    EXPIRADO
```

**Cancelamento antecipado — para onde volta:** a seta do diagrama simplifica um detalhe. O
retorno não é sempre para `DISPONIVEL`:
- **0 faltas** → volta para `DISPONIVEL`.
- **1 falta** (item já tinha passado por `SEGUNDA_CHANCE` e foi reagendado) → volta para
  `SEGUNDA_CHANCE`, **preservando o `prazoReagendamentoAte` original**. Voltar para `DISPONIVEL`
  apagaria o prazo e deixaria o cliente escapar da expiração agendando e cancelando em loop.

"Antes do horário marcado" é definido operacionalmente como: o cancelamento do `Atendimento`
vinculado aconteceu antes do `intervalo.inicio` agendado (`AtendimentoCancelado.antecipado`,
§3.5). Cancelamento depois do horário, ou não-comparecimento, sempre conta falta.

**Parâmetros (`ParametrosDaEmpresa`, armazenados em `Company`):**
- `prazoReagendamentoDias`: **10 dias civis** no fuso da empresa (`Company.timezone`),
  parametrizável pelo admin. Vence no **fim do dia civil local** — não é `hoje + 10×24h` (§2.6).
- Máximo de faltas antes de expirar: **1** (na segunda, expira).

**Sobre `saldoResidual`:** quando um item expira, seu `valorRateado` **não desaparece** — migra para
`pacote.saldoResidual`, e `saldoResidualDesde` é atualizado para o instante da expiração. O cliente
não perde o dinheiro; perde aquele *serviço específico*.

**Aplicação do saldo (sessão-E, §8.7):** o cliente decide sozinho, pelo cockpit, entre abater o
saldo num novo agendamento avulso ou pedir reembolso manual — ver §8.7 para as duas regras.

**Expiração por prazo** é verificada por um job agendado (cron diário) que varre itens em
`SEGUNDA_CHANCE` com `prazoReagendamentoAte < hoje`. Como `prazoReagendamentoAte` já foi congelado
como o instante absoluto correto (fim do dia civil local, calculado com o fuso da empresa no
momento da falta — §2.6), essa comparação é UTC puro: o job não precisa reconhecer fuso de novo, e
o horário exato em que ele roda não afeta a correção do resultado (rodar antes do prazo não expira
nada; depois, expira exatamente o que deveria). Não é um trigger em tempo real.

---

### 4.3 `PacoteOferta` — workflow de aprovação (sessão-B, Fase 3)

```
┌───────────┐  enviarParaAprovacao   ┌─────────────────────┐
│ RASCUNHO  ├───────────────────────►│  PENDENTE_APROVACAO │
└───────────┘                        └──────────┬───────────┘
                                     aprovar │       │ rejeitar(motivo)
                                             ▼       ▼
                                      ┌───────────┐ ┌────────────┐
                                      │ APROVADO  │ │ REJEITADO  │
                                      └─────┬─────┘ └─────┬──────┘
                                            │ editar       │ editar
                                            └──────┬───────┘
                                                   ▼
                                        volta pra PENDENTE_APROVACAO
```

- **Criar** já nasce em `PENDENTE_APROVACAO` (regra: "barbeiro cria/edita → PENDENTE").
  `RASCUNHO` existe como estado explícito da máquina, mas nada no fluxo padrão desta
  sessão o produz automaticamente — só é alcançável passando o status explicitamente.
  `// DECISAO_PENDENTE`: se deveria existir uma ação de UI "salvar rascunho" separada
  de "enviar pra aprovação" (não estava especificado — ver DECISOES_PENDENTES).
- **Só `APROVADO` aparece no funil público.** `PENDENTE_APROVACAO`, `REJEITADO` e
  `RASCUNHO` só são visíveis no admin.
- **`aprovar()`/`rejeitar(motivo)`** só saem de `PENDENTE_APROVACAO` — chamar de
  qualquer outro estado é `TransicaoDeEstadoInvalidaError`. `rejeitar` exige motivo
  não-vazio (`motivoRejeicao`).
- **Editar um pacote `APROVADO` ou `REJEITADO` volta para `PENDENTE_APROVACAO`**
  (limpando `motivoRejeicao`) — precisa passar pelo admin de novo. Editar um
  `RASCUNHO` ou um já `PENDENTE_APROVACAO` mantém o mesmo estado (editar não publica
  sozinho; editar um pendente não pula fila).
- **Autorização:** só ADMIN aprova/rejeita. Um admin que TAMBÉM é o barbeiro dono do
  pacote **pode aprovar o próprio** — nenhuma checagem de "dono não pode aprovar a si
  mesmo" é feita **de propósito**: sem isso, o fluxo trava com um único
  admin+barbeiro real (caso do Gabriel, hoje o único admin que também atende).

---

### 4.5 Status no Bigod's Club — DERIVADO, não armazenado (2026-08-21)

```
                        compra pacote pago
   ┌──────────────┐  ────────────────────────►  ┌───────────────┐
   │  NAO_MEMBRO  │      ENTROU_CLUBE /         │ MEMBRO_ATIVO  │
   │              │  ◄──────  RENOVOU  ─────────│ (crédito vivo)│
   └──────────────┘                             └───────┬───────┘
          ▲                                             │ acabou o crédito
          │ marcou avulso                               │ (consumido/expirado)
          │ estando sem crédito                         ▼
          │  SAIU_CLUBE                         ┌────────────────┐
          └─────────────────────────────────────│ MEMBRO_INATIVO │
                                                │ (sem crédito,  │
                    compra de novo (RENOVOU)    │  ainda membro) │
                    ◄───────────────────────────└────────────────┘
```

**★ O status NUNCA é uma coluna.** É calculado a cada leitura por `statusDoClube()` (função
pura), a partir dos pacotes e dos avulsos do cliente. Um campo `status` divergiria do cálculo na
primeira vez que alguém esquecesse de atualizá-lo; um cálculo não tem com o que divergir.

Regras, e o que cada uma protege:

- **`MEMBRO_ATIVO`** — tem crédito VIVO em pacote **PAGO**. Vivo = `DISPONIVEL`,
  `SEGUNDA_CHANCE` **ou `AGENDADO`**. A regra falada é "crédito disponível", e `AGENDADO`
  literalmente não está disponível — mas quem tem visita de pacote marcada é o oposto de
  esgotado, e rebaixá-lo (com "renove!" na tela) enquanto o crédito está em voo seria errado. O
  crédito volta a `DISPONIVEL` se ele cancelar.
- **Esgotar ou expirar NÃO expulsa:** vai para `MEMBRO_INATIVO` e **continua no clube** — inclusive
  visualmente, mantendo o tema.
- **Pacote ativo PROTEGE:** um avulso marcado por quem tem crédito não muda nada, **nem mais
  tarde**. É por isso que a comparação usa `Atendimento.criadoEm` (quando foi MARCADO) e não
  `inicio` (quando acontece): com `inicio`, um avulso marcado sob proteção e agendado pra frente
  passaria a rebaixar o cliente assim que os créditos acabassem.
- **O avulso só rebaixa quem já estava sem crédito:** `MEMBRO_INATIVO` + avulso marcado depois do
  instante em que o último crédito morreu → `NAO_MEMBRO`. Esse instante é **gravado**
  (`ItemDoPacote.deixouDeExistirEm`), no consumo ou na expiração.
  Ele já foi derivado do `fim` do atendimento que consumiu, e isso deu bug em produção
  (2026-08-21): concluir hoje quatro atendimentos marcados pra semana que vem fazia os créditos
  "morrerem" na semana que vem, então nenhum avulso marcado no meio rebaixava o cliente — ele
  ficava membro para sempre. Concluir antes do horário é rotina (§4.1), então o `fim` nunca foi um
  proxy aceitável do instante do consumo.
- **Renovar** (comprar pacote) de `INATIVO` ou `NAO_MEMBRO` → `MEMBRO_ATIVO`.
- **Pacote não pago não faz membro:** crédito de pacote `AGUARDANDO` ainda não existe.
- Sem rastro de quando o crédito morreu (dado antigo), fica `MEMBRO_INATIVO`: o erro de manter um
  membro é menor que o de expulsar quem não pediu para sair.

#### Log de eventos (`EventoDoClube`) — append-only

Cada transição REAL grava uma linha: `ENTROU_CLUBE`, `VIROU_INATIVO`, `SAIU_CLUBE`, `RENOVOU`, com
data, status anterior/novo e a causa em texto. **Nunca é atualizado nem apagado.**

O log é **histórico e auditoria** — base para as métricas de retenção que virão (quantos inativos
renovam vs. viram avulso). **Não há relatório ainda**, por decisão. E o status atual **não é lido
daqui**.

A gravação é feita por um **reconciliador** (`SincronizarStatusDoClubeUseCase`), chamado depois de
qualquer fato que possa mudar o status: calcula o status, compara com o último registrado e grava
só se mudou. Isso dá **idempotência de graça** — rodar duas vezes não grava duas linhas.

**Consequência a dizer em voz alta:** se nenhum evento disparar a reconciliação, o log **atrasa**
(a linha aparece no próximo fato daquele cliente), mas o status mostrado nunca fica errado, porque
é calculado na leitura. Falha ao gravar o log é logada e engolida: derrubar a compra de um pacote
porque a linha de histórico não entrou seria pior que um log incompleto.

### 4.4 `Vale` (sessão de vale/pagamento)

```
                    aprovar               marcarPago
   PENDENTE ───────────────────► APROVADO ───────────► PAGO (final)
      │
      │ negar(motivo)
      ▼
   NEGADO (final)
```

- **Só transições explícitas acima existem.** Não há `APROVADO → NEGADO` (reverter uma
  aprovação) nem `PENDENTE → PAGO` direto (pular a aprovação) — chamar qualquer transição
  fora do diagrama é `TransicaoDeEstadoInvalidaError`.
- **`negar(motivo)`** exige motivo não-vazio (`motivoNegacao`), mesma disciplina de
  `PacoteOferta.rejeitar` (§4.3).
- **`marcarPago` é a ÚNICA transição que afeta o ledger** — só ali nasce o
  `LancamentoComissao` tipo=VALE (§3.7/§3.12). `aprovar` não move dinheiro nenhum.
- **Autorização:** barbeiro (inclusive não-admin) só **cria** a própria solicitação; só
  admin aprova/nega/paga — inclusive o próprio, quando admin+barbeiro (mesma decisão de
  `PacoteOferta`, acima). O backend impõe isso via guard de papel — não é só a UI que
  esconde os botões.
- **`// DECISAO_PENDENTE`**: não há transição de "cancelar" um vale `PENDENTE` (o
  próprio barbeiro desistir do pedido) nem de reverter um `APROVADO` de volta pra
  `PENDENTE` — não foi pedido nesta sessão; ver DECISOES_PENDENTES.

---

## 5. Eventos de domínio

Emitidos pelos agregados, tratados por handlers. **In-process** no MVP (event emitter do Nest,
sem broker/fila).

| Evento | Emissor | Handlers (MVP) | Handlers (futuro) |
|---|---|---|---|
| `AtendimentoAgendado` | Atendimento | — | notificação de confirmação |
| `AtendimentoConcluido` | Atendimento | **Payroll:** cria `LancamentoComissao` | métricas, fidelidade |
| `AtendimentoCancelado` | Atendimento | **Pacote:** se origem=crédito, libera item | notificação |
| `ClienteFaltou` | Atendimento | **Pacote:** computa falta no item | métrica de no-show |
| `PacoteVendido` | VendaDePacote | **Identity:** promove Cliente a usuário Cognito | — |
| `ItemDoPacoteExpirado` | VendaDePacote | migra valor p/ saldoResidual | notificação ao cliente |
| `PagamentoConfirmado` | IntencaoDePagamento | libera pacote/atendimento | recibo |
| `VendaDeProdutoRegistrada` | VendaDeProduto | **Payroll:** cria `LancamentoComissao` (origem PRODUTO) | métricas de revenda |

`AtendimentoCancelado` carrega `antecipado: boolean` (cancelado antes do horário marcado) — o
handler de Pacote usa isso para decidir entre liberar o item sem falta ou computar falta (§4.2).

**Regra:** um agregado **nunca** chama outro agregado diretamente. A comunicação entre agregados é
via evento (assíncrono conceitualmente, síncrono na execução MVP) ou via orquestração explícita na
camada de aplicação (quando precisa de transação — ver §2.2).

---

## 6. Camadas e regra de dependência

```
┌─────────────────────────────────────────────────┐
│  APRESENTAÇÃO (controllers, DTOs de I/O)        │
│  NestJS. Fino. Zero regra de negócio.           │
└────────────────────┬────────────────────────────┘
                     │ depende de ↓
┌────────────────────▼────────────────────────────┐
│  APLICAÇÃO (casos de uso / orquestração)        │
│  Transações, coordenação entre agregados.       │
│  Não contém regra de negócio — coordena.        │
└────────────────────┬────────────────────────────┘
                     │ depende de ↓
┌────────────────────▼────────────────────────────┐
│  DOMÍNIO (agregados, VOs, eventos, interfaces)  │
│  ★ TypeScript puro. ZERO import de Nest,        │
│    Prisma, Express, ou qualquer framework.      │
│    Se você importou algo aqui, está errado.     │
└─────────────────────────────────────────────────┘
                     ▲ implementa interfaces de ↑
┌────────────────────┴────────────────────────────┐
│  INFRAESTRUTURA (Prisma, Cognito, AbacatePay,   │
│  WhatsApp, cron)                                │
│  Implementa as interfaces definidas no domínio. │
└─────────────────────────────────────────────────┘
```

**Regra de ouro:** dependências apontam **sempre para dentro**. O domínio não sabe que Prisma
existe. Ele define `interface AtendimentoRepository`; a infra implementa
`PrismaAtendimentoRepository`.

**Sobre Prisma especificamente:** os tipos gerados pelo Prisma Client **não podem vazar** para o
domínio. O repositório de infra faz o **mapeamento explícito** entre o modelo Prisma e a entidade
de domínio pura. Sim, isso é código de mapeamento a mais. É o preço de ter um domínio testável sem
banco e independente de ORM.

**Por que isso importa:** a v1 tinha `Appointment::schedule()` — toda a regra de negócio dentro de
um Model Eloquent. Não era possível testar a regra sem banco, nem trocar o ORM, nem entender o
domínio sem entender o framework. Foi o Active Record puxando a arquitetura. Aqui, o framework é um
detalhe da borda.

---

## 7. Estrutura de pastas (monorepo)

```
bigods/
├── apps/
│   ├── api/                      # NestJS
│   │   └── src/
│   │       ├── shared/
│   │       │   ├── domain/       # VOs comuns: Dinheiro, Percentual,
│   │       │   │                 # IntervaloDeTempo, Telefone, Duracao,
│   │       │   │                 # Timezone; calendario.ts (dias civis,
│   │       │   │                 # conversão local↔UTC — §2.6)
│   │       │   ├── events/       # infra de eventos de domínio
│   │       │   └── errors/       # erros de domínio tipados
│   │       │
│   │       ├── modules/
│   │       │   ├── catalog/      # Servico
│   │       │   ├── staff/        # Barbeiro, Disponibilidade, ExpedienteSemanal
│   │       │   ├── customers/    # Cliente
│   │       │   ├── scheduling/   # Atendimento  ← núcleo
│   │       │   ├── packages/     # VendaDePacote, ItemDoPacote, PacoteOferta (§3.11)
│   │       │   ├── products/     # Produto, VendaDeProduto (§3.9, §3.10)
│   │       │   ├── payroll/      # LancamentoComissao (ledger 3 direções, §3.7), Vale (§3.12)
│   │       │   ├── payments/     # IntencaoDePagamento
│   │       │   └── identity/     # Cognito, autorização
│   │       │
│   │       └── main.ts
│   │
│   ├── booking/                  # React — funil público
│   ├── account/                  # React — área do cliente
│   └── admin/                    # React — painel de gestão
│
├── packages/
│   ├── contracts/                # ★ tipos compartilhados back ↔ front
│   ├── ui/                       # design system (do Claude Design)
│   └── config/                   # eslint, tsconfig, prettier
│
└── prisma/
    └── schema.prisma
```

**Estrutura interna de cada módulo** (padrão obrigatório, sem exceção):

```
modules/scheduling/
├── domain/
│   ├── atendimento.aggregate.ts       # TS puro, zero framework
│   ├── atendimento.events.ts
│   ├── atendimento.repository.ts      # INTERFACE (não implementação)
│   └── value-objects/
├── application/
│   ├── agendar-avulso.usecase.ts
│   ├── agendar-com-credito.usecase.ts # ← transação abrangendo 2 agregados
│   ├── concluir-atendimento.usecase.ts
│   └── cancelar-atendimento.usecase.ts
├── infrastructure/
│   └── prisma-atendimento.repository.ts   # implementa a interface
└── presentation/
    ├── scheduling.controller.ts
    └── dto/
```

**`packages/contracts` é inegociável.** Na v1, cada um dos 3 frontends reimplementou seus próprios
tipos, que divergiram entre si (o mesmo `Appointment` tinha formatos diferentes em lugares
diferentes, e o app mobile contornava isso com `as any`). Um pacote de contratos compartilhado mata
essa classe inteira de bug antes que ela nasça. É a maior razão pela qual estamos indo de monorepo.

---

## 8. Casos de uso principais

### 8.1 Agendar avulso (funil público) — sessão de OTP+reserva

```
0. Exigir sessão de cliente verificada por OTP (@ContaCliente — mesmo
   mecanismo do login do cockpit). Sem sessão ativa, o front roda OTP ANTES
   deste passo (ver §8.9); o telefone usado é sempre o da sessão, nunca do
   corpo da requisição.
1. Validar serviços existem, estão ativos, e o barbeiro os atende
2. Calcular intervalo (soma das durações)
3. Validar que o intervalo cabe na disponibilidade do barbeiro
   → a disponibilidade é buscada pelo DIA CIVIL local (fuso da empresa) do
     horário pedido, nunca pelo dia UTC bruto do instante (§2.6)
4. Encontrar-ou-criar Cliente pelo telefone (da sessão, normalizado)
5. PRESENCIAL: cota de presenciais futuros ativos (§8.9) — recusa o 4º.
   ONLINE: pula a cota (pagamento já é a trava natural contra abuso).
6. Criar Atendimento
   → PRESENCIAL: nasce AGENDADO (firme) direto, como sempre foi.
   → ONLINE: nasce RESERVADO (temporário, §4.1, §8.9), não AGENDADO —
     sem isso, um PIX nunca pago prenderia o horário pra sempre.
   → invariante de sobreposição validada no domínio (cobre AGENDADO E
     RESERVADO, §2.1) — constraint EXCLUDE do Postgres como rede de segurança
6b. ONLINE: criar IntencaoDePagamento (AGUARDANDO), expiraEm = MESMO instante
    de Atendimento.reservaOnlineExpiraEm (nunca duas chamadas a "agora",
    senão intenção e reserva podem divergir por milissegundos)
7. ONLINE: chamar AbacatePay pedindo expiresIn = essa mesma janela, retornar QR Code

TUDO em UMA transação (passos 4-6b).
Sem essa transação, repetimos o bug da v1: cliente criado, agendamento falhou, órfão no banco.
```

### 8.1.1 O nome do cliente é do CLIENTE, não do funil (2026-08-21)

Todo agendamento reescrevia o nome do `Cliente` com o que estivesse digitado no funil. O argumento
era que "o funil é a única fonte da verdade sobre o nome, então ele sempre vence" — na prática isso
deixava o cadastro à mercê de qualquer agendamento: um apelido, um erro de digitação, ou alguém
marcando pra outra pessoa, e o registro de quem já era cliente ia junto. Reportado como problema
real pelo dono.

**Regra atual:** `Cliente.adotarNomeSeAusente(nome)` — o funil **completa** quem ainda tem o
placeholder que o login por OTP deixa (§8.9), e **nunca sobrescreve** quem já tem nome.
`renomear()` continua existindo, mas sem chamador no funil: é o que uma futura edição de perfil vai
usar.

**Consequência a dizer em voz alta:** enquanto não existir edição de perfil, um cliente cadastrado
com o nome errado não consegue corrigir sozinho — só o admin, pelo painel. Antes ele "corrigia"
reagendando; era esse mesmo mecanismo que permitia a bagunça.

#### O passo de dados, em duas fases

O funil pergunta o **telefone primeiro**, e é ele que decide o resto:

```
   telefone  ─→  GET /public/clientes/conhecido  ─→  { conhecido: boolean }
                                │                              │
                   conhecido ───┘                              └─── não conhecido
                        │                                              │
                   OTP  │  "Confirme que é você"                       │
                        ▼                                              ▼
              nome vem do CADASTRO                          pede nome + opcionais
           (não é perguntado nem sobrescrito)
```

- **★ O endpoint devolve um BOOLEANO, nunca o nome.** O nome só aparece depois que o cliente prova
  posse do telefone pelo OTP — senão qualquer um digitaria números para descobrir quem está por
  trás deles.
- **Quem só fez login (placeholder) NÃO conta como conhecido.** Dizer "conhecido" ali faria o funil
  pular o campo de nome e cristalizar o placeholder.
- **Cliente conhecido faz OTP mesmo no fluxo online**, que hoje dispensa OTP (§8.1). Não é
  contradição: a dispensa vale para quem está criando um cadastro novo; usar a identidade de alguém
  que já existe exige provar que é essa pessoa.
- O endpoint continua sendo um oráculo de "este número é cliente da casa", e tem limite agressivo
  por origem. Registrado em DECISOES_PENDENTES.

### 8.2 Agendar consumindo crédito (área logada)

```
1. Autenticar (Cognito)
2. Carregar VendaDePacote do cliente
3. Selecionar UM OU MAIS ItemDoPacote (status DISPONIVEL ou SEGUNDA_CHANCE),
   todos do MESMO pacote  ← "monte sua visita" (2026-08-21)
4. Validar disponibilidade e conflito de horário
   → contra o intervalo TOTAL: soma das durações dos serviços escolhidos
   → mesma regra de dia civil local do §8.1 (§2.6)
5. TRANSAÇÃO:
   a. Para CADA crédito: VendaDePacote.agendarItem(itemId, atendimentoId)
      → todos viram AGENDADO, apontando para o MESMO atendimento
   b. Criar Atendimento (origem=CREDITO_PACOTE) com UM ItemAtendido POR CRÉDITO,
      cada um com valorCobrado = item.valorRateado ← NÃO o preço avulso,
      NÃO um total combinado
6. Sem pagamento. Confirmar explicitamente ao cliente que nada será cobrado.
```

**Vários créditos numa visita (2026-08-21).** Um pacote "2 cortes + 2 barbas" tem quatro créditos
individuais. Fazer corte+barba numa ida exigia DOIS agendamentos — para o cliente foi UMA visita.
Agora um agendamento consome vários créditos: um atendimento, mesmo barbeiro, mesmo horário.

A solução ficou no AGENDAMENTO, não no catálogo: criar um serviço "corte+barba" reviveria os combos
removidos na Onda 1, proliferaria catálogo e destruiria a granularidade de rateio e comissão.

- **Só créditos do MESMO pacote** numa visita (decisão do dono). Misturar pacotes evolui depois, se
  surgir necessidade.
- **★ A duração é a SOMA.** Corte (30) + barba (20) = bloco de 50 min. Quem calcula é
  `Atendimento.agendar()`, que já somava as durações dos itens — a invariante de sobreposição e a
  constraint `EXCLUDE` do Postgres validam contra o intervalo TOTAL, então uma visita de 50 min não
  cabe num vão de 30 min nem atropela o próximo cliente. A projeção pública de horários (§2.1) só
  oferece o horário onde o bloco inteiro cabe.
- **★ Rateio e comissão continuam INDIVIDUAIS.** Um `ItemAtendido` por crédito, com o `valorRateado`
  congelado daquele item; a conclusão gera um `LancamentoComissao` por crédito, cada um pelo seu
  valor rateado. **Nunca existe "item combo"** — agendar junto é experiência, o ledger não muda.
- **Um crédito por serviço na visita.** Dois créditos do mesmo serviço são recusados: além de não
  fazer sentido operacional, a projeção de horários calcula a duração sobre os serviços DISTINTOS,
  e aceitar produziria silenciosamente um bloco maior que o oferecido. Ver DECISOES_PENDENTES.
- **Os créditos da visita andam JUNTOS.** Cancelar devolve todos (a regra de falta/segunda-chance do
  §4.2 é a mesma, aplicada a cada crédito — os eventos `AtendimentoCancelado`/`ClienteFaltou` já
  carregam a lista de itens). Reagendar move a visita inteira. Cancelar só um crédito da visita não
  existe — ver DECISOES_PENDENTES.

### 8.3 Concluir atendimento (painel)

```
1. Autorizar (barbeiro dono do atendimento, ou admin)
2. Atendimento.concluir(formaPagamento?)  → status CONCLUIDO
3. Emite AtendimentoConcluido
4. Handler de Payroll:
   Para cada ItemAtendido:
     percentual = barbeiro.percentualPara(item.servicoId)
     valorBase  = item.valorCobrado   ← já é o rateado, se veio de pacote
     Criar LancamentoComissao (imutável)
5. Se origem=CREDITO_PACOTE:
   VendaDePacote marca o item como CONSUMIDO (final)
```

### 8.4 Cliente falta

```
1. Barbeiro marca NAO_COMPARECEU
2. Emite ClienteFaltou
3. Se origem = CREDITO_PACOTE:
   VendaDePacote.computarFalta(itemId, dias, hoje, tz):
     - faltasComputadas += 1
     - se faltas == 1 → SEGUNDA_CHANCE, prazo = fim do dia civil local N dias
       depois de hoje (N = parametros.prazoReagendamentoDias, tz =
       Company.timezone) — não hoje + N×24h corridas (§2.6)
     - se faltas == 2 → EXPIRADO, valorRateado migra p/ saldoResidual
4. Nenhuma comissão é gerada (o serviço não foi prestado)

Mesmo caminho (`computarFalta`) é usado para cancelamento TARDIO de
`Atendimento` de origem CREDITO_PACOTE (§3.5, §4.2) — a diferença entre
"cliente faltou" e "cancelou tarde" não importa para o pacote, ambos contam
falta.
```

### 8.5 Funil público — ordem das etapas e link pessoal de barbeiro (sessão-B, Fase 4)

**Ordem das etapas (§4a):** com preço por barbeiro (§3.2.2), mostrar serviço ou pacote
antes de saber o barbeiro é mostrar preço errado. As duas trilhas do funil público agora
escolhem o barbeiro **primeiro**:

```
avulso:  LANDING → BARBEIRO → SERVIÇOS → DATA/HORA → DADOS → CONFIRMAÇÃO
pacote:  LANDING → BARBEIRO → OFERTA DE PACOTE       → DADOS → CONFIRMAÇÃO
```

A etapa BARBEIRO é pulada automaticamente quando só existe **um** barbeiro na barbearia
(mesmo espírito do skip antigo — antes calculado só depois de saber os serviços
escolhidos; agora calculado direto, já que o barbeiro vem primeiro). Depois de
escolhido, os serviços/ofertas mostrados já vêm filtrados pra esse barbeiro
(`GET /public/servicos?barbeiroId=`, `GET /public/pacotes?barbeiroId=`).

**Link pessoal do barbeiro (§4b):** `GET /public/barbeiro-por-slug?slug=` resolve um
slug pro barbeiro; o frontend usa isso pra pré-selecionar o barbeiro e pular a etapa de
escolha (ver §3.2.1 pra precedência sobre estado salvo e comportamento de slug
inválido). O funil mostra "Agendando com {nome}" com uma saída discreta ("ver outros
profissionais") só quando o barbeiro veio de um link — escolha manual ou skip por
barbeiro único não precisam de escape hatch, não há nada "preso" pra desfazer.

**Registro de origem (§4c):** quando o agendamento/venda vem de um link de barbeiro, o
funil manda `origemLinkBarbeiroId` no `POST /public/agendamentos` / `POST
/public/pacotes`, gravado em `Atendimento.origemLinkBarbeiroId` /
`VendaDePacote.origemLinkBarbeiroId`. **Isso é SÓ REGISTRO** — nenhuma regra de negócio
depende desse campo nesta sessão, e não existe tela de relatório. Motivo: é um dado que
não dá pra recuperar retroativamente (se não registrar agora, nunca mais vai saber que
aquele agendamento veio do marketing pessoal daquele barbeiro); responde depois a
"quais agendamentos vieram do link de cada barbeiro" quando/se isso virar uma pergunta
de negócio real. Não inventar métrica ou dashboard agora sobre isso.

---

### 8.6 Autonomia do cliente no cockpit — cancelar e reagendar (sessão-E)

O cliente autenticado (`ClienteAutenticado`, guard separado do staff — §7) pode cancelar ou
reagendar o **próprio** `Atendimento` sozinho, sem falar com a barbearia, dentro de uma janela de
tempo. Fora da janela, a ação fica indisponível e a mensagem orienta o WhatsApp da barbearia — **sem
inventar nenhum canal específico** (não existe integração de WhatsApp nesta sessão; é só texto).

| Ação | Janela | Parâmetro (`ParametrosDaEmpresa`, em `Company`) | Default |
|---|---|---|---|
| Cancelar | até N horas antes do horário marcado | `janelaCancelamentoHoras` | 2h |
| Reagendar | até N horas antes do horário marcado | `janelaReagendamentoHoras` | 12h |

Ambas parametrizáveis pelo admin (Ajustes), mesmo padrão de `prazoReagendamentoDias` (§4.2) —
**nunca número mágico no código**.

**Cancelar (`CancelarAtendimentoClienteUseCase`):** caso de uso PRÓPRIO (audiência e janela
diferentes do cancelamento de staff), mas reusa o **mesmo** método de domínio
`Atendimento.cancelar(motivo)` — nenhuma regra de domínio duplicada, só orquestração de aplicação
diferente. O evento `AtendimentoCancelado(antecipado=true)` dispara o handler de pacote já
existente (§4.2, §5) sem nenhuma regra nova: item de crédito volta pra `DISPONIVEL` (ou
`SEGUNDA_CHANCE`, preservando prazo, se já tinha uma falta), **nunca conta falta** — mesma regra de
cancelamento antecipado do staff.

**Reagendar (`ReagendarAtendimentoClienteUseCase`):** por baixo é **cancelar + criar novo**
(mesmo padrão do §4.1 — não existe transição de estado "reagendado" no `Atendimento`), mas para o
cliente parece só mover o horário. A janela do reagendar (12h) é **sempre maior** que a do
cancelamento (2h) por decisão de produto, o que evita qualquer conflito entre as duas checagens (o
reagendar chama o cancelamento por baixo, cujo próprio limite de 2h nunca é o que barra, já que o
reagendar barrou antes, em 12h).

- **Origem `AVULSO`:** cria o novo atendimento **primeiro**, cancela o antigo **depois** — se o
  novo horário falhar (ex.: conflito), o atendimento original nunca é perdido.
- **Origem `CREDITO_PACOTE`:** cancela **primeiro** (libera o item do pacote, que não pode ser
  consumido duas vezes enquanto `AGENDADO`), cria o novo **depois**, consumindo o **mesmo**
  `ItemDoPacote` — mesmo `valorRateado` preservado ao centavo, sem falta computada. Se o novo
  horário falhar, o crédito fica de volta em `DISPONIVEL`/`SEGUNDA_CHANCE`, o cliente pode tentar de
  novo — nunca perde o crédito.

**Em ambos os casos:** posse é sempre conferida no caso de uso (`clienteId` do token, nunca do
corpo da requisição) — tentar agir sobre agendamento de outro cliente é `403`, nunca modifica nada.

---

### 8.7 Saldo residual — abatimento em avulso e reembolso manual (sessão-E)

Depois que um `ItemDoPacote` expira (§4.2) e seu valor migra para `saldoResidual`, o cliente escolhe
**pelo cockpit** o que fazer com o dinheiro: abater num próximo agendamento avulso, ou pedir
reembolso. As duas opções nunca coexistem sobre o mesmo real — ver invariante estrutural abaixo.

**Abatimento em avulso — regra do resto (`AgendarAvulsoUseCase`, campo opcional
`abaterSaldoDeVendaId`):**

```
valorAbatido = min(venda.saldoResidual, valorTotalDoAvulso)

se saldoResidual <  preço → abate tudo (valorAbatido = saldoResidual), cliente paga a diferença,
                            saldoResidual zera
se saldoResidual >= preço → abate só o preço (valorAbatido = preço), serviço fica quitado,
                            sobra saldo (nunca abate além do necessário)
```

Calculado **antes** de criar o `Atendimento` (a ordem importa: primeiro sabe quanto abater, depois
cria o atendimento já com o abatimento no snapshot — nunca o contrário). `Atendimento` guarda
`valorAbatidoSaldo` (Dinheiro) e `vendaAbatidaId` — snapshot, igual a qualquer outro valor cobrado
(§2.4/§3.5): histórico nunca recalcula a partir do saldo atual do pacote. Na conclusão
(`ConcluirAtendimentoUseCase`), `valorAbatidoSaldo` entra na mesma lógica de netting que
`valorPagoOnline` já usava — cobra só o que sobrou depois de somar os dois. Se o cliente pediu
abatimento de uma venda cujo `saldoResidual` já é zero (porque foi todo reservado para reembolso, ver
abaixo), `valorAbatidoCentavos` calcula `0` e o agendamento segue normal, sem abatimento — nunca um
erro nem um abatimento "fantasma".

**`VendaDePacote.aplicarSaldoResidual(valor)`:** move `valor` de `saldoResidual` para
`saldoUtilizado`, na mesma transação da criação do `Atendimento` (dinheiro nunca "flutua" entre os
dois estados). Rejeita valor não-positivo ou maior que o `saldoResidual` disponível
(`InvarianteVioladaError`) — nunca deixa o saldo negativo.

**`SolicitacaoDeReembolso` (reembolso manual — sem gateway, sem estorno automático):**

| Campo | Tipo | Nota |
|---|---|---|
| `id` | SolicitacaoDeReembolsoId | |
| `companyId` | CompanyId | |
| `vendaDePacoteId` | VendaDePacoteId | |
| `clienteId` | ClienteId | |
| `valor` | Dinheiro | congelado no pedido — **todo** o `saldoResidual` disponível na hora |
| `criadaEm` | Timestamp | |
| `prazoLimiteEm` | Instante | fim do dia civil local, 45 dias depois de `saldoResidualDesde` (§2.6) |
| `status` | StatusSolicitacaoReembolso | `PENDENTE` → `REEMBOLSADO` (final) |
| `reembolsadaEm` | Instante \| null | preenchido só na confirmação |

```
PENDENTE ──── admin confirma (marcarReembolsada) ────► REEMBOLSADO (final)
```

**Padrão do "balde reservado" — por que abatimento e reembolso nunca coexistem sobre o mesmo saldo:**
`VendaDePacote.reservarSaldoParaReembolso()` move **todo** o `saldoResidual` disponível para
`saldoReservadoReembolso` **no momento do pedido** (não espera a confirmação do admin). A partir
daí, `saldoResidual` fica em zero — e o abatimento (regra do resto acima) só enxerga
`saldoResidual`, nunca `saldoReservadoReembolso`. A exclusão mútua é **estrutural** (o dinheiro
literalmente não está mais no balde que o abatimento lê), não uma checagem solta espalhada entre as
duas features. Pelo mesmo motivo, `UsarSaldoResidual` (tela do cockpit) automaticamente para de
oferecer aquele pacote pra abatimento assim que o saldo é reservado — sem código especial, porque
`saldoResidualCentavos` já é `0`.

`VendaDePacote.confirmarReembolso()` move **todo** o `saldoReservadoReembolso` para
`saldoReembolsado` (só cresce — histórico de quanto já foi devolvido). Ambos os métodos rejeitam
operar sobre um balde vazio (`InvarianteVioladaError`) — impossível reservar duas vezes ou confirmar
duas vezes o mesmo dinheiro.

**Prazo de 45 dias:** fixo, **não parametrizável** pelo admin (diferente das janelas do §8.6, que o
brief pediu explicitamente como configuráveis). Conta a partir de `saldoResidualDesde` — a expiração
**mais recente** que alimentou o saldo (se a venda nunca teve `saldoResidualDesde` registrado,
usa `compradoEm` como fallback, caso defensivo que não deveria ocorrer com saldo > 0). **Decisão
registrada em DECISOES_PENDENTES:** quando uma venda tem múltiplos itens expirados em datas
diferentes, o prazo usa a expiração mais recente (mais generosa ao cliente) — o brief não especificou
esse caso multi-item, e a alternativa (contar da mais antiga, ou por item) não foi confirmada com o
dono. Pedido fora do prazo é rejeitado (`InvarianteVioladaError`, mensagem orienta WhatsApp) **antes**
de tocar em qualquer saldo — nada é reservado se o pedido falha.

**Fluxo completo:** cliente pede pelo cockpit (`POST /conta/pacotes/:vendaId/reembolso`) → reserva o
saldo e cria a `SolicitacaoDeReembolso` numa única transação → admin vê a fila de pendentes
(painel, aba "Reembolsos") → devolve o dinheiro **por fora** (PIX manual, fora do sistema) → admin
confirma (`POST /pacotes/reembolsos/:id/confirmar`) → saldo migra pra `saldoReembolsado`, solicitação
fecha. Nenhuma integração com gateway de pagamento neste fluxo — é sempre um humano confirmando que
o dinheiro já saiu.

---

### 8.8 Vale, pagamento e fechamento (sessão de vale/pagamento)

**Vale:** barbeiro solicita (`POST /vales`, sempre a própria) → admin aprova ou nega
(`PATCH /vales/:id/aprovar|negar`, §4.4) → se aprovado, admin marca como pago
(`PATCH /vales/:id/pagar`) numa transação que fecha o `Vale` (`status=PAGO`) **e** cria o
`LancamentoComissao` tipo=VALE ao mesmo tempo (§3.7/§3.12) — os dois agregados mudam juntos
ou nenhum dos dois.

**Pagamento:** admin registra diretamente (`POST /pagamentos`, valor livre, sem aprovação
prévia) — cria só um `LancamentoComissao` tipo=PAGAMENTO. Sem trava de saldo (§3.12).

**Fechamento (`GET /fechamento?de=&ate=`, admin only):** é uma **projeção de leitura sobre
o ledger**, na mesma família de "projeção futura de comissão" (§3.7) — nunca cria
lançamento, nunca "fecha" período de forma imutável (não existe conceito de fatura travada
nesta sessão). Devolve, por barbeiro, dois grupos de números que **não podem ser
confundidos**:

- **Acumulado** — soma de TODO o histórico do ledger daquele barbeiro (comissão, vale
  pago, pagamento, e o saldo líquido resultante). Não depende do período consultado.
- **Movimento do período** — só o que caiu dentro de `[de, ate]` (dia civil local, mesma
  disciplina de fuso de §2.6). Não é o saldo, é "o que entrou/saiu nesta janela".

Confundir os dois é o erro mais comum em relatório financeiro — por isso a API devolve os
dois separados e nomeados (`totalXAcumuladoCentavos` vs. `xNoPeriodoCentavos`), nunca um
número só.

---

### 8.9 OTP obrigatório + reserva temporária + cota de presenciais (sessão de OTP+reserva)

Três problemas reais do funil anônimo, cada um com sua própria trava — não confundir uma com
a solução da outra:

**Problema 1 — agenda falsa:** qualquer telefone digitado reservava sem provar posse.
**Solução:** a escrita pública (`POST /public/agendamentos`, `POST /public/pacotes`) exige
sessão de cliente verificada por OTP — **com uma exceção por forma de pagamento, decidida pelo
dono depois:** o avulso **ONLINE** dispensa o OTP, porque ali a reserva já nasce TEMPORÁRIA
(`RESERVADO`, 10 min) e morre sozinha se o PIX não confirmar — o pagamento É a trava contra
agenda falsa, e o OTP vira só atrito no caminho de maior valor. O **PRESENCIAL** continua
exigindo, porque é ele que segura o horário FIRME sem pagar nada. Pacote também continua
exigindo (o crédito vive na conta do cliente). Quando HÁ sessão, o telefone vem sempre dela e o
do corpo é ignorado — senão um cliente verificado marcaria em nome de outro número e a agenda
falsa voltaria por outra porta. Token presente mas inválido é 401, nunca tratado como anônimo
(`ClienteGuardOpcional`) (`@ContaCliente()` — mesmo mecanismo do login do cockpit,
`IdentityProvider` + `ClienteSessaoService`, nada novo construído). Sem sessão salva localmente
no funil, o front roda `/conta/login/iniciar` + `/conta/login/confirmar` ANTES de confirmar o
agendamento — depois de escolher barbeiro/serviço/horário, nunca antes (mataria conversão). Com
sessão válida (recorrência no mesmo navegador), pula o OTP. O `cliente.telefone` do request
**não existe mais** nesses DTOs — vem sempre do token verificado, nunca do corpo.

**Problema 2 — buraco na agenda:** gerar um PIX pra um avulso online reservava o horário como se
fosse presencial; se o cliente nunca pagasse, o horário ficava preso pra sempre. **Solução:**
reserva `RESERVADO` temporária (§4.1) com prazo (`PRAZO_RESERVA_SEGUNDOS`, 10 min, parametrizado
— não número mágico espalhado) — a MESMA janela alimenta `Atendimento.reservaOnlineExpiraEm`,
`IntencaoDePagamento.expiraEm` (§3.8) e o `expiresIn` pedido de verdade à AbacatePay, sempre a
partir do MESMO instante calculado uma vez (nunca duas chamadas a "agora" separadas — evita
split-brain entre "reserva expirou" e "intenção expirou"). `ExpirarPagamentoVencidoUseCase`
expira os dois juntos, na mesma transação, disparado pelo próprio polling do funil (sem cron).

Pacote (`VendaDePacote`) não tem horário — "reserva do horário" não se aplica a ele
estruturalmente, e por isso **não** usa `PRAZO_RESERVA_SEGUNDOS`: o prazo de pagamento do pacote
continua sendo `gateway.expiraEmSegundos` (1h, via `ABACATEPAY_EXPIRA_SEGUNDOS`), como sempre foi.
Uma sessão anterior chegou a unificar os dois prazos por engano (pacote herdou os 10min da reserva
de horário do avulso, já que a spec original os agrupava na mesma frase) — corrigido:
`DECISOES_PENDENTES.md` #28. São conceitos diferentes (reserva de slot vs. prazo de pagamento de
um ticket mais alto, que precisa de mais tempo) que não devem voltar a compartilhar constante.

**Problema 3 — enxurrada de presenciais:** OTP prova que o telefone é real, mas não impede que o
MESMO cliente marque dezenas de presenciais (que reservam firme sem pagamento algum). OTP é a
ferramenta errada aqui — a trava certa é limite de agendamentos. **Solução:**
`LIMITE_PRESENCIAIS_FUTUROS_ATIVOS = 3` (`regra-cota-presencial.ts`) — um cliente não pode ter
mais que 3 `Atendimento` `AGENDADO`, futuros, **presenciais** (nunca passaram pelo canal
online — detectado por `reservaOnlineExpiraEm IS NULL`, sem precisar de campo novo nem relação
com `IntencaoDePagamento`) ao mesmo tempo. Só vale pro canal de auto-atendimento do cliente
(funil público + cockpit, `aplicarCotaPresencial: true` por default em `AgendarAvulsoUseCase`) —
o admin agenda por julgamento próprio (`aplicarCotaPresencial: false` explícito no controller do
painel), e reagendar (cancela+cria, §8.6) também passa `false` — senão o cliente no limite seria
recusado ao tentar mover um dos 3 que ele já tem (a implementação cria o novo ANTES de cancelar o
antigo pra avulso, então por um instante os dois "existem"). Online nunca conta nem é limitado
por esta cota — o pagamento já é a trava natural contra abuso ali.

### 8.11 Funil único — apresentação unificada, transações separadas

Antes, a entrada do funil pedia uma escolha antes de qualquer informação: "Agendar horário" ou
"Comprar um pacote". O cliente decidia sem ver preço de nenhum dos dois.

Agora a entrada tem um caminho só. Depois de escolher o barbeiro, **uma tela** apresenta:

1. **Bigod's Club** no topo — vitrine das `PacoteOferta` APROVADAS daquele barbeiro (§3.11), com
   a economia vs. avulso que já era calculada;
2. **os serviços avulsos** abaixo, com o desconto progressivo (§3.2.3).

**O princípio estrutural: unifica a APRESENTAÇÃO, não a transação.** Não existe carrinho híbrido
somando compra de pacote + agendamento avulso num pedido só — seriam dois modelos de pagamento
(pacote é pré-pago online obrigatório; avulso pode ser presencial) e dois conjuntos de estados
convivendo na mesma transação. A tela é uma; os fluxos por baixo continuam os mesmos de sempre:

| Escolha do cliente | Para onde vai |
|---|---|
| Um pacote do clube | fluxo de pacote existente (`VendaDePacote`, pagamento online) |
| Um ou mais serviços | fluxo avulso existente (`Atendimento`, agenda horário) |

A separação é garantida no estado do funil: escolher um pacote zera `servicoIds`/data/hora;
mexer nos serviços zera a oferta selecionada. Nunca há os dois preenchidos ao mesmo tempo.

**"Bigod's Club" é rótulo de marca, não membership.** Não há mensalidade, status de membro nem
benefício recorrente modelado — só apresentação sobre os pacotes que já existem. Evoluir para
assinatura de verdade é decisão em aberto (DECISOES_PENDENTES.md #30).

### 8.12 "Não tenho preferência" — horários globais e atribuição na confirmação

O cliente pode seguir o funil sem escolher barbeiro. A partir daí:

- **Listagem:** `/public/horarios` e `/public/dias` sem `barbeiroId` devolvem a
  UNIÃO dos horários de todos os barbeiros ATIVOS que atendem **todos** os
  serviços do carrinho. Um horário aparece se pelo menos um deles está livre
  nele. Duas queries para o conjunto inteiro, nunca uma por barbeiro.
- **Atribuição:** acontece na CONFIRMAÇÃO, no servidor
  (`regra-atribuicao-de-barbeiro.ts`), não na listagem — entre ver o horário e
  confirmar, a agenda pode ter mudado, então quem decide olha o estado de agora.

Cascata, nesta ordem: **menor comissão** → **menos agendamentos naquele dia** →
**aleatório**. Só entram candidatos que atendem todos os serviços, têm janela
que comporta o atendimento inteiro e não têm conflito no intervalo; a cascata só
desempata entre quem já pode atender. O sorteio do último critério opera sobre
lista ordenada por id, para "aleatório" não virar "depende da ordenação do banco".

"Menor comissão" é medida em CENTAVOS (preço dele × percentual efetivo dele, por
serviço, somado), não em percentual puro — preço também é por barbeiro (§3.2.2),
então só o valor em dinheiro representa o custo real da casa. Ver
DECISOES_PENDENTES.md #31.

**Preço sem mentira:** como preço é por barbeiro, o valor final só existe depois
da atribuição. Antes dela o funil mostra "a partir de" (referência da casa) e
avisa que pode variar; a resposta de `POST /public/agendamentos` traz o barbeiro
atribuído e o `valorTotalCentavos` efetivamente cobrado, e é isso que a tela de
sucesso exibe.

### 8.13 Order-bump — "Adicione à sua visita" (sessão 2026-08-17)

Na confirmação do funil avulso, uma seção oferece complementos de um toque: **serviços
complementares** (ex.: corte → oferecer barba) e **produtos** do catálogo (que antes existiam mas
não apareciam no funil). Objetivo de negócio: vender produto e aumentar ticket, sem inventar um
segundo carrinho.

**Configuração é curadoria PARAMETRIZADA, não motor de regras.** Cada item da vitrine é um
agregado `ItemDeOrderBump` (§3.13): aparece ou não, por quanto sai, com que chamada, em que ordem.
A vitrine é geral — igual para todo cliente, sem segmentação por perfil, por horário ou por
composição do carrinho (além do filtro óbvio de `barbeiro.atende`). Um motor condicional ("se o
carrinho tem X, ofereça Y") continua fora de escopo (DECISOES_PENDENTES #32).

**Dois tipos de item, um mecanismo de preço:**

- **Serviço complementar**: entra na mesma lista de serviços do carrinho (`servicoIds`) — é um
  serviço do atendimento como outro qualquer: ocupa agenda, vira `ItemAtendido`, exige que o
  barbeiro o atenda. O que o distingue é a lista paralela `servicosBump`, que diz **quem veio pelo
  bump** e portanto paga o preço promocional configurado.
- **Produto**: vira uma venda de produto anexada ao `Atendimento` (mecanismo `ItemProdutoAtendido`,
  §3.9/§3.5) já na CRIAÇÃO do agendamento — o mesmo mecanismo do walk-in add-on que antes só
  acontecia entre agendar e concluir. Snapshot do preço **efetivamente cobrado** (o promocional,
  quando há oferta); a comissão de produto do barbeiro incide sobre esse valor efetivo, não sobre
  o preço de tabela.
- **Filtro óbvio:** um serviço complementar que o cliente já tem no carrinho não aparece na vitrine
  — exceto o que ele adicionou pelo próprio bump, que continua visível porque é ali que ele remove.

#### ★ Regra de preço do bump de serviço (decisão do dono, Parte 2)

Um item do carrinho recebe **exatamente UMA** regra de preço, nunca duas:

| Situação | Preço |
|---|---|
| Serviço escolhido na tela de serviços | preço do barbeiro (§3.2.2) + desconto progressivo (§3.2.3) |
| Serviço do bump **com** preço promocional | o promocional, cravado — **fora** da escada progressiva |
| Serviço do bump **sem** preço promocional | idêntico ao escolhido na tela normal (entra na escada) |

O item promocional sai também da **contagem de posições** da escada. Se contasse, adicionar um
item já descontado aprofundaria o desconto dos outros — desconto sobre desconto, em cascata, com
o total dependendo de quem entrou primeiro. Fora da escada, o efeito de adicionar um bump é sempre
exatamente "+ preço promocional", e nada mais no carrinho muda. Isso é o que torna o preço
previsível para o dono e para o cliente.

Duas travas fecham o resto:
- `min(promocional, preço do barbeiro)` — promoção **nunca vira acréscimo**. Preço é por barbeiro,
  então um promocional configurado sobre a referência da casa pode ficar acima do preço de um
  barbeiro mais barato; nesse caso ele simplesmente não desconta nada.
- O que se **persiste** é sempre o preço final em centavos, nunca o percentual (a UI aceita as duas
  formas de entrada). Percentual persistido faria a oferta se mover sozinha quando o preço de
  catálogo mudasse — mesma disciplina de `PacoteOferta` (§3.11).

O cálculo mora numa função só, `precificarCarrinhoDoFunil` em `@bigods/contracts`, usada pelo funil
e pela API — duas implementações seriam duas verdades sobre dinheiro.

> **Mudança consciente em relação à Parte 1 desta mesma sessão:** ali valia "adicionar barba pelo
> bump ou pela tela de serviços dá exatamente o mesmo preço". Com preço promocional por item, isso
> deixa de valer **de propósito** — a oferta só existe no fechamento do pedido, e é justamente esse
> o incentivo. O que continua valendo é o princípio por trás: **um item, uma regra de preço**.

**Pagamento segue o agendamento, sempre recalculado ANTES de qualquer cobrança nascer.** Bump
online entra na mesma transação que gera a `IntencaoDePagamento` e a cobrança PIX — o valor do QR
já é agendamento + bumps, nunca um QR de serviços seguido de um ajuste fora dele. Bump presencial
soma no valor a cobrar no balcão. Pacote não tem order-bump: é crédito pré-pago, sem `Atendimento`
para anexar produto ou serviço complementar.

**Remoção sem refazer o funil (Parte 2).** Adicionar e remover são o mesmo toque, na própria
confirmação, e o total atualiza na hora. Depois que o QR já foi emitido, editar o carrinho por
baixo dele cobraria o valor errado — então "Alterar meu pedido" **desfaz a tentativa** no servidor
(`CancelarReservaOnlineUseCase`): expira a intenção (o QR antigo morre) e libera a reserva do
horário, na mesma transação — a mesma dupla atômica de `ExpirarPagamentoVencidoUseCase`, só que
disparada por decisão do cliente em vez de por timeout. Confirmar de novo emite um QR novo pelo
valor certo. Reserva já **paga** não é cancelável por aí: dinheiro que entrou é outro fluxo.

Depois de tudo — inclusive depois da confirmação do avulso, na tela de sucesso — o funil também
mostra o Bigod's Club (§8.11): o order-bump vende mais na MESMA visita; o clube, no fim, é a
tentativa de vender a PRÓXIMA.

### 8.14 Pacote é da empresa — o barbeiro só existe na COMPRA (2026-08-18)

Evoluiu em dois passos, ambos por decisão do dono depois de testar em produção.

**Passo 1 (2026-08-17):** "as ofertas e pacotes não precisam ter vínculo com o barbeiro, é da
empresa em si — não podemos mostrar pacotes para barbeiro x e não mostrar pra barbeiro y". A
vitrine parou de filtrar por barbeiro e o crédito virou resgatável com qualquer um.

**Passo 2 (2026-08-18), a forma final:** *"não terá mais nenhum vínculo do pacote com o Barbeiro
[…] não terá mais barbeiro dono de pacote, isso será extinto. A única regra é: quando o cliente
selecionar o barbeiro x e comprar um pacote com ele selecionado, só ele poderá atender serviços
daquele pacote."*

#### O que deixou de existir

| Antes | Agora |
|---|---|
| `PacoteOferta.barbeiroId` (dono/autor) | **extinto** — a oferta é da empresa |
| Cada barbeiro com o próprio catálogo de ofertas | catálogo único da casa, cadastro **admin-only** |
| Composição limitada ao que o dono atende | qualquer serviço do catálogo |
| Rateio pesado pelo preço do dono (`precoPara`) | **referência da casa** (`Servico.precoAvulso`) |
| Economia exibida variando por barbeiro | uma economia só, igual para todo cliente |

#### A única regra que sobrou

`VendaDePacote.barbeiroId` deixou de ser "dono" e passou a ser **o barbeiro que o cliente escolheu
no funil ao comprar**:

- **Escolheu alguém** ⇒ só ele atende os serviços daquele pacote. Foi com ele que o cliente decidiu
  se tratar, e é isso que o pacote reserva.
- **Não escolheu** (`null`, "não tenho preferência") ⇒ qualquer barbeiro ativo que atenda o serviço.

A trava vive em `VendaDePacote.agendarItem` (§3.6). "O barbeiro atende o serviço" continua sendo
`Atendimento.agendar()` quem garante (§3.5) — a mesma invariante de qualquer atendimento, sem
duplicação.

#### Por que o rateio usa a referência da casa

Decisão do dono entre duas opções apresentadas. Um preço de pacote para todos ⇒ o valor pago tem
que se dividir igual para todos. Se o peso viesse do barbeiro escolhido, o MESMO pacote pelo MESMO
preço se dividiria diferente conforme quem o cliente escolheu — e como o rateado é a base da
comissão, dois barbeiros ganhariam diferente pelo mesmo trabalho vendido pelo mesmo valor. Override
de barbeiro (§3.2.2) vale para AVULSO, onde o cliente de fato paga o preço daquele barbeiro.

#### Migration

Aditiva: `PacoteOferta.barbeiroId` e `VendaDePacote.barbeiroId` viraram nuláveis (nenhum dado
perdido). O código parou de ler/escrever `PacoteOferta.barbeiroId`; a coluna fica no banco só para
rollback seguro, marcada DEPRECADO — remover numa migration futura (DECISOES_PENDENTES). Vendas
antigas mantêm o barbeiro que tinham, o que sob a regra nova significa "compradas com aquele
barbeiro" — leitura fiel, já que o cliente de fato escolheu aquele barbeiro na época.

#### Onde isso aparece

- **Funil:** a vitrine do Bigod's Club é a mesma para todos; o `barbeiroId` escolhido vai no corpo
  da compra.
- **Cockpit do cliente:** pacote comprado com barbeiro mostra "você comprou com X"; comprado sem,
  abre o passo "Com quem?" entre quem atende o serviço.
- **Painel:** "Agendar com crédito" fixa o barbeiro da compra quando há um; a venda manual do admin
  tem barbeiro **opcional** ("Qualquer barbeiro").

#### ACL do barbeiro sobre pacotes (2026-08-18)

Pedido do dono: *"o barbeiro pode apenas ver os pacotes vendidos PARA ELE, e agendar um item do
pacote do cliente DELE, nada mais que isso"* — e, sobre a tela: *"se ele não tem acesso, ele não
pode ver"*.

| Ação | Barbeiro não-admin | Admin |
|---|---|---|
| `GET /pacotes` | só os comprados COM ELE | todos |
| `POST /pacotes` (vender) | **403** | sim |
| `POST /pacotes/:id/confirmar-pagamento` | **403** | sim |
| `/pacote-ofertas/*` (catálogo) | **403** | sim |
| `/pacotes/reembolsos/*` | **403** | sim |
| `POST /atendimentos/com-credito` | só pacote DELE, em nome dele | qualquer |
| `PUT /auth/senha` (própria senha) | sim | sim |

Pacote comprado **sem** barbeiro escolhido não é de ninguém em particular: não aparece para
barbeiro nenhum e só o admin distribui quem atende.

**A garantia é o servidor, não a tela.** Cada linha acima tem e2e que tenta o request direto
(`acl-barbeiro-pacotes.e2e.spec.ts`); esconder aba e botão é conveniência de UX em cima disso —
antes a aba "Catálogo de ofertas" aparecia e o clique caía num erro de papel insuficiente, que é
exatamente o que o dono não quer ver.

**Troca da própria senha** (`PUT /auth/senha`) é a única ação do barbeiro em Ajustes. Exige a senha
ATUAL — sem isso, uma sessão esquecida aberta trancaria o dono para fora da própria conta. Reusa
`validarCredenciais`, a mesma conferência do login; não há segunda implementação de senha.

---

## 9. Testes — onde investir

A v1 acertou nisso: pouca cobertura em volume, mas **direcionada aos riscos reais de negócio**
(conflito de horário, isolamento de tenant, cálculo de comissão). Manter essa filosofia.

**Testes de domínio (unitários, sem banco, rápidos) — prioridade máxima:**
- Rateio de pacote: soma dos itens == valor pago, **sempre**, inclusive com arredondamento feio
  (ex: 3 itens, valor primo, centavos que não dividem redondo).
- Máquina de estado de `ItemDoPacote`: todas as transições legais e, principalmente, **as ilegais**
  (não pode consumir item expirado; não pode ter 2 faltas sem expirar).
- Cálculo de comissão: com exceção por serviço, e com valor rateado de pacote (não avulso).
- Invariante de sobreposição de horário.
- Fuso horário (§2.6): conversão local↔UTC robusta a horário de verão (caso real cruzando a
  transição de DST em `America/New_York`); dia civil vs. dia UTC bruto do instante (disponibilidade,
  agenda do dia, prazo de reagendamento). A suíte inteira roda idêntica sob `TZ=UTC`,
  `TZ=America/Sao_Paulo` e `TZ=Asia/Tokyo` — nenhum teste pode depender do fuso do processo.

**Testes de integração:**
- Constraint `EXCLUDE` do Postgres realmente rejeita sobreposição sob concorrência.
- Transação de "agendar com crédito" faz rollback completo se qualquer passo falhar.
- Webhook de pagamento é idempotente (processar 2x não gera efeito duplo).
- Disponibilidade "9h" local persiste o instante UTC correto no banco (`timestamptz` real).
- Atendimento marcado perto da meia-noite local aparece na consulta de agenda do seu dia civil
  correto, nunca no dia seguinte.
- Job de expiração não erra a virada de dia por causa do fuso (prazo vence "hoje" local mesmo
  quando o instante UTC já é outro dia).

**Não perseguir cobertura alta em controllers e mapeamento de infra.** O valor está no domínio.

---

## 10. Anti-padrões — o que NÃO fazer

Cada item aqui é um erro real da v1, documentado na auditoria técnica. Não repetir.

| ❌ Anti-padrão | ✅ Correto |
|---|---|
| Regra de negócio dentro do model/ORM (`Appointment::schedule()`) | Regra no agregado de domínio, TS puro |
| Mesma regra implementada em 2 lugares (conflito de horário) | Uma dona: invariante no domínio + constraint no banco |
| Status + soft-delete representando o mesmo fato (cancelamento) | Status explícito é a única verdade |
| Comissão como `+=` numa coluna, sem histórico | Ledger imutável de lançamentos; saldo é derivado |
| Papel como string livre comparada em vários lugares | Enum + autorização centralizada (guard/policy) |
| Tipos duplicados e divergentes por frontend | `packages/contracts` compartilhado |
| Cadastro de cliente e agendamento como 2 chamadas sem rollback | Uma transação |
| Rota pública de escrita sem validação de integridade | Toda escrita valida invariantes no domínio |
| Fallback silencioso de tenant ("pega a primeira empresa") | Sem tenant explícito → erro, nunca chute |
| `float` para dinheiro | `NUMERIC` no banco, VO `Dinheiro` em centavos |
| Preço lido do catálogo ao exibir histórico | Snapshot do valor no momento da transação |

**Nota:** o item abaixo não é erro da v1 — foi descoberto e corrigido durante a implementação
desta versão, e é documentado aqui pelo mesmo motivo: para não ser reintroduzido por acidente.

| ❌ Anti-padrão | ✅ Correto |
|---|---|
| Tratar tudo em UTC ponta a ponta, sem reconhecer o fuso civil da operação | `Company.timezone` + conversão sempre na fronteira; domínio recebe `Timezone` explícito, nunca presume fuso do runtime (§2.6) |
| Dia "de hoje" calculado a partir do dia UTC bruto do instante (`instante.toISOString().slice(0,10)`) | `diaCivilChave(instante, tz)` — dia civil no fuso da empresa |
| Prazo de N dias como `hoje + N×24h` | Dias civis: fim do N-ésimo dia civil local (`fimDoDiaCivilMaisDias`) — sobrevive a horário de verão |

---

## 11. Fora de escopo no MVP (decidido, não esquecido)

Registrado para não ser reintroduzido por acidente — e para que a arquitetura não os inviabilize.

| Item | Por que fora | Como entra depois |
|---|---|---|
| Controle de estoque de produto | Venda de produto (§3.9/§3.10) já implementada (sessão 2026-07-16), mas **sem** quantidade/fornecedor/estoque — decisão consciente, não medida ainda | Campo de quantidade no `Produto` + lançamentos de entrada/saída, quando o volume justificar |
| ~~Vale, saque, débito do barbeiro~~ | **Saiu desta lista** (sessão de vale/pagamento) — a operação real passou a ter barbeiro contratado pedindo adiantamento, deixando de ser hipotético. Ver §3.7 (ledger de 3 direções) e §3.12/§4.4 (`Vale`) | Implementado |
| Isolamento multi-tenant dinâmico | Nenhum segundo tenant existe para validar contra | `companyId` já está nos agregados (costura pronta) |
| Aplicação **automática** de saldo residual (sem o cliente escolher) | Implementado na sessão-E (§8.7) como escolha do cliente (abater OU reembolsar) — nunca aplicado sozinho pelo sistema sem pedido explícito | N/A — já resolvido |
| Desconto progressivo por volume no carrinho | Mecânica distinta do pacote pré-pago; sem evidência operacional | Regra de precificação nova no catálogo |
| App mobile nativo | Web responsiva resolve; app da v1 morreu sem resolver problema real | PWA primeiro; nativo só se surgir necessidade que só ele resolve |
| Divisão de lucro entre sócios | Contabilidade da empresa, **não** domínio do produto | Fora do produto — planilha/contador, a partir dos números do sistema |
| ~~Resgate cruzado de crédito entre barbeiros~~ | **Saiu desta lista** (sessão 2026-08-17, §8.14) — decisão do dono: crédito é da empresa, resgatável com qualquer barbeiro ativo que atenda o serviço. `barbeiroId` da venda virou só a base de preço do rateio (congelada, sem mudar retroativamente) | Implementado |
| Relatório/dashboard de origemLink | `origemLinkBarbeiroId` (§8.5, Fase 4c) é só registro nesta sessão — não há tela nem métrica | Read model simples quando "quanto cada barbeiro converte pelo próprio link" virar pergunta de negócio real |
| Order-bump com regras condicionais / segmentação | Decisão do dono para começar SIMPLES (§8.13, sessão 2026-08-17): vitrine curada é uma lista geral, sem "se o carrinho tem X, ofereça Y" nem segmentação por serviço/barbeiro | Motor de regras condicionais sobre a mesma vitrine, quando houver evidência de que a lista geral não converte o suficiente — registrado em DECISOES_PENDENTES |
| Upsell de troca-pra-cima (trocar um serviço por uma versão premium) | Fora de escopo desta sessão — o order-bump (§8.13) só ADICIONA itens, nunca substitui um já escolhido | O mecanismo atual já comporta um serviço premium como item de bump comum, quando um existir no catálogo; troca-pra-cima de verdade (substituir, não somar) é decisão de UX/negócio futura, registrada em DECISOES_PENDENTES |

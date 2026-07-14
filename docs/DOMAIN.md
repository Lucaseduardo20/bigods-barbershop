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
  sobreposição, mesmo sob concorrência.
- **Leitura** (listar horários livres): é uma **projeção**, não a fonte da verdade. Pode ser
  otimizada livremente. Se ela errar por corrida, a escrita rejeita — sem inconsistência.

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

### 2.5 Dinheiro

- **Nunca `float`.** Sempre `NUMERIC`/decimal no banco, e um Value Object `Dinheiro` no domínio
  (armazenado em centavos, inteiro).
- **Arredondamento de rateio:** ao ratear o valor de um pacote entre seus itens, arredondar por
  item e garantir que **a soma dos itens arredondados bate exatamente com o valor pago**. O
  resíduo de centavos vai para o último item. Isso é uma invariante, não um detalhe.

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

**Invariantes:** preço > 0; duração > 0.

**Nota:** um `Servico` nunca é deletado, apenas desativado. Atendimentos históricos e itens de
pacote referenciam serviços — deletar quebraria a auditoria.

---

### 3.2 `Barbeiro` (raiz)

Quem realiza atendimentos. Um `Barbeiro` pode também ser admin (papéis são ortogonais).

| Campo | Tipo | Nota |
|---|---|---|
| `id` | BarbeiroId | |
| `companyId` | CompanyId | |
| `nome` | string | |
| `papeis` | Set\<Papel\> | `ADMIN` \| `BARBEIRO` — enum, nunca string livre |
| `comissaoPadrao` | Percentual | ex: 45% |
| `excecoesComissao` | Map\<ServicoId, Percentual\> | override por serviço |
| `servicosAtendidos` | Set\<ServicoId\> | quais serviços ele realiza |
| `ativo` | boolean | |

**Regra de comissão:**
```
percentualPara(servicoId) =
  excecoesComissao.get(servicoId) ?? comissaoPadrao
```

**Invariantes:**
- `comissaoPadrao` entre 0% e 100%.
- Toda exceção também entre 0% e 100%.
- Só pode ser agendado para serviços em `servicosAtendidos`.

**Nota v1:** o papel era string livre (`'admin'`, `'barber'`) comparada literalmente em vários
lugares. Aqui é enum, e autorização é centralizada (guard/policy), nunca comparação de string
espalhada.

---

### 3.3 `DisponibilidadeBarbeiro` (raiz)

Janela de trabalho de um barbeiro.

| Campo | Tipo |
|---|---|
| `id` | DisponibilidadeId |
| `barbeiroId` | BarbeiroId |
| `data` | Data |
| `janela` | IntervaloDeTempo (inicio, fim) |

**Invariantes:** `inicio < fim`; janelas do mesmo barbeiro no mesmo dia não se sobrepõem.

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
**usuário Cognito** (`cognitoSub` preenchido) no momento em que passa a ter algo que justifique
login: **compra de um pacote**. Antes disso, não há área logada a acessar.

`telefone` é a chave de reconciliação: se um cliente já existente (do funil) compra um pacote,
promovemos o registro existente em vez de criar um duplicado.

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
| `intervalo` | IntervaloDeTempo | início + fim (calculado da duração) |
| `status` | StatusAtendimento | máquina de estado — ver §4.1 |
| `origem` | OrigemAtendimento | `AVULSO` \| `CREDITO_PACOTE` |
| `formaPagamento` | FormaPagamento \| null | preenchido só na conclusão, se AVULSO |
| `motivoCancelamento` | string \| null | obrigatório se CANCELADO |

**`ItemAtendido`** (value object dentro do agregado):

| Campo | Tipo | Nota |
|---|---|---|
| `servicoId` | ServicoId | |
| `valorCobrado` | Dinheiro | **snapshot** — nunca recalcular do catálogo |
| `duracao` | Duracao | snapshot |
| `itemDoPacoteId` | ItemDoPacoteId \| null | preenchido se origem = CREDITO_PACOTE |

**Por que snapshot:** se o preço do corte mudar de R$40 para R$50 amanhã, o atendimento de
ontem continua valendo R$40. Sem snapshot, o histórico e o extrato de comissão mudariam
retroativamente — inaceitável num sistema que precisa ser auditável.

**Invariantes:**
- Não existem dois `Atendimento` com status ativo (`AGENDADO`) sobrepostos no tempo para o mesmo
  `barbeiroId`. Garantido no domínio **e** por constraint `EXCLUDE` no Postgres.
- O `intervalo` deve estar contido em alguma `DisponibilidadeBarbeiro` daquele barbeiro naquela data.
- Todo `servicoId` dos itens deve estar em `barbeiro.servicosAtendidos`.
- Se `origem = CREDITO_PACOTE`, todo item deve ter `itemDoPacoteId` preenchido e
  `valorCobrado` = valor rateado daquele item no pacote (não o preço avulso).
- Se `origem = AVULSO`, `itemDoPacoteId` é sempre null.
- `status = CANCELADO` exige `motivoCancelamento` não-vazio.

**Eventos emitidos:**
- `AtendimentoAgendado`
- `AtendimentoConcluido` → **dispara cálculo de comissão** (§3.7)
- `AtendimentoCancelado`
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
| `valorPago` | Dinheiro | valor total efetivamente pago |
| `itens` | List\<ItemDoPacote\> | entidades internas |
| `saldoResidual` | Dinheiro | acumula valor de itens expirados (§4.2) |
| `compradoEm` | Timestamp | |
| `statusPagamento` | StatusPagamento | ver §3.8 |

**`ItemDoPacote`** (entidade dentro do agregado — **nunca manipulada fora da raiz**):

| Campo | Tipo | Nota |
|---|---|---|
| `id` | ItemDoPacoteId | |
| `servicoId` | ServicoId | |
| `valorRateado` | Dinheiro | **congelado na venda** — ver rateio abaixo |
| `status` | StatusItemPacote | máquina de estado — ver §4.2 |
| `faltasComputadas` | 0 \| 1 | quantas vezes o cliente já falhou neste item |
| `prazoReagendamentoAte` | Data \| null | preenchido quando entra em segunda chance |
| `atendimentoId` | AtendimentoId \| null | quando agendado/concluído |

**Rateio (calculado UMA vez, no momento da venda, e congelado):**

```
Para cada item i:
  pesoNominal(i) = servico(i).precoAvulso   // preço avulso vigente NA VENDA
  somaNominal    = Σ pesoNominal

  valorRateado(i) = arredonda( valorPago × pesoNominal(i) / somaNominal )

Resíduo de arredondamento vai para o último item, garantindo:
  Σ valorRateado == valorPago   (INVARIANTE)
```

Exemplo: pacote com 1 corte (avulso R$40) + 1 barba (avulso R$30), vendido por R$60.
- Corte: 60 × 40/70 = R$34,29
- Barba: 60 × 30/70 = R$25,71
- Soma: R$60,00 ✓

**Invariantes:**
- `Σ item.valorRateado + saldoResidual == valorPago` — **sempre**, em qualquer estado.
- Um item nunca tem mais de 1 falta computada (na segunda, expira).
- Um item não pode ir para `AGENDADO` se não estiver `DISPONIVEL` ou `SEGUNDA_CHANCE`.
- Não é possível consumir item de um pacote com `statusPagamento != PAGO`.

**Eventos emitidos:**
- `PacoteVendido`
- `ItemDoPacoteConsumido`
- `ItemDoPacoteExpirado`

---

### 3.7 `LancamentoComissao` (raiz) — ledger auditável

**Requisito não-negociável de governança.** Cada centavo de comissão tem um lançamento
rastreável até o atendimento que o gerou. Não existe "saldo acumulado" como campo mutável.

| Campo | Tipo | Nota |
|---|---|---|
| `id` | LancamentoId | |
| `companyId` | CompanyId | |
| `barbeiroId` | BarbeiroId | |
| `atendimentoId` | AtendimentoId | rastreabilidade |
| `servicoId` | ServicoId | |
| `valorBase` | Dinheiro | valor do serviço (avulso OU rateado do pacote) |
| `percentualAplicado` | Percentual | snapshot da regra vigente na conclusão |
| `valorComissao` | Dinheiro | `valorBase × percentualAplicado` |
| `ocorridoEm` | Timestamp | |

**Saldo do barbeiro = soma dos lançamentos.** Nunca um campo `commission` no `Barbeiro`.

**Nota v1:** a comissão era um `+=` na coluna `commission` do `User`, sem histórico. Se o barbeiro
perguntasse "por que recebi X?", o sistema não sabia responder. Isso destrói confiança —
especialmente entre sócios. Aqui, o extrato é a fonte da verdade e o saldo é derivado.

**Extensão futura (não implementar agora):** vale/adiantamento e saque entram como lançamentos
**negativos** no mesmo ledger. Fazer o ledger direito agora é o que permite adicionar isso depois
sem retrofit.

**Projeção de comissão futura:** calculada como soma sobre atendimentos `AGENDADO` (ainda não
concluídos). **É uma query de leitura, não um lançamento.** Nunca somar projeção com saldo real —
na UI e na API, são números separados e rotulados. Agendamento futuro pode ser cancelado.

---

### 3.8 `IntencaoDePagamento` (raiz)

Representa a intenção de pagar, criada **antes** de chamar o gateway (AbacatePay).

| Campo | Tipo |
|---|---|
| `id` | IntencaoDePagamentoId |
| `companyId` | CompanyId |
| `referencia` | AtendimentoId \| VendaDePacoteId |
| `valor` | Dinheiro |
| `status` | `AGUARDANDO` \| `PAGO` \| `EXPIRADO` \| `FALHOU` |
| `externalId` | string | enviado ao gateway como `metadata.externalId` |

**Fluxo:**
1. Domínio cria `IntencaoDePagamento` em `AGUARDANDO`.
2. Infra chama AbacatePay, passando nosso `externalId`.
3. Webhook de confirmação chega → busca a intenção pelo `externalId` → transiciona para `PAGO`.
4. Transição para `PAGO` emite `PagamentoConfirmado` → libera o pacote/atendimento.

**Por quê:** o pagamento externo é um **evento de infraestrutura confirmando uma intenção que já
existe no domínio** — nunca o contrário. Isso evita o problema da v1, onde cadastro de cliente e
criação de agendamento eram duas chamadas independentes sem rollback (se a segunda falhasse, o
cliente ficava órfão).

**Webhook deve ser idempotente** — gateways reenviam. Processar duas vezes o mesmo `externalId`
não pode gerar dois efeitos.

---

## 4. Máquinas de estado

Estados são **explícitos**. Nunca representar estado com combinação de flags booleanas ou
soft-delete (foi assim que a v1 acabou com cancelamento representado de duas formas ao mesmo tempo).

### 4.1 `Atendimento`

```
                    ┌─────────────┐
                    │  AGENDADO   │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌────────────┐  ┌────────────┐  ┌────────────┐
    │ CONCLUIDO  │  │ CANCELADO  │  │ NAO_COMPA- │
    │            │  │ (c/ motivo)│  │  RECEU     │
    └────────────┘  └────────────┘  └────────────┘
       (final)         (final)          (final)
```

- `AGENDADO → CONCLUIDO`: emite `AtendimentoConcluido`. Exige `formaPagamento` se `AVULSO`.
- `AGENDADO → CANCELADO`: exige motivo. Emite `AtendimentoCancelado`.
- `AGENDADO → NAO_COMPARECEU`: emite `ClienteFaltou`.
- **Estados finais não transicionam.** Reagendar = criar um novo `Atendimento`, não mutar o antigo.
  (Isso preserva a auditoria: o histórico mostra que houve uma falta.)

### 4.2 `ItemDoPacote`

Esta é a máquina de estado mais sutil do sistema. Ela existe porque a regra de negócio real
(validada na operação) é: **o cliente tem direito a uma segunda chance, com prazo.**

```
   ┌──────────────┐
   │  DISPONIVEL  │◄─────────────────────┐
   └──────┬───────┘                      │
          │ agenda                       │ cancela ANTES do prazo limite
          ▼                              │ (não conta como falta)
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

**Parâmetros:**
- Prazo de reagendamento: **10 dias, parametrizável pelo admin** (`ParametrosDaEmpresa`).
- Máximo de faltas antes de expirar: **1** (na segunda, expira).

**Sobre `saldoResidual`:** quando um item expira, seu `valorRateado` **não desaparece** — migra para
`pacote.saldoResidual`. O cliente não perde o dinheiro; perde aquele *serviço específico*.

**Escopo MVP:** o `saldoResidual` é **registrado** (estado) mas sua **aplicação** é manual — o
admin/barbeiro decide onde usar ao criar o próximo agendamento. Não construir lógica automática de
realocação agora.

**Por quê:** isso só ocorre quando um cliente falha **duas vezes no mesmo item**. Deve ser raro.
Automatizar um caminho raro antes de conhecer sua frequência é otimização prematura. **Medir
primeiro** (a barbearia é o laboratório), automatizar depois se o volume justificar.

**Expiração por prazo** é verificada por um job agendado (cron diário) que varre itens em
`SEGUNDA_CHANCE` com `prazoReagendamentoAte < hoje`. Não é um trigger em tempo real.

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
│   │       │   │                 # IntervaloDeTempo, Telefone, Duracao
│   │       │   ├── events/       # infra de eventos de domínio
│   │       │   └── errors/       # erros de domínio tipados
│   │       │
│   │       ├── modules/
│   │       │   ├── catalog/      # Servico
│   │       │   ├── staff/        # Barbeiro, Disponibilidade
│   │       │   ├── customers/    # Cliente
│   │       │   ├── scheduling/   # Atendimento  ← núcleo
│   │       │   ├── packages/     # VendaDePacote, ItemDoPacote
│   │       │   ├── payroll/      # LancamentoComissao
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

### 8.1 Agendar avulso (funil público, sem login)

```
1. Validar serviços existem, estão ativos, e o barbeiro os atende
2. Calcular intervalo (soma das durações)
3. Validar que o intervalo cabe na disponibilidade do barbeiro
4. Encontrar-ou-criar Cliente pelo telefone (normalizado)
5. Criar Atendimento (AGENDADO, origem=AVULSO)
   → invariante de sobreposição validada no domínio
   → constraint EXCLUDE do Postgres como rede de segurança
6. Criar IntencaoDePagamento (AGUARDANDO)
7. Chamar AbacatePay, retornar QR Code

TUDO em UMA transação (passos 4-6).
Sem essa transação, repetimos o bug da v1: cliente criado, agendamento falhou, órfão no banco.
```

### 8.2 Agendar consumindo crédito (área logada)

```
1. Autenticar (Cognito)
2. Carregar VendaDePacote do cliente
3. Selecionar ItemDoPacote (status DISPONIVEL ou SEGUNDA_CHANCE)
4. Validar disponibilidade e conflito de horário
5. TRANSAÇÃO:
   a. VendaDePacote.consumirItem(itemId, atendimentoId)  → item vira AGENDADO
   b. Criar Atendimento (origem=CREDITO_PACOTE,
      valorCobrado = item.valorRateado ← NÃO o preço avulso)
6. Sem pagamento. Confirmar explicitamente ao cliente que nada será cobrado.
```

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
   VendaDePacote.computarFalta(itemId):
     - faltasComputadas += 1
     - se faltas == 1 → SEGUNDA_CHANCE, prazo = hoje + parametros.prazoReagendamento
     - se faltas == 2 → EXPIRADO, valorRateado migra p/ saldoResidual
4. Nenhuma comissão é gerada (o serviço não foi prestado)
```

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

**Testes de integração:**
- Constraint `EXCLUDE` do Postgres realmente rejeita sobreposição sob concorrência.
- Transação de "agendar com crédito" faz rollback completo se qualquer passo falhar.
- Webhook de pagamento é idempotente (processar 2x não gera efeito duplo).

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

---

## 11. Fora de escopo no MVP (decidido, não esquecido)

Registrado para não ser reintroduzido por acidente — e para que a arquitetura não os inviabilize.

| Item | Por que fora | Como entra depois |
|---|---|---|
| Estoque / venda de produto | Gabriel não vende produto hoje | Módulo novo; nada no modelo atual impede |
| Vale, saque, débito do barbeiro | Só faz sentido com barbeiro contratado; hoje o único barbeiro é sócio | Lançamento **negativo** no ledger existente |
| Isolamento multi-tenant dinâmico | Nenhum segundo tenant existe para validar contra | `companyId` já está nos agregados (costura pronta) |
| Aplicação automática de saldo residual | Caminho raro (exige 2 faltas no mesmo item). Medir frequência primeiro | Estado já é registrado; falta só a lógica |
| Desconto progressivo por volume no carrinho | Mecânica distinta do pacote pré-pago; sem evidência operacional | Regra de precificação nova no catálogo |
| App mobile nativo | Web responsiva resolve; app da v1 morreu sem resolver problema real | PWA primeiro; nativo só se surgir necessidade que só ele resolve |
| Divisão de lucro entre sócios | Contabilidade da empresa, **não** domínio do produto | Fora do produto — planilha/contador, a partir dos números do sistema |

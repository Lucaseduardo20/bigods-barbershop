Leia CLAUDE.md e docs/DOMAIN.md antes de começar. A suíte está 100% verde
(233/233) — mantenha assim ao fim de CADA fase, não só no final.

Esta sessão é estrutural: mexe em precificação e no rateio de pacote, que é
dinheiro. Prioridade absoluta é não corromper nada que já funciona.

## FASE 1 — PacoteOferta vira domínio de primeira classe

Hoje é read model semeado (DECISOES #12), sem CRUD — o admin não consegue
criar/editar pacote, o que bloqueia a operação real.

- `PacoteOferta` como agregado: nome, composição (lista de {servicoId,
  quantidade} — DEVE suportar pacote MISTO, ex: 2 cortes + 2 barbas; hoje só
  suporta um serviço repetido), preço do pacote, barbeiroId (dono, Fase 2),
  status de aprovação (Fase 3), ativo (soft-disable como Servico/Produto).
- Invariantes: preço > 0; ao menos um item; quantidade > 0; todos os serviços
  da composição devem ser atendidos pelo barbeiro dono; preço do pacote não
  pode ser MAIOR que a soma dos avulsos (um "pacote" mais caro que comprar
  separado é erro de cadastro, não um desconto negativo).

### Precificação: dois modos de entrada, UMA fonte de verdade

O admin pode definir o preço do pacote de duas formas:
(a) percentual de desconto sobre a soma dos preços avulsos, ou
(b) preço fixo em reais.

★ REGRA CENTRAL: qualquer que seja o modo de entrada, o que se PERSISTE é
sempre o PREÇO em centavos. O percentual é sempre DERIVADO do preço na
exibição, nunca armazenado como fonte de verdade.

Motivo (documente no DOMAIN.md): se o percentual fosse persistido, uma mudança
futura no preço avulso de referência alteraria o preço do pacote sozinha, sem
ninguém ter decidido isso. Guardando o preço, ele só muda quando alguém edita
— e o percentual exibido se recalcula, revelando corretamente que o desconto
real encolheu. Consistente com a disciplina de snapshot do resto do sistema
(dinheiro é congelado; o resto é derivado).

Implementação:
- Modo (a): admin digita o %, o sistema calcula e persiste o preço resultante.
  Mostrar o preço calculado ANTES de salvar, para o admin confirmar (evita
  surpresa de arredondamento).
- Modo (b): admin digita o preço, o sistema calcula e exibe o % resultante.
- Arredondamento: `Dinheiro` em centavos inteiros, como todo o resto (§2.5).
  Nunca float. Arredonde o preço calculado a partir do % para o centavo mais
  próximo e deixe explícito qual é o valor final.
- O percentual exibido é sempre recalculado a partir de (soma dos avulsos,
  preço do pacote) — arredonde para exibição de forma sensata (ex: uma casa
  decimal), mas nunca use o valor arredondado em cálculo de dinheiro.

### Economia visível para o cliente

No funil público, cada oferta de pacote deve mostrar EXPLICITAMENTE:
- o preço do pacote,
- quanto custaria comprando avulso (soma dos serviços da composição),
- a economia em REAIS e em PERCENTUAL, lado a lado
  (ex: "R$ 160 · em vez de R$ 200 · você economiza R$ 40 (20%)").

Isso é a principal alavanca de conversão do pacote — não esconda em letra
miúda nem exija cálculo mental do cliente.

★ Base de cálculo com preço por barbeiro: a soma dos avulsos usa o preço DO
BARBEIRO dono da oferta (Fase 2), não o preço de referência da casa. Ou seja,
o mesmo pacote pode ter percentual de desconto diferente entre barbeiros com
preços diferentes — isso é correto e esperado, não é bug. Deixe claro na UI do
admin qual base está sendo usada.

### Demais requisitos da fase
- CRUD completo no admin (criar, editar, ativar/desativar).
- A venda continua passando pelo rateio existente (§3.6) — NÃO reescreva o
  rateio, só passe a composição correta.
- Migre as ofertas semeadas para o novo modelo sem perder as existentes.
- Teste: pacote misto rateia corretamente (soma dos rateados == valor pago);
  percentual derivado bate com o preço nos dois modos de entrada; mudar o
  preço avulso de referência NÃO altera o preço de um pacote já cadastrado
  (só o % exibido muda).

## FASE 2 — Preço por barbeiro (★ a parte mais sensível)

- `Servico.precoAvulso` passa a ser o preço de REFERÊNCIA da casa. Cada
  barbeiro pode ter override por serviço — MESMO padrão já usado para comissão
  (`comissaoPadrao` + exceções por serviço). Reaproveite a simetria conceitual
  e, onde fizer sentido, o mesmo formato de dados.
- `precoPara(servicoId, barbeiroId)` = override do barbeiro ?? referência do
  serviço.
- ★ PROTEJA O QUE JÁ FUNCIONA: o rateio de pacote passa a usar o preço DO
  BARBEIRO vigente no momento da venda. Snapshots já congelados
  (`valorRateado`, `valorCobrado`, `percentualAplicado`) NÃO podem mudar
  retroativamente. Escreva um teste que PROVE isso: cria venda + conclui
  atendimento (gera comissão) → muda o preço do barbeiro → confirma que a
  venda antiga e o lançamento de comissão permanecem byte a byte idênticos.
  Esse teste é obrigatório, não opcional.
- `VendaDePacote` ganha `barbeiroId`. Crédito só pode ser consumido com o
  barbeiro dono. Resgate cruzado entre barbeiros fica FORA desta sessão
  (registrado como decisão futura).
- Admin: gerenciar preços por barbeiro de forma simples, deixando visualmente
  claro o que é referência e o que é override.

## FASE 3 — Workflow de aprovação de PacoteOferta

- Estados: RASCUNHO → PENDENTE_APROVACAO → APROVADO | REJEITADO.
- Barbeiro cria/edita → PENDENTE. Admin aprova ou rejeita (rejeição com
  motivo). Só APROVADO aparece no funil público.
- Editar um pacote APROVADO volta para PENDENTE.
- Admin que também é barbeiro (caso do Gabriel) pode aprovar o próprio pacote
  — senão o fluxo trava com um único usuário real.
- Tela no admin para ver pendências.

## FASE 4 — Funil: barbeiro PRIMEIRO + link próprio do barbeiro

### 4a. Reordenação
Barbeiro ANTES de serviço nas duas trilhas (avulso e pacote). Com preço por
barbeiro, mostrar preço antes de saber o barbeiro é mostrar preço errado.
Manter o comportamento de pular a etapa automaticamente quando só há um
barbeiro disponível. As ofertas de pacote exibidas passam a ser as do barbeiro
escolhido.

### 4b. Link próprio do barbeiro (marketing individual)
Cada barbeiro terá um link pessoal para divulgar (status de WhatsApp,
Instagram, cartão). Quem entra por ele já chega com o barbeiro escolhido.

- Rota pública com identificador do barbeiro (ex: /b/{slug} ou
  ?barbeiro={slug}). Prefira um SLUG legível derivado do nome (ex:
  "gabriel") a expor UUID — o link vai ser lido por humanos e colado em
  status. Slug único por empresa, gerado no cadastro do barbeiro, editável
  pelo admin.
- Ao entrar pelo link: barbeiro pré-selecionado, etapa de escolha PULADA,
  com o nome/avatar dele visível no topo do funil ("Agendando com Gabriel")
  para o cliente saber com quem está marcando.
- Saída discreta: um link secundário "ver outros profissionais" que libera a
  escolha. Não é botão de destaque — o padrão é seguir com o barbeiro do
  link. (Decisão de negócio: preferimos não perder o agendamento quando o
  barbeiro do link não tem horário, em vez de travar completamente.)
- ★ Precedência sobre estado salvo: o funil persiste progresso em
  sessionStorage. Um link com barbeiro explícito SEMPRE vence o estado
  salvo — se o cliente entrar por /b/gabriel, o barbeiro é Gabriel mesmo que
  houvesse outro no sessionStorage de uma visita anterior. Teste isso
  explicitamente.
- Slug inválido/inexistente → cai no funil normal (escolha de barbeiro), NÃO
  em erro 404 na cara do cliente. Um link velho de barbeiro que saiu não pode
  quebrar a experiência.
- No admin: mostrar o link pronto de cada barbeiro com botão de copiar (é o
  que ele vai colar no status).

### 4c. Registrar a origem do agendamento
Quando o agendamento/venda vier de um link de barbeiro, registre isso
(ex: campo `origemLink` no Atendimento/VendaDePacote — barbeiroId de quem
divulgou, ou null se veio do funil genérico).

Só REGISTRO, sem tela de relatório nesta sessão. Motivo: é dado que não dá
para recuperar retroativamente, e responde depois a "quais agendamentos vieram
do marketing de cada barbeiro". Não invente métrica nem dashboard agora.

## FASE 5 — DOMAIN.md

Atualize: PacoteOferta como agregado (§3), preço por barbeiro e `precoPara`,
`barbeiroId` em VendaDePacote, estados de aprovação, nova ordem do funil (§8).
A spec não pode divergir do código.

## Regras da sessão
- Suíte verde ao fim de cada fase.
- `npm run test` e `npm run test:multitz` verdes ao final.
- Testes com horário fixo devem usar dias inteiramente futuros, nunca "hoje"
  (lição da sessão anterior — não repita o padrão).
- Regra de negócio não coberta: implemente o mínimo, marque DECISAO_PENDENTE.
  Não invente regra de domínio.
- RELATORIO_SESSAO.md com o que mudou e o que precisa ser re-testado
  manualmente no smoke.
# Roteiro de QA — antes de todo deploy

Feito para ser executado por um **agente com o MCP do Chrome DevTools**, sem supervisão, e
para produzir um relatório que decide *sobe ou não sobe*.

Não é substituto da suíte automatizada (727 testes). É o complemento dela: a suíte prova que a
**regra** está certa; este roteiro prova que a **tela** funciona — que o botão existe, que a
requisição sai, que a imagem carrega, que o fluxo chega ao fim.

---

## 0. Pré-condições — o agente PARA se qualquer uma falhar

Antes de tocar em qualquer tela:

```bash
curl -s "http://localhost:3000/public/empresa?companyId=bigods"
```

Deve responder com **`"demoMode": true`**. Confira também que os três frontends respondem:

| Porta | App | Título esperado |
|---|---|---|
| 5174 | Funil (booking) | `Bigod's Barber — Agendar horário` |
| 5175 | Minha conta (account) | `Bigod's Barber — Minha conta` |
| 5173 | Painel (admin) | `Bigod's Barber — Painel` |
| 3000 | API | — |

> ### ⛔ NUNCA rode este roteiro contra produção
>
> Não é preciosismo. Em produção este roteiro **cria agendamentos reais na agenda da
> barbearia**, ocupa horários que um cliente de verdade queria, e — como o
> `IDENTITY_PROVIDER` de produção é SMS via Cognito — **dispara SMS reais e cobrados**, até
> bater no limite por telefone/origem.
>
> Se `demoMode` vier `false`, ou se a URL não for `localhost`, **pare e avise**. Não tente
> contornar.

**Dados do ambiente de QA** (seed, `prisma/seed.ts`):

- Empresa: `bigods` · fuso `America/Sao_Paulo` · `pagamentoManualWhatsapp: true`
- Serviços (preço da CASA): **Corte** R$ 40,00 (30 min) · **Barba** R$ 30,00 (20 min)
  > ⚠️ **O barbeiro pode ter preço próprio.** Erick Yan, por exemplo, cobra Corte R$ 44,99 e
  > Barba R$ 29,99 (override por barbeiro, DOMAIN.md §3.2.2). **Nunca confira o total contra o
  > preço da casa** — leia o preço que a tela mostra para o barbeiro escolhido e confira só a
  > REGRA do desconto em cima dele.
- Produtos: **Gel Fixador** R$ 15,00 · **Pomada Modeladora** R$ 35,00
- Ofertas: **5 Cortes** R$ 170,00 · **4 Barbas** R$ 100,00 · **Combo Corte + Barba** R$ 120,00
- Desconto progressivo: 2º item −R$ 10,00 · 3º −R$ 5,00 · 4º −R$ 10,00
- Barbeiros: **Erick Yan** (*com foto*) · **Gabriel** (sem foto, ADMIN+BARBEIRO) ·
  **Igor Molinho** (sem foto, só BARBEIRO)
- Logins do painel (senha `bigods123` para todos): `gabriel` (admin+barbeiro),
  `igormolinho` (**barbeiro puro — é com ele que se testa ACL**), `lkt` e `rafaelgrigio`
  (admin puros)
- **Telefone:** use um número diferente a cada caso, no formato `11 9XXXXXXXX`. Repetir número
  reaproveita a sessão e o caso seguinte não vai pedir OTP — o que parece bug e não é.
- **Código OTP:** em modo demo ele aparece **na própria tela**, num quadro abaixo do campo.
  É de lá que o agente lê.

---

## 1. Verificações transversais — valem em TODA tela

Não são um caso separado; o agente checa isto **em cada passo** e reporta na hora que aparecer:

1. **Console limpo.** `list_console_messages` após cada navegação. Qualquer `error` é achado.
   Warning de React em dev (`key`, `act`) é ruído conhecido — anote, não bloqueie.
2. **Nenhuma requisição 5xx.** `list_network_requests` filtrando status ≥ 500. Um 5xx é
   **bloqueante**, sempre.
3. **4xx só onde é esperado.** 401 ao entrar sem sessão é o desenho. 400/403/404 fora dos casos
   que este roteiro prevê é achado.
4. **Nenhuma imagem quebrada.** Nenhuma requisição de imagem com 403/404, e nenhum `<img>` com
   `naturalWidth === 0`:
   ```js
   [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src)
   ```
   Tem que voltar `[]`.
5. **Evidência.** `take_screenshot` ao fim de cada caso, nomeado `caso-NN-<resumo>.png`.

---

## 2. Funil público — o que o cliente vê (porta 5174)

### Caso 1 — Landing e identidade

Abra `http://localhost:5174/`.

**Passa se:** a página carrega; o favicon da aba é o bigode **em fundo escuro** (o funil usa a
versão invertida); os ícones de Instagram, WhatsApp e Google são os **logos de verdade**, não
emoji genérico (📷 💬 ⭐).

### Caso 2 — Escolha de barbeiro, com foto ★

Avance até "Com quem?".

**Passa se:**
- **Erick Yan** aparece com **foto**, num avatar redondo grande (64 px);
- **Gabriel** e **Igor Molinho** aparecem com as **iniciais** (`G`, `IM`) — mesmo tamanho, sem
  buraco no layout;
- existe a opção **"Não tenho preferência"**, com o mesmo tamanho de avatar.

**Por que importa:** foto é opcional em todo lugar. Uma lista que muda de forma quando alguém
sobe a sua é regressão.

### Caso 3 — Foto quebrada cai nas iniciais ★

Ainda na tela do caso 2, quebre a URL da foto do Erick e force o erro:

```js
document.querySelectorAll('img').forEach(i => { if (i.src.includes('/barbeiros/')) i.src = '/nao-existe.webp' });
```

**Passa se:** o avatar do Erick vira **iniciais** (`EY`). **Falha se** aparecer o ícone de
imagem partida do navegador.

### Caso 4 — Desconto progressivo

Escolha **Erick Yan** → selecione **Corte + Barba**.

**Passa se:** o resumo mostra desconto de **R$ 10,00** no 2º item, e o total é
`preço do Corte + preço da Barba − 10,00` **usando os preços que a própria tela exibe**.
Com o Erick (44,99 + 29,99): total **R$ 64,98**. Adicione um 3º serviço e confira −R$ 5,00.

Confira também que o desconto é **rateado entre os itens** no resumo (ex.: 29,99 → 25,99 e
44,99 → 38,99, somando exatamente o total).

### Caso 5 — Data e horário

**Passa se:** o seletor de dias abre; escolher um dia com expediente lista horários; um dia sem
disponibilidade mostra estado vazio **com texto**, nunca tela branca nem spinner eterno.

### Caso 6 — Order-bump: adicionar e remover

Na confirmação, a vitrine "Adicione à sua visita".

**Passa se:**
- os **produtos** aparecem com **miniatura** (foto, ou placeholder 🧴 — nunca imagem quebrada);
- adicionar um produto **soma ao total** exibido;
- clicar de novo **remove** e o total volta ao anterior;
- item com oferta mostra selo `−X%` e o preço normal riscado.

### Caso 7 — Pagar na barbearia (presencial) exige OTP

Escolha **"Pagar na barbearia"** e confirme.

**Passa se:** pede o código OTP; o código aparece na tela (modo demo); ao confirmar, chega na
tela de sucesso. **Falha se** agendar sem pedir código — foi um bug real já corrigido, e é
exatamente o que segura agenda falsa.

### Caso 8 — Pagar agora → ponte do WhatsApp ★★ (caminho do dinheiro)

Refaça o funil com **"Pagar agora"**.

**Passa se:**
1. o botão diz **"PIX pelo WhatsApp"** (não "PIX na hora");
2. a tela seguinte é **"Finalize pelo WhatsApp"**, com valor, botão *Abrir o WhatsApp* e o
   contador de reserva;
3. o link do botão é `https://wa.me/<numero>?text=...` — **decodifique o `text`** e confira que
   a comanda tem: nome do cliente, telefone, barbeiro, data/hora e **Total** batendo com a tela;
4. **nenhum QR Code** aparece;
5. expandindo "Ver a mensagem que será enviada", o texto é o mesmo.

**Por que é o caso mais importante:** em produção o pagamento online passa por aqui enquanto a
AbacatePay não libera. Se esta tela falhar, não entra dinheiro.

> **Não clique em "Abrir o WhatsApp"** — abriria o WhatsApp Web de verdade. Basta ler o `href`.

**Anote o `intencaoId`** (da URL de polling em `list_network_requests`) e o **horário agendado**:
os casos 14 e 15 usam.

### Caso 9 — Alterar pedido devolve o horário

Na tela do caso 8, clique **"← Alterar meu pedido"**.

**Passa se:** volta para a confirmação e o horário que estava reservado **volta a aparecer**
como livre ao reabrir a etapa de horários.

### Caso 10 — Link pessoal do barbeiro

Abra `http://localhost:5174/?barbeiro=erick-yan`.

**Passa se:** o funil já vem com o Erick escolhido e pula a etapa "Com quem?".
Depois abra `?barbeiro=nao-existe`: **passa se** cair no funil normal, **sem** mensagem de erro
na cara do cliente.

### Caso 11 — Aviso de sessão ativa

Sem limpar o navegador (a sessão do caso 8 continua), inicie um novo agendamento.

**Passa se:** existe aviso visível de que há uma **sessão ativa** e de qual telefone, com opção
de sair. **Por que:** sem isso, quem testa com vários números não entende por que o OTP parou
de ser pedido — reclamação real de quem usou.

### Caso 12 — Mobile

`resize_page` para **390 × 844** e refaça o caminho do caso 4 ao 8.

**Passa se:** nada estoura a largura (sem scroll horizontal), os botões continuam alcançáveis e
a tela da ponte do WhatsApp cabe sem cortar o valor. O funil é mobile-first: é assim que 90%
dos clientes vão usar.

---

## 3. Pacote / Bigod's Club (porta 5174)

### Caso 13 — Comprar pacote ★

Entre na trilha de pacotes e compre **5 Cortes** (R$ 170,00) escolhendo **Erick Yan**.

**Passa se:**
- a vitrine mostra as três ofertas com preço e economia;
- pede OTP (pacote **sempre** exige);
- cai na ponte do WhatsApp com a comanda contendo **"5× Corte"** e **"Total: R$ 170,00"**;
- **nenhum crédito** aparece ainda em "Minha conta" (caso 22 confirma).

**Anote o `vendaId`.**

---

## 4. Painel administrativo (porta 5173)

Login: `gabriel` / `bigods123`.

### Caso 14 — Aprovar o pagamento do avulso ★

Agenda → aba **"Aguardando pgto"**.

**Passa se:** o atendimento do caso 8 está lá com o selo *Aguardando pagamento*; abrir o detalhe
mostra o card **"Aguardando pagamento online"** com o botão **"Confirmar pagamento recebido"**;
clicar troca o status para **Agendado**.

### Caso 15 — Aprovar duas vezes não duplica

Clique **"Confirmar pagamento recebido"** de novo no mesmo atendimento (se ainda visível) ou
repita a chamada.

**Passa se:** nenhum erro na tela e nada duplica. O caminho é idempotente por construção.

### Caso 16 — Liberar os créditos do pacote ★

Pacotes & Ofertas → **Vendidos** → a venda do caso 13 → **"Confirmar pagamento recebido"**.

**Passa se:** o status vira **PAGO** e a venda passa a listar **5 itens disponíveis**.

### Caso 17 — Foto do barbeiro: subir, trocar, remover ★

Usuários → **Gabriel** → *Foto de perfil*.

**Passa se:**
1. **Enviar foto** com um JPG/PNG qualquer → aparece redonda em segundos;
2. o funil (caso 2) passa a mostrar Gabriel **com foto**;
3. **Trocar** por outra → a nova aparece;
4. **Remover** → volta para as iniciais no painel **e** no funil.

**Também teste a recusa:** renomeie um arquivo de texto para `.jpg` e envie.
**Passa se** aparecer a mensagem **"Envie JPG, PNG ou WebP"** — e **não** um "Internal server
error". Se vier erro genérico, é achado **bloqueante**: significa que o servidor está com
credencial AWS vencida ou permissão faltando (veja o log da API, que diz o conserto).

### Caso 18 — Foto do produto

Catálogo → Produtos → editar **Pomada Modeladora** → enviar foto.

**Passa se:** a miniatura aparece na lista; aparece na **venda avulsa** (ao lado do select); e
aparece na **vitrine do order-bump** no funil, se o produto estiver configurado em Funil de
Vendas.

### Caso 19 — Concluir atendimento

Agenda → um atendimento **Agendado** → concluir, escolhendo forma de pagamento.

**Passa se:** exige forma de pagamento quando há item avulso; conclui; e o atendimento aparece
em Financeiro/Fechamento com a comissão do barbeiro.

### Caso 20 — ACL do barbeiro não-admin ★★

Saia e entre como **`igormolinho` / `bigods123`**.

**Passa se TODAS forem verdade:**
- as abas **Catálogo**, **Usuários** e **Funil de Vendas** **não existem** (não é "existe e dá
  erro ao clicar" — é não aparecer);
- em Pacotes, **não** há botão **"+ Vender"**;
- ele vê **apenas** os pacotes comprados com ele — nenhum de Erick ou Gabriel;
- em **Ajustes** há só o perfil dele, **"Minha foto"** e **"Alterar senha"** — nenhum parâmetro
  de empresa;
- ele consegue trocar **a própria** foto e a própria senha (errar a senha atual deve recusar).

**Por que dobra de importância:** o princípio acordado é *"se ele não tem acesso, ele não pode
ver"*. Uma aba que aparece e dá erro ao clicar é falha, mesmo o backend recusando direito.

---

## 5. Minha conta — cockpit do cliente (porta 5175)

Entre com o **mesmo telefone** usado no caso 13.

### Caso 21 — Login e créditos

**Passa se:** o login por OTP funciona e os **5 créditos de Corte** liberados no caso 16
aparecem.

### Caso 22 — Agendar com crédito ★

Use um crédito.

**Passa se:** a tela diz que o pacote foi comprado **com Erick Yan** e **não** oferece escolha
de barbeiro (a compra amarrou); o avatar do Erick aparece com **foto**; o agendamento conclui e
some 1 crédito.

### Caso 23 — Cancelar e reagendar

**Passa se:** cancelar dentro do prazo devolve o crédito; reagendar cria um novo horário e
libera o antigo; e uma tentativa **fora do prazo** é recusada com mensagem clara — não com erro
técnico.

### Caso 24 — Reembolso de saldo residual

⚠️ **Reembolso não é de crédito não usado** — é do **saldo residual**, a sobra em dinheiro que
fica quando o crédito é usado num serviço mais barato que o valor rateado
(`UsarSaldoResidual.tsx`). Sem saldo residual, a opção não existe na tela, e isso é o correto.

Para exercitar, primeiro gere saldo residual (use um crédito de Corte num serviço mais barato),
depois entre em "Usar saldo" → **Pedir reembolso**.

**Passa se:** a solicitação entra como **pendente** e aparece em Financeiro → Reembolsos no
painel.

---

## 6. Saúde geral

### Caso 25 — Lighthouse no funil

`lighthouse_audit` em `http://localhost:5174/`, modo **mobile**.

Não há nota mínima obrigatória — o objetivo é **comparar com o deploy anterior** e flagrar
queda. Registre Performance, Acessibilidade e Melhores Práticas. Anote qualquer item de
acessibilidade crítico (contraste, alvo de toque pequeno, campo sem label).

### Caso 26 — Console e rede, consolidado

Repasse tudo o que foi coletado na seção 1 e liste, uma vez só, todos os erros de console e
todas as requisições ≥ 400 que não estavam previstas.

---

## 7. O que este roteiro NÃO cobre — de propósito

Não tente verificar pelo navegador:

- **Rateio de pacote, comissão, arredondamento.** É conta de dinheiro; está coberto por testes
  de domínio puro, que provam melhor e mais rápido. Conferir pela tela dá falsa confiança.
- **Expiração da reserva (10 min).** Um agente não deve ficar 10 minutos parado. Para exercitar,
  force o vencimento direto no banco e depois recarregue a tela de espera:
  ```sql
  UPDATE "IntencaoDePagamento" SET "expiraEm" = now() - interval '1 minute' WHERE id = '<intencaoId>';
  UPDATE "Atendimento" SET "reservaOnlineExpiraEm" = now() - interval '1 minute' WHERE id = '<atendimentoId>';
  ```
  **Passa se** a tela vira "Sua reserva expirou" e o horário volta a aparecer livre no funil.
- **Constraint de sobreposição de horário sob concorrência.** É teste de integração com banco.
- **Idempotência do webhook.** Idem.

---

## 8. Relatório final — o formato que decide o deploy

O agente termina com:

```
## QA go-live — <data> — commit <hash curto>

Resultado: N casos · X passaram · Y falharam

| # | Caso | Status | Gravidade | Evidência |
|---|------|--------|-----------|-----------|
| 8 | Ponte do WhatsApp | ❌ | BLOQUEIA | caso-08-ponte.png |
...

### Bloqueiam o go-live
- <descrição objetiva: o que fez, o que esperava, o que aconteceu>

### Não bloqueiam
- <...>

### Não executados
- <caso e por quê>
```

**Classificação de gravidade** — o agente decide por esta régua, não por impressão:

- **BLOQUEIA** — qualquer 5xx; qualquer falha nos casos marcados ★★ (8, 20); dinheiro que não
  entra ou entra errado; dado de um cliente visível para outro; ACL furada; fluxo que não chega
  ao fim.
- **NÃO BLOQUEIA** — cosmético, texto, alinhamento, warning de console em dev, queda pequena de
  Lighthouse.
- **Na dúvida, BLOQUEIA** e descreva. Quem decide subir é o dono, mas ele precisa saber.

Um caso que o agente não conseguiu executar **não é um caso que passou**. Liste em "não
executados", sempre.

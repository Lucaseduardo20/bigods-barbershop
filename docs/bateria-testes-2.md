# Smoke Test — Sessão B (preço por barbeiro + pacote + link)

> **Escopo:** o que a Sessão B mudou (Blocos A–D) + re-teste dos blocos de dinheiro
> que ela pode ter quebrado (Blocos E–G). Não repete os cenários intocados
> (blocos 0, 1, 3, 6 do smoke anterior).
>
> **STATUS:** `OK` · `BUG` · `ESTRANHO` · `NÃO TESTADO`
> **Gravidade:** `BLOQUEIA` · `INCOMODA` · `COSMÉTICO` · `—`
>
> **Antes de começar:** banco limpo → `docker compose down -v && docker compose up -d`
> → migrate → seed. Apps: admin (5173) · booking (5174) · account (5175). `DEMO_MODE=true`.
>
> **Setup extra desta rodada:** no admin, coloque **preços diferentes** para o mesmo
> serviço entre Gabriel e Lucas Andrade (ex: Corte — Gabriel R$50, Lucas R$40).
> Metade dos cenários depende disso.

---

## Regras de ouro

1. Toda vez que aparecer **dinheiro**, confira a conta (preço, rateio, economia, comissão).
2. Anote tudo que destoar, mesmo bobo. Não corrija durante o teste.
3. Nos cenários ★, confira **centavo a centavo** — são os de risco financeiro.

---

# BLOCO A — CRUD de oferta de pacote (novo)

### A.1 — Criar oferta simples (um serviço)
Admin → criar oferta "5 Cortes" do Gabriel, definindo por **preço fixo**.
Esperado: salva, mostra o preço avulso somado e o % de desconto derivado.
```
STATUS: OK
O que vi: funcionando.
Gravidade:
```

### A.2 — ★ Criar oferta MISTA (o que não dava pra testar antes)
Criar oferta com composição mista: 2 Cortes + 2 Barbas, preço com desconto.
Esperado: aceita composição de serviços diferentes; preview mostra soma dos
avulsos, economia em R$ e em %.
```
STATUS: OK
O que vi: funciona.
Gravidade:
```

### A.3 — ★ Modo de entrada por PERCENTUAL
Criar/editar oferta digitando **% de desconto** (ex: 20%).
Esperado: mostra o preço calculado ANTES de salvar; ao salvar, o que fica
gravado é o preço (não o %).
```0
STATUS: OK
O que vi: Funciona.
Gravidade:
```

### A.4 — ★ Preço é a fonte de verdade (teste chave)
Depois de criar uma oferta com 20% de desconto, **mude o preço avulso do serviço**
no admin (ex: Corte de R$50 → R$60).
Esperado: o preço do PACOTE **não muda**; só o % exibido cai (o desconto real
diminuiu). Se o preço do pacote mudou sozinho, é BUG grave.
```
STATUS: BUG
O que vi: não está dando pra editar o preço dos serviços, não tem a funcionalidade.
Gravidade: BLOQUEIA
```

### A.5 — Invariantes de cadastro
Tentar: preço 0 · composição vazia · quantidade 0 · preço MAIOR que a soma dos avulsos.
Esperado: todos rejeitados com mensagem clara (não erro cru).
```
STATUS: ESTRANHO
O que vi: não da pra criar com composição vazia, se tento criar com um serviço e quantidade 0 ele solta erro cru (composicao should not be empty)
Gravidade: BLOQUEIA
```

### A.6 — Serviço que o barbeiro não atende
Tentar criar oferta do Pedro Martins com um serviço que ele não atende.
Esperado: rejeitado.
```
STATUS: BUG - 
O que vi: consigo criar com um serviço que ele não atende.
Gravidade: BLQOUEIA
```

### A.7 — Desativar oferta
Desativar uma oferta ativa. Esperado: some do funil público, não é deletada.
```
STATUS: OK
O que vi: sumiu do funil.
Gravidade:
```

---

# BLOCO B — Preço por barbeiro

### B.1 — Cadastrar override de preço
Admin → definir preço do Corte diferente para Gabriel e Lucas.
Esperado: UI deixa claro o que é preço de referência da casa e o que é override.
```
STATUS: BUG
O que vi: consigo alterar o preço, mas no funil o valor não muda.
Gravidade: BLOQUEIA.
```

### B.2 — ★ Rateio usa o preço DO BARBEIRO
Criar a MESMA oferta (mesma composição) para Gabriel e para Lucas.
Esperado: o % de desconto exibido é **diferente** entre eles (porque a soma dos
avulsos difere). Isso é correto, não é bug.
```
STATUS: BUG
O que vi: ao criar o pacote pro gabriel que está com preços diferentes, não é considerado o preço dele e sim o preço global.
Gravidade: BLOQUEIA
```

### B.3 — ★★ Snapshot protegido (o teste mais importante do dia)
1. Venda um pacote do Gabriel para um cliente e conclua um atendimento (gera comissão).
2. Anote: valor do pacote, valor rateado do item, valor da comissão.
3. **Mude o preço do Corte do Gabriel** no admin.
4. Volte no histórico/extrato e confira os MESMOS registros.
Esperado: venda antiga, valor rateado e comissão **idênticos**, sem nenhuma alteração.
```
STATUS: OK - adendo
O que vi (anote os valores antes e depois): 33,33 o valor do corte e 15 de comissão. porém eu altero o valor do corte pro gabriel mas isso não reflete em lugar nenhum.
Gravidade: BLOQUEIA
```

### B.4 — Crédito só com o barbeiro dono
Cliente com pacote do Gabriel tenta agendar o crédito com o Lucas.
Esperado: recusado com mensagem clara.
```
STATUS: OK
O que vi: não tem como usar crédito com outro, o sistema nem permite selecionar outro se ja comprei o pacote de um barbeiro.
Gravidade:
```

### B.5 — Inconsistência conhecida (DECISÃO #18 — confirmar, não é bug)
Agende um AVULSO com o Gabriel e outro com o Lucas, mesmo serviço.
Esperado (hoje): **ambos cobram o mesmo** (preço de referência), mesmo com
override cadastrado. Confirme se esse comportamento te incomoda — é decisão sua,
não bug de código.
```
STATUS: NÃO TESTADO.
O que vi: em teoria se tem override cadastrado ele deveria cobrar pelo valor do override, não entendi mt bem esse teste na real.
Isso precisa mudar antes do dia 25? (SIM/NÃO): 
```

---

# BLOCO C — Workflow de aprovação

### C.1 — Barbeiro cria → fica pendente
Logar como barbeiro (não-admin) e criar uma oferta.
Esperado: fica PENDENTE_APROVACAO, não aparece no funil público.
```
STATUS: BUG
O que vi: barbeiro não pode criar pacote de oferta.
Gravidade: BLOQUEIA
```

### C.2 — Admin aprova
Admin vê a pendência, aprova.
Esperado: vira APROVADO e passa a aparecer no funil público.
```
STATUS: OK
O que vi: admin aprova mas o barbeiro não pode criar, então não faz mt sentido.
Gravidade: BLOQUEIA
```

### C.3 — Admin rejeita com motivo
Rejeitar uma oferta informando motivo.
Esperado: vira REJEITADO, motivo visível, não aparece no funil.
```
STATUS: ESTRANHO
O que vi: ta, ele mostra a rejeição, tag de rejeitado, porém mostra tag de ativo também, e não faz sentido.
Gravidade: INCOMODA.
```

### C.4 — Editar aprovado volta pra pendente
Editar uma oferta já APROVADA.
Esperado: volta a PENDENTE_APROVACAO e some do funil até reaprovar.
```
STATUS: OK
O que vi: volta pra pendente e entra no workflow de aprovação, sai do funil.
Gravidade: 
```

### C.5 — Gabriel aprova a própria oferta
Logar como Gabriel (admin + barbeiro), criar e aprovar a própria oferta.
Esperado: consegue — senão o fluxo trava com um único usuário real.
```
STATUS: OK
O que vi: ele consegue criar e aprovar.
Gravidade:
```

### C.6 — Barbeiro não aprova oferta alheia
Barbeiro não-admin tenta aprovar oferta de outro.
Esperado: recusado.
```
STATUS: OK
O que vi: barbeiro não admin não consegue nem criar uma oferta, quem dirá aprovar.
Gravidade: 
```

---

# BLOCO D — Funil reordenado + link pessoal

### D.1 — Barbeiro vem PRIMEIRO
Abrir o funil público normal (sem link).
Esperado: escolhe barbeiro ANTES de serviço; os preços mostrados já são os
daquele barbeiro.
```
STATUS: BUG
O que vi: barbeiro vem sim primeiro, mas os preços estão sempre os mesmos.
Gravidade: BLOQUEIA.
```

### D.2 — Skip automático com um só barbeiro
Se só houver um barbeiro ativo atendendo, a etapa some.
Esperado: pula direto pro serviço, sem tela vazia.
```
STATUS: BUG
O que vi: ainda possui a etapa porém com tela branca, mesmo o responde vindo apenas um barbeiro.
Gravidade: BLOQUEIA
```

### D.3 — ★ Link pessoal do barbeiro
Pegar o link do Gabriel no admin (botão copiar), abrir em aba anônima.
Esperado: barbeiro pré-selecionado, etapa pulada, banner "Agendando com Gabriel".
```
STATUS: OK
O que vi: ele pula a etapa de seleção de barbeiro tanto no avulso quanto no pacote.
Gravidade:
```

### D.4 — ★ Link vence estado salvo (armadilha clássica)
1. Comece um agendamento com o Lucas pelo funil normal (chegue até a data).
2. SEM fechar, abra o link do Gabriel na mesma aba.
Esperado: o funil reseta e passa a ser Gabriel — nunca continua com Lucas.
```
STATUS: OK
O que vi: funil resetado e passa a ser novo barbeiro.
Gravidade:
```

### D.5 — Saída "ver outros profissionais"
Pelo link do Gabriel, clicar em "ver outros profissionais".
Esperado: libera a escolha, sem quebrar o funil.
```
STATUS: OK
O que vi: funciona.
Gravidade:
```

### D.6 — Slug inválido
Abrir `?barbeiro=xxxxxx` (slug que não existe).
Esperado: cai no funil normal, SEM tela de erro/404 na cara do cliente.
```
STATUS: OK
O que vi: cai no funil normal.
Gravidade:
```

### D.7 — Origem registrada
Concluir um agendamento vindo do link do Gabriel; verificar no admin/banco se
a origem ficou registrada.
```
STATUS: ESTRANHO
O que vi: origem registrada apenas no banco, no admin não diz nada e .
Gravidade:
```

### D.8 — Ofertas filtradas por barbeiro
Entrar pelo link do Gabriel e ir pra trilha de pacote.
Esperado: só aparecem ofertas do Gabriel, com os preços dele.
```
STATUS: OK
O que vi: só aparecem ofertas do gabriel, com os preços dele.
Gravidade:
```

---

# BLOCO E — Re-teste: pacote + pagamento (bloco 2 do smoke anterior)

### E.1 — ★ Comprar pacote MISTO online, ponta a ponta
Comprar a oferta mista (2 cortes + 2 barbas), pagar online (demo), confirmar.
```
STATUS:OK
O que vi: a compra funciona normalmente.
Gravidade:
```

### E.2 — ★★ Rateio do pacote misto (centavo a centavo)
No cockpit/admin, conferir o valor rateado de CADA um dos 4 itens.
Esperado: soma dos rateados == valor pago, exatamente. Sem centavo sobrando.
```
STATUS: OK
Valores que vi (item a item + soma): item a item com o valor rateado, comissão funcionando e soma de todos os itens === valor pago.
Gravidade:
```

### E.3 — Economia visível no funil
Na tela de compra, conferir: preço do pacote, preço avulso, economia em R$ e %.
Esperado: os números batem entre si.
```
STATUS: OK - com adendo
O que vi: o adendo é que o valor do preço avulso do pacote considera o valor do barbeiro, mas se for agendar avulso não considera o valor definido barbeiro.
Gravidade:
```

### E.4 — Pagou mas não confirmou
Gerar PIX e não pagar. Esperado: AGUARDANDO, créditos não liberados.
```
STATUS: OK
O que vi: ficou aguardando e não liberou créditos.
Gravidade:
```

### E.5 — Idempotência do pagamento
Simular o pagamento duas vezes. Esperado: libera uma vez só.
```
STATUS: OK
O que vi: liberado apenas um pacote.000
Gravidade:
```

### E.6 — Pacote presencial + confirmação no admin (bug 8 corrigido)
Comprar presencial → admin confirma pagamento → créditos liberam.
```
STATUS: ok
O que vi: funciona normalmente
Gravidade:
```

### E.7 — OTP único pós-compra (bug 1 corrigido)
Comprar → "criar acesso agora" → OTP → deve cair LOGADO na conta, sem segundo OTP.
Depois: tentar voltar/refresh — não pode reabrir tela de pagamento de pacote pago.
```
STATUS: BUG
O que vi: CAÍ LOGADO EM UMA CONTA QUE APARENTEMENTE JA ESTAVA LOGADA
Gravidade: BLOQUEIA
```

---

# BLOCO F — Re-teste: conclusão e comissão (bloco 4 do smoke anterior)

### F.1 — ★ Comissão sobre valor rateado (com preço por barbeiro)
Concluir atendimento de crédito de pacote misto.
Esperado: comissão calculada sobre o valor **rateado**, não o avulso.
```
STATUS:OK
O que vi:calculado sob rateado
Gravidade:
```

### F.2 — Concluir pago-online não pede pagamento
```
STATUS: OK
O que vi: funciona normalmente.
Gravidade:
```

### F.3 — Add-on em pago-online mostra só o adicional
```
STATUS: OK
O que vi: mostra só o adicional a ser cobrado.
Gravidade:
```

### F.4 — Add-on em crédito mostra o valor a cobrar (bug 5 corrigido)
```
STATUS: BUG
O que vi: ao concluir um atendimento de crédito de pacote, adiciono novo serviço e ele me cobra o valor dos dois serviços.
Gravidade: BLOQUEIA
```

### F.5 — Comissão carrega no primeiro select (bug 4 corrigido)
Abrir tela de comissão. Esperado: dados do primeiro barbeiro carregam de cara.
```
STATUS: OK
O que vi: funciona
Gravidade:
```

### F.6 — Saldo real vs projeção separados
```
STATUS: OK
O que vi:
Gravidade:
```

---

# BLOCO G — Re-teste: ciclo do pacote (bloco 5 do smoke anterior)

### G.1 — Falta simples → segunda chance com prazo de 10 dias (bug 6 corrigido)
Esperado: mostra **10**, não 11.
```
STATUS: OK
O que vi: funciona
Gravidade:
```

### G.2 — Reagendar na segunda chance
```
STATUS: ok
O que vi:
Gravidade:
```

### G.3 — Segunda falta expira + saldo residual com plural correto (bug 7 corrigido)
Levar DOIS itens à expiração. Esperado: mensagem no plural correto.
```
STATUS: ok
O que vi:
Gravidade:
```

### G.4 — Cancelar antecipado com falta computada (loophole)
Esperado: volta pra SEGUNDA_CHANCE com prazo original, não DISPONIVEL.
```
STATUS:ok
O que vi:
Gravidade:
```

### G.5 — Texto de segunda chance sem erro de gênero (bug 7 corrigido)
Esperado: "o horário de Corte", nunca "sua corte".
```
STATUS: ok
O que vi:
Gravidade:
```

---

# Anotações livres

```
- não consigo gerenciar via admin qual serviço cada barbeiro atende.
- não possui máscara nem formatação nos campos de preenchimento de valores.
- os pacotes estão na sessão de ajustes sendo que já existe uma sessão de pacotes na barra de navegação do aplicativo admin.
- ainda não é possível fazer nada com o saldo liberado para o cliente quando ele falta 2 vezes, ele deve escolher a opção de comprar novo serviço com aquele saldo ou pedir o reembolso em até 45 dias (o prazo de reembolso deve ficar claro pra ele).
```

---

# Resumo

| Gravidade | Quantos |
|---|---|
| BLOQUEIA |  |
| INCOMODA |  |
| COSMÉTICO |  |

**Decisão #18 (preço por barbeiro no avulso) — precisa entrar antes do dia 25?**
```
não.
```

**Sensação geral (1 linha):**

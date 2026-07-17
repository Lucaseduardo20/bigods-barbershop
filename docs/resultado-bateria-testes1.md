# Smoke Test Manual — Bigod's Barber v2

> **Como usar:** para cada cenário, preencha os 3 campos (`STATUS`, `O que vi`, `Gravidade`).
> Não corrija nada durante o teste — só anote e siga. Traga este arquivo preenchido de volta.
>
> **STATUS:** `OK` · `BUG` · `ESTRANHO` · `NÃO TESTADO`
> **Gravidade (pro dia 20):** `BLOQUEIA` · `INCOMODA` · `COSMÉTICO` · `—`
>
> **Antes de começar:** banco limpo obrigatório →
> `docker compose down -v && docker compose up -d` → migrate → seed.
> Apps: admin (5173) · booking (5174) · account (5175). `DEMO_MODE=true`.

---

## Regras de ouro enquanto testa

1. Anote **tudo** que destoar, mesmo bobo (piscou, demorou, data em inglês).
2. Toda vez que aparecer **dinheiro** (preço, rateio, comissão, "a cobrar"), confira a conta.
3. Pense como **cliente confuso**: clica errado, volta, fecha aba, digita bobagem.
4. Não corrija durante o teste — anota e continua.

---

# BLOCO 0 — Setup e sanidade

### 0.1 — Subir tudo do zero
Down -v → up → migrate → seed. Os 3 apps abrem, API responde, sem erro no console/log.
```
STATUS:OK
O que vi:só subir o banco com docker-compose up não roda migrations nem seeds.
Gravidade: - 
```

### 0.2 — Login dos 3 perfis de staff
Logar admin como `gabriel`, `lkt`, `rafaelgrigio`. Os três entram. lkt e rafael NÃO aparecem como opção de barbeiro pra agendar; Gabriel aparece.
```
STATUS:OK
O que vi: os três logins logaram normalmente.
Gravidade: - 
```

### 0.3 — Domingo fechado
Confirmar no admin (agenda + expediente) que domingo não tem slot em lugar nenhum.
```
STATUS:OK
O que vi: Se o domingo não está cadastrado no expediente do barbeiro ele não aparece nenhum slot, só se eu definir o domingo pro expediente ai ele aparece.
Gravidade:- 
```

---

# BLOCO 1 — Funil público avulso (booking, sem login)

### 1.1 — Caminho feliz (avulso presencial)
Marcar um corte avulso, pagamento presencial, até a tela de sucesso. Depois confirmar no admin: apareceu na agenda, dia certo, hora certa, nome/telefone certos.
```
STATUS: OK
O que vi: Fiz o agendamento e apareceu em todos os lugares devidos com base no case do teste.
Gravidade:
```

### 1.2 — Fuso horário (já pegou bug antes)
Marcar horário perto do limite do dia (ex: 17h30). Confirmar no admin: mesmo dia, mesma hora. Se possível, mudar fuso do SO (ex: Tóquio) e confirmar que a hora no admin NÃO muda.
```
STATUS: OK
O que vi:Horário ficou correto, tanto no agendamento quanto no admin
Gravidade:
```

### 1.3 — Multi-serviço
Marcar corte + barba juntos. Duração somada, preço somado, slot ocupa o tempo dos dois.
```
STATUS: OK
O que vi: Peguei corte + barba que da 50 min, marquei as 09h30 e o próximo horário de agendamento é só 10h30, respeitando a duração e a margem de 10 minutos.
Gravidade:
```

### 1.4 — Conflito de horário
Duas abas, mesmo horário, mesmo barbeiro, confirmar as duas. A segunda falha com mensagem clara (não erro genérico feio).
```
STATUS: ESTRANHO
O que vi: o primeiro agendou, o segundo mostra mensagem de erro desformatada (Conflito de horário: barbeiro já tem atendimento 01e6fe54-db04-4635-a7cf-3035d62840fd sobreposto) - eu voltando e refazendo o agendamento, quando chego na ultima tela o erro ainda aparece lá, não some depois de eu editar, o erro é uma div no form antes do botão de confirmar, acho que precisamos de alguns alerts.
Gravidade: BLOQUEIA
```

### 1.5 — Reconciliação por telefone
Dois agendamentos, mesmo telefone. Conferir no admin/banco: é UM cliente só, não dois.
```
STATUS: OK
O que vi: Dois agendamentos com o mesmo telefone é pro mesmo Cliente no banco
Gravidade:
```

### 1.6 — Refresh no meio do funil
Começar a marcar, chegar na etapa de data, dar F5. Progresso sobrevive ou reinicia limpo — não quebra em tela branca.
```
STATUS: OK
O que vi: Progresso sobrevive.
Gravidade:
```

### 1.7 — Slot que encheu enquanto olhava
Deixar tela de horários aberta, marcar aquele horário por outra aba, voltar e tentar confirmar o mesmo. Erro tratado, não tela quebrada.
```
STATUS: OK - com adendo
O que vi: o adendo é, o erro só vai aparecer quando ele for confirmar na tela de confirmar agendamento, quando ele escolhe a data que ja foi preenchida ainda ele passa pra próxima tela e lá vai estourar o erro (Conflito de horário: barbeiro já tem atendimento 38fdfa52-6b72-4407-ac0c-ac042c8e4d3d sobreposto), não na tela de horários e sim na hora de confirmar.
Gravidade: INCOMODA
```

### 1.8 — Barbearia fechada
Navegar até um domingo. Sem horários, mensagem clara de indisponível (não lista vazia sem explicação).
```
STATUS: ESTRANHO
O que vi: aparece a mensagem, mas não informa que a barbearia está fechada, informa o seguinte: (Sem horários neste dia
A agenda está cheia. Que tal tentar o próximo dia?
Ver próximo dia)
Gravidade: COSMÉTICO
```

### 1.9 — Telefone inválido
Digitar telefone incompleto/estranho. Validação barra antes de enviar.
```
STATUS: OK - com adendo
O que vi: ele não deixa o usuário clicar no botão quando o numero de telefone é < 8 numeros, mais um caso que talvez encaixe numa validação com aqueles alerts laterais e etc.
Gravidade: INCOMODO
```

---

# BLOCO 2 — Funil de PACOTE + pagamento online (maior risco financeiro)

### 2.1 — Compra de pacote online (feliz)
Comprar "5 Cortes", pagar online (PIX demo), simular pagamento, tela avança sozinha. Pacote existe como PAGO.
```
STATUS: ESTRANHO
O que vi: comprei o pacote, paguei, tudo certo, pacote pago, porém, quando a tela avança após o pagamento, o cliente precisa receber um código pra acessar a conta dele, esse código chega (testei demo), ele valida, o código é valido, porém ele não vai pra conta dele ainda, ele vai pro login da tela do cliente pra fazer otp dnv, ele não loga direto no primeiro otp, então fica 2 otp nesse fluxo, e quando eu clico pra agendar um horário na tela do segundo OTP ele volta pra tela de confirmação de pagamento, podendo realizar o pagamento novamente e comprar outro pacote sem querer.
Gravidade: BLOQUEIA
```

### 2.2 — ★ CRÍTICO: gerou PIX mas NÃO pagou
Gerar o PIX e NÃO simular. Fechar a aba. Pacote fica AGUARDANDO, créditos NÃO liberados. Confirmar que não dá pra usar crédito de pacote não-pago.
```
STATUS: OK
O que vi: ok, ele fica la aguardando 
Gravidade:
```

### 2.3 — ★ Idempotência do pagamento
Simular pagamento do mesmo PIX DUAS vezes (botão demo 2x ou webhook 2x). Pacote liberado uma vez só, sem crédito duplicado, sem erro.
```
STATUS: OK
O que vi: Pagamento é idempotente, só cria um pacote se pagar o mesmo pix.
Gravidade:
```

### 2.4 — Pacote presencial
Comprar pacote escolhendo "pagar na barbearia". Fica AGUARDANDO. Confirmar como o barbeiro marca pago no admin, e que só aí os créditos liberam.
```
STATUS: OK - com adendo
O que vi: ok, funciona no sistema em sí. o adendo é que não sei se isso ficaria legal como regra de negócio em sí, pois pagar um pacote presencial pode confundir o cliente com ele indo lá achando que ja vai cortar, mas em teoria ele vai la só pra pagar e assim liberar os créditos para ele agendar o serviço, pode confundir ele e talvez não seja o caso mais, é de se pensar.. outro ponto é que o barbeiro nem o admin consegue dizer que aquele pacote foi pago pelo painel admin.
Gravidade: BLOQUEIA
```

### 2.5 — ★ Rateio (conferir o número)
Comprar pacote misto (ex: 2 cortes + 2 barbas com desconto). No cockpit/admin, verificar valor rateado de cada item. Soma dos rateados = valor pago, centavo a centavo.
```
STATUS: BUG
O que vi: a interface do admin não me permite criar um pacote misto, pois no admin, só posso vender um pacote para um cliente específico e não para esse pacote entrar na lista de pacotes do cockpit de venda.
Gravidade: BLOQUEIA
```

### 2.6 — Onboarding pós-compra
Usar "criar seu acesso agora" na tela de sucesso, com OTP. Acesso criado; consegue logar em seguida.
```
STATUS: ESTRANHO
O que vi: quando clico em criar seu acesso agora, após a compra do pacote, ele me traz um otp, concluo, se clico em logar ele me traz outro otp pra aí assim o cliente fazer o login, então teoricamente são 2 otps pós compra do pacote.
Gravidade: BLOQUEIA
```

### 2.7 — Expiração de PIX
Se der pra simular/esperar um PIX expirar, ver o tratamento de EXPIRADO. Opção clara de tentar de novo.
```
STATUS: POSSÍVEL BUG
O que vi:O cliente nunca sabe quando o pix expira pois a tela não deixa claro, e eu particularmente não sei se o pix expira no sistema em si.
Gravidade:
```

---

# BLOCO 3 — Cockpit do cliente (account)

### 3.1 — Login OTP feliz
Logar com telefone + código demo. Ver o pacote comprado com as fichas certas (5 disponíveis).
```
STATUS: OK
O que vi: Login bem sucedido com o pacote comprado.
Gravidade:
```

### 3.2 — ★ Telefone sem conta / cliente só-avulso
(a) Logar com telefone que nunca comprou nada → resposta neutra + caminho pra agendar.
(b) **O ponto-chave:** um cliente que só fez agendamento AVULSO consegue logar? (provavelmente NÃO — anota, é a dor da Sessão C).
```
STATUS: BUG
O que vi: O numero que nunca comprou nada, mesmo colocando o numero de telefone lá, ainda vai ir sentido OTP, chega na tela de digitar o código, ele pode apenas trocar o número ou reenviar o código, sem mensagem de que ele ainda não é cliente.
Gravidade: BLOQUEIA
```

### 3.3 — Agendar com crédito
Usar um crédito do pacote, escolher dia/hora, confirmar. "Sem cobrança" explícito, ficha vira "agendada", aparece no topo como próximo agendamento.
```
STATUS: OK
O que vi:
Gravidade:
```

### 3.4 — Fichas com estados diferentes
Ver um pacote com fichas em estados diferentes ao mesmo tempo (disponível, agendada, consumida). Cada uma visualmente distinta e correta.
```
STATUS: OK - com adendo.
O que vi: ele ainda não consegue reagendar caso queira ou cancelar, apenas o barbeiro ou admin consegue cancelar, mas acho que isso está ainda em outra sessão.
Gravidade: INCOMODA
```

### 3.5 — Alerta de segunda chance
Após provocar uma falta (Bloco 5), voltar ao cockpit. Alerta de prazo no topo, acima de tudo, com dias restantes.
```
STATUS: OK - com adendo
O que vi: ok, porém o adendo é que a mensagem que aparece pra ele está sendo essa: Você tem 11 dias para reagendar "sua" corte
Depois do prazo, o valor vira saldo no pacote — mas você perde a corte.
Reagendar agora

sua corte me quebra.
Gravidade: INCOMODA
```

### 3.6 — Saldo residual
Levar um item à segunda falta (expiração). Saldo residual aparece no pacote sem sumir dinheiro.
```
STATUS: OK - com adendo
O que vi: pelo que entendi, o saldo que fica não está disponível ainda pra eu usar, esse crédito seria usado quando o cliente for agendar um novo serviço e consideraríamos esse crédito ou apenas em novos pacotes seria possível utilizar, é um ponto a se pensar.
Gravidade: INCOMODA
```

### 3.7 — Cliente sem nenhum pacote
Logar com alguém que só tem avulso (se conseguir logar). Tela funciona, não quebra, oferece algo.
```
STATUS: BUG
O que vi: entra no mesmo caso do item 3.2, ele vai ser direcionado pro otp e ficar aguardando código, nada diz se ele tem ou não uma conta ativa como cliente.
Gravidade: BLOQUEIA
```

### 3.8 — Segurança: pacote de outro cliente
(Se tiver manha técnica) tentar acessar via API o pacote de outro cliente com seu token. Esperado: 403.
```
STATUS: OK - necessário validar se fiz certo
O que vi: entrei no login de um cliente, peguei o curl e colei no postman, tentei logar com outro cliente e usei o codigo do otp com o cliente 1 no postman, deu 401. tentei agendar um corte no pacote de outro cliente com o meu bearer token e ele da 403 informando que o pacote não pertence a este cliente.
Gravidade: CRITICO SE ESTIVER ERRADO.
```

---

# BLOCO 4 — Admin: agenda e conclusão (onde dinheiro é registrado)

### 4.1 — Concluir avulso presencial
Concluir informando forma de pagamento. Pede pagamento, registra, gera comissão.
```
STATUS: OK - com adendo
O que vi: o adendo é que, eu confirmei usando minha conta de admin, quando fui pra comissão estava o gabriel como primeira opção do select, porém sem carregar os dados dele, eu preciso ir pra outro barbeiro e depois ir pro gabriel novamente pra ver a comissão dele
Gravidade: BLOQUEIA
```

### 4.2 — ★ Concluir pago-online (bug corrigido)
Concluir um atendimento pago online. NÃO pede forma de pagamento, mostra "Pago online", conclui direto.
```
STATUS: OK
O que vi: não pede forma de pagamento.
Gravidade: - 
```

### 4.3 — Walk-in add-on
Num atendimento AGENDADO, adicionar uma barba antes de concluir. Entra na conta, comissão sobre corte+barba.
```
STATUS: OK
O que vi: comissão sobre ambos.
Gravidade:
```

### 4.4 — ★ Add-on em atendimento pago-online
Atendimento pago online, adicionar um produto na conclusão. "R$X já pago online + R$Y a cobrar agora", pede pagamento só do adicional.
```
STATUS: OK
O que vi: pede pagamento apenas do adicional.
Gravidade:
```

### 4.5 — ★ Add-on em atendimento de CRÉDITO de pacote (lacuna que acharam)
Atendimento que consome crédito de pacote, adicionar um serviço avulso na conclusão. O avulso É cobrado (não de graça); o crédito cobre só o item original.
```
STATUS: ESTRANHO
O que vi: show, ele vai passar a pedir pra cobrar, mas, ele não mostra quanto o barbeiro tem que cobrar conforme funciona no item 4.4.
Gravidade: BLOQUEIA
```

### 4.6 — ★ Comissão rateada
Concluir atendimento de crédito de pacote. No extrato: valor base = rateado, não o preço avulso cheio.
```
STATUS: OK
O que vi: comissão com base no valor do valor rateado.
Gravidade:
```

### 4.7 — Comissão com exceção por serviço
Concluir uma barba feita pelo Pedro Martins (barba a 60%). Comissão sai a 60%, não a 35% padrão dele.
```
STATUS: NÃO TESTADO
O que vi: ainda não temos a comissão por serviço pelo que entendi.
Gravidade:
```

### 4.8 — Cancelar antecipado
Cancelar um atendimento antes do horário. Se for de crédito, libera o item sem falta.
```
STATUS: OK - COM ADENDO
O que vi: ok, ele libera o item sem falta, mas não informa o cliente que o ultimo item que ele agendou foi cancelado, isso provavelmente vai ser feito via whatsapp futuramente mas avisar na plataforma e mostrar pro cliente também é legal.
Gravidade: BLOQUEIA
```

### 4.9 — Projeção vs saldo
Tela de comissão: "saldo real" e "projeção futura" separados e nunca somados.
```
STATUS: OK
O que vi: saldos separados.
Gravidade:
```

---

# BLOCO 5 — Ciclo de vida do pacote (máquina de estado sutil)

### 5.1 — Falta simples
Cliente com crédito agenda, barbeiro marca NAO_COMPARECEU. Item → SEGUNDA_CHANCE, prazo de 10 dias aparece.
```
STATUS: BUG
O que vi: funciona, mas o prazo que ele da é de 11 dias restantes e não 10.
Gravidade: BLOQUEIA
```

### 5.2 — Reagendar na segunda chance
Item em segunda chance, reagendar dentro do prazo. Volta a AGENDADO, prazo preservado.
```
STATUS: OK
O que vi: reagenda normalmente consumindo o mesmo item do pacote, porém ele não volta a agendado, ele cria um novo registro de atendimento.
Gravidade:
```

### 5.3 — Segunda falta = expira
Faltar de novo no mesmo item. Item EXPIRA, valor vira saldo residual, soma do pacote continua batendo.
```
STATUS: BUG
O que vi: ele expira, porém se ele falta em 2 serviços e acumula creditos de 2 faltas, a mensagem fica assim: "R$ 68,00 de saldo — um serviço perdeu o prazo, mas o valor continua seu, guardado neste pacote." assumindo pro cliente que apenas UM serviço perdeu o prazo.
Gravidade: BLOQUEIA
```

### 5.4 — ★ Cancelar antecipado com falta já computada (loophole fechado)
Item com 1 falta (em segunda chance), reagendar, cancelar ANTES do horário. Volta pra SEGUNDA_CHANCE com prazo ORIGINAL — NÃO volta pra DISPONIVEL.
```
STATUS: OK
O que vi: volta pra segunda chance.
Gravidade:
```

### 5.5 — Produto avulso + comissão
Vender um produto avulso. Conferir comissão de produto no extrato com badge distinta.
```
STATUS: NÃO TESTADO
O que vi: 
Gravidade:
```

---

# BLOCO 6 — Multi-barbeiro (ensaio pra Sessão B)

### 6.1 — Disponibilidade por barbeiro
Agendar com Lucas Andrade (12h-20h) num horário que só ele cobre (ex: 19h). Disponível pro Lucas, indisponível pro Gabriel/Pedro.
```
STATUS: OK
O que vi: funciona.
Gravidade:
```

### 6.2 — Isolamento de agenda por barbeiro
Cada barbeiro só vê a própria agenda (via login de barbeiro puro, ou filtro admin).
```
STATUS: OK
O que vi: funciona.
Gravidade:
```

### 6.3 — Editar expediente reflete na disponibilidade
Mudar expediente de um barbeiro no admin. Disponibilidade reflete (dia aberto vira fechado). Dias com edição manual sobrevivem à rematerialização.
```
STATUS: OK
O que vi: funciona.
Gravidade:
```

---

# Anotações livres (bugs/ideias que não se encaixam em nenhum cenário)

```
- a plataforma ainda não está utilizando os assets da bigods, como logo e etc, em nenhum dos apps.
- 
-
```

---

# Resumo (preencher no fim)

| Gravidade | Quantos |
|---|---|
| BLOQUEIA | 12 |
| INCOMODA | 5 |
| COSMÉTICO | 2 |

**Sensação geral (1 linha):**
acho que existem alguns bugs críticos que ainda limita a operação. incluindo o item de anotações
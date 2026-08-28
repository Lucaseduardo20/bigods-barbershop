# Smoke manual — identidade do cliente com senha (2026-08-28)

Roteiro para conferir **na mão**, antes e depois do deploy, o que os testes automatizados
já cobrem. São 10 minutos. O que se está verificando o tempo todo é uma coisa só: **o
cliente consegue entrar sem depender do SMS**.

> Ambiente local: `npm run env:up` (API 3000, booking 5174, account 5175, admin 5173), com
> `DEMO_MODE=true` — o código aparece na própria tela, sem SMS.
>
> Em produção o código vai por SMS de verdade. Use um número seu.

---

## 0. Antes de começar

- [ ] Migration aplicada (`npm run db:migrate -w @bigods/api`). São duas colunas nuláveis e
      um tipo novo — **aditiva**, a API anterior continua funcionando com este banco.
- [ ] Painel abre e o card **Ajustes → Códigos enviados** aparece para o admin.

## 1. Fluxo 1 — confirmar agendamento (funil)

- [ ] No booking, agende um horário **presencial** com um número novo.
- [ ] O texto do código fala em **confirmar o agendamento** (não em "entrar na conta").
- [ ] Confirmado o código, a tela de sucesso mostra **"Ir para minha conta →"**.

## 2. Fluxo 2 — primeiro acesso, criar senha (SEM segundo código)

- [ ] Clique em "Ir para minha conta". A conta abre **já logada** — não pede código.
- [ ] Aparece a tela **"Crie sua senha"**, dizendo que o telefone já está confirmado.
      ★ Ela **não** menciona SMS: nenhum vai chegar.
- [ ] Tente uma senha curta (`1234`) → recusa explicando o mínimo.
- [ ] Tente o **próprio telefone** como senha → recusa dizendo que não pode.
- [ ] Salve uma senha válida (ex.: `barbearia-2026`). Cai na home da conta.

## 3. Fluxo 3 — login de todo dia, sem SMS

- [ ] Saia da conta ("Sair").
- [ ] Entre com **telefone + senha**. ★ Nenhum SMS é enviado — é o ponto da mudança.
- [ ] Erre a senha de propósito → "Telefone ou senha incorretos."
- [ ] Digite um telefone **que não existe** com qualquer senha → **a mesma** mensagem.
      ★ A tela não pode revelar quem é cliente da barbearia.

## 4. Fluxo 4 — esqueci a senha

- [ ] No login, "Esqueci minha senha / ainda não tenho".
- [ ] O texto explica que vai mandar um código **para confirmar o telefone**, e que depois
      escolhe uma senha nova.
- [ ] Receba o código, escolha outra senha, e note que entra direto (sem redigitar).
- [ ] Saia e confirme: a senha **nova** entra, a **antiga** não.

## 5. Cliente que já existia (não fica trancado)

- [ ] Pegue um cliente antigo (que nunca teve senha) — em local, dá para criar um pelo
      painel vendendo um pacote para um telefone novo.
- [ ] Tente entrar com senha → recusa (ele não tem senha).
- [ ] Use "Esqueci minha senha / ainda não tenho" → código → escolhe senha → entra.
      ★ É o caminho de primeiro acesso dele, e não exige senha anterior.

## 6. Trava do primeiro acesso (segurança)

- [ ] Entre com **telefone + senha** (sessão que NÃO provou posse do telefone).
- [ ] Na home, o convite "Crie sua senha" não deve aparecer (ele já tem senha). Se você
      tiver um cliente sem senha logado por senha — impossível na prática — o convite leva
      ao fluxo do código, não à criação direta.
- [ ] Conferência real da trava: no console do navegador, apague a sessão
      (`localStorage.clear()`), entre de novo pela ponte do funil e espere **mais de 30
      minutos** antes de criar a senha. A tela deve recusar pedindo para confirmar o
      telefone de novo.
      *(Se não quiser esperar: o e2e `senha-do-cliente.e2e.spec.ts` cobre os três casos —
      sessão vencida, sessão de login por senha e token antigo.)*

## 7. Auditoria — o que o dono vê quando o cliente diz "não recebi"

- [ ] Painel → **Ajustes → Códigos enviados**.
- [ ] Busque pelo telefone usado acima. Devem aparecer as linhas com **data/hora**,
      **finalidade** (confirmar agendamento / recuperar senha / acesso à conta) e o estado:
      `usado`, `não usado` ou `expirou sem uso`.
- [ ] Peça um código de recuperação e **não** use. A linha nova aparece como **"não usado"**
      — é exatamente o sintoma de SMS não entregue.
- [ ] ★ Confirme que **o código não aparece em lugar nenhum** da tela. Ele só existe como
      HMAC no banco e não é recuperável — nem por quem tem acesso ao servidor.
- [ ] Entre com um usuário **barbeiro comum**: o card não deve aparecer para ele.

---

## Se algo falhar em produção

O login por senha e o login por código **coexistem**: `POST /conta/login/iniciar` +
`confirmar` continuam funcionando. Se a senha der problema, o cliente ainda entra pelo
código — e o dono tem o card de auditoria para saber se o SMS saiu.

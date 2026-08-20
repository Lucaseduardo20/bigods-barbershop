# Cognito Custom Auth — OTP por SMS (SMS Gate)

Os 3 Lambda triggers que fazem o login sem senha por telefone. O cliente digita
o número no funil → a nossa API chama o Cognito → o Cognito chama estes Lambdas
→ o **CreateAuthChallenge** manda o SMS pelo [SMS Gate](https://sms-gate.app),
que entrega pelo celular Android pareado da barbearia.

```
funil → API (IDENTITY_PROVIDER=cognito) → Cognito InitiateAuth(CUSTOM_AUTH)
                                              ├─ DefineAuthChallenge      (orquestra)
                                              ├─ CreateAuthChallenge      (gera código + envia SMS)
                                              └─ VerifyAuthChallengeResponse (confere)
```

**★ O código do OTP é do Cognito.** Com `IDENTITY_PROVIDER=cognito`, a nossa base
não guarda desafio nenhum (`DemoDesafioLogin` fica sem uso nesse fluxo). Quem
gera, guarda e confere o código é o Cognito, via estes triggers. Isso é
deliberado: dois sistemas de código competindo seria a receita para "o código
que chegou não é o que o servidor espera".

## Arquivos

| Arquivo | Trigger do Cognito | Precisa de env var? |
|---|---|---|
| `define-auth-challenge.js` | Define auth challenge | não |
| `create-auth-challenge.js` | Create auth challenge | **sim** (SMS Gate) |
| `verify-auth-challenge-response.js` | Verify auth challenge response | não |
| `sms-gate.js` | — (usado pelo Create) | — |

**Zero dependências npm.** Usam só `node:crypto` e o `fetch` global do Node 20.
Não precisa `npm install`, não precisa empacotar `node_modules` — dá para colar
o código direto no editor do console da AWS.

---

## Passo a passo do deploy

Pré-requisito: User Pool e App Client já criados (você já tem).

### 1. Criar as 3 funções Lambda

Para cada uma das três, no console **Lambda → Create function**:

- **Author from scratch**
- **Runtime:** Node.js 20.x (ou mais novo — o `fetch` global exige ≥ 18)
- **Architecture:** x86_64 (tanto faz)
- Nomes sugeridos:
  - `bigods-cognito-define-auth`
  - `bigods-cognito-create-auth`
  - `bigods-cognito-verify-auth`

Depois de criar, em **Code source**, cole o conteúdo do arquivo correspondente
em `index.js`. Dois detalhes que fazem o login inteiro falhar se passarem batidos:

> ### ★ APAGUE o `index.mjs` que o console criou
>
> O template "Author from scratch" já vem com um `index.mjs` que devolve
> `{"statusCode": 200, "body": "Hello from Lambda!"}`. Nosso código é CommonJS
> (`require`/`exports`), então vai num `index.js` — e com os DOIS arquivos
> presentes o runtime Node resolve o **`.mjs` primeiro**. A Lambda responde 200
> com o hello-world, o Cognito não entende o payload, e o erro que chega na API é
> `InvalidLambdaResponseException: Unrecognizable lambda output` — que não diz
> nada sobre arquivo nenhum. Aconteceu em produção em 2026-08-20.
>
> ### ★ Clique em **Deploy** depois de colar
>
> No editor do console, salvar não publica: sem o Deploy a função continua
> servindo o código anterior, com o mesmo sintoma acima.
>
> Como conferir que deu certo, sem gastar SMS: aba **Test** da Lambda do
> *define*, com este evento —
>
> ```json
> {
>   "version": "1",
>   "triggerSource": "DefineAuthChallenge_Authentication",
>   "userPoolId": "SEU_POOL_ID",
>   "userName": "teste",
>   "request": { "userAttributes": { "phone_number": "+5511999998888" }, "session": [] },
>   "response": {}
> }
> ```
>
> O retorno tem que trazer `response.challengeName: "CUSTOM_CHALLENGE"`,
> `issueTokens: false` e `failAuthentication: false`. Não rode este teste na
> `create-auth` com telefone real: ela envia SMS de verdade e gasta franquia.

Em **Runtime settings → Handler**, ajuste para:

| Função | Handler |
|---|---|
| `bigods-cognito-define-auth` | `index.handler` |
| `bigods-cognito-create-auth` | `index.handler` |
| `bigods-cognito-verify-auth` | `index.handler` |

> **A `create-auth` tem DOIS arquivos.** No editor do console, crie também um
> arquivo `sms-gate.js` ao lado do `index.js` e cole o conteúdo de
> `infra/cognito-triggers/sms-gate.js`. Depois troque, no topo do `index.js`, o
> `require('./sms-gate')` — já está assim, não precisa mexer. Clique **Deploy**.

Alternativa (mais fácil de repetir, e **imune às duas armadilhas acima** — o
zip substitui o conteúdo inteiro da função, então não sobra `index.mjs` nem
existe "esqueci o Deploy"): zipar e subir.

```bash
cd infra/cognito-triggers

zip define.zip define-auth-challenge.js
zip verify.zip verify-auth-challenge-response.js
zip create.zip create-auth-challenge.js sms-gate.js
```

Subindo por zip, o **Handler** de cada uma é o nome do arquivo sem `.js` +
`.handler`:

| Função | Handler (via zip) |
|---|---|
| define | `define-auth-challenge.handler` |
| create | `create-auth-challenge.handler` |
| verify | `verify-auth-challenge-response.handler` |

### 2. Env vars da `create-auth`

Só ela precisa. Em **Configuration → Environment variables**:

| Chave | Valor | Obrigatória |
|---|---|---|
| `SMS_GATE_USER` | usuário do SMS Gate Cloud | sim |
| `SMS_GATE_PASSWORD` | senha do SMS Gate Cloud | sim |
| `SMS_GATE_ENDPOINT` | outro endpoint (instância própria) | não |
| `SMS_GATE_TIMEOUT_MS` | timeout do envio (padrão `8000`) | não |

> As credenciais do SMS Gate ficam **só aqui**, na Lambda. A nossa API nunca
> fala com o SMS Gate — não coloque essas variáveis no servidor da API.

### 3. Timeout da `create-auth`

**Configuration → General configuration → Timeout:** suba para **15 segundos**
(o padrão de 3s é apertado para uma chamada HTTP externa; o cliente do SMS Gate
já aborta sozinho em 8s).

### 4. Permitir que o Cognito invoque as Lambdas

O console costuma criar a permissão sozinho quando você liga o trigger (passo
5). Se não criar, rode para cada função:

```bash
aws lambda add-permission \
  --function-name bigods-cognito-create-auth \
  --statement-id cognito-invoke \
  --action lambda:InvokeFunction \
  --principal cognito-idp.amazonaws.com \
  --source-arn arn:aws:cognito-idp:<REGIAO>:<CONTA>:userpool/<USER_POOL_ID>
```

### 5. Ligar os triggers no User Pool

Console → **Cognito → User pools → (seu pool) → Extensions → Add Lambda trigger**.

⚠️ Em **Trigger type**, escolha o card **Custom authentication** — NÃO
"Authentication". São categorias diferentes: "Authentication" traz Pre/Post
authentication e Pre token generation, que não têm nada a ver com o nosso
fluxo. Só ao marcar *Custom authentication* é que aparecem as três opções
certas.

Repita o **Add Lambda trigger** três vezes (o console atribui uma função por
tipo de trigger), sempre com *Trigger type = Custom authentication*:

| Opção (dentro de Custom authentication) | Função |
|---|---|
| Define auth challenge | `bigods-cognito-define-auth` |
| Create auth challenge | `bigods-cognito-create-auth` |
| Verify auth challenge response | `bigods-cognito-verify-auth` |

No fim, a tela de Extensions deve listar os três. Faltando qualquer um, o login
quebra de um jeito específico: sem o **Define** o Cognito não sabe o que
perguntar; sem o **Create** não sai SMS; sem o **Verify** nenhum código é aceito.

### 6. Habilitar CUSTOM_AUTH no App Client

Console → **App integration → (seu app client) → Edit → Authentication flows**:
marque **ALLOW_CUSTOM_AUTH**. Marque também **ALLOW_REFRESH_TOKEN_AUTH** (padrão).

> Se o App Client tiver **client secret**, o `InitiateAuth` exige `SECRET_HASH` —
> o nosso adapter **não** envia. Use um App Client **sem** secret (é o normal
> para app público).

### 7. Permissão da API (IAM)

A API chama `AdminCreateUser` e `AdminSetUserPassword` para provisionar o
usuário antes do primeiro login. A role da EC2 (ou a credencial em
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) precisa de:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["cognito-idp:AdminCreateUser", "cognito-idp:AdminSetUserPassword"],
    "Resource": "arn:aws:cognito-idp:<REGIAO>:<CONTA>:userpool/<USER_POOL_ID>"
  }]
}
```

`InitiateAuth` e `RespondToAuthChallenge` são APIs de cliente (não-autenticadas),
não precisam de IAM.

**Conferir se a credencial chega na API.** A imagem da API traz o *SDK* da AWS,
não o CLI — `aws sts get-caller-identity` dentro do container responde
`aws: not found`, e isso não diz nada sobre credencial. Use o Node, que está lá:

```bash
docker compose exec api node -e "
require('@aws-sdk/credential-provider-node').defaultProvider()()
  .then(c => console.log('CREDENCIAL OK — key:', String(c.accessKeyId).slice(0,6) + '…'))
  .catch(e => console.log('SEM CREDENCIAL —', e.message))
"
```

> É `defaultProvider` mesmo — `fromNodeProviderChain` existe, mas no pacote
> `@aws-sdk/credential-providers` (plural), que não é dependência daqui.

E no HOST (fora do container), para saber se a instância tem role anexada:

```bash
TOKEN=$(curl -sX PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/
```

| Host | Container | Diagnóstico |
|---|---|---|
| vazio | — | role não anexada à instância |
| nome da role | OK | tudo certo |
| nome da role | SEM CREDENCIAL | **hop limit do IMDSv2**: o container não alcança o metadata |

O terceiro caso é o que mais engana (a role está lá, mas o SDK não a enxerga
de dentro do Docker). Correção, do CloudShell:

```bash
aws ec2 modify-instance-metadata-options --region us-east-1 \
  --instance-id <ID> --http-put-response-hop-limit 2 --http-tokens required
```

### 8. Variáveis da API

No `.env` do servidor:

```
IDENTITY_PROVIDER=cognito
COGNITO_USER_POOL_ID=...
COGNITO_CLIENT_ID=...
AWS_REGION=...
```

Suba a API. O log de boot deve mostrar:
`IdentityProvider: Cognito (SMS via SMS Gate) — pool <id>`

---

## Testar

```bash
curl -X POST https://<API>/conta/login/iniciar \
  -H 'Content-Type: application/json' \
  -d '{"companyId":"bigods","telefone":"11999998888"}'
```

Resposta esperada: `{"desafio":"<Session longa>","expiraEm":"...","codigoDemo":null}`
— e o **SMS chega no celular**. Depois:

```bash
curl -X POST https://<API>/conta/login/confirmar \
  -H 'Content-Type: application/json' \
  -d '{"companyId":"bigods","telefone":"11999998888","codigo":"<do SMS>","desafio":"<Session>"}'
```

## Quando o SMS não chega

O `POST /messages` retornar 2xx significa que o **cloud aceitou e enfileirou** —
não que o SMS saiu. Se o celular estiver offline, sem chip ou sem sinal, a
mensagem fica pendente e ninguém recebe nada, sem erro nenhum do nosso lado.

Onde olhar, em ordem:

1. **CloudWatch Logs da `create-auth`** — se o envio falhou de verdade
   (credencial errada, timeout, 5xx), o erro aparece aqui e o login foi
   recusado com erro. Se não há erro, o cloud aceitou.
2. **App do SMS Gate no celular** — precisa estar rodando, com internet e com o
   chip ativo. É a causa mais comum.
3. **Painel do SMS Gate Cloud** — mostra as mensagens e em que estado pararam.

> Não implementei health check automático do device: não consegui confirmar na
> documentação oficial o caminho exato do endpoint de health, e chutar uma rota
> seria pior que não ter (um health check que aponta para o lugar errado mente
> nas duas direções). Está registrado em DECISOES_PENDENTES.

## Custo e abuso

Cada OTP é um SMS pago pelo chip. As travas que já existem na API:

- **por telefone** — poucas tentativas por minuto no mesmo número;
- **por origem/IP** — teto por hora somando todos os telefones
  (`OTP_LIMITE_POR_ORIGEM_HORA`), que é o que impede alguém varrer números e
  queimar a franquia do chip.

Errar o código **não** dispara SMS novo: o `create-auth` reaproveita o mesmo
código entre as tentativas do mesmo desafio.

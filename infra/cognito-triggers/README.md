# Cognito — Lambda triggers do login por OTP (Custom Auth Challenge)

Estes três Lambda triggers implementam o login **sem senha por telefone** do User
Pool, no fluxo **CUSTOM_AUTH**. Quem chama `InitiateAuth`/`RespondToAuthChallenge`
pode ser o backend (`CognitoIdentityProvider`) **ou o próprio navegador via
Amplify** (é assim no experimento "Amplify no funil"); a geração/envio/
verificação do código acontece aqui, dentro da AWS, nos dois casos.

> **Este código já está pronto — o backend não precisa de mudança para usá-lo.**
> Falta só publicar na conta AWS e apontar o User Pool para os três Lambdas.
> Quem tem acesso à conta faz isso (o agente que gerou não tem, e não publicou nada).

## Arquivos

| Arquivo | Trigger do User Pool | O que faz |
|---|---|---|
| `define-auth-challenge.js` | Define auth challenge | Orquestra: emite desafio, conclui no acerto, falha após 3 tentativas |
| `create-auth-challenge.js` | Create auth challenge | Gera código de 6 dígitos, **envia por WhatsApp** (SMS/SNS como fallback), guarda o esperado |
| `verify-auth-challenge-response.js` | Verify auth challenge response | Compara o código digitado com o esperado (tempo constante) |

Runtime: **Node.js 20.x**. Sem passo de build.

## Canal de envio: WhatsApp (padrão) ou SMS

A barbearia já opera o OTP por WhatsApp (`services/whatsapp-otp/`, Baileys) e a
decisão foi **manter esse canal** ao adotar o Cognito: o que muda é quem
orquestra o desafio, não por onde o código chega. O `create-auth-challenge`
chama o mesmo endpoint que o backend usa (`POST {baseUrl}/enviar`, header
`X-Internal-Token`), com a mesma mensagem.

Variáveis de ambiente da Lambda `create-auth-challenge`:

| Variável | Efeito |
|---|---|
| `WHATSAPP_OTP_SERVICE_URL` | URL do serviço de WhatsApp. **Precisa ser alcançável pela Lambda** (endereço público com TLS, ou a Lambda numa VPC com rota até o serviço) |
| `WHATSAPP_OTP_INTERNAL_TOKEN` | Mesmo valor do serviço e do backend |
| `WHATSAPP_OTP_TIMEOUT_MS` | Timeout da chamada. Default `8000` |
| `OTP_TTL_MINUTOS` | Só aparece no texto da mensagem. Default `5` |

Se as duas primeiras estiverem ausentes, a Lambda cai no **SMS via SNS** — o
caminho antigo continua funcional e não foi removido.

## Pré-requisitos no User Pool

1. Atributo `phone_number` **obrigatório** e marcável como verificado.
2. App Client **sem** client secret, com o Auth Flow **`ALLOW_CUSTOM_AUTH`** ligado.
3. Canal de envio configurado:
   - **WhatsApp** (recomendado, é o que já roda): as variáveis acima na Lambda.
   - **SMS**: envio habilitado (SNS), fora do sandbox, e `sns:Publish` na role
     de execução do `create-auth-challenge`.

## Passo a passo (console ou CLI)

```bash
# 1. Empacotar cada handler (um zip por função)
cd infra/cognito-triggers
for f in define-auth-challenge create-auth-challenge verify-auth-challenge-response; do
  zip "$f.zip" "$f.js"
done

# 2. Criar as 3 funções (ajuste --role para uma role com AWSLambdaBasicExecutionRole;
#    a de create-auth-challenge precisa também de sns:Publish)
aws lambda create-function --function-name bigods-define-auth \
  --runtime nodejs20.x --handler define-auth-challenge.handler \
  --zip-file fileb://define-auth-challenge.zip --role <ROLE_ARN>

aws lambda create-function --function-name bigods-create-auth \
  --runtime nodejs20.x --handler create-auth-challenge.handler \
  --zip-file fileb://create-auth-challenge.zip --role <ROLE_ARN_COM_SNS>

aws lambda create-function --function-name bigods-verify-auth \
  --runtime nodejs20.x --handler verify-auth-challenge-response.handler \
  --zip-file fileb://verify-auth-challenge-response.zip --role <ROLE_ARN>

# 3. Dar permissão para o Cognito invocar cada Lambda
for fn in bigods-define-auth bigods-create-auth bigods-verify-auth; do
  aws lambda add-permission --function-name "$fn" \
    --statement-id cognito-invoke --action lambda:InvokeFunction \
    --principal cognito-idp.amazonaws.com \
    --source-arn arn:aws:cognito-idp:<REGIAO>:<CONTA>:userpool/<USER_POOL_ID>
done

# 4. Apontar os triggers do User Pool para as Lambdas
aws cognito-idp update-user-pool --user-pool-id <USER_POOL_ID> \
  --lambda-config \
    DefineAuthChallenge=<ARN_bigods-define-auth>,\
CreateAuthChallenge=<ARN_bigods-create-auth>,\
VerifyAuthChallengeResponse=<ARN_bigods-verify-auth>
```

Configure também as variáveis do canal de WhatsApp na Lambda `bigods-create-auth`:

```bash
aws lambda update-function-configuration --function-name bigods-create-auth \
  --environment "Variables={WHATSAPP_OTP_SERVICE_URL=https://<host>,\
WHATSAPP_OTP_INTERNAL_TOKEN=<mesmo token do backend>,OTP_TTL_MINUTOS=5}"
```

## Depois de publicar

O experimento **"Amplify no funil"** (o navegador fala direto com o Cognito) é o
uso ligado hoje. Preencher no `.env` do backend (ver `.env.example`):

```
COGNITO_REGION=<regiao>
COGNITO_USER_POOL_ID=<user pool id>
COGNITO_CLIENT_ID=<app client id sem secret>
```

…e no build dos frontends (ver `.env.frontends.example`):

```
VITE_AUTH_ADAPTER=cognito
VITE_COGNITO_USER_POOL_ID=<user pool id>
VITE_COGNITO_CLIENT_ID=<mesmo app client id>
```

Role do backend precisa de `cognito-idp:AdminCreateUser` e
`AdminSetUserPassword` (escopadas ao User Pool) — é como os telefones entram no
pool, já que o navegador não pode criar usuário.

`IDENTITY_PROVIDER` **não muda**: continua `whatsapp` (ou `demo` em dev). Os dois
caminhos de login convivem — o do Cognito é ligado pelo front, e desligá-lo é
voltar `VITE_AUTH_ADAPTER` para `api`.

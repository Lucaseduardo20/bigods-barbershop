# Cognito — Lambda triggers do login por OTP (Custom Auth Challenge)

Estes três Lambda triggers implementam o login **sem senha por telefone** (SMS OTP)
do User Pool, no fluxo **CUSTOM_AUTH**. O backend (`CognitoIdentityProvider`) só
chama `InitiateAuth`/`RespondToAuthChallenge`; a geração/envio/verificação do
código acontece aqui, dentro da AWS.

> **Este código já está pronto — o backend não precisa de mudança para usá-lo.**
> Falta só publicar na conta AWS e apontar o User Pool para os três Lambdas.
> Quem tem acesso à conta faz isso (o agente que gerou não tem, e não publicou nada).

## Arquivos

| Arquivo | Trigger do User Pool | O que faz |
|---|---|---|
| `define-auth-challenge.js` | Define auth challenge | Orquestra: emite desafio, conclui no acerto, falha após 3 tentativas |
| `create-auth-challenge.js` | Create auth challenge | Gera código de 6 dígitos, envia SMS via SNS, guarda o esperado |
| `verify-auth-challenge-response.js` | Verify auth challenge response | Compara o código digitado com o esperado (tempo constante) |

Runtime: **Node.js 20.x**. Sem passo de build. `create-auth-challenge` usa
`@aws-sdk/client-sns` (já incluso no runtime Node 20 da AWS Lambda).

## Pré-requisitos no User Pool

1. Atributo `phone_number` **obrigatório** e marcável como verificado.
2. Envio de SMS habilitado (SNS) — sair do sandbox de SMS para números reais.
3. App Client **sem** client secret, com o Auth Flow **`ALLOW_CUSTOM_AUTH`** ligado.
4. Role de execução das Lambdas com permissão `sns:Publish` (para o create).

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

## Depois de publicar

Preencher no `.env` do backend (ver `.env.example`):

```
IDENTITY_PROVIDER=cognito
COGNITO_REGION=<regiao>
COGNITO_USER_POOL_ID=<user pool id>
COGNITO_CLIENT_ID=<app client id sem secret>
# DEMO_MODE ausente/false
```

E dar à role do backend: `cognito-idp:AdminCreateUser`, `AdminSetUserPassword`,
`InitiateAuth`, `RespondToAuthChallenge` (escopadas ao User Pool).

Pronto: a troca demo → Cognito é só variável de ambiente, o código da aplicação
não muda.

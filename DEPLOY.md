# Deploy — Bigod's Barber

Um comando só, pros três ambientes — mas **`staging` e `production` não são
mais a mesma topologia** (ver aviso abaixo):

```bash
scripts/deploy.sh local        # dev: hot-reload, sem Docker (= npm run env:up)
scripts/deploy.sh staging      # rehearsal completo autocontido nesta máquina, sem AWS
scripts/deploy.sh production   # topologia REAL da AWS (EC2 + RDS + S3/CloudFront)
```

> ⚠️ **`staging` ≠ mini-`production` aqui.** `staging` é um rehearsal
> **autocontido** — Postgres e os 3 frontends rodam em container, junto com a
> API e o `whatsapp-otp`, tudo numa máquina só, sem precisar de nenhum recurso
> AWS. `production` é a topologia real que decidimos em `INFRA_AWS.md`: banco
> é **RDS** (fora do Docker), frontends são **S3+CloudFront** (fora do
> Docker) — só API + `whatsapp-otp` + Caddy rodam em container, na EC2. Pra
> criar a infra da AWS do zero, siga **[`AWS_SETUP.md`](./AWS_SETUP.md)**
> primeiro — este documento aqui assume que ela já existe.

`staging`/`production` rodam **na própria máquina onde você executa o
comando** — não é deploy remoto. Dê SSH na VM, `git pull`, rode o script ali.

## Local (dev)

```bash
scripts/deploy.sh local          # sobe API + Admin + Booking + Account com hot-reload
scripts/deploy.sh local down     # derruba tudo
```

Isso é só um atalho pro fluxo que já existia (`npm run env:up`/`npm run env:down`,
`scripts/env-up.sh`) — nada mudou aqui. Sem Docker pra API/frontends (só o Postgres
roda em container); `IDENTITY_PROVIDER=demo` por padrão (código OTP na resposta,
sem WhatsApp real).

## Staging (rehearsal autocontido, sem AWS)

```bash
git clone <repo> && cd bigods-barber-v2
scripts/deploy.sh staging
```

Na primeira execução, o script:
1. Não acha `.env` → copia de `.env.docker.example` → **para** e pede pra você
   preencher `AUTH_SECRET` e `WHATSAPP_OTP_INTERNAL_TOKEN` (gere cada um com
   `openssl rand -hex 32`). Nada é buildado/subido ainda nesse ponto.
2. Depois de preencher e rodar de novo: builda as 5 imagens (API, whatsapp-otp,
   admin, booking, account), sobe tudo com `restart: unless-stopped`, aplica as
   migrations do Prisma, espera cada serviço responder, e imprime um resumo com
   as URLs (`localhost:3000/5173/5174/5175/3100`).

`staging` aceita `--seed` (semeia dados demo) — útil pra um rehearsal completo
antes de ir pra produção de verdade.

## Produção (AWS — EC2 + RDS + S3/CloudFront)

**Pré-requisito: a infra já existe** (EC2 rodando, RDS criado, SSM com os
segredos, buckets S3 + distribuições CloudFront) — ver
**[`AWS_SETUP.md`](./AWS_SETUP.md)** pra criar tudo isso do zero, uma vez.

Na EC2, depois da infra pronta:

```bash
cp .env.aws.example .env         # preenche API_DOMAIN/ACME_EMAIL (não-secretos)
scripts/fetch-secrets-ssm.sh     # busca AUTH_SECRET/DATABASE_URL/etc do SSM Parameter Store
scripts/deploy.sh production     # builda e sobe API + whatsapp-otp + Caddy
```

Se o serviço de WhatsApp ainda não tiver sido conectado (primeira vez), o
script avisa no final — aí:

```bash
scripts/deploy.sh production logs whatsapp-otp
```

e escaneie o QR que aparece nos logs com o **número descartável** da barbearia
(nunca o oficial — ver `services/whatsapp-otp/README.md`). Depois de escaneado
uma vez, a sessão persiste num volume Docker (`whatsapp_session`) e sobrevive a
reinícios/redeploys sem pedir QR de novo.

### No dia a dia (redeploy)

```bash
scripts/deploy.sh production --pull            # git pull + rebuild + up
scripts/deploy.sh production --no-build        # só reinicia com as imagens que já existem (rápido)
scripts/deploy.sh production status            # docker compose ps
scripts/deploy.sh production logs [serviço]     # acompanhar logs (api, whatsapp-otp, caddy)
scripts/deploy.sh production down              # derruba os containers (mantém volumes/dados)
scripts/deploy.sh production migrate           # só roda migrations pendentes, sem mexer em mais nada
```

`--seed` é **bloqueado em `production`** de propósito — nunca apaga/recria
dados reais.

### Frontends (admin/booking/account) — deploy SEPARADO, não roda na EC2

```bash
cp .env.frontends.example .env.frontends   # preenche os buckets/distribuições, uma vez
scripts/deploy-frontends.sh                # builda os 3 e publica em S3 + invalida o CloudFront
scripts/deploy-frontends.sh admin          # só um deles, se preferir
```

Roda do seu computador (ou de um runner de CI) — exige AWS CLI configurado
com permissão de escrita nos buckets/CloudFront. Ver `AWS_SETUP.md` §6 pra
criar os buckets/distribuições a primeira vez.

## O que sobe onde

| Serviço | Onde roda em produção | O que é |
|---|---|---|
| `postgres` (banco) | **RDS** (fora do Docker) | Gerenciado pela AWS — backup automático, patch automático. |
| `api` | EC2, container | NestJS — `apps/api/Dockerfile`. Não publica porta pro host — só o Caddy fala com ele. |
| `whatsapp-otp` | EC2, container | Sessão do WhatsApp (Baileys — sem Chrome) — `services/whatsapp-otp/Dockerfile`. Nunca exposto publicamente. |
| `caddy` | EC2, container | Proxy reverso + TLS automático (Let's Encrypt) — único ponto public na porta 80/443. |
| `admin`/`booking`/`account` | **S3 + CloudFront** (fora do Docker) | Build estático do Vite, publicado direto — sem servidor rodando. |

Em `staging` (rehearsal local, `docker-compose.staging.yml`), os 3 frontends
E o Postgres também rodam em container na mesma máquina — só ali. Em
`production` (AWS de verdade), não.

**Frontends chamam a API por URL absoluta em produção** (`VITE_API_URL`,
embutida pelo Vite **no momento do build** — mudar exige rodar
`scripts/deploy-frontends.sh` de novo) porque frontend e API vivem em domínios
diferentes (`admin.seudominio.com` vs `api.seudominio.com`) — CORS já está
liberado em `apps/api/src/main.ts`. Em dev/staging, sem essa variável, cai no
comportamento antigo (`/api` relativo, resolvido pelo proxy do Vite ou pelo
`docker/static-server`).

## `.env` — três arquivos-molde diferentes, propositalmente

- **`.env.example`** → pra `local` (sem Docker). `DATABASE_URL` usa `localhost`.
- **`.env.docker.example`** → pra `staging` (rehearsal autocontido).
  `DATABASE_URL`/`WHATSAPP_OTP_SERVICE_URL` usam os NOMES DOS SERVIÇOS
  (`postgres`, `whatsapp-otp`) — dentro de um container, "localhost" é o
  próprio container, nunca outro serviço nem a máquina host.
- **`.env.aws.example`** → pra `production` (EC2 real). Segredos ficam em
  branco de propósito — `scripts/fetch-secrets-ssm.sh` os busca do SSM
  Parameter Store, nunca em texto puro no repo nem na AMI.
- **`.env.frontends.example`** → pra `scripts/deploy-frontends.sh` (roda no
  seu computador/CI, não na EC2).

## Pré-requisitos na máquina de staging/produção

- Docker + Docker Compose (`docker compose` v2 ou `docker-compose` v1 — o
  script detecta sozinho qual está instalado).
- Em produção (EC2): AWS CLI configurado (via IAM Role da instância — ver
  `AWS_SETUP.md`) pra `scripts/fetch-secrets-ssm.sh` funcionar.

## Troubleshooting

**"Porta X já está em uso por um processo que NÃO é container deste stack"**
Alguma coisa fora do Docker (ex.: `npm run dev` local, ou outro servidor web
na 80/443) está segurando a porta. O script se recusa a derrubar processos
que não conhece — pare-o você mesmo e rode de novo.

**whatsapp-otp reiniciando em loop / nunca fica `conectado: true`**
A sessão do WhatsApp é instável por natureza (ver
`services/whatsapp-otp/README.md`, seção Troubleshooting). Cheque
`scripts/deploy.sh <ambiente> logs whatsapp-otp` — se aparecer "Sessão
DESLOGADA", apague o volume/pasta de sessão e reinicie pra escanear o QR de
novo. Qualquer outro motivo de queda reconecta sozinho (Baileys não depende de
Chrome nem de rede especial — se travar sem log nenhum, confirme que o
container tem saída de rede normal).

**"DATABASE_URL não aponta pro serviço postgres..." (staging)**
Você provavelmente copiou o `.env` de outro ambiente. Use
`.env.docker.example` como base pra `staging`.

**"DATABASE_URL aponta pro serviço postgres, mas produção não tem esse serviço" (production)**
Confirma que rodou `scripts/fetch-secrets-ssm.sh` (que sobrescreve
`DATABASE_URL` com o endpoint real do RDS) e não copiou o `.env` de um
`staging` por engano.

**Certificado TLS do Caddy não emite**
O domínio em `API_DOMAIN` precisa estar apontado (registro A/AAAA no DNS) pro
IP público da EC2 **antes** de subir o Caddy — a Let's Encrypt valida isso.
Confirma com `dig +short api.seudominio.com` batendo com o IP da instância.

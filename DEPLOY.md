# Deploy — Bigod's Barber

Um comando só, pros três ambientes:

```bash
scripts/deploy.sh local        # dev: hot-reload, sem Docker (= npm run env:up)
scripts/deploy.sh staging      # Docker Compose nesta máquina
scripts/deploy.sh production   # Docker Compose nesta máquina, mais travado
```

`staging`/`production` rodam **na própria máquina onde você executa o comando** —
não é deploy remoto. Dê SSH na VM, `git pull`, rode o script ali.

## Local (dev)

```bash
scripts/deploy.sh local          # sobe API + Admin + Booking + Account com hot-reload
scripts/deploy.sh local down     # derruba tudo
```

Isso é só um atalho pro fluxo que já existia (`npm run env:up`/`npm run env:down`,
`scripts/env-up.sh`) — nada mudou aqui. Sem Docker pra API/frontends (só o Postgres
roda em container); `IDENTITY_PROVIDER=demo` por padrão (código OTP na resposta,
sem WhatsApp real).

## Staging / Produção (Docker)

### Primeira vez numa máquina nova

```bash
git clone <repo> && cd bigods-barber-v2
scripts/deploy.sh staging        # (ou production)
```

Na primeira execução, o script:
1. Não acha `.env` → copia de `.env.docker.example` → **para** e pede pra você
   preencher `AUTH_SECRET` e `WHATSAPP_OTP_INTERNAL_TOKEN` (gere cada um com
   `openssl rand -hex 32`). Nada é buildado/subido ainda nesse ponto.
2. Depois de preencher e rodar de novo: builda as 5 imagens (API, whatsapp-otp,
   admin, booking, account), sobe tudo com `restart: unless-stopped`, aplica as
   migrations do Prisma, espera cada serviço responder, e imprime um resumo com
   as URLs.

Se o serviço de WhatsApp ainda não tiver sido conectado (primeira vez), o script
avisa no final — aí:

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
scripts/deploy.sh production logs [serviço]     # acompanhar logs (todos, ou um: api, whatsapp-otp, admin, booking, account, postgres)
scripts/deploy.sh production down              # derruba os containers (mantém volumes/dados)
scripts/deploy.sh production migrate           # só roda migrations pendentes, sem mexer em mais nada
```

`staging` aceita `--seed` (semeia dados demo); **`production` bloqueia `--seed`
de propósito** — nunca apaga/recria dados reais.

## O que sobe

| Serviço | Porta | O que é |
|---|---|---|
| `postgres` | 5432 | Banco (mesmo container/volume usado no dev local) |
| `api` | 3000 | NestJS — `apps/api/Dockerfile` |
| `whatsapp-otp` | 3100 | Sessão do WhatsApp (Baileys — sem Chrome) — `services/whatsapp-otp/Dockerfile` |
| `admin` | 5173 | Painel — build estático do Vite + proxy `/api` |
| `booking` | 5174 | Funil público — idem |
| `account` | 5175 | Cockpit do cliente — idem |

Admin/booking/account são servidos por um servidor Node mínimo
(`docker/static-server/`) que serve os arquivos do `vite build` e faz proxy de
`/api/*` pra API — os 3 frontends só chamam a API por caminho relativo
(`apps/*/src/lib/api.ts`, `const BASE = '/api'`), então algo precisa fazer esse
proxy em produção (não tem mais o dev-server do Vite fazendo isso). Todos os 3
sobem via `restart: unless-stopped`.

**`VITE_COMPANY_ID`/`VITE_BOOKING_URL`** são embutidas pelo Vite **no momento do
build da imagem**, não em runtime — mudar essas variáveis no `.env` exige
rebuildar (`scripts/deploy.sh production` sem `--no-build`, que é o default).

## `.env` — dois arquivos-molde diferentes, propositalmente

- **`.env.example`** → pra `local` (sem Docker). `DATABASE_URL` usa `localhost`.
- **`.env.docker.example`** → pra `staging`/`production` (Docker Compose).
  `DATABASE_URL`/`WHATSAPP_OTP_SERVICE_URL` usam os NOMES DOS SERVIÇOS
  (`postgres`, `whatsapp-otp`), nunca `localhost` — dentro de um container,
  "localhost" é o próprio container, nunca outro serviço nem a máquina host.

`scripts/deploy.sh staging`/`production` sempre usa `.env.docker.example` como
molde na primeira vez; nunca mistura com o `.env` usado pelo `local` (são
máquinas diferentes na prática, já que `local` roda na sua própria máquina de
dev e staging/produção rodam em VMs separadas).

## Pré-requisitos na máquina de staging/produção

- Docker + Docker Compose (`docker compose` v2 ou `docker-compose` v1 — o
  script detecta sozinho qual está instalado).
- Nada mais — sem AWS, sem nginx, sem Node instalado fora dos containers.

## Troubleshooting

**"Porta X já está em uso por um processo que NÃO é container deste stack"**
Alguma coisa fora do Docker (ex.: `npm run dev` local) está segurando a porta.
O script se recusa a derrubar processos que não conhece — pare-o você mesmo e
rode de novo.

**whatsapp-otp reiniciando em loop / nunca fica `conectado: true`**
A sessão do WhatsApp é instável por natureza (ver
`services/whatsapp-otp/README.md`, seção Troubleshooting). Cheque
`scripts/deploy.sh <ambiente> logs whatsapp-otp` — se aparecer "Sessão
DESLOGADA", apague o volume/pasta de sessão e reinicie pra escanear o QR de
novo. Qualquer outro motivo de queda reconecta sozinho (Baileys não depende de
Chrome nem de rede especial — se travar sem log nenhum, confirme que o
container tem saída de rede normal).

**"DATABASE_URL não aponta pro serviço postgres..."**
Você provavelmente copiou o `.env` de um ambiente `local` (com `localhost`)
pra uma máquina de staging/produção. Use `.env.docker.example` como base ali,
não o `.env` do seu laptop.

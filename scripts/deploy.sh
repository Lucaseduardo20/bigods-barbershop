#!/usr/bin/env bash
# Ponto de entrada único pra subir o ambiente inteiro — local, staging ou
# produção. Local usa o fluxo de dev já existente (scripts/env-up.sh, sem
# Docker, hot-reload). Staging/produção usam Docker Compose (a mesma máquina
# que roda o script é a que fica no ar — sem deploy remoto).
#
# Uso:
#   scripts/deploy.sh local  [up|down]
#   scripts/deploy.sh staging|production  [up|down|status|logs [serviço]|migrate]  [--no-build] [--seed] [--pull]
#
# Exemplos:
#   scripts/deploy.sh local                     # sobe tudo pra desenvolver (= npm run env:up)
#   scripts/deploy.sh production                # builda e sobe API + whatsapp-otp + 3 frontends + Postgres
#   scripts/deploy.sh production --pull          # git pull antes de tudo
#   scripts/deploy.sh production --no-build      # reaproveita as imagens já buildadas (redeploy rápido)
#   scripts/deploy.sh staging --seed             # staging pode semear dados demo; produção NUNCA
#   scripts/deploy.sh production logs whatsapp-otp   # acompanhar logs (aqui aparece o QR na 1ª conexão)
#   scripts/deploy.sh production status          # docker compose ps
#   scripts/deploy.sh production down            # derruba os containers (mantém volumes/dados)
set -euo pipefail
cd "$(dirname "$0")/.."

AMBIENTE="${1:-}"
COMANDO="${2:-up}"
NO_BUILD=false
SEED=false
PULL=false
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=true ;;
    --seed) SEED=true ;;
    --pull) PULL=true ;;
  esac
done

erro() { echo "✗ $1" >&2; exit 1; }
info() { echo "==> $1"; }

if [[ "$AMBIENTE" != "local" && "$AMBIENTE" != "staging" && "$AMBIENTE" != "production" ]]; then
  cat <<'EOF'
Uso: scripts/deploy.sh <local|staging|production> [comando] [opções]

Ambientes:
  local        fluxo de dev existente (hot-reload, sem Docker) — igual a `npm run env:up`
  staging      Docker Compose nesta máquina, pode semear dados demo com --seed
  production   Docker Compose nesta máquina, NUNCA semeia dados demo

Comandos (staging/production; default = up):
  up|down|status|logs [serviço]|migrate

Opções (staging/production, só valem com "up"):
  --no-build   não rebuilda as imagens (redeploy rápido reusando o que já existe)
  --seed       roda o seed depois de migrar (staging só — bloqueado em production)
  --pull       roda `git pull` antes de tudo
EOF
  exit 1
fi

# ── local: delega pro fluxo de dev existente, sem reinventar nada ──────────
if [[ "$AMBIENTE" == "local" ]]; then
  if [[ "$COMANDO" == "down" ]]; then
    exec ./scripts/env-down.sh
  fi
  exec ./scripts/env-up.sh
fi

# ── staging/production: Docker Compose ──────────────────────────────────────
# Detecta qual forma está instalada — plugin v2 ("docker compose") ou binário
# standalone v1 ("docker-compose") — pra funcionar em qualquer máquina sem
# depender de qual delas foi instalada.
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose -f docker-compose.yml -f docker-compose.prod.yml)
else
  erro "Nem 'docker compose' (v2) nem 'docker-compose' (v1) encontrados. Instale o Docker Compose antes de continuar."
fi
ENV_FILE=".env"

if [[ "$PULL" == "true" ]]; then
  info "git pull"
  git pull
fi

if [[ "$COMANDO" == "down" ]]; then
  info "Derrubando containers de $AMBIENTE (dados/volumes preservados)"
  "${COMPOSE[@]}" down
  exit 0
fi

if [[ "$COMANDO" == "status" ]]; then
  "${COMPOSE[@]}" ps
  exit 0
fi

if [[ "$COMANDO" == "logs" ]]; then
  servico="${3:-}"
  "${COMPOSE[@]}" logs -f --tail=200 $servico
  exit 0
fi

if [[ "$COMANDO" == "migrate" ]]; then
  info "Rodando só as migrations pendentes"
  "${COMPOSE[@]}" run --rm api npx prisma migrate deploy --schema prisma/schema.prisma
  exit 0
fi

if [[ "$COMANDO" != "up" ]]; then
  erro "Comando desconhecido: $COMANDO"
fi

if [[ "$AMBIENTE" == "production" && "$SEED" == "true" ]]; then
  erro "--seed em production apagaria e recriaria dados demo por cima de dados reais. Bloqueado de propósito — use staging."
fi

# ── pré-voo: .env existe e não tem placeholder óbvio de dev/staging esquecido ──
if [[ ! -f "$ENV_FILE" ]]; then
  info "$ENV_FILE não existe — copiando o template de Docker ($AMBIENTE)"
  cp .env.docker.example "$ENV_FILE"
  erro "$ENV_FILE criado a partir de .env.docker.example — preencha AUTH_SECRET e WHATSAPP_OTP_INTERNAL_TOKEN (ex.: openssl rand -hex 32) antes de rodar de novo. Nada foi subido ainda."
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

checar_var() {
  local nome="$1" valor="${!1:-}"
  [[ -n "$valor" ]] || erro "$nome está vazio em $ENV_FILE — preencha antes de continuar."
}
checar_var AUTH_SECRET
checar_var WHATSAPP_OTP_INTERNAL_TOKEN
[[ "${AUTH_SECRET}" != "dev-secret-change-me" ]] || erro "AUTH_SECRET ainda é o valor de exemplo de dev — troque por um valor real (openssl rand -hex 32) em $ENV_FILE."
[[ "${IDENTITY_PROVIDER:-}" == "whatsapp" ]] || erro "IDENTITY_PROVIDER precisa ser \"whatsapp\" em $AMBIENTE (hoje: '${IDENTITY_PROVIDER:-vazio}') — a API recusaria subir de qualquer forma."
[[ "${DATABASE_URL:-}" == *"@postgres:"* ]] || erro "DATABASE_URL não aponta pro serviço \"postgres\" do docker-compose (valor atual: ${DATABASE_URL:-vazio}). Dentro do Docker, \"localhost\" é o PRÓPRIO container — use @postgres: como host."
[[ "${WHATSAPP_OTP_SERVICE_URL:-}" == *"whatsapp-otp"* ]] || echo "⚠ WHATSAPP_OTP_SERVICE_URL não parece apontar pro serviço \"whatsapp-otp\" do docker-compose (valor atual: ${WHATSAPP_OTP_SERVICE_URL:-vazio}) — confirme que é intencional."

for porta in 3000 3100 5173 5174 5175 5432; do
  ocupante=$(docker ps --format '{{.Names}}\t{{.Ports}}' | grep ":$porta->" | cut -f1 || true)
  if [[ -z "$ocupante" ]] && lsof -ti tcp:"$porta" >/dev/null 2>&1; then
    erro "Porta $porta já está em uso por um processo que NÃO é container deste stack (provavelmente algo rodando fora do Docker, ex.: \`npm run dev\`/\`npm start\` local). Pare esse processo antes de continuar — não vou derrubá-lo por você."
  fi
done

info "Ambiente: $AMBIENTE — subindo com Docker Compose"
BUILD_FLAG=(--build)
[[ "$NO_BUILD" == "true" ]] && BUILD_FLAG=()
"${COMPOSE[@]}" up -d "${BUILD_FLAG[@]}"

info "Aguardando Postgres ficar saudável"
for _ in $(seq 1 60); do
  status=$(docker inspect --format='{{.State.Health.Status}}' bigods-postgres 2>/dev/null || true)
  [[ "$status" == "healthy" ]] && break
  sleep 1
done

info "Aplicando migrations pendentes"
"${COMPOSE[@]}" run --rm api npx prisma migrate deploy --schema prisma/schema.prisma

if [[ "$SEED" == "true" ]]; then
  info "Semeando dados demo (staging)"
  "${COMPOSE[@]}" run --rm api npx tsx prisma/seed.ts
fi

info "Aguardando os serviços responderem"
check_url() { curl -s -o /dev/null -w "%{http_code}" "$1" 2>/dev/null || echo "000"; }
for _ in $(seq 1 60); do
  a=$(check_url "http://localhost:3000/public/empresa?companyId=${VITE_COMPANY_ID:-bigods}")
  b=$(check_url "http://localhost:5173/")
  c=$(check_url "http://localhost:5174/")
  d=$(check_url "http://localhost:5175/")
  [[ "$a" == "200" && "$b" == "200" && "$c" == "200" && "$d" == "200" ]] && break
  sleep 1
done

whatsapp_status=$(curl -s "http://localhost:3100/status" 2>/dev/null || echo '{"conectado":false}')

cat <<EOF

Ambiente ($AMBIENTE) no ar:
  API      http://localhost:3000
  Admin    http://localhost:5173
  Booking  http://localhost:5174
  Account  http://localhost:5175
  WhatsApp OTP  http://localhost:3100/status  →  $whatsapp_status

EOF

if [[ "$whatsapp_status" != *'"conectado":true'* ]]; then
  cat <<EOF
⚠ O serviço de WhatsApp ainda NÃO está conectado. Se for a primeira vez:
    scripts/deploy.sh $AMBIENTE logs whatsapp-otp
  e escaneie o QR que aparece nos logs com o número DESCARTÁVEL da barbearia
  (nunca o oficial — ver services/whatsapp-otp/README.md).

EOF
fi

cat <<EOF
Comandos úteis:
  scripts/deploy.sh $AMBIENTE logs [serviço]   acompanhar logs
  scripts/deploy.sh $AMBIENTE status           ver status dos containers
  scripts/deploy.sh $AMBIENTE down             derrubar tudo (mantém dados)
EOF

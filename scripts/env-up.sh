#!/usr/bin/env bash
# Sobe o ambiente de dev inteiro do zero: Postgres (docker), migrations,
# Prisma Client, seed, e os 4 servidores (api/admin/booking/account).
# Idempotente — pode rodar de novo a qualquer momento (reaplica migrations
# pendentes e mata servidores antigos nas mesmas portas antes de reiniciar).
set -euo pipefail
cd "$(dirname "$0")/.."

PORTS=(3000 5173 5174 5175)
LOG_DIR=".dev-logs"

# Mata a ÁRVORE de um processo, não só ele. Necessário porque `npm run dev`
# vira `npm -> sh -c -> node`: matar só quem segura a porta (o neto) deixa o
# npm e o sh vivos, e eles seguem consumindo inotify watches — e o `--watch`
# ainda pode ressuscitar o filho. Era assim que cada `env:up` deixava uma
# cadeia órfã para trás até estourar o limite do sistema.
matar_arvore() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  local filhos
  filhos=$(pgrep -P "$pid" 2>/dev/null || true)
  for filho in $filhos; do
    matar_arvore "$filho"
  done
  kill -9 "$pid" 2>/dev/null || true
}

# Derruba os servidores de dev: primeiro pelas árvores registradas nos .pid
# (pega os wrappers), depois pelas portas (pega qualquer coisa que tenha
# sobrado de execuções anteriores sem .pid).
derrubar_servidores() {
  for arquivo in "$LOG_DIR"/*.pid; do
    [ -f "$arquivo" ] || continue
    matar_arvore "$(cat "$arquivo" 2>/dev/null || true)"
  done
  for port in "${PORTS[@]}"; do
    local pid
    pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    if [ -n "$pid" ]; then
      for p in $pid; do matar_arvore "$p"; done
    fi
  done
}

echo "==> Verificando .env"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    .env criado a partir de .env.example (valores padrão de dev: DEMO_MODE + PAYMENT_GATEWAY=fake)"
else
  echo "    .env já existe, mantido como está"
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

echo "==> Subindo Postgres (docker-compose)"
docker-compose up -d

echo "==> Aguardando Postgres aceitar conexões"
for _ in $(seq 1 30); do
  if docker exec bigods-postgres pg_isready -U bigods >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker exec bigods-postgres pg_isready -U bigods >/dev/null 2>&1; then
  echo "Postgres não respondeu a tempo." >&2
  exit 1
fi

echo "==> Instalando dependências"
npm install --silent

echo "==> Aplicando migrations"
npm run db:migrate -w @bigods/api

echo "==> Gerando Prisma Client"
npm run db:generate -w @bigods/api

echo "==> Semeando banco (idempotente — apaga e recria os dados de demo)"
npm run seed:dev -w @bigods/api

echo "==> Derrubando servidores de dev anteriores (árvore inteira)"
derrubar_servidores

mkdir -p "$LOG_DIR"

echo "==> Subindo API (3000), Admin (5173), Booking (5174), Account (5175)"
nohup npm run dev -w @bigods/api     > "$LOG_DIR/api.log"     2>&1 & echo $! > "$LOG_DIR/api.pid"
nohup npm run dev -w @bigods/admin   > "$LOG_DIR/admin.log"   2>&1 & echo $! > "$LOG_DIR/admin.pid"
nohup npm run dev -w @bigods/booking > "$LOG_DIR/booking.log" 2>&1 & echo $! > "$LOG_DIR/booking.pid"
nohup npm run dev -w @bigods/account > "$LOG_DIR/account.log" 2>&1 & echo $! > "$LOG_DIR/account.pid"

echo "==> Aguardando os 4 servidores responderem"
check_url() {
  curl -s -o /dev/null -w "%{http_code}" "$1" 2>/dev/null || echo "000"
}
for _ in $(seq 1 40); do
  a=$(check_url "http://localhost:3000/public/empresa?companyId=bigods")
  b=$(check_url "http://localhost:5173/")
  c=$(check_url "http://localhost:5174/")
  d=$(check_url "http://localhost:5175/")
  if [ "$a" = "200" ] && [ "$b" = "200" ] && [ "$c" = "200" ] && [ "$d" = "200" ]; then
    break
  fi
  sleep 1
done

cat <<'EOF'

Ambiente pronto:
  API      http://localhost:3000
  Admin    http://localhost:5173
  Booking  http://localhost:5174
  Account  http://localhost:5175

Logins do admin (senha bigods123): gabriel (admin+barbeiro), lkt, rafaelgrigio
Conta demo (login OTP, telefone): (11) 99999-8888 — código OTP volta na resposta, sem SMS

Logs:  .dev-logs/{api,admin,booking,account}.log
Derrubar tudo:  npm run env:down
EOF

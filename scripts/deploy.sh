#!/usr/bin/env bash
# Ponto de entrada único pra subir o ambiente inteiro — local, staging ou
# produção. Local usa o fluxo de dev já existente (scripts/env-up.sh, sem
# Docker, hot-reload). Staging é um rehearsal autocontido (roda em qualquer
# máquina, Postgres+frontends em container). Produção é a topologia REAL da
# AWS (docker-compose.aws.yml): banco é RDS externo, frontends são
# S3+CloudFront (`scripts/deploy-frontends.sh`, separado), só API +
# whatsapp-otp + Caddy rodam aqui. Ver AWS_SETUP.md pro passo a passo de infra.
#
# Uso:
#   scripts/deploy.sh local     [up|down]
#   scripts/deploy.sh staging   [up|down|status|logs [serviço]|migrate]  [--no-build] [--seed] [--pull]
#   scripts/deploy.sh production [up|down|status|logs [serviço]|migrate]  [--no-build] [--pull]
#
# Exemplos:
#   scripts/deploy.sh local                          # sobe tudo pra desenvolver (= npm run env:up)
#   scripts/deploy.sh staging                         # rehearsal completo autocontido (sem AWS)
#   scripts/deploy.sh staging --seed                  # staging pode semear dados demo; produção NUNCA
#   scripts/deploy.sh production                      # EC2 real: builda e sobe API + whatsapp-otp + Caddy
#   scripts/deploy.sh production --pull                # git pull antes de tudo
#   scripts/deploy.sh production --no-build             # reaproveita as imagens já buildadas (redeploy rápido)
#   scripts/deploy.sh production logs whatsapp-otp       # acompanhar logs (aqui aparece o QR na 1ª conexão)
#   scripts/deploy.sh production status                  # docker compose ps
#   scripts/deploy.sh production down                    # derruba os containers (mantém volumes/dados)
set -euo pipefail
cd "$(dirname "$0")/.."

AMBIENTE="${1:-}"
NO_BUILD=false
SEED=false
PULL=false
# COMANDO é o primeiro argumento depois de AMBIENTE que NÃO é uma flag "--*"
# (default "up"). Ex.: `production --pull` não pode fazer COMANDO virar
# "--pull" — senão o script morre com "Comando desconhecido: --pull" antes
# de subir qualquer coisa (bug real, encontrado ao usar exatamente esse
# comando documentado acima).
COMANDO="up"
COMANDO_DEFINIDO=false
for arg in "${@:2}"; do
  case "$arg" in
    --no-build) NO_BUILD=true ;;
    --seed) SEED=true ;;
    --pull) PULL=true ;;
    --*) ;;
    # só o PRIMEIRO argumento sem "--" vira COMANDO — os seguintes são
    # sub-argumentos dele (ex.: o "whatsapp-otp" de `logs whatsapp-otp`,
    # lido separadamente via $3 mais abaixo).
    *) [[ "$COMANDO_DEFINIDO" == false ]] && { COMANDO="$arg"; COMANDO_DEFINIDO=true; } ;;
  esac
done

erro() { echo "✗ $1" >&2; exit 1; }
info() { echo "==> $1"; }

if [[ "$AMBIENTE" != "local" && "$AMBIENTE" != "staging" && "$AMBIENTE" != "production" ]]; then
  cat <<'EOF'
Uso: scripts/deploy.sh <local|staging|production> [comando] [opções]

Ambientes:
  local        fluxo de dev existente (hot-reload, sem Docker) — igual a `npm run env:up`
  staging      rehearsal completo autocontido (Postgres+frontends em container, roda em
               qualquer máquina, sem precisar de nenhum recurso AWS) — pode semear com --seed
  production   topologia REAL da AWS (docker-compose.aws.yml): só API + whatsapp-otp + Caddy
               (Postgres é RDS externo; frontends são S3+CloudFront, ver scripts/deploy-frontends.sh)

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

# ── staging/production: Docker Compose, mas com topologias DIFERENTES ──────
# Detecta qual forma está instalada — plugin v2 ("docker compose") ou binário
# standalone v1 ("docker-compose") — pra funcionar em qualquer máquina sem
# depender de qual delas foi instalada.
if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE_BIN=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE_BIN=(docker-compose)
else
  erro "Nem 'docker compose' (v2) nem 'docker-compose' (v1) encontrados. Instale o Docker Compose antes de continuar."
fi

if [[ "$AMBIENTE" == "staging" ]]; then
  COMPOSE=("${DOCKER_COMPOSE_BIN[@]}" -f docker-compose.yml -f docker-compose.staging.yml)
  ENV_TEMPLATE=".env.docker.example"
else
  COMPOSE=("${DOCKER_COMPOSE_BIN[@]}" -f docker-compose.aws.yml)
  ENV_TEMPLATE=".env.aws.example"
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

# ── pré-voo: .env existe e não tem placeholder óbvio esquecido ─────────────
if [[ ! -f "$ENV_FILE" ]]; then
  info "$ENV_FILE não existe — copiando o template de $AMBIENTE ($ENV_TEMPLATE)"
  cp "$ENV_TEMPLATE" "$ENV_FILE"
  if [[ "$AMBIENTE" == "production" ]]; then
    erro "$ENV_FILE criado a partir de $ENV_TEMPLATE — preencha API_DOMAIN/ACME_EMAIL, depois rode scripts/fetch-secrets-ssm.sh pra buscar os segredos do SSM Parameter Store (ver AWS_SETUP.md). Nada foi subido ainda."
  else
    erro "$ENV_FILE criado a partir de $ENV_TEMPLATE — preencha AUTH_SECRET e WHATSAPP_OTP_INTERNAL_TOKEN (ex.: openssl rand -hex 32) antes de rodar de novo. Nada foi subido ainda."
  fi
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

checar_var() {
  local nome="$1" valor="${!1:-}"
  [[ -n "$valor" ]] || erro "$nome está vazio em $ENV_FILE — preencha antes de continuar (produção: rode scripts/fetch-secrets-ssm.sh)."
}
checar_var AUTH_SECRET
checar_var DATABASE_URL
[[ "${AUTH_SECRET}" != "dev-secret-change-me" ]] || erro "AUTH_SECRET ainda é o valor de exemplo de dev — troque por um valor real (openssl rand -hex 32) em $ENV_FILE."
# Espelha a lista de config-seguranca.ts (PROVIDERS_VALIDOS_EM_PRODUCAO) — a
# FONTE DA VERDADE é lá; aqui é só pra falhar antes de subir container, com
# mensagem melhor. Se divergir, o certo é corrigir este script, nunca o
# contrário (2026-08-20: este check dizia que só "whatsapp" servia e que "a API
# recusaria subir de qualquer forma" — era falso, e travava um deploy legítimo
# com cognito).
case "${IDENTITY_PROVIDER:-}" in
  whatsapp)
    # A API conversa com o serviço whatsapp-otp por este token.
    checar_var WHATSAPP_OTP_INTERNAL_TOKEN
    ;;
  cognito)
    # Sem estas três a API nem inicializa (identity.module.ts usa exigir()).
    # Checar aqui evita descobrir no primeiro login de cliente.
    checar_var COGNITO_USER_POOL_ID
    checar_var COGNITO_CLIENT_ID
    checar_var AWS_REGION
    echo "⚠ IDENTITY_PROVIDER=cognito: o OTP sai por SMS, pelas Lambdas de infra/cognito-triggers"
    echo "  (SMS_GATE_USER/SMS_GATE_PASSWORD são variáveis DELAS, não deste .env)."
    echo "  Confirme que os 3 triggers estão publicados e ligados ao user pool ANTES de seguir —"
    echo "  a API sobe normalmente, mas nenhum cliente consegue entrar se o SMS não sair."
    ;;
  *)
    erro "IDENTITY_PROVIDER='${IDENTITY_PROVIDER:-vazio}' não envia OTP real — em $AMBIENTE use \"whatsapp\" (celular pareado) ou \"cognito\" (SMS). Mesma lista de config-seguranca.ts."
    ;;
esac

if [[ "$AMBIENTE" == "staging" ]]; then
  [[ "${DATABASE_URL:-}" == *"@postgres:"* ]] || erro "DATABASE_URL não aponta pro serviço \"postgres\" do docker-compose (valor atual: ${DATABASE_URL:-vazio}). Dentro do Docker, \"localhost\" é o PRÓPRIO container — use @postgres: como host."
  [[ "${WHATSAPP_OTP_SERVICE_URL:-}" == *"whatsapp-otp"* ]] || echo "⚠ WHATSAPP_OTP_SERVICE_URL não parece apontar pro serviço \"whatsapp-otp\" do docker-compose (valor atual: ${WHATSAPP_OTP_SERVICE_URL:-vazio}) — confirme que é intencional."
else
  [[ "${DATABASE_URL:-}" != *"@postgres:"* ]] || erro "DATABASE_URL aponta pro serviço \"postgres\" do docker-compose, mas produção não tem esse serviço (o banco é RDS) — confirme que rodou scripts/fetch-secrets-ssm.sh e não copiou o .env errado."
  checar_var API_DOMAIN
  checar_var ACME_EMAIL
fi

PORTAS_A_CHECAR=(3100 5432)
[[ "$AMBIENTE" == "staging" ]] && PORTAS_A_CHECAR+=(3000 5173 5174 5175)
[[ "$AMBIENTE" == "production" ]] && PORTAS_A_CHECAR+=(80 443)
for porta in "${PORTAS_A_CHECAR[@]}"; do
  ocupante=$(docker ps --format '{{.Names}}\t{{.Ports}}' | grep ":$porta->" | cut -f1 || true)
  if [[ -z "$ocupante" ]] && lsof -ti tcp:"$porta" >/dev/null 2>&1; then
    erro "Porta $porta já está em uso por um processo que NÃO é container deste stack (provavelmente algo rodando fora do Docker, ex.: \`npm run dev\`/\`npm start\` local, ou outro servidor web na 80/443). Pare esse processo antes de continuar — não vou derrubá-lo por você."
  fi
done

info "Ambiente: $AMBIENTE — subindo com Docker Compose"
BUILD_FLAG=(--build)
[[ "$NO_BUILD" == "true" ]] && BUILD_FLAG=()
"${COMPOSE[@]}" up -d "${BUILD_FLAG[@]}"

if [[ "$AMBIENTE" == "staging" ]]; then
  info "Aguardando Postgres (container local) ficar saudável"
  for _ in $(seq 1 60); do
    status=$(docker inspect --format='{{.State.Health.Status}}' bigods-postgres 2>/dev/null || true)
    [[ "$status" == "healthy" ]] && break
    sleep 1
  done
else
  info "Aguardando a API conseguir falar com o RDS (até 60s)"
  for _ in $(seq 1 60); do
    "${COMPOSE[@]}" exec -T api node -e "process.exit(0)" >/dev/null 2>&1 && break
    sleep 1
  done
fi

info "Aplicando migrations pendentes"
"${COMPOSE[@]}" run --rm api npx prisma migrate deploy --schema prisma/schema.prisma

if [[ "$SEED" == "true" ]]; then
  info "Semeando dados demo (staging)"
  "${COMPOSE[@]}" run --rm api npx tsx prisma/seed.ts
fi

info "Aguardando os serviços responderem"
if [[ "$AMBIENTE" == "staging" ]]; then
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
else
  # api/whatsapp-otp não publicam porta pro host de propósito (só o Caddy é
  # público) — checa DE DENTRO dos containers via fetch nativo do Node, sem
  # depender de curl instalado na imagem nem de DNS já propagado.
  for _ in $(seq 1 30); do
    api_ok=$("${COMPOSE[@]}" exec -T api node -e "fetch('http://localhost:3000/public/empresa?companyId=${VITE_COMPANY_ID:-bigods}').then(r=>console.log(r.status)).catch(()=>console.log('000'))" 2>/dev/null || echo "000")
    [[ "$api_ok" == "200" ]] && break
    sleep 1
  done
  whatsapp_status=$("${COMPOSE[@]}" exec -T whatsapp-otp node -e "fetch('http://localhost:3100/status').then(r=>r.text()).then(t=>console.log(t)).catch(()=>console.log('{\"conectado\":false}'))" 2>/dev/null || echo '{"conectado":false}')
fi

cat <<EOF

Ambiente ($AMBIENTE) no ar:
EOF
if [[ "$AMBIENTE" == "staging" ]]; then
  cat <<EOF
  API      http://localhost:3000
  Admin    http://localhost:5173
  Booking  http://localhost:5174
  Account  http://localhost:5175
  WhatsApp OTP  http://localhost:3100/status  →  $whatsapp_status
EOF
else
  cat <<EOF
  API      https://$API_DOMAIN  (via Caddy — se acabou de subir, dê 1-2 min pro certificado Let's Encrypt)
  WhatsApp OTP (interno, sem porta pública)  →  $whatsapp_status
  Frontends: publique separado com scripts/deploy-frontends.sh (S3+CloudFront)
EOF
fi

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

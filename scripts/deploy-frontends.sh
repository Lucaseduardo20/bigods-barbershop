#!/usr/bin/env bash
# Builda os 3 frontends (admin/booking/account) e publica em S3 + invalida o
# CloudFront. Roda do SEU computador (ou de um runner de CI) — não roda na
# EC2, que só tem API + whatsapp-otp. Exige AWS CLI configurado com
# permissão de escrita nos buckets e de invalidação nas distribuições.
#
# Uso: scripts/deploy-frontends.sh [admin|booking|account|all]
#   (default: all)
#
# Variáveis exigidas em .env.frontends (na raiz do repo — NÃO commitado, ver
# .env.frontends.example): VITE_COMPANY_ID, VITE_BOOKING_URL, VITE_API_URL,
# e por app: ADMIN_S3_BUCKET/ADMIN_CLOUDFRONT_ID (idem BOOKING_/ACCOUNT_).
set -euo pipefail
cd "$(dirname "$0")/.."

ALVO="${1:-all}"
ENV_FILE=".env.frontends"

[[ -f "$ENV_FILE" ]] || { echo "✗ $ENV_FILE não existe — copie de .env.frontends.example e preencha." >&2; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

info() { echo "==> $1"; }

# Variáveis que ENTRAM NO BUNDLE de cada app (`import.meta.env.VITE_*`), e que
# por isso só existem em build-time. Se uma faltar, o código cai num fallback de
# desenvolvimento — hoje `http://localhost:5175` no link "entrar na minha conta"
# do booking — e o deploy passa liso: publica, a página abre, e o defeito só
# aparece quando alguém clica. Aconteceu em produção em 2026-08-20.
#
# Falhar aqui, ANTES de buildar, é a diferença entre um erro de uma linha e uma
# caça ao bug em produção. Manter em sincronia com o que cada app importa
# (`grep -rho "VITE_[A-Z_]*" apps/<app>/src | sort -u`).
vars_do_bundle() {
  case "$1" in
    admin)   echo "VITE_API_URL VITE_BOOKING_URL" ;;
    booking) echo "VITE_API_URL VITE_ACCOUNT_URL VITE_COMPANY_ID" ;;
    account) echo "VITE_API_URL VITE_BOOKING_URL VITE_COMPANY_ID" ;;
  esac
}

deploy_app() {
  local app="$1" bucket_var="$2" cf_var="$3"
  local bucket="${!bucket_var:-}" cf_id="${!cf_var:-}"
  [[ -n "$bucket" ]] || { echo "✗ $bucket_var vazio em $ENV_FILE" >&2; exit 1; }
  [[ -n "$cf_id" ]] || { echo "✗ $cf_var vazio em $ENV_FILE" >&2; exit 1; }

  local faltando=()
  for v in $(vars_do_bundle "$app"); do
    [[ -n "${!v:-}" ]] || faltando+=("$v")
  done
  if (( ${#faltando[@]} > 0 )); then
    echo "✗ $app: ${faltando[*]} sem valor em $ENV_FILE." >&2
    echo "  Estas variáveis são gravadas DENTRO do bundle no build; sem elas o app" >&2
    echo "  publicado cai no fallback de desenvolvimento (ex.: localhost) e nada falha." >&2
    exit 1
  fi

  info "Buildando @bigods/$app (VITE_API_URL=$VITE_API_URL)"
  npx turbo run build --filter="@bigods/$app"

  info "Publicando apps/$app/dist em s3://$bucket"
  aws s3 sync "apps/$app/dist" "s3://$bucket" --delete

  info "Invalidando cache do CloudFront ($cf_id)"
  aws cloudfront create-invalidation --distribution-id "$cf_id" --paths "/*" >/dev/null

  info "$app publicado."
}

case "$ALVO" in
  admin)   deploy_app admin   ADMIN_S3_BUCKET   ADMIN_CLOUDFRONT_ID ;;
  booking) deploy_app booking BOOKING_S3_BUCKET BOOKING_CLOUDFRONT_ID ;;
  account) deploy_app account ACCOUNT_S3_BUCKET ACCOUNT_CLOUDFRONT_ID ;;
  all)
    deploy_app admin   ADMIN_S3_BUCKET   ADMIN_CLOUDFRONT_ID
    deploy_app booking BOOKING_S3_BUCKET BOOKING_CLOUDFRONT_ID
    deploy_app account ACCOUNT_S3_BUCKET ACCOUNT_CLOUDFRONT_ID
    ;;
  *) echo "Uso: scripts/deploy-frontends.sh [admin|booking|account|all]" >&2; exit 1 ;;
esac

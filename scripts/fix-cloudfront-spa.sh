#!/usr/bin/env bash
# Corrige as 3 distribuições CloudFront (admin/booking/account) pra servirem
# uma SPA React corretamente. Dois ajustes, ambos ausentes quando a
# distribuição é criada pelo assistente do Console:
#
#   1. DefaultRootObject = "index.html"
#      Sem isso, "https://dominio/" faz o CloudFront pedir a chave "" ao S3.
#      Como a bucket policy do OAC só concede s3:GetObject (sem s3:ListBucket),
#      o S3 responde AccessDenied em vez de NoSuchKey — o 403 parece problema
#      de permissão, mas não é.
#
#   2. CustomErrorResponses 403/404 -> /index.html com HTTP 200
#      Rotas client-side (/agenda, F5 fora da home) não existem como objeto no
#      S3. Sem esse mapeamento, todo deep link quebra com o mesmo 403.
#
# Idempotente: pula distribuições que já estão corretas (use --force pra
# reaplicar). Só altera o que está descrito acima — o resto da config
# (OAC, certificado, WAF, cache policy) é preservado byte a byte.
#
# Uso: scripts/fix-cloudfront-spa.sh [admin|booking|account|all] [--dry-run] [--force]
#   (default: all)
#
# Exige: AWS CLI autenticado com cloudfront:GetDistributionConfig,
# cloudfront:UpdateDistribution e cloudfront:CreateInvalidation; e `jq`.
set -euo pipefail
cd "$(dirname "$0")/.."

ALVO="all"
DRY_RUN=false
FORCE=false
for arg in "$@"; do
  case "$arg" in
    admin|booking|account|all) ALVO="$arg" ;;
    --dry-run) DRY_RUN=true ;;
    --force)   FORCE=true ;;
    *) echo "Uso: scripts/fix-cloudfront-spa.sh [admin|booking|account|all] [--dry-run] [--force]" >&2; exit 1 ;;
  esac
done

ENV_FILE=".env.frontends"
[[ -f "$ENV_FILE" ]] || { echo "✗ $ENV_FILE não existe — copie de .env.frontends.example e preencha." >&2; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

command -v jq >/dev/null || { echo "✗ jq não encontrado (brew install jq)." >&2; exit 1; }
aws sts get-caller-identity >/dev/null 2>&1 || { echo "✗ credenciais AWS inválidas ou expiradas." >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

info() { echo "==> $1"; }

# 403 e 404 -> index.html com 200, sem cachear o erro (ErrorCachingMinTTL=0),
# senão uma resposta ruim durante o deploy fica presa na borda.
ERROS_SPA='[
  {"ErrorCode":403,"ResponsePagePath":"/index.html","ResponseCode":"200","ErrorCachingMinTTL":0},
  {"ErrorCode":404,"ResponsePagePath":"/index.html","ResponseCode":"200","ErrorCachingMinTTL":0}
]'

fix_app() {
  local app="$1" cf_var="$2"
  local cf_id="${!cf_var:-}"
  [[ -n "$cf_id" ]] || { echo "✗ $cf_var vazio em $ENV_FILE" >&2; exit 1; }

  info "[$app] lendo distribuição $cf_id"
  local resp="$TMP/$app-resp.json"
  aws cloudfront get-distribution-config --id "$cf_id" --output json > "$resp"

  local etag; etag="$(jq -r '.ETag' "$resp")"
  jq '.DistributionConfig' "$resp" > "$TMP/$app-atual.json"

  local ja_ok
  ja_ok="$(jq -r '
    (.DefaultRootObject == "index.html")
    and ((.CustomErrorResponses.Items // []) | map(.ErrorCode)
         | (index(403) != null and index(404) != null))
  ' "$TMP/$app-atual.json")"

  if [[ "$ja_ok" == "true" && "$FORCE" == false ]]; then
    info "[$app] já está correto — pulando (use --force pra reaplicar)."
    return
  fi

  # Preserva quaisquer CustomErrorResponses de outros códigos; substitui só 403/404.
  jq --argjson novos "$ERROS_SPA" '
      .DefaultRootObject = "index.html"
    | .CustomErrorResponses.Items =
        (((.CustomErrorResponses.Items // []) | map(select(.ErrorCode != 403 and .ErrorCode != 404))) + $novos)
    | .CustomErrorResponses.Quantity = (.CustomErrorResponses.Items | length)
  ' "$TMP/$app-atual.json" > "$TMP/$app-novo.json"

  if [[ "$DRY_RUN" == true ]]; then
    info "[$app] --dry-run, mudanças que seriam aplicadas:"
    diff <(jq -S . "$TMP/$app-atual.json") <(jq -S . "$TMP/$app-novo.json") || true
    return
  fi

  info "[$app] aplicando (IfMatch=$etag)"
  aws cloudfront update-distribution \
    --id "$cf_id" \
    --distribution-config "file://$TMP/$app-novo.json" \
    --if-match "$etag" >/dev/null

  # O 403 da raiz já está em cache na borda — sem invalidar, o erro persiste
  # mesmo depois da distribuição terminar de propagar.
  info "[$app] invalidando cache (/*)"
  aws cloudfront create-invalidation --distribution-id "$cf_id" --paths "/*" >/dev/null

  info "[$app] pronto."
}

case "$ALVO" in
  admin)   fix_app admin   ADMIN_CLOUDFRONT_ID ;;
  booking) fix_app booking BOOKING_CLOUDFRONT_ID ;;
  account) fix_app account ACCOUNT_CLOUDFRONT_ID ;;
  all)
    fix_app admin   ADMIN_CLOUDFRONT_ID
    fix_app booking BOOKING_CLOUDFRONT_ID
    fix_app account ACCOUNT_CLOUDFRONT_ID
    ;;
esac

if [[ "$DRY_RUN" == false ]]; then
  cat <<'FIM'

Propagação leva ~5 min. Depois, verifique (todos devem dar 200):

  curl -s -o /dev/null -w "%{http_code}\n" https://admin.bigodsbarbershop.com/
  curl -s -o /dev/null -w "%{http_code}\n" https://agendamento.bigodsbarbershop.com/
  curl -s -o /dev/null -w "%{http_code}\n" https://minhaconta.bigodsbarbershop.com/

E um deep link, pra confirmar o fallback de SPA:

  curl -s -o /dev/null -w "%{http_code}\n" https://admin.bigodsbarbershop.com/rota-inexistente
FIM
fi

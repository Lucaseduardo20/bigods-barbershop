#!/usr/bin/env bash
# Busca os segredos do SSM Parameter Store e grava/atualiza no .env local.
# Roda NA PRÓPRIA EC2 (a role IAM da instância precisa de permissão
# ssm:GetParameter nos parâmetros abaixo — ver AWS_SETUP.md §4) antes de
# `docker compose -f docker-compose.aws.yml up`. Nunca deixa segredo em
# texto puro em nenhum lugar além deste .env local (que por sua vez nunca é
# commitado nem sai da instância).
set -euo pipefail
cd "$(dirname "$0")/.."

PREFIX="${SSM_PREFIX:-/bigods/prod}"
ENV_FILE=".env"

[[ -f "$ENV_FILE" ]] || {
  echo "✗ $ENV_FILE não existe — copie de .env.aws.example primeiro (valores não-secretos: NODE_ENV, API_DOMAIN etc)." >&2
  exit 1
}

buscar() {
  aws ssm get-parameter --name "$PREFIX/$1" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null
}

atualizar_env() {
  local chave="$1" valor="$2"
  if grep -q "^${chave}=" "$ENV_FILE"; then
    sed -i "s|^${chave}=.*|${chave}=\"${valor}\"|" "$ENV_FILE"
  else
    echo "${chave}=\"${valor}\"" >>"$ENV_FILE"
  fi
}

echo "==> Buscando segredos obrigatórios em $PREFIX/*"
for chave in AUTH_SECRET WHATSAPP_OTP_INTERNAL_TOKEN DATABASE_URL; do
  valor=$(buscar "$chave") || { echo "✗ Parâmetro obrigatório $PREFIX/$chave não encontrado no SSM." >&2; exit 1; }
  atualizar_env "$chave" "$valor"
  echo "    $chave ok"
done

echo "==> Buscando segredos OPCIONAIS (só existem depois de ligar PAYMENT_GATEWAY=abacatepay)"
for chave in ABACATEPAY_API_KEY ABACATEPAY_WEBHOOK_SECRET; do
  if valor=$(buscar "$chave"); then
    atualizar_env "$chave" "$valor"
    echo "    $chave ok"
  else
    echo "    $chave não encontrado no SSM — pulado (normal se PAYMENT_GATEWAY ainda for \"fake\")"
  fi
done

echo "✓ $ENV_FILE atualizado com os segredos do SSM ($PREFIX)."

#!/usr/bin/env bash
# Destrói o ambiente de dev inteiro: mata os 4 servidores e derruba o Postgres
# apagando o volume (todos os dados — migrations, seed, tudo que foi criado
# manualmente testando). Depois de rodar isto, "npm run env:up" recria do zero.
set -uo pipefail
cd "$(dirname "$0")/.."

PORTS=(3000 5173 5174 5175)
LOG_DIR=".dev-logs"

echo "==> Derrubando servidores de dev"
for port in "${PORTS[@]}"; do
  pid=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    kill -9 $pid 2>/dev/null || true
    echo "    porta $port liberada"
  fi
done
rm -rf "$LOG_DIR"

echo "==> Derrubando Postgres e apagando o volume de dados"
docker-compose down -v

echo "Ambiente completamente destruído. Rode 'npm run env:up' para recriar do zero."

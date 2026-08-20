#!/usr/bin/env bash
# Destrói o ambiente de dev inteiro: mata os 4 servidores e derruba o Postgres
# apagando o volume (todos os dados — migrations, seed, tudo que foi criado
# manualmente testando). Depois de rodar isto, "npm run env:up" recria do zero.
set -uo pipefail
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

echo "==> Derrubando servidores de dev (árvore inteira, não só quem segura a porta)"
derrubar_servidores
rm -rf "$LOG_DIR"

echo "==> Derrubando Postgres e apagando o volume de dados"
docker-compose down -v

echo "Ambiente completamente destruído. Rode 'npm run env:up' para recriar do zero."

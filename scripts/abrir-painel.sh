#!/bin/bash
# Abre o Painel Legislativo como app: sobe o servidor local (se preciso) e abre uma janela própria.
# Uso: bash scripts/abrir-painel.sh  [pasta do projeto]
PROJ="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
PORT=8765
URL="http://localhost:$PORT/"
LOG="${TMPDIR:-/tmp}/painel-legislativo.log"

no_ar() { curl -s --max-time 1 "$URL" | grep -q "Painel Legislativo"; }

if ! no_ar; then
  if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
    osascript -e "display alert \"Painel Legislativo\" message \"A porta $PORT já está em uso por outro programa.\""
    exit 1
  fi
  cd "$PROJ" || exit 1
  nohup /usr/bin/python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$PROJ" >"$LOG" 2>&1 &
  for _ in $(seq 1 50); do no_ar && break; sleep 0.1; done
fi

if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="$URL"
else
  open "$URL"
fi

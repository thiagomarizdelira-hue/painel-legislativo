#!/bin/bash
# Desliga o servidor local do Painel Legislativo (porta 8765).
PIDS=$(lsof -tiTCP:8765 -sTCP:LISTEN)
[ -n "$PIDS" ] && kill $PIDS && echo "Painel desligado." || echo "O painel já estava desligado."

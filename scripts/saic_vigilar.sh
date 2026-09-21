#!/bin/zsh
# Corre la descarga del SAIC en segundo plano y la reinicia si se queda sin escribir páginas 40 minutos
# (el 2026-09-21 el proceso quedó bloqueado 3.5 h con los hilos ociosos y sin conexiones). Reanudable por el manifiesto.
# Uso: nohup zsh scripts/saic_vigilar.sh 6 "--anios 2008,2003 --ambitos 00,ent" > data/saic/vigilante.out 2>&1 &
cd "$(dirname "$0")/.." || exit 1
HILOS=${1:-6}; EXTRA=${2:-}; CRUDO=data/saic/crudo; LOG=data/saic/saic.log
while true; do
  data/.venv/bin/python scripts/saic_descarga.py --descargar --hilos "$HILOS" ${=EXTRA} >> data/saic/descarga.out 2>&1 &
  PID=$!
  while kill -0 "$PID" 2>/dev/null; do
    sleep 300
    ULT=$(find "$CRUDO" -type f -newermt '-40 minutes' | head -1)
    if [ -z "$ULT" ] && ! grep -q 'descarga terminada' <(tail -3 "$LOG"); then
      echo "$(date '+%F %T') vigilante: sin páginas nuevas en 40 min, reinicio (pid $PID)" | tee -a "$LOG"
      kill "$PID" 2>/dev/null; sleep 5; kill -9 "$PID" 2>/dev/null
    fi
  done
  if tail -3 "$LOG" | grep -q 'descarga terminada'; then echo "$(date '+%F %T') vigilante: descarga terminada" | tee -a "$LOG"; break; fi
  sleep 30
done

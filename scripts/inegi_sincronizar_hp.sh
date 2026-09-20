#!/bin/zsh
# Trae los manifiestos y bitácoras de la HP a data/inegi/ (nombres por máquina, no chocan con los locales).
cd "/Users/davicho/Datos México/datos-mexico-api"
rsync -az -e "ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR" 'frame@192.168.100.50:~/datosmexico/data/inegi/*.jsonl' 'frame@192.168.100.50:~/datosmexico/data/inegi/*.log' data/inegi/ 2>/dev/null
ls data/inegi/*.jsonl | xargs wc -l | tail -1

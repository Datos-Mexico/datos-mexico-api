#!/bin/zsh
# Carga data/<schema>/sql/*.sql a la D1 remota datosmexico-api-<schema>, en el orden del DDL.
# Uso: zsh scripts/cargar_d1.sh <schema> [tabla_prioritaria ...]   (las prioritarias van primero; gastoshogar siempre al final)
# Antes de cada tabla compara el conteo remoto con el CSV (registros CSV, no líneas: hay campos con saltos de línea): si ya coincide la salta; si hay carga parcial se detiene.
# Cada archivo se manda en trozos de ≤ 8 MB en límites de sentencia (D1 se queda sin memoria con archivos grandes).
S=$1; shift; PRIMERO=($@)
cd "$(dirname "$0")/.."
DB=datosmexico-api-$S
TODAS=($(grep -oE '^CREATE TABLE IF NOT EXISTS \w+' data/$S/schema.sqlite.sql | awk '{print $6}'))
RESTO=(); for t in $TODAS; do [[ " ${PRIMERO[*]} " == *" $t "* ]] || [[ $t == gastoshogar ]] || RESTO+=($t); done
ULTIMA=(); [[ " ${TODAS[*]} " == *" gastoshogar "* ]] && ULTIMA=(gastoshogar)
esperado() { python3 -c "
import json,subprocess,sys,os
s,t=sys.argv[1],sys.argv[2]; pj=f'data/{s}/particiones.json'
p=json.load(open(pj)) if os.path.exists(pj) else {}
orig=next((o for o,ps in p.items() if any(x['tabla']==t for x in ps)), t)
import csv; csv.field_size_limit(1<<30)
with open(f'data/{s}/neon-export/'+orig+'.csv', newline='', encoding='utf-8') as f: print(sum(1 for _ in csv.reader(f))-1)" "$S" "$1"; }
remoto() { npx wrangler d1 execute $DB --remote --yes --json --command "select count(*) n from $1" 2>/dev/null | grep -o '"n": [0-9]*' | grep -o '[0-9]*'; }
for t in $PRIMERO $RESTO $ULTIMA; do
  [ -f data/$S/sql/$t.sql ] || { echo "$(date -u +%T) $t SIN SQL"; continue; }
  e=$(esperado $t); r=$(remoto $t)
  if [[ "$r" == "$e" ]]; then echo "$(date -u +%T) $t ya cargada ($r)"; continue; fi
  if [[ "$r" != "0" ]]; then echo "$(date -u +%T) $t PARCIAL ($r de $e) — detener y revisar"; exit 1; fi
  rm -rf /tmp/trozos-$S-$t; mkdir -p /tmp/trozos-$S-$t
  python3 - "$S" "$t" <<'PY'
import sys,pathlib
s,t=sys.argv[1],sys.argv[2]; src=pathlib.Path(f'data/{s}/sql/{t}.sql').read_text(encoding='utf-8')
partes=src.split(';\n'); buf=[]; tam=0; k=0
def vaciar():
    global buf,tam,k
    if buf: pathlib.Path(f'/tmp/trozos-{s}-{t}/{k:04d}.sql').write_text(';\n'.join(buf)+';\n',encoding='utf-8'); k+=1; buf=[]; tam=0
for st in partes:
    if not st.strip(): continue
    buf.append(st); tam+=len(st)
    if tam>8_000_000: vaciar()
vaciar()
PY
  out=""
  for f in /tmp/trozos-$S-$t/*.sql; do
    o=$(npx wrangler d1 execute $DB --remote --yes --file "$f" 2>&1 | grep -iE 'error|✘' | tail -1)
    [ -n "$o" ] && { out="$o en $(basename $f)"; break; }
  done
  r2=$(remoto $t); echo "$(date -u +%T) $t ${out:-ok} → remoto $r2 / esperado $e"
  rm -rf /tmp/trozos-$S-$t
done
echo "$(date -u +%T) FIN"

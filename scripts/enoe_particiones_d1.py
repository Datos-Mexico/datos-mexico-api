"""Carga en D1 (datosmexico-api-enoe) el índice de particiones de microdatos y el esquema por tabla, a partir de
data/enoe/particiones/manifiesto.jsonl y columnas.json (scripts/enoe_particiones_r2.py). Verifica al final que el
conteo remoto coincida con el manifiesto y que la suma de filas sea la del origen (data/enoe/microdatos/manifiesto.jsonl).
Uso: data/.venv/bin/python scripts/enoe_particiones_d1.py
"""
import json, pathlib, subprocess, sys, tempfile
RAIZ = pathlib.Path(__file__).resolve().parent.parent; BASE = RAIZ / 'data/enoe/particiones'; DB = 'datosmexico-api-enoe'
def q(v): return "'" + str(v).replace("'", "''") + "'"
def ejecutar(sql):
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f: f.write(sql); ruta = f.name
    r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes', '--file', ruta], cwd=RAIZ, capture_output=True, text=True)
    if r.returncode: sys.exit(f'wrangler falló: {(r.stdout + r.stderr)[-500:]}')
def consulta(sql):
    r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes', '--json', '--command', sql], cwd=RAIZ, capture_output=True, text=True)
    return json.loads(r.stdout)[0]['results']
parts = [json.loads(l) for l in open(BASE / 'manifiesto.jsonl') if l.strip()]
columnas = json.loads((BASE / 'columnas.json').read_text())
origen = [json.loads(l) for l in open(RAIZ / 'data/enoe/microdatos/manifiesto.jsonl') if l.strip()]
esperado_filas = sum(r['filas'] for r in origen if r.get('ok')); esperado_trim = sum(1 for r in origen if r.get('ok'))
assert len({(p['tabla'], p['periodo']) for p in parts}) == esperado_trim, 'faltan trimestres en el manifiesto de particiones'
assert sum(p['filas'] for p in parts) == esperado_filas, 'la suma de filas de las particiones no es la del origen'
ddl = (RAIZ / 'data/enoe/schema.sqlite.sql').read_text().split('-- Índice de las particiones')[1]
ddl = ddl[ddl.index('CREATE TABLE'):]
ejecutar(ddl + '\nDELETE FROM microdatos_particiones;\nDELETE FROM microdatos_columnas;\n')
lote = []
for p in parts: lote.append(f"INSERT INTO microdatos_particiones VALUES ({q(p['tabla'])},{q(p['periodo'])},{q(p['ent'])},{p['filas']},{p['grupos']},{p['bytes']},{q(p['clave'])});")
for tabla, cols in columnas.items():
    for i, (nombre, tipo, nullable) in enumerate(cols): lote.append(f"INSERT INTO microdatos_columnas VALUES ({q(tabla)},{i},{q(nombre)},{q(tipo)},{1 if nullable else 0});")
for i in range(0, len(lote), 3000): ejecutar('\n'.join(lote[i:i + 3000]) + '\n'); print(f'{min(i + 3000, len(lote))}/{len(lote)} sentencias', flush=True)
r = consulta('SELECT count(*) n, sum(filas) filas, count(DISTINCT tabla || periodo) trimestres FROM microdatos_particiones')[0]
c = consulta('SELECT count(*) n FROM microdatos_columnas')[0]
print('remoto:', r, 'columnas', c['n'])
assert r['n'] == len(parts) and r['filas'] == esperado_filas and r['trimestres'] == esperado_trim and c['n'] == sum(len(v) for v in columnas.values()), 'la verificación remota no coincide'
print('VERIFICADO: particiones', r['n'], 'filas', r['filas'], 'trimestres', r['trimestres'])

"""Columna `busqueda` del catálogo de indicadores del Banco de Indicadores (D1 datosmexico-api-bise): texto normalizado
(sin acentos, minúsculas) con la descripción del indicador, su ruta temática, su tema y su unidad, para que la API busque
con LIKE sin distinguir acentos y con sinónimos (src/lib/busqueda.ts). Se calcula aquí, no en D1 (SQLite no quita acentos).
Verifica al final que todos los indicadores tengan la columna llena.
Uso: data/.venv/bin/python scripts/bise_busqueda_d1.py
"""
import csv, json, pathlib, subprocess, sys, tempfile, time, unicodedata
RAIZ = pathlib.Path(__file__).resolve().parent.parent; DB = 'datosmexico-api-bise'
def sa(s): return ' '.join(''.join(c for c in unicodedata.normalize('NFKD', s or '') if not unicodedata.combining(c)).lower().split())
def q(v): return "'" + str(v).replace("'", "''") + "'"
def d1(sql, archivo=True):
    if archivo:
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f: f.write(sql); ruta = f.name
    for intento in range(4):
        args = ['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes'] + (['--file', ruta] if archivo else ['--json', '--command', sql])
        r = subprocess.run(args, cwd=RAIZ, capture_output=True, text=True)
        if r.returncode == 0: return None if archivo else json.loads(r.stdout)[0]['results']
        print('wrangler falló', (r.stdout + r.stderr)[-200:]); time.sleep(20 * (intento + 1))
    sys.exit('wrangler falló cuatro veces')

temas = {r['tema']: r for r in csv.DictReader(open(RAIZ / 'data/bise/arbol/temas.csv'))}
def ruta(t):
    out = []
    while t: out.append(temas[t]['nombre']); t = temas[t]['tema_superior']
    return ' > '.join(reversed(out))
hoja = {}
for r in csv.DictReader(open(RAIZ / 'data/bise/arbol/indicador_temas.csv')): hoja.setdefault(r['indicador'], r['tema'])
cat_t = {r['clave']: r['descripcion'] for r in csv.DictReader(open(RAIZ / 'data/bise/neon-export/temas.csv'))}
cat_u = {r['clave']: r['descripcion'] for r in csv.DictReader(open(RAIZ / 'data/bise/neon-export/unidades.csv'))}
inds = list(csv.DictReader(open(RAIZ / 'data/bise/neon-export/indicadores.csv')))
cols = {r['name'] for r in d1('PRAGMA table_info(indicadores)', archivo=False)}
if 'busqueda' not in cols: d1('ALTER TABLE indicadores ADD COLUMN busqueda TEXT;')
lote = []
for r in inds:
    texto = sa(' | '.join(x for x in [r['descripcion'], ruta(hoja[r['id']]) if r['id'] in hoja else '', cat_t.get(r['tema'], ''), cat_u.get(r['unidad'], '')] if x))
    lote.append(f"UPDATE indicadores SET busqueda = {q(texto)} WHERE id = {q(r['id'])};")
for i in range(0, len(lote), 3000): d1('\n'.join(lote[i:i + 3000]) + '\n'); print(f'{min(i + 3000, len(lote))}/{len(lote)}', flush=True)
r = d1("SELECT COUNT(*) n, SUM(busqueda IS NULL OR busqueda = '') vacios FROM indicadores", archivo=False)[0]; print(r)
assert r['vacios'] == 0
d1('CREATE INDEX IF NOT EXISTS idx_indicadores_busqueda ON indicadores (busqueda);')
print('ok')

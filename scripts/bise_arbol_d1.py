"""Carga en D1 (datosmexico-api-bise) el árbol temático del Banco de Indicadores (scripts/bise_arbol.py) y escribe en
`indicadores` la ruta temática de cada indicador.

Tablas:
- arbol_temas (tema, nombre, tema_superior, orden, nivel, url_tema): los 182 temas del árbol (raíz → hojas).
- indicador_temas (indicador, tema, orden, origen): cada indicador con datos y el tema hoja donde el INEGI lo muestra
  (6 indicadores cuelgan de dos temas; se conservan ambos).
- indicadores.ruta / tema_arbol / orden_arbol: la ruta legible ("Demografía y Sociedad › Población › Población"), el
  tema hoja principal (el primero por orden del árbol) y la posición del indicador dentro de ese tema.
Verifica al final: conteos remotos = archivos locales; ningún indicador con datos sin ruta.
Uso: data/.venv/bin/python scripts/bise_arbol_d1.py
"""
import csv, json, pathlib, subprocess, sys, tempfile
RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data/bise/arbol'; DB = 'datosmexico-api-bise'
def q(v): return 'NULL' if v is None or v == '' else "'" + str(v).replace("'", "''") + "'"
def n(v): return 'NULL' if v is None or v == '' else str(int(v))
def ejecutar(sql):
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f: f.write(sql); ruta = f.name
    r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes', '--file', ruta], cwd=RAIZ, capture_output=True, text=True)
    if r.returncode: sys.exit(f'wrangler falló: {(r.stdout + r.stderr)[-600:]}')
def consulta(sql):
    r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes', '--json', '--command', sql], cwd=RAIZ, capture_output=True, text=True)
    return json.loads(r.stdout)[0]['results']

temas = {r['tema']: r for r in csv.DictReader(open(DIR / 'temas.csv'))}
rel = list(csv.DictReader(open(DIR / 'indicador_temas.csv')))
def ruta(t):
    partes = []
    while t: partes.append(temas[t]['nombre']); t = temas[t]['tema_superior']
    return ' › '.join(reversed(partes))

ddl = """
CREATE TABLE IF NOT EXISTS arbol_temas (tema TEXT PRIMARY KEY, nombre TEXT NOT NULL, tema_superior TEXT, orden INTEGER, nivel INTEGER NOT NULL, url_tema TEXT);
CREATE TABLE IF NOT EXISTS indicador_temas (indicador TEXT NOT NULL, tema TEXT NOT NULL, orden INTEGER, origen TEXT NOT NULL, PRIMARY KEY (indicador, tema));
CREATE INDEX IF NOT EXISTS idx_indicador_temas_tema ON indicador_temas (tema, orden);
DELETE FROM arbol_temas; DELETE FROM indicador_temas;
"""
cols = {r['name'] for r in consulta('PRAGMA table_info(indicadores)')}
for c, t in (('ruta', 'TEXT'), ('tema_arbol', 'TEXT'), ('orden_arbol', 'INTEGER')):
    if c not in cols: ddl += f'ALTER TABLE indicadores ADD COLUMN {c} {t};\n'
ejecutar(ddl)
lote = [f"INSERT INTO arbol_temas VALUES ({q(t['tema'])},{q(t['nombre'])},{q(t['tema_superior'])},{n(t['orden'])},{n(t['nivel'])},{q(t['url_tema'])});" for t in temas.values()]
lote += [f"INSERT INTO indicador_temas VALUES ({q(r['indicador'])},{q(r['tema'])},{n(r['orden'])},{q(r['origen'])});" for r in rel]
principal = {}
for r in sorted(rel, key=lambda r: (r['indicador'], r['origen'] != 'arbol', int(r['orden'] or 10**9), r['tema'])):
    principal.setdefault(r['indicador'], r)
lote += [f"UPDATE indicadores SET ruta = {q(ruta(r['tema']))}, tema_arbol = {q(r['tema'])}, orden_arbol = {n(r['orden'])} WHERE id = {q(i)};" for i, r in principal.items()]
for i in range(0, len(lote), 2500): ejecutar('\n'.join(lote[i:i + 2500]) + '\n'); print(f'{min(i + 2500, len(lote))}/{len(lote)} sentencias', flush=True)
r = consulta('SELECT (SELECT COUNT(*) FROM arbol_temas) t, (SELECT COUNT(*) FROM indicador_temas) r, (SELECT COUNT(*) FROM indicadores WHERE con_datos = 1 AND ruta IS NULL) sin_ruta, (SELECT COUNT(*) FROM indicadores WHERE ruta IS NOT NULL) con_ruta')[0]
print(r)
assert r['t'] == len(temas) and r['r'] == len(rel) and r['sin_ruta'] == 0 and r['con_ruta'] == len(principal), 'la verificación remota no cuadra'
print('ok')

"""Carga en la D1 datosmexico-api-unam el dataset del Concurso de Selección de la UNAM (repositorio datos-mexico-unam,
data/processed, licencia CC BY 4.0) y sube los CSV, el diccionario y la licencia a R2 (unam/concurso/<archivo>).

Tipado: una columna es INTEGER si todos sus valores no vacíos son enteros, REAL si son números, TEXT en otro caso; las
columnas de códigos, folios, huellas y marcas de captura se fuerzan a TEXT para conservar ceros a la izquierda. Vacío → NULL.
Verifica en remoto el conteo de cada tabla contra el CSV y registra bytes y SHA-256 de cada archivo en la tabla `archivos`.
Uso: data/.venv/bin/python scripts/unam_concurso_d1.py [--ddl] [--local] [ruta_processed]
"""
import csv, hashlib, json, pathlib, re, sqlite3, subprocess, sys, tempfile, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import inegi_ingesta as ing
RAIZ = pathlib.Path(__file__).resolve().parent.parent; BASE = RAIZ / 'data/unam'; BASE.mkdir(exist_ok=True); DB = 'datosmexico-api-unam'
ORIGEN = pathlib.Path([a for a in sys.argv[1:] if not a.startswith('--')][0]) if [a for a in sys.argv[1:] if not a.startswith('--')] else RAIZ.parent / 'datos-mexico-unam' / 'data' / 'processed'
LOCAL = '--local' in sys.argv
TABLAS = ['encabezados', 'distribucion', 'universo', 'cobertura', 'proceso', 'demanda_licenciatura', 'identidad_doble', 'cola_baja', 'sesgo_cobertura', 'sesgo_demanda', 'paginas', 'intentos_acceso', 'cronologia_2026', 'cronologia_terceros', 'carreras_identidad', 'avisos', 'proceso_2026']
DOCS = ['DICCIONARIO.md', 'LICENCIA.md']
TEXTO = {'carrera_codigo', 'captura', 'captura_indice', 'folio', 'sha256', 'sha256_fuentes', 'sha256_derivados', 'ciclo', 'raiz', 'sufijo', 'valor', 'fragmento', 'archivo', 'archivos', 'url', 'url_listado', 'indice'}
ENTERO = re.compile(r'-?\d+'); NUMERO = re.compile(r'-?\d+(\.\d+)?([eE][-+]?\d+)?')
csv.field_size_limit(1 << 30)
def q(v): return "'" + v.replace("'", "''") + "'"
con_local = sqlite3.connect(BASE / 'local.sqlite') if LOCAL else None
def ejecutar_sql(sql):
    if LOCAL: con_local.executescript(sql); con_local.commit(); return
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f: f.write(sql); ruta = f.name
    r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes', '--file', ruta], cwd=RAIZ, capture_output=True, text=True)
    if r.returncode: sys.exit(f'wrangler falló: {(r.stdout + r.stderr)[-500:]}')
    pathlib.Path(ruta).unlink()
def consulta(sql):
    if LOCAL:
        cur = con_local.execute(sql); cols = [d[0] for d in cur.description]; return [dict(zip(cols, r)) for r in cur.fetchall()]
    r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes', '--json', '--command', sql], cwd=RAIZ, capture_output=True, text=True)
    if r.returncode: sys.exit(f'consulta falló: {(r.stdout + r.stderr)[-400:]}')
    return json.loads(r.stdout)[0]['results']
def leer(tabla):
    with open(ORIGEN / f'{tabla}.csv', newline='', encoding='utf-8') as f:
        r = csv.reader(f); cab = next(r); filas = [row for row in r]
    for row in filas: assert len(row) == len(cab), f'{tabla}: fila con {len(row)} campos, cabecera {len(cab)}'
    return cab, filas
def tipo(col, valores):
    if col in TEXTO: return 'TEXT'
    v = [x for x in valores if x != '']
    if not v: return 'TEXT'
    if all(ENTERO.fullmatch(x) for x in v): return 'INTEGER'
    if all(NUMERO.fullmatch(x) for x in v): return 'REAL'
    return 'TEXT'
def lit(v, t):
    if v == '': return 'NULL'
    return v if t in ('INTEGER', 'REAL') else q(v)
def main():
    ddl = ['-- Concurso de Selección de la UNAM: dataset del observatorio (datos-mexico-unam/data/processed, CC BY 4.0). Una tabla por CSV, columnas tal cual.',
           'CREATE TABLE IF NOT EXISTS archivos (archivo TEXT PRIMARY KEY, tabla TEXT, filas INTEGER, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, clave_r2 TEXT NOT NULL, glosa TEXT, cargado_en TEXT NOT NULL);']
    esquema = {}
    for t in TABLAS:
        cab, filas = leer(t); tipos = {c: tipo(c, [row[i] for row in filas]) for i, c in enumerate(cab)}; esquema[t] = (cab, tipos, filas)
        ddl.append(f'CREATE TABLE IF NOT EXISTS {t} (\n' + ',\n'.join(f'  {c} {tipos[c]}' for c in cab) + '\n);')
    (BASE / 'schema.sqlite.sql').write_text('\n'.join(ddl) + '\n', encoding='utf-8')
    if '--ddl' in sys.argv or LOCAL: ejecutar_sql('\n'.join(ddl) + '\n'); print('DDL ejecutado', flush=True)
    registros = []
    for t in TABLAS:
        cab, tipos, filas = esquema[t]
        r = consulta(f'SELECT count(*) n FROM {t}')[0]
        if r['n'] != len(filas):
            if r['n']: ejecutar_sql(f'DELETE FROM {t};')
            sent = []; buf = []; tam = 0
            for row in filas:
                v = '(' + ','.join(lit(x, tipos[c]) for c, x in zip(cab, row)) + ')'; buf.append(v); tam += len(v)
                if tam > 90_000: sent.append(f'INSERT INTO {t} VALUES ' + ',\n'.join(buf) + ';\n'); buf = []; tam = 0
            if buf: sent.append(f'INSERT INTO {t} VALUES ' + ',\n'.join(buf) + ';\n')
            trozo = []; tam = 0
            for s in sent:
                trozo.append(s); tam += len(s)
                if tam > 7_500_000: ejecutar_sql(''.join(trozo)); trozo = []; tam = 0
            if trozo: ejecutar_sql(''.join(trozo))
            r = consulta(f'SELECT count(*) n FROM {t}')[0]
            assert r['n'] == len(filas), f'{t}: remoto {r["n"]} ≠ csv {len(filas)}'
        print(f'{t}: {r["n"]} filas VERIFICADO', flush=True)
        ruta = ORIGEN / f'{t}.csv'; registros.append((f'{t}.csv', t, len(filas), ruta))
    for d in DOCS: registros.append((d, None, None, ORIGEN / d))
    valores = []
    for archivo, t, n, ruta in registros:
        clave = f'unam/concurso/{archivo}'; ing.subir(clave, str(ruta), 'text/csv; charset=utf-8' if archivo.endswith('.csv') else 'text/markdown; charset=utf-8')
        sha = hashlib.sha256(ruta.read_bytes()).hexdigest()
        valores.append(f"({q(archivo)},{q(t) if t else 'NULL'},{n if n is not None else 'NULL'},{ruta.stat().st_size},{q(sha)},{q(clave)},NULL,{q(time.strftime('%Y-%m-%dT%H:%M:%S'))})")
    ejecutar_sql('DELETE FROM archivos;\nINSERT INTO archivos VALUES ' + ',\n'.join(valores) + ';\n')
    json.dump([{'archivo': a, 'tabla': t, 'filas': n, 'bytes': r.stat().st_size, 'sha256': hashlib.sha256(r.read_bytes()).hexdigest()} for a, t, n, r in registros], open(BASE / 'manifiesto.json', 'w'), ensure_ascii=False, indent=1)
    print(f'archivos: {len(valores)} subidos a R2 y registrados', flush=True)
if __name__ == '__main__': main()

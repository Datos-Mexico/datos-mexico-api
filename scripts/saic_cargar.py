"""SAIC / Censos Económicos 2004-2024 → R2 y D1 (exclusión 7 del traspaso).
Fuente de los datos desde el 2026-09-21: los «datos abiertos» de los Censos Económicos (scripts/ce_datos_abiertos.py: 33 CSV por
edición con el cuadro completo entidad × municipio × actividad × estrato y las 98 variables; el mismo contenido que sirve el SAIC,
verificado celda por celda contra lo descargado por su API, que queda como muestra de verificación en data/saic/crudo).
Entrada: data/saic/parquet/saic_<año>.parquet (una fila por año, cve_ent, cve_mun, nivel de actividad, clave, estrato; 98 variables double;
nulo = el INEGI no publica el dato por confidencialidad o no aplica) y su .json (fuente, archivos, filas, valores).
  --parquet  (solo si no existe el Parquet del año) lo construye desde el crudo del SAIC; normalmente lo escribe ce_datos_abiertos.py.
  --subir    R2 saic/saic_<año>.parquet.
  --cargar   D1 datosmexico-api-censo2020: catálogos (saic_variables, saic_actividades, saic_estratos, saic_entidades), saic_anios (por
             año: filas, valores, fuente, completo) y los hechos en tres tablas: saic_a / saic_b (llaves + 49 variables cada una; D1
             admite ≤ 100 columnas) para el nacional y las 32 entidades en todos los niveles y estratos, y saic_mun (llaves + las 9
             variables del cubo: UE, H001A, J000A, A111A, A131A, A221A, Q000A, M000A, K000A) para los ~1.8 M de filas municipales por
             censo; las 98 variables municipales están en el Parquet (/api/v1/inegi/saic/descarga/{año}). Reanudable por año y tabla.
Verificación: (1) ce_datos_abiertos.py --verificar: cada celda del SAIC = Parquet; (2) scripts/verificar_cubos.py: unidades económicas
nacionales = indicador 5300000001 del Banco de Indicadores, entidades suman el nacional, municipios suman la entidad por sector.
Uso: data/.venv/bin/python scripts/saic_cargar.py --subir --cargar [--anios 2023,2018]
"""
import argparse, glob, gzip, json, os, pathlib, re, subprocess, sys, tempfile, time, collections as C
RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data' / 'saic'; CRUDO = DIR / 'crudo'; PARQ = DIR / 'parquet'; CAT = json.loads((DIR / 'catalogos.json').read_text())
DB = 'datosmexico-api-censo2020'
VARS = ['UE'] + [v['clave'] for v in CAT['variables'] if v['clave'] != 'UE']
NOMBRE_VAR = {'UE': 'Unidades económicas'}; NOMBRE_VAR.update({v['clave']: v['nombre'] for v in CAT['variables']})
ESTRATO = {e['name']: int(e['key']) for e in CAT['estratos']}
NIVEL_ACT = {a['clave']: a['nivel'] for a in CAT['arbol']}
def log(m):
    with open(DIR / 'saic.log', 'a') as f: f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {m}\n")
    print(m, flush=True)

def fila_de(r, ambito, nivel):
    ent = r['enti'][:2]; mun = r.get('muni', '')[:3] if r.get('muni') else None
    if ambito == '00': ent, mun = '00', None
    elif ambito == 'ent': mun = None
    act = r['actividad'].strip()
    if nivel == 0: clave_act = '0'
    else:
        clave_act = act.split(' ', 1)[0]
        if clave_act not in NIVEL_ACT or NIVEL_ACT[clave_act] != nivel: raise ValueError(f'actividad fuera del nivel {nivel}: {act[:60]!r}')
    est = ESTRATO[r['estrato']] if 'estrato' in r else 0
    z = r['zxc'][0] if r['zxc'] else {}
    vals = {}
    for k, v in z.items():
        clave = k.split('|', 1)[0]
        vals[clave] = None if v in (None, '', 'NA', 'N/A', 'NC') else float(v)
    return (r['anio'], ent, mun, nivel, clave_act, est), vals

def parquet(anios):
    import pyarrow as pa, pyarrow.parquet as pq
    PARQ.mkdir(exist_ok=True); manif = {json.loads(l)['clave']: json.loads(l) for l in open(DIR / 'manifiesto.jsonl') if l.strip()}
    for anio in anios:
        salida = PARQ / f'saic_{anio}.parquet'
        if salida.exists(): log(f'{anio}: ya existe {salida.name}'); continue
        llaves = {}; n = 0; dup = 0; t0 = time.time()
        for amb in sorted(os.listdir(CRUDO / anio)):
            for f in sorted((CRUDO / anio / amb).glob('*.json.gz')):
                nivel = int(f.name.split('-')[0]); clave_m = f'{anio}/{amb}/{nivel}'
                if clave_m not in manif: continue
                for r in json.load(gzip.open(f, 'rt', encoding='utf-8')):
                    k, vals = fila_de(r, amb, nivel)
                    if k in llaves: dup += 1; continue
                    llaves[k] = vals; n += 1
        esperadas = sum(m['filas'] for c, m in manif.items() if c.startswith(anio + '/'))
        cols = {'anio': [], 'cve_ent': [], 'cve_mun': [], 'nivel_act': [], 'clave_act': [], 'estrato': []}
        for v in VARS: cols[v] = []
        for k in sorted(llaves, key=lambda x: (x[1], x[2] or '', x[3], x[4], x[5])):
            vals = llaves[k]
            for c, val in zip(('anio', 'cve_ent', 'cve_mun', 'nivel_act', 'clave_act', 'estrato'), k): cols[c].append(val)
            for v in VARS: cols[v].append(vals.get(v))
        t = pa.table({**{c: pa.array(cols[c], pa.string() if c in ('anio', 'cve_ent', 'cve_mun', 'clave_act') else pa.int16()) for c in ('anio', 'cve_ent', 'cve_mun', 'nivel_act', 'clave_act', 'estrato')}, **{v: pa.array(cols[v], pa.float64()) for v in VARS}})
        pq.write_table(t, salida.with_suffix('.tmp'), compression='zstd'); salida.with_suffix('.tmp').rename(salida)
        no_nulos = sum(sum(1 for x in cols[v] if x is not None) for v in VARS)
        log(f'{anio}: {n:,} filas ({esperadas:,} en el manifiesto, {dup} repetidas), {no_nulos:,} valores no nulos, {salida.stat().st_size / 1048576:.1f} MB, {time.time() - t0:.0f} s')
        (PARQ / f'saic_{anio}.json').write_text(json.dumps({'anio': anio, 'filas': n, 'esperadas': esperadas + 0, 'repetidas': dup, 'valores': no_nulos, 'bytes': salida.stat().st_size}))


def subir(anios):
    sys.path.insert(0, str(RAIZ / 'scripts')); import inegi_ingesta as ing
    for anio in anios:
        ruta = PARQ / f'saic_{anio}.parquet'; clave = f'saic/saic_{anio}.parquet'; meta = json.loads((PARQ / f'saic_{anio}.json').read_text())
        if meta.get('clave_r2') == clave and meta.get('bytes_r2') == ruta.stat().st_size: log(f'{anio}: ya en R2'); continue
        ing.subir(clave, str(ruta), 'application/vnd.apache.parquet'); meta['clave_r2'] = clave; meta['bytes_r2'] = ruta.stat().st_size
        (PARQ / f'saic_{anio}.json').write_text(json.dumps(meta)); log(f'{anio}: {ruta.stat().st_size / 1048576:.1f} MB en {clave}')

def d1(sql, archivo=True):
    for intento in range(4):
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, dir=str(DIR)) as f: f.write(sql); ruta = f.name
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes'] + (['--file', ruta] if archivo else ['--json', '--command', sql]), capture_output=True, text=True, cwd=RAIZ); os.unlink(ruta)
        if r.returncode == 0: return None if archivo else json.loads(r.stdout)[0]['results']
        log(f'wrangler falló (intento {intento + 1}): {(r.stdout + r.stderr)[-300:].strip()}'); time.sleep(20 * (intento + 1))
    sys.exit('wrangler falló cuatro veces')
def q(v): return 'NULL' if v is None else (str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'")
LLAVES = ['anio', 'cve_ent', 'cve_mun', 'nivel_act', 'clave_act', 'estrato']
VA, VB = VARS[:49], VARS[49:]  # dos tablas anchas: D1 admite ≤ 100 columnas por tabla
VM = ['UE', 'H001A', 'J000A', 'A111A', 'A131A', 'A221A', 'Q000A', 'M000A', 'K000A']  # variables del cubo, únicas en D1 para los municipios
def ddl():
    k = "anio TEXT NOT NULL, cve_ent TEXT NOT NULL, cve_mun TEXT NOT NULL, nivel_act INTEGER NOT NULL, clave_act TEXT NOT NULL, estrato INTEGER NOT NULL"
    pk = "PRIMARY KEY (anio, nivel_act, cve_ent, cve_mun, clave_act, estrato)"
    return (f"CREATE TABLE IF NOT EXISTS saic_a ({k}, {', '.join(v + ' REAL' for v in VA)}, {pk}) WITHOUT ROWID;\n"
            f"CREATE TABLE IF NOT EXISTS saic_b ({k}, {', '.join(v + ' REAL' for v in VB)}, {pk}) WITHOUT ROWID;\n"
            "CREATE TABLE IF NOT EXISTS saic_variables (clave TEXT PRIMARY KEY, nombre TEXT NOT NULL, grupo TEXT NOT NULL, grupo_nombre TEXT NOT NULL, definicion TEXT, tabla TEXT NOT NULL, orden INTEGER NOT NULL) WITHOUT ROWID;\n"
            "CREATE TABLE IF NOT EXISTS saic_actividades (clave TEXT PRIMARY KEY, nombre TEXT NOT NULL, nivel INTEGER NOT NULL, padre TEXT) WITHOUT ROWID;\n"
            "CREATE TABLE IF NOT EXISTS saic_estratos (cod INTEGER PRIMARY KEY, nombre TEXT NOT NULL) WITHOUT ROWID;\n"
            "CREATE TABLE IF NOT EXISTS saic_entidades (cve_ent TEXT PRIMARY KEY, nombre TEXT NOT NULL) WITHOUT ROWID;\n"
            "CREATE TABLE IF NOT EXISTS saic_anios (anio TEXT PRIMARY KEY, censo TEXT NOT NULL, filas INTEGER NOT NULL, valores INTEGER NOT NULL, clave_parquet TEXT, bytes_parquet INTEGER, tareas INTEGER NOT NULL, completo INTEGER NOT NULL) WITHOUT ROWID;\n"
            f"CREATE TABLE IF NOT EXISTS saic_mun ({k}, {', '.join(v + ' REAL' for v in VM)}, {pk}) WITHOUT ROWID;\n")

def cargar(anios):
    import pyarrow.parquet as pq
    c = CAT; d1(ddl())
    cols_anios = {r['name'] for r in d1('PRAGMA table_info(saic_anios)', archivo=False)}
    for col, tipo in (('fuente', 'TEXT'), ('filas_mun', 'INTEGER'), ('archivos', 'INTEGER')):
        if col not in cols_anios: d1(f'ALTER TABLE saic_anios ADD COLUMN {col} {tipo};')
    d1('DELETE FROM saic_variables; DELETE FROM saic_actividades; DELETE FROM saic_estratos;\n' + '\n'.join(f"INSERT INTO saic_variables VALUES ({q(v)}, {q(NOMBRE_VAR[v])}, {q(next((x['grupo'] for x in c['variables'] if x['clave'] == v), 'UE'))}, {q(next((x['grupo_nombre'] for x in c['variables'] if x['clave'] == v), 'Unidades económicas'))}, {q(next((x.get('definicion') for x in c['variables'] if x['clave'] == v), None))}, {q('a' if v in VA else 'b')}, {i});" for i, v in enumerate(VARS))
       + '\n' + '\n'.join(f"INSERT INTO saic_actividades VALUES ({q(a['clave'])}, {q(a['nombre'])}, {a['nivel']}, {q(a['padre'])});" for a in c['arbol']) + f"\nINSERT INTO saic_actividades VALUES ('0', 'Total', 0, NULL);\n"
       + '\n'.join(f"INSERT INTO saic_estratos VALUES ({int(e['key'])}, {q(e['name'])});" for e in c['estratos'])
       + "\nDELETE FROM saic_entidades; INSERT INTO saic_entidades VALUES ('00', 'Estados Unidos Mexicanos');\n" + '\n'.join(f"INSERT INTO saic_entidades VALUES ({q(e['key'])}, {q(e['name'])});" for e in c['entidades']))
    manif = [json.loads(l) for l in open(DIR / 'manifiesto.jsonl') if l.strip()] if (DIR / 'manifiesto.jsonl').exists() else []
    sys.path.insert(0, str(RAIZ / 'scripts')); import saic_descarga as sd; total_tareas = len(list(sd.tareas(c)))
    def lote_insert(tabla, cols, filas, por=200):
        d1(f"DELETE FROM {tabla} WHERE anio = '{anio}';"); lote = []; tam = 0
        for i in range(0, len(filas), por):
            st = f"INSERT INTO {tabla} ({', '.join(cols)}) VALUES " + ','.join('(' + ','.join(q(r[cc] if cc != 'cve_mun' else (r[cc] or '')) for cc in cols) + ')' for r in filas[i:i + por]) + ';\n'
            lote.append(st); tam += len(st)
            if tam > 7_000_000: d1(''.join(lote)); lote = []; tam = 0
        if lote: d1(''.join(lote))
    for anio in anios:
        t = pq.read_table(PARQ / f'saic_{anio}.parquet'); meta = json.loads((PARQ / f'saic_{anio}.json').read_text()); filas = t.to_pylist()
        nac_ent = [r for r in filas if r['cve_mun'] is None]; mun = [r for r in filas if r['cve_mun'] is not None]
        for tabla, vs, subconjunto in (('saic_a', VA, nac_ent), ('saic_b', VB, nac_ent), ('saic_mun', VM, mun)):
            cols = LLAVES + vs
            if d1(f"SELECT COUNT(*) n FROM {tabla} WHERE anio = '{anio}'", archivo=False)[0]['n'] == len(subconjunto): log(f'{anio} {tabla}: ya cargada ({len(subconjunto):,})'); continue
            lote_insert(tabla, cols, subconjunto, 200 if tabla != 'saic_mun' else 400)
            n = d1(f"SELECT COUNT(*) n FROM {tabla} WHERE anio = '{anio}'", archivo=False)[0]['n']
            if n != len(subconjunto): sys.exit(f'{anio} {tabla}: {n} ≠ {len(subconjunto)}')
            log(f'{anio} {tabla}: {n:,} filas')
        fuente = meta.get('fuente', 'SAIC'); tareas_anio = sum(1 for m in manif if m['clave'].startswith(anio + '/'))
        completo = 1 if fuente == 'datos abiertos' else int(tareas_anio == total_tareas // len(c['anios']))
        d1(f"INSERT OR REPLACE INTO saic_anios (anio, censo, filas, valores, clave_parquet, bytes_parquet, tareas, completo, fuente, filas_mun, archivos) VALUES ({q(anio)}, {q('Censos Económicos ' + str(int(anio) + 1))}, {len(filas)}, {meta['valores']}, {q(meta.get('clave_r2'))}, {q(meta.get('bytes_r2'))}, {tareas_anio}, {completo}, {q(fuente)}, {len(mun)}, {len(meta.get('archivos', []))});")
        ue = d1(f"SELECT UE, H001A FROM saic_a WHERE anio = '{anio}' AND cve_ent = '00' AND nivel_act = 0 AND estrato = 0", archivo=False)
        log(f"{anio}: nacional UE {ue[0]['UE']:,.0f}, personal ocupado {ue[0]['H001A']:,.0f}; fuente {fuente}, {len(nac_ent):,} filas nacional+entidades, {len(mun):,} municipales ({'completo' if completo else 'parcial'})")

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--parquet', action='store_true'); ap.add_argument('--subir', action='store_true'); ap.add_argument('--cargar', action='store_true'); ap.add_argument('--anios', default=','.join(sorted(CAT['anios'], reverse=True))); a = ap.parse_args()
    if a.parquet: parquet(a.anios.split(','))
    if a.subir: subir(a.anios.split(','))
    if a.cargar: cargar(a.anios.split(','))

"""Carga el Anuario ANUIES (data/anuies/consulta/<ciclo>.jsonl, scripts/anuies_consulta.py) en la D1 datosmexico-api-anuies.

Por ciclo completo (meta.completo): genera INSERTs multifila en data/anuies/sql/<ciclo>/, los ejecuta con wrangler y verifica
en remoto que count(*) y sum(mat_total) del ciclo coincidan con el manifiesto. Un ciclo ya cargado con el conteo correcto se salta;
una carga parcial se borra y se repite. Al final (o con --instituciones) reconstruye la tabla `instituciones` a partir de los
jsonl completos y la tabla `columnas`.
Uso: python3 scripts/anuies_d1.py [--ddl] [--local] [--instituciones] [ciclo ...]   (sin ciclos: carga todos los completos y reconstruye instituciones, columnas y la anotación de Parquet)
  --ddl    ejecuta el esquema (idempotente)       --local  carga en data/anuies/local.sqlite en vez de D1 (prueba del esquema)
"""
import json, pathlib, re, sqlite3, subprocess, sys, tempfile, time, unicodedata
RAIZ = pathlib.Path(__file__).resolve().parent.parent; BASE = RAIZ / 'data/anuies'; DB = 'datosmexico-api-anuies'
COLS = json.loads((BASE / 'columnas.json').read_text())
DIMS_ANUIES = ['ENTIDAD', 'MUNICIPIO_CORREGIDO', 'SOSTENIMIENTO', 'ANUIES', 'CLASIFICACION', 'NOMBRE_INSTITUCION', 'NOMBRE_DE_ESCUELA_CAMPUS_FACULTAD', 'NIVEL', 'MODALIDAD', 'CAMPO_AMPLIO', 'CAMPO_ESPECIFICO', 'CAMPO_DETALLADO', 'CAMPO_UNITARIO', 'CARRERA']
CICLOS = [f'{a}-{a+1}' for a in range(2000, 2026)]
LOCAL = '--local' in sys.argv
def q(v): return 'NULL' if v is None else "'" + str(v).replace("'", "''") + "'"
def n(v):
    if v is None or v == '': return 'NULL'
    s = str(v)
    if not re.fullmatch(r'-?\d+', s): raise ValueError(f'valor no entero: {s!r}')
    return s
def clave(nombre):
    s = unicodedata.normalize('NFKD', nombre).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'-+', '-', ''.join(c if c.isalnum() else '-' for c in s)).strip('-')

con_local = sqlite3.connect(BASE / 'local.sqlite') if LOCAL else None
def ejecutar_sql(sql):
    if LOCAL: con_local.executescript(sql); con_local.commit(); return
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f: f.write(sql); ruta = f.name
    for intento in range(3):
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes', '--file', ruta], cwd=RAIZ, capture_output=True, text=True)
        if not r.returncode: pathlib.Path(ruta).unlink(); return
        print(f'  wrangler falló (intento {intento+1}): {(r.stdout + r.stderr)[-400:]}', flush=True); time.sleep(15)
    sys.exit('wrangler falló tres veces')
def consulta(sql):
    if LOCAL:
        cur = con_local.execute(sql); cols = [d[0] for d in cur.description]; return [dict(zip(cols, r)) for r in cur.fetchall()]
    r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes', '--json', '--command', sql], cwd=RAIZ, capture_output=True, text=True)
    if r.returncode: sys.exit(f'consulta falló: {(r.stdout + r.stderr)[-400:]}')
    return json.loads(r.stdout)[0]['results']

def filas_de(ciclo):
    with open(BASE / 'consulta' / f'{ciclo}.jsonl') as f:
        for linea in f:
            if linea.strip(): yield json.loads(linea)

def sentencias(ciclo):
    """INSERTs multifila (≤ 90 KB por sentencia) para programas, programas_edad y programas_procedencia."""
    meta = json.load(open(BASE / 'consulta' / f'{ciclo}.meta.json'))
    assert meta.get('completo') and meta['dims'] == DIMS_ANUIES, f'{ciclo}: manifiesto incompleto o dims distintas'
    claves = {c['key'] for c in meta['cols']}; conocidas = set(COLS['base'] + COLS['edad'] + COLS['procedencia'])
    if claves - conocidas: sys.exit(f'{ciclo}: columnas desconocidas {sorted(claves - conocidas)}')
    faltan = conocidas - claves
    if faltan: print(f'  {ciclo}: columnas ausentes en este ciclo (irán NULL): {len(faltan)}', flush=True)
    base_id = CICLOS.index(ciclo) * 1_000_000
    cab = {'programas': 'INSERT INTO programas VALUES ', 'programas_edad': 'INSERT INTO programas_edad VALUES ', 'programas_procedencia': 'INSERT INTO programas_procedencia VALUES '}
    buf = {t: [] for t in cab}; tam = {t: 0 for t in cab}; cuenta = {t: 0 for t in cab}; sumas = {'MAT_TOTAL': 0, 'NI': 0, 'E': 0, 'LO_REAL': 0, 'T': 0, 'SNI': 0}
    def vaciar(t):
        if buf[t]:
            yield cab[t] + ',\n'.join(buf[t]) + ';\n'; buf[t].clear(); tam[t] = 0
    for i, r in enumerate(filas_de(ciclo)):
        idv = base_id + i + 1
        for k in sumas:
            v = r.get(k)
            if v not in (None, ''): sumas[k] += int(v)
        d = [q(ciclo)] + [q(r[k]) if k != 'ANUIES' else n(r[k]) for k in DIMS_ANUIES[:6]] + [q(clave(r['NOMBRE_INSTITUCION']))] + [q(r[k]) for k in DIMS_ANUIES[6:]]
        fila = '(' + ','.join([str(idv)] + d + [n(r.get(k)) for k in COLS['base']]) + ')'
        buf['programas'].append(fila); tam['programas'] += len(fila); cuenta['programas'] += 1
        for t, lista in (('programas_edad', COLS['edad']), ('programas_procedencia', COLS['procedencia'])):
            vals = [r.get(k) for k in lista]
            if any(v not in (None, '', '0') for v in vals):
                fila = '(' + ','.join([str(idv)] + [n(v) for v in vals]) + ')'
                buf[t].append(fila); tam[t] += len(fila); cuenta[t] += 1
        for t in cab:
            if tam[t] > 40_000: yield from vaciar(t)
    for t in cab: yield from vaciar(t)
    yield ('__resumen__', cuenta, sumas, meta)

def cargar(ciclo):
    meta = json.load(open(BASE / 'consulta' / f'{ciclo}.meta.json'))
    r = consulta(f"SELECT count(*) n, coalesce(sum(mat_total),0) mat FROM programas WHERE ciclo='{ciclo}'")[0]
    if r['n'] == meta['filas'] and r['mat'] == meta['sumas_detalle']['MAT_TOTAL']:
        print(f'{ciclo}: ya cargado ({r["n"]} filas)', flush=True); return
    if r['n']:
        print(f'{ciclo}: carga parcial ({r["n"]} de {meta["filas"]}), se borra y repite', flush=True)
        ejecutar_sql(f"DELETE FROM programas_edad WHERE id IN (SELECT id FROM programas WHERE ciclo='{ciclo}'); DELETE FROM programas_procedencia WHERE id IN (SELECT id FROM programas WHERE ciclo='{ciclo}'); DELETE FROM programas WHERE ciclo='{ciclo}'; DELETE FROM ciclos WHERE ciclo='{ciclo}';")
    t0 = time.time(); trozo = []; tam = 0; k = 0; resumen = None
    for s in sentencias(ciclo):
        if isinstance(s, tuple): resumen = s; continue
        trozo.append(s); tam += len(s)
        if tam > 2_000_000: ejecutar_sql(''.join(trozo)); k += 1; trozo = []; tam = 0; print(f'  {ciclo}: trozo {k} ({time.time()-t0:.0f}s)', flush=True)
    if trozo: ejecutar_sql(''.join(trozo)); k += 1
    _, cuenta, sumas, meta = resumen
    assert cuenta['programas'] == meta['filas'] and sumas == meta['sumas_detalle'], f'{ciclo}: el jsonl no cuadra con su manifiesto'
    r = consulta(f"SELECT count(*) n, sum(mat_total) mat, sum(ni) ni, sum(e) e, sum(lo_real) lo, sum(t) t, sum(sni) sni, count(DISTINCT institucion_clave) inst FROM programas WHERE ciclo='{ciclo}'")[0]
    e = consulta(f"SELECT (SELECT count(*) FROM programas_edad WHERE id BETWEEN {CICLOS.index(ciclo)*1_000_000+1} AND {(CICLOS.index(ciclo)+1)*1_000_000}) edad, (SELECT count(*) FROM programas_procedencia WHERE id BETWEEN {CICLOS.index(ciclo)*1_000_000+1} AND {(CICLOS.index(ciclo)+1)*1_000_000}) proc")[0]
    ok = r['n'] == meta['filas'] and r['mat'] == sumas['MAT_TOTAL'] and r['ni'] == sumas['NI'] and r['e'] == sumas['E'] and r['lo'] == sumas['LO_REAL'] and r['t'] == sumas['T'] and r['sni'] == sumas['SNI'] and e['edad'] == cuenta['programas_edad'] and e['proc'] == cuenta['programas_procedencia']
    if not ok: sys.exit(f'{ciclo}: VERIFICACIÓN REMOTA FALLÓ remoto={r} {e} esperado={meta["filas"]} {sumas} {cuenta}')
    ejecutar_sql(f"INSERT OR REPLACE INTO ciclos (ciclo,filas,paginas,descargado_en,conciliacion,mat_total,ni,e,lo_real,t,sni,edad_filas,procedencia_filas,instituciones,sha256,bytes) VALUES ({q(ciclo)},{meta['filas']},{meta['paginas']},{q(meta['descargado_en'])},{q(meta['conciliacion'])},{sumas['MAT_TOTAL']},{sumas['NI']},{sumas['E']},{sumas['LO_REAL']},{sumas['T']},{sumas['SNI']},{cuenta['programas_edad']},{cuenta['programas_procedencia']},{r['inst']},{q(meta['sha256'])},{meta['bytes']});")
    print(f'{ciclo}: VERIFICADO {r["n"]} filas, matrícula {r["mat"]:,}, edad {e["edad"]}, procedencia {e["proc"]}, instituciones {r["inst"]} ({time.time()-t0:.0f}s, {k} trozos)', flush=True)

def instituciones():
    """Reconstruye `instituciones` desde los jsonl completos: nombre y clasificación del último ciclo, conteos y cifras del último ciclo."""
    inst = {}
    for ciclo in CICLOS:
        mp = BASE / 'consulta' / f'{ciclo}.meta.json'
        if not mp.exists() or not json.load(open(mp)).get('completo'): continue
        for r in filas_de(ciclo):
            k = clave(r['NOMBRE_INSTITUCION']); x = inst.setdefault(k, {'ciclos': set(), 'por_ciclo': {}})
            x['ciclos'].add(ciclo); y = x['por_ciclo'].setdefault(ciclo, {'nombre': r['NOMBRE_INSTITUCION'], 'sos': r['SOSTENIMIENTO'], 'clas': r['CLASIFICACION'], 'ent': set(), 'esc': set(), 'prog': 0, 'mat': 0, 'ni': 0, 'e': 0, 't': 0})
            y['ent'].add(r['ENTIDAD']); y['esc'].add(r['NOMBRE_DE_ESCUELA_CAMPUS_FACULTAD']); y['prog'] += 1
            for c, kk in (('mat', 'MAT_TOTAL'), ('ni', 'NI'), ('e', 'E'), ('t', 'T')): y[c] += int(r.get(kk) or 0)
    filas = []
    for k, x in inst.items():
        cs = sorted(x['ciclos']); u = x['por_ciclo'][cs[-1]]
        filas.append(f"({q(k)},{q(u['nombre'])},{q(u['sos'])},{q(u['clas'])},{q(cs[0])},{q(cs[-1])},{len(cs)},{len(u['ent'])},{len(u['esc'])},{u['prog']},{u['mat']},{u['ni']},{u['e']},{u['t']})")
    ejecutar_sql('DELETE FROM instituciones;\n' + ''.join('INSERT INTO instituciones VALUES ' + ',\n'.join(filas[i:i+300]) + ';\n' for i in range(0, len(filas), 300)))
    r = consulta('SELECT count(*) n FROM instituciones')[0]; assert r['n'] == len(filas)
    print(f'instituciones: {r["n"]} (VERIFICADO)', flush=True)

def columnas():
    titulos = {}
    for ciclo in CICLOS:
        mp = BASE / 'consulta' / f'{ciclo}.meta.json'
        if mp.exists():
            for c in json.load(open(mp)).get('cols', []): titulos[c['key']] = (c['title'], c['group'])
    filas = []
    for tabla, lista in (('programas', COLS['base']), ('programas_edad', COLS['edad']), ('programas_procedencia', COLS['procedencia'])):
        for k in lista:
            t, g = titulos.get(k, (k, '?')); filas.append(f"({q(k.lower())},{q(t)},{q(g)},{q(tabla)})")
    ejecutar_sql('DELETE FROM columnas;\nINSERT INTO columnas VALUES ' + ',\n'.join(filas) + ';\n')
    print(f'columnas: {len(filas)}', flush=True)

def parquet():
    """Anota en `ciclos` la clave y el tamaño del Parquet de cada ciclo (data/anuies/manifiesto.jsonl, scripts/anuies_parquet_r2.py)."""
    mp = BASE / 'manifiesto.jsonl'
    regs = [json.loads(l) for l in open(mp) if l.strip()] if mp.exists() else []
    if regs: ejecutar_sql(''.join(f"UPDATE ciclos SET parquet_clave={q(r['clave_r2'])}, parquet_bytes={r['bytes']} WHERE ciclo={q(r['ciclo'])} AND filas={r['filas']};\n" for r in regs))
    r = consulta('SELECT count(*) n FROM ciclos WHERE parquet_clave IS NOT NULL')[0]
    print(f'parquet anotado en {r["n"]} ciclos (manifiesto: {len(regs)})', flush=True)

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if '--ddl' in sys.argv: ejecutar_sql((BASE / 'schema.sqlite.sql').read_text()); print('DDL ejecutado', flush=True)
    ciclos = args or [c for c in CICLOS if (BASE / 'consulta' / f'{c}.meta.json').exists() and json.load(open(BASE / 'consulta' / f'{c}.meta.json')).get('completo')]
    for c in ciclos: cargar(c)
    if '--instituciones' in sys.argv or not args: instituciones(); columnas(); parquet()

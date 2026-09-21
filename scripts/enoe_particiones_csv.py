"""Microdatos de la ENOE 2025T2 en adelante para /api/v1/enoe/microdatos, desde los CSV oficiales del INEGI (descarga
masiva, ya en R2 como Parquet), proyectados al esquema del legado y particionados igual que scripts/enoe_particiones_r2.py.

Contexto (medido el 2026-09-21 con 2025T1, que existe en las dos fuentes):
- El legado (Neon) cargó los DBF con una llave (cd_a, ent, con, v_sel[, n_hog[, n_ren]]) que NO es única en la ENOE
  desde 2020T3: el mismo hogar aparece con dos cuestionarios (`tipo`). Con ON CONFLICT DO NOTHING descartó esas filas:
  2025T1 tiene 423,302 registros SDEM en el CSV y 409,796 en el legado (3.2 % menos; viviendas 2.1 % menos).
- Sobre las filas comunes, los valores coinciden columna por columna (muestra de 2,000 filas por tabla): el único
  desacuerdo sistemático es `ing_x_hrs`, que el legado guardaba como numeric(17,5) y aquí es double (la API lo devuelve
  con 5 decimales en ambos casos). Las columnas de texto del legado son las del DBF con ceros a la izquierda y ancho
  fijo (data/enoe/particiones/anchos_legado_2025T1.json, derivado del propio legado).
- Por eso los trimestres nuevos se proyectan al esquema del legado (mismas 82/25/25/22/23 columnas, mismos tipos y
  anchos) MÁS la columna `tipo` como último componente de la llave, y se conservan TODAS las filas. Las columnas del CSV
  que no están en el esquema van en `extras_jsonb` (valores tal cual). El índice en D1 lleva `llave_extra = 'tipo'` para
  que el worker ordene y pagine con la llave completa.

Verificación: por trimestre, suma de filas de las particiones = filas del CSV = filas en da_microdatos; llave completa
única; subida comprobada con HEAD. Con --comparar 2025T1 se proyecta 2025T1 y se compara contra el legado completo:
todas las filas del legado deben existir en la proyección con valores iguales (salvo ing_x_hrs por formato).
Uso: data/.venv/bin/python scripts/enoe_particiones_csv.py [--desde 2025T2] [--comparar 2025T1] [--cargar]
"""
import argparse, io, json, os, pathlib, re, subprocess, sys, tempfile, time
import concurrent.futures as cf
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import inegi_ingesta as ing
import pyarrow as pa, pyarrow.parquet as pq, pyarrow.compute as pc

RAIZ = ing.RAIZ; BASE = RAIZ / 'data/enoe/particiones'; CRUDO = RAIZ / 'data/enoe/csv_inegi'; CRUDO.mkdir(parents=True, exist_ok=True)
MANIF = BASE / 'manifiesto_csv.jsonl'; LOG = BASE / 'particiones_csv.log'; DB = 'datosmexico-api-enoe'; GRUPO = 2000
COLS = json.loads((BASE / 'columnas.json').read_text()); ANCHOS = json.loads((BASE / 'anchos_legado_2025T1.json').read_text())
PK = {'viv': ['cd_a', 'ent', 'con', 'v_sel'], 'hog': ['cd_a', 'ent', 'con', 'v_sel', 'n_hog'], 'sdem': ['cd_a', 'ent', 'con', 'v_sel', 'n_hog', 'n_ren'], 'coe1': ['cd_a', 'ent', 'con', 'v_sel', 'n_hog', 'n_ren'], 'coe2': ['cd_a', 'ent', 'con', 'v_sel', 'n_hog', 'n_ren']}
ALIAS = {'ent': 'cve_ent', 'mun': 'cve_mun', 'loc': 'cve_loc', 'ageb': 'cve_ageb'}
TIPO_PA = {'string': pa.string(), 'int16': pa.int16(), 'int32': pa.int32(), 'int64': pa.int64(), 'float64': pa.float64(), 'double': pa.float64()}

def log(m):
    with open(LOG, 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {m}\n")
    print(m, flush=True)

def archivos():
    cache = BASE / 'csv_archivos.json'
    if not cache.exists():
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'datosmexico-api-bise', '--remote', '--yes', '--json', '--command',
                            "SELECT archivo, tabla, filas, clave_r2, sha256_zip FROM da_microdatos WHERE programa_slug LIKE '%enoe-poblacion-de-15' AND formato = '_csv.zip' AND archivo LIKE 'enoe-20%'"], cwd=RAIZ, capture_output=True, text=True)
        cache.write_text(json.dumps(json.loads(r.stdout)[0]['results'], indent=0))
    out = {}
    for a in json.loads(cache.read_text()):
        m = re.match(r'enoe-(\d{4})-trim(\d)$', a['archivo']); tabla = next(k for k in ('sdem', 'coe1', 'coe2', 'hog', 'viv') if k in a['tabla'])
        out[(f"{m.group(1)}T{m.group(2)}", tabla)] = a
    return out

def leer(a, periodo, tabla):
    ruta = CRUDO / f'{tabla}_{periodo}.parquet'
    if not ruta.exists(): ing._s3().download_file(ing.BUCKET, a['clave_r2'], str(ruta) + '.tmp'); (CRUDO / f'{tabla}_{periodo}.parquet.tmp').rename(ruta)
    t = pq.read_table(ruta)
    if t.num_rows != a['filas']: raise RuntimeError(f'{tabla} {periodo}: {t.num_rows} filas, catálogo {a["filas"]}')
    return t

def proyectar(t, periodo, tabla):
    """Tabla del CSV → esquema del legado (+ tipo) con extras_jsonb; conserva todas las filas."""
    esquema = COLS[tabla]; usadas = set(); columnas = {}
    for nombre, tipo, _ in esquema:
        if nombre == 'periodo': columnas[nombre] = pa.array([periodo] * t.num_rows, pa.string()); continue
        if nombre == 'etapa': columnas[nombre] = pa.array(['enoe_n'] * t.num_rows, pa.string()); continue
        if nombre == 'extras_jsonb': continue
        origen = nombre if nombre in t.column_names else (ALIAS.get(nombre) if ALIAS.get(nombre) in t.column_names else None)
        if origen is None: columnas[nombre] = pa.nulls(t.num_rows, TIPO_PA[tipo]); continue
        usadas.add(origen); x = t[origen]
        if tipo == 'string':
            s = pc.cast(x, pa.string()) if not pa.types.is_string(x.type) else x
            ancho = ANCHOS[tabla].get(nombre)
            if ancho and ancho[0] == ancho[1]: s = pc.utf8_lpad(s, ancho[1], '0')
            columnas[nombre] = s
        else:
            columnas[nombre] = pc.cast(x, TIPO_PA[tipo], safe=True)
    if 'tipo' not in columnas:
        usadas.add('tipo'); columnas['tipo'] = pc.utf8_lpad(pc.cast(t['tipo'], pa.string()), 1, '0')
    # extras con los nombres del legado (mun, loc, ageb, ent) aunque el CSV de 2025T3 en adelante los llame cve_*
    inverso = {v: k for k, v in ALIAS.items()}
    resto = [c for c in t.column_names if c not in usadas]; nombres_extra = [inverso.get(c, c) for c in resto]
    extras = [json.dumps({c: v for c, v in zip(nombres_extra, fila) if v is not None}, ensure_ascii=False, separators=(',', ':')) for fila in zip(*[t[c].to_pylist() for c in resto])] if resto else ['{}'] * t.num_rows
    columnas['extras_jsonb'] = pa.array(extras, pa.string())
    nombres = [n for n, _, _ in esquema] + (['tipo'] if not any(n == 'tipo' for n, _, _ in esquema) else [])
    return pa.Table.from_arrays([columnas[n] for n in nombres], names=nombres)

def particionar(periodo, tabla, t, clave_origen):
    llave = PK[tabla] + ['tipo']
    if t.select(llave).group_by(llave).aggregate([]).num_rows != t.num_rows: raise RuntimeError(f'{tabla} {periodo}: llave con tipo repetida')
    t = t.sort_by([(k, 'ascending') for k in ['ent'] + [k for k in llave if k != 'ent']])
    regs = []; suma = 0
    with tempfile.TemporaryDirectory(prefix='enoe-c-') as tmp:
        pend = []
        for ent in sorted(set(t['ent'].to_pylist())):
            if not re.fullmatch(r'(0[1-9]|[12][0-9]|3[0-2])', ent): raise RuntimeError(f'{tabla} {periodo}: ent {ent!r}')
            sub = t.filter(pc.equal(t['ent'], ent)); ruta = pathlib.Path(tmp) / f'{ent}.parquet'
            pq.write_table(sub, ruta, compression='zstd', row_group_size=GRUPO, write_statistics=True, data_page_version='1.0')
            md = pq.read_metadata(ruta); clave = f'enoe/particiones/{tabla}/{periodo}/{ent}.parquet'
            pend.append((clave, ruta)); suma += sub.num_rows
            regs.append({'tabla': tabla, 'periodo': periodo, 'ent': ent, 'filas': sub.num_rows, 'grupos': md.num_row_groups, 'bytes': ruta.stat().st_size, 'clave': clave, 'origen': clave_origen, 'llave_extra': 'tipo'})
        if suma != t.num_rows: raise RuntimeError('las particiones no suman')
        with cf.ThreadPoolExecutor(8) as ex: list(ex.map(lambda p: ing.subir(p[0], p[1], 'application/vnd.apache.parquet'), pend))
    ts = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    return [dict(r, ts=ts) for r in regs]

def comparar(periodo, arch):
    """Proyección del CSV contra el legado completo (enoe/microdatos/<tabla>/<periodo>.parquet)."""
    for tabla in ('viv', 'hog', 'sdem', 'coe1', 'coe2'):
        leg_ruta = CRUDO / f'legado_{tabla}_{periodo}.parquet'
        if not leg_ruta.exists(): ing._s3().download_file(ing.BUCKET, f'enoe/microdatos/{tabla}/{periodo}.parquet', str(leg_ruta))
        L = pq.read_table(leg_ruta); P = proyectar(leer(arch[(periodo, tabla)], periodo, tabla), periodo, tabla)
        k = PK[tabla]
        def claves(t): return pc.binary_join_element_wise(*[pc.cast(t[c], pa.string()) for c in k], '|').to_pylist()
        # el legado guardó UNO de los duplicados por `tipo` (en la columna o en extras_jsonb): se empareja con ese mismo tipo
        def tipo_leg(i):
            if 'tipo' in L.column_names: return str(L['tipo'][i].as_py())
            ex = L['extras_jsonb'][i].as_py(); return str((json.loads(ex) if ex else {}).get('tipo', ''))
        iL = {f'{c}|{tipo_leg(i)}': i for i, c in enumerate(claves(L))}
        tP = P['tipo'].to_pylist(); iP = {f'{c}|{tP[i]}': i for i, c in enumerate(claves(P))}
        faltan = [c for c in iL if c not in iP]
        cols = [n for n, _, _ in COLS[tabla] if n not in ('extras_jsonb',)]
        Ld = L.select(cols).to_pydict(); Pd = P.select(cols).to_pydict(); dif = {}
        for c, i in iL.items():
            j = iP.get(c)
            if j is None: continue
            for col in cols:
                a, b = Ld[col][i], Pd[col][j]
                if a != b and not (a is None and b is None) and not (col == 'ing_x_hrs' and a is not None and b is not None and abs(float(a) - float(b)) < 1e-4): dif[col] = dif.get(col, 0) + 1
        log(f'comparación {periodo} {tabla}: legado {L.num_rows:,} filas, CSV {P.num_rows:,}; filas del legado sin par: {len(faltan)}; columnas con diferencias: {dif or "ninguna"}')

def d1(sql):
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f: f.write(sql); ruta = f.name
    for intento in range(4):
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes', '--file', ruta], cwd=RAIZ, capture_output=True, text=True)
        if r.returncode == 0: return
        log(f'wrangler falló (intento {intento + 1}): {(r.stdout + r.stderr)[-300:].strip()}'); time.sleep(20 * (intento + 1))
    sys.exit('wrangler falló cuatro veces')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--desde', default='2025T2'); ap.add_argument('--comparar'); ap.add_argument('--cargar', action='store_true'); a = ap.parse_args()
    arch = archivos()
    if a.comparar: comparar(a.comparar, arch); return
    hechos = {(json.loads(l)['tabla'], json.loads(l)['periodo']) for l in open(MANIF)} if MANIF.exists() else set()
    pend = sorted([(p, t) for (p, t) in arch if p >= a.desde and (t, p) not in hechos])
    log(f'{len(pend)} tablas-trimestre pendientes desde {a.desde}')
    for periodo, tabla in pend:
        t0 = time.time(); x = arch[(periodo, tabla)]; t = leer(x, periodo, tabla); P = proyectar(t, periodo, tabla)
        regs = particionar(periodo, tabla, P, x['clave_r2'])
        with open(MANIF, 'a') as m:
            for r in regs: m.write(json.dumps(r) + '\n')
        log(f'ok {tabla} {periodo}: {len(regs)} particiones, {sum(r["filas"] for r in regs):,} filas (= CSV {t.num_rows:,}), {sum(r["bytes"] for r in regs) / 1e6:.1f} MB, {time.time() - t0:.0f}s')
    if not a.cargar: return
    regs = [json.loads(l) for l in open(MANIF) if l.strip()]
    def q(v): return "'" + str(v).replace("'", "''") + "'"
    sql = "ALTER TABLE microdatos_particiones ADD COLUMN llave_extra TEXT;\n" if not (BASE / '.llave_extra_ok').exists() else ''
    sql += ''.join(f"INSERT OR REPLACE INTO microdatos_particiones (tabla, periodo, ent, filas, grupos, bytes, clave, llave_extra) VALUES ({q(r['tabla'])},{q(r['periodo'])},{q(r['ent'])},{r['filas']},{r['grupos']},{r['bytes']},{q(r['clave'])},{q(r['llave_extra'])});\n" for r in regs)
    for t in ('microdatos_viv', 'microdatos_hog', 'microdatos_sdem', 'microdatos_coe1', 'microdatos_coe2'):
        corto = t.replace('microdatos_', '')
        sql += f"UPDATE estadisticas_globales SET total_filas = (SELECT SUM(filas) FROM microdatos_particiones WHERE tabla = '{corto}'), ultimo_periodo = (SELECT MAX(periodo) FROM microdatos_particiones WHERE tabla = '{corto}'), cobertura_temporal = (SELECT MIN(periodo) FROM microdatos_particiones WHERE tabla = '{corto}') || '-' || (SELECT MAX(periodo) FROM microdatos_particiones WHERE tabla = '{corto}'), actualizado_en = datetime('now') WHERE tabla = '{t}';\n"
    d1(sql); (BASE / '.llave_extra_ok').write_text('1'); log(f'índice D1 actualizado: {len(regs)} particiones')

if __name__ == '__main__':
    main()

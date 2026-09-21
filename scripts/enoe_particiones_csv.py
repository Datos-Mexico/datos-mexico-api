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
Trimestres 2005T1-2025T1 (rehechos el 2026-09-21 desde los mismos CSV oficiales, bajo el prefijo enoe/particiones-csv/):
- 2005T1-2020T1: no existe `tipo` y la llave del legado es única (llave_extra vacía); el legado tomó fac→fac_tri,
  est_d→est_d_tri y t_loc→t_loc_tri, y aquí se hace lo mismo.
- 2020T3-2021T2 (ENOE-N con levantamiento mensual): la misma vivienda aparece hasta tres veces (una por mes, `mes_cal`,
  `n_ent`, `d_sem`) y dos cuestionarios (`tipo`): la llave única es la del legado + tipo + d_sem (llave_extra 'tipo,d_sem';
  d_sem tiene siempre tres dígitos, así que su orden como texto es el numérico). El worker debe admitir llave_extra
  compuesta (separada por comas) antes de apuntar el índice a esas particiones (--cargar las omite salvo --incluir-compuestas).
- 2021T3-2025T1: llave del legado + tipo, como 2025T2 en adelante.
Uso: data/.venv/bin/python scripts/enoe_particiones_csv.py [--desde 2025T2] [--hasta 2026T4] [--prefijo enoe/particiones]
     [--comparar 2025T1] [--cargar] [--incluir-compuestas] [--solo-tablas sdem,viv]
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
# 2005T1-2020T1: el legado guardó fac como fac_tri, est_d como est_d_tri y t_loc como t_loc_tri (comprobado en 2015T1)
ALIAS_VIEJO = {'fac_tri': 'fac', 'est_d_tri': 'est_d', 't_loc_tri': 't_loc'}
TIPO_PA = {'string': pa.string(), 'int16': pa.int16(), 'int32': pa.int32(), 'int64': pa.int64(), 'float64': pa.float64(), 'double': pa.float64()}

def log(m):
    with open(LOG, 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {m}\n")
    print(m, flush=True)

def archivos():
    """Los 85 trimestres con CSV oficial (2005T1-2020T1 '2005trim1', 2020T3-2022T4 'enoe-n-2020-trim3', 2023T1+ 'enoe-2023-trim1')."""
    cache = BASE / 'csv_archivos_todos.json'
    if not cache.exists():
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'datosmexico-api-bise', '--remote', '--yes', '--json', '--command',
                            "SELECT archivo, tabla, filas, clave_r2, sha256_zip FROM da_microdatos WHERE programa_slug = 'encuesta-nacional-de-ocupacion-y-empleo-enoe-poblacion-de-15' AND formato = '_csv.zip' ORDER BY archivo, tabla"], cwd=RAIZ, capture_output=True, text=True)
        cache.write_text(json.dumps(json.loads(r.stdout)[0]['results'], indent=0))
    out = {}
    for a in json.loads(cache.read_text()):
        m = re.match(r'(?:enoe-n-|enoe-)?(\d{4})-?trim(\d)$', a['archivo']); tabla = next(k for k in ('sdem', 'coe1', 'coe2', 'hog', 'viv') if k in a['tabla'].lower())
        out[(f"{m.group(1)}T{m.group(2)}", tabla)] = a
    return out

def leer(a, periodo, tabla):
    ruta = CRUDO / f'{tabla}_{periodo}.parquet'
    if not ruta.exists(): ing._s3().download_file(ing.BUCKET, a['clave_r2'], str(ruta) + '.tmp'); (CRUDO / f'{tabla}_{periodo}.parquet.tmp').rename(ruta)
    t = pq.read_table(ruta); t = t.rename_columns([c.lower() for c in t.column_names])
    if t.num_rows != a['filas']: raise RuntimeError(f'{tabla} {periodo}: {t.num_rows} filas, catálogo {a["filas"]}')
    return t

def anchos_para(periodo, tabla):
    """Anchos de las columnas de texto: 2025T2+ usa los del legado 2025T1; los trimestres anteriores los toman del propio
    legado de ese trimestre (el legado guardó cada campo con el ancho del DBF de su año: est_d_tri era '260' en 2015 y
    '0260' en 2025), para que la proyección reproduzca al legado carácter por carácter."""
    if periodo >= '2025T2': return ANCHOS[tabla]
    cache = BASE / 'anchos' / f'{periodo}_{tabla}.json'; cache.parent.mkdir(exist_ok=True)
    if cache.exists(): return json.loads(cache.read_text())
    ruta = CRUDO / f'legado_{tabla}_{periodo}.parquet'
    if not ruta.exists():
        try: ing._s3().download_file(ing.BUCKET, f'enoe/microdatos/{tabla}/{periodo}.parquet', str(ruta) + '.tmp'); pathlib.Path(str(ruta) + '.tmp').rename(ruta)
        except Exception as e:
            vecino = '2005T2' if periodo == '2005T1' else None
            if not vecino: raise
            log(f'anchos {tabla} {periodo}: sin legado ({type(e).__name__}); se usan los de {vecino}'); a = anchos_para(vecino, tabla); cache.write_text(json.dumps(a)); return a
    L = pq.read_table(ruta, columns=[n for n, ty, _ in COLS[tabla] if ty == 'string' and n not in ('periodo', 'etapa', 'extras_jsonb')]); a = {}
    for n in L.column_names:
        col = L[n].drop_null()
        if len(col) == 0: continue
        ln = pc.utf8_length(col); mn, mx = pc.min(ln).as_py(), pc.max(ln).as_py()
        a[n] = [mn, mx, bool(pc.any(pc.starts_with(col, '0')).as_py())]
    cache.write_text(json.dumps(a)); return a

def proyectar(t, periodo, tabla):
    """Tabla del CSV → esquema del legado (+ tipo) con extras_jsonb; conserva todas las filas."""
    esquema = COLS[tabla]; usadas = set(); columnas = {}; anchos = anchos_para(periodo, tabla); etapa = 'clasica' if periodo < '2020T3' else 'enoe_n'
    for nombre, tipo, _ in esquema:
        if nombre == 'periodo': columnas[nombre] = pa.array([periodo] * t.num_rows, pa.string()); continue
        if nombre == 'etapa': columnas[nombre] = pa.array([etapa] * t.num_rows, pa.string()); continue
        if nombre == 'extras_jsonb': continue
        origen = nombre if nombre in t.column_names else (ALIAS.get(nombre) if ALIAS.get(nombre) in t.column_names else (ALIAS_VIEJO.get(nombre) if ALIAS_VIEJO.get(nombre) in t.column_names else None))
        if origen is None: columnas[nombre] = pa.nulls(t.num_rows, TIPO_PA[tipo]); continue
        usadas.add(origen); x = t[origen]
        if tipo == 'string':
            s = pc.cast(x, pa.string()) if not pa.types.is_string(x.type) else x
            ancho = anchos.get(nombre)
            if ancho and ancho[0] == ancho[1] and (ancho[2] or periodo >= '2025T2'): s = pc.utf8_lpad(s, ancho[1], '0')
            columnas[nombre] = s
        else:
            columnas[nombre] = pc.cast(x, TIPO_PA[tipo], safe=True)
    if 'tipo' not in columnas:
        if 'tipo' in t.column_names: usadas.add('tipo'); columnas['tipo'] = pc.utf8_lpad(pc.cast(t['tipo'], pa.string()), 1, '0')
        else: columnas['tipo'] = pa.nulls(t.num_rows, pa.string())
    # extras con los nombres del legado (mun, loc, ageb, ent) aunque el CSV de 2025T3 en adelante los llame cve_*
    inverso = {v: k for k, v in ALIAS.items()}
    resto = [c for c in t.column_names if c not in usadas]; nombres_extra = [inverso.get(c, c) for c in resto]
    extras = [json.dumps({c: v for c, v in zip(nombres_extra, fila) if v is not None}, ensure_ascii=False, separators=(',', ':')) for fila in zip(*[t[c].to_pylist() for c in resto])] if resto else ['{}'] * t.num_rows
    columnas['extras_jsonb'] = pa.array(extras, pa.string())
    nombres = [n for n, _, _ in esquema] + (['tipo'] if not any(n == 'tipo' for n, _, _ in esquema) else [])
    return pa.Table.from_arrays([columnas[n] for n in nombres], names=nombres)

def llave_extra_de(periodo, tabla, t):
    """'' si la llave del legado es única (2005T1-2020T1), 'tipo' si hace falta el cuestionario, 'tipo,d_sem' en la ENOE-N
    mensual (2020T3-2021T2). Se decide contando en la tabla proyectada, nunca por el calendario."""
    def unica(cols): return t.select(cols).group_by(cols).aggregate([]).num_rows == t.num_rows
    if t['tipo'].null_count == t.num_rows:
        if unica(PK[tabla]): return ''
        raise RuntimeError(f'{tabla} {periodo}: sin tipo y llave del legado repetida')
    if unica(PK[tabla] + ['tipo']): return 'tipo'
    if unica(PK[tabla] + ['tipo', 'd_sem']): return 'tipo,d_sem'
    raise RuntimeError(f'{tabla} {periodo}: ni tipo ni tipo+d_sem hacen única la llave')

def particionar(periodo, tabla, t, clave_origen, prefijo='enoe/particiones'):
    extra = llave_extra_de(periodo, tabla, t); llave = PK[tabla] + [c for c in extra.split(',') if c]
    if extra and 'd_sem' in llave and pc.any(pc.not_equal(pc.utf8_length(t['d_sem']), 3)).as_py(): raise RuntimeError(f'{tabla} {periodo}: d_sem no tiene tres dígitos')
    t = t.sort_by([(k, 'ascending') for k in ['ent'] + [k for k in llave if k != 'ent']])
    regs = []; suma = 0
    with tempfile.TemporaryDirectory(prefix='enoe-c-') as tmp:
        pend = []
        for ent in sorted(set(t['ent'].to_pylist())):
            if not re.fullmatch(r'(0[1-9]|[12][0-9]|3[0-2])', ent): raise RuntimeError(f'{tabla} {periodo}: ent {ent!r}')
            sub = t.filter(pc.equal(t['ent'], ent)); ruta = pathlib.Path(tmp) / f'{ent}.parquet'
            pq.write_table(sub, ruta, compression='zstd', row_group_size=GRUPO, write_statistics=True, data_page_version='1.0')
            md = pq.read_metadata(ruta); clave = f'{prefijo}/{tabla}/{periodo}/{ent}.parquet'
            pend.append((clave, ruta)); suma += sub.num_rows
            regs.append({'tabla': tabla, 'periodo': periodo, 'ent': ent, 'filas': sub.num_rows, 'grupos': md.num_row_groups, 'bytes': ruta.stat().st_size, 'clave': clave, 'origen': clave_origen, 'llave_extra': extra})
        if suma != t.num_rows: raise RuntimeError('las particiones no suman')
        with cf.ThreadPoolExecutor(8) as ex: list(ex.map(lambda p: ing.subir(p[0], p[1], 'application/vnd.apache.parquet'), pend))
    ts = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    return [dict(r, ts=ts) for r in regs]

def comparar(periodo, arch):
    """Proyección del CSV contra el legado completo (enoe/microdatos/<tabla>/<periodo>.parquet)."""
    for tabla in ('viv', 'hog', 'sdem', 'coe1', 'coe2'):
        leg_ruta = CRUDO / f'legado_{tabla}_{periodo}.parquet'
        if not leg_ruta.exists():
            try: ing._s3().download_file(ing.BUCKET, f'enoe/microdatos/{tabla}/{periodo}.parquet', str(leg_ruta) + '.tmp'); pathlib.Path(str(leg_ruta) + '.tmp').rename(leg_ruta)
            except Exception as e: log(f'comparación {periodo} {tabla}: el legado no tiene esta tabla-trimestre ({type(e).__name__})'); continue
        L = pq.read_table(leg_ruta); P = proyectar(leer(arch[(periodo, tabla)], periodo, tabla), periodo, tabla)
        k = PK[tabla]
        def claves(t): return pc.binary_join_element_wise(*[pc.cast(t[c], pa.string()) for c in k], '|').to_pylist()
        # el legado guardó UNO de los duplicados por `tipo` (en la columna o en extras_jsonb): se empareja con ese mismo tipo
        def tipo_leg(i):
            if 'tipo' in L.column_names: return str(L['tipo'][i].as_py())
            ex = L['extras_jsonb'][i].as_py(); return str((json.loads(ex) if ex else {}).get('tipo', ''))
        dL = L['d_sem'].to_pylist(); dP = P['d_sem'].to_pylist()
        iL = {f'{c}|{tipo_leg(i).replace("None", "")}|{dL[i]}': i for i, c in enumerate(claves(L))}
        tP = P['tipo'].to_pylist(); iP = {f'{c}|{tP[i] if tP[i] is not None else ""}|{dP[i]}': i for i, c in enumerate(claves(P))}
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

def verificar(arch, prefijo):
    """Manifiesto contra el catálogo (suma de filas por tabla-trimestre = filas del CSV) y contra R2 (HEAD: tamaño exacto)."""
    regs = [json.loads(l) for l in open(MANIF) if l.strip() and f'"{prefijo}/' in l]; por = {}
    for r in regs: por.setdefault((r['periodo'], r['tabla']), []).append(r)
    mal = 0
    for (p, t), rs in sorted(por.items()):
        if sum(r['filas'] for r in rs) != arch[(p, t)]['filas'] or len(rs) != 32: mal += 1; log(f'NO CUADRA {t} {p}: {sum(r["filas"] for r in rs):,} vs CSV {arch[(p, t)]["filas"]:,} en {len(rs)} particiones')
    s3 = ing._s3()
    def head(r):
        try: return s3.head_object(Bucket=ing.BUCKET, Key=r['clave'])['ContentLength'] == r['bytes']
        except Exception: return False
    with cf.ThreadPoolExecutor(32) as ex: faltan = [r['clave'] for r, ok in zip(regs, ex.map(head, regs)) if not ok]
    log(f'verificación {prefijo}: {len(por)} tablas-trimestre ({len({p for p, _ in por})} trimestres), {len(regs)} particiones, {sum(r["filas"] for r in regs):,} filas; tablas-trimestre que no cuadran: {mal}; objetos ausentes o de otro tamaño en R2: {len(faltan)}' + (f' {faltan[:5]}' if faltan else ''))
    return mal == 0 and not faltan

def d1(sql):
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f: f.write(sql); ruta = f.name
    for intento in range(4):
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes', '--file', ruta], cwd=RAIZ, capture_output=True, text=True)
        if r.returncode == 0: return
        log(f'wrangler falló (intento {intento + 1}): {(r.stdout + r.stderr)[-300:].strip()}'); time.sleep(20 * (intento + 1))
    sys.exit('wrangler falló cuatro veces')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--desde', default='2025T2'); ap.add_argument('--hasta', default='2099T4'); ap.add_argument('--prefijo', default='enoe/particiones')
    ap.add_argument('--comparar'); ap.add_argument('--verificar', action='store_true'); ap.add_argument('--cargar', action='store_true'); ap.add_argument('--incluir-compuestas', action='store_true'); ap.add_argument('--solo-tablas'); a = ap.parse_args()
    arch = archivos()
    if a.comparar: comparar(a.comparar, arch); return
    if a.verificar: verificar(arch, a.prefijo); return
    hechos = {(json.loads(l)['tabla'], json.loads(l)['periodo']) for l in open(MANIF)} if MANIF.exists() else set()
    tablas = set(a.solo_tablas.split(',')) if a.solo_tablas else None
    pend = sorted([(p, t) for (p, t) in arch if a.desde <= p <= a.hasta and (t, p) not in hechos and (tablas is None or t in tablas)])
    log(f'{len(pend)} tablas-trimestre pendientes entre {a.desde} y {a.hasta} (prefijo {a.prefijo})')
    for periodo, tabla in pend:
        t0 = time.time(); x = arch[(periodo, tabla)]; t = leer(x, periodo, tabla); P = proyectar(t, periodo, tabla)
        regs = particionar(periodo, tabla, P, x['clave_r2'], a.prefijo)
        with open(MANIF, 'a') as m:
            for r in regs: m.write(json.dumps(r) + '\n')
        log(f'ok {tabla} {periodo}: {len(regs)} particiones, {sum(r["filas"] for r in regs):,} filas (= CSV {t.num_rows:,}), llave_extra {regs[0]["llave_extra"]!r}, {sum(r["bytes"] for r in regs) / 1e6:.1f} MB, {time.time() - t0:.0f}s')
    if not a.cargar: return
    regs = [json.loads(l) for l in open(MANIF) if l.strip()]
    if not a.incluir_compuestas:
        fuera = sorted({(r['tabla'], r['periodo']) for r in regs if ',' in r['llave_extra']}); regs = [r for r in regs if ',' not in r['llave_extra']]
        if fuera: log(f'sin cargar al índice (llave compuesta, el worker debe soportarla): {len(fuera)} tablas-trimestre, {sorted({p for _, p in fuera})}')
    regs = [r for r in regs if a.desde <= r['periodo'] <= a.hasta]
    def q(v): return "'" + str(v).replace("'", "''") + "'"
    sql = "ALTER TABLE microdatos_particiones ADD COLUMN llave_extra TEXT;\n" if not (BASE / '.llave_extra_ok').exists() else ''
    sql += ''.join(f"INSERT OR REPLACE INTO microdatos_particiones (tabla, periodo, ent, filas, grupos, bytes, clave, llave_extra) VALUES ({q(r['tabla'])},{q(r['periodo'])},{q(r['ent'])},{r['filas']},{r['grupos']},{r['bytes']},{q(r['clave'])},{q(r['llave_extra']) if r['llave_extra'] else 'NULL'});\n" for r in regs)
    for t in ('microdatos_viv', 'microdatos_hog', 'microdatos_sdem', 'microdatos_coe1', 'microdatos_coe2'):
        corto = t.replace('microdatos_', '')
        sql += f"UPDATE estadisticas_globales SET total_filas = (SELECT SUM(filas) FROM microdatos_particiones WHERE tabla = '{corto}'), ultimo_periodo = (SELECT MAX(periodo) FROM microdatos_particiones WHERE tabla = '{corto}'), primer_periodo = (SELECT MIN(periodo) FROM microdatos_particiones WHERE tabla = '{corto}'), cobertura_temporal = (SELECT MIN(periodo) FROM microdatos_particiones WHERE tabla = '{corto}') || '-' || (SELECT MAX(periodo) FROM microdatos_particiones WHERE tabla = '{corto}'), actualizado_en = datetime('now') WHERE tabla = '{t}';\n"
    lineas = sql.splitlines(); tam = 1500
    for i in range(0, len(lineas), tam): d1('\n'.join(lineas[i:i + tam]) + '\n'); log(f'  índice: {min(i + tam, len(lineas))}/{len(lineas)} sentencias')
    (BASE / '.llave_extra_ok').write_text('1'); log(f'índice D1 actualizado: {len(regs)} particiones')

if __name__ == '__main__':
    main()

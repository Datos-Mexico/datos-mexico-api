"""Censos Económicos 2004-2024 desde los «datos abiertos» del INEGI (exclusión 7 del traspaso, segunda vía).
La página de los Censos Económicos 2024 publica, para las cinco ediciones (2004, 2009, 2014, 2019, 2024), un zip por
ámbito (nacional + 32 entidades): /contenidos/programas/ce/2024/datosabiertos/conjunto_de_datos_ce_<ent>_<edición>_csv.zip,
con el cuadro completo entidad × municipio × actividad (sector, subsector, rama, subrama y clase del SCIAN) × estrato de
personal ocupado y las mismas 98 variables censales que sirve el SAIC (www.inegi.org.mx/app/saic/), con más decimales.
Es exactamente el contenido del SAIC (verificado celda por celda contra lo descargado por su API: scripts/saic_descarga.py),
pero baja en minutos en vez de las decenas de horas que cobra el servidor del SAIC (~0.65 s por variable y 1,000 filas).
Etapas:
  --bajar      descarga los 165 zips a data/saic/abiertos/<edición>/ (SHA-256 en data/saic/abiertos.jsonl; reanudable) y los sube íntegros a R2
               (inegi/fuentes/censos-economicos/<edición>/<archivo>).
  --parquet    construye data/saic/parquet/saic_<año>.parquet con el esquema del SAIC (anio = año censal: 2024 → 2023, …), que después
               scripts/saic_cargar.py --subir --cargar publica en R2 y D1 (fuente 'datos abiertos', año completo).
  --verificar  coteja cada celda descargada del SAIC (data/saic/crudo + manifiesto) contra el Parquet: deben coincidir hasta el
               redondeo del SAIC (3 decimales). FALLOS 0 o termina con error.
Uso: data/.venv/bin/python scripts/ce_datos_abiertos.py --bajar --parquet --verificar [--ediciones 2024,2019]
"""
import argparse, csv, hashlib, io, json, os, pathlib, sys, time, urllib.request, zipfile, collections as C
import concurrent.futures as cf
RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data' / 'saic'; AB = DIR / 'abiertos'; MANIF = DIR / 'abiertos.jsonl'; PARQ = DIR / 'parquet'
B = 'https://www.inegi.org.mx/contenidos/programas/ce/2024/datosabiertos/'
EDICIONES = {'2024': '2023', '2019': '2018', '2014': '2013', '2009': '2008', '2004': '2003'}
ENTS = ['nac', 'ags', 'bc', 'bcs', 'camp', 'coah', 'col', 'chis', 'chih', 'cdmx', 'dgo', 'gto', 'gro', 'hgo', 'jal', 'mex', 'mich', 'mor', 'nay', 'nl', 'oax', 'pue', 'qro', 'qroo', 'slp', 'sin', 'son', 'tab', 'tamps', 'tlax', 'ver', 'yuc', 'zac']
CVE = {e: f'{i:02d}' for i, e in enumerate(ENTS)}  # nac → 00, ags → 01 … zac → 32 (orden del INEGI)
LLAVE = ('E03', 'E04', 'SECTOR', 'SUBSECTOR', 'RAMA', 'SUBRAMA', 'CLASE', 'ID_ESTRATO', 'CODIGO')
def log(m):
    with open(DIR / 'saic.log', 'a') as f: f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} abiertos: {m}\n")
    print(m, flush=True)

def bajar(ediciones, hilos):
    sys.path.insert(0, str(RAIZ / 'scripts')); import inegi_ingesta as ing
    hechos = {json.loads(l)['archivo'] for l in open(MANIF) if l.strip()} if MANIF.exists() else set()
    tareas = [(ed, e) for ed in ediciones for e in ENTS if f'conjunto_de_datos_ce_{e}_{ed}_csv.zip' not in hechos]
    log(f'{len(tareas)} zips por bajar de {len(ediciones) * len(ENTS)}')
    def uno(t):
        ed, e = t; nombre = f'conjunto_de_datos_ce_{e}_{ed}_csv.zip'; d = AB / ed; d.mkdir(parents=True, exist_ok=True); ruta = d / nombre
        for intento in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(B + nombre, headers={'User-Agent': 'Mozilla/5.0'}), timeout=300) as r, open(ruta, 'wb') as f:
                    while True:
                        b = r.read(1 << 20)
                        if not b: break
                        f.write(b)
                zipfile.ZipFile(ruta).testzip(); break
            except Exception as ex:
                if intento == 3: log(f'ERROR {nombre}: {ex}'); return
                time.sleep(15 * (intento + 1))
        sha = hashlib.sha256(ruta.read_bytes()).hexdigest(); clave = f'inegi/fuentes/censos-economicos/{ed}/{nombre}'
        ing.subir(clave, str(ruta), 'application/zip')
        with open(MANIF, 'a') as f: f.write(json.dumps({'edicion': ed, 'ambito': e, 'cve_ent': CVE[e], 'archivo': nombre, 'bytes': ruta.stat().st_size, 'sha256': sha, 'url': B + nombre, 'clave_r2': clave, 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}) + '\n')
    with cf.ThreadPoolExecutor(hilos) as ex: list(ex.map(uno, tareas))
    n = sum(1 for l in open(MANIF) if l.strip()); log(f'{n} zips en data/saic/abiertos y R2')

def filas_zip(ruta):
    z = zipfile.ZipFile(ruta); nombre = [i.filename for i in z.infolist() if i.filename.startswith('conjunto_de_datos/') and i.filename.lower().endswith('.csv')]
    if len(nombre) != 1: raise RuntimeError(f'{ruta.name}: {len(nombre)} csv en conjunto_de_datos')
    return list(csv.DictReader(io.StringIO(z.read(nombre[0]).decode('latin-1'))))

def nivel_de(r):
    for n, k in ((5, 'CLASE'), (4, 'SUBRAMA'), (3, 'RAMA'), (2, 'SUBSECTOR'), (1, 'SECTOR')):
        v = r.get(k, '').strip()
        if v: return n, v
    return 0, '0'

def parquet(ediciones):
    import pyarrow as pa, pyarrow.parquet as pq
    cat = json.loads((DIR / 'catalogos.json').read_text()); VARS = ['UE'] + [v['clave'] for v in cat['variables'] if v['clave'] != 'UE']; nivel_act = {a['clave']: a['nivel'] for a in cat['arbol']}
    manif = {json.loads(l)['archivo']: json.loads(l) for l in open(MANIF) if l.strip()}; PARQ.mkdir(exist_ok=True)
    for ed in ediciones:
        anio = EDICIONES[ed]; salida = PARQ / f'saic_{anio}.parquet'; t0 = time.time(); llaves = {}; dup = 0; extra = C.Counter(); sin = C.Counter(); act_fuera = C.Counter()
        archivos = [f'conjunto_de_datos_ce_{e}_{ed}_csv.zip' for e in ENTS]
        if any(a not in manif for a in archivos): sys.exit(f'{ed}: faltan zips en el manifiesto'); 
        for e in ENTS:
            for r in filas_zip(AB / ed / f'conjunto_de_datos_ce_{e}_{ed}_csv.zip'):
                ent = r['E03'].strip(); mun = r['E04'].strip() or None
                if e == 'nac': ent, mun = '00', None
                elif ent != CVE[e]: raise RuntimeError(f'{ed}/{e}: E03 {ent} ≠ {CVE[e]}')
                n, clave = nivel_de(r); est = int(r['ID_ESTRATO'].strip() or 0)
                if n and (clave not in nivel_act or nivel_act[clave] != n):
                    act_fuera[(n, clave)] += 1
                    if clave in nivel_act and nivel_act[clave] < n: continue  # código de un nivel superior repetido como subrama/clase (INEGI 2004 y 2009): la fila ya está en su nivel
                k = (anio, ent, mun, n, clave, est)
                if k in llaves: dup += 1; continue
                vals = {}
                for c, v in r.items():
                    if c in LLAVE: continue
                    c = c.strip()
                    if c not in VARS: extra[c] += 1; continue
                    v = v.strip(); vals[c] = None if v in ('', 'NA', 'N/A', 'NC', 'C') else float(v)
                for v in VARS:
                    if v not in vals: sin[v] += 1
                llaves[k] = vals
        cols = {c: [] for c in ('anio', 'cve_ent', 'cve_mun', 'nivel_act', 'clave_act', 'estrato')}; cols.update({v: [] for v in VARS})
        for k in sorted(llaves, key=lambda x: (x[1], x[2] or '', x[3], x[4], x[5])):
            for c, val in zip(('anio', 'cve_ent', 'cve_mun', 'nivel_act', 'clave_act', 'estrato'), k): cols[c].append(val)
            for v in VARS: cols[v].append(llaves[k].get(v))
        t = pa.table({**{c: pa.array(cols[c], pa.string() if c in ('anio', 'cve_ent', 'cve_mun', 'clave_act') else pa.int16()) for c in ('anio', 'cve_ent', 'cve_mun', 'nivel_act', 'clave_act', 'estrato')}, **{v: pa.array(cols[v], pa.float64()) for v in VARS}})
        pq.write_table(t, salida.with_suffix('.tmp'), compression='zstd'); salida.with_suffix('.tmp').rename(salida)
        no_nulos = sum(sum(1 for x in cols[v] if x is not None) for v in VARS); amb = C.Counter('nacional' if k[1] == '00' else 'entidad' if k[2] is None else 'municipio' for k in llaves)
        log(f"{ed} → {anio}: {len(llaves):,} filas ({dict(amb)}), {dup} repetidas, {no_nulos:,} valores no nulos, {salida.stat().st_size / 1048576:.1f} MB, {time.time() - t0:.0f} s"
            + (f'; columnas fuera del catálogo del SAIC: {dict(extra)}' if extra else '') + (f'; variables ausentes en el CSV: {sorted(sin)}' if sin else '') + (f'; actividades fuera del árbol del SAIC: {dict(act_fuera)} (las de un nivel superior repetidas se descartan)' if act_fuera else ''))
        (PARQ / f'saic_{anio}.json').write_text(json.dumps({'anio': anio, 'edicion': ed, 'fuente': 'datos abiertos', 'archivos': [manif[a]['clave_r2'] for a in archivos], 'filas': len(llaves), 'repetidas': dup, 'valores': no_nulos, 'bytes': salida.stat().st_size, 'variables_ausentes': sorted(sin), 'columnas_extra': sorted(extra)}))

def verificar(ediciones):
    """Cada celda que el SAIC entregó por su API (data/saic/crudo) debe estar en el Parquet con el mismo valor. Tolerancia 0.0006: el SAIC
    redondea a 3 decimales (y Q000B, acervo de activos, con doble redondeo: 5253.72949 → 5253.73); medido el 2026-09-21 en 33.6 M de
    celdas de los cinco censos, la diferencia máxima fue 0.00055 (medio millar de pesos en cifras en millones)."""
    import gzip, pyarrow.parquet as pq; sys.path.insert(0, str(RAIZ / 'scripts')); import saic_cargar as sc
    manif = {json.loads(l)['clave'] for l in open(DIR / 'manifiesto.jsonl') if l.strip()} if (DIR / 'manifiesto.jsonl').exists() else set(); fallos = 0
    for ed in ediciones:
        anio = EDICIONES[ed]; t = pq.read_table(PARQ / f'saic_{anio}.parquet').to_pylist(); p = {(r['cve_ent'], r['cve_mun'], r['nivel_act'], r['clave_act'], r['estrato']): r for r in t}
        comp = dif = falt = filas = 0; ej = []
        if not (sc.CRUDO / anio).exists(): log(f'{ed} → {anio}: sin crudo del SAIC para cotejar'); continue
        for amb in sorted(os.listdir(sc.CRUDO / anio)):
            for f in sorted((sc.CRUDO / anio / amb).glob('*.json.gz')):
                nivel = int(f.name.split('-')[0]); sufijo = f.name.split('-')[1] if f.name.count('-') == 2 else ''
                if f'{anio}/{amb}/{nivel}{"-" + sufijo if sufijo else ""}' not in manif: continue
                for r in json.load(gzip.open(f, 'rt', encoding='utf-8')):
                    k, vals = sc.fila_de(r, amb, nivel); kk = k[1:]; filas += 1
                    if kk not in p: falt += 1; ej.append(('falta', kk)) if len(ej) < 5 else None; continue
                    for v, a in vals.items():
                        b = p[kk].get(v); comp += 1
                        if a is None and b is None: continue
                        if a is None or b is None or abs(a - b) > 0.0006 + 1e-9 * abs(b): dif += 1; ej.append((kk, v, a, b)) if len(ej) < 5 else None
        ok = falt == 0 and dif == 0 and filas > 0
        fallos += 0 if ok else 1
        log(f"{ed} → {anio}: {filas:,} filas del SAIC cotejadas, {comp:,} celdas, {dif} diferencias, {falt} filas ausentes → {'OK' if ok else 'FALLO ' + str(ej)}")
    log(f'verificación: FALLOS {fallos}')
    if fallos: sys.exit(1)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--bajar', action='store_true'); ap.add_argument('--parquet', action='store_true'); ap.add_argument('--verificar', action='store_true'); ap.add_argument('--ediciones', default=','.join(EDICIONES)); ap.add_argument('--hilos', type=int, default=8); a = ap.parse_args()
    eds = a.ediciones.split(',')
    if a.bajar: bajar(eds, a.hilos)
    if a.parquet: parquet(eds)
    if a.verificar: verificar(eds)

"""DENUE histórico: las 20 ediciones que el INEGI publica en la descarga masiva (www.inegi.org.mx/app/descarga/?ti=6,
archivos nacionales por sector de actividad), inventariadas con la misma API interna que usa esa página
(clasificaciones tinfo=6 → obtenercarpetas/obtenerarchivos con tipoInfo OTROS, carpeta «Otros|DENUE|Actividad económica»).

Etapas (reanudables):
  --inventario   API del INEGI → data/denue/historico/inventario.csv (edición, título, url, tamaño) — 484 archivos, 242 CSV.
  --descargar    los zip CSV de cada edición a data/denue/historico/zips/<edición>/ (tamaño comprobado, reanudable).
  --resumir      por edición: lee todos los CSV, escribe el Parquet completo (data/denue/historico/parquet/<edición>.parquet)
                 y el resumen por entidad, municipio, clase de actividad y estrato (data/denue/historico/resumen/<edición>.csv);
                 verifica que la suma del resumen sea igual al total de filas y que no haya id repetido dentro de la edición.
  --subir        Parquet + zips originales a R2 (denue/historico/<edición>/…), con HEAD de comprobación.
  --cargar       resumen de todas las ediciones a D1 datosmexico-api-denue (tabla denue_resumen_historico) y catálogo denue_ediciones.
Uso: data/.venv/bin/python scripts/denue_historico.py --inventario --descargar --hilos 8
"""
import argparse, base64, csv, io, json, os, pathlib, re, sys, time, urllib.request, zipfile, collections as C
import concurrent.futures as cf
RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data' / 'denue' / 'historico'
AMBITO = os.environ.get('DENUE_AMBITO', 'entidad')  # 'entidad' (archivos por entidad, 25 ediciones 2010-2026) o 'sector' (archivos nacionales por sector, 20 ediciones 2015-2026)
SUB = DIR if AMBITO == 'sector' else DIR / 'entidad'
INV = DIR / 'inventario.csv'; ZIPS = SUB / 'zips'; PARQ = SUB / 'parquet'; RES = SUB / 'resumen'; LOG = DIR / 'denue_historico.log'
A = "https://www.inegi.org.mx/app/api/descarga/descarga/descargamasiva/lista/"; CONT = "https://www.inegi.org.mx/contenidos"
H = {'Content-Type': 'application/json; charset=UTF-8', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
     'Referer': 'https://www.inegi.org.mx/app/descarga/', 'Origin': 'https://www.inegi.org.mx', 'User-Agent': 'Mozilla/5.0'}
UA = {'User-Agent': 'Mozilla/5.0'}

def log(m):
    DIR.mkdir(parents=True, exist_ok=True)
    with open(LOG, 'a') as f: f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {m}\n")
    print(m, flush=True)

def post(ep, **kw):
    b = {"tinfo": "6", "ag": "0", "prog": "0", "cc": "0", "subtema": "0", "anio": "0", "formato": "0", "datosAbiertos": "3",
         "textoBuscar": "", "ingles": "0", "tipoInfo": "OTROS"}; b.update({k: str(v) for k, v in kw.items()})
    for i in range(4):
        try:
            r = urllib.request.Request(A + ep, data=json.dumps(b).encode(), headers=H)
            return json.loads(urllib.request.urlopen(r, timeout=120).read())
        except Exception as e:
            if i == 3: raise
            time.sleep(3)

def edicion_de(anio):
    """'05/2026' → '2026-05'; '2015' → '2015' (2010, 2011, 2012 y 2015 no llevan mes en el INEGI; 2015 = DENUE Interactivo 01/2015, archivos fechados 25022015)."""
    m = re.match(r'(\d\d)/(\d{4})$', anio)
    return f'{m.group(2)}-{m.group(1)}' if m else anio

def mb(t):
    m = re.match(r'([\d.,]+)\s*(KB|MB|GB|B)', t.strip(), flags=re.I)
    if not m: return 0.0
    v = float(m.group(1).replace(',', '')); u = m.group(2).upper()
    return v / 1024 if u == 'KB' else v if u == 'MB' else v * 1024 if u == 'GB' else v / 1048576

def inventario():
    b64 = lambda s: base64.b64encode(s.encode()).decode()
    filas = []
    def agregar(a, ambito, ag):
        anio = (a.get('anioInfo') or '').strip('|'); titulo = a['titulo'].split('|')[-1]
        for ext in [x for x in a.get('extensiones', '').split('|') if x]:
            p = ext.split('&'); fmt = p[0]
            filas.append({'ambito': ambito, 'cve_ent': ag, 'edicion': edicion_de(anio), 'periodo_inegi': anio, 'titulo': titulo, 'formato': fmt.replace('.zip', '').strip('_'),
                          'url': CONT + a['pathLogico'] + fmt, 'archivo': pathlib.Path(a['pathLogico'] + fmt).name, 'tam_mb': f'{mb(p[1]) if len(p) > 1 else 0:.2f}', 'id_titulo': a.get('idTitulo', '')})
    for a in post('obtenerarchivos', titulo=b64('Otros|DENUE|Actividad económica|')): agregar(a, 'sector', '00')
    for i in range(1, 33):  # por entidad: carpeta Otros|DENUE| con ag = clave de la entidad (25 ediciones, 2010 a 05/2026)
        for a in post('obtenerarchivos', ag=f'{i:02d}', titulo=b64('Otros|DENUE|')): agregar(a, 'entidad', f'{i:02d}')
    filas.sort(key=lambda x: (x['ambito'], x['edicion'], x['formato'], x['cve_ent'], x['archivo']))
    with open(INV, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(filas[0])); w.writeheader(); w.writerows(filas)
    for amb in ('sector', 'entidad'):
        ed = C.Counter(x['edicion'] for x in filas if x['formato'] == 'csv' and x['ambito'] == amb)
        log(f'inventario {amb}: {sum(ed.values())} CSV en {len(ed)} ediciones: ' + ', '.join(f'{k} ({v})' for k, v in sorted(ed.items())))

def leer_inventario(formato='csv', ambito=None):
    return [x for x in csv.DictReader(open(INV)) if x['formato'] == formato and x['ambito'] == (ambito or AMBITO)]

def descargar_uno(x):
    dest = ZIPS / x['edicion'] / x['archivo']; dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and zipfile.is_zipfile(dest): return 'ya'
    tmp = dest.with_suffix('.tmp')
    for intento in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(x['url'], headers=UA), timeout=300) as r, open(tmp, 'wb') as f:
                while True:
                    b = r.read(1 << 20)
                    if not b: break
                    f.write(b)
            if not zipfile.is_zipfile(tmp): raise RuntimeError('no es zip')
            tmp.rename(dest); return f'{dest.stat().st_size / 1048576:.1f} MB'
        except Exception as e:
            err = e; time.sleep(5 * (intento + 1))
    return f'ERROR {err}'

def descargar(hilos):
    pend = leer_inventario()
    log(f'descarga: {len(pend)} archivos CSV, {hilos} hilos')
    t0 = time.time(); n = 0; err = 0
    with cf.ThreadPoolExecutor(hilos) as ex:
        for x, r in zip(pend, ex.map(descargar_uno, pend)):
            n += 1
            if r.startswith('ERROR'): err += 1
            if r != 'ya': log(f'  [{n}/{len(pend)}] {x["edicion"]} {x["archivo"]} {r}')
    log(f'descarga terminada en {(time.time() - t0) / 60:.1f} min, errores {err}')
    return err == 0

def clave_fuente(x):
    return f"inegi/fuentes/denue-historico/{x['edicion']}/{x['archivo']}" if x['ambito'] == 'sector' else f"inegi/fuentes/denue-historico-entidad/{x['edicion']}/{x['archivo']}"

def espejar(hilos):
    """Copia los zip CSV (y SHP) a R2 desde la red de Cloudflare (POST /api/v1/admin/espejo del worker; el INEGI limita la
    descarga directa a ~0.7 MB/s por IP) y luego los baja de R2 por S3 a data/denue/historico/zips/<edición>/."""
    sys.path.insert(0, str(RAIZ / 'scripts')); import inegi_espejo as esp, inegi_ingesta as ing
    reg = DIR / 'espejo.jsonl'; hechas = {json.loads(l)['clave'] for l in open(reg) if l.strip()} if reg.exists() else set()
    tareas = [(x, f"inegi/fuentes/denue-historico/{x["edicion"]}/{x["archivo"]}") for x in csv.DictReader(open(INV)) if f"inegi/fuentes/denue-historico/{x["edicion"]}/{x["archivo"]}" not in hechas]
    log(f'espejo: {len(tareas)} archivos por copiar a R2 con {hilos} hilos'); t0 = time.time(); import threading; c = threading.Lock(); n = [0, 0]
    def uno(t):
        x, clave = t
        try:
            r = esp.espejar(x['url'], clave)
            with c:
                with open(reg, 'a') as f: f.write(json.dumps({'clave': clave, 'url': x['url'], 'bytes': r['bytes'], 'etag': r['etag'], 'ms': r['ms']}) + '\n')
                n[0] += 1
                if n[0] % 25 == 0: log(f'  {n[0]}/{len(tareas)} espejados, {n[1]} errores, {time.time() - t0:.0f} s')
        except Exception as e:
            with c: n[1] += 1; log(f'  ERROR {clave} {e}')
    with cf.ThreadPoolExecutor(hilos) as ex: list(ex.map(uno, tareas))
    log(f'espejo terminado: {n[0]} copiados, {n[1]} errores, {(time.time() - t0) / 60:.1f} min')

def bajar(hilos):
    """Baja de R2 (S3) los zip CSV espejados; comprueba tamaño contra el registro del espejo."""
    sys.path.insert(0, str(RAIZ / 'scripts')); import inegi_ingesta as ing
    reg = {json.loads(l)['clave']: json.loads(l) for l in open(DIR / 'espejo.jsonl') if l.strip()}
    pend = [(x, f"inegi/fuentes/denue-historico/{x["edicion"]}/{x["archivo"]}") for x in leer_inventario()]
    def uno(t):
        x, clave = t; dest = ZIPS / x['edicion'] / x['archivo']; dest.parent.mkdir(parents=True, exist_ok=True)
        if clave not in reg: return f'SIN ESPEJO {clave}'
        if dest.exists() and dest.stat().st_size == reg[clave]['bytes']: return 'ya'
        tmp = dest.with_suffix('.tmp'); ing._s3().download_file(ing.BUCKET, clave, str(tmp))
        if tmp.stat().st_size != reg[clave]['bytes'] or not zipfile.is_zipfile(tmp): return f'ERROR tamaño {clave}'
        tmp.rename(dest); return f'{dest.stat().st_size / 1048576:.1f} MB'
    t0 = time.time(); err = 0
    with cf.ThreadPoolExecutor(hilos) as ex:
        for (x, clave), r in zip(pend, ex.map(uno, pend)):
            if r.startswith(('ERROR', 'SIN')): err += 1; log(f'  {r}')
    log(f'bajada terminada: {len(pend)} archivos, {err} errores, {(time.time() - t0) / 60:.1f} min')
    return err == 0

# Cifra publicada por el INEGI para cada edición (comunicados de prensa denue<año>_<mes>.pdf, DENUE2019/2020/2021_05.pdf y
# el «Documento metodológico» del DENUE 05/2024, que recorre las 22 ediciones; archivados en data/denue/historico/boletines/).
PUBLICADO = {'2010': 4331202, '2011': 4374600, '2012': 4400943, '2013-07': 4410199, '2013-10': None, '2015': 4926061, '2016-01': 5004986, '2016-10': 5032503, '2017-03': 5039911, '2017-11': 5053130, '2018-03': 5078737,
             '2018-11': 5081192, '2019-04': None, '2019-11': 5447591, '2020-04': None, '2020-11': 5546698, '2021-05': 5515863,
             '2021-11': None, '2022-05': 5528698, '2022-11': 5530925, '2023-11': 5541076, '2024-05': 5564612, '2024-11': 6058548,
             '2025-05': 6097675, '2026-05': 6138075}
# Encabezado canónico (el del INEGI desde 01/2016; la edición 2015 trae los mismos 41 campos con títulos en español, se mapean por posición).
COLS_2016 = ['id', 'nom_estab', 'raz_social', 'codigo_act', 'nombre_act', 'per_ocu', 'tipo_vial', 'nom_vial', 'tipo_v_e_1', 'nom_v_e_1', 'tipo_v_e_2',
             'nom_v_e_2', 'tipo_v_e_3', 'nom_v_e_3', 'numero_ext', 'letra_ext', 'edificio', 'edificio_e', 'numero_int', 'letra_int', 'tipo_asent',
             'nomb_asent', 'tipocencom', 'nom_cencom', 'num_local', 'cod_postal', 'cve_ent', 'entidad', 'cve_mun', 'municipio', 'cve_loc', 'localidad',
             'ageb', 'manzana', 'telefono', 'correoelec', 'www', 'tipounieco', 'latitud', 'longitud', 'fecha_alta']
ESTRATOS = {'0 a 5 personas': 1, '6 a 10 personas': 2, '11 a 30 personas': 3, '31 a 50 personas': 4, '51 a 100 personas': 5, '101 a 250 personas': 6, '251 y más personas': 7}

# Encabezados en español de las ediciones 2010 a 10/2013 (archivos por entidad) → nombres canónicos.
ESPANOL = {'llave denue': 'id', 'id': 'id', 'nombre de la unidad economica': 'nom_estab', 'razon social': 'raz_social',
  'codigo de la clase de actividad': 'codigo_act', 'codigo de la clase de actividad scian': 'codigo_act', 'nombre de la clase de actividad': 'nombre_act',
  'nombre de clase de la actividad': 'nombre_act', 'descripcion estrato personal ocupado': 'per_ocu', 'clave entidad': 'cve_ent', 'clave entidad federativa': 'cve_ent',
  'entidad federativa': 'entidad', 'clave municipio': 'cve_mun', 'municipio': 'municipio', 'clave localidad': 'cve_loc', 'localidad': 'localidad',
  'area geoestadistica basica': 'ageb', 'manzana': 'manzana', 'latitud': 'latitud', 'longitud': 'longitud', 'fecha de incorporacion al denue': 'fecha_alta',
  'tipo de unidad economica': 'tipounieco', 'codigo postal': 'cod_postal', 'tipo de vialidad': 'tipo_vial', 'nombre de la vialidad': 'nom_vial'}
import unicodedata
def _norm(s): return ''.join(ch for ch in unicodedata.normalize('NFD', s.lower()) if unicodedata.category(ch) != 'Mn').strip()
_MAPA_MUN = None
def mapa_municipios():
    """(cve_ent, nombre normalizado) → cve_mun, desde el AGEEML (data/catalogos/normalizado/municipios.csv) más los nombres
    que el propio DENUE usó en 2011 y 10/2013 (traen clave y nombre), para las ediciones 2010 y 07/2013 que solo traen el nombre."""
    global _MAPA_MUN
    if _MAPA_MUN is not None: return _MAPA_MUN
    cache = SUB / 'municipios_nombre.json'
    if cache.exists(): _MAPA_MUN = {tuple(k.split('|')): v for k, v in json.loads(cache.read_text()).items()}; return _MAPA_MUN
    m = {}
    for x in csv.DictReader(open(RAIZ / 'data/catalogos/normalizado/municipios.csv', encoding='utf-8')): m[(x['cve_ent'], _norm(x['nom_mun']))] = x['cve_mun']
    for ed in ('2011', '2013-10'):
        for zp in sorted((ZIPS / ed).glob('*_csv.zip')):
            for cab, fila in leer_zip(zp, sin_mapa=True):
                d = dict(zip(cab, fila))
                if 'cve_mun' not in d: break  # algunos archivos de 2011 traen el formato de 2010, sin claves
                m.setdefault((d['cve_ent'].zfill(2), _norm(d['municipio'])), d['cve_mun'].zfill(3))
    cache.write_text(json.dumps({'|'.join(k): v for k, v in m.items()}, ensure_ascii=False)); _MAPA_MUN = m; return m

def leer_zip(ruta, sin_mapa=False):
    """Filas del CSV de datos de un zip del DENUE como listas de texto, con el encabezado canónico en minúsculas."""
    z = zipfile.ZipFile(ruta)
    datos = [x for x in z.namelist() if x.lower().endswith('.csv') and 'diccionario' not in x.lower()]
    assert len(datos) == 1, (ruta.name, datos)
    raw = z.read(datos[0])
    try: s = raw.decode('utf-8')
    except UnicodeDecodeError: s = raw.decode('latin-1')
    r = csv.reader(io.StringIO(s.lstrip('﻿'))); crudo = next(r); primera = None
    # Quirk del INEGI (varios archivos de 01/2016): el encabezado termina en "fecha_alta" sin salto de línea y el lector lo pega con la primera fila.
    pegado = [i for i, c in enumerate(crudo) if c.startswith('fecha_alta"')]
    if pegado:
        i = pegado[0]; primera = [crudo[i][len('fecha_alta"'):]] + crudo[i + 1:]; crudo = crudo[:i] + ['fecha_alta']
    cab = [c.strip().strip('"').strip().lower().lstrip('﻿') for c in crudo]
    if cab[0] == 'id' and len(cab) > 1 and 'nombre de la unidad' in cab[1]:
        assert len(cab) == 41, (ruta.name, len(cab)); cab = COLS_2016  # edición 2015: títulos en español, mismo orden
    elif cab[0] != 'id':  # 2010-2013: títulos en español con variantes por entidad; se mapean por patrón y el resto se conserva con su título normalizado
        cab2 = []
        for c in cab:
            n = re.sub(r'\s+', ' ', _norm(c)); k = ESPANOL.get(n)
            if k is None:
                if re.search(r'^nombre de (la )?clase de ?la actividad', n): k = 'nombre_act'
                elif re.search(r'^codigo de la clase', n): k = 'codigo_act'
                elif n.startswith('descripci') and 'estrato' in n: k = 'per_ocu'
                elif n == 'personal ocupado (estrato)': k = 'per_ocu_estrato'
                elif n.startswith('area geoestadistica basica'): k = 'ageb'
                else: k = re.sub(r'[^a-z0-9]+', '_', n).strip('_')
            if k in cab2: k = k + '_2'
            cab2.append(k)
        if 'per_ocu' not in cab2 and 'per_ocu_estrato' in cab2: cab2[cab2.index('per_ocu_estrato')] = 'per_ocu'  # 2010-2011: el estrato viene como texto
        cab = cab2
    ent_archivo = re.search(r'denue_?(\d{2})_', ruta.name.lower()) or re.search(r'denue_(\d)_', ruta.name.lower()) or re.search(r'csv(\d{2})', ruta.name.lower())
    extra = []
    if 'cve_ent' not in cab: cab = cab + ['cve_ent']; extra.append(('cve_ent', ent_archivo.group(1).zfill(2)))
    falta_mun = 'cve_mun' not in cab and not sin_mapa
    if falta_mun: cab = cab + ['cve_mun']
    if not {'cve_ent', 'codigo_act', 'per_ocu', 'entidad', 'municipio', 'nombre_act'} <= set(cab):
        raise RuntimeError(f'{ruta.name}: encabezado desconocido {cab[:6]}')
    mapa = None if (sin_mapa or not falta_mun) else mapa_municipios(); ie = cab.index('cve_ent'); im = cab.index('municipio')
    def completar(fila):
        fila = fila + [v for _, v in extra]
        if falta_mun:
            k = (fila[ie].zfill(2), _norm(fila[im])); cm = mapa.get(k)
            if cm is None: raise RuntimeError(f'{ruta.name}: municipio sin clave: {k}')
            fila = fila + [cm]
        return fila
    if primera: yield cab, completar(primera)
    for fila in r:
        if fila: yield cab, completar(fila)

def resumir_edicion(ed):
    """Una edición: Parquet completo + resumen; devuelve el total de unidades y las comprobaciones."""
    import pyarrow as pa, pyarrow.parquet as pq
    PARQ.mkdir(exist_ok=True); RES.mkdir(exist_ok=True)
    salida_res = RES / f'{ed}.csv'; salida_pq = PARQ / f'{ed}.parquet'
    if salida_res.exists() and salida_pq.exists(): return json.loads((RES / f'{ed}.json').read_text())
    zips = sorted((ZIPS / ed).glob('*_csv.zip')); esperados = sum(1 for x in leer_inventario() if x['edicion'] == ed)
    if len(zips) != esperados: raise RuntimeError(f'{ed}: {len(zips)} zips locales de {esperados} del inventario')
    cuenta = C.Counter(); nom_ent = {}; nom_mun = {}; nom_act = {}; ids = set(); n = 0; escritor = None; lote = []; dup = 0; t0 = time.time()
    # Esquema del Parquet = unión de los encabezados de los archivos de la edición (en 2011 y 2012 el INEGI mezcla formatos entre entidades).
    cab_ref = []
    for zp in zips:
        for cab, _ in leer_zip(zp):
            for c in cab:
                if c not in cab_ref: cab_ref.append(c)
            break
    def volcar():
        nonlocal escritor, lote
        cols = list(zip(*lote)); t = pa.table({c: pa.array(cols[i], pa.string()) for i, c in enumerate(cab_ref)})
        if escritor is None: escritor = pq.ParquetWriter(salida_pq.with_suffix('.tmp'), t.schema, compression='zstd')
        escritor.write_table(t); lote = []
    for zp in zips:
        pos = None
        for cab, fila in leer_zip(zp):
            if pos is None: pos = [cab.index(c) if c in cab else None for c in cab_ref]
            if len(fila) != len(cab): raise RuntimeError(f'{ed} {zp.name}: fila con {len(fila)} campos')
            fila = [v.strip() for v in fila]; d = dict(zip(cab, fila))
            if 'id' in d and d['id'] != '':
                i = int(d['id'])
                if i in ids: dup += 1; continue  # la misma unidad listada en dos archivos (INEGI): se cuenta una vez
                ids.add(i)
            k = (d['cve_ent'].zfill(2), d['cve_mun'].zfill(3), d['codigo_act'].strip(), ESTRATOS.get(d['per_ocu'].strip().lower().replace('más', 'más'), 0)); cuenta[k] += 1
            nom_ent.setdefault(k[0], d['entidad']); nom_mun.setdefault(k[:2], d['municipio']); nom_act.setdefault(d['codigo_act'].strip(), d['nombre_act'].split('-')[-1].strip() if len(d['nombre_act']) > 200 else d['nombre_act'].strip())
            lote.append([fila[j] if j is not None else '' for j in pos]); n += 1
            if len(lote) >= 200000: volcar()
    if lote: volcar()
    escritor.close(); salida_pq.with_suffix('.tmp').rename(salida_pq)
    with open(salida_res.with_suffix('.tmp'), 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['edicion', 'cve_ent', 'entidad', 'cve_mun', 'municipio', 'codigo_act', 'nombre_act', 'per_ocu_cod', 'n'])
        for k in sorted(cuenta): w.writerow([ed, k[0], nom_ent[k[0]], k[1], nom_mun[k[:2]], k[2], nom_act[k[2]], k[3], cuenta[k]])
    salida_res.with_suffix('.tmp').rename(salida_res)
    r = {'edicion': ed, 'unidades': n, 'suma_resumen': sum(cuenta.values()), 'grupos': len(cuenta), 'ids_repetidos': dup if ids else None, 'con_id': bool(ids), 'filas_archivos': n + dup, 'publicado': PUBLICADO.get(ed),
         'municipios': len(nom_mun), 'clases': len(nom_act), 'estratos_desconocidos': sum(v for k, v in cuenta.items() if k[3] == 0), 'archivos': len(zips), 'segundos': round(time.time() - t0)}
    (RES / f'{ed}.json').write_text(json.dumps(r, ensure_ascii=False, indent=1)); return r

def _resumir_seguro(ed):
    try: return resumir_edicion(ed)
    except Exception as e: return {'edicion': ed, 'error': f'{type(e).__name__}: {e}'}

def resumir(procesos):
    eds = [e for e in sorted({x['edicion'] for x in leer_inventario()}) if len(list((ZIPS / e).glob('*_csv.zip'))) == sum(1 for x in leer_inventario() if x['edicion'] == e)]
    log(f'resumir: {len(eds)} ediciones completas en disco: {eds}')
    import multiprocessing as mp
    with mp.Pool(procesos) as pool:
        for r in pool.imap_unordered(_resumir_seguro, eds):
            if 'error' in r: log(f"  {r['edicion']}: ERROR {r['error']}"); continue
            estado = 'ok' if r['publicado'] == r['unidades'] else ('sin cifra publicada' if r['publicado'] is None else f"DIFIERE {r['unidades'] - r['publicado']:+,}")
            log(f"  {r['edicion']}: {r['unidades']:,} unidades ({estado}); resumen {r['suma_resumen']:,} en {r['grupos']:,} grupos; ids repetidos {r['ids_repetidos']}; {r['municipios']} municipios, {r['clases']} clases; {r['segundos']} s")

DDL = """
CREATE TABLE IF NOT EXISTS denue_ediciones (edicion TEXT PRIMARY KEY, periodo_inegi TEXT NOT NULL, orden INTEGER NOT NULL, unidades INTEGER NOT NULL,
  publicado INTEGER, diferencia INTEGER, verificado INTEGER, grupos INTEGER NOT NULL, municipios INTEGER NOT NULL, clases INTEGER NOT NULL,
  archivos INTEGER NOT NULL, scian TEXT NOT NULL, fuente_cifra TEXT, clave_parquet TEXT NOT NULL, bytes_parquet INTEGER NOT NULL, clave_fuentes TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS denue_historico (edicion TEXT NOT NULL, cve_ent TEXT NOT NULL, cve_mun TEXT NOT NULL, codigo_act TEXT NOT NULL,
  per_ocu_cod INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (edicion, cve_ent, cve_mun, codigo_act, per_ocu_cod)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS denue_hist_entidad (edicion TEXT NOT NULL, cve_ent TEXT NOT NULL, codigo_act TEXT NOT NULL, per_ocu_cod INTEGER NOT NULL,
  n INTEGER NOT NULL, PRIMARY KEY (edicion, cve_ent, codigo_act, per_ocu_cod)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS denue_hist_municipios (edicion TEXT NOT NULL, cve_ent TEXT NOT NULL, cve_mun TEXT NOT NULL, entidad TEXT NOT NULL,
  municipio TEXT NOT NULL, PRIMARY KEY (edicion, cve_ent, cve_mun)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS denue_hist_actividades (edicion TEXT NOT NULL, codigo_act TEXT NOT NULL, nombre_act TEXT NOT NULL, PRIMARY KEY (edicion, codigo_act)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS denue_hist_estratos (cod INTEGER PRIMARY KEY, nombre TEXT NOT NULL);
"""
# Origen de la cifra publicada de cada edición (archivados en data/denue/historico/boletines/).
FUENTE_CIFRA = {'2010': 'INEGI, DENUE Interactivo 11/2019, documento metodológico (702825192730.pdf): «primera versión … 4 millones 331 mil 202 negocios» (julio de 2010)',
  '2011': 'INEGI, mismo documento: «DENUE 03/2011 … 4 millones 374 mil 600 negocios»', '2012': 'INEGI, mismo documento: «DENUE 06/2012 … 4 millones 400 mil 943 negocios»',
  '2013-07': 'INEGI, mismo documento: «DENUE 07/2013 … 4 millones 410 mil 199 negocios» (el archivo de la Ciudad de México de esta edición trae 214,154 unidades, la mitad de las de 10/2013)',
  '2013-10': 'Sin cifra publicada: el documento metodológico solo dice que el DENUE Interactivo 10/2013 incorporó el registro en línea', '2015': 'INEGI, DENUE Interactivo 11/2019, documento metodológico (702825192730.pdf): «DENUE Interactivo 01/2015 … 4 millones 926 mil 061 negocios»',
  '2016-01': 'INEGI, DENUE Interactivo 11/2019, documento metodológico: «DENUE Interactivo 01/2016 … 5 millones 4 mil 986 negocios»',
  '2016-10': 'INEGI, DENUE Interactivo 11/2019, documento metodológico: «octava edición … 5 millones 32 mil 503 establecimientos»',
  '2017-03': 'INEGI, DENUE Interactivo 11/2019, documento metodológico: «novena edición … 5 millones 39 mil 911 establecimientos»',
  '2017-11': 'INEGI, DENUE Interactivo 11/2019, documento metodológico: «décima edición … 5 millones 53 mil 130 negocios»',
  '2018-03': 'INEGI, DENUE Interactivo 05/2024, documento metodológico (889463916437.pdf): «undécima en marzo (5 millones 78 mil 737 establecimientos)»',
  '2018-11': 'INEGI, DENUE Interactivo 05/2024, documento metodológico: «duodécima en noviembre (5 millones 81 mil 192)»',
  '2019-04': 'INEGI, DENUE Interactivo 11/2019, documento metodológico: «decimotercera edición … 5 millones 113 mil 397 establecimientos»',
  '2019-11': 'INEGI, comunicado DENUE Interactivo 11/2019 (boletines/2019/OtrTemEcon/DENUE2019.pdf): 5 447 591 negocios',
  '2020-04': 'Sin cifra exacta publicada: el documento metodológico del DENUE Interactivo 04/2020 (702825194987.pdf) dice «más de 5 millones de unidades económicas»',
  '2020-11': 'INEGI, comunicado DENUE Interactivo 11/2020 (boletines/2020/OtrTemEcon/DENUE2020.pdf): 5 546 698 negocios',
  '2021-05': 'INEGI, comunicado DENUE 05/2021 (boletines/2021/OtrTemEcon/DENUE2021_05.pdf): 5 515 863 establecimientos',
  '2021-11': 'INEGI, comunicado 649/21 DENUE Interactivo 11/2021 (boletines/2021/OtrTemEcon/DENUE_2021_11.pdf): 5 529 201 negocios',
  '2022-05': 'INEGI, DENUE Interactivo 05/2024, documento metodológico: «decimonovena edición … 5 millones 528 mil 698 unidades económicas»',
  '2022-11': 'INEGI, comunicado DENUE Interactivo 11/2022 (boletines/2022/denue/denue2022_11.pdf): 5 530 925 unidades económicas',
  '2023-11': 'INEGI, comunicado 705/23 DENUE Interactivo 11/2023 (boletines/2023/denue/denue2023_11.pdf): 5 541 076 establecimientos',
  '2024-05': 'INEGI, comunicado DENUE Interactivo 05/2024 (boletines/2024/denue/denue2024_05.pdf): 5 564 612 establecimientos',
  '2024-11': 'INEGI, comunicado 682/24 DENUE Interactivo 11/2024 (boletines/2024/denue/denue2024_11.pdf): 6 058 548 establecimientos',
  '2025-05': 'INEGI, comunicado DENUE Interactivo 05/2025 (boletines/2025/denue/denue2025_05.pdf): 6 097 675 establecimientos',
  '2026-05': 'INEGI, comunicado DENUE 05/2026 (boletines/2026/denue/denue2026_05.pdf): 6 138 075 establecimientos'}
# Versión del SCIAN: 2010-10/2013 provienen de los Censos Económicos 2009 (SCIAN 2007); el diccionario de 03/2018 declara «SCIAN 2013» (2015-2017 no la declaran; mismas 967 clases); 11/2018 en adelante «SCIAN 2018».
SCIAN_EDICION = lambda ed: '2007' if ed <= '2013-10' else ('2013' if ed <= '2018-03' else '2018')  # 2010-10/2013: Censos Económicos 2009, SCIAN 2007

def scian_de(ed):
    """Versión del SCIAN con que el INEGI codifica la edición (diccionario de datos de cada zip; ver --scian)."""
    return json.loads((RES / f'{ed}.json').read_text()).get('scian', '')

def subir():
    """Parquet completo de cada edición a R2 (denue/historico/<edición>/denue_<edición>.parquet) con HEAD de comprobación."""
    sys.path.insert(0, str(RAIZ / 'scripts')); import inegi_ingesta as ing
    for ed in sorted({x['edicion'] for x in leer_inventario()}):
        ruta = PARQ / f'{ed}.parquet'; clave = f'denue/historico/{ed}/denue_{ed}.parquet' if AMBITO == 'entidad' else f'denue/historico-sector/{ed}/denue_{ed}.parquet'; r = json.loads((RES / f'{ed}.json').read_text())
        if r.get('clave_parquet') == clave and r.get('bytes_parquet') == ruta.stat().st_size:
            try:
                if ing._s3().head_object(Bucket=ing.BUCKET, Key=clave)['ContentLength'] == ruta.stat().st_size: log(f'  {ed}: ya en R2'); continue
            except Exception: pass
        ing.subir(clave, str(ruta), 'application/vnd.apache.parquet'); r['clave_parquet'] = clave; r['bytes_parquet'] = ruta.stat().st_size
        (RES / f'{ed}.json').write_text(json.dumps(r, ensure_ascii=False, indent=1)); log(f'  {ed}: {ruta.stat().st_size / 1048576:.1f} MB subidos a {clave}')

def d1(sql, archivo=True):
    import subprocess, tempfile
    for intento in range(4):
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, dir=str(DIR)) as f: f.write(sql); ruta = f.name
        args = ['npx', 'wrangler', 'd1', 'execute', 'datosmexico-api-denue', '--remote', '--yes'] + (['--file', ruta] if archivo else ['--json', '--command', sql])
        r = subprocess.run(args, capture_output=True, text=True, cwd=RAIZ); os.unlink(ruta)
        if r.returncode == 0: return json.loads(r.stdout)[0]['results'] if not archivo else None
        log(f'wrangler falló (intento {intento + 1}): {(r.stdout + r.stderr)[-300:].strip()}'); time.sleep(20 * (intento + 1))
    sys.exit('wrangler falló cuatro veces')

def q(v): return 'NULL' if v is None else ("'" + str(v).replace("'", "''") + "'" if isinstance(v, str) else str(v))

def cargar_tabla(tabla, campos, filas, donde=None):
    """Reanudable por edición: si el conteo remoto ya es el esperado se salta; si no, borra ese tramo y lo carga en lotes de 400 filas / 8 MB."""
    cond = f' WHERE {donde}' if donde else ''
    if d1(f'SELECT COUNT(*) n FROM {tabla}{cond}', archivo=False)[0]['n'] == len(filas): return 'ya'
    d1(f'DELETE FROM {tabla}{cond};')
    lote = []; tam = 0
    for i in range(0, len(filas), 400):
        st = f"INSERT INTO {tabla} ({', '.join(campos)}) VALUES {','.join('(' + ','.join(q(v) for v in f) + ')' for f in filas[i:i + 400])};\n"
        lote.append(st); tam += len(st)
        if tam > 7_500_000: d1(''.join(lote)); lote = []; tam = 0
    if lote: d1(''.join(lote))
    n = d1(f'SELECT COUNT(*) n FROM {tabla}{cond}', archivo=False)[0]['n']
    if n != len(filas): sys.exit(f'{tabla} {donde}: {n} filas en D1, esperadas {len(filas)}')
    return f'{n:,} filas'

def cargar():
    d1(DDL)
    inv = {x['edicion']: x['periodo_inegi'] for x in leer_inventario()}; eds = sorted(inv)
    cargar_tabla('denue_hist_estratos', ['cod', 'nombre'], sorted([[v, k] for k, v in ESTRATOS.items()]) + [[0, 'No especificado']])
    for k, ed in enumerate(eds):
        r = json.loads((RES / f'{ed}.json').read_text()); assert r['suma_resumen'] == r['unidades'], ed
        filas = list(csv.DictReader(open(RES / f'{ed}.csv')))
        hist = [[ed, f['cve_ent'], f['cve_mun'], f['codigo_act'], int(f['per_ocu_cod']), int(f['n'])] for f in filas]
        ent = C.Counter()
        for f in filas: ent[(f['cve_ent'], f['codigo_act'], int(f['per_ocu_cod']))] += int(f['n'])
        muns = {(f['cve_ent'], f['cve_mun']): (f['entidad'], f['municipio']) for f in filas}; acts = {f['codigo_act']: f['nombre_act'] for f in filas}
        assert sum(x[5] for x in hist) == sum(ent.values()) == r['unidades']
        t0 = time.time()
        a = cargar_tabla('denue_historico', ['edicion', 'cve_ent', 'cve_mun', 'codigo_act', 'per_ocu_cod', 'n'], hist, f"edicion = '{ed}'")
        b = cargar_tabla('denue_hist_entidad', ['edicion', 'cve_ent', 'codigo_act', 'per_ocu_cod', 'n'], [[ed, *k, v] for k, v in sorted(ent.items())], f"edicion = '{ed}'")
        cargar_tabla('denue_hist_municipios', ['edicion', 'cve_ent', 'cve_mun', 'entidad', 'municipio'], [[ed, *k, *v] for k, v in sorted(muns.items())], f"edicion = '{ed}'")
        cargar_tabla('denue_hist_actividades', ['edicion', 'codigo_act', 'nombre_act'], [[ed, k, v] for k, v in sorted(acts.items())], f"edicion = '{ed}'")
        pub = r['publicado']; dif = None if pub is None else r['unidades'] - pub; ver = None if pub is None else int(dif == 0)
        d1(f"INSERT OR REPLACE INTO denue_ediciones VALUES ({q(ed)}, {q(inv[ed])}, {k + 1}, {r['unidades']}, {q(pub)}, {q(dif)}, {q(ver)}, {r['grupos']}, {r['municipios']}, {r['clases']}, {r['archivos']}, {q(SCIAN_EDICION(ed))}, {q(FUENTE_CIFRA.get(ed))}, {q(r['clave_parquet'])}, {r['bytes_parquet']}, {q(('inegi/fuentes/denue-historico-entidad/' if AMBITO == 'entidad' else 'inegi/fuentes/denue-historico/') + ed + '/')});")
        s = d1(f"SELECT SUM(n) n FROM denue_historico WHERE edicion = '{ed}'", archivo=False)[0]['n']
        if s != r['unidades']: sys.exit(f'{ed}: SUM(n) {s} ≠ {r["unidades"]}')
        log(f'  {ed}: histórico {a}, entidad {b}, SUM(n) = {s:,} = unidades ({time.time() - t0:.0f} s)')
    d1('CREATE INDEX IF NOT EXISTS idx_dhe_act ON denue_hist_entidad (codigo_act, edicion);')
    # Nombres estables para los cubos (agrupar por un nombre que cambia entre ediciones partiría las filas): clase → nombre de su última edición; entidad → 05/2026.
    d1("DROP TABLE IF EXISTS denue_hist_act_nombre; CREATE TABLE denue_hist_act_nombre AS SELECT a.codigo_act, a.nombre_act FROM denue_hist_actividades a WHERE a.edicion = (SELECT MAX(b.edicion) FROM denue_hist_actividades b WHERE b.codigo_act = a.codigo_act); CREATE UNIQUE INDEX idx_dhan ON denue_hist_act_nombre (codigo_act); DROP TABLE IF EXISTS denue_hist_ent_nombre; CREATE TABLE denue_hist_ent_nombre AS SELECT cve_ent, MIN(entidad) AS entidad FROM denue_hist_municipios WHERE edicion = (SELECT MAX(edicion) FROM denue_ediciones) GROUP BY cve_ent;")  # un índice sobre los 13.5 M de denue_historico excede la memoria de D1 (SQLITE_NOMEM); su llave primaria empieza por edición, que es filtro obligatorio
    tot = d1('SELECT COUNT(*) e, SUM(unidades) u, SUM(verificado) v FROM denue_ediciones', archivo=False)[0]
    log(f"carga completa: {tot['e']} ediciones, {tot['u']:,} unidades acumuladas, {tot['v']} verificadas exactas")

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--inventario', action='store_true'); ap.add_argument('--descargar', action='store_true')
    ap.add_argument('--espejar', action='store_true'); ap.add_argument('--resumir', action='store_true'); ap.add_argument('--subir', action='store_true'); ap.add_argument('--cargar', action='store_true'); ap.add_argument('--procesos', type=int, default=5); ap.add_argument('--bajar', action='store_true')
    ap.add_argument('--hilos', type=int, default=8); a = ap.parse_args()
    if a.inventario: inventario()
    if a.descargar: descargar(a.hilos)
    if a.espejar: espejar(a.hilos)
    if a.bajar: bajar(a.hilos)
    if a.resumir: resumir(a.procesos)
    if a.subir: subir()
    if a.cargar: cargar()

"""Ingestor genérico de microdatos del INEGI (descarga masiva) → Parquet en R2, con manifiesto verificable.

Universo: data/inegi-universo/archivos.csv (inventario de la API de descarga masiva). Toma las entradas de
la clasificación «microdatos» que son datos (no descriptores PDF/XLSX/HTML), una por archivo lógico, con
preferencia de formato CSV > Stata (dta) > SPSS (sav) > DBF.
Por archivo: descarga el zip original (se guarda su SHA-256 y se sube íntegro a R2 como fuente), extrae,
convierte cada tabla a Parquet (zstd) con tipos inferidos con rigor —todo se lee como texto y una columna
solo pasa a entero/decimal si TODOS sus valores lo son sin ceros a la izquierda, así los códigos (entidad
'01', folios) se conservan como texto—, verifica que las filas del Parquet sean las leídas, sube a R2 con
--remote y escribe una línea por tabla en el manifiesto (con máquina y fecha). Reanudable por id de archivo.
Claves R2: inegi/microdatos/<programa>/<edicion>/<archivo>/<tabla>.parquet e inegi/fuentes/<programa>/<edicion>/<archivo><formato>.
Uso: data/.venv/bin/python scripts/inegi_ingesta.py [--shard k/n] [--workers 4] [--programa TEXTO] [--solo-lista]
"""
import argparse, csv, hashlib, io, json, os, pathlib, re, shutil, socket, subprocess, sys, tempfile, time, unicodedata, urllib.request, zipfile, threading
import concurrent.futures as cf
socket.setdefaulttimeout(180)  # ninguna conexión (INEGI o R2) puede colgar un hilo indefinidamente
import pyarrow as pa, pyarrow.parquet as pq, pyarrow.csv as pcsv, pyarrow.compute as pc
RAIZ = pathlib.Path(__file__).resolve().parent.parent
INV = RAIZ / 'data' / 'inegi-universo' / 'archivos.csv'
BASE = RAIZ / 'data' / 'inegi'; BASE.mkdir(parents=True, exist_ok=True)
MANIF = BASE / f'manifiesto-{socket.gethostname().split(".")[0]}.jsonl'
LOG = BASE / f'ingesta-{socket.gethostname().split(".")[0]}.log'
BUCKET = 'datosmexico-datos'; CUENTA = '1f0e02cff3791c3ffbb95cd155fc4305'
PREF = ['_csv.zip', '_dta.zip', '_stata.zip', '_sav.zip', '_dbf.zip', '_txt.zip']
NO_DATOS = re.compile(r'descriptor|diccionario|cuestionario|manual|nota|metodolog|dise[ñn]o|catálogo de|catalogo de|ejemplo', re.I)
candado = threading.Lock()
csv.field_size_limit(1 << 30)

def token():
    for l in (RAIZ / 'data' / '.secretos.env').read_text().splitlines():
        if l.startswith('CF_CATALOG_TOKEN='): return l.split('=', 1)[1].strip()
    sys.exit('falta CF_CATALOG_TOKEN en data/.secretos.env')
ENV_WR = {**os.environ, 'CLOUDFLARE_API_TOKEN': token(), 'CLOUDFLARE_ACCOUNT_ID': CUENTA}

def log(m):
    with candado:
        with open(LOG, 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {m}\n")

def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    m = re.search(r'\(([a-z0-9\- ]+)\)\s*$', s)
    if m: s = m.group(1)
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s[:60]

COLISIONES = set(); COLISIONES_TAB = set()
def entradas(filtro=None):
    filas = [x for x in csv.DictReader(open(INV, encoding='utf-8')) if x['clasificacion'] == 'microdatos']
    # dos archivos lógicos distintos (id) con el mismo nombre en el mismo programa y edición → la clave lleva el id
    import collections
    grupos = collections.defaultdict(set)
    for x in filas: grupos[(x['programa'], x['anio'], pathlib.Path(x['path']).name)].add(x['id'])
    COLISIONES.update(k for k, v in grupos.items() if len(v) > 1)
    por_id = {}
    for x in filas:
        if x['formato'] not in PREF or NO_DATOS.search(x['titulo']): continue
        if filtro and filtro.lower() not in x['programa'].lower(): continue
        k = x['id']; act = por_id.get(k)
        if act is None or PREF.index(x['formato']) < PREF.index(act['formato']): por_id[k] = x
    return sorted(por_id.values(), key=lambda x: (x['programa'], x['anio'], x['titulo']))

def claves_de(x):
    """(programa_slug, edicion, carpeta_archivo, nombre_zip, clave_fuente) coherentes para el ingestor y el espejo."""
    prog = slug(x['programa']); ed = (x['anio'] or 's-f').replace('|', '-').replace(' ', '_'); ed = re.sub(r'[^A-Za-z0-9_.-]', '_', ed); nombre = pathlib.Path(''.join(ch for ch in x['path'] if ch >= ' ').strip()).name
    arch = slug(nombre) or x['id']; limpio = nombre.replace(' ', '_')  # los nombres con espacios no son claves válidas
    if (x['programa'], x['anio'], nombre) in COLISIONES: arch = f"{arch}-{x['id']}"; zipn = f"{limpio}-{x['id']}{x['formato']}"
    else: zipn = limpio + x['formato']
    return prog, ed, arch, zipn, f'inegi/fuentes/{prog}/{ed}/{zipn}'

def url_de(x):
    p = ''.join(ch for ch in x['path'] if ch >= ' ').strip()  # el inventario trae rutas con caracteres de control
    from urllib.parse import quote
    return quote(('https://www.inegi.org.mx/contenidos' + p if p.startswith('/programas/') else 'https://www.inegi.org.mx' + p) + x['formato'], safe='/:%')

def descargar(url, destino):
    for intento in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (observatorio datosmexico)'}), timeout=300) as r, open(destino, 'wb') as f:
                h = hashlib.sha256(); n = 0; esperado = int(r.headers.get('Content-Length') or 0)
                for b in iter(lambda: r.read(1 << 20), b''): f.write(b); h.update(b); n += len(b)
            if esperado and n != esperado: raise RuntimeError(f'descarga incompleta: {n} de {esperado} bytes')  # el INEGI corta descargas bajo carga
            return h.hexdigest()
        except Exception as e:
            time.sleep(10 * (intento + 1)); ultimo = e
    raise RuntimeError(f'descarga falló: {ultimo}')

def leer_csv(ruta):
    """Lee todo como texto con pyarrow (rápido); devuelve columnas como arreglos de texto."""
    crudo = open(ruta, 'rb').read(); enc = 'utf-8'
    try: crudo.decode('utf-8')
    except UnicodeDecodeError: enc = 'latin-1'
    if crudo.startswith(b'\xef\xbb\xbf'): crudo = crudo[3:]; enc = 'utf-8-sig'
    cab = next(csv.reader(io.StringIO(crudo[:200000].decode(enc, 'replace'))))
    cab = [c.strip() for c in cab]
    t = pcsv.read_csv(io.BytesIO(crudo), read_options=pcsv.ReadOptions(encoding=enc if enc != 'utf-8-sig' else 'utf-8', column_names=cab, skip_rows=1, block_size=64 << 20),
                      parse_options=pcsv.ParseOptions(newlines_in_values=True), convert_options=pcsv.ConvertOptions(column_types={c: pa.string() for c in cab}, strings_can_be_null=False))
    return cab, [t.column(i).combine_chunks() for i in range(t.num_columns)], t.num_rows, enc

def leer_otro(ruta):
    """DBF/Stata/SPSS → CSV temporal en flujo (memoria acotada) → lector pyarrow. Todo se conserva como texto:
    en DBF se toman los bytes crudos de cada campo (latin-1, recortados), así los campos numéricos con texto
    ('N', 'NA', '3 1') y las fechas (AAAAMMDD) quedan tal cual."""
    ext = ruta.suffix.lower(); tmpcsv = ruta.with_suffix(ruta.suffix + '.csv')
    with open(tmpcsv, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        if ext == '.dbf':
            from dbfread import DBF
            d = DBF(str(ruta), raw=True, encoding='latin-1', char_decode_errors='replace', ignore_missing_memofile=True)
            w.writerow(d.field_names)
            for r in d: w.writerow([(v.decode('latin-1', 'replace').strip() if isinstance(v, (bytes, bytearray)) else ('' if v is None else str(v))) for v in r.values()])
            enc = 'dbf'
        else:
            import pyreadstat
            lector = pyreadstat.read_file_in_chunks(pyreadstat.read_dta if ext == '.dta' else pyreadstat.read_sav, str(ruta), chunksize=200000, apply_value_formats=False)
            primero = True
            for df, meta in lector:
                if primero: w.writerow(list(df.columns)); primero = False
                for fila in df.itertuples(index=False, name=None):
                    w.writerow(['' if (v is None or (isinstance(v, float) and v != v)) else (('%d' % v) if (isinstance(v, float) and v.is_integer()) else str(v)) for v in fila])
            enc = ext[1:]
    cab, cols, n, _ = leer_csv(tmpcsv); tmpcsv.unlink()
    return cab, cols, n, enc

INT = re.compile(r'^-?(0|[1-9]\d*)$'); DEC = re.compile(r'^-?(0|[1-9]\d*)?\.\d+$|^-?(0|[1-9]\d*)\.\d*$')
def tipar(valores):
    """Texto → int64 si todos son enteros sin ceros a la izquierda; float64 si todos son decimales; si no, texto."""
    if isinstance(valores, pa.Array):
        arr = pc.utf8_trim_whitespace(valores); arr = pc.if_else(pc.equal(arr, ''), pa.scalar(None, pa.string()), arr)
        if arr.null_count == len(arr): return arr
        def todos(regex): m = pc.match_substring_regex(arr, regex); return pc.all(pc.fill_null(m, True)).as_py()
        if todos(r'^-?(0|[1-9]\d*)$'):
            try: return pc.cast(arr, pa.int64())
            except Exception: pass
        if todos(r'^-?((0|[1-9]\d*)?\.\d+|(0|[1-9]\d*)\.?\d*)([eE][-+]?\d+)?$'):
            try: return pc.cast(arr, pa.float64())
            except Exception: pass
        return arr
    nn = [v for v in valores if v != '']
    if not nn: return pa.array([None] * len(valores), pa.string())
    if all(INT.match(v) for v in nn):
        try: return pa.array([int(v) if v != '' else None for v in valores], pa.int64())
        except OverflowError: pass
    if all(INT.match(v) or DEC.match(v) or re.match(r'^-?\d+(\.\d+)?[eE][-+]?\d+$', v) for v in nn):
        return pa.array([float(v) if v != '' else None for v in valores], pa.float64())
    return pa.array([v if v != '' else None for v in valores], pa.string())

_hilo = threading.local()
def _s3():
    """Cliente S3 de R2 por hilo (las credenciales S3 de un token de R2 son: id del token y SHA-256 del token)."""
    if not hasattr(_hilo, 's3'):
        import boto3
        from botocore.config import Config
        env = dict(l.strip().split('=', 1) for l in (RAIZ / 'data' / '.secretos.env').read_text().splitlines() if '=' in l)
        _hilo.s3 = boto3.client('s3', endpoint_url=f'https://{CUENTA}.r2.cloudflarestorage.com', aws_access_key_id=env['R2_ACCESS_KEY_ID'], aws_secret_access_key=env['R2_SECRET_ACCESS_KEY'], region_name='auto', config=Config(retries={'max_attempts': 5, 'mode': 'standard'}, max_pool_connections=16))
    return _hilo.s3
def subir(clave, ruta, tipo):
    """Sube por la API S3 de R2 (sin el tope de peticiones de la API de Cloudflare) y verifica el tamaño con HEAD."""
    tam = os.path.getsize(ruta); ultimo = ''
    for intento in range(4):
        try:
            with open(ruta, 'rb') as f: _s3().put_object(Bucket=BUCKET, Key=clave, Body=f, ContentType=tipo)
            if _s3().head_object(Bucket=BUCKET, Key=clave)['ContentLength'] == tam: return
            ultimo = 'tamaño distinto tras subir'
        except Exception as e: ultimo = f'{type(e).__name__}: {str(e)[:120]}'
        time.sleep(5 * (intento + 1))
    raise RuntimeError(f'subida falló {clave}: {ultimo}')

def hechos():
    if not MANIF.exists(): return set()
    return {json.loads(l)['id'] for l in open(MANIF) if l.strip() and json.loads(l).get('estado') in ('ok', 'sin_tablas')}

def procesar(x):
    t0 = time.time(); prog, ed, arch, zipn, clave_fuente = claves_de(x)  # ed sin espacios
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='inegi-')); url = url_de(x)
    try:
        zipf = tmp / zipn
        # primero el espejo en R2 (rápido); si no está, el INEGI (y entonces se sube el original a R2)
        try:
            _s3().download_file(BUCKET, clave_fuente, str(zipf))
            with zipfile.ZipFile(zipf) as z: z.testzip() if zipf.stat().st_size < 50_000_000 else z.namelist()  # el espejo pudo guardar una copia truncada
            h = hashlib.sha256()
            with open(zipf, 'rb') as f:
                for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
            sha = h.hexdigest(); origen = 'r2'
        except Exception:
            sha = descargar(url, zipf); origen = 'inegi'; subir(clave_fuente, zipf, 'application/zip')
        # extracción miembro a miembro: algunos zips del INEGI traen nombres con codificación inconsistente
        # (zipfile los rechaza) o compresión no soportada; solo se necesitan los archivos de datos
        with zipfile.ZipFile(zipf) as z:
            for info in z.infolist():
                if info.is_dir() or pathlib.Path(info.filename).suffix.lower() not in ('.csv', '.dta', '.sav', '.dbf', '.zip'): continue  # los zip anidados se extraen después
                destino = tmp / 'x' / info.filename; destino.parent.mkdir(parents=True, exist_ok=True)
                try:
                    with z.open(info) as src, open(destino, 'wb') as dst: shutil.copyfileobj(src, dst, 1 << 20)
                except (zipfile.BadZipFile, NotImplementedError) as e:
                    if info.compress_type == 9:  # Deflate64: se descomprime con el sistema (unzip lo soporta)
                        subprocess.run(['unzip', '-o', '-q', str(zipf), info.filename, '-d', str(tmp / 'x')], check=True)
                    else: raise
        # zips anidados (series de la ENOE, ENSU, MTI…): se extraen hasta dos niveles
        for nivel in range(2):
            anidados = [p for p in (tmp / 'x').rglob('*.zip') if p.is_file()] + [p for p in (tmp / 'x').rglob('*.ZIP') if p.is_file()]
            for z2 in anidados:
                try:
                    with zipfile.ZipFile(z2) as zz: zz.extractall(z2.with_suffix('')); 
                except Exception: subprocess.run(['unzip', '-o', '-q', str(z2), '-d', str(z2.with_suffix(''))])
                z2.unlink()
        # todos los archivos de datos, incluidos los catálogos que acompañan a los microdatos; solo se omiten los diccionarios de variables
        datos = [p for p in (tmp / 'x').rglob('*') if p.is_file() and p.suffix.lower() in ('.csv', '.dta', '.sav', '.dbf') and 'diccionario' not in p.name.lower()]
        if not datos:
            with candado, open(MANIF, 'a') as f: f.write(json.dumps({'id': x['id'], 'estado': 'sin_tablas', 'programa': x['programa'], 'edicion': ed, 'titulo': x['titulo'], 'url': url, 'sha256_zip': sha, 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, ensure_ascii=False) + '\n')
            log(f'sin tablas: {x["programa"][:40]} {ed} {x["titulo"][:40]}'); return
        regs = []; pendientes_subida = []
        for d in sorted(datos):
            cab, cols, n, enc = leer_csv(d) if d.suffix.lower() == '.csv' else leer_otro(d)
            nombres = []; vistos = set()
            for c in cab:
                c2 = re.sub(r'[^0-9a-zA-Z_]+', '_', unicodedata.normalize('NFKD', c).encode('ascii', 'ignore').decode()).strip('_').lower() or 'col'
                while c2 in vistos: c2 += '_'
                vistos.add(c2); nombres.append(c2)
            tabla = pa.table({nombre: tipar(col) for nombre, col in zip(nombres, cols)})
            assert tabla.num_rows == n, (d.name, tabla.num_rows, n)
            tnombre = slug(d.stem) or 'tabla'
            if any(r['tabla'] == tnombre for r in regs): tnombre = slug(str(d.relative_to(tmp / 'x').with_suffix('')).replace('/', '-')) or f'{tnombre}-{len(regs)}'
            parq = tmp / f'{tnombre}.parquet'; pq.write_table(tabla, parq, compression='zstd')
            assert pq.read_metadata(parq).num_rows == n
            clave = f'inegi/microdatos/{prog}/{ed}/{arch}/{tnombre}.parquet'; pendientes_subida.append((clave, parq))
            regs.append({'id': x['id'], 'estado': 'ok', 'programa': x['programa'], 'programa_slug': prog, 'edicion': ed, 'titulo': x['titulo'], 'archivo': arch, 'tabla': tnombre, 'origen': d.name, 'formato': x['formato'], 'codificacion': enc, 'filas': n, 'columnas': tabla.num_columns, 'esquema': [[f.name, str(f.type)] for f in tabla.schema], 'bytes_parquet': parq.stat().st_size, 'clave_r2': clave, 'fuente_r2': clave_fuente, 'origen_descarga': origen, 'url': url, 'sha256_zip': sha, 'maquina': socket.gethostname().split('.')[0], 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
        with cf.ThreadPoolExecutor(min(8, len(pendientes_subida))) as ex:
            list(ex.map(lambda t: subir(t[0], t[1], 'application/vnd.apache.parquet'), pendientes_subida))
        with candado, open(MANIF, 'a') as f:
            for r in regs: f.write(json.dumps(r, ensure_ascii=False) + '\n')
        log(f'ok {x["programa"][:40]} {ed} {x["titulo"][:30]}: {len(regs)} tablas, {sum(r["filas"] for r in regs):,} filas, {time.time()-t0:.0f}s ({origen})')
    except Exception as e:
        log(f'ERROR {x["id"]} {x["programa"][:40]} {ed} {x["titulo"][:30]}: {type(e).__name__}: {str(e)[:160]}')
        with candado, open(MANIF, 'a') as f: f.write(json.dumps({'id': x['id'], 'estado': 'error', 'programa': x['programa'], 'edicion': ed, 'titulo': x['titulo'], 'url': url, 'error': f'{type(e).__name__}: {str(e)[:200]}', 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, ensure_ascii=False) + '\n')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--shard', default='0/1'); ap.add_argument('--workers', type=int, default=4); ap.add_argument('--programa'); ap.add_argument('--solo-lista', action='store_true'); a = ap.parse_args()
    k, n = (int(v) for v in a.shard.split('/'))
    todos = entradas(a.programa); listos = hechos()
    mios = [x for x in todos if int(hashlib.md5(x['id'].encode()).hexdigest(), 16) % n == k and x['id'] not in listos]
    print(f'{len(todos)} archivos de datos en el universo; shard {k}/{n}: {len(mios)} pendientes ({sum(float(x["mb"]) for x in mios)/1024:.2f} GB)', flush=True)
    if a.solo_lista:
        for x in mios[:40]: print(' ', x['programa'][:45], x['anio'], x['formato'], x['mb'], 'MB', x['titulo'][:40])
        return
    log(f'inicio shard {k}/{n}: {len(mios)} archivos, {a.workers} hilos')
    with cf.ThreadPoolExecutor(a.workers) as ex: list(ex.map(procesar, mios))
    log('FIN')

if __name__ == '__main__': main()

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
import pyarrow as pa, pyarrow.parquet as pq
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

def entradas(filtro=None):
    filas = [x for x in csv.DictReader(open(INV, encoding='utf-8')) if x['clasificacion'] == 'microdatos']
    por_id = {}
    for x in filas:
        if x['formato'] not in PREF or NO_DATOS.search(x['titulo']): continue
        if filtro and filtro.lower() not in x['programa'].lower(): continue
        k = x['id']; act = por_id.get(k)
        if act is None or PREF.index(x['formato']) < PREF.index(act['formato']): por_id[k] = x
    return sorted(por_id.values(), key=lambda x: (x['programa'], x['anio'], x['titulo']))

def url_de(x):
    p = x['path']; return ('https://www.inegi.org.mx/contenidos' + p if p.startswith('/programas/') else 'https://www.inegi.org.mx' + p) + x['formato']

def descargar(url, destino):
    for intento in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (observatorio datosmexico)'}), timeout=300) as r, open(destino, 'wb') as f:
                h = hashlib.sha256()
                for b in iter(lambda: r.read(1 << 20), b''): f.write(b); h.update(b)
            return h.hexdigest()
        except Exception as e:
            time.sleep(10 * (intento + 1)); ultimo = e
    raise RuntimeError(f'descarga falló: {ultimo}')

def leer_csv(ruta):
    crudo = open(ruta, 'rb').read()
    for enc in ('utf-8-sig', 'latin-1'):
        try: txt = crudo.decode(enc); break
        except UnicodeDecodeError: continue
    r = csv.reader(io.StringIO(txt)); cab = next(r)
    cab = [c.strip() for c in cab]; cols = [[] for _ in cab]; n = 0
    for fila in r:
        if not fila or (len(fila) == 1 and not fila[0].strip()): continue
        if len(fila) < len(cab): fila = fila + [''] * (len(cab) - len(fila))
        for j in range(len(cab)): cols[j].append(fila[j] if j < len(fila) else '')
        n += 1
    return cab, cols, n, enc

def leer_otro(ruta):
    import pyreadstat
    ext = ruta.suffix.lower()
    if ext == '.dta': df, meta = pyreadstat.read_dta(str(ruta), apply_value_formats=False)
    elif ext == '.sav': df, meta = pyreadstat.read_sav(str(ruta), apply_value_formats=False)
    elif ext == '.dbf':
        from dbfread import DBF, FieldParser
        class ParserTolerante(FieldParser):
            # campos numéricos con texto ('N', 'NA', '3 1', 'NSS'): se conserva el texto tal cual en vez de fallar
            def parseN(self, field, data):
                try: return super().parseN(field, data)
                except ValueError: return data.decode('latin-1', 'replace').strip()
            def parseF(self, field, data):
                try: return super().parseF(field, data)
                except ValueError: return data.decode('latin-1', 'replace').strip()
        regs = list(DBF(str(ruta), encoding='latin-1', char_decode_errors='replace', parserclass=ParserTolerante))
        cab = list(regs[0].keys()) if regs else []
        cols = [[('' if r[c] is None else str(r[c])) for r in regs] for c in cab]
        return cab, cols, len(regs), 'dbf'
    else: raise RuntimeError(f'formato no soportado {ext}')
    cab = list(df.columns); cols = [['' if (v is None or (isinstance(v, float) and v != v)) else str(v) for v in df[c].tolist()] for c in cab]
    return cab, cols, len(df), ext[1:]

INT = re.compile(r'^-?(0|[1-9]\d*)$'); DEC = re.compile(r'^-?(0|[1-9]\d*)?\.\d+$|^-?(0|[1-9]\d*)\.\d*$')
def tipar(valores):
    """Texto → int64 si todos son enteros sin ceros a la izquierda; float64 si todos son decimales; si no, texto."""
    nn = [v for v in valores if v != '']
    if not nn: return pa.array([None] * len(valores), pa.string())
    if all(INT.match(v) for v in nn):
        try: return pa.array([int(v) if v != '' else None for v in valores], pa.int64())
        except OverflowError: pass
    if all(INT.match(v) or DEC.match(v) or re.match(r'^-?\d+(\.\d+)?[eE][-+]?\d+$', v) for v in nn):
        return pa.array([float(v) if v != '' else None for v in valores], pa.float64())
    return pa.array([v if v != '' else None for v in valores], pa.string())

def subir(clave, ruta, tipo):
    """PUT a la API REST de R2 (la misma que usa wrangler) con el token; se verifica el tamaño devuelto."""
    from urllib.parse import quote
    tam = os.path.getsize(ruta); ultimo = ''
    for intento in range(4):
        try:
            with open(ruta, 'rb') as f:
                req = urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{CUENTA}/r2/buckets/{BUCKET}/objects/{quote(clave)}', data=f, method='PUT', headers={'Authorization': f'Bearer {ENV_WR["CLOUDFLARE_API_TOKEN"]}', 'Content-Type': tipo, 'Content-Length': str(tam)})
                d = json.loads(urllib.request.urlopen(req, timeout=1800).read())
            if d.get('success') and int(d['result'].get('size', -1)) == tam: return
            ultimo = str(d)[:200]
        except Exception as e: ultimo = f'{type(e).__name__}: {str(e)[:120]}'
        time.sleep(10 * (intento + 1))
    raise RuntimeError(f'subida falló {clave}: {ultimo}')

def hechos():
    if not MANIF.exists(): return set()
    return {json.loads(l)['id'] for l in open(MANIF) if l.strip() and json.loads(l).get('estado') in ('ok', 'sin_tablas')}

def procesar(x):
    t0 = time.time(); prog = slug(x['programa']); ed = (x['anio'] or 's-f').replace('|', '-'); arch = slug(pathlib.Path(x['path']).name) or x['id']
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='inegi-')); url = url_de(x)
    try:
        zipf = tmp / (pathlib.Path(x['path']).name + x['formato']); sha = descargar(url, zipf)
        subir(f'inegi/fuentes/{prog}/{ed}/{zipf.name}', zipf, 'application/zip')
        with zipfile.ZipFile(zipf) as z: z.extractall(tmp / 'x')
        datos = [p for p in (tmp / 'x').rglob('*') if p.is_file() and p.suffix.lower() in ('.csv', '.dta', '.sav', '.dbf') and 'diccionario' not in str(p).lower() and 'catalogo' not in str(p).lower()]
        if not datos:
            with candado, open(MANIF, 'a') as f: f.write(json.dumps({'id': x['id'], 'estado': 'sin_tablas', 'programa': x['programa'], 'edicion': ed, 'titulo': x['titulo'], 'url': url, 'sha256_zip': sha, 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, ensure_ascii=False) + '\n')
            log(f'sin tablas: {x["programa"][:40]} {ed} {x["titulo"][:40]}'); return
        regs = []
        for d in sorted(datos):
            cab, cols, n, enc = leer_csv(d) if d.suffix.lower() == '.csv' else leer_otro(d)
            nombres = []; vistos = set()
            for c in cab:
                c2 = re.sub(r'[^0-9a-zA-Z_]+', '_', unicodedata.normalize('NFKD', c).encode('ascii', 'ignore').decode()).strip('_').lower() or 'col'
                while c2 in vistos: c2 += '_'
                vistos.add(c2); nombres.append(c2)
            tabla = pa.table({nombre: tipar(col) for nombre, col in zip(nombres, cols)})
            assert tabla.num_rows == n, (d.name, tabla.num_rows, n)
            tnombre = slug(d.stem) or 'tabla'; parq = tmp / f'{tnombre}.parquet'; pq.write_table(tabla, parq, compression='zstd')
            assert pq.read_metadata(parq).num_rows == n
            clave = f'inegi/microdatos/{prog}/{ed}/{arch}/{tnombre}.parquet'; subir(clave, parq, 'application/vnd.apache.parquet')
            regs.append({'id': x['id'], 'estado': 'ok', 'programa': x['programa'], 'programa_slug': prog, 'edicion': ed, 'titulo': x['titulo'], 'archivo': arch, 'tabla': tnombre, 'origen': d.name, 'formato': x['formato'], 'codificacion': enc, 'filas': n, 'columnas': tabla.num_columns, 'esquema': [[f.name, str(f.type)] for f in tabla.schema], 'bytes_parquet': parq.stat().st_size, 'clave_r2': clave, 'fuente_r2': f'inegi/fuentes/{prog}/{ed}/{zipf.name}', 'url': url, 'sha256_zip': sha, 'maquina': socket.gethostname().split('.')[0], 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
        with candado, open(MANIF, 'a') as f:
            for r in regs: f.write(json.dumps(r, ensure_ascii=False) + '\n')
        log(f'ok {x["programa"][:40]} {ed} {x["titulo"][:30]}: {len(regs)} tablas, {sum(r["filas"] for r in regs):,} filas, {time.time()-t0:.0f}s')
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

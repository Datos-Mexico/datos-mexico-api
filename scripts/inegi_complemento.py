"""Pasada complementaria sobre las fuentes ya archivadas en R2: ingiere los archivos de datos que la regla
vigente del ingestor acepta y que no están en los manifiestos.

Motivo: durante la primera parte de la ingesta masiva el ingestor omitía los archivos cuya ruta contenía
«catalogo» (los catálogos de códigos que acompañan a los microdatos); la regla vigente solo omite los
diccionarios de variables. Esta pasada revisa TODOS los paquetes del universo contra la regla vigente: lista los
miembros de cada zip original (y de los zip anidados, hasta dos niveles) y procesa únicamente los que faltan, con
la misma lectura, tipado, nomenclatura y verificación que scripts/inegi_ingesta.py. No descarga nada del INEGI:
las fuentes se leen del espejo en R2. Las tablas nuevas se registran en el manifiesto de esta máquina con la
marca `complemento`. Reanudable (data/inegi/complemento-revisados.txt).
Uso: data/.venv/bin/python scripts/inegi_complemento.py [--workers 8] [--programa TEXTO]
"""
import argparse, collections, glob, json, pathlib, re, shutil, socket, subprocess, sys, tempfile, time, unicodedata, zipfile, threading
import concurrent.futures as cf
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import inegi_ingesta as ing
import pyarrow as pa, pyarrow.parquet as pq
RAIZ = ing.RAIZ; BASE = ing.BASE
REVISADOS = BASE / 'complemento-revisados.txt'
LOG = BASE / f'complemento-{socket.gethostname().split(".")[0]}.log'
MARCA = 'catalogos-2026-09-20'
EXT = ('.csv', '.dta', '.sav', '.dbf')
candado = threading.Lock()

def log(m):
    with candado:
        with open(LOG, 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {m}\n")

def manifiestos():
    """id → filas ok de todos los manifiestos (Mac y HP)."""
    por_id = collections.defaultdict(list)
    for f in glob.glob(str(BASE / 'manifiesto-*.jsonl')):
        for l in open(f):
            if l.strip():
                r = json.loads(l)
                if r.get('estado') == 'ok': por_id[r['id']].append(r)
    return por_id

def acepta(nombre):
    return pathlib.Path(nombre).suffix.lower() in EXT and 'diccionario' not in pathlib.Path(nombre).name.lower()

def extraer_miembro(z, info, zipf, destino_dir):
    destino = destino_dir / info.filename; destino.parent.mkdir(parents=True, exist_ok=True)
    try:
        with z.open(info) as src, open(destino, 'wb') as dst: shutil.copyfileobj(src, dst, 1 << 20)
    except (zipfile.BadZipFile, NotImplementedError):
        if info.compress_type == 9: subprocess.run(['unzip', '-o', '-q', str(zipf), info.filename, '-d', str(destino_dir)], check=True)
        else: raise
    return destino

def miembros_y_faltantes(zipf, raiz, faltan_de, nivel=0):
    """Lista los miembros de datos del zip (recursivo en zips anidados) y extrae solo los que faltan.
    faltan_de: Counter mutable nombre_base → cuántos faltan. Devuelve (lista de nombres de datos, rutas extraídas)."""
    nombres, extraidos = [], []
    try: z = zipfile.ZipFile(zipf)
    except zipfile.BadZipFile:
        # nombres con codificación inconsistente: se listan con el sistema y se extrae todo lo de datos
        sal = subprocess.run(['unzip', '-Z1', str(zipf)], capture_output=True, text=True, errors='replace').stdout.splitlines()
        subprocess.run(['unzip', '-o', '-q', str(zipf), '-d', str(raiz)], stderr=subprocess.DEVNULL)
        for n in sal:
            if acepta(n): nombres.append(pathlib.Path(n).name); p = raiz / n
            if acepta(n) and p.is_file() and faltan_de[pathlib.Path(n).name] > 0: faltan_de[pathlib.Path(n).name] -= 1; extraidos.append(p)
        return nombres, extraidos
    with z:
        for info in z.infolist():
            if info.is_dir(): continue
            suf = pathlib.Path(info.filename).suffix.lower()
            if suf == '.zip' and nivel < 2:
                sub = extraer_miembro(z, info, zipf, raiz / 'z' / str(nivel))
                n2, e2 = miembros_y_faltantes(sub, sub.with_suffix(''), faltan_de, nivel + 1)
                nombres += n2; extraidos += e2; sub.unlink(missing_ok=True)
            elif acepta(info.filename):
                base = pathlib.Path(info.filename).name; nombres.append(base)
                if faltan_de[base] > 0: faltan_de[base] -= 1; extraidos.append(extraer_miembro(z, info, zipf, raiz / 'x'))
    return nombres, extraidos

def procesar(x, previos):
    t0 = time.time(); prog, ed, arch, zipn, clave_fuente = ing.claves_de(x)
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='inegi-c-'))
    try:
        zipf = tmp / zipn; ing._s3().download_file(ing.BUCKET, clave_fuente, str(zipf))
        # primera pasada: solo listar (para saber qué falta); segunda: extraer lo que falta
        previos = list({r['tabla']: r for r in previos}.values())  # el mismo paquete puede estar en el manifiesto de más de una máquina
        en_manif = collections.Counter(r['origen'] for r in previos)
        nombres, _ = miembros_y_faltantes(zipf, tmp / 'l', collections.Counter(), 0)
        shutil.rmtree(tmp / 'l', ignore_errors=True)
        en_zip = collections.Counter(nombres)
        faltan = collections.Counter({n: c - en_manif[n] for n, c in en_zip.items() if c > en_manif[n]})
        sobran = {n: en_manif[n] - en_zip.get(n, 0) for n in en_manif if en_manif[n] > en_zip.get(n, 0)}
        if sobran: log(f'AVISO {x["id"]} {prog} {ed} {arch}: en manifiesto y no en zip: {sobran}')
        if not faltan:
            with candado, open(REVISADOS, 'a') as f: f.write(f'{x["id"]}\tcompleto\t{len(nombres)}\n')
            return 0
        _, extraidos = miembros_y_faltantes(zipf, tmp, collections.Counter(faltan), 0)
        regs = []; tablas_usadas = {r['tabla'] for r in previos}; pendientes = []
        sha = previos[0]['sha256_zip'] if previos else None
        ilegibles = []
        for d in sorted(extraidos):
            try: cab, cols, n, enc = ing.leer_csv(d) if d.suffix.lower() == '.csv' else ing.leer_otro(d)
            except Exception as e:  # el INEGI publica algunos catálogos con extensión .dbf que no son DBF válidos: se documentan y se conserva el original
                ilegibles.append({'id': x['id'], 'estado': 'ilegible', 'programa': x['programa'], 'programa_slug': prog, 'edicion': ed, 'titulo': x['titulo'], 'archivo': arch, 'origen': d.name, 'bytes': d.stat().st_size, 'cabecera_hex': open(d, 'rb').read(16).hex(), 'fuente_r2': clave_fuente, 'error': f'{type(e).__name__}: {str(e)[:160]}', 'complemento': MARCA, 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
                log(f'ILEGIBLE {prog} {ed} {arch} {d.name}: {type(e).__name__}: {str(e)[:100]}'); continue
            nombres_c = []; vistos = set()
            for c in cab:
                c2 = re.sub(r'[^0-9a-zA-Z_]+', '_', unicodedata.normalize('NFKD', c).encode('ascii', 'ignore').decode()).strip('_').lower() or 'col'
                while c2 in vistos: c2 += '_'
                vistos.add(c2); nombres_c.append(c2)
            tabla = pa.table({nombre: ing.tipar(col) for nombre, col in zip(nombres_c, cols)})
            assert tabla.num_rows == n, (d.name, tabla.num_rows, n)
            tnombre = ing.slug(d.stem) or 'tabla'
            if tnombre in tablas_usadas:
                rel = d.relative_to(tmp); tnombre = ing.slug(str(rel.with_suffix('')).replace('/', '-')) or f'{tnombre}-{len(regs)}'
                while tnombre in tablas_usadas: tnombre += '-c'
            tablas_usadas.add(tnombre)
            parq = tmp / f'{tnombre}.parquet'; pq.write_table(tabla, parq, compression='zstd')
            assert pq.read_metadata(parq).num_rows == n
            clave = f'inegi/microdatos/{prog}/{ed}/{arch}/{tnombre}.parquet'; pendientes.append((clave, parq))
            regs.append({'id': x['id'], 'estado': 'ok', 'programa': x['programa'], 'programa_slug': prog, 'edicion': ed, 'titulo': x['titulo'], 'archivo': arch, 'tabla': tnombre, 'origen': d.name, 'formato': x['formato'], 'codificacion': enc, 'filas': n, 'columnas': tabla.num_columns, 'esquema': [[f.name, str(f.type)] for f in tabla.schema], 'bytes_parquet': parq.stat().st_size, 'clave_r2': clave, 'fuente_r2': clave_fuente, 'origen_descarga': 'r2', 'url': ing.url_de(x), 'sha256_zip': sha, 'maquina': socket.gethostname().split('.')[0], 'complemento': MARCA, 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
        if pendientes:
            with cf.ThreadPoolExecutor(min(8, len(pendientes))) as ex: list(ex.map(lambda t: ing.subir(t[0], t[1], 'application/vnd.apache.parquet'), pendientes))
        with candado:
            with open(ing.MANIF, 'a') as f:
                for r in regs + ilegibles: f.write(json.dumps(r, ensure_ascii=False) + '\n')
            with open(REVISADOS, 'a') as f: f.write(f'{x["id"]}\tcomplementado\t{len(regs)}\t{len(ilegibles)} ilegibles\n')
        log(f'ok {prog} {ed} {arch}: +{len(regs)} tablas ({", ".join(r["tabla"] for r in regs)[:120]}), {sum(r["filas"] for r in regs):,} filas, {time.time()-t0:.0f}s')
        return len(regs)
    except Exception as e:
        log(f'ERROR {x["id"]} {prog} {ed} {arch}: {type(e).__name__}: {str(e)[:200]}'); return -1
    finally: shutil.rmtree(tmp, ignore_errors=True)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--workers', type=int, default=8); ap.add_argument('--programa'); a = ap.parse_args()
    todos = ing.entradas(a.programa); manif = manifiestos()
    revisados = {l.split('\t')[0] for l in open(REVISADOS)} if REVISADOS.exists() else set()
    mios = [x for x in todos if x['id'] not in revisados]
    print(f'{len(todos)} paquetes; {len(mios)} por revisar', flush=True); log(f'inicio: {len(mios)} paquetes, {a.workers} hilos')
    with cf.ThreadPoolExecutor(a.workers) as ex: res = list(ex.map(lambda x: procesar(x, manif.get(x['id'], [])), mios))
    log(f'FIN: {sum(r for r in res if r > 0)} tablas nuevas en {sum(1 for r in res if r > 0)} paquetes; {sum(1 for r in res if r < 0)} errores')
    print('FIN', flush=True)

if __name__ == '__main__': main()

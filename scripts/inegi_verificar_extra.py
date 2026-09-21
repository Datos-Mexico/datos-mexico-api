"""Verificación independiente de los archivos ingeridos fuera de la descarga masiva (inegi_ingesta.py --extra):
por cada archivo del manifiesto con origen_descarga insp o de un programa del CSV extra, descarga el original de R2,
recalcula su SHA-256 (= manifiesto), cuenta las filas de cada tabla leyendo el original con otra librería
(Stata: pyreadstat metadata; DBF: dbfread; CSV: csv), y comprueba con HEAD en R2 (API S3, nunca el almacén local
de wrangler) que cada Parquet existe y que sus filas (metadatos Parquet) son las del manifiesto.
Uso: data/.venv/bin/python scripts/inegi_verificar_extra.py data/inegi/fuera-descarga-masiva.csv
"""
import csv, glob, hashlib, io, json, pathlib, shutil, subprocess, sys, tempfile, zipfile
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent)); import inegi_ingesta as g
import pyarrow.parquet as pq
csv.field_size_limit(1 << 30)

def filas_original(ruta):
    ext = ruta.suffix.lower()
    if ext in ('.dta', '.sav'):
        import pyreadstat; leer = pyreadstat.read_dta if ext == '.dta' else pyreadstat.read_sav
        try: _, meta = leer(str(ruta), metadataonly=True)
        except pyreadstat.ReadstatError: _, meta = leer(str(ruta), metadataonly=True, encoding='latin1')
        return meta.number_rows
    if ext == '.dbf':
        from dbfread import DBF; return len(DBF(str(ruta), raw=True, ignore_missing_memofile=True))
    if ext == '.csv':
        crudo = open(ruta, 'rb').read()
        try: txt = crudo.decode('utf-8-sig')
        except UnicodeDecodeError: txt = crudo.decode('latin-1')
        return sum(1 for _ in csv.reader(io.StringIO(txt))) - 1
    return None

def main():
    extra = {r['id'] for r in csv.DictReader(open(sys.argv[1], encoding='utf-8')) if r['es_datos'] == '1'}
    regs = [json.loads(l) for f in glob.glob(str(g.BASE / 'manifiesto-*.jsonl')) for l in open(f) if l.strip()]
    ult = {}  # la versión vigente de cada tabla (la más reciente por id+tabla), como hace el catálogo
    for r in regs:
        if r.get('estado') == 'ok' and r['id'] in extra and ((r['id'], r['tabla']) not in ult or r['ts'] >= ult[(r['id'], r['tabla'])]['ts']): ult[(r['id'], r['tabla'])] = r
    por_fuente = {}
    for r in ult.values(): por_fuente.setdefault(r['fuente_r2'], []).append(r)
    s3 = g._s3(); fallos = []; n_tablas = 0; n_filas = 0
    for fuente, tablas in sorted(por_fuente.items()):
        tmp = pathlib.Path(tempfile.mkdtemp(prefix='verif-'))
        try:
            zipf = tmp / 'o.zip'; s3.download_file(g.BUCKET, fuente, str(zipf))
            h = hashlib.sha256(open(zipf, 'rb').read()).hexdigest()
            if h != tablas[0]['sha256_zip']: fallos.append(('sha', fuente, h, tablas[0]['sha256_zip']))
            with zipfile.ZipFile(zipf) as z:
                for info in z.infolist():
                    if not info.is_dir() and pathlib.Path(info.filename).suffix.lower() in ('.csv', '.dta', '.sav', '.dbf', '.zip'):
                        d = tmp / 'x' / info.filename; d.parent.mkdir(parents=True, exist_ok=True)
                        try:
                            with z.open(info) as a, open(d, 'wb') as b: shutil.copyfileobj(a, b)
                        except Exception: subprocess.run(['unzip', '-o', '-q', str(zipf), info.filename, '-d', str(tmp / 'x')])
            for _ in range(2):
                for z2 in list((tmp / 'x').rglob('*.zip')) + list((tmp / 'x').rglob('*.ZIP')):
                    subprocess.run(['unzip', '-o', '-q', str(z2), '-d', str(z2.with_suffix(''))]); z2.unlink()
            originales = {p.name: p for p in (tmp / 'x').rglob('*') if p.is_file()}
            for t in tablas:
                o = originales.get(t['origen'])
                n = filas_original(o) if o else None
                if n != t['filas']: fallos.append(('filas_original', t['clave_r2'], n, t['filas']))
                try:
                    cab = s3.head_object(Bucket=g.BUCKET, Key=t['clave_r2'])
                    if cab['ContentLength'] != t['bytes_parquet']: fallos.append(('bytes_parquet_r2', t['clave_r2'], cab['ContentLength'], t['bytes_parquet']))
                    cuerpo = s3.get_object(Bucket=g.BUCKET, Key=t['clave_r2'])['Body'].read()
                    np_ = pq.read_metadata(io.BytesIO(cuerpo)).num_rows
                    if np_ != t['filas']: fallos.append(('filas_parquet_r2', t['clave_r2'], np_, t['filas']))
                except Exception as e: fallos.append(('r2', t['clave_r2'], str(e)[:100], ''))
                n_tablas += 1; n_filas += t['filas']
        finally: shutil.rmtree(tmp, ignore_errors=True)
        print(f'{fuente}: {len(tablas)} tablas verificadas', flush=True)
    print(f'{len(por_fuente)} originales, {n_tablas} tablas, {n_filas:,} filas; FALLOS {len(fallos)}')
    for f in fallos: print(' ', f)
if __name__ == '__main__': main()

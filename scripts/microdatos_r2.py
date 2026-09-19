"""Publica los microdatos de la ENOE en R2, un archivo Parquet por tabla y trimestre.

Flujo por (tabla, periodo): Neon → CSV comprimido (psql \\copy) → Parquet (pyarrow, tipos tomados del
esquema Postgres: los códigos con ceros a la izquierda se conservan como texto) → verificación de
conteo contra Neon → subida a R2 con wrangler → registro en data/enoe/microdatos/manifiesto.jsonl.
Reanudable: los archivos ya registrados en el manifiesto se saltan.
"""
import re, json, subprocess, pathlib, sys, os, time, gzip, io
RAIZ = pathlib.Path(__file__).resolve().parent.parent
BASE = RAIZ / 'data/enoe/microdatos'; BASE.mkdir(parents=True, exist_ok=True)
MANIF = BASE / 'manifiesto.jsonl'
TABLAS = ['viv', 'hog', 'sdem', 'coe1', 'coe2']
import pyarrow as pa, pyarrow.csv as pcsv, pyarrow.parquet as pq

def url_neon():
    for line in open(pathlib.Path.home() / 'datos-itam/api/.env.neon'):
        if line.startswith('DATABASE_URL='):
            u = line.split('=', 1)[1].strip().strip('"').strip("'").replace('postgresql+asyncpg://', 'postgresql://')
            u = re.sub(r'[?&]ssl=(require|true)', '', u).rstrip('$'); return u + ('&' if '?' in u else '?') + 'sslmode=require'
PG = url_neon(); os.environ['PGCONNECT_TIMEOUT'] = '30'

def tipos_tabla(tabla_real):
    """columna → tipo pyarrow, a partir de docs/legacy/enoe-postgres-schema.md"""
    tipos = {}; sec = None
    for line in open(RAIZ / 'docs/legacy/enoe-postgres-schema.md', encoding='utf-8'):
        if line.startswith('# enoe — columnas'): sec = 'col'; continue
        if line.startswith('# enoe — constraints'): break
        if sec == 'col' and line.startswith(tabla_real + ' | '):
            t, c, ty, nul, df = [x.strip() for x in line.split(' | ', 4)]; ty = ty.lower()
            if ty.startswith('smallint'): tipos[c] = pa.int16()
            elif ty.startswith('integer'): tipos[c] = pa.int32()
            elif ty.startswith('bigint'): tipos[c] = pa.int64()
            elif ty.startswith(('numeric', 'double', 'real')): tipos[c] = pa.float64()
            elif ty.startswith('boolean'): tipos[c] = pa.bool_()
            else: tipos[c] = pa.string()
    return tipos

def hechos():
    if not MANIF.exists(): return set()
    return {(j['tabla'], j['periodo']) for j in map(json.loads, open(MANIF)) if j.get('ok')}

def periodos(tabla_real):
    out = subprocess.check_output(['psql', PG, '-Atc', f"select periodo, count(*) from enoe.{tabla_real} group by periodo order by periodo"], text=True)
    return [(p, int(n)) for p, n in (l.split('|') for l in out.strip().splitlines())]

def procesar(tabla, periodo, esperado, tipos):
    real = f'microdatos_{tabla}'; d = BASE / tabla; d.mkdir(exist_ok=True)
    csvgz = d / f'{periodo}.csv.gz'; parq = d / f'{periodo}.parquet'
    t0 = time.time()
    # copia a STDOUT y se comprime aquí (la ruta del proyecto lleva espacio; nunca se pasa por un shell)
    with gzip.open(csvgz, 'wb', compresslevel=1) as out:
        proc = subprocess.Popen(['psql', PG, '-Atc', f"\\copy (select * from enoe.{real} where periodo='{periodo}') to STDOUT with (format csv, header true, null '\\N')"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for bloque in iter(lambda: proc.stdout.read(1 << 20), b''): out.write(bloque)
        err = proc.stderr.read().decode(errors='replace'); proc.wait()
        if proc.returncode: raise RuntimeError(f'psql falló ({proc.returncode}): {err[-200:]}')
    t1 = time.time()
    with gzip.open(csvgz, 'rb') as f:
        tabla_pa = pcsv.read_csv(f, read_options=pcsv.ReadOptions(block_size=64 << 20), parse_options=pcsv.ParseOptions(newlines_in_values=True),
                                 convert_options=pcsv.ConvertOptions(column_types=tipos, null_values=['\\N'], strings_can_be_null=True, quoted_strings_can_be_null=False))
    n = tabla_pa.num_rows
    if n != esperado: raise RuntimeError(f'{tabla} {periodo}: {n} filas leídas, Neon dice {esperado}')
    pq.write_table(tabla_pa, parq, compression='zstd')
    t2 = time.time()
    clave = f'enoe/microdatos/{tabla}/{periodo}.parquet'
    r = subprocess.run(['npx', 'wrangler', 'r2', 'object', 'put', f'datosmexico-datos/{clave}', '--remote', '--file', str(parq), '--content-type', 'application/vnd.apache.parquet'], cwd=RAIZ, capture_output=True, text=True)
    if r.returncode or 'Upload complete' not in (r.stdout + r.stderr):
        raise RuntimeError(f'subida falló {clave}: {(r.stdout + r.stderr)[-300:]}')
    t3 = time.time()
    tam = parq.stat().st_size
    csvgz.unlink()
    with open(MANIF, 'a') as m:
        m.write(json.dumps({'tabla': tabla, 'periodo': periodo, 'filas': n, 'columnas': tabla_pa.num_columns, 'bytes_parquet': tam, 'clave_r2': clave, 'ok': True,
                            's_export': round(t1 - t0, 1), 's_parquet': round(t2 - t1, 1), 's_subida': round(t3 - t2, 1), 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}) + '\n')
    print(f"{time.strftime('%H:%M:%S')} {tabla} {periodo} {n} filas {tam/1e6:.1f} MB ({t1-t0:.0f}s+{t2-t1:.0f}s+{t3-t2:.0f}s)", flush=True)

def main(solo=None):
    listos = hechos()
    for tabla in (solo or TABLAS):
        tipos = tipos_tabla(f'microdatos_{tabla}')
        for periodo, esperado in periodos(f'microdatos_{tabla}'):
            if (tabla, periodo) in listos: continue
            for intento in range(3):
                try: procesar(tabla, periodo, esperado, tipos); break
                except Exception as e:
                    print(f"{time.strftime('%H:%M:%S')} ERROR {tabla} {periodo} intento {intento+1}: {e}", flush=True); time.sleep(10)
    print('FIN', flush=True)

if __name__ == '__main__': main(sys.argv[1:] or None)

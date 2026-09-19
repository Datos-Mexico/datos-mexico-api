"""Variante de microdatos_r2.py con UNA sola lectura de la tabla en Neon.

microdatos_r2.py exporta trimestre por trimestre con `where periodo=…`; sin índice por periodo
cada exportación recorre la tabla completa (sdem: ~40 M filas, 11-21 min por trimestre, ~80
trimestres). Aquí la tabla se copia entera una vez (\\copy … to STDOUT) y las filas se reparten
en un CSV comprimido por trimestre según la columna `periodo`; después cada trimestre sigue el
mismo camino que en microdatos_r2.py (Parquet con tipos del esquema, conteo contra Neon, subida
a R2, manifiesto). Mismos archivos, mismas claves R2 y mismo manifiesto; reanudable: los
trimestres ya registrados no se vuelven a subir.
Uso: data/.venv/bin/python scripts/microdatos_r2_tabla.py <tabla>
"""
import csv, gzip, io, json, pathlib, subprocess, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import microdatos_r2 as m
import pyarrow.csv as pcsv, pyarrow.parquet as pq

def repartir(tabla, real, listos):
    d = m.BASE / tabla; d.mkdir(exist_ok=True)
    t0 = time.time(); salidas = {}; escritores = {}; n = 0; idx = None; cab = None
    proc = subprocess.Popen(['psql', m.PG, '-Atc', f"\\copy (select * from enoe.{real}) to STDOUT with (format csv, header true, null '\\N')"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    lector = csv.reader(io.TextIOWrapper(proc.stdout, encoding='utf-8', newline=''))
    for fila in lector:
        if cab is None:
            cab = fila; idx = cab.index('periodo'); continue
        p = fila[idx]
        if (tabla, p) in listos: continue
        if p not in escritores:
            f = gzip.open(d / f'{p}.csv.gz', 'wt', compresslevel=1, encoding='utf-8', newline='')
            w = csv.writer(f); w.writerow(cab); salidas[p] = f; escritores[p] = w
        escritores[p].writerow(fila); n += 1
        if n % 5_000_000 == 0: print(f"{time.strftime('%H:%M:%S')} {tabla} {n} filas repartidas", flush=True)
    err = proc.stderr.read().decode(errors='replace'); proc.wait()
    for f in salidas.values(): f.close()
    if proc.returncode: raise RuntimeError(f'psql falló ({proc.returncode}): {err[-200:]}')
    print(f"{time.strftime('%H:%M:%S')} {tabla} lectura única: {n} filas en {len(salidas)} trimestres, {time.time()-t0:.0f}s", flush=True)
    return sorted(salidas)

def publicar(tabla, periodo, esperado, tipos):
    d = m.BASE / tabla; csvgz = d / f'{periodo}.csv.gz'; parq = d / f'{periodo}.parquet'; t1 = time.time()
    with gzip.open(csvgz, 'rb') as f:
        tabla_pa = pcsv.read_csv(f, read_options=pcsv.ReadOptions(block_size=64 << 20), parse_options=pcsv.ParseOptions(newlines_in_values=True),
                                 convert_options=pcsv.ConvertOptions(column_types=tipos, null_values=['\\N'], strings_can_be_null=True, quoted_strings_can_be_null=False))
    n = tabla_pa.num_rows
    if n != esperado: raise RuntimeError(f'{tabla} {periodo}: {n} filas leídas, Neon dice {esperado}')
    pq.write_table(tabla_pa, parq, compression='zstd'); t2 = time.time()
    clave = f'enoe/microdatos/{tabla}/{periodo}.parquet'
    r = subprocess.run(['npx', 'wrangler', 'r2', 'object', 'put', f'datosmexico-datos/{clave}', '--file', str(parq), '--content-type', 'application/vnd.apache.parquet'], cwd=m.RAIZ, capture_output=True, text=True)
    if r.returncode or 'Upload complete' not in (r.stdout + r.stderr): raise RuntimeError(f'subida falló {clave}: {(r.stdout + r.stderr)[-300:]}')
    t3 = time.time(); tam = parq.stat().st_size; csvgz.unlink()
    with open(m.MANIF, 'a') as mf:
        mf.write(json.dumps({'tabla': tabla, 'periodo': periodo, 'filas': n, 'columnas': tabla_pa.num_columns, 'bytes_parquet': tam, 'clave_r2': clave, 'ok': True,
                             's_export': 0, 's_parquet': round(t2 - t1, 1), 's_subida': round(t3 - t2, 1), 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'lectura_unica': True}) + '\n')
    print(f"{time.strftime('%H:%M:%S')} {tabla} {periodo} {n} filas {tam/1e6:.1f} MB ({t2-t1:.0f}s+{t3-t2:.0f}s)", flush=True)

def main(tabla):
    real = f'microdatos_{tabla}'; listos = m.hechos(); tipos = m.tipos_tabla(real)
    esperados = dict(m.periodos(real)); print(f"{time.strftime('%H:%M:%S')} {tabla}: {len(esperados)} trimestres en Neon, {sum(1 for p in esperados if (tabla, p) in listos)} ya publicados", flush=True)
    pendientes = repartir(tabla, real, listos)
    for p in pendientes:
        for intento in range(3):
            try: publicar(tabla, p, esperados[p], tipos); break
            except Exception as e:
                print(f"{time.strftime('%H:%M:%S')} ERROR {tabla} {p} intento {intento+1}: {e}", flush=True); time.sleep(10)
    print('FIN', flush=True)

if __name__ == '__main__': main(sys.argv[1])

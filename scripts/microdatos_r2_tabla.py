"""Variante de microdatos_r2.py que lee la tabla de Neon por GRUPOS de trimestres.

microdatos_r2.py exporta trimestre por trimestre con `where periodo=…`; sin índice por periodo
cada exportación recorre la tabla completa (sdem: ~40 M filas, 11-21 min por trimestre, ~80
trimestres). Aquí cada copia trae GRUPO trimestres de una vez (`where periodo in (…)`) y las filas
se reparten en un CSV comprimido por trimestre según la columna `periodo`; después cada trimestre
sigue el mismo camino que en microdatos_r2.py (Parquet con tipos del esquema, conteo contra Neon,
subida a R2, manifiesto). Mismos archivos, mismas claves R2 y mismo manifiesto; reanudable.

Mediciones del 2026-09-19: el cómputo de Neon entrega ~1 MB/s de CSV en total, se use un flujo o
varios en paralelo (el cuello es el CPU del cómputo formateando las filas), y la conexión por el
pooler se congela (servidor en ClientWrite, cliente en poll) tras ~20 min de una misma copia; por
eso se usa el host directo (sin «-pooler»), un solo flujo, copias acotadas a GRUPO trimestres y
un vigilante que reinicia la copia si pasan 180 s sin datos.
Uso: data/.venv/bin/python scripts/microdatos_r2_tabla.py <tabla> [<tabla> ...]
"""
import csv, gzip, io, json, pathlib, subprocess, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import microdatos_r2 as m
import pyarrow.csv as pcsv, pyarrow.parquet as pq
import threading
PG_DIRECTO = m.PG.replace('-pooler', '')
GRUPO = 10
SIN_DATOS_MAX = 180

def repartir(tabla, real, grupo):
    """Copia los trimestres de `grupo` en una sola consulta y los reparte en un CSV por trimestre."""
    d = m.BASE / tabla; d.mkdir(exist_ok=True)
    t0 = time.time(); salidas = {}; escritores = {}; n = 0; idx = None; cab = None
    lista = ','.join(f"'{p}'" for p in grupo)
    proc = subprocess.Popen(['psql', PG_DIRECTO, '-Atc', f"\\copy (select * from enoe.{real} where periodo in ({lista})) to STDOUT with (format csv, header true, null '\\N')"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    ultimo = [time.time()]; parar = threading.Event()
    def vigilante():
        while not parar.wait(15):
            if time.time() - ultimo[0] > SIN_DATOS_MAX:
                print(f"{time.strftime('%H:%M:%S')} {tabla} sin datos {SIN_DATOS_MAX}s: se reinicia la copia", flush=True); proc.kill(); return
    threading.Thread(target=vigilante, daemon=True).start()
    lector = csv.reader(io.TextIOWrapper(proc.stdout, encoding='utf-8', newline=''))
    try:
        for fila in lector:
            ultimo[0] = time.time()
            if cab is None:
                cab = fila; idx = cab.index('periodo'); continue
            p = fila[idx]
            if p not in escritores:
                f = gzip.open(d / f'{p}.csv.gz', 'wt', compresslevel=1, encoding='utf-8', newline='')
                w = csv.writer(f); w.writerow(cab); salidas[p] = f; escritores[p] = w
            escritores[p].writerow(fila); n += 1
    finally:
        parar.set(); proc.wait()
        for f in salidas.values(): f.close()
    if proc.returncode: raise RuntimeError(f'psql terminó con código {proc.returncode} tras {n} filas')
    print(f"{time.strftime('%H:%M:%S')} {tabla} grupo {grupo[0]}..{grupo[-1]}: {n} filas en {time.time()-t0:.0f}s", flush=True)
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
                             's_export': None, 's_parquet': round(t2 - t1, 1), 's_subida': round(t3 - t2, 1), 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'lectura_unica': True}) + '\n')
    print(f"{time.strftime('%H:%M:%S')} {tabla} {periodo} {n} filas {tam/1e6:.1f} MB ({t2-t1:.0f}s+{t3-t2:.0f}s)", flush=True)

def main(tabla):
    real = f'microdatos_{tabla}'; listos = m.hechos(); tipos = m.tipos_tabla(real)
    esperados = dict(m.periodos(real)); pend = [p for p in esperados if (tabla, p) not in listos]
    print(f"{time.strftime('%H:%M:%S')} {tabla}: {len(esperados)} trimestres en Neon, {len(esperados)-len(pend)} ya publicados, {len(pend)} pendientes", flush=True)
    for k in range(0, len(pend), GRUPO):
        grupo = pend[k:k + GRUPO]
        for intento in range(4):
            try: hechos_grupo = repartir(tabla, real, grupo); break
            except Exception as e:
                print(f"{time.strftime('%H:%M:%S')} ERROR {tabla} grupo {grupo[0]} intento {intento+1}: {e}", flush=True); time.sleep(20)
        else: continue
        for p in hechos_grupo:
            for intento in range(3):
                try: publicar(tabla, p, esperados[p], tipos); break
                except Exception as e:
                    print(f"{time.strftime('%H:%M:%S')} ERROR {tabla} {p} intento {intento+1}: {e}", flush=True); time.sleep(10)
    print(f'FIN {tabla}', flush=True)

if __name__ == '__main__':
    for t in sys.argv[1:]: main(t)

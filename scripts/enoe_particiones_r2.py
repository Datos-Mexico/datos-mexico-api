"""Particiona los microdatos de la ENOE en R2 para consultarlos desde el worker sin base de datos externa.

Entrada: los Parquet por (tabla, trimestre) ya publicados en R2 (enoe/microdatos/<tabla>/<periodo>.parquet, con
conteos verificados contra Neon en data/enoe/microdatos/manifiesto.jsonl). Por cada uno: se lee completo, se
comprueba el conteo, se verifica que la llave primaria sea única, se ordena por la llave primaria y se escribe
una partición por entidad federativa (enoe/particiones/<tabla>/<periodo>/<ent>.parquet) con grupos de filas de
2,000 registros y estadísticas, para que el worker lea solo los grupos que necesita (paginación por llave).
Verificación: suma de filas de las particiones = filas del origen; cada subida se comprueba con HEAD.
Salida: data/enoe/particiones/manifiesto.jsonl (una línea por partición) y columnas.json (esquema por tabla,
idéntico en todos los trimestres; se aborta si no lo fuera). Reanudable.
Uso: data/.venv/bin/python scripts/enoe_particiones_r2.py [--procesos 4] [--tabla viv]
"""
import argparse, io, json, os, pathlib, sys, tempfile, time
import concurrent.futures as cf
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import inegi_ingesta as ing
import pyarrow as pa, pyarrow.parquet as pq, pyarrow.compute as pc
RAIZ = ing.RAIZ; BASE = RAIZ / 'data/enoe/particiones'; BASE.mkdir(parents=True, exist_ok=True)
MANIF = BASE / 'manifiesto.jsonl'; COLS = BASE / 'columnas.json'; LOG = BASE / 'particiones.log'
PK = {'viv': ['periodo', 'cd_a', 'ent', 'con', 'v_sel'], 'hog': ['periodo', 'cd_a', 'ent', 'con', 'v_sel', 'n_hog'],
      'sdem': ['periodo', 'cd_a', 'ent', 'con', 'v_sel', 'n_hog', 'n_ren'], 'coe1': ['periodo', 'cd_a', 'ent', 'con', 'v_sel', 'n_hog', 'n_ren'], 'coe2': ['periodo', 'cd_a', 'ent', 'con', 'v_sel', 'n_hog', 'n_ren']}
GRUPO = 2000

def log(m):
    with open(LOG, 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {m}\n")

def procesar(item):
    tabla, periodo, esperado, clave_origen = item['tabla'], item['periodo'], item['filas'], item['clave_r2']
    t0 = time.time(); s3 = ing._s3()
    crudo = s3.get_object(Bucket=ing.BUCKET, Key=clave_origen)['Body'].read()
    t = pq.read_table(io.BytesIO(crudo))
    if t.num_rows != esperado: raise RuntimeError(f'{tabla} {periodo}: {t.num_rows} filas, manifiesto {esperado}')
    pk = PK[tabla]
    unicos = t.select(pk).group_by(pk).aggregate([]).num_rows
    if unicos != t.num_rows: raise RuntimeError(f'{tabla} {periodo}: llave primaria repetida ({t.num_rows - unicos} filas)')
    if pc.any(pc.is_null(t['ent'])).as_py() or not pc.all(pc.match_substring_regex(t['ent'], r'^(0[1-9]|[12][0-9]|3[0-2])$')).as_py():
        raise RuntimeError(f'{tabla} {periodo}: valores de ent fuera de 01..32')
    t = t.sort_by([(k, 'ascending') for k in pk])
    esquema = [[f.name, str(f.type), f.nullable] for f in t.schema]
    regs = []; suma = 0
    with tempfile.TemporaryDirectory(prefix='enoe-p-') as tmp:
        pendientes = []
        for ent in sorted(set(t['ent'].to_pylist())):
            sub = t.filter(pc.equal(t['ent'], ent))
            ruta = pathlib.Path(tmp) / f'{ent}.parquet'
            pq.write_table(sub, ruta, compression='zstd', row_group_size=GRUPO, write_statistics=True, data_page_version='1.0')
            md = pq.read_metadata(ruta); assert md.num_rows == sub.num_rows
            clave = f'enoe/particiones/{tabla}/{periodo}/{ent}.parquet'
            pendientes.append((clave, ruta)); suma += sub.num_rows
            regs.append({'tabla': tabla, 'periodo': periodo, 'ent': ent, 'filas': sub.num_rows, 'grupos': md.num_row_groups, 'bytes': ruta.stat().st_size, 'clave': clave, 'origen': clave_origen})
        if suma != esperado: raise RuntimeError(f'{tabla} {periodo}: particiones suman {suma}, origen {esperado}')
        with cf.ThreadPoolExecutor(8) as ex: list(ex.map(lambda p: ing.subir(p[0], p[1], 'application/vnd.apache.parquet'), pendientes))
    ts = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    return esquema, [dict(r, ts=ts) for r in regs], time.time() - t0

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--procesos', type=int, default=4); ap.add_argument('--tabla'); a = ap.parse_args()
    origen = [json.loads(l) for l in open(RAIZ / 'data/enoe/microdatos/manifiesto.jsonl') if l.strip()]
    origen = [r for r in origen if r.get('ok') and (not a.tabla or r['tabla'] == a.tabla)]
    hechos = {(json.loads(l)['tabla'], json.loads(l)['periodo']) for l in open(MANIF)} if MANIF.exists() else set()
    pend = [r for r in origen if (r['tabla'], r['periodo']) not in hechos]
    columnas = json.loads(COLS.read_text()) if COLS.exists() else {}
    print(f'{len(origen)} trimestres; {len(pend)} pendientes', flush=True); log(f'inicio: {len(pend)} pendientes, {a.procesos} procesos')
    errores = 0
    with cf.ProcessPoolExecutor(a.procesos) as ex:
        futs = {ex.submit(procesar, r): r for r in pend}
        for f in cf.as_completed(futs):
            r = futs[f]
            try: esquema, regs, seg = f.result()
            except Exception as e: errores += 1; log(f'ERROR {r["tabla"]} {r["periodo"]}: {type(e).__name__}: {str(e)[:200]}'); continue
            if r['tabla'] in columnas and columnas[r['tabla']] != esquema: errores += 1; log(f'ERROR {r["tabla"]} {r["periodo"]}: esquema distinto al de otros trimestres'); continue
            columnas.setdefault(r['tabla'], esquema); COLS.write_text(json.dumps(columnas, ensure_ascii=False, indent=0))
            with open(MANIF, 'a') as m:
                for x in regs: m.write(json.dumps(x) + '\n')
            log(f'ok {r["tabla"]} {r["periodo"]}: {len(regs)} particiones, {sum(x["filas"] for x in regs):,} filas, {sum(x["bytes"] for x in regs)/1e6:.1f} MB, {seg:.0f}s')
    log(f'FIN: {errores} errores'); print('FIN', errores, 'errores', flush=True)

if __name__ == '__main__': main()

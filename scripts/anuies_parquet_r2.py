"""Convierte cada ciclo completo del Anuario ANUIES (data/anuies/consulta/<ciclo>.jsonl) a Parquet (zstd, todas las
columnas: 14 dimensiones + ciclo + 167 cifras enteras, nulos donde ANUIES no da la columna) y lo sube a R2 como
anuies/anuario/<ciclo>.parquet, verificando filas y tamaño. Registra en data/anuies/manifiesto.jsonl.
Uso: data/.venv/bin/python scripts/anuies_parquet_r2.py [ciclo ...]
"""
import hashlib, json, os, pathlib, sys, time
import pyarrow as pa, pyarrow.parquet as pq
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import inegi_ingesta as ing
RAIZ = pathlib.Path(__file__).resolve().parent.parent; BASE = RAIZ / 'data/anuies'; MANIF = BASE / 'manifiesto.jsonl'
COLS = json.loads((BASE / 'columnas.json').read_text())
DIMS = ['ENTIDAD', 'MUNICIPIO_CORREGIDO', 'SOSTENIMIENTO', 'ANUIES', 'CLASIFICACION', 'NOMBRE_INSTITUCION', 'NOMBRE_DE_ESCUELA_CAMPUS_FACULTAD', 'NIVEL', 'MODALIDAD', 'CAMPO_AMPLIO', 'CAMPO_ESPECIFICO', 'CAMPO_DETALLADO', 'CAMPO_UNITARIO', 'CARRERA']
CIFRAS = COLS['base'] + COLS['edad'] + COLS['procedencia']
CICLOS = [f'{a}-{a+1}' for a in range(2000, 2026)]
def hechos(): return {json.loads(l)['ciclo'] for l in open(MANIF)} if MANIF.exists() else set()
def convertir(ciclo):
    meta = json.load(open(BASE / 'consulta' / f'{ciclo}.meta.json')); assert meta.get('completo') and meta['dims'] == DIMS
    filas = [json.loads(l) for l in open(BASE / 'consulta' / f'{ciclo}.jsonl') if l.strip()]
    assert len(filas) == meta['filas'], f'{ciclo}: {len(filas)} filas ≠ manifiesto {meta["filas"]}'
    cols = {'ciclo': pa.array([ciclo] * len(filas), pa.string())}
    for d in DIMS:
        nombre = {'MUNICIPIO_CORREGIDO': 'municipio', 'NOMBRE_INSTITUCION': 'institucion', 'NOMBRE_DE_ESCUELA_CAMPUS_FACULTAD': 'escuela'}.get(d, d.lower())
        cols[nombre] = pa.array([r[d] for r in filas], pa.int16() if d == 'ANUIES' else pa.string())
    for k in CIFRAS: cols[k.lower()] = pa.array([None if r.get(k) in (None, '') else int(r[k]) for r in filas], pa.int32())
    tabla = pa.table(cols)
    salida = BASE / 'parquet' / f'{ciclo}.parquet'; salida.parent.mkdir(exist_ok=True)
    pq.write_table(tabla, salida, compression='zstd', row_group_size=20000, write_statistics=True)
    t2 = pq.read_table(salida); assert t2.num_rows == meta['filas']
    assert sum(x or 0 for x in t2.column('mat_total').to_pylist()) == meta['sumas_detalle']['MAT_TOTAL'], f'{ciclo}: suma de matrícula no cuadra'
    clave = f'anuies/anuario/{ciclo}.parquet'; ing.subir(clave, str(salida), 'application/vnd.apache.parquet')
    sha = hashlib.sha256(salida.read_bytes()).hexdigest()
    reg = {'ciclo': ciclo, 'clave_r2': clave, 'filas': meta['filas'], 'columnas': tabla.num_columns, 'bytes': salida.stat().st_size, 'sha256': sha, 'jsonl_sha256': meta['sha256'], 'fecha': time.strftime('%Y-%m-%dT%H:%M:%S')}
    with open(MANIF, 'a') as f: f.write(json.dumps(reg, ensure_ascii=False) + '\n')
    print(f'{ciclo}: {meta["filas"]} filas, {tabla.num_columns} columnas, {salida.stat().st_size/1e6:.1f} MB → {clave}', flush=True)
if __name__ == '__main__':
    pedidos = sys.argv[1:] or [c for c in CICLOS if (BASE / 'consulta' / f'{c}.meta.json').exists() and json.load(open(BASE / 'consulta' / f'{c}.meta.json')).get('completo')]
    for c in pedidos:
        if c in hechos(): print(f'{c}: ya en el manifiesto'); continue
        convertir(c)

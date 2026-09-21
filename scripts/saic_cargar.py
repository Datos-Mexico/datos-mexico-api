"""SAIC (Censos Económicos 2004-2024) → Parquet por año censal y D1 (exclusión 7 del traspaso).
Entrada: data/saic/crudo/<año>/<ámbito>/<nivel>-<pág>.json.gz de scripts/saic_descarga.py (filas {anio, enti, muni?, estrato?, actividad, zxc:[{"CLAVE|Nombre": valor}]}).
Salida:
  --parquet  data/saic/parquet/saic_<año>.parquet: una fila por (año, cve_ent, cve_mun, nivel de actividad, clave de actividad, estrato) con las 98
             variables como columnas (double; nulo = el INEGI no publica el dato por confidencialidad o no aplica). Se sube a R2 en saic/<año>.parquet.
  --cargar   D1 datosmexico-api-censo2020: saic_catalogo (variables), saic_actividades (árbol), saic_estratos, saic_resumen (por año: filas, valores)
             y la tabla de hechos en dos tablas anchas (D1 admite ≤ 100 columnas): saic_a / saic_b, con las mismas llaves, para nacional + entidades
             (todos los niveles) y municipios (todos los niveles). Reanudable por año.
Verificación: (1) filas recibidas = total anunciado por consulta/total en cada tarea (manifiesto); (2) para cada año, las unidades económicas y el
personal ocupado nacionales del SAIC deben ser iguales a los indicadores del Banco de Indicadores del INEGI con fuente Censos Económicos
(se cotejan en scripts/verificar_cubos.py contra /api/v1/inegi/indicadores); (3) suma de entidades = nacional en UE por año.
Uso: data/.venv/bin/python scripts/saic_cargar.py --parquet [--subir] [--cargar]
"""
import argparse, glob, gzip, json, os, pathlib, re, subprocess, sys, tempfile, time, collections as C
RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data' / 'saic'; CRUDO = DIR / 'crudo'; PARQ = DIR / 'parquet'; CAT = json.loads((DIR / 'catalogos.json').read_text())
DB = 'datosmexico-api-censo2020'
VARS = ['UE'] + [v['clave'] for v in CAT['variables'] if v['clave'] != 'UE']
NOMBRE_VAR = {'UE': 'Unidades económicas'}; NOMBRE_VAR.update({v['clave']: v['nombre'] for v in CAT['variables']})
ESTRATO = {e['name']: int(e['key']) for e in CAT['estratos']}
NIVEL_ACT = {a['clave']: a['nivel'] for a in CAT['arbol']}
def log(m):
    with open(DIR / 'saic.log', 'a') as f: f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {m}\n")
    print(m, flush=True)

def fila_de(r, ambito, nivel):
    ent = r['enti'][:2]; mun = r.get('muni', '')[:3] if r.get('muni') else None
    if ambito == '00': ent, mun = '00', None
    elif ambito == 'ent': mun = None
    act = r['actividad'].strip()
    if nivel == 0: clave_act = '0'
    else:
        clave_act = act.split(' ', 1)[0]
        if clave_act not in NIVEL_ACT or NIVEL_ACT[clave_act] != nivel: raise ValueError(f'actividad fuera del nivel {nivel}: {act[:60]!r}')
    est = ESTRATO[r['estrato']] if 'estrato' in r else 0
    z = r['zxc'][0] if r['zxc'] else {}
    vals = {}
    for k, v in z.items():
        clave = k.split('|', 1)[0]
        vals[clave] = None if v in (None, '', 'NA', 'N/A', 'NC') else float(v)
    return (r['anio'], ent, mun, nivel, clave_act, est), vals

def parquet(anios):
    import pyarrow as pa, pyarrow.parquet as pq
    PARQ.mkdir(exist_ok=True); manif = {json.loads(l)['clave']: json.loads(l) for l in open(DIR / 'manifiesto.jsonl') if l.strip()}
    for anio in anios:
        salida = PARQ / f'saic_{anio}.parquet'
        if salida.exists(): log(f'{anio}: ya existe {salida.name}'); continue
        llaves = {}; n = 0; dup = 0; t0 = time.time()
        for amb in sorted(os.listdir(CRUDO / anio)):
            for f in sorted((CRUDO / anio / amb).glob('*.json.gz')):
                nivel = int(f.name.split('-')[0]); clave_m = f'{anio}/{amb}/{nivel}'
                if clave_m not in manif: continue
                for r in json.load(gzip.open(f, 'rt', encoding='utf-8')):
                    k, vals = fila_de(r, amb, nivel)
                    if k in llaves: dup += 1; continue
                    llaves[k] = vals; n += 1
        esperadas = sum(m['filas'] for c, m in manif.items() if c.startswith(anio + '/'))
        cols = {'anio': [], 'cve_ent': [], 'cve_mun': [], 'nivel_act': [], 'clave_act': [], 'estrato': []}
        for v in VARS: cols[v] = []
        for k in sorted(llaves, key=lambda x: (x[1], x[2] or '', x[3], x[4], x[5])):
            vals = llaves[k]
            for c, val in zip(('anio', 'cve_ent', 'cve_mun', 'nivel_act', 'clave_act', 'estrato'), k): cols[c].append(val)
            for v in VARS: cols[v].append(vals.get(v))
        t = pa.table({**{c: pa.array(cols[c], pa.string() if c in ('anio', 'cve_ent', 'cve_mun', 'clave_act') else pa.int16()) for c in ('anio', 'cve_ent', 'cve_mun', 'nivel_act', 'clave_act', 'estrato')}, **{v: pa.array(cols[v], pa.float64()) for v in VARS}})
        pq.write_table(t, salida.with_suffix('.tmp'), compression='zstd'); salida.with_suffix('.tmp').rename(salida)
        no_nulos = sum(sum(1 for x in cols[v] if x is not None) for v in VARS)
        log(f'{anio}: {n:,} filas ({esperadas:,} en el manifiesto, {dup} repetidas), {no_nulos:,} valores no nulos, {salida.stat().st_size / 1048576:.1f} MB, {time.time() - t0:.0f} s')
        (PARQ / f'saic_{anio}.json').write_text(json.dumps({'anio': anio, 'filas': n, 'esperadas': esperadas + 0, 'repetidas': dup, 'valores': no_nulos, 'bytes': salida.stat().st_size}))

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--parquet', action='store_true'); ap.add_argument('--anios', default=','.join(CAT['anios'])); a = ap.parse_args()
    if a.parquet: parquet(a.anios.split(','))

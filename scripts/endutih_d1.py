"""ENDUTIH (Encuesta Nacional sobre Disponibilidad y Uso de Tecnologías de la Información en los Hogares), 2015-2025:
personas de 6 años y más usuarias de internet y de computadora, por entidad, sexo y grupo de edad, agregadas desde los
microdatos (tabla de usuarios: una persona seleccionada de 6+ por hogar, factor fac_per) y verificadas contra el Banco de
Indicadores del INEGI. Carga en D1 datosmexico-api-encuestas.

Verificación (medida antes de escribir esto): el porcentaje de usuarios de internet (p7_1 = 1) y de computadora
(p6_1 = 1) sobre toda la población de 6+ ponderada con fac_per reproduce los indicadores 6206972693 y 6206972694 del
INEGI (2025: 86.0526 % y 38.1445 %; 2024: 83.1223 % y 36.5950 %; 2020: 71.5 % y 37.5 %). Aquí se comprueban todas las
ediciones (tolerancia: medio último dígito publicado; 2017-2019 y 2021 vienen con un decimal) y no se carga si alguna
difiere.
Cobertura: 2015 no trae sexo ni edad en la tabla de usuarios (clave 9 / 'NE'); 2019 fue un levantamiento reducido sin
entidad (solo nacional, clave 0). El uso de teléfono celular no se publica: ninguna columna reproduce el 84.6 % oficial.
Uso: data/.venv/bin/python scripts/endutih_d1.py [--cargar]
"""
import argparse, csv, json, pathlib, subprocess, sys, tempfile, time, urllib.request
from collections import defaultdict
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import inegi_ingesta as ing
import numpy as np, pyarrow as pa, pyarrow.parquet as pq

RAIZ = ing.RAIZ; DIR = RAIZ / 'data/encuestas'; CRUDO = DIR / 'crudo'; CRUDO.mkdir(parents=True, exist_ok=True); DB = 'datosmexico-api-encuestas'; API = 'https://api.datosmexico.org/api/v1'
GRUPOS = [(6, 11, '6-11'), (12, 17, '12-17'), (18, 24, '18-24'), (25, 34, '25-34'), (35, 44, '35-44'), (45, 54, '45-54'), (55, 200, '55+')]

def log(m):
    with open(DIR / 'endutih.log', 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {m}\n")
    print(m, flush=True)

def archivos():
    cache = DIR / 'endutih_archivos.json'
    if not cache.exists():
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'datosmexico-api-bise', '--remote', '--yes', '--json', '--command', "SELECT edicion, tabla, filas, clave_r2, sha256_zip FROM da_microdatos WHERE programa_slug='endutih' AND (tabla LIKE '%usuarios' OR tabla = 'ti25usu') ORDER BY edicion"], cwd=RAIZ, capture_output=True, text=True)
        cache.write_text(json.dumps(json.loads(r.stdout)[0]['results'], indent=0))
    return json.loads(cache.read_text())

def col(t, c, faltante):
    if c not in t.column_names: return np.full(t.num_rows, faltante, dtype=float)
    return np.nan_to_num(t[c].to_numpy(zero_copy_only=False).astype(float), nan=faltante)

def grupo(e):
    if e < 6: return 'NE'
    for lo, hi, k in GRUPOS:
        if lo <= e <= hi: return k
    return 'NE'

def bise(ind):
    req = urllib.request.Request(f'{API}/inegi/indicadores/{ind}/observaciones?limit=100', headers={'User-Agent': 'curl/8'})
    return {o['periodo']: o['valor'] for o in json.loads(urllib.request.urlopen(req, timeout=60).read())['observaciones']}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--cargar', action='store_true'); a = ap.parse_args()
    acc = defaultdict(float); resumen = {}
    for x in archivos():
        ruta = CRUDO / f"endutih-{x['edicion']}-{x['tabla']}.parquet"
        if not ruta.exists(): ing._s3().download_file(ing.BUCKET, x['clave_r2'], str(ruta))
        t = pq.read_table(ruta)
        if t.num_rows != x['filas']: sys.exit(f'{ruta.name}: {t.num_rows} filas, catálogo {x["filas"]}')
        ed = int(x['edicion']); fac = col(t, 'fac_per', 0)
        ent = col(t, 'cve_ent', -1) if 'cve_ent' in t.column_names else col(t, 'ent', -1); sexo = col(t, 'sexo', 9); edad = col(t, 'edad', -1)
        inet = col(t, 'p7_1', 9); comp = col(t, 'p6_1', 9)
        for i in range(t.num_rows):
            e = int(ent[i]) if ent[i] > 0 else 0; s = int(sexo[i]) if sexo[i] in (1, 2) else 9
            acc[(ed, e, s, grupo(edad[i]), 1 if inet[i] == 1 else 2, 1 if comp[i] == 1 else 2)] += fac[i]
        tot = fac.sum(); resumen[ed] = {'filas': t.num_rows, 'pob': tot, 'internet': 100 * fac[inet == 1].sum() / tot, 'computadora': 100 * fac[comp == 1].sum() / tot, 'con_ent': bool((ent > 0).any()), 'con_sexo': bool((sexo != 9).any())}
        log(f"ENDUTIH {ed}: {t.num_rows:,} usuarios, {tot:,.0f} personas de 6+, internet {resumen[ed]['internet']:.4f} %, computadora {resumen[ed]['computadora']:.4f} %")
    oi = bise('6206972693'); oc = bise('6206972694'); malos = 0
    for ed, r in sorted(resumen.items()):
        for k, o in (('internet', oi), ('computadora', oc)):
            # el INEGI publica algunas ediciones con un decimal: la tolerancia es medio último dígito de lo publicado
            v = o.get(str(ed)); d = None if v is None else abs(r[k] - v); dec = 0 if v is None else len(str(v).split('.')[1]) if '.' in str(v) else 0
            tol = 0.5 * 10 ** (-dec) + 1e-9
            if d is None or d > tol: malos += 1
            log(f"verificación {ed} {k}: calculado {r[k]:.4f} INEGI {v} {'OK' if d is not None and d <= tol else 'DIFIERE'}")
    filas = [[ed, e, s, g, i, c, int(round(v))] for (ed, e, s, g, i, c), v in sorted(acc.items())]
    with open(DIR / 'endutih_usuarios.csv', 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['edicion', 'ent', 'sexo', 'edad_grupo', 'internet', 'computadora', 'personas']); w.writerows(filas)
    log(f'{len(filas)} filas agregadas; ediciones con diferencias: {malos}')
    if not a.cargar: return
    if malos: sys.exit('no se carga con diferencias')
    def d1(sql, archivo=True):
        ruta = None
        if archivo:
            with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f: f.write(sql); ruta = f.name
        for intento in range(4):
            r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes'] + (['--file', ruta] if archivo else ['--json', '--command', sql]), cwd=RAIZ, capture_output=True, text=True)
            if r.returncode == 0: return None if archivo else json.loads(r.stdout)[0]['results']
            log(f'wrangler falló (intento {intento + 1})'); time.sleep(20 * (intento + 1))
        sys.exit('wrangler falló cuatro veces')
    def q(v): return "'" + str(v).replace("'", "''") + "'" if isinstance(v, str) else str(v)
    geos = {r['clave']: r['nombre'] for r in csv.DictReader(open(RAIZ / 'data/bise/neon-export/geografias.csv'))}
    tablas = {
        'cat_entidad': (['clave', 'nombre'], [(0, 'Nacional (sin entidad en la edición)')] + [(int(k), v) for k, v in geos.items() if len(k) == 2 and k != '00']),
        'cat_sexo': (['clave', 'nombre'], [(1, 'Hombres'), (2, 'Mujeres'), (9, 'Sin dato de sexo en la edición')]),
        'cat_edad_grupo': (['clave', 'nombre'], [(k, f'{lo} a {hi} años' if hi < 200 else f'{lo} años y más') for lo, hi, k in GRUPOS] + [('NE', 'Sin dato de edad en la edición')]),
        'cat_si_no': (['clave', 'nombre'], [(1, 'Sí'), (2, 'No')]),
        'endutih_usuarios': (['edicion', 'ent', 'sexo', 'edad_grupo', 'internet', 'computadora', 'personas'], filas),
    }
    d1((RAIZ / 'data/encuestas/schema.sqlite.sql').read_text())
    for tabla, (campos, fs) in tablas.items():
        d1(f'DELETE FROM {tabla};')
        for i in range(0, len(fs), 4000):
            d1(''.join(f"INSERT INTO {tabla} ({', '.join(campos)}) VALUES {','.join('(' + ','.join(q(v) for v in f) + ')' for f in fs[j:j + 400])};\n" for j in range(i, min(i + 4000, len(fs)), 400)))
        n = d1(f'SELECT COUNT(*) n FROM {tabla}', archivo=False)[0]['n']; log(f'{tabla}: {n:,} filas en D1 (esperadas {len(fs):,})')
        if n != len(fs): sys.exit('la carga no cuadra')
    log('carga completa')

if __name__ == '__main__':
    main()

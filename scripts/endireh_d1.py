"""ENDIREH 2021 (Encuesta Nacional sobre la Dinámica de las Relaciones en los Hogares): prevalencia de violencia contra
las mujeres de 15 años y más, por entidad y grupo de edad, desde los microdatos. La tabla TB_VD del INEGI trae, por mujer,
las banderas ya construidas por el propio INEGI (vtot_a = alguna violencia a lo largo de la vida, vtot_12m = en los
últimos 12 meses; por tipo: vpsi, vfis, vsex, veco; por ámbito: vesc, vlab, vcom, vfam, vpar; pobp = alguna vez con pareja)
y el factor fac_muj; la edad viene de TSDEM (id_per). Verificación contra los cuadros 21.1 (a lo largo de la vida) y 21.2
(últimos 12 meses) de «XXI. Prevalencia de la violencia» archivados en el observatorio: total y cuatro tipos en el país y
las 32 entidades (66 × 5 comparaciones por cuadro), con la precisión del cuadro (medido antes de escribir esto: 70.0723 %
nacional y 72.8198 % Aguascalientes exactos). Carga en D1 datosmexico-api-encuestas.
Las ediciones 2003, 2006 y 2011 tienen otra estructura y 2016 no está en la descarga masiva: solo 2021.
Uso: data/.venv/bin/python scripts/endireh_d1.py [--cargar]
"""
import argparse, csv, json, pathlib, subprocess, sys, tempfile, time
from collections import defaultdict
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import inegi_ingesta as ing
import numpy as np, pyarrow.parquet as pq

RAIZ = ing.RAIZ; DIR = RAIZ / 'data/encuestas'; CRUDO = DIR / 'crudo'; DB = 'datosmexico-api-encuestas'
GRUPOS = [(15, 24, '15-24'), (25, 34, '25-34'), (35, 44, '35-44'), (45, 54, '45-54'), (55, 64, '55-64'), (65, 200, '65+')]
FLAGS = ['vtot_a', 'vtot_12m', 'vpsi_a', 'vpsi_12m', 'vfis_a', 'vfis_12m', 'vsex_a', 'vsex_12m', 'veco_a', 'veco_12m', 'vesc_a', 'vesc_12m', 'vlab_a', 'vlab_12m', 'vcom_a', 'vcom_12m', 'vfam', 'vpar_a', 'vpar_12m']
GEOS = {'Estados Unidos Mexicanos': 0}

def log(m):
    with open(DIR / 'endireh.log', 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {m}\n")
    print(m, flush=True)

def oficial(hoja):
    """Cuadro 21.x: por entidad, la fila 'Total' → (total, psicológica, física, sexual, económica)."""
    import openpyxl
    ws = openpyxl.load_workbook(DIR / 'endireh_2021_xxi.xlsx', read_only=True, data_only=True)[hoja]
    out = {}; actual = None
    for row in ws.iter_rows(values_only=True):
        a = row[0]
        if isinstance(a, str) and a.strip() and row[1] is None and a not in ('Total', 'Pareja') and not a.startswith('Otros'): actual = a.strip()
        # la hoja apila varios bloques (estimaciones, coeficientes de variación, errores estándar…): vale el primero por entidad
        elif a == 'Total' and actual and isinstance(row[1], (int, float)): out.setdefault(actual, (row[1], row[3], row[4], row[5], row[6]))
    return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--cargar', action='store_true'); a = ap.parse_args()
    r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'datosmexico-api-bise', '--remote', '--yes', '--json', '--command', "SELECT tabla, filas, clave_r2 FROM da_microdatos WHERE programa_slug='endireh' AND edicion='2021' AND tabla IN ('tb-vd','tsdem')"], cwd=RAIZ, capture_output=True, text=True)
    for x in json.loads(r.stdout)[0]['results']:
        ruta = CRUDO / f"endireh-2021-{x['tabla']}.parquet"
        if not ruta.exists(): ing._s3().download_file(ing.BUCKET, x['clave_r2'], str(ruta))
        if pq.read_metadata(ruta).num_rows != x['filas']: sys.exit(f'{x["tabla"]}: conteo distinto al catálogo')
    t = pq.read_table(CRUDO / 'endireh-2021-tb-vd.parquet'); s = pq.read_table(CRUDO / 'endireh-2021-tsdem.parquet', columns=['id_per', 'edad'])
    edad_de = dict(zip(s['id_per'].to_pylist(), s['edad'].to_pylist()))
    fac = np.nan_to_num(t['fac_muj'].to_numpy(zero_copy_only=False).astype(float)); ent = np.nan_to_num(t['cve_ent'].to_numpy(zero_copy_only=False).astype(float)).astype(int)
    ids = t['id_per'].to_pylist(); pobp = np.nan_to_num(t['pobp'].to_numpy(zero_copy_only=False).astype(float), nan=0)
    flags = {k: (np.nan_to_num(t[k].to_numpy(zero_copy_only=False).astype(float), nan=-1) == 1) for k in FLAGS}
    acc = defaultdict(lambda: [0.0] * (2 + len(FLAGS)))
    sin_edad = 0
    for i in range(t.num_rows):
        e = edad_de.get(ids[i]); g = 'NE'
        if e is None: sin_edad += 1
        else:
            for lo, hi, k in GRUPOS:
                if lo <= e <= hi: g = k; break
        v = acc[(2021, ent[i], g)]; v[0] += fac[i]; v[1] += fac[i] if pobp[i] == 1 else 0
        for j, k in enumerate(FLAGS):
            if flags[k][i]: v[2 + j] += fac[i]
    log(f'{t.num_rows:,} mujeres en la muestra, {fac.sum():,.0f} de 15 y más; sin edad en TSDEM: {sin_edad}')
    # verificación por geografía contra 21.1 (vida) y 21.2 (12 meses)
    nombres = {r['clave']: r['nombre'] for r in csv.DictReader(open(RAIZ / 'data/bise/neon-export/geografias.csv')) if len(r['clave']) == 2}
    malos = 0
    for hoja, sufijo in (('21.1', '_a'), ('21.2', '_12m')):
        of = oficial(hoja)
        for clave, nombre in [('00', 'Estados Unidos Mexicanos')] + [(k, v) for k, v in sorted(nombres.items()) if k != '00']:
            e = int(clave); sel = [(k, v) for k, v in acc.items() if e == 0 or k[1] == e]
            base = sum(v[0] for _, v in sel)
            calc = [100 * sum(v[2 + FLAGS.index(f + sufijo)] for _, v in sel) / base for f in ('vtot', 'vpsi', 'vfis', 'vsex', 'veco')]
            o = of.get(nombre) or of.get({'México': 'Estado de México'}.get(nombre, nombre)) or next((v for k, v in of.items() if k.split()[0] == nombre.split()[0]), None)
            if o is None: log(f'{hoja} {nombre}: sin fila en el cuadro'); malos += 1; continue
            d = max(abs(c - float(x)) for c, x in zip(calc, o))
            if d > 0.0005: malos += 1; log(f'{hoja} {nombre}: DIFIERE {["%.4f" % c for c in calc]} vs {["%.4f" % float(x) for x in o]}')
        log(f'cuadro {hoja}: {33 * 5} comparaciones revisadas')
    log(f'verificación: {malos} geografías con diferencias')
    filas = [[ed, e, g] + [int(round(x)) for x in v] for (ed, e, g), v in sorted(acc.items())]
    campos = ['edicion', 'ent', 'edad_grupo', 'mujeres', 'con_pareja'] + FLAGS
    with open(DIR / 'endireh_violencia.csv', 'w', newline='') as f:
        w = csv.writer(f); w.writerow(campos); w.writerows(filas)
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
    d1("CREATE TABLE IF NOT EXISTS endireh_violencia (edicion INTEGER NOT NULL, ent INTEGER NOT NULL, edad_grupo TEXT NOT NULL, mujeres INTEGER NOT NULL, con_pareja INTEGER NOT NULL, " + ', '.join(f'{k} INTEGER NOT NULL' for k in FLAGS) + ", PRIMARY KEY (edicion, ent, edad_grupo));\nDELETE FROM endireh_violencia;\n" + ''.join(f"INSERT INTO endireh_violencia ({', '.join(campos)}) VALUES {','.join('(' + ','.join(q(v) for v in f) + ')' for f in filas[j:j + 400])};\n" for j in range(0, len(filas), 400)))
    n = d1('SELECT COUNT(*) n FROM endireh_violencia', archivo=False)[0]['n']; log(f'endireh_violencia: {n} filas en D1 (esperadas {len(filas)})')
    if n != len(filas): sys.exit('la carga no cuadra')
    log('carga completa')

if __name__ == '__main__':
    main()

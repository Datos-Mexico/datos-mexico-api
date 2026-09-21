"""ENADID 2023 (Encuesta Nacional de la Dinámica Demográfica): mujeres de 15 a 49 años por entidad, grupo quinquenal de
edad, tamaño de localidad y condición de haber estado embarazada alguna vez, desde los microdatos (tabla TMujer1:
p5_2_1 = edad, p5_6 = ¿alguna vez ha estado embarazada?, fac_mod = factor del módulo de la mujer). Carga en D1
datosmexico-api-encuestas y verificación contra el cuadro 2.1 de los tabulados oportunos del INEGI (archivados en el
observatorio): mujeres de 15 a 49 años (33,709,740), alguna vez embarazadas (22,000,554) y ambos por grupo de edad,
exactos (medido antes de escribir esto: 15-19 años 5,321,859 y 556,019).
Uso: data/.venv/bin/python scripts/enadid_d1.py [--cargar]
"""
import argparse, csv, io, json, pathlib, subprocess, sys, tempfile, time, zipfile
from collections import defaultdict
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import inegi_ingesta as ing
import numpy as np, pyarrow.parquet as pq

RAIZ = ing.RAIZ; DIR = RAIZ / 'data/encuestas'; CRUDO = DIR / 'crudo'; DB = 'datosmexico-api-encuestas'
GRUPOS = [(15, 19), (20, 24), (25, 29), (30, 34), (35, 39), (40, 44), (45, 49)]
TAM_LOC = {1: '100 000 y más habitantes', 2: '15 000 a 99 999 habitantes', 3: '2 500 a 14 999 habitantes', 4: 'Menos de 2 500 habitantes'}

def log(m):
    with open(DIR / 'enadid.log', 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {m}\n")
    print(m, flush=True)

def catalogo(sql):
    r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'datosmexico-api-bise', '--remote', '--yes', '--json', '--command', sql], cwd=RAIZ, capture_output=True, text=True)
    return json.loads(r.stdout)[0]['results']

def oficial():
    """Cuadro 2.1 de los tabulados oportunos 2023: total nacional y por grupo de edad (mujeres y alguna vez embarazadas)."""
    z = zipfile.ZipFile(DIR / 'enadid_2023_oportunos.zip'); import openpyxl
    ws = openpyxl.load_workbook(io.BytesIO(z.read('Tema 02 - Fecundidad/01EST_T02 Fecundidad ENADID 2023.xlsx')), read_only=True, data_only=True)['Cuadro 2.1']
    out = {}; en_nacional = False
    for row in ws.iter_rows(values_only=True):
        a = row[1]
        if a == 'Estados Unidos Mexicanos': en_nacional = True; out['total'] = (int(row[3]), int(row[5])); continue
        if en_nacional and isinstance(a, str) and a.endswith('años') and row[3] is not None:
            out[a.replace(' años', '').replace(' a ', '-')] = (int(row[3]), int(row[5]))
            if a.startswith('45'): break
    return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--cargar', action='store_true'); a = ap.parse_args()
    x = catalogo("SELECT edicion, tabla, filas, clave_r2, sha256_zip FROM da_microdatos WHERE programa_slug='enadid' AND edicion='2023' AND tabla='tmujer1'")[0]
    ruta = CRUDO / 'enadid-2023-tmujer1.parquet'
    if not ruta.exists(): ing._s3().download_file(ing.BUCKET, x['clave_r2'], str(ruta))
    t = pq.read_table(ruta)
    if t.num_rows != x['filas']: sys.exit('conteo distinto al catálogo')
    fac = np.nan_to_num(t['fac_mod'].to_numpy(zero_copy_only=False).astype(float)); edad = np.nan_to_num(t['p5_2_1'].to_numpy(zero_copy_only=False).astype(float), nan=-1)
    ent = np.nan_to_num(t['ent'].to_numpy(zero_copy_only=False).astype(float), nan=-1).astype(int); tam = np.nan_to_num(t['tam_loc'].to_numpy(zero_copy_only=False).astype(float), nan=-1).astype(int)
    emb = np.nan_to_num(t['p5_6'].to_numpy(zero_copy_only=False).astype(float), nan=-1)
    acc = defaultdict(float)
    for i in range(t.num_rows):
        if not (15 <= edad[i] <= 49): continue
        g = next(f'{lo}-{hi}' for lo, hi in GRUPOS if lo <= edad[i] <= hi)
        acc[(2023, ent[i], g, tam[i] if tam[i] in TAM_LOC else 9, 1 if emb[i] == 1 else 2)] += fac[i]
    of = oficial(); malos = 0
    tot = sum(v for k, v in acc.items()); embz = sum(v for k, v in acc.items() if k[4] == 1)
    for nombre, calc, o in [('total', (tot, embz), of['total'])] + [(g, (sum(v for k, v in acc.items() if k[2] == g), sum(v for k, v in acc.items() if k[2] == g and k[4] == 1)), of[g]) for g in [f'{lo}-{hi}' for lo, hi in GRUPOS]]:
        ok = round(calc[0]) == o[0] and round(calc[1]) == o[1]; malos += 0 if ok else 1
        log(f'verificación {nombre}: mujeres {calc[0]:,.0f} vs {o[0]:,} | alguna vez embarazadas {calc[1]:,.0f} vs {o[1]:,} {"OK" if ok else "DIFIERE"}')
    filas = [[ed, e, g, tl, em, int(round(v))] for (ed, e, g, tl, em), v in sorted(acc.items())]
    with open(DIR / 'enadid_mujeres.csv', 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['edicion', 'ent', 'edad_grupo', 'tam_loc', 'embarazada', 'mujeres']); w.writerows(filas)
    log(f'{len(filas)} filas; diferencias {malos}')
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
    d1("CREATE TABLE IF NOT EXISTS cat_tam_loc (clave INTEGER PRIMARY KEY, nombre TEXT NOT NULL);\nCREATE TABLE IF NOT EXISTS enadid_mujeres (edicion INTEGER NOT NULL, ent INTEGER NOT NULL, edad_grupo TEXT NOT NULL, tam_loc INTEGER NOT NULL, embarazada INTEGER NOT NULL, mujeres INTEGER NOT NULL, PRIMARY KEY (edicion, ent, edad_grupo, tam_loc, embarazada));\nDELETE FROM cat_tam_loc; DELETE FROM enadid_mujeres;\n" + ''.join(f"INSERT INTO cat_tam_loc VALUES ({k}, {q(v)});\n" for k, v in list(TAM_LOC.items()) + [(9, 'No especificado')]))
    for i in range(0, len(filas), 4000):
        d1(''.join(f"INSERT INTO enadid_mujeres (edicion, ent, edad_grupo, tam_loc, embarazada, mujeres) VALUES {','.join('(' + ','.join(q(v) for v in f) + ')' for f in filas[j:j + 400])};\n" for j in range(i, min(i + 4000, len(filas)), 400)))
    n = d1('SELECT COUNT(*) n FROM enadid_mujeres', archivo=False)[0]['n']; log(f'enadid_mujeres: {n:,} filas en D1 (esperadas {len(filas):,})')
    if n != len(filas): sys.exit('la carga no cuadra')
    log('carga completa')

if __name__ == '__main__':
    main()

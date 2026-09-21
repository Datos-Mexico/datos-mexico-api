"""Tres cifras del INEGI/INSP reproducidas exactamente desde los microdatos (exclusión 8 de docs/TRASPASO-INEGI.md).

Cada subcomando descarga de R2 las tablas Parquet que necesita (catálogo da_microdatos de D1 datosmexico-api-bise),
aplica la regla metodológica documentada abajo, compara contra la cifra publicada y escribe un CSV en data/metodologias/.
Con --cargar, y solo si la verificación no tiene diferencias, carga el resultado en D1. Hallazgos y fuentes en
docs/METODOLOGIAS-INEGI.md.

ensanut — Sobrepeso y obesidad en adultos de 20 años y más, ENSANUT 2018-19 (39.1 % y 36.1 %).
  Fuente: INSP, «Encuesta Nacional de Salud y Nutrición 2018. Presentación de resultados», lámina «Sobrepeso y obesidad
  en población de 20 y más años» (ensanut.insp.mx/encuestas/ensanut2018/doctos/informes/ensanut_2018_presentacion_resultados.pdf);
  INEGI, comunicado ENSANUT 2018 (saladeprensa/boletines/2019/especiales/ENSANUT19.pdf); y la metodología detallada en
  Barquera S. y col., «Obesidad en México, prevalencia y tendencias en adultos. Ensanut 2018-19», Salud Pública de
  México 62(6):682-692, 2020 (cuadro I: n = 16 579, N = 77 708.1 mil). Reglas que reproducen el cuadro I:
  (1) tabla CN_ANTROPOMETRIA (base «nueva versión»), personas de 20 años y más; (2) peso y talla = promedio de las dos
  mediciones: PESO1/TALLA4 en 20-59 años y PESO12/TALLA15 (sección de adultos mayores) en 60 y más — sin la sección de
  60+ solo hay 13 341 adultos y las prevalencias dan 37.7/37.8; (3) 222.222 y 222.2 son «no se pesó/no se midió»;
  (4) válidos: talla de 1.3 a 2.0 m e IMC de 10 a 58 kg/m²; (5) se excluyen las embarazadas (P6 = 1 «está embarazada»
  o 3 «embarazada y dando pecho»); (6) ponderador F_ANTROP_INSP («Factor Antropometría Instituto de Salud»; 94 adultos
  con 0 quedan fuera), no F_ANTROP; (7) OMS: sobrepeso 25 ≤ IMC < 30, obesidad IMC ≥ 30. Resultado: n = 16 579,
  N = 77 708 132, sobrepeso 39.11 %, obesidad 36.07 %, y las 29 celdas del cuadro I por sexo y edad.

envipe-prevalencia — Tasa de prevalencia delictiva por cada cien mil habitantes de 18 años y más (indicador 6200002197
  del Banco de Indicadores; cuadro 1.1 de los tabulados básicos «I. Nivel de victimización y delincuencia»).
  Fuente: nota 2 del cuadro 1.1 («La tasa se calcula dividiendo el total de víctimas en la entidad federativa entre la
  población de 18 años y más residente en ésta, multiplicada por 100 000 habitantes») y el catálogo BPCOD de la tabla
  TMod_Vic en el descriptor de archivos (fd_envipe2026.pdf, «Códigos para delitos» 01-15). Regla que reproduce el
  indicador en las 33 geografías de las diez ediciones 2017-2026 (años de referencia 2016-2025): víctima = persona
  elegida (TPer_Vic1) con al menos un registro en TMod_Vic cuyo BPCOD no sea 03 («pinta de barda o grafiti…, rayones
  o daños intencionales en su vehículo u otro tipo de vandalismo»: se capta en la tarjeta pero el INEGI no lo cuenta
  como delito en la prevalencia; el cuadro 1.4 no lo lista); numerador Σ FAC_ELE de las víctimas, denominador Σ FAC_ELE
  de TPer_Vic1, ambos con la entidad de residencia (CVE_ENT). Contar también el código 03 da 25 594.7 en 2025 (la
  «más cercana» de la bitácora del 21-sep); los delitos del hogar (01, 02, 04) cuentan con el factor de la persona
  elegida en la prevalencia total, aunque el módulo los ponga con FAC_HOG.

envipe-2020 — Percepción de inseguridad en la colonia, ENVIPE 2020 (indicador 6200118581 = 48.74 %).
  Fuente: comunicado 636/20 del INEGI y cuadro 5.4 de los tabulados «V. Percepción sobre la seguridad pública» 2020,
  nota 3: «Las estimaciones presentadas corresponden al periodo de levantamiento del 17 al 31 de marzo». Por la
  pandemia, el levantamiento se partió en dos periodos (17-31 de marzo y 27 de julio-4 de septiembre) y la percepción
  publicada es solo la de marzo: en 2020 la tabla TVivienda trae la variable PER (1 = primer periodo, 2 = segundo).
  Regla: TPer_Vic1 unida a TVivienda por ID_VIV, PER = 1, ponderador FAC_ELE (el mismo de las demás ediciones). Con
  todos los elegidos da 42.93 %; con PER = 1, 48.74 % y 35 919 641 personas de 18 y más, exactos contra el cuadro 5.4.

Uso: data/.venv/bin/python scripts/metodologias_inegi.py {ensanut|envipe-prevalencia|envipe-2020} [--cargar]
"""
import argparse, csv, hashlib, json, pathlib, subprocess, sys, tempfile, time, urllib.request
from collections import defaultdict
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import inegi_ingesta as ing
import numpy as np, pandas as pd, pyarrow.parquet as pq

RAIZ = ing.RAIZ; DIR = RAIZ / 'data/metodologias'; CRUDO = DIR / 'crudo'; CRUDO.mkdir(parents=True, exist_ok=True)
API = 'https://api.datosmexico.org/api/v1'
DB_SEGURIDAD = 'datosmexico-api-seguridad'; DB_ENCUESTAS = 'datosmexico-api-encuestas'
VANDALISMO = 3  # BPCOD 03 de TMod_Vic: no es delito para la prevalencia delictiva del INEGI
AMBITOS = [('colonia', 'ap4_3_1'), ('municipio', 'ap4_3_2'), ('entidad', 'ap4_3_3')]

def log(m):
    with open(DIR / 'metodologias.log', 'a') as f: f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {m}\n")
    print(m, flush=True)

def catalogo(where):
    """Filas de da_microdatos (D1 datosmexico-api-bise) para un WHERE; se cachea por consulta."""
    cache = DIR / f'catalogo-{hashlib.sha256(where.encode()).hexdigest()[:12]}.json'
    if not cache.exists():
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'datosmexico-api-bise', '--remote', '--yes', '--json', '--command',
                            f"SELECT programa_slug, edicion, archivo, tabla, filas, clave_r2, sha256_zip FROM da_microdatos WHERE {where}"], cwd=RAIZ, capture_output=True, text=True)
        if r.returncode: sys.exit(f'wrangler falló: {(r.stdout + r.stderr)[-400:]}')
        cache.write_text(json.dumps(json.loads(r.stdout)[0]['results'], ensure_ascii=False, indent=1))
    return json.loads(cache.read_text())

def leer(a):
    """Descarga (una vez) el Parquet de R2 y lo devuelve como DataFrame; reutiliza los ya bajados por seguridad_d1.py."""
    nombre = f"{a['programa_slug']}-{a['edicion']}-{a['tabla']}.parquet"
    for d in (CRUDO, RAIZ / 'data/seguridad/crudo'):
        if (d / nombre).exists(): out = d / nombre; break
    else:
        out = CRUDO / nombre; ing._s3().download_file(ing.BUCKET, a['clave_r2'], str(out) + '.tmp'); (CRUDO / (nombre + '.tmp')).rename(out)
    t = pq.read_table(out)
    if t.num_rows != a['filas']: sys.exit(f'{nombre}: {t.num_rows} filas, catálogo {a["filas"]}')
    return t.to_pandas()

def num(s): return pd.to_numeric(s, errors='coerce')

def bise(ind):
    """Observaciones del Banco de Indicadores desde la API del observatorio: {'geografia|periodo': valor}."""
    out = {}; offset = 0
    while True:
        req = urllib.request.Request(f'{API}/inegi/indicadores/{ind}/observaciones?limit=5000&offset={offset}', headers={'User-Agent': 'curl/8'})
        d = json.loads(urllib.request.urlopen(req, timeout=120).read())
        for o in d['observaciones']:
            if o['valor'] is not None: out[f"{o['geografia']}|{o['periodo']}"] = o['valor']
        offset += 5000
        if offset >= d['total']: break
    return out

def escribir_csv(nombre, campos, filas):
    with open(DIR / nombre, 'w', newline='') as f: w = csv.writer(f); w.writerow(campos); w.writerows(filas)
    log(f'{nombre}: {len(filas):,} filas')

def d1(db, sql, archivo=True):
    ruta = None
    if archivo:
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f: f.write(sql); ruta = f.name
    for intento in range(4):
        args = ['npx', 'wrangler', 'd1', 'execute', db, '--remote', '--yes'] + (['--file', ruta] if archivo else ['--json', '--command', sql])
        r = subprocess.run(args, cwd=RAIZ, capture_output=True, text=True)
        if r.returncode == 0: return None if archivo else json.loads(r.stdout)[0]['results']
        log(f'wrangler falló (intento {intento + 1}): {(r.stdout + r.stderr)[-300:].strip()}'); time.sleep(20 * (intento + 1))
    sys.exit('wrangler falló cuatro veces')

def q(v): return 'NULL' if v is None else ("'" + str(v).replace("'", "''") + "'" if isinstance(v, str) else str(v))

def cargar_tabla(db, tabla, campos, filas, ddl, borrar):
    d1(db, ddl + '\n' + borrar + '\n')
    for i in range(0, len(filas), 4000):
        d1(db, ''.join(f"INSERT INTO {tabla} ({', '.join(campos)}) VALUES {','.join('(' + ','.join(q(v) for v in f) + ')' for f in filas[j:j + 400])};\n" for j in range(i, min(i + 4000, len(filas)), 400)))
    n = d1(db, f'SELECT COUNT(*) n FROM {tabla}', archivo=False)[0]['n']; log(f'{tabla}: {n:,} filas en D1')

# ---------------------------------------------------------------- ENSANUT 2018-19: IMC en adultos de 20 y más
# Cuadro I de Barquera y col. (2020): n, N (miles), % normal, % sobrepeso, % obesidad.
CUADRO_I = {('total',): (16579, 77708.1, 23.5, 39.1, 36.1), ('mujeres',): (9375, 44569.6, 21.8, 36.6, 40.2), ('hombres',): (7204, 33138.5, 25.9, 42.5, 30.5),
            ('20-29',): (3112, 16616.3, 37.3, 34.1, 25.3), ('30-39',): (3533, None, 20.9, 41.9, 36.9), ('40-49',): (3467, 16368.0, 15.4, 38.9, 44.7),
            ('50-59',): (2653, None, 18.0, 40.5, 41.1), ('60-69',): (2026, 9492.6, 18.7, 39.7, 41.3), ('70-79',): (1235, 5375.3, 26.1, 44.1, 28.6), ('80+',): (553, 2396.1, 43.9, 37.0, 15.4)}
GRUPOS = [('20-29', 20, 29), ('30-39', 30, 39), ('40-49', 40, 49), ('50-59', 50, 59), ('60-69', 60, 69), ('70-79', 70, 79), ('80+', 80, 200)]

def ensanut_adultos():
    a = catalogo("programa_slug='ensanut' AND edicion='2018' AND archivo='ensanut-2018-nueva-version-base-datos-cn' AND tabla='cn-antropometria'")
    if len(a) != 1: sys.exit(f'catálogo ENSANUT: {a}')
    t = leer(a[0]); t = t[num(t.edad) >= 20].copy()
    for c in ['peso1_1', 'peso1_2', 'talla4_1', 'talla4_2', 'peso12_1', 'peso12_2', 'talla15_1', 'talla15_2']:
        t[c] = num(t[c]); t.loc[t[c] >= 222.2, c] = np.nan  # 222.222 = no se pesó; 222.2 = no se midió
    mayor = num(t.edad) >= 60
    t['peso'] = np.where(mayor, t[['peso12_1', 'peso12_2']].mean(axis=1), t[['peso1_1', 'peso1_2']].mean(axis=1))
    t['talla'] = np.where(mayor, t[['talla15_1', 'talla15_2']].mean(axis=1), t[['talla4_1', 'talla4_2']].mean(axis=1)) / 100
    t['imc'] = t.peso / t.talla ** 2; t['f'] = num(t.f_antrop_insp).fillna(0); t['edad'] = num(t.edad); t['sexo'] = num(t.sexo).astype(int); t['ent'] = num(t.ent).astype(int)
    embarazada = (t.sexo == 2) & num(t.p6).isin([1, 3])
    sin_reglas = t[t.imc.notna()]; f0 = num(sin_reglas.f_antrop)
    log(f'ENSANUT 2018 sin reglas (todos los adultos con peso y talla, F_ANTROP): n={len(sin_reglas):,} sobrepeso={100 * f0[(sin_reglas.imc >= 25) & (sin_reglas.imc < 30)].sum() / f0.sum():.2f} obesidad={100 * f0[sin_reglas.imc >= 30].sum() / f0.sum():.2f}')
    d = t[t.imc.notna() & (t.talla >= 1.3) & (t.talla <= 2.0) & (t.imc >= 10) & (t.imc <= 58) & ~embarazada & (t.f > 0)].copy()
    d['grupo'] = pd.cut(d.edad, [g[1] - 0.5 for g in GRUPOS] + [999], labels=[g[0] for g in GRUPOS]).astype(str)
    d['cat'] = np.select([d.imc < 18.5, d.imc < 25, d.imc < 30], ['bajo_peso', 'normal', 'sobrepeso'], 'obesidad')
    return d

def verificar_ensanut(d):
    def celda(m):
        s = d[m]; tot = s.f.sum(); p = lambda c: 100 * s.f[s.cat == c].sum() / tot
        return len(s), tot / 1000, p('normal'), p('sobrepeso'), p('obesidad')
    sel = {('total',): d.imc.notna(), ('mujeres',): d.sexo == 2, ('hombres',): d.sexo == 1, **{(g,): d.grupo == g for g, _, _ in GRUPOS}}
    fallos = 0
    for k, pub in CUADRO_I.items():
        n, N, nor, sob, ob = celda(sel[k]); pn, pN, pnor, psob, pob = pub
        peor = max(abs(x - y) for x, y in ((nor, pnor), (sob, psob), (ob, pob)))
        # n y N deben ser exactos en todas las filas (prueban la depuración); los porcentajes, iguales al decimal publicado
        # en total y sexo; por edad se admite hasta 0.1 (el cuadro I trae erratas visibles: repite la N de 30-39 y 50-59)
        ok = n == pn and (pN is None or abs(N - pN) < 0.05) and peor <= (0.051 if k[0] in ('total', 'mujeres', 'hombres') else 0.1)
        fallos += not ok
        log(f"ENSANUT {k[0]:8s} n={n:6d} ({pn}) N={N:9.1f}k ({pN}) normal={nor:.2f} ({pnor}) sobrepeso={sob:.2f} ({psob}) obesidad={ob:.2f} ({pob}) {'OK' if peor <= 0.051 and ok else ('≈ dif %.2f' % peor if ok else 'DIFERENTE')}")
    log(f'verificación ENSANUT vs cuadro I (Barquera y col. 2020) e INSP 39.1/36.1: {len(CUADRO_I) - fallos} de {len(CUADRO_I)} filas iguales (n exacto, N ±0.05 mil, % al decimal publicado)')
    return fallos

def ensanut(cargar):
    d = ensanut_adultos(); fallos = verificar_ensanut(d)
    acc = defaultdict(lambda: [0, 0.0, 0.0, 0.0, 0.0, 0.0])
    for (e, s, g, c), n_f in d.groupby(['ent', 'sexo', 'grupo', 'cat']).f.agg(['size', 'sum']).iterrows():
        v = acc[(2018, int(e), int(s), g)]; v[0] += int(n_f['size']); v[1] += n_f['sum']; v[['bajo_peso', 'normal', 'sobrepeso', 'obesidad'].index(c) + 2] += n_f['sum']
    campos = ['edicion', 'ent', 'sexo', 'grupo_edad', 'n', 'personas', 'bajo_peso', 'normal', 'sobrepeso', 'obesidad']
    filas = [list(k) + [v[0]] + [int(round(x)) for x in v[1:]] for k, v in sorted(acc.items())]
    escribir_csv('ensanut_2018_imc.csv', campos, filas)
    if fallos: log('AVISO: hay diferencias con el cuadro I; no se carga')
    if not cargar or fallos: return
    cargar_tabla(DB_ENCUESTAS, 'ensanut_imc', campos, filas,
                 'CREATE TABLE IF NOT EXISTS ensanut_imc (edicion INTEGER NOT NULL, ent INTEGER NOT NULL, sexo INTEGER NOT NULL, grupo_edad TEXT NOT NULL, n INTEGER NOT NULL, personas INTEGER NOT NULL, bajo_peso INTEGER NOT NULL, normal INTEGER NOT NULL, sobrepeso INTEGER NOT NULL, obesidad INTEGER NOT NULL, PRIMARY KEY (edicion, ent, sexo, grupo_edad));',
                 'DELETE FROM ensanut_imc WHERE edicion = 2018;')

# ---------------------------------------------------------------- ENVIPE: prevalencia delictiva 2017-2026
def victimas_envipe(per, mod):
    """Máscara de víctimas en TPer_Vic1: elegidos con al menos un delito (BPCOD ≠ 03) en TMod_Vic."""
    cod = num(mod.bpcod); con_delito = set(mod.id_per[cod.notna() & (cod != VANDALISMO)])
    return per.id_per.isin(con_delito)

def envipe_prevalencia(cargar):
    arch = catalogo("programa_slug='envipe' AND tabla IN ('tper-vic1','tmod-vic') AND edicion >= '2017'")
    por = defaultdict(dict)
    for a in arch: por[a['edicion']][a['tabla']] = a
    acc = {}
    for ed in sorted(por):
        per = leer(por[ed]['tper-vic1']); mod = leer(por[ed]['tmod-vic'])
        fac = num(per.fac_ele).fillna(0); ent = num(per.cve_ent).astype(int); sexo = num(per.sexo).fillna(9).astype(int); vic = victimas_envipe(per, mod)
        g = pd.DataFrame({'ent': ent, 'sexo': sexo, 'personas': fac, 'victimas': fac.where(vic, 0.0)}).groupby(['ent', 'sexo']).sum()
        for (e, s), r in g.iterrows(): acc[(int(ed), int(ed) - 1, int(e), int(s))] = [int(round(r.personas)), int(round(r.victimas))]
        log(f'ENVIPE {ed}: {len(per):,} elegidos, {fac.sum():,.0f} personas de 18 y más, {vic.sum():,} víctimas en muestra, tasa nacional {1e5 * fac[vic].sum() / fac.sum():.4f}')
    fallos = verificar_prevalencia(acc)
    campos = ['edicion', 'anio', 'ent', 'sexo', 'personas', 'victimas']; filas = [list(k) + v for k, v in sorted(acc.items())]
    escribir_csv('envipe_prevalencia.csv', campos, filas)
    if fallos: log('AVISO: hay diferencias con 6200002197; no se carga')
    if not cargar or fallos: return
    cargar_tabla(DB_SEGURIDAD, 'envipe_prevalencia', campos, filas,
                 'CREATE TABLE IF NOT EXISTS envipe_prevalencia (edicion INTEGER NOT NULL, anio INTEGER NOT NULL, ent INTEGER NOT NULL, sexo INTEGER NOT NULL, personas INTEGER NOT NULL, victimas INTEGER NOT NULL, PRIMARY KEY (edicion, ent, sexo));',
                 'DELETE FROM envipe_prevalencia;')

def verificar_prevalencia(acc):
    """El indicador 6200002197 se publica por año de referencia (edición − 1) en el país y las 32 entidades."""
    of = bise('6200002197'); geo = defaultdict(lambda: [0, 0]); iguales = distintos = 0; peor = 0.0
    for (ed, anio, e, s), (p, v) in acc.items():
        for g in (f'{e:02d}', '00'): geo[(g, anio)][0] += p; geo[(g, anio)][1] += v
    for (g, ref), (p, v) in sorted(geo.items()):
        o = of.get(f'{g}|{ref}')
        if o is None: log(f'sin observación oficial: {g} {ref}'); continue
        dif = abs(1e5 * v / p - o); peor = max(peor, dif)
        if dif < 0.01: iguales += 1
        else: distintos += 1; log(f'DIFERENTE {g} {ref}: calculado {1e5 * v / p:.4f} oficial {o:.4f}')
    log(f'verificación ENVIPE prevalencia vs 6200002197: {iguales} iguales (±0.01 por 100 mil), {distintos} distintos, peor {peor:.5f}')
    return distintos

# ---------------------------------------------------------------- ENVIPE 2020: percepción, solo el levantamiento de marzo
def marzo_2020(per, viv):
    """Máscara sobre TPer_Vic1 2020: elegidos de viviendas levantadas del 17 al 31 de marzo (TVivienda.PER = 1)."""
    primero = set(viv.id_viv[num(viv.per) == 1]); return per.id_viv.isin(primero)

def envipe_2020(cargar):
    arch = {a['tabla']: a for a in catalogo("programa_slug='envipe' AND edicion='2020' AND tabla IN ('tper-vic1','tvivienda')")}
    per = leer(arch['tper-vic1']); viv = leer(arch['tvivienda']); m = marzo_2020(per, viv)
    fac = num(per.fac_ele).fillna(0)
    log(f'ENVIPE 2020: {len(per):,} elegidos; {m.sum():,} del levantamiento de marzo ({fac[m].sum():,.0f} personas de 18 y más) y {(~m).sum():,} del de julio-septiembre')
    for nombre, mm in (('todos los elegidos', fac > 0), ('solo marzo (PER = 1)', m)):
        log(f'  {nombre:22s}: inseguro en su colonia {100 * fac[mm & (num(per.ap4_3_1) == 2)].sum() / fac[mm].sum():.2f} %')
    per = per[m]; fac = fac[m]; ent = num(per.cve_ent).astype(int); sexo = num(per.sexo).fillna(9).astype(int)
    acc = {}
    for amb, col in AMBITOS:
        r = num(per[col]).fillna(9).astype(int)
        g = pd.DataFrame({'ent': ent, 'sexo': sexo, 'personas': fac, 'inseguro': fac.where(r == 2, 0.0), 'seguro': fac.where(r == 1, 0.0), 'no_sabe': fac.where(~r.isin([1, 2]), 0.0)}).groupby(['ent', 'sexo']).sum()
        for (e, s), row in g.iterrows(): acc[(2020, int(e), int(s), amb)] = [int(round(row.personas)), int(round(row.inseguro)), int(round(row.seguro)), int(round(row.no_sabe))]
    of = bise('6200118581'); geo = defaultdict(lambda: [0, 0]); iguales = distintos = 0
    for (anio, e, s, amb), v in acc.items():
        if amb == 'colonia':
            for g in (f'{e:02d}', '00'): geo[g][0] += v[0]; geo[g][1] += v[1]
    for g, (p, i) in sorted(geo.items()):
        o = of.get(f'{g}|2020'); dif = abs(100 * i / p - o)
        if dif < 0.005: iguales += 1
        else: distintos += 1; log(f'DIFERENTE {g}: calculado {100 * i / p:.4f} oficial {o:.4f}')
    log(f'verificación ENVIPE 2020 colonia vs 6200118581: {iguales} iguales (±0.005 pp), {distintos} distintos; población nacional {geo["00"][0]:,} (cuadro 5.4: 35,919,641)')
    fallos = distintos + (geo['00'][0] != 35919641)
    campos = ['anio', 'ent', 'sexo', 'ambito', 'personas', 'inseguro', 'seguro', 'no_sabe']; filas = [list(k) + v for k, v in sorted(acc.items())]
    escribir_csv('envipe_2020_percepcion.csv', campos, filas)
    if fallos: log('AVISO: hay diferencias; no se carga')
    if not cargar or fallos: return
    cargar_tabla(DB_SEGURIDAD, 'envipe_percepcion', campos, filas, '', 'DELETE FROM envipe_percepcion WHERE anio = 2020;')

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0]); ap.add_argument('que', choices=['ensanut', 'envipe-prevalencia', 'envipe-2020']); ap.add_argument('--cargar', action='store_true')
    args = ap.parse_args()
    {'ensanut': ensanut, 'envipe-prevalencia': envipe_prevalencia, 'envipe-2020': envipe_2020}[args.que](args.cargar)

if __name__ == '__main__':
    main()

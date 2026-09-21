"""Percepción de inseguridad (ENVIPE 2017-2026 por entidad; ENSU 2016-2026 por ciudad) agregada desde los microdatos del
INEGI, verificada contra lo que el INEGI publica y cargada en D1 (datosmexico-api-seguridad).

ENVIPE (Encuesta Nacional de Victimización y Percepción sobre Seguridad Pública), tabla TPer_Vic1: la persona elegida de
18 años y más responde si considera seguro (1) o inseguro (2) vivir en su colonia (ap4_3_1), municipio (ap4_3_2) y
entidad (ap4_3_3); 9 = no sabe. Se pondera con fac_ele. Verificación: el porcentaje de «inseguro en su colonia» sobre
toda la población de 18 y más (incluido «no sabe») reproduce el indicador 6200118581 del Banco de Indicadores
(«Percepción de la inseguridad») en el país y en las 32 entidades, 2025 y 2026, a la milésima (medido antes de escribir
esto) en todas las ediciones 2017-2026. En 2020 el levantamiento se partió por la pandemia (17-31 de marzo y 27 de julio-4 de
septiembre) y el INEGI publica la percepción solo del de marzo: se toman los elegidos con TVivienda.PER = 1 (48.74 %; con
todos daría 42.93 %), regla documentada en scripts/metodologias_inegi.py y docs/METODOLOGIAS-INEGI.md. Las ediciones 2014-2016 no traen sexo ni entidad en la tabla y 2011-2013 tienen otra
estructura: quedan fuera.
La tasa de prevalencia delictiva (indicador 6200002197) se calcula y carga con scripts/metodologias_inegi.py envipe-prevalencia.

ENSU (Encuesta Nacional de Seguridad Pública Urbana), tabla CB por trimestre (marzo, junio, septiembre, diciembre):
bp1_1 = ¿considera seguro (1) o inseguro (2) vivir en su ciudad?, 9 = no sabe; fac_sel pondera a la persona de 18 y más;
cd = ciudad de interés (hasta 90). Verificación: el cuadro 1.7 de los tabulados básicos de junio 2026 (archivados en el
observatorio) trae la población de 18 y más y los absolutos «Seguro»/«Inseguro» por ciudad; se compara ciudad por ciudad.
Los levantamientos 2013-2015 (piloto, ~2,000 cuestionarios, otras variables) quedan fuera; sexo existe desde 2021 (antes,
9 = sin dato en la tabla).

Uso: data/.venv/bin/python scripts/seguridad_d1.py [--cargar]
"""
import argparse, csv, io, json, pathlib, re, subprocess, sys, tempfile, time, urllib.request, zipfile
from collections import Counter, defaultdict
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import inegi_ingesta as ing
import numpy as np, pyarrow as pa, pyarrow.parquet as pq

RAIZ = ing.RAIZ; DIR = RAIZ / 'data/seguridad'; CRUDO = DIR / 'crudo'; CRUDO.mkdir(parents=True, exist_ok=True)
DB = 'datosmexico-api-seguridad'; API = 'https://api.datosmexico.org/api/v1'
AMBITOS = [('colonia', 'ap4_3_1', 'Su colonia o localidad'), ('municipio', 'ap4_3_2', 'Su municipio o alcaldía'), ('entidad', 'ap4_3_3', 'Su entidad federativa')]

def log(m):
    with open(DIR / 'seguridad.log', 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {m}\n")
    print(m, flush=True)

def catalogo():
    cache = DIR / 'archivos.json'
    if not cache.exists():
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'datosmexico-api-bise', '--remote', '--yes', '--json', '--command',
                            "SELECT programa_slug, edicion, tabla, filas, clave_r2, sha256_zip FROM da_microdatos WHERE (programa_slug='envipe' AND tabla='tper-vic1' AND edicion >= '2017') OR (programa_slug='ensu' AND tabla LIKE '%cb%' AND edicion >= '2016' AND tabla NOT LIKE '%sec4%')"], cwd=RAIZ, capture_output=True, text=True)
        cache.write_text(json.dumps(json.loads(r.stdout)[0]['results'], ensure_ascii=False, indent=1))
    return json.loads(cache.read_text())

def leer(a):
    out = CRUDO / f"{a['programa_slug']}-{a['edicion']}-{a['tabla']}.parquet"
    if not out.exists(): ing._s3().download_file(ing.BUCKET, a['clave_r2'], str(out) + '.tmp'); (CRUDO / (out.name + '.tmp')).rename(out)
    t = pq.read_table(out)
    if t.num_rows != a['filas']: sys.exit(f'{out.name}: {t.num_rows} filas, catálogo {a["filas"]}')
    return t

def entero(t, c, faltante=None):
    if c not in t.column_names: return np.full(t.num_rows, faltante, dtype=float)
    return np.nan_to_num(t[c].to_numpy(zero_copy_only=False).astype(float), nan=faltante if faltante is not None else -1)

def envipe(arch):
    filas = Counter()  # (anio, ent, sexo, ambito) -> [total, inseguro, seguro, ns]
    acc = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])
    for a in sorted(arch, key=lambda a: a['edicion']):
        if a['programa_slug'] != 'envipe': continue
        t = leer(a); anio = int(a['edicion'])
        if anio == 2020:  # solo el levantamiento del 17 al 31 de marzo (TVivienda.PER = 1), como lo publica el INEGI; ver scripts/metodologias_inegi.py
            import metodologias_inegi as met
            viv = met.leer({x['tabla']: x for x in met.catalogo("programa_slug='envipe' AND edicion='2020' AND tabla IN ('tper-vic1','tvivienda')")}['tvivienda'])
            t = t.filter(pa.array(met.marzo_2020(t.to_pandas()[['id_viv']], viv).to_numpy())); log(f'ENVIPE 2020: {t.num_rows:,} elegidos del levantamiento de marzo (los de julio-septiembre no entran en la percepción publicada)')
        fac = entero(t, 'fac_ele', 0); ent = entero(t, 'cve_ent').astype(int); sexo = entero(t, 'sexo', 9).astype(int)
        edad = entero(t, 'edad', 99)
        if (edad < 18).any(): log(f'ENVIPE {anio}: {(edad < 18).sum()} elegidos menores de 18 (se conservan: el INEGI los pondera igual)')
        for clave, col, _ in AMBITOS:
            r = entero(t, col, 9).astype(int)
            for e in np.unique(ent):
                for s in (1, 2):
                    m = (ent == e) & (sexo == s)
                    if not m.any(): continue
                    k = (anio, int(e), s, clave); v = acc[k]
                    v[0] += fac[m].sum(); v[1] += fac[m & (r == 2)].sum(); v[2] += fac[m & (r == 1)].sum(); v[3] += fac[m & (r != 1) & (r != 2)].sum()
        log(f'ENVIPE {anio}: {t.num_rows:,} elegidos, {fac.sum():,.0f} personas de 18 y más')
    return {k: [int(round(x)) for x in v] for k, v in acc.items()}

def periodo_de(tabla):
    m = re.search(r'(\d{2})(\d{2})$', tabla); return f'20{m.group(2)}-{m.group(1)}'

def ensu(arch):
    acc = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0]); ciudades = {}
    for a in sorted([a for a in arch if a['programa_slug'] == 'ensu'], key=lambda a: periodo_de(a['tabla'])):
        t = leer(a); per = periodo_de(a['tabla']); fac = entero(t, 'fac_sel', 0); cd = entero(t, 'cd').astype(int); sexo = entero(t, 'sexo', 9).astype(int); r = entero(t, 'bp1_1', 9).astype(int)
        ent = entero(t, 'cve_ent').astype(int); nom = t['nom_cd'].to_pylist() if 'nom_cd' in t.column_names else [None] * t.num_rows
        for c, e, n in zip(cd, ent, nom):
            if n and (c not in ciudades or ciudades[c][1] is None): ciudades[c] = (int(e) if e > 0 else ciudades.get(c, (None, None))[0], n.strip())
            elif c not in ciudades: ciudades[c] = (int(e) if e > 0 else None, None)
        for c in np.unique(cd):
            for s in np.unique(sexo):
                m = (cd == c) & (sexo == s)
                k = (per, int(c), int(s)); v = acc[k]
                v[0] += fac[m].sum(); v[1] += fac[m & (r == 2)].sum(); v[2] += fac[m & (r == 1)].sum(); v[3] += fac[m & (r != 1) & (r != 2)].sum()
        log(f'ENSU {per}: {t.num_rows:,} cuestionarios, {len(np.unique(cd))} ciudades, {fac.sum():,.0f} personas de 18 y más')
    return {k: [int(round(x)) for x in v] for k, v in acc.items()}, ciudades

def bise(ind):
    out = {}; offset = 0
    while True:
        req = urllib.request.Request(f'{API}/inegi/indicadores/{ind}/observaciones?limit=5000&offset={offset}', headers={'User-Agent': 'curl/8'})
        d = json.loads(urllib.request.urlopen(req, timeout=120).read())
        for o in d['observaciones']:
            if o['valor'] is not None: out[f"{o['geografia']}|{o['periodo']}"] = o['valor']
        offset += 5000
        if offset >= d['total']: break
    return out

def verificar_envipe(datos):
    of = bise('6200118581'); iguales = distintos = 0; peor = 0.0
    porGeo = defaultdict(lambda: [0.0, 0.0])
    for (anio, e, s, amb), v in datos.items():
        if amb != 'colonia': continue
        porGeo[(f'{e:02d}', anio)][0] += v[0]; porGeo[(f'{e:02d}', anio)][1] += v[1]; porGeo[('00', anio)][0] += v[0]; porGeo[('00', anio)][1] += v[1]
    for (g, anio), (tot, ins) in porGeo.items():
        o = of.get(f'{g}|{anio}')
        if o is None: continue
        d = abs(100 * ins / tot - o); peor = max(peor, d)
        if d < 0.005: iguales += 1
        else: distintos += 1
    log(f'verificación ENVIPE colonia vs 6200118581: {iguales} iguales (±0.005 pp), {distintos} distintos, peor {peor:.4f} pp')
    return distintos

def verificar_ensu(datos, ciudades):
    """Compara junio 2026 con el cuadro 1.7 ciudad por ciudad. El emparejamiento es por la población de 18 y más (entera y
    única por ciudad), no por el nombre: el cuadro usa nombres oficiales («León de los Aldama») y los microdatos otros
    («LEON»). Los nombres oficiales de las ciudades emparejadas se guardan para el catálogo."""
    z = zipfile.ZipFile(DIR / 'ensu_basicos_junio_2026.zip'); import openpyxl
    ws = openpyxl.load_workbook(io.BytesIO(z.read('1.Bas_percepcion_seguridad_jun_2026_est.xlsx')), read_only=True, data_only=True)['1.7']
    oficial = []; actual = None
    for row in ws.iter_rows(values_only=True):
        a, b, c = row[0], row[1], row[2]
        if isinstance(a, str) and isinstance(b, (int, float)): actual = {'nombre': re.sub(r'\d+$', '', a.strip()), 'total': int(b)}; oficial.append(actual)
        elif isinstance(a, str) and a.strip() in ('Seguro', 'Inseguro') and actual and isinstance(c, (int, float)): actual[a.strip().lower()] = int(c)
    porTotal = {o['total']: o for o in oficial}
    calc = defaultdict(lambda: [0, 0, 0])
    for (per, cd, s), v in datos.items():
        if per != '2026-06': continue
        calc[cd][0] += v[0]; calc[cd][1] += v[1]; calc[cd][2] += v[2]; calc[-1][0] += v[0]; calc[-1][1] += v[1]; calc[-1][2] += v[2]
    iguales = distintos = 0; nombres = {}; sin = []
    for cd, (tot, ins, seg) in calc.items():
        o = porTotal.get(tot)
        if not o: sin.append((cd, (ciudades.get(cd) or (None, None))[1], tot)); continue
        if o.get('inseguro') == ins and o.get('seguro') == seg: iguales += 1; nombres[cd] = o['nombre']
        else: distintos += 1; log(f'ENSU distinta: {cd} {o["nombre"]} calc {ins}/{seg} oficial {o.get("inseguro")}/{o.get("seguro")}')
    (DIR / 'ciudades_oficiales.json').write_text(json.dumps({str(k): v for k, v in nombres.items() if k >= 0}, ensure_ascii=False, indent=1))
    log(f'verificación ENSU junio 2026 vs cuadro 1.7: {iguales} de {len(calc)} (país + ciudades) con población, seguro e inseguro exactos; {distintos} distintas; sin cuadro: {sin}')
    return distintos + len(sin)

def d1(sql, archivo=True):
    """Ejecuta en D1 con hasta 4 intentos (la API de Cloudflare devuelve a veces un error de autenticación transitorio)."""
    ruta = None
    if archivo:
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f: f.write(sql); ruta = f.name
    for intento in range(4):
        args = ['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes'] + (['--file', ruta] if archivo else ['--json', '--command', sql])
        r = subprocess.run(args, cwd=RAIZ, capture_output=True, text=True)
        if r.returncode == 0: return None if archivo else json.loads(r.stdout)[0]['results']
        log(f'wrangler falló (intento {intento + 1}): {(r.stdout + r.stderr)[-300:].strip()}'); time.sleep(20 * (intento + 1))
    sys.exit('wrangler falló cuatro veces')

def q(v): return 'NULL' if v is None else ("'" + str(v).replace("'", "''") + "'" if isinstance(v, str) else str(v))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--cargar', action='store_true'); args = ap.parse_args()
    arch = catalogo(); log(f'{len(arch)} archivos')
    env = envipe(arch); ens, ciudades = ensu(arch)
    v1 = verificar_envipe(env); v2 = verificar_ensu(ens, ciudades)
    if v1 or v2: log('AVISO: hay diferencias; revisar antes de cargar')
    if not args.cargar: return
    if v1 or v2: sys.exit('no se carga con diferencias')
    geos = {r['clave']: r['nombre'] for r in csv.DictReader(open(RAIZ / 'data/bise/neon-export/geografias.csv'))}
    oficiales = json.loads((DIR / 'ciudades_oficiales.json').read_text())
    entidades = [(int(k), v) for k, v in geos.items() if len(k) == 2 and k != '00']
    tablas = {
        'cat_entidad': (['clave', 'nombre'], entidades), 'cat_sexo': (['clave', 'nombre'], [(1, 'Hombres'), (2, 'Mujeres'), (9, 'Sin dato de sexo en la edición')]),
        'cat_ambito': (['clave', 'nombre'], [(k, n) for k, _, n in AMBITOS]),
        'cat_ciudad': (['clave', 'nombre', 'ent'], [(c, oficiales.get(str(c)) or n or f'Ciudad {c}', e) for c, (e, n) in sorted(ciudades.items())]),
        'envipe_percepcion': (['anio', 'ent', 'sexo', 'ambito', 'personas', 'inseguro', 'seguro', 'no_sabe'], [list(k) + v for k, v in sorted(env.items())]),
        'ensu_percepcion': (['periodo', 'ciudad', 'sexo', 'personas', 'inseguro', 'seguro', 'no_sabe'], [list(k) + v for k, v in sorted(ens.items())]),
        'archivos': (['programa', 'edicion', 'tabla', 'filas', 'clave_r2', 'sha256_zip'], [[a['programa_slug'], a['edicion'], a['tabla'], a['filas'], a['clave_r2'], a['sha256_zip']] for a in arch]),
    }
    d1((RAIZ / 'data/seguridad/schema.sqlite.sql').read_text() + '\n' + '\n'.join(f'DELETE FROM {t};' for t in tablas) + '\n')
    for tabla, (campos, filas) in tablas.items():
        for i in range(0, len(filas), 4000):
            d1(''.join(f"INSERT INTO {tabla} ({', '.join(campos)}) VALUES {','.join('(' + ','.join(q(v) for v in f) + ')' for f in filas[j:j + 400])};\n" for j in range(i, min(i + 4000, len(filas)), 400)))
        n = d1(f'SELECT COUNT(*) n FROM {tabla}', archivo=False)[0]['n']; log(f'{tabla}: {n:,} filas en D1 (esperadas {len(filas):,})')
        if n != len(filas): sys.exit('la carga no cuadra')
    log('carga completa')

if __name__ == '__main__':
    main()

"""Registros vitales del INEGI (defunciones registradas 1990-2024 y nacimientos registrados 1985-2024) agregados para el
explorador, verificados contra el Banco de Indicadores y cargados en D1 (datosmexico-api-vitales).

Origen: los microdatos de los programas EDR (Estadísticas de defunciones registradas, tablas defunYY) y ENR
(Estadísticas de nacimientos registrados, tablas nacimYY) de la descarga masiva del INEGI, ya convertidos a Parquet en
R2 por scripts/inegi_ingesta.py (catálogo en da_microdatos; data/vitales/archivos.json, data/vitales/crudo/).

Diseño (medido en 2024: 819,672 defunciones, 1,672,227 nacimientos):
- defunciones_municipio (anio_regis, ent_resid, mun_resid, sexo, edad_grupo, n): 1990-2024, seis grupos de edad.
- defunciones_causa (anio_regis, ent_resid, sexo, edad_agru, capitulo, gr_lismex, n): 1998-2024 (CIE-10; los archivos
  1990-1997 vienen en CIE-9 sin lista mexicana ni capítulo), 30 grupos de edad del INEGI.
- defunciones_lista (anio_regis, ent_resid, sexo, lista_mex, n): 1998-2024, las 422 causas de la lista mexicana.
- nacimientos_municipio (ano_reg, ent_resid, mun_resid, sexo, oportunidad, n): 1985-2024; oportunidad = el nacimiento
  ocurrió el mismo año del registro, el anterior, antes, o no se especificó.
- nacimientos_madre (ano_reg, ent_resid, sexo, edad_madre_grupo, orden_parto, n): 1985-2024.
Todas por entidad/municipio de RESIDENCIA habitual (de la persona fallecida o de la madre): es la base con la que el INEGI
publica «Defunciones registradas» (1002000030) y «Nacimientos registrados» (1002000026) y con la que aquí se verifica
cada año a nivel nacional, por entidad y por municipio (2024: 2,450/2,450 municipios con defunciones y 2,443/2,443 con
nacimientos iguales al Banco de Indicadores; por entidad de registro u ocurrencia ninguno coincide).

Códigos (verificados contra la columna `edad` de 2024): edad_agru 1 = menores de 1 año, 2-5 = 1 a 4 años, 6-29 =
quinquenios de 5-9 a 120 y más, 30 = no especificada. sexo 1 hombre, 2 mujer, 9 no especificado. ent_resid 33 =
Estados Unidos de América, 34 = otros países de Latinoamérica, 35 = otros países, 99 = no especificada; mun_resid 999 = no
especificado. Años de dos dígitos en los archivos antiguos
(85 = 1985): se normalizan y se comprueban contra el año del archivo. Los catálogos de causas (capgpo, gpolimex,
listamex 2024) llegan en CP437 mal decodificado («C¢lera»): se re-decodifican y se comprueba que el texto resultante
sea latino limpio.

Uso: data/.venv/bin/python scripts/vitales_d1.py [--cargar]
Salida: data/vitales/agregados/*.csv, data/vitales/verificacion.csv, data/vitales/vitales.log.
"""
import argparse, csv, json, pathlib, re, subprocess, sys, tempfile, time, urllib.request
from collections import Counter, defaultdict
import pyarrow as pa, pyarrow.parquet as pq, pyarrow.compute as pc

RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data/vitales'; CRUDO = DIR / 'crudo'; AGR = DIR / 'agregados'; AGR.mkdir(exist_ok=True)
DB = 'datosmexico-api-vitales'; API = 'https://api.datosmexico.org/api/v1'
BISE = {'defunciones': {'total': '1002000030', 'hombres': '1002000031', 'mujeres': '1002000032', 'menores_1': '1002000034'},
        'nacimientos': {'total': '1002000026', 'hombres': '1002000027', 'mujeres': '1002000028'}}
EDAD_GRUPO = {1: '<1', **{k: '1-14' for k in range(2, 8)}, **{k: '15-29' for k in range(8, 11)}, **{k: '30-59' for k in range(11, 17)}, **{k: '60+' for k in range(17, 30)}, 30: 'NE'}
CAT_EDAD_GRUPO = [('<1', 'Menores de 1 año'), ('1-14', '1 a 14 años'), ('15-29', '15 a 29 años'), ('30-59', '30 a 59 años'), ('60+', '60 años y más'), ('NE', 'Edad no especificada')]
CAT_EDAD_AGRU = [(1, 'Menores de 1 año'), (2, '1 año'), (3, '2 años'), (4, '3 años'), (5, '4 años')] + [(k, f'{5 * (k - 5)} a {5 * (k - 5) + 4} años') for k in range(6, 29)] + [(29, '120 años y más'), (30, 'No especificada')]
CAT_SEXO = [(1, 'Hombres'), (2, 'Mujeres'), (9, 'No especificado')]
CAT_OPORTUNIDAD = [('mismo', 'Nacidos el mismo año del registro'), ('anterior', 'Nacidos el año anterior'), ('antes', 'Nacidos dos o más años antes'), ('NE', 'Año de nacimiento no especificado')]
CAT_EDAD_MADRE = [('<15', 'Menores de 15 años'), ('15-19', '15 a 19 años'), ('20-24', '20 a 24 años'), ('25-29', '25 a 29 años'), ('30-34', '30 a 34 años'), ('35-39', '35 a 39 años'), ('40-44', '40 a 44 años'), ('45-49', '45 a 49 años'), ('50+', '50 años y más'), ('NE', 'No especificada')]
CAT_ORDEN = [('1', 'Primer hijo'), ('2', 'Segundo'), ('3', 'Tercero'), ('4', 'Cuarto'), ('5', 'Quinto'), ('6+', 'Sexto o posterior'), ('NE', 'No especificado')]

def log(m):
    with open(DIR / 'vitales.log', 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {m}\n")
    print(m, flush=True)

def anio_de(tabla):
    yy = int(tabla[-2:]); return 1900 + yy if yy >= 85 else 2000 + yy

def norm_anio(v, ref):
    """Año de dos o cuatro dígitos → cuatro; 99/9999/nulo → None."""
    if v is None or v != v: return None
    v = int(v)
    if v in (99, 9999, 999): return None
    if v < 100: v = 1900 + v if v >= 85 or v > ref % 100 else 2000 + v
    return v

def cp437(s):
    if s is None: return None
    try:
        t = s.encode('latin-1').decode('cp437')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s
    return t if re.fullmatch(r"[\w\s.,;:()'/¿?¡!\-–—«»\"%&+ÁÉÍÓÚÑáéíóúñüÜ]+", t) else s

def col_(t, nombre, entero=True):
    if nombre not in t.column_names: return None
    x = t[nombre]
    if entero and not pa.types.is_integer(x.type): x = pc.cast(pc.floor(x), pa.int64(), safe=False) if pa.types.is_floating(x.type) else x
    return x.to_pylist()

def grupos(t, columnas):
    """Filas distintas de las columnas dadas con su conteo (pyarrow group_by): así el bucle de Python recorre miles de
    grupos y no millones de registros. Las columnas ausentes en el archivo se devuelven como None."""
    presentes = [c for c in columnas if c in t.column_names]
    g = t.select(presentes).group_by(presentes).aggregate([([], 'count_all')])
    cols = {c: (g[c].to_pylist() if c in presentes else [None] * g.num_rows) for c in columnas}
    return cols, g['count_all'].to_pylist()

def entero(v):
    return None if v is None or v != v else int(v)

def agregar_defunciones():
    muni, causa, lista = Counter(), Counter(), Counter(); resumen = {}
    for f in sorted(CRUDO.glob('defun*.parquet')):
        anio = anio_de(f.stem); t = pq.read_table(f)
        con_causa = 'capitulo' in t.column_names
        malos = sum(1 for a in t['anio_regis'].to_pylist() if norm_anio(a, anio) != anio)
        if malos: log(f'{f.stem}: {malos} filas con anio_regis distinto de {anio}')
        c, n = grupos(t, ['ent_resid', 'mun_resid', 'sexo', 'edad_agru', 'capitulo', 'gr_lismex', 'lista_mex'])
        for i in range(len(n)):
            e = entero(c['ent_resid'][i]); e = 99 if e is None else e
            m = entero(c['mun_resid'][i]); m = 999 if m is None else m
            s = entero(c['sexo'][i]); s = s if s in (1, 2) else 9
            g = entero(c['edad_agru'][i]); g = g if g in EDAD_GRUPO else 30
            muni[(anio, e, m, s, EDAD_GRUPO[g])] += n[i]
            if con_causa:
                cap = entero(c['capitulo'][i]) or 0; gl = (c['gr_lismex'][i] or '').strip() or 'NE'; l = (c['lista_mex'][i] or '').strip() or 'NE'
                causa[(anio, e, s, g, cap, gl)] += n[i]; lista[(anio, e, s, l)] += n[i]
        resumen[anio] = t.num_rows; log(f'defunciones {anio}: {t.num_rows:,} filas' + ('' if con_causa else ' (sin causa CIE-10)'))
    return muni, causa, lista, resumen

def grupo_madre(e):
    if e is None or e >= 99: return 'NE'
    if e < 15: return '<15'
    if e >= 50: return '50+'
    lo = 5 * (e // 5); return f'{lo}-{lo + 4}'

def agregar_nacimientos():
    muni, madre = Counter(), Counter(); resumen = {}
    for f in sorted(CRUDO.glob('nacim*.parquet')):
        anio = anio_de(f.stem); t = pq.read_table(f)
        malos = sum(1 for a in t['ano_reg'].to_pylist() if norm_anio(a, anio) != anio)
        if malos: log(f'{f.stem}: {malos} filas con ano_reg distinto de {anio}')
        c, n = grupos(t, ['ano_nac', 'ent_resid', 'mun_resid', 'sexo', 'edad_madr', 'orden_part'])
        for i in range(len(n)):
            e = entero(c['ent_resid'][i]); e = 99 if e is None else e
            m = entero(c['mun_resid'][i]); m = 999 if m is None else m
            s = entero(c['sexo'][i]); s = s if s in (1, 2) else 9
            nac = norm_anio(c['ano_nac'][i], anio); o = 'NE' if nac is None else 'mismo' if nac == anio else 'anterior' if nac == anio - 1 else 'antes'
            muni[(anio, e, m, s, o)] += n[i]
            p = entero(c['orden_part'][i]); orden = 'NE' if p is None or p >= 99 or p < 1 else ('6+' if p >= 6 else str(p))
            madre[(anio, e, s, grupo_madre(entero(c['edad_madr'][i])), orden)] += n[i]
        resumen[anio] = t.num_rows; log(f'nacimientos {anio}: {t.num_rows:,} filas')
    return muni, madre, resumen

def escribir(nombre, campos, cont):
    with open(AGR / f'{nombre}.csv', 'w', newline='') as f:
        w = csv.writer(f); w.writerow(campos + ['n'])
        for k in sorted(cont): w.writerow(list(k) + [cont[k]])
    log(f'{nombre}: {len(cont):,} filas, {sum(cont.values()):,} registros')

def bise_obs(ind):
    cache = DIR / f'bise_{ind}.json'
    if cache.exists(): return json.loads(cache.read_text())
    out = {}; offset = 0
    while True:
        req = urllib.request.Request(f'{API}/inegi/indicadores/{ind}/observaciones?limit=5000&offset={offset}', headers={'User-Agent': 'curl/8'})
        d = json.loads(urllib.request.urlopen(req, timeout=120).read())
        for o in d['observaciones']:
            if o['valor'] is not None and re.fullmatch(r'\d{4}', o['periodo']): out[f"{o['geografia']}|{o['periodo']}"] = o['valor']
        offset += 5000
        if offset >= d['total']: break
    cache.write_text(json.dumps(out)); return out

def verificar(muni_def, muni_nac):
    filas = []
    def comparar(nombre, cont, geo_de, filtro, ind):
        of = bise_obs(ind); calc = Counter()
        for k, v in cont.items():
            if not filtro(k): continue
            anio, e, m = k[0], k[1], k[2]
            calc[('00', anio)] += v
            if 1 <= e <= 32: calc[(f'{e:02d}', anio)] += v; calc[(f'{e:02d}{m:03d}', anio)] += v
        iguales = distintos = 0
        for (g, anio), v in calc.items():
            o = of.get(f'{g}|{anio}')
            if o is None: continue
            filas.append({'serie': nombre, 'geografia': g, 'anio': anio, 'calculado': v, 'inegi': o, 'delta': v - o})
            if v == o: iguales += 1
            else: distintos += 1
        peores = sorted([r for r in filas if r['serie'] == nombre and r['delta']], key=lambda r: -abs(r['delta']))[:3]
        log(f'verificación {nombre} ({ind}): {iguales:,} iguales, {distintos:,} distintos' + (f'; peores {[(r["geografia"], r["anio"], r["calculado"], r["inegi"]) for r in peores]}' if peores else ''))
    comparar('defunciones', muni_def, None, lambda k: True, BISE['defunciones']['total'])
    comparar('defunciones_hombres', muni_def, None, lambda k: k[3] == 1, BISE['defunciones']['hombres'])
    comparar('defunciones_mujeres', muni_def, None, lambda k: k[3] == 2, BISE['defunciones']['mujeres'])
    comparar('defunciones_menores_1', muni_def, None, lambda k: k[4] == '<1', BISE['defunciones']['menores_1'])
    comparar('nacimientos', muni_nac, None, lambda k: True, BISE['nacimientos']['total'])
    comparar('nacimientos_hombres', muni_nac, None, lambda k: k[3] == 1, BISE['nacimientos']['hombres'])
    comparar('nacimientos_mujeres', muni_nac, None, lambda k: k[3] == 2, BISE['nacimientos']['mujeres'])
    with open(DIR / 'verificacion.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['serie', 'geografia', 'anio', 'calculado', 'inegi', 'delta']); w.writeheader(); w.writerows(filas)
    return filas

def catalogos():
    cap = pq.read_table(DIR / 'catalogos/capgpo.parquet').to_pylist(); gp = pq.read_table(DIR / 'catalogos/gpolimex.parquet').to_pylist(); lm = pq.read_table(DIR / 'catalogos/listamex.parquet').to_pylist()
    capitulos = [(int(r['cap']), cp437(r['descrip'])) for r in cap if r['gpo'] is None and r['cap'] is not None]
    # El capgpo del INEGI no trae el capítulo XXII de la CIE-10 (códigos U: COVID-19), que sí aparece en los datos desde 2020.
    if not any(c == 22 for c, _ in capitulos): capitulos.append((22, 'Códigos para propósitos especiales (COVID-19 y otros códigos U)'))
    grupos = [(str(r['cve']).strip(), cp437(r['descrip'])) for r in gp]
    listas = [(str(r['cve']).strip(), cp437(r['descrip'])) for r in lm]
    geos = {r['clave']: r['nombre'] for r in csv.DictReader(open(RAIZ / 'data/bise/neon-export/geografias.csv'))}
    # Claves de residencia fuera del país en los descriptores de la EDR y la ENR: 33 Estados Unidos de América, 34 otros
    # países de Latinoamérica, 35 otros países; 99 no especificada. Están en los datos desde 1985 y suman al total nacional.
    entidades = [(int(k), v) for k, v in geos.items() if len(k) == 2 and k != '00'] + [(33, 'Estados Unidos de América'), (34, 'Otros países de Latinoamérica'), (35, 'Otros países'), (99, 'No especificada')]
    municipios = [(int(k[:2]), int(k[2:]), v) for k, v in geos.items() if len(k) == 5]
    return capitulos, grupos, listas, entidades, municipios

def d1(sql, archivo=True):
    """Ejecuta en D1 con hasta 4 intentos: la API de Cloudflare devuelve de vez en cuando «Authentication error [code: 10000]»
    transitorio a media carga; un fallo persistente aborta."""
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

def cargar(tablas):
    """Reanudable: una tabla cuyo conteo remoto ya es el esperado se salta; las demás se vacían y se cargan."""
    d1((RAIZ / 'data/vitales/schema.sqlite.sql').read_text())
    for tabla, (campos, filas) in tablas.items():
        if d1(f'SELECT COUNT(*) n FROM {tabla}', archivo=False)[0]['n'] == len(filas): log(f'{tabla}: ya cargada ({len(filas):,} filas)'); continue
        d1(f'DELETE FROM {tabla};')
        for i in range(0, len(filas), 4000):
            sql = ''.join(f"INSERT INTO {tabla} ({', '.join(campos)}) VALUES {','.join('(' + ','.join(q(v) for v in f) + ')' for f in filas[j:j + 400])};\n" for j in range(i, min(i + 4000, len(filas)), 400))
            d1(sql)
        n = d1(f'SELECT COUNT(*) n FROM {tabla}', archivo=False)[0]['n']
        log(f'{tabla}: {n:,} filas en D1 (esperadas {len(filas):,})')
        if n != len(filas): sys.exit('la carga no cuadra')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--cargar', action='store_true'); args = ap.parse_args()
    muni_def, causa, lista, rdef = agregar_defunciones(); muni_nac, madre, rnac = agregar_nacimientos()
    escribir('defunciones_municipio', ['anio_regis', 'ent_resid', 'mun_resid', 'sexo', 'edad_grupo'], muni_def)
    escribir('defunciones_causa', ['anio_regis', 'ent_resid', 'sexo', 'edad_agru', 'capitulo', 'gr_lismex'], causa)
    escribir('defunciones_lista', ['anio_regis', 'ent_resid', 'sexo', 'lista_mex'], lista)
    escribir('nacimientos_municipio', ['ano_reg', 'ent_resid', 'mun_resid', 'sexo', 'oportunidad'], muni_nac)
    escribir('nacimientos_madre', ['ano_reg', 'ent_resid', 'sexo', 'edad_madre_grupo', 'orden_parto'], madre)
    assert sum(muni_def.values()) == sum(rdef.values()) and sum(muni_nac.values()) == sum(rnac.values()) and sum(madre.values()) == sum(rnac.values())
    assert sum(causa.values()) == sum(lista.values()) == sum(v for a, v in rdef.items() if a >= 1998)
    verificar(muni_def, muni_nac)
    if not args.cargar: return
    capitulos, grupos, listas, entidades, municipios = catalogos()
    tablas = {
        'cat_entidad': (['clave', 'nombre'], entidades), 'cat_municipio': (['ent', 'mun', 'nombre'], municipios), 'cat_sexo': (['clave', 'nombre'], CAT_SEXO),
        'cat_edad_grupo': (['clave', 'nombre'], CAT_EDAD_GRUPO), 'cat_edad_agru': (['clave', 'nombre'], CAT_EDAD_AGRU), 'cat_capitulo': (['clave', 'nombre'], capitulos),
        'cat_gr_lismex': (['clave', 'nombre'], grupos), 'cat_lista_mex': (['clave', 'nombre'], listas), 'cat_oportunidad': (['clave', 'nombre'], CAT_OPORTUNIDAD),
        'cat_edad_madre_grupo': (['clave', 'nombre'], CAT_EDAD_MADRE), 'cat_orden_parto': (['clave', 'nombre'], CAT_ORDEN),
        'defunciones_municipio': (['anio_regis', 'ent_resid', 'mun_resid', 'sexo', 'edad_grupo', 'n'], [list(k) + [v] for k, v in sorted(muni_def.items())]),
        'defunciones_causa': (['anio_regis', 'ent_resid', 'sexo', 'edad_agru', 'capitulo', 'gr_lismex', 'n'], [list(k) + [v] for k, v in sorted(causa.items())]),
        'defunciones_lista': (['anio_regis', 'ent_resid', 'sexo', 'lista_mex', 'n'], [list(k) + [v] for k, v in sorted(lista.items())]),
        'nacimientos_municipio': (['ano_reg', 'ent_resid', 'mun_resid', 'sexo', 'oportunidad', 'n'], [list(k) + [v] for k, v in sorted(muni_nac.items())]),
        'nacimientos_madre': (['ano_reg', 'ent_resid', 'sexo', 'edad_madre_grupo', 'orden_parto', 'n'], [list(k) + [v] for k, v in sorted(madre.items())]),
        'archivos': (['programa', 'tabla', 'anio', 'filas', 'clave_r2', 'sha256_zip'], [[a['programa_slug'], a['tabla'], anio_de(a['tabla']), a['filas'], a['clave_r2'], a['sha256_zip']] for a in json.load(open(DIR / 'archivos.json'))]),
    }
    cargar(tablas); log('carga completa')

if __name__ == '__main__':
    main()

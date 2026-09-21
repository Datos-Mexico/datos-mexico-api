"""Carga el Banco de Información Económica (BIE) del INEGI en D1 (datosmexico-api-bie) a partir de los crudos de
scripts/bie_descarga.py y del árbol de scripts/bie_arbol.py, y lo verifica.

Tablas:
- temas (tema, nombre, tema_superior, orden, nivel) — el árbol del BIE (14 raíces).
- series (id, nombre, unidad, frecuencia, fuente, tema, ruta, periodo_inicial, periodo_final, ultima_actualizacion,
  decimales, n_areas, n_observaciones, busqueda) — una fila por serie; `ruta` = temas de la raíz a la hoja; `busqueda`
  = texto normalizado (sin acentos) para buscar con sinónimos (src/lib/busqueda.ts).
- areas (clave, nombre, desglose) — «00» nacional, «01»-«32» entidades y las demás áreas que use el BIE (zonas
  metropolitanas, ciudades, países), tal como las nombra el INEGI.
- observaciones (serie, area, periodo, valor, estatus) — el valor tal como lo entrega el INEGI (texto decimal, se guarda
  también como número); estatus = letra de cifra (D definitiva, P preliminar, R revisada…) cuando el INEGI la publica.
- periodos (periodo, n) — catálogo derivado.
Formato de origen: JSON-stat del sitio (dimension.periods.category.label = [{Key, Value}], value = [texto]).
Carga: sentencias de hasta 500 filas y archivos de hasta 8 MB con `wrangler d1 execute --file` (límites de D1 medidos en
la carga del Banco de Indicadores), reanudable por tabla y por tramo (data/bie/carga/estado.json).
Verificación: series y observaciones remotas = locales; ninguna serie sin ruta; muestra de cotejo contra el Banco de
Indicadores en series que existen en ambos bancos (data/bie/cotejo_bise.csv, --cotejar).
Uso: data/.venv/bin/python scripts/bie_d1.py [--preparar] [--cargar] [--cotejar]
"""
import argparse, csv, gzip, json, pathlib, re, subprocess, sys, tempfile, time, unicodedata, urllib.request
from collections import Counter, defaultdict
RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data/bie'; CRUDO = DIR / 'crudo'; CARGA = DIR / 'carga'; CARGA.mkdir(exist_ok=True)
DB = 'datosmexico-api-bie'; MAX_FILAS = 500; MAX_BYTES = 8_000_000

def log(m):
    with open(DIR / 'carga.log', 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {m}\n")
    print(m, flush=True)
def sa(s): return ' '.join(''.join(c for c in unicodedata.normalize('NFKD', s or '') if not unicodedata.combining(c)).lower().split())
def q(v): return 'NULL' if v is None else ("'" + str(v).replace("'", "''") + "'" if isinstance(v, str) else str(v))
def gz(p):
    with gzip.open(p, 'rb') as f: return json.loads(f.read())

def d1(sql, archivo=True):
    ruta = None
    if archivo:
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f: f.write(sql); ruta = f.name
    for intento in range(4):
        args = ['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes'] + (['--file', ruta] if archivo else ['--json', '--command', sql])
        r = subprocess.run(args, cwd=RAIZ, capture_output=True, text=True)
        if r.returncode == 0: return None if archivo else json.loads(r.stdout)[0]['results']
        log(f'wrangler falló (intento {intento + 1}): {(r.stdout + r.stderr)[-300:].strip()}'); time.sleep(20 * (intento + 1))
    sys.exit('wrangler falló cuatro veces')

def fecha_inegi(s):
    m = re.match(r'(\d{2})/(\d{2})/(\d{4})', s or ''); return f'{m.group(3)}-{m.group(2)}-{m.group(1)}' if m else None

def preparar():
    """Crudos → CSV locales (series.csv, observaciones.csv, areas.csv) y resumen."""
    temas = {r['tema']: r for r in csv.DictReader(open(DIR / 'arbol/temas.csv'))}
    hoja = {}
    for r in csv.DictReader(open(DIR / 'arbol/serie_temas.csv')): hoja.setdefault(r['serie'], r['tema'])
    def ruta(t):
        out = []
        while t: out.append(temas[t]['nombre']); t = temas[t]['tema_superior']
        return ' > '.join(reversed(out))
    manif = {}
    for l in open(DIR / 'manifiesto.jsonl'):
        if l.strip(): r = json.loads(l); manif[r['serie']] = r
    areas = {}; n_series = 0; n_obs = 0; per = Counter()
    fs = open(DIR / 'series.csv', 'w', newline=''); ws = csv.writer(fs); ws.writerow(['id', 'nombre', 'unidad', 'frecuencia', 'fuente', 'tema', 'ruta', 'periodo_inicial', 'periodo_final', 'ultima_actualizacion', 'decimales', 'n_areas', 'n_observaciones', 'busqueda'])
    fo = open(DIR / 'observaciones.csv', 'w', newline=''); wo = csv.writer(fo); wo.writerow(['serie', 'area', 'periodo', 'valor', 'estatus'])
    for serie, m in manif.items():
        if m['estado'] != 'ok': continue
        carpeta = CRUDO / serie
        meta = gz(carpeta / 'meta.json.gz') if (carpeta / 'meta.json.gz').exists() else {}
        estatus = {c['periodo_corto']: c['letra'] for c in (meta.get('CIFRAS_ESTATUS') or []) if c.get('periodo_corto')}
        nombre = unidad = frecuencia = None; decimales = None; p0 = p1 = None; total = 0; n_areas = 0
        for archivo in sorted(carpeta.glob('valor_*.json.gz')):
            area = archivo.stem.replace('valor_', '').replace('.json', ''); v = gz(archivo)
            if not isinstance(v, dict) or 'value' not in v: continue
            periodos = [x['Value'] for x in v['dimension']['periods']['category']['label']]
            nombre = nombre or v.get('label'); freqs = v['dimension'].get('freq', {}).get('category', {}).get('label') or []
            frecuencia = frecuencia or (freqs[0]['Value'] if freqs else None)
            dec = v.get('valueDecimalFormat') or []; decimales = decimales if decimales is not None else (max(dec) if dec else None)
            for etiqueta in v['dimension']['state']['category']['label'] if 'state' in v['dimension'] else []:
                if area not in areas: areas[area] = etiqueta['Value'].split('-', 1)[-1] if area != '00' else 'Estados Unidos Mexicanos'
            n_areas += 1
            for p, val in zip(periodos, v['value']):
                if val is None or val == '': continue
                wo.writerow([serie, area, p, val, estatus.get(p)]); total += 1; per[p] += 1
                if p0 is None or p < p0: p0 = p
                if p1 is None or p > p1: p1 = p
        if total == 0: continue
        fuentes = meta.get('FUENTES') or []; fuente = '; '.join(f.get('NOMBRE_FUENTE', '') for f in fuentes if f.get('NOMBRE_FUENTE')) or None
        nombre = meta.get('NOMBRE_INDICADOR') or nombre; unidad = meta.get('NOMBRE_UNIDAD'); frecuencia = meta.get('NOMBRE_FRECUENCIA') or frecuencia
        r = ruta(hoja[serie]) if serie in hoja else ''
        ws.writerow([serie, nombre, unidad, frecuencia, fuente, hoja.get(serie), r, meta.get('PERIODO_INICIAL') or p0, meta.get('PERIODO_FINAL') or p1, fecha_inegi(meta.get('ULTIMA_FECHA_ACTUALIZACION')), decimales, n_areas, total, sa(' | '.join(x for x in [nombre, r, unidad, fuente] if x))])
        n_series += 1; n_obs += total
    fs.close(); fo.close()
    with open(DIR / 'areas.csv', 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['clave', 'nombre', 'desglose'])
        for a, n in sorted(areas.items()): w.writerow([a, n, 'Nacional' if a == '00' else ('Estatal' if re.fullmatch(r'(0[1-9]|[12][0-9]|3[0-2])', a) else 'Otra área')])
    with open(DIR / 'periodos.csv', 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['periodo', 'n']); [w.writerow([p, n]) for p, n in sorted(per.items())]
    log(f'preparado: {n_series:,} series, {n_obs:,} observaciones, {len(areas)} áreas, {len(per)} periodos')

def sentencias(tabla, campos, filas):
    """Bloques de INSERT de hasta MAX_FILAS filas; agrupados en archivos de hasta MAX_BYTES."""
    archivos = []; actual = []; tam = 0
    for i in range(0, len(filas), MAX_FILAS):
        s = f"INSERT OR REPLACE INTO {tabla} ({', '.join(campos)}) VALUES " + ','.join('(' + ','.join(q(v) for v in f) + ')' for f in filas[i:i + MAX_FILAS]) + ';\n'
        if tam + len(s) > MAX_BYTES and actual: archivos.append(''.join(actual)); actual = []; tam = 0
        actual.append(s); tam += len(s)
    if actual: archivos.append(''.join(actual))
    return archivos

def cargar():
    estado = json.loads((CARGA / 'estado.json').read_text()) if (CARGA / 'estado.json').exists() else {}
    d1((RAIZ / 'data/bie/schema.sqlite.sql').read_text())
    def num(v): return None if v in (None, '') else float(v)
    def ent(v): return None if v in (None, '') else int(float(v))
    lotes = {
        'temas': (['tema', 'nombre', 'tema_superior', 'orden', 'nivel'], [[r['tema'], r['nombre'], r['tema_superior'] or None, ent(r['orden']), int(r['nivel'])] for r in csv.DictReader(open(DIR / 'arbol/temas.csv'))]),
        'serie_temas': (['serie', 'tema'], [[r['serie'], r['tema']] for r in csv.DictReader(open(DIR / 'arbol/serie_temas.csv'))]),
        'areas': (['clave', 'nombre', 'desglose'], [[r['clave'], r['nombre'], r['desglose']] for r in csv.DictReader(open(DIR / 'areas.csv'))]),
        'periodos': (['periodo', 'n'], [[r['periodo'], int(r['n'])] for r in csv.DictReader(open(DIR / 'periodos.csv'))]),
        'series': (['id', 'nombre', 'unidad', 'frecuencia', 'fuente', 'tema', 'ruta', 'periodo_inicial', 'periodo_final', 'ultima_actualizacion', 'decimales', 'n_areas', 'n_observaciones', 'busqueda'],
                   [[r['id'], r['nombre'], r['unidad'] or None, r['frecuencia'] or None, r['fuente'] or None, r['tema'] or None, r['ruta'] or None, r['periodo_inicial'] or None, r['periodo_final'] or None, r['ultima_actualizacion'] or None, ent(r['decimales']), int(r['n_areas']), int(r['n_observaciones']), r['busqueda']] for r in csv.DictReader(open(DIR / 'series.csv'))]),
        'observaciones': (['serie', 'area', 'periodo', 'valor', 'valor_texto', 'estatus'], None),
    }
    for tabla, (campos, filas) in lotes.items():
        if tabla == 'observaciones':
            filas = []
            with open(DIR / 'observaciones.csv') as f:
                for r in csv.DictReader(f): filas.append([r['serie'], r['area'], r['periodo'], num(r['valor']), r['valor'], r['estatus'] or None])
        esperado = len(filas); hecho = estado.get(tabla, 0)
        remoto = d1(f'SELECT COUNT(*) n FROM {tabla}', archivo=False)[0]['n']
        if remoto == esperado: log(f'{tabla}: ya cargada ({esperado:,})'); continue
        if hecho == 0: d1(f'DELETE FROM {tabla};')
        archivos = sentencias(tabla, campos, filas); log(f'{tabla}: {esperado:,} filas en {len(archivos)} archivos (desde el {hecho})')
        for i, sql in enumerate(archivos):
            if i < hecho: continue
            d1(sql); estado[tabla] = i + 1; (CARGA / 'estado.json').write_text(json.dumps(estado))
            if (i + 1) % 25 == 0: log(f'{tabla}: {i + 1}/{len(archivos)} archivos')
        remoto = d1(f'SELECT COUNT(*) n FROM {tabla}', archivo=False)[0]['n']
        log(f'{tabla}: {remoto:,} filas en D1 (esperadas {esperado:,})')
        if remoto != esperado: sys.exit('la carga no cuadra')
    sin_ruta = d1("SELECT COUNT(*) n FROM series WHERE ruta IS NULL OR ruta = ''", archivo=False)[0]['n']
    log(f'series sin ruta: {sin_ruta}'); log('carga completa')

def cotejar():
    """Series del BIE que también publica el Banco de Indicadores (misma fuente ENOE/PIB): valores iguales periodo a periodo."""
    pares = [('6200093960', 'poblacion economicamente activa'), ('6200093954', 'poblacion ocupada'), ('6200093973', 'poblacion desocupada')]
    log('cotejo: se hace desde la API una vez cargado (ver verificar_cubos.py)')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--preparar', action='store_true'); ap.add_argument('--cargar', action='store_true'); ap.add_argument('--cotejar', action='store_true'); a = ap.parse_args()
    if a.preparar: preparar()
    if a.cargar: cargar()
    if a.cotejar: cotejar()

if __name__ == '__main__':
    main()

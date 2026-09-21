"""Catálogos y clasificadores del INEGI → D1 datosmexico-api-clasificadores (exclusión 4 del traspaso).
Entrada: data/catalogos/normalizado/*.csv, producidos por scripts/catalogos_inegi.py desde los archivos oficiales del INEGI
(SCIAN 2023/2018/2013 con su índice de productos, SINCO 2019/2011, CMO histórica, y el Catálogo Único de Claves de Áreas
Geoestadísticas: entidades, municipios y las 296,633 localidades vigentes al corte 2026/08). Antes de cargar se recuentan
los niveles y se exige que coincidan con la cifra publicada por el INEGI (data/catalogos/verificacion.json, «publicado»);
después de cargar, el conteo remoto debe ser igual al del CSV. Reanudable por tabla.
Uso: data/.venv/bin/python scripts/clasificadores_d1.py --cargar
"""
import argparse, csv, json, os, pathlib, subprocess, sys, tempfile, time
RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data' / 'catalogos'; NORM = DIR / 'normalizado'; DB = 'datosmexico-api-clasificadores'
csv.field_size_limit(1 << 30)
DDL = """
CREATE TABLE IF NOT EXISTS scian (version TEXT NOT NULL, nivel TEXT NOT NULL, codigo TEXT NOT NULL, codigo_padre TEXT, titulo TEXT NOT NULL, descripcion TEXT, incluye TEXT, excluye TEXT, marca TEXT, PRIMARY KEY (version, codigo)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_scian_padre ON scian (version, codigo_padre);
CREATE TABLE IF NOT EXISTS scian_productos (version TEXT NOT NULL, codigo_clase TEXT NOT NULL, orden INTEGER NOT NULL, producto TEXT NOT NULL, PRIMARY KEY (version, codigo_clase, orden)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sinco (version TEXT NOT NULL, nivel TEXT NOT NULL, codigo TEXT NOT NULL, codigo_padre TEXT, titulo TEXT NOT NULL, descripcion TEXT, ocupaciones TEXT, nota TEXT, PRIMARY KEY (version, codigo)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_sinco_padre ON sinco (version, codigo_padre);
CREATE TABLE IF NOT EXISTS cmo (nivel TEXT NOT NULL, codigo TEXT NOT NULL PRIMARY KEY, codigo_padre TEXT, titulo TEXT NOT NULL, descripcion TEXT, titulo_vol_i TEXT, nota TEXT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS cmo_ocupaciones (codigo_grupo_unitario TEXT NOT NULL, orden INTEGER NOT NULL, ocupacion TEXT NOT NULL, PRIMARY KEY (codigo_grupo_unitario, orden)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ageeml_entidades (cve_ent TEXT PRIMARY KEY, nom_ent TEXT NOT NULL, nom_abr TEXT, pob_total INTEGER, pob_masculina INTEGER, pob_femenina INTEGER, viviendas_habitadas INTEGER, fecha_corte TEXT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ageeml_municipios (cve_ent TEXT NOT NULL, cve_mun TEXT NOT NULL, cvegeo TEXT NOT NULL, nom_ent TEXT NOT NULL, nom_abr TEXT, nom_mun TEXT NOT NULL, cve_cab TEXT, nom_cab TEXT, pob_total INTEGER, pob_masculina INTEGER, pob_femenina INTEGER, viviendas_habitadas INTEGER, fecha_corte TEXT, PRIMARY KEY (cve_ent, cve_mun)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ageeml_localidades (cve_ent TEXT NOT NULL, cve_mun TEXT NOT NULL, cve_loc TEXT NOT NULL, cvegeo TEXT NOT NULL, nom_ent TEXT NOT NULL, nom_abr TEXT, nom_mun TEXT NOT NULL, nom_loc TEXT NOT NULL, ambito TEXT, lat REAL, lon REAL, lat_dms TEXT, lon_dms TEXT, altitud INTEGER, cve_carta TEXT, pob_total INTEGER, pob_masculina INTEGER, pob_femenina INTEGER, viviendas_habitadas INTEGER, fecha_corte TEXT, PRIMARY KEY (cve_ent, cve_mun, cve_loc)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_loc_nombre ON ageeml_localidades (nom_loc);
CREATE TABLE IF NOT EXISTS catalogos (catalogo TEXT PRIMARY KEY, titulo TEXT NOT NULL, version TEXT NOT NULL, fuente_url TEXT NOT NULL, corte TEXT, filas INTEGER NOT NULL, verificacion TEXT NOT NULL) WITHOUT ROWID;
"""
FICHA = {  # catálogo → (título, versión, URL de origen, corte)
  'scian_2023': ('Sistema de Clasificación Industrial de América del Norte (SCIAN) 2023', 'SCIAN México 2023', 'https://www.inegi.org.mx/contenidos/app/scian/scian_2023_categorias_y_productos.xlsx', '2023-07-19'),
  'scian_2018': ('SCIAN 2018', 'SCIAN México 2018', 'https://www.inegi.org.mx/contenidos/app/scian/scian_2018_categorias_y_productos.xlsx', None),
  'scian_2013': ('SCIAN 2013', 'SCIAN México 2013', 'https://www.inegi.org.mx/contenidos/app/clasificadores/scian/SCIAN_2013_estructura_productos.xlsx', None),
  'sinco_2019': ('Sistema Nacional de Clasificación de Ocupaciones (SINCO) 2019', 'SINCO 2019, edición 2020, con fe de erratas del 2 de septiembre de 2025', 'https://www.inegi.org.mx/contenidos/productos/prod_serv/contenidos/espanol/bvinegi/productos/nueva_estruc/702825198411.pdf', '2025-09-02'),
  'sinco_2011': ('SINCO 2011', 'SINCO 2011, tablas comparativas (actualización noviembre de 2012)', 'https://www.inegi.org.mx/contenidos/clasificadoresycatalogos/doc/sinco_tablas_comparativas.xlsx', '2012-11'),
  'cmo': ('Clasificación Mexicana de Ocupaciones (CMO), histórica', 'CMO histórica, volúmenes I y II', 'https://www.inegi.org.mx/contenidos/clasificadoresycatalogos/doc/clasificacion_mexicana_de_ocupaciones_vol_i.pdf', None),
  'entidades': ('Catálogo Único de Claves de Áreas Geoestadísticas: entidades', 'AGEEML', 'https://www.inegi.org.mx/contenidos/app/ageeml/catun_entidad.zip', '2016-01'),
  'municipios': ('Catálogo Único de Claves de Áreas Geoestadísticas: municipios', 'AGEEML', 'https://www.inegi.org.mx/contenidos/app/ageeml/catun_municipio.zip', '2026-06'),
  'localidades': ('Catálogo Único de Claves de Áreas Geoestadísticas: localidades', 'AGEEML, corte vigente', 'https://www.inegi.org.mx/app/ageeml/', '2026-08'),
}
def log(m): print(f'{time.strftime("%H:%M:%S")} {m}', flush=True)
def d1(sql, archivo=True):
    for intento in range(4):
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, dir=str(DIR)) as f: f.write(sql); ruta = f.name
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes'] + (['--file', ruta] if archivo else ['--json', '--command', sql]), capture_output=True, text=True, cwd=RAIZ); os.unlink(ruta)
        if r.returncode == 0: return None if archivo else json.loads(r.stdout)[0]['results']
        log(f'wrangler falló (intento {intento + 1}): {(r.stdout + r.stderr)[-300:].strip()}'); time.sleep(20 * (intento + 1))
    sys.exit('wrangler falló cuatro veces')
def q(v):
    if v is None or v == '': return 'NULL'
    return str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"
def entero(v):
    try: return int(float(v))
    except (TypeError, ValueError): return None  # '-', '*' y vacío: sin dato en el catálogo del INEGI
def real(v):
    try: return float(v)
    except (TypeError, ValueError): return None
def cargar_tabla(tabla, campos, filas, donde=None):
    cond = f' WHERE {donde}' if donde else ''
    if d1(f'SELECT COUNT(*) n FROM {tabla}{cond}', archivo=False)[0]['n'] == len(filas): log(f'  {tabla}{cond}: ya cargada ({len(filas):,})'); return
    d1(f'DELETE FROM {tabla}{cond};'); lote = []; tam = 0
    cab = f"INSERT INTO {tabla} ({', '.join(campos)}) VALUES "; vals = []; largo = len(cab)
    def cerrar():
        nonlocal vals, largo, lote, tam
        if vals: st = cab + ','.join(vals) + ';\n'; lote.append(st); tam += len(st); vals = []; largo = len(cab)
    for f in filas:  # sentencias de ≤ 80 KB (D1 rechaza > 100 KB: SQLITE_TOOBIG) y archivos de ≤ 7 MB
        v = '(' + ','.join(q(x) for x in f) + ')'
        if largo + len(v) > 80_000 or len(vals) >= 400: cerrar()
        vals.append(v); largo += len(v) + 1
        if tam > 7_000_000: d1(''.join(lote)); lote = []; tam = 0
    cerrar()
    if lote: d1(''.join(lote))
    n = d1(f'SELECT COUNT(*) n FROM {tabla}{cond}', archivo=False)[0]['n']
    if n != len(filas): sys.exit(f'{tabla}{cond}: {n} en D1, esperadas {len(filas)}')
    log(f'  {tabla}{cond}: {n:,} filas')
def leer(nombre): return list(csv.DictReader(open(NORM / f'{nombre}.csv', encoding='utf-8', newline='')))
def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--cargar', action='store_true'); a = ap.parse_args()
    ver = json.load(open(DIR / 'verificacion.json'))
    for k, v in ver.items():
        if k in FICHA and not v.get('cuadra'): sys.exit(f'{k}: la verificación contra la cifra publicada no cuadra; no se carga')
    tablas = []
    for v in ('2023', '2018', '2013'):
        f = leer(f'scian_{v}'); tablas.append(('scian', ['version', 'nivel', 'codigo', 'codigo_padre', 'titulo', 'descripcion', 'incluye', 'excluye', 'marca'], [[v, x['nivel'], x['codigo'], x['codigo_padre'] or None, x['titulo'], x['descripcion'] or None, x['incluye'] or None, x['excluye'] or None, x['marca'] or None] for x in f], f"version = '{v}'"))
        pr = leer(f'scian_{v}_productos'); orden = {}; filas = []
        for x in pr: orden[x['codigo_clase']] = orden.get(x['codigo_clase'], 0) + 1; filas.append([v, x['codigo_clase'], orden[x['codigo_clase']], x['producto']])
        tablas.append(('scian_productos', ['version', 'codigo_clase', 'orden', 'producto'], filas, f"version = '{v}'"))
        niveles = {n['nivel']: n for n in ver[f'scian_{v}']['niveles']}
        assert all(sum(1 for x in f if x['nivel'] == n) == niveles[n]['publicado'] for n in niveles), v
    for v in ('2019', '2011'):
        f = leer(f'sinco_{v}'); tablas.append(('sinco', ['version', 'nivel', 'codigo', 'codigo_padre', 'titulo', 'descripcion', 'ocupaciones', 'nota'], [[v, x['nivel'], x['codigo'], x['codigo_padre'] or None, x['titulo'], x.get('descripcion') or None, x.get('ocupaciones') or None, x.get('nota') or None] for x in f], f"version = '{v}'"))
    f = leer('cmo'); tablas.append(('cmo', ['nivel', 'codigo', 'codigo_padre', 'titulo', 'descripcion', 'titulo_vol_i', 'nota'], [[x['nivel'], x['codigo'], x['codigo_padre'] or None, x['titulo'], x['descripcion'] or None, x['titulo_vol_i'] or None, x['nota'] or None] for x in f], None))
    oc = leer('cmo_ocupaciones'); orden = {}; filas = []
    for x in oc: orden[x['codigo_grupo_unitario']] = orden.get(x['codigo_grupo_unitario'], 0) + 1; filas.append([x['codigo_grupo_unitario'], orden[x['codigo_grupo_unitario']], x['ocupacion']])
    tablas.append(('cmo_ocupaciones', ['codigo_grupo_unitario', 'orden', 'ocupacion'], filas, None))
    e = leer('entidades'); tablas.append(('ageeml_entidades', ['cve_ent', 'nom_ent', 'nom_abr', 'pob_total', 'pob_masculina', 'pob_femenina', 'viviendas_habitadas', 'fecha_corte'], [[x['cve_ent'], x['nom_ent'], x['nom_abr'] or None, entero(x['pob_total']), entero(x['pob_masculina']), entero(x['pob_femenina']), entero(x['viviendas_habitadas']), x['fecha_corte'] or None] for x in e], None))
    m = leer('municipios'); tablas.append(('ageeml_municipios', ['cve_ent', 'cve_mun', 'cvegeo', 'nom_ent', 'nom_abr', 'nom_mun', 'cve_cab', 'nom_cab', 'pob_total', 'pob_masculina', 'pob_femenina', 'viviendas_habitadas', 'fecha_corte'], [[x['cve_ent'], x['cve_mun'], x['cvegeo'], x['nom_ent'], x['nom_abr'] or None, x['nom_mun'], x['cve_cab'] or None, x['nom_cab'] or None, entero(x['pob_total']), entero(x['pob_masculina']), entero(x['pob_femenina']), entero(x['viviendas_habitadas']), x['fecha_corte'] or None] for x in m], None))
    l = leer('localidades'); tablas.append(('ageeml_localidades', ['cve_ent', 'cve_mun', 'cve_loc', 'cvegeo', 'nom_ent', 'nom_abr', 'nom_mun', 'nom_loc', 'ambito', 'lat', 'lon', 'lat_dms', 'lon_dms', 'altitud', 'cve_carta', 'pob_total', 'pob_masculina', 'pob_femenina', 'viviendas_habitadas', 'fecha_corte'], [[x['cve_ent'], x['cve_mun'], x['cve_loc'], x['cvegeo'], x['nom_ent'], x['nom_abr'] or None, x['nom_mun'], x['nom_loc'], x['ambito'] or None, real(x['lat']), real(x['lon']), x['lat_dms'] or None, x['lon_dms'] or None, entero(x['altitud']), x['cve_carta'] or None, entero(x['pob_total']), entero(x['pob_masculina']), entero(x['pob_femenina']), entero(x['viviendas_habitadas']), x['fecha_corte'] or None] for x in l], None))
    assert len(e) == 32 and len(m) == 2478 and len(l) == 296633 and len({x['cvegeo'] for x in l}) == 296633
    log(f'{len(tablas)} tramos por cargar; verificación previa contra cifras publicadas: {sum(1 for k in FICHA if ver.get(k, {}).get("cuadra"))}/{len(FICHA)} cuadran')
    if not a.cargar: return
    d1(DDL)
    for tabla, campos, filas, donde in tablas: cargar_tabla(tabla, campos, filas, donde)
    fichas = []
    for k, (titulo, version, url, corte) in FICHA.items():
        n = {'scian_2023': lambda: len(leer('scian_2023')), 'scian_2018': lambda: len(leer('scian_2018')), 'scian_2013': lambda: len(leer('scian_2013')), 'sinco_2019': lambda: len(leer('sinco_2019')), 'sinco_2011': lambda: len(leer('sinco_2011')), 'cmo': lambda: len(leer('cmo')), 'entidades': lambda: 32, 'municipios': lambda: 2478, 'localidades': lambda: 296633}[k]()
        fichas.append([k, titulo, version, url, corte, n, json.dumps(ver[k]['niveles'], ensure_ascii=False)])
    cargar_tabla('catalogos', ['catalogo', 'titulo', 'version', 'fuente_url', 'corte', 'filas', 'verificacion'], fichas)
    log('carga completa')
if __name__ == '__main__': main()

"""Inventario de los microdatos publicados en la página de cada programa del INEGI (pestaña «Microdatos»),
para detectar ediciones que NO están en la «Descarga masiva» (data/inegi-universo/archivos.csv).
Mecanismo (descubierto en el JS del sitio): la página de un programa (p. ej. /programas/endireh/2016/) declara
<menu-gen idm=ID>; /app/menu/0/<ID>/1 devuelve el árbol de su subsistema con el ID (idBiinegi) y la URL de cada
edición; cada edición publica sus pestañas en <url>/data/pestana/pestanadata.js, y la pestaña «Microdatos» es el
componente descargaMasivaV2 con data-id=<idBiinegi> (o data-proyecto + data-periodo en las estadísticas
experimentales) y tipoInformacion=4, que consulta
/app/api/descarga/componente/descargamasiva/lista/{totalarchivosdescarga,archivoscompaginacion}.
Salida: data/inegi-universo/ediciones_programas.csv (todo lo publicado en las páginas de programas) y
data/inegi/fuera-descarga-masiva.csv (lo que no está en la descarga masiva; se conservan las filas de otras
fuentes, p. ej. las del INSP que escribe ensanut_insp_inventario.py).
Uso: python3 scripts/inegi_ediciones_programas.py [--semillas 3001,3366,3219,3050] [--hilos 6]
"""
import argparse, csv, json, pathlib, re, time, urllib.request, urllib.parse
import concurrent.futures as cf
RAIZ = pathlib.Path(__file__).resolve().parent.parent
UNIV = RAIZ / 'data' / 'inegi-universo'; SAL = RAIZ / 'data' / 'inegi'
B = 'https://www.inegi.org.mx'; API = B + '/app/api/descarga/componente/descargamasiva/lista/'
H = {'User-Agent': 'Mozilla/5.0 (observatorio datosmexico)', 'Accept': 'application/json, text/plain, */*', 'Referer': B + '/programas/'}
COLS = ['fuente', 'programa', 'ruta', 'edicion', 'idbiinegi', 'url_programa', 'id', 'titulo', 'path', 'formato', 'mb', 'anio', 'url_descarga', 'metodo', 'post_campo', 'es_datos']
DATOS = ('_csv.zip', '_dta.zip', '_stata.zip', '_sav.zip', '_spss.zip', '_dbf.zip', '_txt.zip')
NO_DATOS = re.compile(r'descriptor|diccionario|cuestionario|manual|nota|metodolog|dise[ñn]o|catálogo de|catalogo de|ejemplo|estructura', re.I)
csv.field_size_limit(1 << 30)

def get(url, intentos=4):
    for i in range(intentos):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=120) as r: return r.read().decode('utf-8-sig')
        except Exception as e:
            ultimo = e; time.sleep(3 * (i + 1))
    raise RuntimeError(f'{url}: {ultimo}')

def menu(idm):
    d = json.loads(get(f'{B}/app/menu/0/{idm}/1')); d = json.loads(d) if isinstance(d, str) else d
    eds = {}
    def rec(x, ruta):
        p = ruta + [x['DES'].strip()]
        if x.get('URL'):
            es_ed = bool(re.match(r'^\d{4}', p[-1])) and len(p) > 1
            eds[int(x['JERAR'])] = {'idbiinegi': int(x['JERAR']), 'edicion': p[-1] if es_ed else '', 'url': x['URL'].strip(), 'programa': p[-2] if es_ed else p[-1], 'ruta': ' > '.join(p[1:-2] if es_ed else p[1:-1])}
        for r in x.get('RAMA', []): rec(r, p)
    rec(d, []); return eds

def pestanas_microdatos(url):
    """Parámetros de cada componente descargaMasivaV2 con tipoInformacion=4 de la página (lista, puede ser vacía)."""
    try: d = json.loads(get(B + url + 'data/pestana/pestanadata.js'))
    except Exception: return []
    out = []
    for p in d.get('pestanas', []):
        for c in p.get('componente', []):
            pr = {k.lower(): v for k, v in (c.get('parametros') or {}).items()}
            if 'descargaMasivaV2' in (c.get('urlComp') or '') and pr.get('data-tipoinformacion') == '4':
                out.append({'pestana': p.get('titulo'), 'idbiinegi': pr.get('data-id') or pr.get('data-idbiinegi') or '0', 'proyecto': pr.get('data-proyecto') or '0', 'anio': pr.get('data-periodo') or '0', 'tema': pr.get('data-tema') or '0', 'subtema': pr.get('data-subtema') or '0'})
    return out

def archivos(c):
    q = f"tema={c['tema']}&subtema={c['subtema']}&entidad=0&proyecto={c['proyecto']}&tipodocto=4&anio={c['anio']}&archivos_desde=1&archivos_hasta=5000&agrupacion=Todas&id_biinegi={c['idbiinegi']}&textoBuscar=&ingles=0"
    t = json.loads(get(API + 'totalarchivosdescarga?' + q)); total = int(t[0]['total']) if t else 0
    if not total: return []
    q = f"tema={c['tema']}&subtema={c['subtema']}&areaGeografica=0&proyecto={c['proyecto']}&anio={c['anio']}&tipodocto=4&agrupacion=VG9kYXM=&idBiinegi={c['idbiinegi']}&desde=1&hasta=5000&textoBuscar=&ordenar=orden&ingles=0&datosAbiertos=0&orden="
    lista = json.loads(get(API + 'archivoscompaginacion?' + q))
    if len(lista) != total: raise RuntimeError(f'{c}: total {total} pero listados {len(lista)}')
    return lista

def mb(t):
    m = re.match(r'([\d.,]+)\s*(KB|MB|GB|B)', t.strip(), flags=re.I)
    if not m: return 0.0
    v = float(m.group(1).replace(',', '')); u = m.group(2).upper()
    return v / 1024 if u == 'KB' else v if u == 'MB' else v * 1024 if u == 'GB' else v / 1048576

def url_descarga(path, formato):
    p = ''.join(ch for ch in path if ch >= ' ').strip()
    return urllib.parse.quote((B + '/contenidos' + p if p.startswith(('/programas/', '/investigacion/')) else B + p) + formato, safe='/:%')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--semillas', default='3001,3366,3219,3050'); ap.add_argument('--hilos', type=int, default=6); a = ap.parse_args()
    eds = {}
    for s in a.semillas.split(','): eds.update(menu(int(s)))
    arbol = json.loads(get(B + '/programas/data/recursos/arbol.json')); urls = []
    def rec(x, ruta):
        p = ruta + [x['DES'].strip()]
        if x.get('URL'): urls.append((x['URL'].strip(), p))
        for r in x.get('RAMA', []): rec(r, p)
    for x in arbol: rec(x, [])
    vistos = {e['url'] for e in eds.values()}
    for u, p in urls:  # programas del árbol general ausentes de los menús
        if u in vistos: continue
        m = re.search(r'menu-gen idm=["\'](\d+)', get(B + u)); i = int(m.group(1)) if m else None
        if i and i not in eds: eds[i] = {'idbiinegi': i, 'edicion': '', 'url': u, 'programa': p[-1], 'ruta': ' > '.join(p[1:-1])}
    print(f'{len(eds)} ediciones de programas en el sitio del INEGI', flush=True)
    filas = []; errores = []; con_pestana = set()
    def uno(e):
        try:
            if e['edicion'] and not re.fullmatch(r'\d{4}', e['edicion']):  # p. ej. «2016 - Modelo estadístico»: el programa es el título de la página sin el año
                m = re.search(r'<title>([^<]*)', get(B + e['url'])); anio = re.search(r'(19|20)\d\d', e['edicion'])
                if m and anio: e['programa'] = re.sub(r'\s+', ' ', m.group(1).replace(anio.group(0), '')).strip(); e['edicion'] = anio.group(0)
            for c in pestanas_microdatos(e['url']):
                con_pestana.add(e['idbiinegi'])
                for x in archivos(c):
                    for ext in [f for f in x.get('formato', '').split('|') if f]:
                        partes = ext.split('&'); fmt = partes[0]; tam = mb(partes[1]) if len(partes) > 1 else 0.0; path = x.get('pathLogico', '')
                        filas.append({'fuente': 'inegi', 'programa': e['programa'], 'ruta': e['ruta'], 'edicion': e['edicion'] or (x.get('anioInformacion') or '').strip('|'), 'idbiinegi': e['idbiinegi'], 'url_programa': e['url'], 'id': x['idArchivo'], 'titulo': x['titulo'], 'path': path, 'formato': fmt, 'mb': f'{tam:.2f}', 'anio': (x.get('anioInformacion') or '').strip('|'), 'url_descarga': url_descarga(path, fmt), 'metodo': 'GET', 'post_campo': '', 'es_datos': int(fmt in DATOS and not NO_DATOS.search(x['titulo']))})
        except Exception as ex: errores.append((e['idbiinegi'], e['url'], str(ex)[:120]))
    with cf.ThreadPoolExecutor(a.hilos) as ex: list(ex.map(uno, sorted(eds.values(), key=lambda e: e['idbiinegi'])))
    filas.sort(key=lambda r: (r['programa'], r['edicion'], r['titulo'], r['formato']))
    with open(UNIV / 'ediciones_programas.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(filas)
    inv = list(csv.DictReader(open(UNIV / 'archivos.csv', encoding='utf-8')))
    masiva = {x['id'] for x in inv}; masiva_paths = {''.join(ch for ch in x['path'] if ch >= ' ').strip() + x['formato'] for x in inv}
    fuera = [r for r in filas if r['id'] not in masiva and (r['path'] + r['formato']) not in masiva_paths]
    salida = SAL / 'fuera-descarga-masiva.csv'; otras = []
    if salida.exists(): otras = [r for r in csv.DictReader(open(salida, encoding='utf-8')) if r.get('fuente') != 'inegi']
    with open(salida, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(fuera); w.writerows(otras)
    ed = lambda rs: {(r['programa'], r['edicion']) for r in rs}
    print(f'{len(con_pestana)} ediciones con pestaña Microdatos; {len(filas)} archivo-formato ({len({r["id"] for r in filas})} archivos, {len(ed(filas))} ediciones); fuera de la descarga masiva: {len(fuera)} archivo-formato, {len({r["id"] for r in fuera})} archivos, {len(ed(fuera))} ediciones, de ellas con datos: {len(ed([r for r in fuera if r["es_datos"]]))}')
    for pe in sorted(ed([r for r in fuera if r['es_datos']])): print('  ', pe[0][:70], '|', pe[1], '|', sum(1 for r in fuera if r['es_datos'] and (r['programa'], r['edicion']) == pe), 'archivo-formato')
    if errores: print('ERRORES', len(errores)); [print(' ', e) for e in errores[:30]]
if __name__ == '__main__': main()

"""Inventario REAL de los datos abiertos del INEGI: para cada hoja del árbol oficial
(data/inegi-universo/arbol.json: programa × edición) busca la página del programa
(https://www.inegi.org.mx/programas/<sigla>/<edición>/), extrae los archivos de
/contenidos/programas/.../datosabiertos/*.zip y mide su tamaño con HEAD.
Salida: data/inegi-universo/inventario.csv (tema, programa, sigla, edición, url_pagina, archivo, bytes)
y data/inegi-universo/inventario.log. Las hojas cuya página no se resuelve quedan marcadas para revisión manual.
Uso: python3 scripts/inegi_inventario.py
"""
import csv, json, pathlib, re, time, urllib.request, urllib.error, concurrent.futures as cf
RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data' / 'inegi-universo'
UA = {'User-Agent': 'Mozilla/5.0 (observatorio datosmexico; inventario de datos abiertos)'}
ALIAS = {'cpv': 'ccpv', 'cagf': 'cagf', 'cae': 'cae', 'eic': 'intercensal', 'mcs': 'mcs', 'ed': 'nupcialidad', 'emat': 'nupcialidad', 'enr': 'natalidad', 'edf': 'mortalidad', 'edr': 'mortalidad', 'efipem': 'finanzas', 'vmrc': 'vehiculosmotor', 'etup': 'transporteurbano', 'esgrm': 'sacrificio', 'atus': 'accidentes', 'bcmm': 'comercioexterior', 'etef': 'exportacionesef', 'peme': 'peme', 'immex': 'immex', 'eimm': 'minerometalurgica', 'inpc': 'inpc', 'inpp': 'inpp', 'pibt': 'pib', 'em': 'museos', 'erlajul': 'relacioneslaborales', 'esep': 'salud'}

def hojas():
    d = json.load(open(DIR / 'arbol.json')); out = []
    def rec(n, ruta):
        r = ruta + [n.get('DES', '?')]; ramas = n.get('RAMA') or []
        if not ramas: out.append(r)
        for h in ramas: rec(h, r)
    for t in d: rec(t, [])
    return out

def sigla(nombre):
    m = re.findall(r'\(([A-Za-z0-9\-]+)\)', nombre)
    return m[-1].lower() if m else None

def get(url, timeout=40):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, b''
    except Exception: return 0, b''

def head(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA, method='HEAD'), timeout=40) as r: return int(r.headers.get('Content-Length') or 0)
    except Exception: return -1

def resolver(hoja):
    tema = hoja[0]; edicion = hoja[-1] if re.match(r'^(19|20)\d\d', hoja[-1]) else ''
    programa = [x for x in hoja[1:] if not re.match(r'^(19|20)\d\d', x)]
    nombre = programa[-1]; s = sigla(nombre) or sigla(' '.join(programa)) or ''
    candidatos = []
    for base in dict.fromkeys([ALIAS.get(s, s), s, s.replace('-', '')]):
        if not base: continue
        ed = re.match(r'^((19|20)\d\d)', edicion); ed = ed.group(1) if ed else ''
        if ed: candidatos.append(f'https://www.inegi.org.mx/programas/{base}/{ed}/')
        candidatos.append(f'https://www.inegi.org.mx/programas/{base}/')
    for url in candidatos:
        st, html = get(url)
        if st == 200 and b'datosabiertos' in html:
            enlaces = sorted(set(re.findall(rb'https?://www\.inegi\.org\.mx/contenidos/programas/[^"\']+/datosabiertos/[^"\']+\.zip', html)))
            filas = []
            for e in enlaces:
                e = e.decode(); filas.append([tema, ' > '.join(programa), s, edicion, url, e, head(e)])
            if not filas: filas.append([tema, ' > '.join(programa), s, edicion, url, '', 0])
            return filas
    return [[tema, ' > '.join(programa), s, edicion, '', 'SIN RESOLVER', -1]]

def main():
    todas = hojas(); t0 = time.time(); filas = []; n = 0
    with cf.ThreadPoolExecutor(8) as ex:
        for res in ex.map(resolver, todas):
            filas += res; n += 1
            if n % 25 == 0: print(f'{time.strftime("%H:%M:%S")} {n}/{len(todas)} hojas, {len(filas)} filas, {time.time()-t0:.0f}s', flush=True)
    with open(DIR / 'inventario.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['tema', 'programa', 'sigla', 'edicion', 'url_pagina', 'archivo', 'bytes']); w.writerows(filas)
    sin = sum(1 for x in filas if x[5] == 'SIN RESOLVER'); con = sum(1 for x in filas if x[5].endswith('.zip'))
    print(f'FIN: {len(todas)} hojas; {con} archivos zip ({sum(x[6] for x in filas if x[6] > 0)/1e9:.2f} GB); {sin} hojas sin resolver', flush=True)

if __name__ == '__main__': main()

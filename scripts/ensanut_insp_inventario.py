"""Inventario de las bases de datos de la ENSANUT publicadas por el INSP en ensanut.insp.mx (ediciones que el
INEGI no distribuye en su descarga masiva: ENSA 2000, ENSANUT 2006, 2012, MC 2016, 100k 2018, Continua 2020-2025 y
ediciones estatales). Mecanismo: la página /encuestas/<edicion>/descargas.php lista cada archivo como un botón
<button name='ArchId<base64 de la ruta>' title='Descargar archivo: <nombre>'>; el archivo se obtiene con un POST a la
misma página con el campo ArchId<base64>= (vacío, como el botón; con otro sufijo el INSP devuelve la página HTML) (sin registro: «Usted puede acceder libremente a toda la información
de las encuestas alojadas en este sitio web», preguntas frecuentes del INSP). El tamaño se toma de Content-Length.
Salida: data/inegi-universo/ensanut_insp.csv (todo) y se anexan/reemplazan las filas fuente=insp en
data/inegi/fuera-descarga-masiva.csv (formato compartido con inegi_ediciones_programas.py).
Uso: python3 scripts/ensanut_insp_inventario.py [--sin-tamanos] [--hilos 4]
"""
import argparse, base64, csv, html, json, pathlib, re, time, unicodedata, urllib.parse, urllib.request
import concurrent.futures as cf
RAIZ = pathlib.Path(__file__).resolve().parent.parent
UNIV = RAIZ / 'data' / 'inegi-universo'; SAL = RAIZ / 'data' / 'inegi'
B = 'https://ensanut.insp.mx'; H = {'User-Agent': 'Mozilla/5.0 (observatorio datosmexico)'}
PROGRAMA = 'Encuesta Nacional de Salud y Nutrición (ENSANUT)'
# edición del sitio del INSP → etiqueta de edición en el catálogo (2018 del INEGI ya está; la del INSP trae más tablas)
EDICIONES = {'ensa2000': '2000', 'ensanut2006': '2006', 'ensanut2012': '2012', 'ensanut2016': '2016_MC', 'ensanut2018': '2018_INSP', 'ensanut100k2018': '2018_100k',
             'ensanutcontinua2020': '2020', 'ensanutcontinua2021': '2021', 'ensanutcontinua2022': '2022', 'ensanutcontinua2023': '2023', 'ensanutcontinua2024': '2024', 'ensanutcontinua2025': '2025',
             'ensanutgto2020': '2020_Guanajuato', 'ensanutgto2021': '2021_Guanajuato', 'ensanutgto2022': '2022_Guanajuato', 'ensanutnl2022': '2022_Nuevo_Leon', 'ensanutsin2023': '2023_Sinaloa', 'pison2023': '2023_Sonora_primera_infancia'}
FORMATOS = {'.csv.csv.zip': '_csv.zip', '.stata.stata.zip': '_dta.zip', '.spss.spss.zip': '_sav.zip'}
COLS = ['fuente', 'programa', 'ruta', 'edicion', 'idbiinegi', 'url_programa', 'id', 'titulo', 'path', 'formato', 'mb', 'anio', 'url_descarga', 'metodo', 'post_campo', 'es_datos']

def get(url, datos=None, solo_cabeceras=False):
    for i in range(4):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, data=datos, headers=H), timeout=180)
            if solo_cabeceras:
                h = dict(r.headers); r.close()
                if 'Content-Length' not in h: raise RuntimeError('sin Content-Length')  # bajo carga el INSP responde sin tamaño: reintentar
                return h
            return r.read().decode('utf-8', 'replace')
        except Exception as e:
            ultimo = e; time.sleep(3 * (i + 1))
    raise RuntimeError(f'{url}: {ultimo}')

def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')[:60]

def ediciones():
    idx = get(B + '/')
    return sorted({m.group(1) for m in re.finditer(r"href='\./encuestas/([^/']+)/descargas\.php'", idx)})

def archivos(ed):
    cuerpo = get(f'{B}/encuestas/{ed}/descargas.php'); out = []
    tit = re.search(r'Bases de datos y cuestionarios para:\s*(.*?)\s*</h2>', cuerpo, re.S)
    for m in re.finditer(r"name='ArchId([A-Za-z0-9+/=]+)'\s*title='Descargar archivo: ([^']*)'", cuerpo):
        ruta = base64.b64decode(m.group(1)).decode('utf-8', 'replace'); nombre = html.unescape(m.group(2))
        out.append({'b64': m.group(1), 'ruta': ruta, 'nombre': nombre})
    return html.unescape(tit.group(1)) if tit else ed, out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--sin-tamanos', action='store_true'); ap.add_argument('--hilos', type=int, default=2); a = ap.parse_args()
    previo = {}
    if (UNIV / 'ensanut_insp.csv').exists(): previo = {(r['edicion'], r['formato'], r['path']): r['mb'] for r in csv.DictReader(open(UNIV / 'ensanut_insp.csv', encoding='utf-8')) if r['mb'] not in ('', '0.00')}
    eds = ediciones(); desconocidas = [e for e in eds if e not in EDICIONES]
    if desconocidas: print('AVISO ediciones nuevas en el INSP sin etiqueta (se omiten hasta etiquetarlas en EDICIONES):', desconocidas)
    filas = []
    for ed in eds:
        if ed not in EDICIONES: continue
        titulo_ed, arch = archivos(ed); et = EDICIONES[ed]
        for x in arch:
            n = x['nombre']; fmt = next((v for k, v in FORMATOS.items() if n.lower().endswith(k)), None)
            if fmt: base = n[:-len(next(k for k in FORMATOS if n.lower().endswith(k)))]
            else: base, fmt = n.rsplit('.', 1)[0], '.' + n.rsplit('.', 1)[1].lower()
            carpeta = x['ruta'].rsplit('/', 1)[0] if '/' in x['ruta'] else ''
            path = f'/insp/{ed}/{base}'
            filas.append({'fuente': 'insp', 'programa': PROGRAMA, 'ruta': 'INSP > ' + titulo_ed, 'edicion': et, 'idbiinegi': '', 'url_programa': f'{B}/encuestas/{ed}/descargas.php', 'id': f'insp-{ed}-{slug(base)}', 'titulo': '|'.join(re.sub(r'^\d+-', '', c).strip() for c in carpeta.split('/') if c) + '|' + base, 'path': path, 'formato': fmt, 'mb': previo.get((et, fmt, path), ''), 'anio': re.search(r'(20\d\d)', et).group(1), 'url_descarga': f'{B}/encuestas/{ed}/descargas.php', 'metodo': 'POST', 'post_campo': 'ArchId' + x['b64'], 'es_datos': int(fmt in ('_csv.zip', '_dta.zip', '_sav.zip'))})
    if not a.sin_tamanos:
        pend = [r for r in filas if r['formato'].endswith('.zip') and not r['mb']]
        def tam(r):
            try:
                h = get(r['url_descarga'], urllib.parse.urlencode({r['post_campo']: ''}).encode(), solo_cabeceras=True)
                r['mb'] = f"{int(h.get('Content-Length', 0)) / 1048576:.2f}"
            except Exception as e: r['mb'] = ''
        with cf.ThreadPoolExecutor(a.hilos) as ex: list(ex.map(tam, pend))
    filas.sort(key=lambda r: (r['edicion'], r['titulo'], r['formato']))
    with open(UNIV / 'ensanut_insp.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(filas)
    salida = SAL / 'fuera-descarga-masiva.csv'; otras = []
    if salida.exists(): otras = [r for r in csv.DictReader(open(salida, encoding='utf-8')) if r.get('fuente') != 'insp']
    with open(salida, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(otras); w.writerows(filas)
    datos = [r for r in filas if r['es_datos']]
    print(f'{len(eds)} ediciones en el INSP; {len(filas)} archivos listados, {len(datos)} de datos ({len({r["id"] for r in datos})} bases lógicas); {sum(float(r["mb"] or 0) for r in datos)/1024:.2f} GB en los tres formatos')
    for et in sorted({r['edicion'] for r in filas}):
        d = [r for r in datos if r['edicion'] == et]; print(f'  {et:32s} {len({r["id"] for r in d}):4d} bases  {sum(float(r["mb"] or 0) for r in d if r["formato"] == "_dta.zip"):8.1f} MB (stata)')
if __name__ == '__main__': main()

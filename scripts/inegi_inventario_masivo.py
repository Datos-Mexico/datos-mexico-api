"""Inventario exacto de la «Descarga masiva» del INEGI (microdatos y tabulados de todos los programas),
usando la misma API interna que usa https://www.inegi.org.mx/app/descarga/.
Para cada clasificación (4 = microdatos, 5 = tabulados) lista los programas (obtenerlistado) y sus
archivos (obtenerarchivos: título, ruta lógica, formatos con tamaño y año).
Salida: data/inegi-universo/archivos.csv y resumen en pantalla.
"""
import base64, csv, json, pathlib, re, time, urllib.request
RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data' / 'inegi-universo'
A = "https://www.inegi.org.mx/app/api/descarga/descarga/descargamasiva/lista/"
H = {'Content-Type': 'application/json; charset=UTF-8', 'Accept': 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://www.inegi.org.mx/app/descarga/', 'Origin': 'https://www.inegi.org.mx', 'User-Agent': 'Mozilla/5.0'}
def post(ep, **kw):
    b = {"tinfo": "4", "ag": "0", "prog": "0", "cc": "0", "subtema": "0", "anio": "0", "formato": "0", "datosAbiertos": "3", "textoBuscar": "", "ingles": "0", "tipoInfo": "PROGRAMAS"}; b.update({k: str(v) for k, v in kw.items()})
    for intento in range(3):
        try:
            r = urllib.request.Request(A + ep, data=json.dumps(b, ensure_ascii=False).encode('utf-8'), headers=H)
            return json.loads(urllib.request.urlopen(r, timeout=120).read())
        except Exception as e:
            time.sleep(3)
    return []
b64 = lambda s: base64.b64encode(s.encode('utf-8')).decode()
def mb(t):
    m = re.match(r'([\d.,]+)\s*(KB|MB|GB|B)', t.strip(), flags=re.I)
    if not m: return 0.0
    v = float(m.group(1).replace(',', '')); u = m.group(2).upper()
    return v / 1024 if u == 'KB' else v if u == 'MB' else v * 1024 if u == 'GB' else v / 1048576
filas = []; vistos = set()
def recorrer(tinfo, clas, titulo, prof=0):
    """Carpetas (obtenercarpetas devuelve la propia ruta más las subcarpetas) y archivos de un nivel."""
    if (tinfo, titulo) in vistos or prof > 8: return 0
    vistos.add((tinfo, titulo)); n = 0
    for a in post('obtenerarchivos', tinfo=tinfo, titulo=b64(titulo + '|')):
        for ext in [x for x in a.get('extensiones', '').split('|') if x]:
            partes = ext.split('&'); fmt = partes[0]; tam = mb(partes[1]) if len(partes) > 1 else 0.0; est = partes[2] if len(partes) > 2 else ''
            filas.append([clas, titulo.split('|')[1], a['titulo'].split('|', 2)[-1], a.get('pathLogico', ''), fmt, f'{tam:.2f}', est, (a.get('anioInfo') or '').strip('|'), a.get('idTitulo', '')]); n += 1
    for c in post('obtenercarpetas', tinfo=tinfo, titulo=b64(titulo + '|')):
        sub = c.get('nombre', '').rstrip('|')
        if sub and sub != titulo and sub.startswith(titulo): n += recorrer(tinfo, clas, sub, prof + 1)
    return n
for tinfo, clas in ((4, 'microdatos'), (5, 'tabulados')):
    for p in post('obtenerlistado', tinfo=tinfo):
        nombre = p['nombre']; n = recorrer(tinfo, clas, nombre)
        print(f"{clas} {nombre.split('|',1)[1][:60]}: {n} archivos", flush=True)
with open(DIR / 'archivos.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(['clasificacion', 'programa', 'titulo', 'path', 'formato', 'mb', 'estandar', 'anio', 'id']); w.writerows(filas)
print('FIN filas', len(filas))

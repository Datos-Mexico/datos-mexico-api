"""F8 fase 2: descarga las observaciones MUNICIPALES de los indicadores del Banco de Indicadores
que tienen datos a ese nivel (según data/bise/sondeo_municipal.jsonl).

Universo geográfico: los 2,478 municipios del Marco Geoestadístico 2025 (data/bise/municipios.csv,
derivado de las capas municipales que usan los mapas del sitio). Cada petición lleva un indicador
y hasta 22 municipios (límite de longitud de URL medido: ids + geografías <= 146 caracteres).
Un 400 "No se encontraron resultados" significa que ese indicador no tiene datos en esos 22
municipios (se registra como lote sin datos); las respuestas parciales devuelven solo los
municipios con datos.

Salida: data/bise/crudo_municipal/<id>/<lote>.json.gz (respuesta cruda) y
data/bise/manifiesto_municipal.jsonl {"id","lote","estado":"ok"|"sin_datos","archivo","obs","cuando"}.
Reanudable por (id, lote). Bitácora: data/bise/descarga_municipal.log. El token no se imprime.
"""
import csv, gzip, json, pathlib, sys, time, threading, urllib.request, urllib.error
import concurrent.futures as cf
from datetime import datetime, timezone

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DIR = RAIZ / 'data' / 'bise'
CRUDO = DIR / 'crudo_municipal'
MANIFIESTO = DIR / 'manifiesto_municipal.jsonl'
LOG = DIR / 'descarga_municipal.log'
MAX_SEG = 146
PARALELO = 6

def token():
    for l in (RAIZ / 'data' / '.secretos.env').read_text().splitlines():
        if l.startswith('INEGI_TOKEN='): return l.split('=', 1)[1].strip()
    sys.exit('falta INEGI_TOKEN')
TOKEN = token()
candado = threading.Lock()

def log(m):
    with candado:
        with open(LOG, 'a') as f: f.write(f"{datetime.now(timezone.utc).strftime('%H:%M:%S')} {m}\n")

def lotes_geo(municipios, id_):
    actual = []
    for m in municipios:
        prueba = actual + [m]
        if len(id_) + len(','.join(prueba)) > MAX_SEG and actual:
            yield actual; actual = [m]
        else: actual = prueba
    if actual: yield actual

class SinDatos(Exception): pass

def pedir(id_, geos):
    url = f"https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml/INDICATOR/{id_}/es/{','.join(geos)}/false/BISE/2.0/{TOKEN}?type=json"
    ultimo = None
    for intento in range(4):
        try:
            b = urllib.request.urlopen(url, timeout=120).read()
            try: d = json.loads(b)
            except ValueError:
                ultimo = 'respuesta no JSON'; time.sleep(2 * (intento + 1)); continue
            if 'Series' not in d:
                ultimo = f'sin Series: {str(d)[:60]}'; time.sleep(2 * (intento + 1)); continue
            return b, d
        except urllib.error.HTTPError as e:
            cuerpo = e.read()[:100].decode('utf-8', 'replace')
            if e.code in (400, 401): raise SinDatos(f'{e.code} {cuerpo}')
            ultimo = f'HTTP {e.code}'; time.sleep(5 * (intento + 1))
        except Exception as e:
            ultimo = f'{type(e).__name__}'; time.sleep(5 * (intento + 1))
    raise RuntimeError(ultimo)

def anotar(l):
    with candado:
        with open(MANIFIESTO, 'a') as f: f.write(json.dumps(l, ensure_ascii=False) + '\n')

def tarea(t):
    id_, k, geos = t
    cuando = datetime.now(timezone.utc).isoformat(timespec='seconds')
    try:
        b, d = pedir(id_, geos)
        obs = sum(len(s['OBSERVATIONS']) for s in d['Series'])
        (CRUDO / id_).mkdir(parents=True, exist_ok=True)
        with gzip.open(CRUDO / id_ / f'{k:03d}.json.gz', 'wb') as f: f.write(b)
        anotar({'id': id_, 'lote': k, 'estado': 'ok', 'archivo': f'{id_}/{k:03d}.json.gz', 'obs': obs, 'cuando': cuando})
        return obs, 0, 0
    except SinDatos:
        anotar({'id': id_, 'lote': k, 'estado': 'sin_datos', 'archivo': None, 'obs': 0, 'cuando': cuando}); return 0, 1, 0
    except RuntimeError as e:
        log(f'ERROR {id_} lote {k}: {e}'); return 0, 0, 1

def main():
    CRUDO.mkdir(exist_ok=True)
    ids = [json.loads(l)['id'] for l in open(DIR / 'sondeo_municipal.jsonl') if json.loads(l)['municipal']]
    municipios = [r['clave'] for r in csv.DictReader(open(DIR / 'municipios.csv'))]
    hechos = set()
    if MANIFIESTO.exists():
        for l in open(MANIFIESTO):
            if l.strip(): m = json.loads(l); hechos.add((m['id'], m['lote']))
    tareas = [(i, k, g) for i in ids for k, g in enumerate(lotes_geo(municipios, i)) if (i, k) not in hechos]
    log(f'inicio: {len(ids)} indicadores, {len(municipios)} municipios, {len(hechos)} lotes hechos, {len(tareas)} pendientes')
    t0 = time.time(); obs = sin = err = 0; n = 0
    with cf.ThreadPoolExecutor(PARALELO) as ex:
        for a, b, c in ex.map(tarea, tareas):
            obs += a; sin += b; err += c; n += 1
            if n % 2000 == 0: log(f'avance: {n} lotes, {obs} obs, {sin} sin datos, {err} errores, {time.time()-t0:.0f}s')
    log(f'fin: {n} lotes, {obs} obs, {sin} sin datos, {err} errores en {time.time()-t0:.0f}s')

if __name__ == '__main__':
    main()

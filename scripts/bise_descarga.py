"""Descarga TODO el Banco de Indicadores del INEGI (BISE) a data/bise/crudo/.

Universo: los indicadores del catálogo CL_INDICATOR (data/bise/catalogos/CL_INDICATOR.json)
por 33 coberturas geográficas: nacional (00) y las 32 entidades (01-32).

Límites medidos el 2026-09-19 contra la API:
- La URL completa no puede pasar de ~294 caracteres (más largo responde una página HTML
  "Página no encontrada" con estado 200). Por eso cada lote junta indicadores mientras
  los segmentos de ids y geografías sumen <= 146 caracteres (4 ids de 10 dígitos con las
  33 geografías).
- Si en un lote algún indicador no tiene ninguna observación en las geografías pedidas,
  el servicio responde 400 "No se encontraron resultados" (ninguno tiene) o 401
  "No autorizado" (solo algunos tienen). En ese caso el lote se reintenta indicador
  por indicador y los que no tienen datos quedan registrados como `sin_datos`.
- 6 peticiones en paralelo responden igual de rápido que una (~0.8 s).

Salida:
- data/bise/crudo/<primer_id>.json.gz : respuesta cruda del INEGI (tal cual) por lote.
- data/bise/manifiesto.jsonl : una línea por indicador resuelto
  {"id", "estado": "ok"|"sin_datos", "archivo", "series", "obs", "cuando"}.
Reanudable: los indicadores ya presentes en el manifiesto no se vuelven a pedir.
El token nunca se imprime (los errores no incluyen la URL).
"""
import gzip, json, os, pathlib, sys, time, threading, urllib.request, urllib.error
import concurrent.futures as cf
from datetime import datetime, timezone

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DIR = RAIZ / 'data' / 'bise'
CRUDO = DIR / 'crudo'
MANIFIESTO = DIR / 'manifiesto.jsonl'
LOG = DIR / 'descarga.log'
GEO = ','.join(f'{i:02d}' for i in range(33))
MAX_SEG = 146
PARALELO = 6

def token():
    for linea in (RAIZ / 'data' / '.secretos.env').read_text().splitlines():
        if linea.startswith('INEGI_TOKEN='):
            return linea.split('=', 1)[1].strip()
    sys.exit('falta INEGI_TOKEN en data/.secretos.env')

TOKEN = token()
candado = threading.Lock()

def log(msg):
    linea = f"{datetime.now(timezone.utc).strftime('%H:%M:%S')} {msg}"
    with candado:
        with open(LOG, 'a') as f: f.write(linea + '\n')

def url(ids, geo):
    return (f"https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml/INDICATOR/"
            f"{','.join(ids)}/es/{geo}/false/BISE/2.0/{TOKEN}?type=json")

class SinDatos(Exception): pass

def pedir(ids, geo):
    """Devuelve los bytes crudos (JSON válido) o lanza SinDatos (400/401) / RuntimeError."""
    ultimo = None
    for intento in range(4):
        try:
            b = urllib.request.urlopen(url(ids, geo), timeout=120).read()
            try:
                d = json.loads(b)
            except ValueError:
                ultimo = 'respuesta no JSON (¿URL demasiado larga?)'
                time.sleep(2 * (intento + 1)); continue
            if 'Series' not in d:
                ultimo = f'sin campo Series: {str(d)[:80]}'
                time.sleep(2 * (intento + 1)); continue
            return b, d
        except urllib.error.HTTPError as e:
            cuerpo = e.read()[:120].decode('utf-8', 'replace')
            if e.code in (400, 401):
                raise SinDatos(f'{e.code} {cuerpo}')
            ultimo = f'HTTP {e.code} {cuerpo}'
            time.sleep(5 * (intento + 1))
        except Exception as e:
            ultimo = f'{type(e).__name__}: {str(e)[:80]}'
            time.sleep(5 * (intento + 1))
    raise RuntimeError(ultimo)

def guardar(nombre, b):
    with gzip.open(CRUDO / f'{nombre}.json.gz', 'wb') as f: f.write(b)

def anotar(lineas):
    with candado:
        with open(MANIFIESTO, 'a') as f:
            for l in lineas: f.write(json.dumps(l, ensure_ascii=False) + '\n')

def resumen_series(d):
    return {s['INDICADOR']: len(s['OBSERVATIONS']) for s in d['Series']}

def procesar(lote):
    cuando = datetime.now(timezone.utc).isoformat(timespec='seconds')
    try:
        b, d = pedir(lote, GEO)
        obs = resumen_series(d)
        faltan = [i for i in lote if i not in obs]
        if faltan:
            raise SinDatos(f'respuesta parcial: faltan {faltan}')
        nombre = lote[0]
        guardar(nombre, b)
        anotar([{'id': i, 'estado': 'ok', 'archivo': f'{nombre}.json.gz', 'series': 1, 'obs': obs[i], 'cuando': cuando} for i in lote])
        return len(lote), 0, 0
    except SinDatos:
        ok = sin = err = 0
        for i in lote:
            try:
                b, d = pedir([i], GEO)
                obs = resumen_series(d)
                guardar(i, b)
                anotar([{'id': i, 'estado': 'ok', 'archivo': f'{i}.json.gz', 'series': 1, 'obs': obs.get(i, 0), 'cuando': cuando}])
                ok += 1
            except SinDatos as e:
                anotar([{'id': i, 'estado': 'sin_datos', 'archivo': None, 'series': 0, 'obs': 0, 'detalle': str(e)[:60], 'cuando': cuando}])
                sin += 1
            except RuntimeError as e:
                log(f'ERROR {i}: {e}'); err += 1
        return ok, sin, err
    except RuntimeError as e:
        log(f'ERROR lote {lote[0]}..{lote[-1]}: {e}')
        return 0, 0, len(lote)

def lotes(ids):
    actual = []
    for i in ids:
        prueba = actual + [i]
        if len(','.join(prueba)) + len(GEO) > MAX_SEG and actual:
            yield actual; actual = [i]
        else:
            actual = prueba
    if actual: yield actual

def main():
    CRUDO.mkdir(parents=True, exist_ok=True)
    catalogo = json.load(open(DIR / 'catalogos' / 'CL_INDICATOR.json'))['CODE']
    todos = [x['value'] for x in catalogo]
    hechos = set()
    if MANIFIESTO.exists():
        for l in open(MANIFIESTO):
            if l.strip(): hechos.add(json.loads(l)['id'])
    pendientes = [i for i in todos if i not in hechos]
    log(f'inicio: {len(todos)} indicadores, {len(hechos)} ya resueltos, {len(pendientes)} pendientes')
    t0 = time.time(); ok = sin = err = 0; n = 0
    with cf.ThreadPoolExecutor(PARALELO) as ex:
        for a, b, c in ex.map(procesar, lotes(pendientes)):
            ok += a; sin += b; err += c; n += 1
            if n % 200 == 0:
                log(f'avance: {ok} ok, {sin} sin datos, {err} errores, {time.time()-t0:.0f}s')
    log(f'fin: {ok} ok, {sin} sin datos, {err} errores en {time.time()-t0:.0f}s')

if __name__ == '__main__':
    main()

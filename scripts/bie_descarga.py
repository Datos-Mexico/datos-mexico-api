"""Descarga TODAS las series del Banco de Información Económica (BIE) del INEGI a data/bie/crudo/, con la API interna
del sitio del INEGI (ver scripts/bie_arbol.py para el porqué: la API de desarrolladores no responde para el BIE).

Universo: las series de data/bie/arbol/serie_temas.csv (89,032 el 2026-09-21). Por cada serie:
- CatalogoAreaGeograficaV3/null/{serie}/null/null/3/1 : áreas geográficas disponibles (nacional «0»; entidades «01»…;
  hay series por zona metropolitana, ciudad o país). Se recorren los nodos dependientes.
- ValorIndicador/{serie}/{area}/null/es/null/null/3/null/0/null/null/null/1/3 : toda la serie para esa área
  (etiqueta, frecuencia, periodos y valores; formato JSON-stat del INEGI). Se guarda tal cual.
- MetadatoIndicador/es/{serie}/{area}/null/null/null/3 : unidad, frecuencia, fuentes, notas, estatus de cifras y
  última actualización; se guarda una vez por serie (área nacional o la primera).
Tokens: los dos de cliente público del sitio (INEGI_TOKEN_WEB para catálogos, INEGI_TOKEN_WEB2 para valores).
Salida: data/bie/crudo/<serie>/areas.json.gz, meta.json.gz, valor_<area>.json.gz; data/bie/manifiesto.jsonl (una
línea por serie: áreas, observaciones por área, cuándo); data/bie/descarga.log. Reanudable por serie. Paralelismo 24 (con 6 hilos salían 150 series/min: 10 horas; el sitio del INEGI respondió 12 llamadas paralelas en
0.6 s sin rechazo, así que se sube a 24 y se vigilan los errores).
Uso: data/.venv/bin/python scripts/bie_descarga.py [--limite N]
"""
import argparse, csv, gzip, json, pathlib, sys, time, threading, urllib.request
import concurrent.futures as cf
from datetime import datetime, timezone

RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data' / 'bie'; CRUDO = DIR / 'crudo'; MANIF = DIR / 'manifiesto.jsonl'; LOG = DIR / 'descarga.log'
BASE = 'https://www.inegi.org.mx/app/api/indicadores/interna_v1_3/API.svc'; PARALELO = 24
UA = 'Mozilla/5.0 (observatorio datosmexico.org; contacto en datosmexico.org)'

def secreto(clave):
    for l in (RAIZ / 'data' / '.secretos.env').read_text().splitlines():
        if l.startswith(clave + '='): return l.split('=', 1)[1].strip()
    sys.exit(f'falta {clave}')
T1, T2 = secreto('INEGI_TOKEN_WEB'), secreto('INEGI_TOKEN_WEB2'); candado = threading.Lock()

def log(m):
    linea = f"{datetime.now(timezone.utc).strftime('%H:%M:%S')} {m}"
    with candado:
        with open(LOG, 'a') as f: f.write(linea + '\n')

def pedir(ruta, token):
    url = f'{BASE}/{ruta}/json/{token}'; ultimo = None
    for intento in range(5):
        try:
            b = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=120).read()
            if b.startswith(b'\xef\xbb\xbf'): b = b[3:]
            return b, json.loads(b)
        except json.JSONDecodeError: ultimo = 'no JSON'; time.sleep(3 * (intento + 1))
        except Exception as e: ultimo = f'{type(e).__name__}: {str(e)[:60]}'; time.sleep(5 * (intento + 1))
    raise RuntimeError(ultimo)

def areas_de(d):
    out = []
    def rec(n):
        a = n.get('AREA_GEOGRAFICA');
        if a not in (None, ''): out.append((a, n.get('NOMBRE'), n.get('NOMBRE_DESGLOSE_GEOGRAFICO')))
        for h in n.get('AREAS_GEOGRAFICAS_DEPENDIENTES') or []: rec(h)
    for n in d if isinstance(d, list) else []: rec(n)
    vistos = set(); res = []
    for a in out:
        if a[0] not in vistos: vistos.add(a[0]); res.append(a)
    return res

def guardar(ruta, b):
    with gzip.open(ruta, 'wb') as f: f.write(b)

def procesar(serie):
    carpeta = CRUDO / serie; carpeta.mkdir(parents=True, exist_ok=True); cuando = datetime.now(timezone.utc).isoformat(timespec='seconds')
    try:
        b, d = pedir(f'CatalogoAreaGeograficaV3/null/{serie}/null/null/3/1', T1); guardar(carpeta / 'areas.json.gz', b)
        areas = areas_de(d) or [('0', 'Estados Unidos Mexicanos', 'Nacional')]
        obs = {}; primera = None
        for a, _, _ in areas:
            codigo = '00' if a == '0' else a
            b, v = pedir(f'ValorIndicador/{serie}/{codigo}/null/es/null/null/3/null/0/null/null/null/1/3', T2)
            if isinstance(v, dict) and 'value' in v:
                guardar(carpeta / f'valor_{codigo}.json.gz', b); obs[codigo] = len(v['value']); primera = primera or codigo
            else:
                obs[codigo] = 0
        if primera:
            b, m = pedir(f'MetadatoIndicador/es/{serie}/{primera}/null/null/null/3', T2); guardar(carpeta / 'meta.json.gz', b)
        with candado:
            with open(MANIF, 'a') as f: f.write(json.dumps({'serie': serie, 'estado': 'ok' if primera else 'sin_datos', 'areas': [a for a, _, _ in areas], 'obs': obs, 'cuando': cuando}) + '\n')
        return 'ok' if primera else 'sin_datos'
    except RuntimeError as e:
        log(f'ERROR {serie}: {e}'); return 'error'

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--limite', type=int); a = ap.parse_args()
    CRUDO.mkdir(parents=True, exist_ok=True)
    series = sorted({r['serie'] for r in csv.DictReader(open(DIR / 'arbol' / 'serie_temas.csv'))}, key=int)
    hechas = {json.loads(l)['serie'] for l in open(MANIF)} if MANIF.exists() else set()
    pend = [s for s in series if s not in hechas][:a.limite]
    log(f'inicio: {len(series)} series, {len(hechas)} hechas, {len(pend)} pendientes'); print(f'{len(pend)} pendientes', flush=True)
    t0 = time.time(); cont = {'ok': 0, 'sin_datos': 0, 'error': 0}
    with cf.ThreadPoolExecutor(PARALELO) as ex:
        for i, r in enumerate(ex.map(procesar, pend)):
            cont[r] += 1
            if (i + 1) % 500 == 0: log(f'{i + 1}/{len(pend)} {cont} {(i + 1) / (time.time() - t0) * 60:.0f} series/min'); print(f'{i + 1}/{len(pend)} {cont}', flush=True)
    log(f'FIN {cont}'); print('FIN', cont, flush=True)

if __name__ == '__main__':
    main()

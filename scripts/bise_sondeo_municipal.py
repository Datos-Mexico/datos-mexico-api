"""Sondeo de cobertura municipal del Banco de Indicadores (insumo para la fase 2 de F8).

Para cada indicador del catálogo hace UNA petición con 20 municipios de 20 entidades
distintas (las cabeceras/capitales). Si el INEGI responde con observaciones, el indicador
tiene datos municipales; si responde 400 "No se encontraron resultados", no los tiene para
esas 20 (aproximación: un indicador municipal cubre normalmente todos los municipios).
Salida reanudable: data/bise/sondeo_municipal.jsonl {"id", "municipal", "obs", "geos"}.
Bitácora de avance: data/bise/sondeo_municipal.log.
"""
import json, pathlib, sys, time, threading, urllib.request, urllib.error
import concurrent.futures as cf
from datetime import datetime, timezone

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DIR = RAIZ / 'data' / 'bise'
SALIDA = DIR / 'sondeo_municipal.jsonl'
LOG = DIR / 'sondeo_municipal.log'
MUNICIPIOS = ['01001', '02002', '03003', '04002', '05030', '06002', '07101', '08019', '09015', '10005',
              '11015', '12029', '13048', '14039', '15106', '16053', '17007', '18017', '19039', '20067']
GEO = ','.join(MUNICIPIOS)
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

def sondear(i):
    url = f"https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml/INDICATOR/{i}/es/{GEO}/false/BISE/2.0/{TOKEN}?type=json"
    for intento in range(4):
        try:
            b = urllib.request.urlopen(url, timeout=120).read()
            try: d = json.loads(b)
            except ValueError:
                time.sleep(2 * (intento + 1)); continue
            obs = [o for s in d.get('Series', []) for o in s['OBSERVATIONS']]
            return {'id': i, 'municipal': len(obs) > 0, 'obs': len(obs), 'geos': len({o['COBER_GEO'] for o in obs})}
        except urllib.error.HTTPError as e:
            if e.code in (400, 401): return {'id': i, 'municipal': False, 'obs': 0, 'geos': 0}
            time.sleep(5 * (intento + 1))
        except Exception:
            time.sleep(5 * (intento + 1))
    log(f'ERROR {i}: sin respuesta válida tras 4 intentos'); return None

def main():
    ids = [x['value'] for x in json.load(open(DIR / 'catalogos' / 'CL_INDICATOR.json'))['CODE']]
    hechos = {json.loads(l)['id'] for l in open(SALIDA)} if SALIDA.exists() else set()
    pend = [i for i in ids if i not in hechos]
    log(f'inicio: {len(ids)} indicadores, {len(hechos)} hechos, {len(pend)} pendientes')
    t0 = time.time(); n = 0; con = 0
    with cf.ThreadPoolExecutor(PARALELO) as ex, open(SALIDA, 'a') as f:
        for r in ex.map(sondear, pend):
            if r is None: continue
            f.write(json.dumps(r) + '\n'); n += 1; con += r['municipal']
            if n % 1000 == 0: f.flush(); log(f'avance: {n} sondeados, {con} con datos municipales, {time.time()-t0:.0f}s')
    log(f'fin: {n} sondeados, {con} con datos municipales en {time.time()-t0:.0f}s')

if __name__ == '__main__':
    main()

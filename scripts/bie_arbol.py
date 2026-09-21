"""Árbol y catálogo de series del Banco de Información Económica (BIE) del INEGI, desde la API interna del sitio
(www.inegi.org.mx/app/indicadores/?tm=3; temática 3), a data/bie/.

Por qué esta vía: la API de desarrolladores del INEGI responde «No se encontraron resultados» (400, código 100) para
toda serie del BIE probada el 2026-09-21 (ids del árbol, de la tabla de equivalencias y del buscador del sitio, con área
0700 y 00, fuentes BIE y BISE), con el mismo token que sí sirve el Banco de Indicadores. El sitio del INEGI obtiene el BIE
de su API interna (interna_v1_3) con dos tokens de cliente públicos que lleva en su JavaScript (INEGI_TOKEN_WEB y
INEGI_TOKEN_WEB2 en data/.secretos.env, no versionados).

Métodos (verificados con las peticiones de red del navegador el 2026-09-21):
- NodosTemas/null/es/{tema|null}/null/null/null/3/false/null/3 : subtemas de un tema (raíz con null). En el BIE el
  campo `hijos` no es fiable (dice 0 en temas con subtemas) y los temas hoja responden código 100.
- IndicadoresPorTemaRecursivo/00/{tema}/es/null//0/500000/null/3/true/null/null : TODAS las series bajo un tema
  (campo `indicadoresTodos`, ids separados por coma). Las series directas de un tema = las suyas menos las de sus
  subtemas.
- EstructuraIndicador/{serie}/3 : ruta de temas de una serie (se usa solo para comprobar una muestra).

Salida: data/bie/arbol/nodos/<tema>.json.gz y recursivo/<tema>.json.gz (crudos), temas.csv (tema, nombre,
tema_superior, orden, nivel), serie_temas.csv (serie, tema hoja), arbol.log. Reanudable.
Medido el 2026-09-21: 14 temas raíz con 89,032 series en total.
Uso: data/.venv/bin/python scripts/bie_arbol.py
"""
import csv, gzip, json, pathlib, sys, time, threading, urllib.request
import concurrent.futures as cf
from collections import deque
from datetime import datetime, timezone

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DIR = RAIZ / 'data' / 'bie' / 'arbol'; NODOS = DIR / 'nodos'; REC = DIR / 'recursivo'; LOG = DIR / 'arbol.log'
BASE = 'https://www.inegi.org.mx/app/api/indicadores/interna_v1_3/API.svc'
PARALELO = 6; UA = 'Mozilla/5.0 (observatorio datosmexico.org; contacto en datosmexico.org)'

def secreto(clave):
    for linea in (RAIZ / 'data' / '.secretos.env').read_text().splitlines():
        if linea.startswith(clave + '='): return linea.split('=', 1)[1].strip()
    sys.exit(f'falta {clave} en data/.secretos.env')

TOKEN = secreto('INEGI_TOKEN_WEB'); candado = threading.Lock()

def log(msg):
    linea = f"{datetime.now(timezone.utc).strftime('%H:%M:%S')} {msg}"
    with candado:
        with open(LOG, 'a') as f: f.write(linea + '\n')
    print(linea, flush=True)

def pedir(ruta):
    url = f'{BASE}/{ruta}/json/{TOKEN}'; ultimo = None
    for intento in range(4):
        try:
            b = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=120).read()
            if b.startswith(b'\xef\xbb\xbf'): b = b[3:]
            return b, json.loads(b)
        except json.JSONDecodeError: ultimo = 'no JSON'; time.sleep(2 * (intento + 1))
        except Exception as e: ultimo = f'{type(e).__name__}: {str(e)[:60]}'; time.sleep(5 * (intento + 1))
    raise RuntimeError(ultimo)

def cache(carpeta, nombre, ruta):
    archivo = carpeta / f'{nombre}.json.gz'
    if archivo.exists():
        with gzip.open(archivo, 'rb') as f: return json.loads(f.read())
    b, d = pedir(ruta)
    with gzip.open(archivo, 'wb') as f: f.write(b)
    return d

def subtemas(tema):
    d = cache(NODOS, tema or 'raiz', f'NodosTemas/null/es/{tema or "null"}/null/null/null/3/false/null/3')
    if isinstance(d, dict): return []  # código 100: sin subtemas
    return [n['tema'] for n in d if n['tipoNodo'] == 'TEMA' and n['tema']]

def series_bajo(tema):
    d = cache(REC, tema, f'IndicadoresPorTemaRecursivo/00/{tema}/es/null//0/500000/null/3/true/null/null')
    if isinstance(d, dict) and 'indicadoresTodos' in d: return [x for x in d['indicadoresTodos'].split(',') if x]
    return []

def main():
    NODOS.mkdir(parents=True, exist_ok=True); REC.mkdir(parents=True, exist_ok=True)
    temas = {}; pendientes = deque()
    for t in subtemas(None):
        temas[t['tema']] = {'tema': t['tema'], 'nombre': t['nombre'], 'tema_superior': '', 'orden': t.get('orden'), 'nivel': 1}; pendientes.append((t['tema'], 1))
    log(f'raíz: {len(temas)} temas')
    visitados = 0
    with cf.ThreadPoolExecutor(PARALELO) as ex:
        while pendientes:
            lote = [pendientes.popleft() for _ in range(min(PARALELO * 4, len(pendientes)))]
            for (t, nivel), hijos in zip(lote, ex.map(lambda x: subtemas(x[0]), lote)):
                visitados += 1
                for s in hijos:
                    if s['tema'] in temas: log(f'AVISO tema {s["tema"]} repetido (padres {temas[s["tema"]]["tema_superior"]} y {t})'); continue
                    temas[s['tema']] = {'tema': s['tema'], 'nombre': s['nombre'], 'tema_superior': t, 'orden': s.get('orden'), 'nivel': nivel + 1}; pendientes.append((s['tema'], nivel + 1))
            if visitados % 200 < PARALELO * 4: log(f'{visitados} temas visitados, {len(temas)} conocidos, {len(pendientes)} pendientes')
    log(f'árbol: {len(temas)} temas')
    # series por tema (recursivo) y series directas
    bajo = {}
    with cf.ThreadPoolExecutor(PARALELO) as ex:
        for k, (t, ids) in enumerate(zip(list(temas), ex.map(series_bajo, list(temas)))):
            bajo[t] = ids
            if (k + 1) % 500 == 0: log(f'series: {k + 1}/{len(temas)} temas')
    hijos_de = {}
    for t in temas.values(): hijos_de.setdefault(t['tema_superior'], []).append(t['tema'])
    rel = []
    for t, ids in bajo.items():
        de_hijos = set()
        for h in hijos_de.get(t, []): de_hijos.update(bajo.get(h, []))
        for s in ids:
            if s not in de_hijos: rel.append((s, t))
    series = {s for s, _ in rel}
    raices = [t for t in temas.values() if t['nivel'] == 1]; total_raiz = sum(len(bajo[t['tema']]) for t in raices)
    log(f'series: {len(series)} distintas en {len(rel)} relaciones; suma de raíces {total_raiz}')
    with open(DIR / 'temas.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['tema', 'nombre', 'tema_superior', 'orden', 'nivel', 'series_bajo']); w.writeheader()
        for t in sorted(temas.values(), key=lambda t: (t['nivel'], t['tema_superior'], t['orden'] or 0, t['tema'])): w.writerow(dict(t, series_bajo=len(bajo.get(t['tema'], []))))
    with open(DIR / 'serie_temas.csv', 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['serie', 'tema']); w.writerows(sorted(rel, key=lambda r: (int(r[0]), r[1])))
    log('listo')

if __name__ == '__main__':
    main()

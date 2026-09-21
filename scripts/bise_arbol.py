"""Descarga el árbol temático del Banco de Indicadores del INEGI (la jerarquía tema › subtema › … › indicador
que muestra www.inegi.org.mx/app/indicadores/) a data/bise/arbol/.

Por qué: el catálogo CL_INDICATOR de la API de desarrolladores trae solo el nombre corto de cada indicador
("Total nacional", "Mujeres", "Total"…): 17,682 de los 31,039 indicadores con datos comparten nombre con otro.
La ruta temática es lo que los distingue en el sitio del INEGI y no la publica la API de desarrolladores; la
sirve la API interna del propio sitio (interna_v1_3), con el token de cliente público que el sitio lleva en
/componentes/biinegi/config.min.js (se lee de data/.secretos.env como INEGI_TOKEN_WEB para no versionarlo).

Métodos usados (los mismos que llama el sitio, verificados el 2026-09-20 con las peticiones de red del navegador):
- NodosTemas/null/es/{tema|null}/null/null/null/6/false/null/6/json/{token}: hijos de un tema (temas e indicadores).
  Con tema=null devuelve los temas raíz. La temática 6 es el Banco de Indicadores (la 3 es el BIE).
- EstructuraIndicador/{indicador}/6/json/{token}: ruta completa (lista de temas de raíz a hoja) de un indicador;
  se usa para los indicadores con datos que no aparecen en el recorrido del árbol.

Salida:
- data/bise/arbol/nodos/<tema>.json.gz : respuesta cruda de NodosTemas por tema (tal cual).
- data/bise/arbol/estructura/<indicador>.json.gz : respuesta cruda de EstructuraIndicador (solo faltantes).
- data/bise/arbol/temas.csv : tema, nombre, tema_superior, orden, nivel, hijos, numero_indicadores, url_tema
- data/bise/arbol/indicador_temas.csv : indicador, tema, orden, nombre_arbol, unidad_arbol, frecuencia_arbol, origen
  (origen = 'arbol' si vino de NodosTemas, 'estructura' si vino de EstructuraIndicador)
- data/bise/arbol/arbol.log
Reanudable: los temas ya descargados no se vuelven a pedir.
"""
import csv, gzip, json, pathlib, sys, time, threading, urllib.request, urllib.error
import concurrent.futures as cf
from collections import deque
from datetime import datetime, timezone

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DIR = RAIZ / 'data' / 'bise' / 'arbol'
NODOS = DIR / 'nodos'
ESTR = DIR / 'estructura'
LOG = DIR / 'arbol.log'
BASE = 'https://www.inegi.org.mx/app/api/indicadores/interna_v1_3/API.svc'
TEMATICA = '6'
PARALELO = 6
UA = 'Mozilla/5.0 (observatorio datosmexico.org; contacto en datosmexico.org)'


def token():
    for linea in (RAIZ / 'data' / '.secretos.env').read_text().splitlines():
        if linea.startswith('INEGI_TOKEN_WEB='):
            return linea.split('=', 1)[1].strip()
    sys.exit('falta INEGI_TOKEN_WEB en data/.secretos.env')


TOKEN = token()
candado = threading.Lock()


def log(msg):
    linea = f"{datetime.now(timezone.utc).strftime('%H:%M:%S')} {msg}"
    with candado:
        with open(LOG, 'a') as f:
            f.write(linea + '\n')
    print(linea, flush=True)


def pedir(ruta):
    """GET al método indicado; devuelve (bytes, json). Reintenta 4 veces. Nunca imprime la URL (lleva el token)."""
    url = f'{BASE}/{ruta}/json/{TOKEN}'
    ultimo = None
    for intento in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            b = urllib.request.urlopen(req, timeout=120).read()
            if b.startswith(b'\xef\xbb\xbf'):
                b = b[3:]
            try:
                d = json.loads(b)
            except ValueError:
                ultimo = 'respuesta no JSON'
                time.sleep(2 * (intento + 1)); continue
            return b, d
        except urllib.error.HTTPError as e:
            ultimo = f'HTTP {e.code}'
            time.sleep(5 * (intento + 1))
        except Exception as e:
            ultimo = f'{type(e).__name__}: {str(e)[:80]}'
            time.sleep(5 * (intento + 1))
    raise RuntimeError(ultimo)


def nodos(tema):
    """Hijos del tema (None = raíz). Devuelve la lista de nodos; [] si el INEGI responde 'No se encontraron resultados'."""
    archivo = NODOS / f'{tema or "raiz"}.json.gz'
    if archivo.exists():
        with gzip.open(archivo, 'rb') as f:
            d = json.loads(f.read())
    else:
        b, d = pedir(f'NodosTemas/null/es/{tema or "null"}/null/null/null/{TEMATICA}/false/null/{TEMATICA}')
        if isinstance(d, dict) and d.get('ErrorCode') not in (None, '100'):
            raise RuntimeError(f"ErrorCode {d.get('ErrorCode')}: {str(d.get('ErrorInfo'))[:80]}")
        with gzip.open(archivo, 'wb') as f:
            f.write(b)
    return d if isinstance(d, list) else []


def estructura(indicador):
    archivo = ESTR / f'{indicador}.json.gz'
    if archivo.exists():
        with gzip.open(archivo, 'rb') as f:
            return json.loads(f.read())
    b, d = pedir(f'EstructuraIndicador/{indicador}/{TEMATICA}')
    if isinstance(d, dict):
        d = []
    with gzip.open(archivo, 'wb') as f:
        f.write(json.dumps(d, ensure_ascii=False).encode())
    return d


def main():
    NODOS.mkdir(parents=True, exist_ok=True); ESTR.mkdir(parents=True, exist_ok=True)
    temas = {}          # tema -> dict
    ind_temas = []      # filas de indicador_temas
    raiz = nodos(None)
    pendientes = deque()
    for n in raiz:
        t = n['tema']
        temas[t['tema']] = {'tema': t['tema'], 'nombre': t['nombre'], 'tema_superior': '', 'orden': t.get('orden'), 'nivel': 1,
                            'hijos': t.get('hijos'), 'numero_indicadores': t.get('numeroIndica'), 'url_tema': t.get('urlTema') or ''}
        pendientes.append((t['tema'], 1))
    log(f'raíz: {len(raiz)} temas')
    hechos = 0; errores = 0
    with cf.ThreadPoolExecutor(PARALELO) as ex:
        while pendientes:
            lote = [pendientes.popleft() for _ in range(min(PARALELO * 4, len(pendientes)))]
            futuros = {ex.submit(nodos, t): (t, nivel) for t, nivel in lote}
            for fu in cf.as_completed(futuros):
                t, nivel = futuros[fu]
                try:
                    hijos = fu.result()
                except RuntimeError as e:
                    log(f'ERROR tema {t}: {e}'); errores += 1; continue
                hechos += 1
                for n in hijos:
                    if n['tipoNodo'] == 'TEMA' and n['tema']:
                        s = n['tema']
                        if s['tema'] in temas:
                            log(f'AVISO tema {s["tema"]} ya visto (padre {temas[s["tema"]]["tema_superior"]} y {t})'); continue
                        temas[s['tema']] = {'tema': s['tema'], 'nombre': s['nombre'], 'tema_superior': t, 'orden': s.get('orden'), 'nivel': nivel + 1,
                                            'hijos': s.get('hijos'), 'numero_indicadores': s.get('numeroIndica'), 'url_tema': s.get('urlTema') or ''}
                        pendientes.append((s['tema'], nivel + 1))
                    elif n['tipoNodo'] == 'INDICADOR' and n['indicador']:
                        i = n['indicador']
                        ind_temas.append({'indicador': str(i['indicador']), 'tema': t, 'orden': i.get('orden'), 'nombre_arbol': i.get('nombre') or '',
                                          'unidad_arbol': i.get('unidad') or '', 'frecuencia_arbol': i.get('frecuencia') or '', 'origen': 'arbol'})
                if hechos % 100 == 0:
                    log(f'{hechos} temas recorridos, {len(temas)} conocidos, {len(ind_temas)} indicador-tema, {len(pendientes)} pendientes')
    log(f'árbol: {hechos} temas recorridos, {len(temas)} temas, {len(ind_temas)} relaciones indicador-tema, {errores} errores')

    # Faltantes: indicadores con datos que no aparecen en el árbol → EstructuraIndicador uno por uno.
    con_datos = [r['id'] for r in csv.DictReader(open(RAIZ / 'data' / 'bise' / 'neon-export' / 'indicadores.csv')) if r['con_datos'] == '1']
    en_arbol = {r['indicador'] for r in ind_temas}
    faltan = [i for i in con_datos if i not in en_arbol]
    log(f'indicadores con datos {len(con_datos)}, en el árbol {len(con_datos) - len(faltan)}, faltan {len(faltan)}')
    sin_ruta = 0
    with cf.ThreadPoolExecutor(PARALELO) as ex:
        for k, (i, fu) in enumerate([(i, ex.submit(estructura, i)) for i in faltan]):
            try:
                ruta = fu.result()
            except RuntimeError as e:
                log(f'ERROR estructura {i}: {e}'); errores += 1; continue
            if not ruta:
                sin_ruta += 1; continue
            padre = ''
            for nivel, paso in enumerate(ruta, 1):
                if paso['Tema'] not in temas:
                    temas[paso['Tema']] = {'tema': paso['Tema'], 'nombre': paso['Nombre'], 'tema_superior': padre, 'orden': None, 'nivel': nivel,
                                           'hijos': None, 'numero_indicadores': None, 'url_tema': paso.get('UrlTema') or ''}
                padre = paso['Tema']
            ind_temas.append({'indicador': i, 'tema': ruta[-1]['Tema'], 'orden': None, 'nombre_arbol': '', 'unidad_arbol': '', 'frecuencia_arbol': '', 'origen': 'estructura'})
            if (k + 1) % 200 == 0:
                log(f'estructura: {k + 1}/{len(faltan)}')
    log(f'estructura: {len(faltan)} pedidos, {sin_ruta} sin ruta, {errores} errores acumulados')

    with open(DIR / 'temas.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['tema', 'nombre', 'tema_superior', 'orden', 'nivel', 'hijos', 'numero_indicadores', 'url_tema'])
        w.writeheader(); [w.writerow(t) for t in sorted(temas.values(), key=lambda t: (t['nivel'], t['tema_superior'], t['orden'] or 0, t['tema']))]
    with open(DIR / 'indicador_temas.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['indicador', 'tema', 'orden', 'nombre_arbol', 'unidad_arbol', 'frecuencia_arbol', 'origen'])
        w.writeheader(); [w.writerow(r) for r in ind_temas]
    log(f'listo: {len(temas)} temas y {len(ind_temas)} relaciones escritas')


if __name__ == '__main__':
    main()

"""SAIC (Sistema Automatizado de Información Censal) de los Censos Económicos: descarga completa por su API interna
(exclusión 7 del traspaso). El SAIC (www.inegi.org.mx/app/saic/) sirve los resultados de los Censos Económicos 2004-2024
(años censales 2003, 2008, 2013, 2018, 2023) por área geográfica (nacional, 32 entidades, municipios), actividad económica
(SCIAN: sector, subsector, rama, subrama, clase, y el total) y estrato de personal ocupado, para 98 variables censales
(unidades económicas, personal ocupado, remuneraciones, producción bruta, valor agregado, activos, ingresos, gastos…).
Métodos identificados con las peticiones de red del navegador (2026-09-21): GET /app/api/saic/{anios,ageos,acteco,varcen,
estrato}/seg/<clave>/<opción>/6/ (catálogos y árboles) y POST /app/api/saic/consulta/{total,tabla}/6/ con el cuerpo
{anios, ageos, actecos, varcens:[{nom,pos}], stratums, indicators:[], calcs:[], total, orden, desc, page, reg}.

Etapas:
  --catalogos  guarda años, entidades y municipios, árbol de actividad (todos los niveles), variables y estratos en data/saic/catalogos.json
  --descargar  una tarea por (año, ámbito geográfico, nivel de actividad): páginas de 1,000 filas en data/saic/crudo/<año>/<ambito>/<nivel>-<pág>.json.gz,
               manifiesto reanudable (data/saic/manifiesto.jsonl) con el total anunciado por consulta/total y las filas recibidas (deben coincidir).
Uso: data/.venv/bin/python scripts/saic_descarga.py --catalogos --descargar --hilos 8
"""
import argparse, gzip, json, os, pathlib, sys, threading, time, urllib.request, collections as C
import concurrent.futures as cf
RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data' / 'saic'; CRUDO = DIR / 'crudo'; CAT = DIR / 'catalogos.json'; MANIF = DIR / 'manifiesto.jsonl'; LOG = DIR / 'saic.log'
A = 'https://www.inegi.org.mx/app/api/saic/'; REG = 1000
H = {'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://www.inegi.org.mx/app/saic/', 'Origin': 'https://www.inegi.org.mx', 'User-Agent': 'Mozilla/5.0'}
candado = threading.Lock()
def log(m):
    with candado:
        with open(LOG, 'a') as f: f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {m}\n")
    print(m, flush=True)
def get(u):
    for i in range(5):
        try: return json.loads(urllib.request.urlopen(urllib.request.Request(A + u, headers=H), timeout=120).read())
        except Exception as e:
            if i == 4: raise
            time.sleep(5 * (i + 1))
def post(ep, b):
    for i in range(6):
        try:
            r = urllib.request.Request(A + ep, data=json.dumps(b).encode(), headers=H)
            with urllib.request.urlopen(r, timeout=600) as x: return json.loads(x.read())
        except Exception as e:
            if i == 5: raise
            time.sleep(10 * (i + 1))

def catalogos():
    anios = [x['key'] for x in get('anios/seg/0/0/6/')['list']]
    ents = get('ageos/seg/00/1/6/')['list']; muns = {}
    for e in ents: muns[e['key']] = get(f"ageos/seg/{e['key']}/1/6/")['list']
    arbol = []; niveles = C.defaultdict(list)
    def bajar(nodo, nivel, padre):
        arbol.append({'clave': nodo['key'], 'nombre': nodo['name'], 'nivel': nivel, 'padre': padre}); niveles[nivel].append(nodo['key'])
        if nodo['child']:
            for h in get(f"acteco/seg/{nodo['key']}/2/6/")['list']: bajar(h, nivel + 1, nodo['key'])
    for s in get('acteco/seg/0/2/6/')['list']: bajar(s, 1, None)
    grupos = get('varcen/seg/0/3/6/')['list']; variables = []; vistas = set()
    for g in grupos:
        hojas = [g] if not g['child'] else get(f"varcen/seg/{g['key']}/3/6/")['list']
        for h in hojas:
            if h['key'] in vistas: continue
            vistas.add(h['key']); variables.append({'clave': h['key'], 'nombre': h['name'].strip(), 'grupo': g['key'], 'grupo_nombre': g['name'], 'definicion': h.get('tool')})
    estratos = get('estrato/seg/0/5/6/')['list']
    c = {'anios': anios, 'entidades': ents, 'municipios': muns, 'arbol': arbol, 'niveles': {str(k): v for k, v in niveles.items()}, 'variables': variables, 'estratos': estratos, 'fecha': time.strftime('%Y-%m-%d')}
    CAT.write_text(json.dumps(c, ensure_ascii=False, indent=0))
    log(f"catálogos: {len(anios)} años, {len(ents)} entidades, {sum(len(v) for v in muns.values())} municipios, actividad " + ', '.join(f'nivel {k}: {len(v)}' for k, v in sorted(niveles.items())) + f", {len(variables)} variables, {len(estratos)} estratos")

def tareas(c):
    """Tareas ordenadas por valor y costo (el servidor del SAIC cobra ~0.65 s por variable y 1,000 filas, y no paraleliza):
    1) nacional y 32 entidades, todos los niveles de actividad y los 6 estratos; 2) municipios por sector (nivel 1), estratos todos;
    3) municipios por subsector, rama y clase (niveles 2, 3, 5) solo con el estrato total (0); 4) municipios nivel 4 y los estratos
    1-99 de los niveles 2-5 (pasadas posteriores, misma clave con sufijo). Ámbitos: '00' (nacional), 'ent' (32 entidades), cada entidad (sus municipios)."""
    V = [{'nom': 'UE', 'pos': 0}] + [{'nom': v['clave'], 'pos': i + 1} for i, v in enumerate(v for v in c['variables'] if v['clave'] != 'UE')]
    todos = [str(e['key']) for e in c['estratos']]; total = ['0']; resto = [e for e in todos if e != '0']
    def tarea(anio, ambito, ageos, nivel, est, sufijo):
        actecos = [] if nivel == 0 else c['niveles'][str(nivel)]
        return {'anio': anio, 'ambito': ambito, 'nivel': nivel, 'sufijo': sufijo, 'cuerpo': {'anios': [anio], 'ageos': ageos, 'actecos': actecos, 'varcens': V, 'stratums': est, 'indicators': [], 'calcs': [], 'total': nivel == 0, 'orden': '1', 'desc': False, 'page': 0, 'reg': REG}}
    muns = [(e['key'], [m['key'] for m in c['municipios'][e['key']]]) for e in c['entidades']]
    for anio in c['anios']:
        for ambito, ageos in [('00', ['00']), ('ent', [e['key'] for e in c['entidades']])]:
            for nivel in range(0, 6): yield tarea(anio, ambito, ageos, nivel, todos, '')
    for anio in c['anios']:
        for e, ag in muns:
            for nivel in (0, 1): yield tarea(anio, e, ag, nivel, todos, '')
    for anio in c['anios']:
        for e, ag in muns:
            for nivel in (5, 2, 3): yield tarea(anio, e, ag, nivel, total, '-e0')
    for anio in c['anios']:
        for e, ag in muns:
            yield tarea(anio, e, ag, 4, total, '-e0')
            for nivel in (2, 3, 4, 5): yield tarea(anio, e, ag, nivel, resto, '-e1')

def descargar_tarea(t):
    b = t['cuerpo']; clave = f"{t['anio']}/{t['ambito']}/{t['nivel']}{t['sufijo']}"; d = CRUDO / t['anio'] / t['ambito']; d.mkdir(parents=True, exist_ok=True)
    tot = post('consulta/total/6/', dict(b, varcens=None, calcs=None, orden=None, desc=False, page=0, reg=0))
    total = int(tot['info'][0]['total']) if tot.get('success') else 0
    filas = 0; pagina = 0
    while filas < total:
        r = post('consulta/tabla/6/', dict(b, page=pagina))
        if not r.get('success'): raise RuntimeError(f"{clave} pág {pagina}: {r.get('msg')}")
        info = json.loads(r['data'])['info']
        with gzip.open(d / f"{t['nivel']}{t['sufijo']}-{pagina:04d}.json.gz", 'wt', encoding='utf-8') as f: json.dump(info, f, ensure_ascii=False)
        filas += len(info); pagina += 1
        if not info: raise RuntimeError(f'{clave}: página vacía con {filas}/{total}')
    return clave, total, filas, pagina

def descargar(hilos):
    c = json.loads(CAT.read_text()); hechas = {json.loads(l)['clave'] for l in open(MANIF) if l.strip()} if MANIF.exists() else set()
    pend = [t for t in tareas(c) if f"{t['anio']}/{t['ambito']}/{t['nivel']}{t['sufijo']}" not in hechas]
    log(f'descarga: {len(pend)} tareas pendientes de {len(list(tareas(c)))}, {hilos} hilos'); t0 = time.time(); n = [0, 0, 0]
    def uno(t):
        try:
            clave, total, filas, paginas = descargar_tarea(t)
            with candado:
                with open(MANIF, 'a') as f: f.write(json.dumps({'clave': clave, 'total': total, 'filas': filas, 'paginas': paginas, 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}) + '\n')
                n[0] += 1; n[1] += filas
                if n[0] % 20 == 0: log(f'  {n[0]}/{len(pend)} tareas, {n[1]:,} filas, {n[2]} errores, {(time.time() - t0) / 60:.1f} min')
        except Exception as e:
            with candado: n[2] += 1
            log(f"  ERROR {t['anio']}/{t['ambito']}/{t['nivel']}{t['sufijo']}: {e}")
    with cf.ThreadPoolExecutor(hilos) as ex: list(ex.map(uno, pend))
    log(f'descarga terminada: {n[0]} tareas, {n[1]:,} filas, {n[2]} errores, {(time.time() - t0) / 60:.1f} min')

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--catalogos', action='store_true'); ap.add_argument('--descargar', action='store_true'); ap.add_argument('--hilos', type=int, default=8); a = ap.parse_args()
    if a.catalogos: catalogos()
    if a.descargar: descargar(a.hilos)

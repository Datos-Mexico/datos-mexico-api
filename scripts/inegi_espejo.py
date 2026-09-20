"""Pide al worker (POST /api/v1/admin/espejo) que copie a R2, desde la red de Cloudflare, las fuentes del INEGI
pendientes: zips de microdatos (a inegi/fuentes/…, con las mismas claves que usa el ingestor) y tabulados (a su
clave final inegi/tabulados/…). Registra cada resultado en data/inegi/espejo.jsonl (y los tabulados además en
data/inegi/tabulados-espejo.jsonl con la forma del manifiesto de tabulados: bytes, etag, URL, máquina 'cloudflare').
El JWT se renueva cada 25 minutos. Reanudable: omite claves ya registradas.
Uso: data/.venv/bin/python scripts/inegi_espejo.py [--hilos 24] [--solo microdatos|tabulados]
"""
import argparse, csv, json, pathlib, sys, threading, time, urllib.parse, urllib.request
import concurrent.futures as cf
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent)); import inegi_ingesta as g
API = 'https://api.datosmexico.org'; REG = g.BASE / 'espejo.jsonl'; TAB = g.BASE / 'tabulados-espejo.jsonl'
candado = threading.Lock(); _tok = {'v': None, 't': 0}
def env():
    return dict(l.strip().split('=', 1) for l in (g.RAIZ / 'data' / '.secretos.env').read_text().splitlines() if '=' in l)
def token():
    with candado:
        if time.time() - _tok['t'] > 25 * 60:
            e = env(); d = urllib.parse.urlencode({'username': 'observatorio', 'password': e['PLATAFORMA_observatorio']}).encode()
            _tok['v'] = json.loads(urllib.request.urlopen(urllib.request.Request(API + '/api/v1/auth/token', data=d, headers={'user-agent': 'espejo-datosmexico/1'}), timeout=60).read())['access_token']; _tok['t'] = time.time()
        return _tok['v']
def espejar(url, clave):
    ultimo = ''
    for intento in range(4):
        try:
            r = urllib.request.Request(API + '/api/v1/admin/espejo', data=json.dumps({'url': url, 'clave': clave}).encode(), headers={'authorization': f'Bearer {token()}', 'content-type': 'application/json', 'user-agent': 'espejo-datosmexico/1'})
            with urllib.request.urlopen(r, timeout=900) as x: return json.loads(x.read())
        except urllib.error.HTTPError as e:
            ultimo = f'HTTP {e.code} {e.read()[:120]!r}'
            if e.code == 429: time.sleep(30)
            elif e.code == 401: _tok['t'] = 0
            else: time.sleep(10 * (intento + 1))
        except Exception as e: ultimo = f'{type(e).__name__}: {str(e)[:100]}'; time.sleep(10 * (intento + 1))
    raise RuntimeError(ultimo)
def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--hilos', type=int, default=24); ap.add_argument('--solo'); a = ap.parse_args()
    hechas = {json.loads(l)['clave'] for l in open(REG) if l.strip()} if REG.exists() else set()
    tareas = []
    if a.solo != 'tabulados':
        listos = g.hechos()
        for x in g.entradas():
            if x['id'] in listos: continue
            prog, ed, arch, zipn, clave = g.claves_de(x)
            if clave not in hechas: tareas.append(('microdatos', x, g.url_de(x), clave))
    if a.solo != 'microdatos':
        inv = [x for x in csv.DictReader(open(g.INV, encoding='utf-8')) if x['clasificacion'] == 'tabulados']
        import collections; grupos = collections.defaultdict(set)
        for x in inv: grupos[(x['programa'], x['anio'], pathlib.Path(x['path']).name)].add(x['id'])
        col = {k for k, v in grupos.items() if len(v) > 1}
        ya_tab = set()
        for f in g.BASE.glob('tabulados-*.jsonl'):
            for l in open(f):
                if l.strip():
                    j = json.loads(l)
                    if j.get('estado') == 'ok': ya_tab.add(j['id'] + j['formato'])
        for x in inv:
            if x['id'] + x['formato'] in ya_tab: continue
            prog = g.slug(x['programa']); ed = (x['anio'] or 's-f').replace('|', '-'); nombre = pathlib.Path(''.join(ch for ch in x['path'] if ch >= ' ').strip()).name
            nombre = (f"{nombre}-{x['id']}{x['formato']}" if (x['programa'], x['anio'], nombre) in col else nombre + x['formato']).replace(' ', '_')
            clave = f'inegi/tabulados/{prog}/{ed}/{nombre}'
            if clave not in hechas: tareas.append(('tabulados', x, g.url_de(x), clave))
    print(f'{len(tareas)} archivos por espejar ({sum(float(t[1]["mb"]) for t in tareas)/1024:.2f} GB), {a.hilos} hilos', flush=True)
    t0 = time.time(); n = [0]; err = [0]
    def uno(t):
        clase, x, url, clave = t
        try:
            r = espejar(url, clave); reg = {'clase': clase, 'id': x['id'], 'clave': clave, 'url': url, 'bytes': r['bytes'], 'etag': r['etag'], 'existia': r['existia'], 'ms': r['ms'], 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
            with candado:
                with open(REG, 'a') as f: f.write(json.dumps(reg) + '\n')
                if clase == 'tabulados':
                    with open(TAB, 'a') as f: f.write(json.dumps({'id': x['id'], 'estado': 'ok', 'programa': x['programa'], 'programa_slug': g.slug(x['programa']), 'edicion': (x['anio'] or 's-f').replace('|', '-'), 'titulo': x['titulo'], 'formato': x['formato'], 'bytes': r['bytes'], 'sha256': None, 'etag': r['etag'], 'clave_r2': clave, 'url': url, 'maquina': 'cloudflare', 'ts': reg['ts']}, ensure_ascii=False) + '\n')
                n[0] += 1
                if n[0] % 100 == 0: print(f"{time.strftime('%H:%M:%S')} {n[0]}/{len(tareas)} espejados, {err[0]} errores, {time.time()-t0:.0f}s", flush=True)
        except Exception as e:
            with candado:
                err[0] += 1
                with open(g.BASE / 'espejo-errores.log', 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {clave} {url} {e}\n")
    with cf.ThreadPoolExecutor(a.hilos) as ex: list(ex.map(uno, tareas))
    print(f'FIN {n[0]} espejados, {err[0]} errores en {time.time()-t0:.0f}s', flush=True)
if __name__ == '__main__': main()

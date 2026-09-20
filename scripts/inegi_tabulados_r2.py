"""Archiva íntegros los tabulados de la descarga masiva del INEGI (Excel, HTML, PDF, zip) en R2,
con manifiesto (programa, edición, título, formato, bytes, SHA-256, URL de origen, máquina, fecha).
No se transforman: son cuadros de presentación; el índice permite localizarlos y descargarlos.
Claves: inegi/tabulados/<programa_slug>/<edicion>/<nombre_archivo>. Reanudable por (id, formato).
Uso: data/.venv/bin/python scripts/inegi_tabulados_r2.py [--shard k/n] [--workers 4]
"""
import argparse, csv, hashlib, json, os, pathlib, socket, subprocess, sys, tempfile, time, threading, urllib.request
import concurrent.futures as cf
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent)); import inegi_ingesta as g
MANIF = g.BASE / f'tabulados-{socket.gethostname().split(".")[0]}.jsonl'; LOG = g.BASE / f'tabulados-{socket.gethostname().split(".")[0]}.log'
candado = threading.Lock()
def log(m):
    with candado, open(LOG, 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {m}\n")
def hechos():
    return {(json.loads(l)['id'], json.loads(l)['formato']) for l in open(MANIF) if l.strip()} if MANIF.exists() else set()
def procesar(x):
    prog = g.slug(x['programa']); ed = (x['anio'] or 's-f').replace('|', '-'); url = g.url_de(x); nombre = pathlib.Path(x['path']).name + x['formato']
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='tab-'))
    try:
        f = tmp / nombre; sha = g.descargar(url, f)
        tipo = {'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel', '.pdf': 'application/pdf', '.html': 'text/html', '.zip': 'application/zip'}.get(pathlib.Path(nombre).suffix.lower(), 'application/octet-stream')
        clave = f'inegi/tabulados/{prog}/{ed}/{nombre}'; g.subir(clave, f, tipo)
        with candado, open(MANIF, 'a') as m: m.write(json.dumps({'id': x['id'], 'estado': 'ok', 'programa': x['programa'], 'programa_slug': prog, 'edicion': ed, 'titulo': x['titulo'], 'formato': x['formato'], 'bytes': f.stat().st_size, 'sha256': sha, 'clave_r2': clave, 'url': url, 'maquina': socket.gethostname().split('.')[0], 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, ensure_ascii=False) + '\n')
    except Exception as e:
        log(f'ERROR {x["id"]} {x["programa"][:40]} {ed} {nombre}: {type(e).__name__}: {str(e)[:120]}')
        with candado, open(MANIF, 'a') as m: m.write(json.dumps({'id': x['id'], 'estado': 'error', 'programa': x['programa'], 'edicion': ed, 'formato': x['formato'], 'url': url, 'error': str(e)[:200]}, ensure_ascii=False) + '\n')
    finally:
        import shutil; shutil.rmtree(tmp, ignore_errors=True)
def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--shard', default='0/1'); ap.add_argument('--workers', type=int, default=4); a = ap.parse_args()
    k, n = (int(v) for v in a.shard.split('/'))
    todos = [x for x in csv.DictReader(open(g.INV, encoding='utf-8')) if x['clasificacion'] == 'tabulados']
    listos = hechos(); mios = [x for x in todos if int(hashlib.md5((x['id'] + x['formato']).encode()).hexdigest(), 16) % n == k and (x['id'], x['formato']) not in listos]
    log(f'inicio shard {k}/{n}: {len(mios)} archivos ({sum(float(x["mb"]) for x in mios)/1024:.2f} GB), {a.workers} hilos')
    with cf.ThreadPoolExecutor(a.workers) as ex: list(ex.map(procesar, mios))
    log('FIN')
if __name__ == '__main__': main()

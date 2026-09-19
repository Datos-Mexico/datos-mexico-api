"""Sube a R2 (remoto) los Parquet de microdatos que el pipeline dejó en disco.

Contexto (2026-09-19): `wrangler r2 object put` sin `--remote` escribe en el almacén LOCAL de
wrangler (.wrangler/state/v3/r2) y también imprime "Upload complete", así que las 399 subidas del
pipeline no llegaron al bucket. Este script sube cada archivo del manifiesto con `--remote`,
comprueba el tamaño en disco contra `bytes_parquet` del manifiesto y verifica al final, con la API
de Cloudflare, que cada clave existe en el bucket con el mismo tamaño. Reanudable: primero lista
el bucket y omite las claves ya presentes con el tamaño correcto.
Uso: python3 scripts/microdatos_subir_remoto.py
"""
import json, pathlib, subprocess, sys, time, urllib.request, urllib.parse
RAIZ = pathlib.Path(__file__).resolve().parent.parent
BASE = RAIZ / 'data/enoe/microdatos'
CUENTA = '1f0e02cff3791c3ffbb95cd155fc4305'; BUCKET = 'datosmexico-datos'

def token():
    for l in (RAIZ / 'data/.secretos.env').read_text().splitlines():
        if l.startswith('CF_CATALOG_TOKEN='): return l.split('=', 1)[1].strip()
    sys.exit('falta CF_CATALOG_TOKEN')

def remotos(tk):
    """clave → tamaño de todo el bucket (la API pagina con cursor)."""
    out = {}; cursor = None
    while True:
        u = f"https://api.cloudflare.com/client/v4/accounts/{CUENTA}/r2/buckets/{BUCKET}/objects?per_page=1000" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else '')
        d = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={'Authorization': f'Bearer {tk}'}), timeout=60).read())
        for o in d['result']: out[o['key']] = o['size']
        ri = d.get('result_info') or {}; cursor = ri.get('cursor')
        if not ri.get('is_truncated') or not cursor: break
    return out

def main():
    tk = token()
    man = [json.loads(l) for l in open(BASE / 'manifiesto.jsonl') if l.strip()]
    ya = remotos(tk); print(f"{time.strftime('%H:%M:%S')} en el bucket: {len(ya)} objetos", flush=True)
    pend = [j for j in man if j.get('ok') and ya.get(j['clave_r2']) != j['bytes_parquet']]
    print(f"{time.strftime('%H:%M:%S')} {len(man)} en el manifiesto, {len(pend)} por subir", flush=True)
    t0 = time.time(); n = 0
    for j in pend:
        f = BASE / j['tabla'] / f"{j['periodo']}.parquet"
        if not f.exists() or f.stat().st_size != j['bytes_parquet']:
            print(f"ERROR {j['clave_r2']}: archivo local ausente o con tamaño distinto", flush=True); continue
        for intento in range(3):
            r = subprocess.run(['npx', 'wrangler', 'r2', 'object', 'put', f"{BUCKET}/{j['clave_r2']}", '--remote', '--file', str(f), '--content-type', 'application/vnd.apache.parquet'], cwd=RAIZ, capture_output=True, text=True)
            if r.returncode == 0 and 'Upload complete' in (r.stdout + r.stderr): break
            print(f"reintento {j['clave_r2']}: {(r.stdout + r.stderr)[-200:]}", flush=True); time.sleep(5)
        else:
            print(f"ERROR {j['clave_r2']}: no se pudo subir", flush=True); continue
        n += 1
        if n % 25 == 0: print(f"{time.strftime('%H:%M:%S')} {n}/{len(pend)} subidos, {time.time()-t0:.0f}s", flush=True)
    ya = remotos(tk)
    ok = sum(1 for j in man if j.get('ok') and ya.get(j['clave_r2']) == j['bytes_parquet'])
    print(f"{time.strftime('%H:%M:%S')} verificación remota: {ok}/{sum(1 for j in man if j.get('ok'))} claves presentes con el tamaño del manifiesto; {sum(v for k, v in ya.items() if k.startswith('enoe/microdatos/'))/1e9:.2f} GB en R2. FIN", flush=True)

if __name__ == '__main__': main()

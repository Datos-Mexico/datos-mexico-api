"""Censo 2020 — Resultados por AGEB y manzana urbana → Parquet por entidad en R2 (remoto).

Entrada: data/censo2020/ageb/ageb_mza_urbana_NN_cpv2020_csv.zip (INEGI, datos abiertos), 32 archivos,
230 columnas: 8 de identificación (ENTIDAD, NOM_ENT, MUN, NOM_MUN, LOC, NOM_LOC, AGEB, MZA; el archivo
incluye también las filas de totales por entidad, municipio, localidad y AGEB, identificables por
MZA='000' y AGEB='0000') y 222 indicadores.
Fidelidad: los indicadores se guardan como enteros (Int64), o Float64 en las columnas donde el INEGI
publica decimales (promedios, relaciones, grado de escolaridad), con nulo donde el INEGI publica '*'
(confidencialidad), 'N/D' o 'N/A'; la columna adicional `celdas_especiales` conserva, por fila, un JSON
{columna: '*'|'N/D'} con cada valor especial, de modo que el archivo original se puede reconstruir.
Salida: data/censo2020/ageb/parquet/ageb_mza_NN.parquet (zstd) → R2 remoto
censo2020/ageb_manzana/ageb_mza_NN.parquet, manifiesto data/censo2020/ageb/manifiesto.jsonl con conteo
de filas, columnas, bytes y conteo de celdas especiales; al final se verifica con la API de Cloudflare
que cada clave existe con el tamaño correcto.
Uso: data/.venv/bin/python scripts/ageb_r2.py
"""
import csv, io, json, pathlib, subprocess, sys, time, zipfile, urllib.request, urllib.parse
import pyarrow as pa, pyarrow.parquet as pq
RAIZ = pathlib.Path(__file__).resolve().parent.parent
DIR = RAIZ / 'data/censo2020/ageb'; PARQ = DIR / 'parquet'; MANIF = DIR / 'manifiesto.jsonl'
CUENTA = '1f0e02cff3791c3ffbb95cd155fc4305'; BUCKET = 'datosmexico-datos'
ID_COLS = ['entidad', 'nom_ent', 'mun', 'nom_mun', 'loc', 'nom_loc', 'ageb', 'mza']
csv.field_size_limit(1 << 30)

def token():
    for l in (RAIZ / 'data/.secretos.env').read_text().splitlines():
        if l.startswith('CF_CATALOG_TOKEN='): return l.split('=', 1)[1].strip()
    sys.exit('falta CF_CATALOG_TOKEN')

def remotos(tk):
    out = {}; cursor = None
    while True:
        u = f"https://api.cloudflare.com/client/v4/accounts/{CUENTA}/r2/buckets/{BUCKET}/objects?per_page=1000" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else '')
        d = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={'Authorization': f'Bearer {tk}'}), timeout=60).read())
        for o in d['result']: out[o['key']] = o['size']
        ri = d.get('result_info') or {}; cursor = ri.get('cursor')
        if not ri.get('is_truncated') or not cursor: break
    return out

def procesar(i, hechos):
    if i in hechos: return hechos[i]
    z = zipfile.ZipFile(DIR / f'ageb_mza_urbana_{i:02d}_cpv2020_csv.zip')
    datos = [x for x in z.namelist() if 'conjunto_de_datos/' in x and x.endswith('.csv')][0]
    r = csv.reader(io.StringIO(z.read(datos).decode('utf-8-sig'))); cab = [c.strip().lower() for c in next(r)]
    assert cab[:8] == ID_COLS and len(cab) == 230, (i, cab[:8], len(cab))
    cols = {c: [] for c in cab}; esp_col = []; n = 0; n_esp = {'*': 0, 'N/D': 0, 'N/A': 0}; decimal = set()
    for fila in r:
        if not fila: continue
        assert len(fila) == 230, (i, len(fila))
        e = {}
        for j, v in enumerate(fila):
            v = v.strip(); c = cab[j]
            if j < 8: cols[c].append(v if v != '' else None)
            elif v in ('*', 'N/D', 'N/A'): cols[c].append(None); e[c] = v; n_esp[v] += 1
            elif v == '': cols[c].append(None)
            elif '.' in v: cols[c].append(float(v)); decimal.add(c)
            else: cols[c].append(int(v))
        esp_col.append(json.dumps(e, ensure_ascii=False) if e else None); n += 1
    # tipo por columna: entero salvo que el INEGI publique decimales en ella (promedios, relaciones, grados)
    tipo = lambda c: pa.string() if c in ID_COLS else (pa.float64() if c in decimal else pa.int64())
    campos = [pa.field(c, tipo(c)) for c in cab] + [pa.field('celdas_especiales', pa.string())]
    tabla = pa.table({**{c: pa.array([float(x) if (c in decimal and x is not None) else x for x in cols[c]], tipo(c)) for c in cab}, 'celdas_especiales': pa.array(esp_col, pa.string())}, schema=pa.schema(campos))
    PARQ.mkdir(exist_ok=True); p = PARQ / f'ageb_mza_{i:02d}.parquet'; pq.write_table(tabla, p, compression='zstd')
    clave = f'censo2020/ageb_manzana/ageb_mza_{i:02d}.parquet'
    for intento in range(3):
        out = subprocess.run(['npx', 'wrangler', 'r2', 'object', 'put', f'{BUCKET}/{clave}', '--remote', '--file', str(p), '--content-type', 'application/vnd.apache.parquet'], cwd=RAIZ, capture_output=True, text=True)
        if out.returncode == 0 and 'Upload complete' in out.stdout + out.stderr: break
        time.sleep(5)
    else: raise RuntimeError(f'subida falló {clave}: {(out.stdout + out.stderr)[-200:]}')
    reg = {'entidad': f'{i:02d}', 'filas': n, 'columnas': 231, 'columnas_decimales': sorted(decimal), 'bytes_parquet': p.stat().st_size, 'clave_r2': clave, 'celdas_confidenciales': n_esp['*'], 'celdas_nd': n_esp['N/D'], 'celdas_na': n_esp['N/A'], 'ok': True, 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    with open(MANIF, 'a') as f: f.write(json.dumps(reg) + '\n')
    print(f"{time.strftime('%H:%M:%S')} {i:02d}: {n} filas, {p.stat().st_size/1e6:.1f} MB, '*' {n_esp['*']:,}, N/D {n_esp['N/D']:,}, N/A {n_esp['N/A']:,}", flush=True)
    return reg

def main():
    tk = token()
    hechos = {int(json.loads(l)['entidad']): json.loads(l) for l in open(MANIF)} if MANIF.exists() else {}
    regs = [procesar(i, hechos) for i in range(1, 33)]
    ya = remotos(tk)
    ok = sum(1 for r in regs if ya.get(r['clave_r2']) == r['bytes_parquet'])
    print(f"verificación remota: {ok}/32 claves con el tamaño del manifiesto; filas totales {sum(r['filas'] for r in regs):,}; {sum(r['bytes_parquet'] for r in regs)/1e6:.0f} MB. FIN", flush=True)

if __name__ == '__main__': main()

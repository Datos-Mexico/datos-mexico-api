"""Construye el catálogo consultable de los datos abiertos del INEGI ingeridos (microdatos en Parquet y
tabulados archivados) a partir de los manifiestos de todas las máquinas (data/inegi/manifiesto-*.jsonl y
tabulados-*.jsonl) y lo carga en la D1 datosmexico-api-bise (tablas da_microdatos, da_tabulados,
da_programas). Cada corrida reemplaza las tablas completas (los manifiestos son la fuente de verdad) y
verifica los conteos remotos. También calcula la cobertura contra el inventario (archivos.csv).
Uso: python3 scripts/inegi_catalogo_d1.py
"""
import csv, glob, json, pathlib, subprocess, sys
RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data' / 'inegi'; OUT = RAIZ / 'data' / 'bise' / 'neon-export'
csv.field_size_limit(1 << 30)
import base64, gzip as _gz
def esquema_txt(e):
    """JSON del esquema; si rebasa 60 KB (tablas de miles de columnas) se guarda gzip+base64 con prefijo gz: (D1 limita cada sentencia a 100 KB)."""
    j = json.dumps(e, ensure_ascii=False, separators=(',', ':'))
    return j if len(j) <= 60000 else 'gz:' + base64.b64encode(_gz.compress(j.encode('utf-8'), 9)).decode()
def cargar(patron):
    """Una fila por clave R2 (la más reciente); si dos ids distintos apuntan a la misma clave se avisa."""
    # 1) una versión por unidad lógica (id+tabla en microdatos, id+formato en tabulados): la más reciente
    por_unidad = {}
    for f in sorted(glob.glob(str(DIR / patron))):
        for l in open(f, encoding='utf-8'):
            if not l.strip(): continue
            r = json.loads(l)
            if r.get('estado') != 'ok': continue
            u = (r['id'], r.get('tabla') or r.get('formato'))
            if u not in por_unidad or r['ts'] >= por_unidad[u]['ts']: por_unidad[u] = r
    # 2) una fila por clave R2
    regs = {}; ids_por_clave = {}
    for r in por_unidad.values():
        k = r['clave_r2']; ids_por_clave.setdefault(k, set()).add(r['id'])
        if k not in regs or r['ts'] >= regs[k]['ts']: regs[k] = r
    col = {k: v for k, v in ids_por_clave.items() if len(v) > 1}
    if col: print(f'AVISO {patron}: {len(col)} claves con más de un id de origen (se conserva la más reciente): {list(col.items())[:3]}')
    return list(regs.values())
def main():
    micro = cargar('manifiesto-*.jsonl'); tab = cargar('tabulados-*.jsonl')
    inv = list(csv.DictReader(open(RAIZ / 'data' / 'inegi-universo' / 'archivos.csv', encoding='utf-8')))
    extra = DIR / 'fuera-descarga-masiva.csv'  # archivos fuera de la descarga masiva (páginas de programas, INSP): cuentan en el universo
    if extra.exists(): inv += [{'clasificacion': 'microdatos', 'programa': r['programa'], 'titulo': r['titulo'], 'formato': r['formato'], 'id': r['id'], 'extra': '1'} for r in csv.DictReader(open(extra, encoding='utf-8')) if r['es_datos'] == '1']
    NUL = '\\N'
    with open(OUT / 'da_microdatos.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['id_inegi', 'programa', 'programa_slug', 'edicion', 'titulo', 'archivo', 'tabla', 'origen', 'formato', 'codificacion', 'filas', 'columnas', 'esquema', 'bytes_parquet', 'clave_r2', 'fuente_r2', 'url_inegi', 'sha256_zip', 'maquina', 'ingerido_en'])
        for r in sorted(micro, key=lambda r: (r['programa_slug'], r['edicion'], r['archivo'], r['tabla'])):
            w.writerow([r['id'], r['programa'], r['programa_slug'], r['edicion'], r['titulo'], r['archivo'], r['tabla'], r['origen'], r['formato'], r.get('codificacion') or NUL, r['filas'], r['columnas'], esquema_txt(r.get('esquema') or []), r['bytes_parquet'], r['clave_r2'], r['fuente_r2'], r['url'], r['sha256_zip'], r['maquina'], r['ts']])
    with open(OUT / 'da_tabulados.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['id_inegi', 'programa', 'programa_slug', 'edicion', 'titulo', 'formato', 'bytes', 'sha256', 'clave_r2', 'url_inegi', 'maquina', 'ingerido_en'])
        for r in sorted(tab, key=lambda r: (r['programa_slug'], r['edicion'], r['titulo'])):
            w.writerow([r['id'], r['programa'], r['programa_slug'], r['edicion'], r['titulo'], r['formato'], r['bytes'], r['sha256'], r['clave_r2'], r['url'], r['maquina'], r['ts']])
    # programas: universo del inventario vs ingerido
    sys.path.insert(0, str(RAIZ / 'scripts')); import inegi_ingesta as g
    univ_m = {}; univ_t = {}
    for x in inv:
        d = univ_m if x['clasificacion'] == 'microdatos' else univ_t
        if x['clasificacion'] == 'microdatos' and not x.get('extra') and (x['formato'] not in g.PREF or g.NO_DATOS.search(x['titulo'])): continue
        d.setdefault(x['programa'], set()).add(x['id'] + (x['formato'] if x['clasificacion'] == 'tabulados' else ''))
    ing_m = {}; ing_t = {}
    for r in micro: ing_m.setdefault(r['programa'], {}).setdefault(r['id'], 0); ing_m[r['programa']][r['id']] += r['filas']
    for r in tab: ing_t.setdefault(r['programa'], set()).add(r['id'] + r['formato'])
    with open(OUT / 'da_programas.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['programa', 'programa_slug', 'microdatos_universo', 'microdatos_ingeridos', 'filas_microdatos', 'tabulados_universo', 'tabulados_ingeridos'])
        for p in sorted(set(univ_m) | set(univ_t) | set(ing_m) | set(ing_t)):
            w.writerow([p, g.slug(p), len(univ_m.get(p, ())), len(ing_m.get(p, {})), sum(ing_m.get(p, {}).values()), len(univ_t.get(p, ())), len(ing_t.get(p, ()))])
    print(f'microdatos: {len(micro)} tablas de {len({r["id"] for r in micro})} archivos ({sum(r["filas"] for r in micro):,} filas) | tabulados: {len(tab)} archivos | programas: {len(set(univ_m)|set(univ_t)|set(ing_m)|set(ing_t))}')
    ddl = '''CREATE TABLE IF NOT EXISTS da_microdatos (
  id_inegi TEXT NOT NULL, programa TEXT NOT NULL, programa_slug TEXT NOT NULL, edicion TEXT NOT NULL, titulo TEXT, archivo TEXT NOT NULL, tabla TEXT NOT NULL, origen TEXT, formato TEXT, codificacion TEXT,
  filas INTEGER NOT NULL, columnas INTEGER NOT NULL, esquema TEXT NOT NULL, bytes_parquet INTEGER NOT NULL, clave_r2 TEXT NOT NULL, fuente_r2 TEXT, url_inegi TEXT, sha256_zip TEXT, maquina TEXT, ingerido_en TEXT,
  PRIMARY KEY (clave_r2)
);
CREATE INDEX IF NOT EXISTS idx_da_micro_prog ON da_microdatos (programa_slug, edicion);
CREATE TABLE IF NOT EXISTS da_tabulados (
  id_inegi TEXT NOT NULL, programa TEXT NOT NULL, programa_slug TEXT NOT NULL, edicion TEXT NOT NULL, titulo TEXT, formato TEXT, bytes INTEGER, sha256 TEXT, clave_r2 TEXT NOT NULL, url_inegi TEXT, maquina TEXT, ingerido_en TEXT,
  PRIMARY KEY (clave_r2)
);
CREATE INDEX IF NOT EXISTS idx_da_tab_prog ON da_tabulados (programa_slug, edicion);
CREATE TABLE IF NOT EXISTS da_programas (
  programa TEXT PRIMARY KEY, programa_slug TEXT NOT NULL, microdatos_universo INTEGER, microdatos_ingeridos INTEGER, filas_microdatos INTEGER, tabulados_universo INTEGER, tabulados_ingeridos INTEGER
);
'''
    (RAIZ / 'data' / 'bise' / 'schema_da.sqlite.sql').write_text(ddl)
    # cargar: DDL, vaciar y llenar con csv_a_sql (usa el esquema de bise; se anexa el DDL de forma temporal)
    esquema = RAIZ / 'data' / 'bise' / 'schema.sqlite.sql'; orig = esquema.read_text()
    if 'da_microdatos' not in orig: esquema.write_text(orig + '\n' + ddl)
    subprocess.run(['python3', 'scripts/csv_a_sql.py', 'bise'], cwd=RAIZ, check=True, capture_output=True)
    subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'datosmexico-api-bise', '--remote', '--yes', '--file', str(RAIZ / 'data' / 'bise' / 'schema_da.sqlite.sql')], cwd=RAIZ, check=True, capture_output=True)
    subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'datosmexico-api-bise', '--remote', '--yes', '--command', 'DELETE FROM da_microdatos; DELETE FROM da_tabulados; DELETE FROM da_programas;'], cwd=RAIZ, check=True, capture_output=True)
    r = subprocess.run(['zsh', 'scripts/cargar_d1.sh', 'bise', 'da_programas', 'da_tabulados', 'da_microdatos'], cwd=RAIZ, capture_output=True, text=True)
    print('\n'.join(l for l in r.stdout.splitlines() if l.startswith(('0', '1', '2')) and 'da_' in l))
if __name__ == '__main__': main()

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
def cargar(patron):
    regs = {}
    for f in sorted(glob.glob(str(DIR / patron))):
        for l in open(f, encoding='utf-8'):
            if not l.strip(): continue
            r = json.loads(l)
            if r.get('estado') != 'ok': continue
            k = (r['id'], r.get('tabla') or r.get('formato')); regs[k] = r  # última versión gana
    return list(regs.values())
def main():
    micro = cargar('manifiesto-*.jsonl'); tab = cargar('tabulados-*.jsonl')
    inv = list(csv.DictReader(open(RAIZ / 'data' / 'inegi-universo' / 'archivos.csv', encoding='utf-8')))
    NUL = '\\N'
    with open(OUT / 'da_microdatos.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['id_inegi', 'programa', 'programa_slug', 'edicion', 'titulo', 'archivo', 'tabla', 'origen', 'formato', 'codificacion', 'filas', 'columnas', 'esquema', 'bytes_parquet', 'clave_r2', 'fuente_r2', 'url_inegi', 'sha256_zip', 'maquina', 'ingerido_en'])
        for r in sorted(micro, key=lambda r: (r['programa_slug'], r['edicion'], r['archivo'], r['tabla'])):
            w.writerow([r['id'], r['programa'], r['programa_slug'], r['edicion'], r['titulo'], r['archivo'], r['tabla'], r['origen'], r['formato'], r.get('codificacion') or NUL, r['filas'], r['columnas'], json.dumps(r.get('esquema') or [], ensure_ascii=False), r['bytes_parquet'], r['clave_r2'], r['fuente_r2'], r['url'], r['sha256_zip'], r['maquina'], r['ts']])
    with open(OUT / 'da_tabulados.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['id_inegi', 'programa', 'programa_slug', 'edicion', 'titulo', 'formato', 'bytes', 'sha256', 'clave_r2', 'url_inegi', 'maquina', 'ingerido_en'])
        for r in sorted(tab, key=lambda r: (r['programa_slug'], r['edicion'], r['titulo'])):
            w.writerow([r['id'], r['programa'], r['programa_slug'], r['edicion'], r['titulo'], r['formato'], r['bytes'], r['sha256'], r['clave_r2'], r['url'], r['maquina'], r['ts']])
    # programas: universo del inventario vs ingerido
    sys.path.insert(0, str(RAIZ / 'scripts')); import inegi_ingesta as g
    univ_m = {}; univ_t = {}
    for x in inv:
        d = univ_m if x['clasificacion'] == 'microdatos' else univ_t
        if x['clasificacion'] == 'microdatos' and (x['formato'] not in g.PREF or g.NO_DATOS.search(x['titulo'])): continue
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

"""Convierte los CSV exportados de Neon (data/<schema>/neon-export/*.csv) en lotes INSERT para D1
(data/<schema>/sql/<tabla>.sql), en el orden de tablas del DDL generado.
\\N → NULL; t/f → 1/0; números tal cual; textos entre comillas simples con escape.
"""
import csv, sys, pathlib, re
RAIZ = pathlib.Path(__file__).resolve().parent.parent
NUM = re.compile(r'^-?\d+(\.\d+)?([eE][-+]?\d+)?$')
csv.field_size_limit(1 << 30)

def lit(v):
    if v == '\\N': return 'NULL'
    if v == 't': return '1'
    if v == 'f': return '0'
    if NUM.match(v): return v
    return "'" + v.replace("'", "''") + "'"

def main(schema, lote=500):
    base = RAIZ / f'data/{schema}'
    ddl = (base / 'schema.sqlite.sql').read_text(encoding='utf-8')
    orden = re.findall(r'^CREATE TABLE (\w+) \(', ddl, flags=re.M)
    (base / 'sql').mkdir(exist_ok=True)
    for t in orden:
        src = base / 'neon-export' / f'{t}.csv'
        if not src.exists(): print(f"  (sin CSV) {t}"); continue
        n = 0
        with open(src, newline='', encoding='utf-8') as f, open(base / 'sql' / f'{t}.sql', 'w', encoding='utf-8') as o:
            r = csv.reader(f); cols = next(r); chunk = []
            for row in r:
                chunk.append("(" + ",".join(lit(v) for v in row) + ")"); n += 1
                if len(chunk) == lote:
                    o.write(f"INSERT INTO {t} ({','.join(cols)}) VALUES\n" + ",\n".join(chunk) + ";\n"); chunk = []
            if chunk: o.write(f"INSERT INTO {t} ({','.join(cols)}) VALUES\n" + ",\n".join(chunk) + ";\n")
        print(f"{n:>9} filas  {(base / 'sql' / f'{t}.sql').stat().st_size / 1e6:8.1f} MB  {t}")

if __name__ == '__main__': main(sys.argv[1])

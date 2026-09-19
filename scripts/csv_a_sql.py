"""Convierte los CSV exportados de Neon (data/<schema>/neon-export/*.csv) en lotes INSERT para D1
(data/<schema>/sql/<tabla>.sql), en el orden de tablas del DDL generado.
Cada INSERT lleva a lo sumo 500 filas y ~90 KB (D1 limita cada sentencia a 100 KB: SQLITE_TOOBIG).
\\N → NULL; t/f → 1/0; números tal cual; textos entre comillas simples con escape.
"""
import csv, sys, pathlib, re
RAIZ = pathlib.Path(__file__).resolve().parent.parent
NUM = re.compile(r'^-?\d+(\.\d+)?([eE][-+]?\d+)?$')
csv.field_size_limit(1 << 30)

def lit(v, es_texto=False):
    """Literal SQL. Las columnas TEXT se citan SIEMPRE (un '09' o un folio '0100003201' deben
    conservar sus ceros a la izquierda: sin comillas SQLite los guardaría como 9 y 100003201)."""
    if v == '\\N': return 'NULL'
    if es_texto: return "'" + v.replace("'", "''") + "'"
    if v == 't': return '1'
    if v == 'f': return '0'
    if NUM.match(v): return v
    return "'" + v.replace("'", "''") + "'"

def tipos_ddl(ddl):
    """tabla → {columna: tipo} leído del DDL generado."""
    tipos = {}
    for m in re.finditer(r'CREATE TABLE (?:IF NOT EXISTS )?(\w+) \((.*?)\n\);', ddl, flags=re.S):
        cols = {}
        for line in m.group(2).splitlines():
            mm = re.match(r'\s+(\w+) (TEXT|INTEGER|REAL)\b', line)
            if mm: cols[mm.group(1)] = mm.group(2)
        tipos[m.group(1)] = cols
    return tipos

def main(schema, lote=500, max_bytes=90_000):
    base = RAIZ / f'data/{schema}'
    ddl = (base / 'schema.sqlite.sql').read_text(encoding='utf-8')
    orden = re.findall(r'^CREATE TABLE (?:IF NOT EXISTS )?(\w+) \(', ddl, flags=re.M)
    tipos = tipos_ddl(ddl)
    import json
    particiones = json.loads((base / 'particiones.json').read_text(encoding='utf-8')) if (base / 'particiones.json').exists() else {}
    # tabla física → (csv de origen, columnas a tomar)
    origen = {}
    for t_orig, partes in particiones.items():
        for p in partes: origen[p['tabla']] = (t_orig, p['columnas'])
    (base / 'sql').mkdir(exist_ok=True)
    for t in orden:
        t_csv, sub = origen.get(t, (t, None))
        src = base / 'neon-export' / f'{t_csv}.csv'
        if not src.exists(): print(f"  (sin CSV) {t}"); continue
        n = 0
        with open(src, newline='', encoding='utf-8') as f, open(base / 'sql' / f'{t}.sql', 'w', encoding='utf-8') as o:
            r = csv.reader(f); todas = next(r); chunk = []
            idx = [todas.index(c) for c in sub] if sub else list(range(len(todas)))
            cols = [todas[i] for i in idx]
            texto = [tipos.get(t, {}).get(c) == 'TEXT' for c in cols]
            lote_t = max(20, min(lote, 5000 // max(1, len(cols))))  # tablas anchas: menos filas por sentencia (D1: SQLITE_NOMEM)
            for row in r:
                chunk.append("(" + ",".join(lit(row[i], texto[k]) for k, i in enumerate(idx)) + ")"); n += 1
                if len(chunk) == lote_t or sum(len(x) for x in chunk) > max_bytes:
                    o.write(f"INSERT INTO {t} ({','.join(cols)}) VALUES\n" + ",\n".join(chunk) + ";\n"); chunk = []
            if chunk: o.write(f"INSERT INTO {t} ({','.join(cols)}) VALUES\n" + ",\n".join(chunk) + ";\n")
        print(f"{n:>9} filas  {(base / 'sql' / f'{t}.sql').stat().st_size / 1e6:8.1f} MB  {t}")

if __name__ == '__main__': main(sys.argv[1])

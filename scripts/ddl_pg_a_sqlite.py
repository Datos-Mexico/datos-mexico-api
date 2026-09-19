"""Traduce el esquema Postgres de un schema del legacy (docs/legacy/<schema>-postgres-schema.md)
a DDL de SQLite/D1 (data/<schema>/schema.sqlite.sql).

Reglas: integer/bigint/smallint → INTEGER · numeric/double/real → REAL · boolean → INTEGER 0/1 ·
date/timestamp → TEXT ISO · todo lo demás → TEXT. Se conservan PK, UNIQUE, FK y CHECK (traducidos).
Las tablas se ordenan por dependencias de FK. Vistas y vistas materializadas se listan como
comentarios al final: se resuelven a mano según el uso que les den los endpoints.
"""
import re, sys, pathlib, collections
RAIZ = pathlib.Path(__file__).resolve().parent.parent
MAX_COLS = 100  # límite de D1 (SQLITE_MAX_COLUMN)
# Columnas que deben quedar en la primera parte de una tabla partida (las que usan los endpoints).
PRIORIDAD = {
    'enigh': {
        'concentradohogar': ['ubica_geo', 'factor', 'ing_cor', 'gasto_mon', 'decil', 'alimentos', 'transporte', 'educa_espa', 'vivienda', 'personales', 'limpieza', 'vesti_calz', 'salud', 'transf_gas'],
        'hogares': ['entidad', 'factor'],
        'poblacion': ['sexo', 'edad', 'entidad', 'factor'],
        'noagro': ['ventas_tri', 'ing_tri'],
    }
}

def sqlt(ty):
    ty = ty.lower()
    if ty.startswith(('integer', 'smallint', 'bigint')): return 'INTEGER'
    if ty.startswith(('numeric', 'double', 'real')): return 'REAL'
    if ty.startswith('boolean'): return 'INTEGER'
    return 'TEXT'

def tr_check(defn):
    d = defn
    d = re.sub(r'::[\w.]+(\[\])?', '', d)  # quita todo cast de tipo (incluidos enums calificados como enoe.etapa_metodologica)
    d = re.sub(r'\(EXTRACT\(day FROM (\w+)\) = \(1\)\)', r"(substr(\1, 9, 2) = '01')", d)
    d = re.sub(r'\(\((\w+)\) = ANY \(\(ARRAY\[(.*?)\]\)\)\)', r'(\1 IN (\2))', d)
    d = re.sub(r'\((\w+) = ANY \(\(ARRAY\[(.*?)\]\)\)\)', r'(\1 IN (\2))', d)
    d = re.sub(r'SUBSTRING\((\w+) FROM (\d+) FOR (\d+)\)', r'substr(\1, \2, \3)', d)
    d = re.sub(r'\((-?\d+(?:\.\d+)?)\)', r'\1', d)
    d = re.sub(r"'(\d{4}-\d{2}-\d{2})'::date", r"'\1'", d)
    return d

def main(schema):
    src = RAIZ / f'docs/legacy/{schema}-postgres-schema.md'
    cols = collections.OrderedDict(); cons = collections.defaultdict(list); idx = []; vistas = []
    sec = None
    for line in open(src, encoding='utf-8'):
        line = line.rstrip('\n')
        if line.startswith(f'# {schema} — columnas'): sec = 'col'; continue
        if line.startswith(f'# {schema} — constraints'): sec = 'con'; continue
        if line.startswith(f'# {schema} — índices'): sec = 'idx'; continue
        if line.startswith(f'# {schema} — vistas materializadas'): sec = 'mv'; continue
        if line.startswith(f'# {schema} — vistas'): sec = 'view'; continue
        if line.startswith(f'# {schema} — conteos'): sec = 'cnt'; continue
        if not line.strip() or line.startswith('#'): continue
        if sec == 'col':
            t, c, ty, nul, df = [x.strip() for x in line.split(' | ', 4)]
            cols.setdefault(t, []).append((c, ty, nul, df))
        elif sec == 'con':
            t, name, defn = [x.strip() for x in line.split(' | ', 2)]
            cons[t.replace(f'{schema}.', '')].append((name, defn))
        elif sec == 'idx': idx.append(line.strip())
        elif sec in ('view', 'mv'): vistas.append((sec, line.strip()))
    # excluir vistas y vistas materializadas (aparecen en information_schema.columns con sus columnas)
    nombres_vistas = {v.split(' :: ')[0].strip() for _, v in vistas}
    for v in nombres_vistas: cols.pop(v, None)
    idx = [i for i in idx if not any(re.search(rf' ON \w+\.{re.escape(v)} ', i) for v in nombres_vistas)]
    # orden por dependencias FK
    deps = {t: set() for t in cols}
    for t, lst in cons.items():
        for name, defn in lst:
            m = re.search(r'REFERENCES (?:\w+\.)?(\w+)', defn)
            if m and defn.startswith('FOREIGN KEY') and m.group(1) in deps and m.group(1) != t: deps[t].add(m.group(1))
    orden = []; pend = list(cols)
    while pend:
        avance = False
        for t in list(pend):
            if deps[t] <= set(orden): orden.append(t); pend.remove(t); avance = True
        if not avance: raise SystemExit(f'ciclo de FK en {pend}')
    # partir tablas con más de MAX_COLS columnas: parte 1 = PK + prioritarias + resto; partes 2..n = PK + resto
    particiones = {}
    for t in list(cols):
        if len(cols[t]) <= MAX_COLS: continue
        pk = None
        for name, defn in cons.get(t, []):
            if defn.startswith('PRIMARY KEY'): pk = [c.strip() for c in re.search(r'\((.*)\)', defn).group(1).split(',')]
        if not pk: raise SystemExit(f'{t}: tabla ancha sin PK, no se puede partir')
        pri = PRIORIDAD.get(schema, {}).get(t, [])
        nombres = [c for c, *_ in cols[t]]
        resto = [c for c in nombres if c not in pk and c not in pri]
        orden_cols = pk + pri + resto
        capacidad = MAX_COLS - len(pk)
        partes = []; i = 0; libres = [c for c in orden_cols if c not in pk]
        while libres:
            partes.append(pk + libres[:capacidad]); libres = libres[capacidad:]
        por_nombre = {c: (c, ty, nul, df) for c, ty, nul, df in cols[t]}
        particiones[t] = []
        for k, parte in enumerate(partes):
            nombre = t if k == 0 else f"{t}_{k+1}"
            cols[nombre] = [por_nombre[c] for c in parte]
            if k > 0:
                cons[nombre] = [(f"{nombre}_pkey", f"PRIMARY KEY ({', '.join(pk)})")]
                deps[nombre] = set()
            particiones[t].append({'tabla': nombre, 'columnas': parte})
        orden.insert(orden.index(t) + 1, *[p['tabla'] for p in particiones[t][1:]])
    import json
    (RAIZ / f'data/{schema}').mkdir(parents=True, exist_ok=True)
    (RAIZ / f'data/{schema}/particiones.json').write_text(json.dumps(particiones, ensure_ascii=False, indent=1), encoding='utf-8')
    out = [f"-- Esquema {schema.upper()} para D1 (SQLite), traducido del esquema Postgres del legacy por scripts/ddl_pg_a_sqlite.py.",
           "-- Fechas como TEXT ISO (YYYY-MM-DD); numeric como REAL; boolean como INTEGER 0/1.", "PRAGMA foreign_keys = ON;", ""]
    for t in orden:
        lines = []; pk = None; fks = []; uniques = []; checks = []
        for name, defn in cons.get(t, []):
            if defn.startswith('PRIMARY KEY'): pk = defn
            elif defn.startswith('FOREIGN KEY'): fks.append(re.sub(rf'REFERENCES {schema}\.', 'REFERENCES ', defn))
            elif defn.startswith('UNIQUE'): uniques.append(defn)
            elif defn.startswith('CHECK'): checks.append((name, tr_check(defn)))
        for c, ty, nul, df in cols[t]:
            d = ''
            if df:
                if 'nextval' in df: d = ''
                elif df in ('true', 'false'): d = f" DEFAULT {1 if df == 'true' else 0}"
                elif df.startswith('now()') or 'CURRENT_TIMESTAMP' in df: d = " DEFAULT (datetime('now'))"
                else: d = f" DEFAULT {re.sub(r'::[a-z_ ]+(\[\])?', '', df)}"
            lines.append(f"  {c} {sqlt(ty)}{'' if nul == 'YES' else ' NOT NULL'}{d}")
        if pk: lines.append(f"  {pk}")
        for u in uniques: lines.append(f"  {u}")
        for fk in fks: lines.append(f"  {fk}")
        for name, ck in checks: lines.append(f"  CONSTRAINT {name} {ck}")
        out.append(f"CREATE TABLE IF NOT EXISTS {t} (\n" + ",\n".join(lines) + "\n);"); out.append("")
    for i in idx:
        m = re.match(r'CREATE (UNIQUE )?INDEX (\S+) ON \w+\.(\S+) USING (\w+) \((.*)\)(?: WHERE (.*))?$', i)
        if not m: out.append(f"-- índice no traducido: {i}"); continue
        if m.group(2).endswith('_pkey') or m.group(2).endswith('_key'): continue
        if m.group(4) != 'btree': out.append(f"-- índice {m.group(4)} omitido (no aplica en SQLite): {i}"); continue
        cols_i = re.sub(r' (varchar_pattern_ops|text_pattern_ops)', '', m.group(5))
        where = f" WHERE {tr_check(m.group(6))}" if m.group(6) else ""
        out.append(f"CREATE {m.group(1) or ''}INDEX IF NOT EXISTS {m.group(2)} ON {m.group(3)} ({cols_i}){where};")
    if vistas:
        out.append(""); out.append("-- Vistas del legacy (resolver a mano según los endpoints):")
        for k, v in vistas: out.append(f"-- [{k}] {v[:300]}")
    dst = RAIZ / f'data/{schema}/schema.sqlite.sql'; dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text("\n".join(out) + "\n", encoding='utf-8')
    print(f"{schema}: {len(orden)} tablas → {dst} ({len(out)} líneas); partidas: {list(particiones)}")

if __name__ == '__main__': main(sys.argv[1])

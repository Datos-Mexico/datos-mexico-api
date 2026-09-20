"""Censo de Población y Vivienda 2020 — Principales resultados por localidad (ITER) → CSV y DDL para D1.

Entrada: data/censo2020/iter_00_cpv2020_csv.zip (INEGI, datos abiertos, 4a edición): 195,662 filas
(nacional y 32 totales estatales con MUN=000, 2,469 totales municipales con LOC=0000, 3,662 totales de
localidades de una y dos viviendas con LOC=9998/9999 y 189,432 localidades) × 286 columnas.
Normalizaciones documentadas:
- Nombres de columna en minúsculas. Las 286 columnas se reparten en tres tablas por el límite de
  100 columnas de D1: `iter` (9 de identificación + 91 indicadores), `iter_2` y `iter_3` (llave
  entidad+mun+loc + el resto), igual que las tablas anchas de la ENIGH (particiones.json).
- Los indicadores se declaran NUMERIC: los números se guardan como números (los espacios a la
  izquierda que trae el INEGI se recortan) y los valores especiales del INEGI se conservan tal cual
  como texto: '*' (dato protegido por confidencialidad en localidades de una y dos viviendas) y
  'N/D' (no disponible). Vacío → NULL.
- El diccionario del INEGI numera dos veces las columnas 1-9 (las de identificación aparecen
  repetidas), así que la llave del diccionario es la columna, no el número.
- Longitud/latitud/altitud se conservan como texto en el formato del INEGI (grados, minutos,
  segundos).
Salida: data/censo2020/neon-export/iter.csv, iter_diccionario.csv, edicion.csv; DDL en
data/censo2020/schema.sqlite.sql y particiones.json.
Uso: python3 scripts/iter_a_csv.py
"""
import csv, io, json, pathlib, re, zipfile
from datetime import datetime, timezone
RAIZ = pathlib.Path(__file__).resolve().parent.parent
DIR = RAIZ / 'data' / 'censo2020'; OUT = DIR / 'neon-export'
NULO = '\\N'
csv.field_size_limit(1 << 30)

def main():
    OUT.mkdir(exist_ok=True)
    z = zipfile.ZipFile(DIR / 'iter_00_cpv2020_csv.zip')
    datos = [x for x in z.namelist() if 'conjunto_de_datos/' in x and x.endswith('.csv')][0]
    dic = [x for x in z.namelist() if 'diccionario' in x and x.endswith('.csv')][0]
    meta = [x for x in z.namelist() if 'metadatos' in x and x.endswith('.txt')][0]
    r = csv.reader(io.StringIO(z.read(datos).decode('utf-8-sig'))); cab = [c.strip().lower() for c in next(r)]
    assert len(cab) == 286 and cab[:9] == ['entidad', 'nom_ent', 'mun', 'nom_mun', 'loc', 'nom_loc', 'longitud', 'latitud', 'altitud'], cab[:9]
    n = 0; claves = set(); esp = {'*': 0, 'N/D': 0}
    with open(OUT / 'iter.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(cab)
        for fila in r:
            if not fila: continue
            assert len(fila) == 286, len(fila)
            fila = [v.strip() for v in fila]
            k = (fila[0], fila[2], fila[4]); assert k not in claves, k; claves.add(k)
            out = []
            for j, v in enumerate(fila):
                if v == '': out.append(NULO)
                elif j >= 9 and v in esp: esp[v] += 1; out.append(v)
                else: out.append(v)
            w.writerow(out); n += 1
    print(f'{n:>8} filas  iter  | celdas *: {esp["*"]:,} | N/D: {esp["N/D"]:,}')
    # diccionario
    filas_d = list(csv.reader(io.StringIO(z.read(dic).decode('utf-8-sig'))))
    ini = next(i for i, x in enumerate(filas_d) if x and x[0].strip() == 'Núm.')
    with open(OUT / 'iter_diccionario.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['num', 'indicador', 'descripcion', 'mnemonico', 'columna', 'rangos', 'longitud']); k = 0
        for x in filas_d[ini + 1:]:
            if not x or not x[0].strip().isdigit(): continue
            mn = x[3].strip(); w.writerow([x[0].strip(), x[1].strip(), x[2].strip(), mn, mn.lower(), x[4].strip() or NULO, x[5].strip() or NULO]); k += 1
    print(f'{k:>8} entradas del diccionario')
    m = z.read(meta).decode('utf-8', 'replace')
    t = re.search(r'^title:\s*(.+)$', m, flags=re.M | re.I)
    with open(OUT / 'edicion.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['clave', 'valor'])
        w.writerow(['titulo', t.group(1).strip() if t else NULO]); w.writerow(['producto', 'ITER 2020, 4a edición (datos abiertos)'])
        w.writerow(['fuente_url', 'https://www.inegi.org.mx/programas/ccpv/2020/#datos_abiertos']); w.writerow(['n_filas', str(n)])
        w.writerow(['descargado_en', datetime.now(timezone.utc).isoformat(timespec='seconds')])
    # DDL y particiones
    base = cab[:9]; ind = cab[9:]; llave = ['entidad', 'mun', 'loc']
    partes = [('iter', base + ind[:91]), ('iter_2', llave + ind[91:188]), ('iter_3', llave + ind[188:])]
    assert sum(len(p[1]) - (9 if i == 0 else 3) for i, p in enumerate(partes)) == 277
    def tipo(c):
        if c in llave or c in ('nom_ent', 'nom_mun', 'nom_loc', 'longitud', 'latitud', 'altitud'): return 'TEXT'
        return 'NUMERIC'
    ddl = []
    for nombre, cols in partes:
        lineas = [f'  {c} {tipo(c)}' + (' NOT NULL' if c in llave else '') for c in cols]
        ddl.append(f'CREATE TABLE IF NOT EXISTS {nombre} (\n' + ',\n'.join(lineas) + ',\n  PRIMARY KEY (entidad, mun, loc)\n);')
    ddl.append('CREATE TABLE IF NOT EXISTS iter_diccionario (\n  num INTEGER,\n  indicador TEXT,\n  descripcion TEXT,\n  mnemonico TEXT,\n  columna TEXT PRIMARY KEY,\n  rangos TEXT,\n  longitud TEXT\n);')
    ddl.append('CREATE TABLE IF NOT EXISTS edicion (\n  clave TEXT PRIMARY KEY,\n  valor TEXT\n);')
    (DIR / 'schema.sqlite.sql').write_text('\n'.join(ddl) + '\n', encoding='utf-8')
    json.dump({'iter': [{'tabla': nombre, 'columnas': cols} for nombre, cols in partes]}, open(DIR / 'particiones.json', 'w'), indent=0)
    print('DDL y particiones escritos:', [(p[0], len(p[1])) for p in partes])

if __name__ == '__main__': main()

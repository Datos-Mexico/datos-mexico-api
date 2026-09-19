"""DENUE (Directorio Estadístico Nacional de Unidades Económicas) → CSV para D1.

Entrada: los 32 archivos de descarga masiva del INEGI (data/denue/masiva/denue_NN_csv.zip),
edición 05/2026, cada uno con conjunto_de_datos/denue_inegi_NN_.csv (latin-1, 42 columnas),
diccionario_de_datos/ y metadatos/. Salida en el formato que consumen csv_a_sql.py y cargar_d1.sh
(data/denue/neon-export/<tabla>.csv, UTF-8, \\N para nulos):
- unidades_economicas.csv: todas las filas de los 32 estados, mismas 42 columnas (tres nombres
  en minúsculas con guion bajo: tipo_cencom, nom_cencom, tipo_unieco); textos tal cual, con los
  espacios finales que trae el INEGI recortados; vacío → NULL; latitud/longitud numéricas.
- actividades.csv: catálogo SCIAN 2018 derivado (codigo_act, nombre_act, n_unidades).
- diccionario.csv: el diccionario de datos del INEGI, columna por columna.
- edicion.csv: título, descripción y fecha del diccionario tomados de los metadatos.
Verifica que cada estado tenga las mismas 42 columnas y que los id no se repitan.
Uso: python3 scripts/denue_a_csv.py
"""
import csv, io, pathlib, re, sys, zipfile, collections as C
from datetime import datetime, timezone
RAIZ = pathlib.Path(__file__).resolve().parent.parent
DIR = RAIZ / 'data' / 'denue'; MASIVA = DIR / 'masiva'; OUT = DIR / 'neon-export'
NULO = '\\N'
RENOMBRE = {'tipoCenCom': 'tipo_cencom', 'nom_CenCom': 'nom_cencom', 'tipoUniEco': 'tipo_unieco'}
csv.field_size_limit(1 << 30)

def nn(v):
    v = v.strip()
    return NULO if v == '' else v

def main():
    OUT.mkdir(exist_ok=True)
    ids = set(); cols_ref = None; n = 0; act = C.Counter(); nombres_act = {}
    dicc = None; meta = None
    with open(OUT / 'unidades_economicas.csv', 'w', newline='', encoding='utf-8') as fo:
        w = csv.writer(fo)
        for i in range(1, 33):
            # estados grandes vienen partidos en varios archivos (p. ej. denue_15_1_csv.zip, denue_15_2_csv.zip)
            zips = sorted(MASIVA.glob(f'denue_{i:02d}_csv.zip')) + sorted(MASIVA.glob(f'denue_{i:02d}_[0-9]_csv.zip'))
            assert zips, f'faltan archivos del estado {i:02d}'
            for zp in zips:
              z = zipfile.ZipFile(zp)
              datos = [x for x in z.namelist() if '/conjunto_de_datos/' in x and x.endswith('.csv')]
              assert len(datos) == 1, (zp.name, datos)
              txt = z.read(datos[0]).decode('latin-1')
              r = csv.reader(io.StringIO(txt)); cab = next(r)
              cab = [RENOMBRE.get(c, c) for c in cab]
              if cols_ref is None:
                  cols_ref = cab; w.writerow(cab)
                  idx_lat, idx_lon, idx_id, idx_act, idx_nact, idx_ent = (cab.index(c) for c in ('latitud', 'longitud', 'id', 'codigo_act', 'nombre_act', 'cve_ent'))
              assert cab == cols_ref, (i, cab)
              k = 0
              for fila in r:
                  if not fila: continue
                  assert len(fila) == len(cab), (i, len(fila))
                  fila = [nn(v) for v in fila]
                  assert fila[idx_ent] == f'{i:02d}', (i, fila[idx_ent])
                  id_ = int(fila[idx_id])
                  if id_ in ids: sys.exit(f'id repetido {id_} en estado {i:02d}')
                  ids.add(id_)
                  for j in (idx_lat, idx_lon):
                      if fila[j] != NULO: float(fila[j])
                  act[fila[idx_act]] += 1; nombres_act.setdefault(fila[idx_act], fila[idx_nact])
                  w.writerow(fila); k += 1; n += 1
              print(f'{k:>8} unidades  {zp.name}', flush=True)
            if dicc is None:
                d = [x for x in z.namelist() if 'diccionario' in x and x.endswith('.csv')][0]
                dicc = list(csv.reader(io.StringIO(z.read(d).decode('latin-1'))))
                m = [x for x in z.namelist() if 'metadatos' in x and x.endswith('.txt')][0]
                meta = z.read(m).decode('utf-8', 'replace')
    print(f'{n:>8} unidades  TOTAL')
    with open(OUT / 'actividades.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['codigo_act', 'nombre_act', 'n_unidades'])
        for c, k in sorted(act.items()): w.writerow([c, nombres_act[c], k])
    print(f'{len(act):>8} actividades')
    with open(OUT / 'diccionario.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['columna', 'columna_denue', 'tipo', 'longitud', 'descripcion']); k = 0
        for x in dicc[2:]:
            if not x or not x[0].strip(): continue
            w.writerow([RENOMBRE.get(x[0].strip(), x[0].strip()), x[1].strip() or NULO, x[2].strip(), x[3].strip() or NULO, x[4].strip()]); k += 1
    print(f'{k:>8} entradas del diccionario')
    fecha = re.search(r'DICCIONARIO DE DATOS DENUE \((\d\d/\d\d/\d{4})\)', dicc[0][0] if dicc else '')
    titulo = re.search(r'^Title:\s*(.+)$', meta, flags=re.M); desc = re.search(r'^Description:\s*(.+)$', meta, flags=re.M)
    with open(OUT / 'edicion.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['clave', 'valor'])
        w.writerow(['titulo', titulo.group(1).strip() if titulo else NULO]); w.writerow(['descripcion', desc.group(1).strip() if desc else NULO])
        w.writerow(['fecha_diccionario', fecha.group(1) if fecha else NULO]); w.writerow(['n_unidades', str(n)]); w.writerow(['n_estados', '32'])
        w.writerow(['fuente_url', 'https://www.inegi.org.mx/app/descarga/?ti=6'])
        w.writerow(['descargado_en', datetime.now(timezone.utc).isoformat(timespec='seconds')])

if __name__ == '__main__': main()

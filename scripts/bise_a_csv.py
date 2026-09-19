"""Convierte los catálogos y las respuestas crudas del INEGI (data/bise/crudo/*.json.gz,
data/bise/manifiesto.jsonl) en los CSV que consumen csv_a_sql.py y cargar_d1.sh
(data/bise/neon-export/<tabla>.csv, mismo formato que las exportaciones de Postgres:
\\N para NULL, cabecera con los nombres de columna del DDL).

Normalizaciones, todas documentadas aquí y en docs/BITACORA.md:
- COBER_GEO "0" (así responde el INEGI para el nacional) → "00".
- OBS_VALUE llega con 20 decimales ("9209944.00000000000000000000"): `valor` es el número y
  `valor_texto` el mismo decimal sin ceros a la derecha ("9209944"), exacto.
- OBS_VALUE nulo con OBS_EXCEPTION (p. ej. "NA") → valor NULL, se conserva la excepción.
- LASTUPDATE "21/10/2024 12:00:00 a. m." → `ultima_actualizacion` ISO 8601
  (2024-10-21T00:00:00) y el texto original en `ultima_actualizacion_texto`.
- Campos vacíos ("") del INEGI se guardan como NULL.
- El INEGI repite observaciones (misma clave indicador+geografía+periodo dos veces en la misma
  respuesta; en 2026-09-19 fueron 36,462 repeticiones en 300 indicadores, casi todas idénticas y
  el resto solo distintas en OBS_STATUS). Se conserva la primera aparición y cada repetición
  descartada se escribe en data/bise/duplicados.csv para auditoría.
Uso: python3 scripts/bise_a_csv.py
"""
import csv, gzip, json, pathlib, re, sys
from datetime import datetime

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DIR = RAIZ / 'data' / 'bise'
OUT = DIR / 'neon-export'
NULO = '\\N'

ENTIDADES = {
    '00': 'Estados Unidos Mexicanos', '01': 'Aguascalientes', '02': 'Baja California',
    '03': 'Baja California Sur', '04': 'Campeche', '05': 'Coahuila de Zaragoza', '06': 'Colima',
    '07': 'Chiapas', '08': 'Chihuahua', '09': 'Ciudad de México', '10': 'Durango',
    '11': 'Guanajuato', '12': 'Guerrero', '13': 'Hidalgo', '14': 'Jalisco', '15': 'México',
    '16': 'Michoacán de Ocampo', '17': 'Morelos', '18': 'Nayarit', '19': 'Nuevo León',
    '20': 'Oaxaca', '21': 'Puebla', '22': 'Querétaro', '23': 'Quintana Roo',
    '24': 'San Luis Potosí', '25': 'Sinaloa', '26': 'Sonora', '27': 'Tabasco',
    '28': 'Tamaulipas', '29': 'Tlaxcala', '30': 'Veracruz de Ignacio de la Llave',
    '31': 'Yucatán', '32': 'Zacatecas',
}

def nn(v):
    return NULO if v is None or v == '' else v

def valor_texto(v):
    if v is None: return None
    if '.' in v: v = v.rstrip('0').rstrip('.')
    return v if v not in ('', '-') else '0'

RE_FECHA = re.compile(r'^(\d{2})/(\d{2})/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (a|p)\. m\.$')
def fecha_iso(t):
    if not t: return None
    m = RE_FECHA.match(t.strip())
    if not m: return None
    d, mo, y, h, mi, s, ap = m.groups(); h = int(h) % 12 + (12 if ap == 'p' else 0)
    return f'{y}-{mo}-{d}T{h:02d}:{mi}:{s}'

def geo(g):
    return '00' if g in ('0', '00') else g

def escribir(nombre, cols, filas):
    with open(OUT / f'{nombre}.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(cols); n = 0
        for r in filas: w.writerow([nn(x) for x in r]); n += 1
    print(f'{n:>9} filas  {nombre}')

def catalogo(nombre_cl):
    d = json.load(open(DIR / 'catalogos' / f'{nombre_cl}.json'))['CODE']
    return [(x['value'], x.get('Description')) for x in d]

def main():
    OUT.mkdir(exist_ok=True)
    for tabla, cl in [('unidades', 'CL_UNIT'), ('frecuencias', 'CL_FREQ'), ('temas', 'CL_TOPIC'),
                      ('fuentes', 'CL_SOURCE'), ('notas', 'CL_NOTE'), ('multiplicadores', 'CL_UNIT_MULT')]:
        escribir(tabla, ['clave', 'descripcion'], catalogo(cl))
    escribir('geografias', ['clave', 'nombre', 'nivel'],
             [(k, v, 'nacional' if k == '00' else 'entidad') for k, v in ENTIDADES.items()])
    descripciones = dict(catalogo('CL_INDICATOR'))
    manifiesto = {}
    for l in open(DIR / 'manifiesto.jsonl'):
        if l.strip():
            m = json.loads(l); manifiesto[m['id']] = m
    faltan = [i for i in descripciones if i not in manifiesto]
    if faltan:
        sys.exit(f'{len(faltan)} indicadores del catálogo sin resolver en el manifiesto (p. ej. {faltan[:5]}); descarga incompleta')
    archivos = sorted({m['archivo'] for m in manifiesto.values() if m['archivo']})
    meta = {}
    n_obs = 0
    dup = open(DIR / 'duplicados.csv', 'w', newline='', encoding='utf-8'); wdup = csv.writer(dup)
    wdup.writerow(['indicador', 'geografia', 'periodo', 'valor_texto', 'excepcion', 'estatus', 'fuente', 'nota', 'archivo']); n_dup = 0
    with open(OUT / 'observaciones.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['indicador', 'geografia', 'periodo', 'valor', 'valor_texto', 'excepcion', 'estatus', 'fuente', 'nota'])
        vistos = set()
        for a in archivos:
            d = json.load(gzip.open(DIR / 'crudo' / a))
            for s in d['Series']:
                i = s['INDICADOR']
                # un indicador solo se toma del archivo que, según el manifiesto, lo resolvió
                if i in vistos or manifiesto.get(i, {}).get('archivo') != a: continue
                geos = set(); periodos = []; claves = set()
                for o in s['OBSERVATIONS']:
                    g = geo(o['COBER_GEO']); p = o['TIME_PERIOD']; v = o['OBS_VALUE']
                    vt = valor_texto(v)
                    if (g, p) in claves:
                        wdup.writerow([i, g, p, nn(vt), nn(o.get('OBS_EXCEPTION')), nn(o.get('OBS_STATUS')), nn(o.get('OBS_SOURCE')), nn(o.get('OBS_NOTE')), a]); n_dup += 1
                        continue
                    claves.add((g, p))
                    w.writerow([i, g, p, nn(vt), nn(vt), nn(o.get('OBS_EXCEPTION')), nn(o.get('OBS_STATUS')),
                                nn(o.get('OBS_SOURCE')), nn(o.get('OBS_NOTE'))])
                    geos.add(g); periodos.append(p); n_obs += 1
                meta[i] = dict(frecuencia=s.get('FREQ'), tema=s.get('TOPIC'), unidad=s.get('UNIT'),
                               multiplicador=s.get('UNIT_MULT'), nota=s.get('NOTE'), fuentes=s.get('SOURCE'),
                               ultima=s.get('LASTUPDATE'), estatus=s.get('STATUS'),
                               n=len(periodos), ng=len(geos),
                               primero=min(periodos) if periodos else None, ultimo=max(periodos) if periodos else None)
                vistos.add(i)
    dup.close()
    print(f'{n_obs:>9} filas  observaciones')
    print(f'{n_dup:>9} repeticiones descartadas (data/bise/duplicados.csv)')
    filas = []
    for i, desc in descripciones.items():
        m = manifiesto[i]; x = meta.get(i)
        if x:
            filas.append((i, desc, x['frecuencia'], x['tema'], x['unidad'], x['multiplicador'], x['nota'], x['fuentes'],
                          fecha_iso(x['ultima']), x['ultima'], x['estatus'], 1, x['n'], x['ng'], x['primero'], x['ultimo'], m['cuando']))
        else:
            filas.append((i, desc, None, None, None, None, None, None, None, None, None, 0, 0, 0, None, None, m['cuando']))
    escribir('indicadores', ['id', 'descripcion', 'frecuencia', 'tema', 'unidad', 'multiplicador', 'nota', 'fuentes',
                             'ultima_actualizacion', 'ultima_actualizacion_texto', 'estatus', 'con_datos',
                             'n_observaciones', 'n_geografias', 'primer_periodo', 'ultimo_periodo', 'descargado_en'], filas)

if __name__ == '__main__':
    main()

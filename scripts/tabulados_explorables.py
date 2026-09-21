"""Tabulados del INEGI como tablas explorables (exclusión 3 del traspaso): los cuadros publicados en Excel se leen tal cual y se
guardan en formato largo (una fila por celda numérica, con los valores de las dimensiones de la fila y el encabezado de la
columna), sin transformarlos, para consultarlos por la API y el explorador. Familias (un cubo por familia):
  censo2020       Censo de Población y Vivienda 2020, tabulados básicos nacional/estatal (cpv2020_b_eum_*.xlsx, R2)
  intercensal2015 Encuesta Intercensal 2015, tabulados con estimadores y precisión (*.xls, R2)
  censo2010       Censo 2010, tabulados básicos estatales (*_B_ESTATAL.xls: en R2 solo hay el PDF; el xls se baja del mismo sitio y se archiva)
  conteo2005      II Conteo 2005, tabulados básicos nacionales (Cont2005_NAL_*.xls, R2)
  csi-anual       Cuentas por sectores institucionales anuales 2003-2024 (CSI_*.xlsx, R2)
  csi-trimestral  Cuentas por sectores institucionales trimestrales 2008-2026 (CSIT_*.xlsx, R2)
Lectura: los cuadros de censos tienen título, un bloque de encabezados (dimensiones de la fila a la izquierda, encabezados de
columna agrupados a la derecha), una fila en blanco y las filas de datos; las cuentas tienen años/trimestres en columnas (cada
uno con Recursos/Pasivos y Usos/Activos) y conceptos jerárquicos en filas. Cada celda numérica del cuadro queda en tab_datos y el
conteo de celdas numéricas leídas debe ser igual al de la hoja (control de no pérdida); --verificar relee los archivos y compara
una muestra de celdas contra la API.
D1 datosmexico-api-tabulados: tab_familias, tab_cuadros (título, dimensiones y columnas de cada cuadro), tab_datos (largo).
Uso: data/.venv/bin/python scripts/tabulados_explorables.py --bajar --leer [--familias censo2020,csi-anual] [--cargar] [--verificar URL]
"""
import argparse, csv, glob, hashlib, io, json, os, pathlib, re, subprocess, sys, tempfile, time, urllib.request, collections as C
RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data' / 'tabulados'; DIR.mkdir(exist_ok=True); ARCH = DIR / 'archivos'; ARCH.mkdir(exist_ok=True)
DB = 'datosmexico-api-tabulados'; NDIM = 5
sys.path.insert(0, str(RAIZ / 'scripts'))
def log(m):
    with open(DIR / 'tabulados.log', 'a') as f: f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {m}\n")
    print(m, flush=True)

FAMILIAS = {
    'censo2020': {'nombre': 'Censo de Población y Vivienda 2020: tabulados básicos (nacional y estatal)', 'programa': 'censos-y-conteos-de-poblacion-y-vivienda', 'edicion': '2020', 'patron': r'cpv2020_b_eum_\d\d_.*\.xlsx$', 'fuente_url': 'https://www.inegi.org.mx/programas/ccpv/2020/#tabulados', 'lector': 'censo'},
    'intercensal2015': {'nombre': 'Encuesta Intercensal 2015: tabulados (estimadores y precisión)', 'programa': 'encuesta-intercensal', 'edicion': '2015', 'patron': r'\.xls$', 'fuente_url': 'https://www.inegi.org.mx/programas/intercensal/2015/#tabulados', 'lector': 'censo'},
    'censo2010': {'nombre': 'Censo de Población y Vivienda 2010: tabulados básicos estatales', 'programa': 'censos-y-conteos-de-poblacion-y-vivienda', 'edicion': '2010', 'patron': r'_\d\dB\d?_?\w*_ESTATAL\.pdf$', 'fuente_url': 'https://www.inegi.org.mx/programas/ccpv/2010/#tabulados', 'lector': 'censo', 'xls_del_sitio': True},
    'conteo2005': {'nombre': 'II Conteo de Población y Vivienda 2005: tabulados básicos nacionales', 'programa': 'censos-y-conteos-de-poblacion-y-vivienda', 'edicion': '2005', 'patron': r'Cont2005_NAL_.*\.xls$', 'fuente_url': 'https://www.inegi.org.mx/programas/ccpv/2005/#tabulados', 'lector': 'censo'},
    'csi-anual': {'nombre': 'Cuentas por sectores institucionales, anuales 2003-2024 (base 2018)', 'programa': 'cuentas-por-sectores-institucionales-anuales', 'edicion': '2003-2024', 'patron': r'CSI_\d+\.xlsx$', 'fuente_url': 'https://www.inegi.org.mx/programas/csi/', 'lector': 'csi'},
    'csi-trimestral': {'nombre': 'Cuentas por sectores institucionales, trimestrales 2008-2026 (base 2018)', 'programa': 'cuentas-por-sectores-institucionales-trimestrales', 'edicion': '2008_1T-2026_1T', 'patron': r'CSIT_\d+\.xlsx$', 'fuente_url': 'https://www.inegi.org.mx/programas/csi/', 'lector': 'csi'},
}

def manifiesto_r2():
    v = {}
    for fn in glob.glob(str(RAIZ / 'data' / 'inegi' / 'tabulados-*.jsonl')):
        for l in open(fn):
            if l.strip():
                x = json.loads(l)
                if x.get('estado') == 'ok': v[x['clave_r2']] = x
    return v

def archivos_de(fam):
    f = FAMILIAS[fam]; m = manifiesto_r2()
    xs = sorted((x for k, x in m.items() if x['programa_slug'] == f['programa'] and x['edicion'] == f['edicion'] and re.search(f['patron'], k.split('/')[-1])), key=lambda x: x['clave_r2'])
    return xs

def bajar(fams):
    """Trae a data/tabulados/archivos/<familia>/ los archivos de R2; para censo2010, baja el .xls del sitio del INEGI (misma URL que el PDF archivado) y lo archiva en R2."""
    import inegi_ingesta as ing
    for fam in fams:
        d = ARCH / fam; d.mkdir(exist_ok=True); n = 0
        for x in archivos_de(fam):
            nombre = x['clave_r2'].split('/')[-1]
            if FAMILIAS[fam].get('xls_del_sitio'):
                nombre = nombre[:-4] + '.xls'; ruta = d / nombre; clave = x['clave_r2'][:-4] + '.xls'
                if not ruta.exists():
                    url = x['url'][:-4] + '.xls'; datos = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=120).read()
                    if not datos.startswith(b'\xd0\xcf\x11\xe0'): log(f'{fam}: {url} no es xls'); continue
                    ruta.write_bytes(datos); ing.subir(clave, str(ruta), 'application/vnd.ms-excel')
                    with open(DIR / 'archivados.jsonl', 'a') as f: f.write(json.dumps({'familia': fam, 'clave_r2': clave, 'url': url, 'bytes': len(datos), 'sha256': hashlib.sha256(datos).hexdigest(), 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}) + '\n')
            else:
                ruta = d / nombre
                if not ruta.exists(): ing._s3().download_file(ing.BUCKET, x['clave_r2'], str(ruta))
            n += 1
        log(f'{fam}: {n} archivos en {d}')

# ---------- lectura de hojas (openpyxl / xlrd) como matrices de celdas ----------
def hojas(ruta):
    if ruta.suffix.lower() == '.xlsx':
        import openpyxl; wb = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
        for ws in wb.worksheets: yield ws.title, [list(r) for r in ws.iter_rows(values_only=True)]
    else:
        import xlrd; wb = xlrd.open_workbook(ruta)
        for ws in wb.sheets(): yield ws.name, [[(None if ws.cell_type(i, j) in (0, 6) else ws.cell_value(i, j)) for j in range(ws.ncols)] for i in range(ws.nrows)]

def es_num(v): return isinstance(v, (int, float)) and not isinstance(v, bool)
def texto(v): return '' if v is None else (str(v).strip() if not es_num(v) else (str(int(v)) if float(v).is_integer() else str(v)))
def limpio(s): return re.sub(r'\s+', ' ', s).strip()
def nota(s):
    """Quita la llamada a nota pegada al final de un encabezado ('Población total1', 'Población total /1', 'ISCED)1')."""
    return re.sub(r'\s*/\d$|(?<=[A-Za-záéíóúñÁÉÍÓÚÑ)%])\d$', '', s).strip()

def leer_censo(nombre_hoja, M, archivo):
    """Cuadro estándar del INEGI: título (primera fila con texto larga tras 'INEGI…' y 'Fecha…'), bloque de encabezados
    (1-3 filas contiguas con texto), fila en blanco, datos. Dimensiones = columnas cuyos valores en los datos son texto."""
    filas = [[None if (isinstance(c, str) and not c.strip()) else c for c in r] for r in M]
    ncol = max((len(r) for r in filas), default=0); filas = [r + [None] * (ncol - len(r)) for r in filas]
    # datos: filas con al menos un texto en las primeras columnas y al menos un número
    def es_dato(r): return any(es_num(c) for c in r) and any(isinstance(c, str) for c in r[:4])
    idx = [i for i, r in enumerate(filas) if es_dato(r)]
    if not idx: return None
    ini = idx[0]
    # el bloque de encabezados: filas no vacías inmediatamente antes de la fila en blanco previa a los datos
    j = ini - 1
    while j >= 0 and all(c is None for c in filas[j]): j -= 1
    fin_enc = j
    while j >= 0 and any(c is not None for c in filas[j]) and not es_dato(filas[j]): j -= 1  # el bloque puede traer subencabezados numéricos (0, 1, 2 hijos)
    enc = filas[j + 1:fin_enc + 1]
    if not enc: return None
    # columnas de dimensión: las de la izquierda cuyos valores son texto en las filas de datos
    datos = [filas[i] for i in range(ini, idx[-1] + 1) if any(c is not None for c in filas[i])]
    dims = []
    for c in range(ncol):
        vals = [r[c] for r in datos if r[c] is not None]
        if vals and all(isinstance(v, str) for v in vals) and c == len(dims): dims.append(c)
        else: break
    if not dims: return None
    # dentro del bloque de encabezados, la fila que nombra las dimensiones es la primera con texto en ≥ 2 columnas de dimensión
    # (o, con una sola dimensión, la primera con texto corto en la columna 0); lo anterior es título (2005 no deja fila en blanco)
    k0 = next((k for k, r in enumerate(enc) if sum(1 for c in dims if r[c] is not None) >= min(2, len(dims)) and (len(dims) >= 2 or len(texto(r[0])) < 45)), 0)
    titulo = ''
    for r in filas[:j + 1] + enc[:k0]:
        t = texto(r[0])
        if t and not t.startswith(('INEGI', 'Fecha de elaboración')) and len(t) > 12: titulo = (titulo + ' ' + t).strip() if titulo else t
    enc = enc[k0:]
    nombres_dim = [nota(limpio(' '.join(texto(r[c]) for r in enc if r[c] is not None))) or f'columna {c + 1}' for c in dims]
    # encabezados de las columnas de valores: una celda de grupo (fila superior) abarca hacia la derecha hasta el siguiente grupo,
    # y se hereda solo si la columna tiene subencabezado propio más abajo
    etiquetas = {}
    for c in range(len(dims), ncol):
        partes = []
        for k, r in enumerate(enc):
            v = r[c]
            if v is None and k < len(enc) - 1:
                cc = c
                while cc > dims[-1] and r[cc] is None: cc -= 1
                v = r[cc] if cc > dims[-1] and any(r2[c] is not None for r2 in enc[k + 1:]) else None
            if v is not None: partes.append(nota(limpio(texto(v))))
        etiquetas[c] = ' › '.join(p for p in partes if p)
    # filas: rellenar dimensiones hacia abajo cuando el cuadro deja la celda en blanco por repetición (no ocurre en 2020/2015, sí en algunos 2005/2010)
    salida = []; ult = [None] * len(dims); n_num = 0
    for r in datos:
        d = []
        for k, c in enumerate(dims):
            v = r[c]
            if v is None: v = ult[k]
            else: ult[k] = v
            d.append(limpio(texto(v)) if v is not None else '')
        for c in range(len(dims), ncol):
            v = r[c]
            if v is None: continue
            if es_num(v): salida.append((d, etiquetas[c] or f'columna {c + 1}', float(v), None)); n_num += 1
            else:
                t = limpio(texto(v))
                if t and c in etiquetas and etiquetas[c]: salida.append((d, etiquetas[c], None, t))
    # control de no pérdida: números en el bloque de datos
    esperados = sum(1 for r in datos for c in range(len(dims), ncol) if es_num(r[c]))
    if esperados != n_num: raise RuntimeError(f'{archivo} {nombre_hoja}: {n_num} números leídos de {esperados}')
    return {'titulo': limpio(titulo), 'dimensiones': nombres_dim, 'columnas': [etiquetas[c] for c in range(len(dims), ncol) if etiquetas[c]], 'celdas': salida, 'numeros': n_num}

def leer_csi(nombre_hoja, M, archivo):
    """Cuentas por sectores institucionales: fila 'Concepto' con el periodo mayor (año) abarcando varias columnas; debajo, filas de
    encabezado sin texto en la columna A: subperiodo (T1…T4, 6 Meses…; solo trimestrales), sector institucional (S.xx / C.0) y lado
    (Recursos/Pasivos, Usos/Activos). Conceptos con sangría (5 espacios por nivel) y código 'X.n - Nombre'."""
    filas = [[None if (isinstance(c, str) and not c.strip()) else c for c in r] for r in M]; ncol = max(len(r) for r in filas); filas = [r + [None] * (ncol - len(r)) for r in filas]
    ic = next((i for i, r in enumerate(filas) if isinstance(r[0], str) and r[0].strip() == 'Concepto'), None)
    if ic is None: return None
    titulo = limpio(' | '.join(texto(r[0]) for r in filas[:ic] if r[0] is not None and not texto(r[0]).startswith(('Instituto', 'Sistema de Cuentas'))))
    ini = ic + 1
    while ini < len(filas) and filas[ini][0] is None and any(c is not None for c in filas[ini]): ini += 1
    per = {c: [] for c in range(1, ncol)}; sector = {c: '' for c in range(1, ncol)}; lado = {c: '' for c in range(1, ncol)}
    for r in filas[ic:ini]:
        celdas = [limpio(texto(v)) for v in r[1:] if v is not None]
        if any(('Usos' in x or 'Recursos' in x) for x in celdas):
            for c in range(1, ncol): lado[c] = limpio(texto(r[c])) if r[c] is not None else ''
        elif any(re.match(r'^[SC]\.\d', x) for x in celdas):
            ult = ''
            for c in range(1, ncol):
                if r[c] is not None: ult = limpio(texto(r[c]))
                sector[c] = ult
        else:
            ult = None
            for c in range(1, ncol):
                if r[c] is not None: ult = limpio(texto(r[c]))
                if ult: per[c].append(ult)
    periodo = {c: ' '.join(per[c]) for c in range(1, ncol)}
    salida = []; pila = []; n_num = 0; esperados = 0
    for r in filas[ini:]:
        if r[0] is None: continue
        raw = re.sub(r'^_+[a-z]?', '', str(r[0])); nombre = raw.strip(); sang = (len(raw) - len(raw.lstrip(' '))) // 5
        if not nombre: continue
        if nombre.lower().startswith(('nota', 'fuente', 'p/', 'r/')) and not any(es_num(c) for c in r[1:]): continue
        pila = pila[:sang] + [nombre]
        m = re.match(r'^([A-Z]+\.?[\w.]*)\s+-\s+(.*)$', nombre); codigo = m.group(1) if m else ''; nom = m.group(2) if m else nombre
        cuenta = next((p for p in reversed(pila[:-1]) if re.match(r'^[IVX]+(\.\d+)*\s+-', p)), '')
        d = [cuenta, f'{codigo} - {nom}' if codigo else nom, '', '', str(sang)]
        for c in range(1, ncol):
            v = r[c]
            if v is None or not periodo.get(c): continue
            if es_num(v):
                esperados += 1; dd = list(d); dd[2] = lado[c]; dd[3] = sector[c]; salida.append((dd, periodo[c], float(v), None)); n_num += 1
    if n_num != esperados: raise RuntimeError(f'{archivo} {nombre_hoja}: {n_num} de {esperados}')
    return {'titulo': titulo, 'dimensiones': ['Cuenta', 'Concepto', 'Lado (recursos/usos)', 'Sector institucional', 'Nivel de sangría'], 'columnas': list(dict.fromkeys(periodo[c] for c in range(1, ncol) if periodo[c])), 'celdas': salida, 'numeros': n_num}

def leer(fams):
    """Lee todos los archivos de cada familia y escribe data/tabulados/<familia>.jsonl (un cuadro por línea) y <familia>.datos.csv (largo)."""
    for fam in fams:
        f = FAMILIAS[fam]; lector = leer_censo if f['lector'] == 'censo' else leer_csi; cuadros = []; n_celdas = 0; t0 = time.time()
        titulos_r2 = {x['clave_r2'].split('/')[-1]: x['titulo'] for x in archivos_de(fam)}
        with open(DIR / f'{fam}.datos.csv', 'w', newline='') as out:
            w = csv.writer(out)
            for ruta in sorted((ARCH / fam).iterdir()):
                if ruta.name.startswith('.') or ruta.suffix.lower() not in ('.xls', '.xlsx'): continue
                sha = hashlib.sha256(ruta.read_bytes()).hexdigest()
                for hoja, M in hojas(ruta):
                    if hoja.lower().startswith(('índice', 'indice', 'metainfo')) or not M: continue
                    r = lector(hoja, M, ruta.name)
                    if not r or not r['celdas']: continue
                    clave = f"{ruta.stem}:{hoja}" if f['lector'] == 'censo' and len(list(hojas(ruta))) > 1 else ruta.stem
                    clave = re.sub(r'[^A-Za-z0-9_.:-]', '_', clave)
                    if f['lector'] == 'csi': r['titulo'] = limpio(titulos_r2.get(ruta.name, '').replace('|', ' › ') + (' › ' + r['titulo'] if r['titulo'] else ''))
                    cuadros.append({'familia': fam, 'cuadro': clave, 'archivo': ruta.name, 'hoja': hoja, 'titulo': r['titulo'], 'dimensiones': r['dimensiones'], 'columnas': r['columnas'], 'celdas': len(r['celdas']), 'numeros': r['numeros'], 'sha256': sha})
                    for k, (d, col, val, txt) in enumerate(r['celdas']):
                        d = (d + [''] * NDIM)[:NDIM]; w.writerow([fam, clave, *d, col, '' if val is None else repr(val), txt or '', k]); n_celdas += 1
        (DIR / f'{fam}.cuadros.json').write_text(json.dumps(cuadros, ensure_ascii=False, indent=0))
        dims = C.Counter(len(c['dimensiones']) for c in cuadros)
        log(f"{fam}: {len(cuadros)} cuadros, {n_celdas:,} celdas ({sum(c['numeros'] for c in cuadros):,} numéricas), dimensiones por cuadro {dict(sorted(dims.items()))}, {time.time() - t0:.0f} s")
        if max(dims, default=0) > NDIM: raise RuntimeError(f'{fam}: cuadros con más de {NDIM} dimensiones')

def d1(sql, archivo=True):
    for intento in range(4):
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, dir=str(DIR)) as f: f.write(sql); ruta = f.name
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes'] + (['--file', ruta] if archivo else ['--json', '--command', sql]), capture_output=True, text=True, cwd=RAIZ); os.unlink(ruta)
        if r.returncode == 0: return None if archivo else json.loads(r.stdout)[0]['results']
        log(f'wrangler falló (intento {intento + 1}): {(r.stdout + r.stderr)[-300:].strip()}'); time.sleep(20 * (intento + 1))
    sys.exit('wrangler falló cuatro veces')
def q(v): return 'NULL' if v is None or v == '' else (str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'")
DDL = """CREATE TABLE IF NOT EXISTS tab_familias (familia TEXT PRIMARY KEY, nombre TEXT NOT NULL, programa TEXT NOT NULL, edicion TEXT NOT NULL, fuente_url TEXT NOT NULL, archivos INTEGER NOT NULL, cuadros INTEGER NOT NULL, celdas INTEGER NOT NULL, corte TEXT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS tab_cuadros (familia TEXT NOT NULL, cuadro TEXT NOT NULL, archivo TEXT NOT NULL, hoja TEXT NOT NULL, titulo TEXT NOT NULL, dimensiones TEXT NOT NULL, columnas TEXT NOT NULL, celdas INTEGER NOT NULL, sha256 TEXT NOT NULL, clave_r2 TEXT, PRIMARY KEY (familia, cuadro)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS tab_datos (familia TEXT NOT NULL, cuadro TEXT NOT NULL, d1 TEXT NOT NULL, d2 TEXT NOT NULL, d3 TEXT NOT NULL, d4 TEXT NOT NULL, d5 TEXT NOT NULL, columna TEXT NOT NULL, valor REAL, texto TEXT, orden INTEGER NOT NULL, PRIMARY KEY (familia, cuadro, orden)) WITHOUT ROWID;
"""

def cargar(fams):
    d1(DDL); m = manifiesto_r2(); extra = {json.loads(l)['clave_r2'].split('/')[-1]: json.loads(l)['clave_r2'] for l in open(DIR / 'archivados.jsonl') if l.strip()} if (DIR / 'archivados.jsonl').exists() else {}
    r2 = {k.split('/')[-1]: k for k in m}; r2.update(extra)
    for fam in fams:
        f = FAMILIAS[fam]; cuadros = json.loads((DIR / f'{fam}.cuadros.json').read_text())
        filas = list(csv.reader(open(DIR / f'{fam}.datos.csv', newline='')))
        if d1(f"SELECT COUNT(*) n FROM tab_datos WHERE familia = '{fam}'", archivo=False)[0]['n'] == len(filas): log(f'{fam}: ya cargada ({len(filas):,})')
        else:
            d1(f"DELETE FROM tab_datos WHERE familia = '{fam}';"); lote = []; tam = 0; st = ''
            def valores(r): return '(' + ','.join([q(r[0]), q(r[1]), q(r[2]) if r[2] else "''", q(r[3]) if r[3] else "''", q(r[4]) if r[4] else "''", q(r[5]) if r[5] else "''", q(r[6]) if r[6] else "''", q(r[7]), r[8] if r[8] else 'NULL', q(r[9]), r[10]]) + ')'
            for r in filas:  # sentencias de ≤ 60 KB (D1 rechaza las largas: SQLITE_TOOBIG) en archivos de ≤ 7 MB
                v = valores(r)
                if st and len(st) + len(v) > 60_000: lote.append(st + ';\n'); tam += len(st); st = ''
                st = (st + ',' + v) if st else 'INSERT INTO tab_datos VALUES ' + v
                if tam > 7_000_000: d1(''.join(lote)); lote = []; tam = 0
            if st: lote.append(st + ';\n')
            if lote: d1(''.join(lote))
            n = d1(f"SELECT COUNT(*) n FROM tab_datos WHERE familia = '{fam}'", archivo=False)[0]['n']
            if n != len(filas): sys.exit(f'{fam}: {n} ≠ {len(filas)}')
            log(f'{fam}: {n:,} celdas en D1')
        d1(f"DELETE FROM tab_cuadros WHERE familia = '{fam}';\n" + '\n'.join(f"INSERT INTO tab_cuadros VALUES ({q(fam)}, {q(c['cuadro'])}, {q(c['archivo'])}, {q(c['hoja'])}, {q(c['titulo'])}, {q(json.dumps(c['dimensiones'], ensure_ascii=False))}, {q(json.dumps(c['columnas'], ensure_ascii=False))}, {c['celdas']}, {q(c['sha256'])}, {q(r2.get(c['archivo']))});" for c in cuadros)
           + f"\nINSERT OR REPLACE INTO tab_familias VALUES ({q(fam)}, {q(f['nombre'])}, {q(f['programa'])}, {q(f['edicion'])}, {q(f['fuente_url'])}, {len({c['archivo'] for c in cuadros})}, {len(cuadros)}, {len(filas)}, {q(f['edicion'][-4:] if f['edicion'][-4:].isdigit() else f['edicion'])});")
        log(f'{fam}: {len(cuadros)} cuadros registrados')

def verificar(fams, base, n=40):
    """Muestra aleatoria de celdas leídas del Excel (data/tabulados/<familia>.datos.csv) contra la API: deben coincidir exactamente."""
    import random, urllib.parse; random.seed(7); fallos = 0
    for fam in fams:
        filas = list(csv.reader(open(DIR / f'{fam}.datos.csv', newline=''))); muestra = random.sample(filas, min(n, len(filas))); malas = 0
        for r in muestra:
            qs = '&'.join(f'{k}={urllib.parse.quote(v)}' for k, v in zip(('d1', 'd2', 'd3', 'd4', 'd5'), r[2:7])) + '&columna=' + urllib.parse.quote(r[7])
            u = f"{base}/api/v1/inegi/tabulados/{fam}/{urllib.parse.quote(r[1], safe='')}?{qs}"
            try: d = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={'accept': 'application/json', 'user-agent': 'curl/8.7.1 datosmexico-verificador'}), timeout=60).read())
            except Exception as e: malas += 1; log(f'{fam}: {u} → {e}'); continue
            esperado = float(r[8]) if r[8] else None; got = [x for x in d['items'] if x['orden'] == int(r[10])]
            if len(got) != 1 or (got[0]['valor'] != esperado and not (esperado is not None and got[0]['valor'] is not None and abs(got[0]['valor'] - esperado) < 1e-9)): malas += 1; log(f'{fam}: {r[1]} orden {r[10]} esperado {esperado} → {got}')
        fallos += malas; log(f'{fam}: {len(muestra)} celdas cotejadas contra {base}, {malas} diferencias')
    log(f'verificación: FALLOS {fallos}')
    if fallos: sys.exit(1)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--bajar', action='store_true'); ap.add_argument('--leer', action='store_true'); ap.add_argument('--cargar', action='store_true'); ap.add_argument('--familias', default=','.join(FAMILIAS)); ap.add_argument('--verificar', metavar='URL'); a = ap.parse_args()
    fams = a.familias.split(',')
    if a.bajar: bajar(fams)
    if a.leer: leer(fams)
    if a.cargar: cargar(fams)
    if a.verificar: verificar(fams, a.verificar.rstrip('/'))

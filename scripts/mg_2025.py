"""Marco Geoestadístico 2025 íntegro (exclusión 2 del traspaso): del zip nacional del INEGI (794551163061_s.zip, 2.9 GB,
32 zips estatales con 16 capas SHAPE cada uno; corte «actualización cartográfica base julio 2025») a
  - R2: el zip nacional y cada zip estatal tal cual (inegi/fuentes/marco-geoestadistico/2025/…), y un Parquet nacional por
    capa (mg/2025/<capa>.parquet: atributos + geometría WKB en el CRS original ITRF2008 / Cónica Conforme de Lambert, EPSG:6372)
    más los catálogos CSV que el INEGI incluye (mg/2025/catalogos/<archivo>.csv);
  - D1 datosmexico-api-censo2020: tablas mg_capas (catálogo de capas con conteos y claves R2) y mg_conteos (objetos por capa y entidad).
Verificación contra los totales nacionales que el INEGI declara en catalogos/contenido.txt del propio producto: 2,478 municipios,
51,766 polígonos de localidades amanzanadas, 291,933 puntos de localidades rurales, 367 polígonos insulares, 17,475 AGEB rurales,
64,808 AGEB urbanas y 2,634,771 manzanas (incluido caserío disperso). Si algo no cuadra, no se carga.
Uso: data/.venv/bin/python scripts/mg_2025.py [--procesar] [--subir] [--cargar]
"""
import argparse, csv, io, json, os, pathlib, re, subprocess, sys, tempfile, time, zipfile, collections as C
import concurrent.futures as cf
RAIZ = pathlib.Path(__file__).resolve().parent.parent; DIR = RAIZ / 'data' / 'mg'; ZIP = DIR / '794551163061_s.zip'; EST = DIR / 'estados'; CAPAS = DIR / 'capas'; CAT = DIR / 'catalogos'
DB = 'datosmexico-api-censo2020'; EDICION = '2025'; CLAVE_ZIP = 'inegi/fuentes/marco-geoestadistico/2025/794551163061_s.zip'
CAPA = {  # sufijo → (nombre, descripción del INEGI)
  'ent': ('Entidad federativa', 'Áreas geoestadísticas estatales'), 'mun': ('Municipio', 'Áreas geoestadísticas municipales'),
  'l': ('Localidad amanzanada', 'Polígonos de localidades urbanas y rurales amanzanadas'), 'lpr': ('Localidad rural puntual', 'Puntos de localidades rurales amanzanadas y no amanzanadas'),
  'a': ('AGEB urbana', 'Áreas geoestadísticas básicas urbanas'), 'ar': ('AGEB rural', 'Áreas geoestadísticas básicas rurales'),
  'm': ('Manzana', 'Manzanas urbanas y rurales'), 'cd': ('Caserío disperso', 'Caserío disperso (representación multipunto)'),
  'ti': ('Territorio insular', 'Polígonos de territorio insular (solo en los estados que lo tienen)'), 'pe': ('Polígono externo', 'Polígono externo de localidad'),
  'pem': ('Polígono externo de manzana', 'Polígono externo de manzana'), 'e': ('Eje de vialidad', 'Ejes de vialidad'), 'fm': ('Frente de manzana', 'Frentes de manzana'),
  'sia': ('Servicios (área)', 'Servicios e información complementaria de tipo área'), 'sil': ('Servicios (línea)', 'Servicios e información complementaria de tipo línea'), 'sip': ('Servicios (punto)', 'Servicios e información complementaria de tipo punto'),
}
PUBLICADO = {'mun': 2478, 'l': 51766, 'lpr': 291933, 'ti': 367, 'ar': 17475, 'a': 64808, 'm+cd': 2634771, 'ent': 32}
def log(m):
    with open(DIR / 'mg_2025.log', 'a') as f: f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {m}\n")
    print(m, flush=True)

def estado(nombre_zip):
    """Un zip estatal → Parquet por capa (data/mg/capas/<capa>/<ee>.parquet) y catálogos CSV; devuelve conteos por capa."""
    import pyogrio, pyarrow as pa, pyarrow.parquet as pq
    ee = nombre_zip[:2]; marca = CAPAS / f'{ee}.json'
    if marca.exists(): return json.loads(marca.read_text())
    z = zipfile.ZipFile(EST / nombre_zip); tmp = pathlib.Path(tempfile.mkdtemp(dir=str(DIR)))
    for n in z.namelist():
        if n.startswith('conjunto_de_datos/') and n.lower().endswith(('.shp', '.dbf', '.shx', '.prj', '.cpg')): (tmp / os.path.basename(n)).write_bytes(z.read(n))
        elif n.startswith('catalogos/') and n.lower().endswith('.csv'):
            (CAT / ee).mkdir(parents=True, exist_ok=True); (CAT / ee / os.path.basename(n)).write_bytes(z.read(n))
    conteos = {}
    for shp in sorted(tmp.glob('*.shp')):
        capa = shp.stem[2:]; assert capa in CAPA, shp.name
        info = pyogrio.read_info(str(shp)); tabla = pyogrio.read_arrow(str(shp))[1]  # (meta, pyarrow.Table) con la geometría en WKB
        geom = 'wkb_geometry' if 'wkb_geometry' in tabla.column_names else 'geometry'
        tabla = tabla.rename_columns([c.lower() if c != geom else 'geometria_wkb' for c in tabla.column_names])
        (CAPAS / capa).mkdir(parents=True, exist_ok=True); pq.write_table(tabla, CAPAS / capa / f'{ee}.parquet', compression='zstd')
        conteos[capa] = {'objetos': tabla.num_rows, 'geometria': info['geometry_type'], 'crs': str(info['crs'])[:60], 'campos': [c for c in tabla.column_names if c != 'geometria_wkb']}
    for f in tmp.iterdir(): f.unlink()
    tmp.rmdir(); marca.write_text(json.dumps(conteos, ensure_ascii=False)); return conteos

def procesar(procesos):
    EST.mkdir(exist_ok=True); CAPAS.mkdir(exist_ok=True); CAT.mkdir(exist_ok=True)
    z = zipfile.ZipFile(ZIP); nombres = sorted(n for n in z.namelist() if re.match(r'^\d{2}_.*\.zip$', n))  # 32 estatales; mg_2025_integrado.zip (capas nacionales) se archiva aparte
    assert len(nombres) == 32, nombres
    for n in nombres:
        if not (EST / n).exists() or (EST / n).stat().st_size != z.getinfo(n).file_size: (EST / n).write_bytes(z.read(n)); log(f'  extraído {n}')
    t0 = time.time(); total = C.Counter(); por_ent = {}
    with cf.ProcessPoolExecutor(procesos) as ex:
        for n, c in zip(nombres, ex.map(estado, nombres)):
            por_ent[n[:2]] = c; log(f'  {n[:2]}: ' + ', '.join(f'{k} {v["objetos"]:,}' for k, v in sorted(c.items())) + f' ({time.time() - t0:.0f} s)')
            for k, v in c.items(): total[k] += v['objetos']
    (DIR / 'conteos.json').write_text(json.dumps({'por_entidad': por_ent, 'total': dict(total)}, ensure_ascii=False, indent=1))
    log('totales: ' + ', '.join(f'{k} {v:,}' for k, v in sorted(total.items())))
    return verificar(total)

def verificar(total):
    ok = True
    for k, pub in PUBLICADO.items():
        obt = total.get('m', 0) + total.get('cd', 0) if k == 'm+cd' else total.get(k, 0)
        estado = 'ok' if obt == pub else f'DIFIERE {obt - pub:+,}'; log(f'  {k}: {obt:,} vs publicado {pub:,} → {estado}'); ok = ok and obt == pub
    return ok

def unir_capas():
    """Parquet nacional por capa (concatena los 32 estatales, mismo esquema) para descarga."""
    import pyarrow as pa, pyarrow.parquet as pq
    (CAPAS / 'nacional').mkdir(exist_ok=True); salida = {}
    for capa in CAPA:
        partes = sorted((CAPAS / capa).glob('[0-9][0-9].parquet'))
        if not partes: continue
        dest = CAPAS / 'nacional' / f'{capa}.parquet'
        if not dest.exists():
            escritor = None
            for p in partes:
                t = pq.read_table(p)
                if escritor is None: escritor = pq.ParquetWriter(dest.with_suffix('.tmp'), t.schema, compression='zstd')
                escritor.write_table(t)
            escritor.close(); dest.with_suffix('.tmp').rename(dest)
        salida[capa] = dest; log(f'  {capa}: {dest.stat().st_size / 1048576:.1f} MB, {len(partes)} estados')
    return salida

def subir():
    sys.path.insert(0, str(RAIZ / 'scripts')); import inegi_ingesta as ing
    reg = DIR / 'subidas.jsonl'; hechas = {json.loads(l)['clave']: json.loads(l) for l in open(reg) if l.strip()} if reg.exists() else {}
    def sube(clave, ruta, tipo):
        if clave in hechas and hechas[clave]['bytes'] == ruta.stat().st_size: return
        ing.subir(clave, str(ruta), tipo)
        with open(reg, 'a') as f: f.write(json.dumps({'clave': clave, 'bytes': ruta.stat().st_size}) + '\n')
        hechas[clave] = {'bytes': ruta.stat().st_size}; log(f'  subido {clave} ({ruta.stat().st_size / 1048576:.1f} MB)')
    for n in sorted(EST.glob('*.zip')): sube(f'inegi/fuentes/marco-geoestadistico/2025/estados/{n.name}', n, 'application/zip')
    for capa, ruta in unir_capas().items(): sube(f'mg/2025/{capa}.parquet', ruta, 'application/vnd.apache.parquet')
    # catálogos CSV del INEGI: uno nacional por archivo (concatenados por entidad, con columna cve_ent al frente)
    nombres = sorted({f.name for d in CAT.iterdir() if d.is_dir() for f in d.glob('*.csv')})
    (CAT / 'nacional').mkdir(exist_ok=True)
    for nombre in nombres:
        dest = CAT / 'nacional' / nombre
        with open(dest, 'w', newline='', encoding='utf-8') as fo:
            w = csv.writer(fo); cab = None
            for d in sorted(x for x in CAT.iterdir() if x.is_dir() and x.name != 'nacional'):
                f = d / nombre
                if not f.exists(): continue
                raw = f.read_bytes()
                try: txt = raw.decode('utf-8-sig')
                except UnicodeDecodeError: txt = raw.decode('latin-1')
                r = csv.reader(io.StringIO(txt)); c = next(r)
                if cab is None: cab = c; w.writerow(['cve_ent'] + c)
                for fila in r:
                    if fila: w.writerow([d.name] + fila)
        sube(f'mg/2025/catalogos/{nombre}', dest, 'text/csv')

def d1(sql, archivo=True):
    for intento in range(4):
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, dir=str(DIR)) as f: f.write(sql); ruta = f.name
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes'] + (['--file', ruta] if archivo else ['--json', '--command', sql]), capture_output=True, text=True, cwd=RAIZ); os.unlink(ruta)
        if r.returncode == 0: return None if archivo else json.loads(r.stdout)[0]['results']
        log(f'wrangler falló (intento {intento + 1}): {(r.stdout + r.stderr)[-300:].strip()}'); time.sleep(20 * (intento + 1))
    sys.exit('wrangler falló cuatro veces')
def q(v): return 'NULL' if v is None else (str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'")

def cargar():
    c = json.loads((DIR / 'conteos.json').read_text()); total = C.Counter(c['total'])
    if not verificar(total): sys.exit('no cuadra con los totales publicados por el INEGI: no se carga')
    sub = {json.loads(l)['clave']: json.loads(l) for l in open(DIR / 'subidas.jsonl') if l.strip()}
    d1("""CREATE TABLE IF NOT EXISTS mg_capas (edicion TEXT NOT NULL, capa TEXT NOT NULL, nombre TEXT NOT NULL, descripcion TEXT NOT NULL, geometria TEXT NOT NULL, crs TEXT NOT NULL, campos TEXT NOT NULL, entidades INTEGER NOT NULL, objetos INTEGER NOT NULL, publicado INTEGER, clave_parquet TEXT NOT NULL, bytes_parquet INTEGER NOT NULL, PRIMARY KEY (edicion, capa)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS mg_conteos (edicion TEXT NOT NULL, capa TEXT NOT NULL, cve_ent TEXT NOT NULL, objetos INTEGER NOT NULL, PRIMARY KEY (edicion, capa, cve_ent)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS mg_ediciones (edicion TEXT PRIMARY KEY, titulo TEXT NOT NULL, corte TEXT NOT NULL, fuente_url TEXT NOT NULL, clave_zip TEXT NOT NULL, bytes_zip INTEGER NOT NULL, verificacion TEXT NOT NULL) WITHOUT ROWID;""")
    filas_c = []; filas_k = []
    for capa, (nombre, desc) in CAPA.items():
        ents = [e for e, v in c['por_entidad'].items() if capa in v]
        if not ents: continue
        ej = c['por_entidad'][ents[0]][capa]; clave = f'mg/2025/{capa}.parquet'
        pub = PUBLICADO.get(capa) if capa != 'm' else None
        filas_c.append([EDICION, capa, nombre, desc, ej['geometria'], ej['crs'], json.dumps(ej['campos']), len(ents), total[capa], pub, clave, sub[clave]['bytes']])
        for e in ents: filas_k.append([EDICION, capa, e, c['por_entidad'][e][capa]['objetos']])
    d1(f"DELETE FROM mg_capas WHERE edicion = '{EDICION}'; DELETE FROM mg_conteos WHERE edicion = '{EDICION}';")
    d1('\n'.join(f"INSERT INTO mg_capas VALUES ({','.join(q(v) for v in f)});" for f in filas_c) + '\n' + '\n'.join(f"INSERT INTO mg_conteos VALUES ({','.join(q(v) for v in f)});" for f in filas_k))
    ver = {k: {'obtenido': (total.get('m', 0) + total.get('cd', 0)) if k == 'm+cd' else total.get(k, 0), 'publicado': v} for k, v in PUBLICADO.items()}
    d1(f"INSERT OR REPLACE INTO mg_ediciones VALUES ('{EDICION}', 'Marco Geoestadístico 2025 (versión por área geoestadística estatal)', '2025-07', 'https://www.inegi.org.mx/app/biblioteca/ficha.html?upc=794551163061', '{CLAVE_ZIP}', {ZIP.stat().st_size}, {q(json.dumps(ver))});")
    r = d1("SELECT COUNT(*) capas, SUM(objetos) objetos FROM mg_capas WHERE edicion = '2025'", archivo=False)[0]; log(f"D1: {r['capas']} capas, {r['objetos']:,} objetos")

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--procesar', action='store_true'); ap.add_argument('--subir', action='store_true'); ap.add_argument('--cargar', action='store_true'); ap.add_argument('--procesos', type=int, default=4); a = ap.parse_args()
    if a.procesar: procesar(a.procesos)
    if a.subir: subir()
    if a.cargar: cargar()

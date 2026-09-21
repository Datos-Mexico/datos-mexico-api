"""Recalcula los indicadores de la ENOE (nacionales, por entidad, ocupados por sector y por posición) para TODOS los
trimestres 2005T1-2026T2 a partir de los microdatos SDEM que publica el INEGI en su descarga masiva (los CSV convertidos a
Parquet en R2 por scripts/inegi_ingesta.py; catálogo en da_microdatos), los verifica contra el Banco de Indicadores del
INEGI y los carga en D1 (datosmexico-api-enoe).

Por qué se recalcula toda la serie y no solo los trimestres nuevos: la serie heredada (Neon, 2005T1-2025T1) se calculó
sobre DBF cargados con «ON CONFLICT DO NOTHING», que descartó filas repetidas en la llave (≈0.7 % de la población), y sin
acotar a 15 años o más los ocupados y desocupados. Con los CSV oficiales completos y el dominio 15+ en todos los
conteos, la PEA nacional de 2025T1 reproduce exactamente la cifra del INEGI (60,491,235) y los demás conteos quedan a
milésimas; la serie heredada estaba 0.7 % por debajo de forma uniforme.

Metodología (INEGI, Reconstrucción de variables ENOE 15+, 2023): estimador de razón con el factor trimestral
(fac_tri; fac en los archivos 2005T1-2020T1), dominio eda >= 15 en todos los conteos; población de 15 y más = PEA + PNEA
(clase1 IN (1, 2): así la publica el INEGI; las personas con edad no especificada y sin clasificar, clase1 = 0, quedan
fuera, y con ellas dentro la cifra difiere hasta 0.23 % en 559 de 2,805 comparaciones), PEA clase1 = 1, PNEA clase1 = 2,
ocupados clase2 = 1, desocupados clase2 = 2, subocupados sub_o = 1, condiciones críticas tcco IN (1,2,3), informales TIL1
según la sección 3.36 (tue2, pos_ocu, rama, seg_soc, remune2c). Sector: rama_est2 (0-11); posición: pos_ocu (1-4).
2020T2 no existe como ENOE (fue la ETOE telefónica): la serie queda con ese hueco, como la publica el INEGI.

Verificación: cada trimestre y geografía (nacional + 32 entidades) se compara con el Banco de Indicadores del INEGI:
pob_15ymas ↔ 6200093963, pea_total ↔ 6200093960, pnea_total ↔ 6200032077, ocupados_total ↔ 6200093954,
desocupados_total ↔ 6200093973. La diferencia relativa se guarda en bound_oficial / delta_rel_pct y en
data/enoe/recalculo/verificacion.csv; el resumen por indicador se imprime al final.

Uso: data/.venv/bin/python scripts/enoe_indicadores_inegi.py [--cargar] [--solo 2025T2,2025T3]
Reanudable: los Parquet descargados se conservan en data/enoe/sdem_inegi/ y los resultados por trimestre en
data/enoe/recalculo/trimestres/<periodo>.json.
"""
import argparse, csv, io, json, pathlib, re, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import inegi_ingesta as ing
import numpy as np, pyarrow.parquet as pq

RAIZ = ing.RAIZ; DIR = RAIZ / 'data/enoe/recalculo'; TRIM = DIR / 'trimestres'; SDEM = RAIZ / 'data/enoe/sdem_inegi'
for d in (DIR, TRIM, SDEM): d.mkdir(parents=True, exist_ok=True)
DB = 'datosmexico-api-enoe'; API = 'https://api.datosmexico.org/api/v1'
BISE = {'pob_15ymas': '6200093963', 'pea_total': '6200093960', 'pnea_total': '6200032077', 'ocupados_total': '6200093954', 'desocupados_total': '6200093973'}
FUENTE = 'INEGI, microdatos SDEM de la ENOE (descarga masiva, CSV) — SUM(fac_tri) con dominio 15+ (scripts/enoe_indicadores_inegi.py)'
CONTEOS = ['pob_15ymas', 'pea_total', 'pnea_total', 'ocupados_total', 'desocupados_total', 'subocupados_total', 'condcrit_total', 'informales_total']
TASAS = {'tasa_participacion': ('pea_total', 'pob_15ymas'), 'tasa_desocupacion': ('desocupados_total', 'pea_total'), 'tasa_subocupacion': ('subocupados_total', 'ocupados_total'),
         'tasa_informalidad_til1': ('informales_total', 'ocupados_total'), 'tasa_ocupacion_critica_tcco': ('condcrit_total', 'ocupados_total')}

def log(m):
    with open(DIR / 'recalculo.log', 'a') as f: f.write(f"{time.strftime('%H:%M:%S')} {m}\n")
    print(m, flush=True)

def d1(sql, archivo=False):
    if archivo:
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False) as f: f.write(sql); ruta = f.name
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes', '--file', ruta], cwd=RAIZ, capture_output=True, text=True)
        if r.returncode: sys.exit(f'wrangler falló: {(r.stdout + r.stderr)[-600:]}')
        return None
    r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes', '--json', '--command', sql], cwd=RAIZ, capture_output=True, text=True)
    if r.returncode: sys.exit(f'wrangler falló: {(r.stdout + r.stderr)[-600:]}')
    return json.loads(r.stdout)[0]['results']

def archivos():
    """Los SDEM en CSV del catálogo de datos abiertos (un Parquet por trimestre), con su periodo."""
    cache = DIR / 'archivos.json'
    if not cache.exists():
        r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'datosmexico-api-bise', '--remote', '--yes', '--json', '--command',
                            "SELECT tabla, filas, clave_r2, sha256_zip FROM da_microdatos WHERE programa_slug LIKE '%enoe%' AND formato = '_csv.zip' AND tabla LIKE '%sdem%'"], cwd=RAIZ, capture_output=True, text=True)
        cache.write_text(json.dumps(json.loads(r.stdout)[0]['results'], ensure_ascii=False, indent=1))
    out = {}
    for a in json.loads(cache.read_text()):
        m = re.search(r'sdemt+(\d)(\d\d)$', a['tabla'])
        if not m: sys.exit(f'no entiendo el nombre {a["tabla"]}')
        periodo = f"20{m.group(2)}T{m.group(1)}"
        if periodo in out: sys.exit(f'dos archivos para {periodo}: {out[periodo]["tabla"]} y {a["tabla"]}')
        out[periodo] = a
    return dict(sorted(out.items()))

def leer(periodo, a):
    ruta = SDEM / f'{periodo}.parquet'
    if not ruta.exists():
        ing._s3().download_file(ing.BUCKET, a['clave_r2'], str(ruta) + '.tmp'); (SDEM / f'{periodo}.parquet.tmp').rename(ruta)
    t = pq.read_table(ruta)
    if t.num_rows != a['filas']: sys.exit(f'{periodo}: {t.num_rows} filas, catálogo {a["filas"]}')
    cols = set(t.column_names)
    fac = 'fac_tri' if 'fac_tri' in cols else 'fac'; ent = 'ent' if 'ent' in cols else 'cve_ent'
    v = {}
    for c in [fac, ent, 'eda', 'clase1', 'clase2', 'sub_o', 'tcco', 'tue2', 'pos_ocu', 'rama', 'seg_soc', 'remune2c', 'rama_est2']:
        if c not in cols: sys.exit(f'{periodo}: falta la columna {c}')
        x = t[c].to_numpy(zero_copy_only=False)
        v[c] = np.nan_to_num(x.astype(float), nan=-1.0)
    v['fac'] = v.pop(fac); v['ent'] = v.pop(ent)
    return v, fac, ent

def calcular(v):
    fac, eda, c1, c2 = v['fac'], v['eda'], v['clase1'], v['clase2']
    m15 = eda >= 15
    tue2, pos, rama, seg, rem = v['tue2'], v['pos_ocu'], v['rama'], v['seg_soc'], v['remune2c']
    inf = (tue2 == 5) | ((pos == 3) & (rama == 6)) | (pos == 4) | (np.isin(seg, [2, 3]) & (tue2 == 6)) \
        | ((pos == 1) & (rem == 1) & ~np.isin(tue2, [5, 6, 7]) & np.isin(seg, [2, 3])) | ((pos == 1) & (rem == 2) & ~np.isin(tue2, [5, 6, 7]) & np.isin(seg, [2, 3])) \
        | ((pos == 5) & np.isin(seg, [2, 3]))
    ocup = m15 & (c2 == 1)
    masks = {'pob_15ymas': m15 & np.isin(c1, [1, 2]), 'pea_total': m15 & (c1 == 1), 'pnea_total': m15 & (c1 == 2), 'ocupados_total': ocup, 'desocupados_total': m15 & (c2 == 2),
             'subocupados_total': ocup & (v['sub_o'] == 1), 'condcrit_total': ocup & np.isin(v['tcco'], [1, 2, 3]), 'informales_total': ocup & inf}
    ent = v['ent'].astype(int)
    def conteos(m):
        d = {k: float(fac[m & mk].sum()) for k, mk in masks.items()}
        for k, (num, den) in TASAS.items(): d[k] = 100.0 * d[num] / d[den] if d[den] else 0.0
        return d
    def cortes(m, col, claves):
        oc = ocup & m; tot = fac[oc].sum()
        return {str(k): (float(fac[oc & (v[col] == k)].sum()), 100.0 * fac[oc & (v[col] == k)].sum() / tot if tot else 0.0) for k in claves}
    out = {'nacional': conteos(np.ones(len(fac), bool)), 'entidades': {}, 'sector': {'00': cortes(np.ones(len(fac), bool), 'rama_est2', range(0, 12))}, 'posicion': {'00': cortes(np.ones(len(fac), bool), 'pos_ocu', range(1, 5))}}
    for e in range(1, 33):
        m = ent == e; k = f'{e:02d}'
        out['entidades'][k] = conteos(m); out['sector'][k] = cortes(m, 'rama_est2', range(0, 12)); out['posicion'][k] = cortes(m, 'pos_ocu', range(1, 5))
    return out

def oficiales():
    """Observaciones del Banco de Indicadores para los cinco conteos, por geografía y trimestre (2005/01 → 2005T1)."""
    cache = DIR / 'bise.json'
    if cache.exists(): return json.loads(cache.read_text())
    out = {}
    for ind, bid in BISE.items():
        req = urllib.request.Request(f'{API}/inegi/indicadores/{bid}/observaciones?limit=5000', headers={'User-Agent': 'curl/8'})
        d = json.loads(urllib.request.urlopen(req, timeout=120).read())
        if d['total'] > 5000: sys.exit(f'{bid}: más de 5,000 observaciones')
        for o in d['observaciones']:
            m = re.match(r'^(\d{4})/0([1-4])$', o['periodo'])
            if m and o['valor'] is not None: out[f"{ind}|{o['geografia']}|{m.group(1)}T{m.group(2)}"] = o['valor']
    cache.write_text(json.dumps(out)); return out

def etapa(p): return 'clasica' if p <= '2020T1' else 'enoe_n'

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--cargar', action='store_true'); ap.add_argument('--solo', default=None); args = ap.parse_args()
    arch = archivos(); solo = set(args.solo.split(',')) if args.solo else None
    log(f'{len(arch)} trimestres en el catálogo: {min(arch)} … {max(arch)}')
    for periodo, a in arch.items():
        if solo and periodo not in solo: continue
        res = TRIM / f'{periodo}.json'
        if res.exists(): continue
        t0 = time.time(); v, fac, ent = leer(periodo, a); r = calcular(v)
        r['_meta'] = {'tabla': a['tabla'], 'filas': a['filas'], 'clave_r2': a['clave_r2'], 'sha256_zip': a['sha256_zip'], 'factor': fac, 'columna_entidad': ent, 'calculado_en': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        res.write_text(json.dumps(r)); log(f"{periodo}: {a['filas']:,} filas, PEA {r['nacional']['pea_total']:,.0f}, ocupados {r['nacional']['ocupados_total']:,.0f}, TD {r['nacional']['tasa_desocupacion']:.3f} % ({time.time() - t0:.1f} s)")
    # verificación contra el Banco de Indicadores
    of = oficiales(); resultados = {p: json.loads((TRIM / f'{p}.json').read_text()) for p in arch if (TRIM / f'{p}.json').exists()}
    ver = []; peor = {}
    for p, r in resultados.items():
        for geo, d in [('00', r['nacional'])] + list(r['entidades'].items()):
            for ind in BISE:
                o = of.get(f'{ind}|{geo}|{p}')
                if o is None: continue
                delta = 100.0 * (d[ind] - o) / o if o else None
                ver.append({'periodo': p, 'geografia': geo, 'indicador': ind, 'calculado': d[ind], 'inegi': o, 'delta_rel_pct': delta})
                if delta is not None and (ind not in peor or abs(delta) > abs(peor[ind][0])): peor[ind] = (delta, p, geo)
    with open(DIR / 'verificacion.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['periodo', 'geografia', 'indicador', 'calculado', 'inegi', 'delta_rel_pct']); w.writeheader(); w.writerows(ver)
    for ind in BISE:
        ds = [abs(x['delta_rel_pct']) for x in ver if x['indicador'] == ind and x['delta_rel_pct'] is not None]
        if ds: log(f"verificación {ind}: {len(ds)} comparaciones, |Δ| mediana {np.median(ds):.4f} %, máxima {max(ds):.4f} % ({peor[ind][1]} {peor[ind][2]}), >1 %: {sum(1 for x in ds if x > 1)}")
    if not args.cargar: return
    # carga a D1: se reemplazan las cuatro tablas con la serie recalculada (bound_oficial = cifra del INEGI cuando existe)
    idx = {(x['indicador'], x['geografia'], x['periodo']): x for x in ver}
    calc_en = time.strftime('%Y-%m-%d %H:%M:%S')
    def q(s): return "'" + str(s).replace("'", "''") + "'"
    def num(x): return 'NULL' if x is None else repr(float(x))
    nac, ent_, sec, pos_ = [], [], [], []
    for p, r in resultados.items():
        e = etapa(p)
        for ind in CONTEOS + list(TASAS):
            v = r['nacional'][ind]; o = idx.get((ind, '00', p))
            nac.append(f"({q(p)},{q(ind)},{num(v)},{q('personas' if ind in CONTEOS else 'porcentaje')},{q(FUENTE)},{num(o['inegi'] if o else None)},{q('INEGI Banco de Indicadores ' + BISE[ind]) if o else 'NULL'},{num(o['delta_rel_pct'] if o else None)},{q(calc_en)},{q(e)})")
            for geo, d in r['entidades'].items():
                o = idx.get((ind, geo, p))
                ent_.append(f"({q(p)},{q(geo)},{q(ind)},{num(d[ind])},{q('personas' if ind in CONTEOS else 'porcentaje')},{num(o['inegi'] if o else None)},{num(o['delta_rel_pct'] if o else None)},{q(calc_en)},{q(e)})")
        for geo, d in r['sector'].items():
            for k, (tot, pct) in d.items(): sec.append(f"({q(p)},{q('nacional' if geo == '00' else 'entidad')},{q(geo)},{q(k)},{int(round(tot))},{pct:.4f},{q(e)})")
        for geo, d in r['posicion'].items():
            for k, (tot, pct) in d.items(): pos_.append(f"({q(p)},{q('nacional' if geo == '00' else 'entidad')},{q(geo)},{int(k)},{int(round(tot))},{pct:.4f},{q(e)})")
    d1('DELETE FROM indicadores_nacionales; DELETE FROM indicadores_entidad; DELETE FROM poblacion_ocupada_por_sector; DELETE FROM poblacion_ocupada_por_posicion;', archivo=True)
    for tabla, filas, cols in [('indicadores_nacionales', nac, '(periodo, indicador, valor, unidad, fuente_calculo, bound_oficial, bound_fuente, delta_rel_pct, calculado_en, etapa)'),
                               ('indicadores_entidad', ent_, '(periodo, entidad_clave, indicador, valor, unidad, bound_oficial, delta_rel_pct, calculado_en, etapa)'),
                               ('poblacion_ocupada_por_sector', sec, '(periodo, nivel, geo_clave, sector_clave, total_personas, pct_ocupados, etapa)'),
                               ('poblacion_ocupada_por_posicion', pos_, '(periodo, nivel, geo_clave, pos_clave, total_personas, pct_ocupados, etapa)')]:
        for i in range(0, len(filas), 4000):
            sql = ''.join(f"INSERT INTO {tabla} {cols} VALUES {','.join(filas[j:j + 400])};\n" for j in range(i, min(i + 4000, len(filas)), 400))
            d1(sql, archivo=True)
        n = d1(f'SELECT COUNT(*) n FROM {tabla}')[0]['n']
        log(f'{tabla}: {n} filas en D1 (esperadas {len(filas)})')
        if n != len(filas): sys.exit('la carga no cuadra')
    d1(''.join(f"UPDATE estadisticas_globales SET total_filas = (SELECT COUNT(*) FROM {t}), primer_periodo = (SELECT MIN(periodo) FROM {t}), ultimo_periodo = (SELECT MAX(periodo) FROM {t}), cobertura_temporal = (SELECT MIN(periodo) FROM {t}) || '-' || (SELECT MAX(periodo) FROM {t}), actualizado_en = datetime('now') WHERE tabla = '{t}';\n"
               for t in ('indicadores_nacionales', 'indicadores_entidad', 'poblacion_ocupada_por_sector', 'poblacion_ocupada_por_posicion')), archivo=True)
    log('carga completa')

if __name__ == '__main__':
    main()

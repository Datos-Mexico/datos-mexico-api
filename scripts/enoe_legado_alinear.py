"""Alinea la ENOE del sistema anterior (Neon, api.datos-itam.org) con la serie exacta de la API nueva: reemplaza las
cuatro tablas de indicadores (enoe.indicadores_nacionales, indicadores_entidad, poblacion_ocupada_por_sector,
poblacion_ocupada_por_posicion) con los resultados de scripts/enoe_indicadores_inegi.py (2005T1-2026T2, exactos contra
el Banco de Indicadores) y actualiza enoe.estadisticas_globales. Decisión del CEO (2026-09-21): el sistema anterior se
queda en producción, alineado, no apagado.

Método: una sola transacción en Postgres (DELETE + COPY por tabla); si algo falla, nada cambia. Antes y después se
cuentan las filas y se comprueba una cifra ancla (2025T1 ocupados_total = 59,001,009 = INEGI). La conexión se lee de
~/datos-itam/api/.env.neon (DATABASE_URL), como los scripts de fidelidad; nunca se imprime.
Uso: data/.venv/bin/python scripts/enoe_legado_alinear.py [--aplicar]
"""
import argparse, csv, json, pathlib, re, subprocess, sys, tempfile, time
RAIZ = pathlib.Path(__file__).resolve().parent.parent; TRIM = RAIZ / 'data/enoe/recalculo/trimestres'; VER = RAIZ / 'data/enoe/recalculo/verificacion.csv'
ENV = pathlib.Path.home() / 'datos-itam/api/.env.neon'
BISE = {'pob_15ymas': '6200093963', 'pea_total': '6200093960', 'pnea_total': '6200032077', 'ocupados_total': '6200093954', 'desocupados_total': '6200093973'}
FUENTE = 'INEGI, microdatos SDEM de la ENOE (descarga masiva, CSV) — SUM(fac_tri) con dominio 15+ (scripts/enoe_indicadores_inegi.py; alineado desde datosmexico-api)'
CONTEOS = ['pob_15ymas', 'pea_total', 'pnea_total', 'ocupados_total', 'desocupados_total', 'subocupados_total', 'condcrit_total', 'informales_total']
TASAS = ['tasa_participacion', 'tasa_desocupacion', 'tasa_subocupacion', 'tasa_informalidad_til1', 'tasa_ocupacion_critica_tcco']

def url_neon():
    for line in open(ENV):
        if line.startswith('DATABASE_URL='):
            u = line.split('=', 1)[1].strip().strip('"').strip("'").replace('postgresql+asyncpg://', 'postgresql://')
            u = re.sub(r'[?&]ssl=(require|true)', '', u).rstrip('$'); return u + ('&' if '?' in u else '?') + 'sslmode=require'
    sys.exit('sin DATABASE_URL')

def psql(u, sql, archivo=None):
    args = ['psql', u, '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|'] + (['-f', archivo] if archivo else ['-c', sql])
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode: sys.exit(f'psql falló: {r.stderr[-400:]}')
    return r.stdout.strip()

def etapa(p): return 'clasica' if p <= '2020T1' else 'enoe_n'

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--aplicar', action='store_true'); a = ap.parse_args()
    res = {p.stem: json.loads(p.read_text()) for p in sorted(TRIM.glob('*.json'))}
    ver = {(x['indicador'], x['geografia'], x['periodo']): x for x in csv.DictReader(open(VER))}
    calc_en = time.strftime('%Y-%m-%d %H:%M:%S+00')
    nac, ent, sec, pos = [], [], [], []
    for p, r in res.items():
        e = etapa(p)
        for ind in CONTEOS + TASAS:
            o = ver.get((ind, '00', p)); u = 'personas' if ind in CONTEOS else 'porcentaje'
            nac.append([p, ind, repr(float(r['nacional'][ind])), u, FUENTE, o['inegi'] if o else '', ('INEGI Banco de Indicadores ' + BISE[ind]) if o else '', o['delta_rel_pct'] if o else '', calc_en, e])
            for geo, d in r['entidades'].items():
                o = ver.get((ind, geo, p)); ent.append([p, geo, ind, repr(float(d[ind])), u, o['inegi'] if o else '', o['delta_rel_pct'] if o else '', calc_en, e])
        for geo, d in r['sector'].items():
            for k, (tot, pct) in d.items(): sec.append([p, 'nacional' if geo == '00' else 'entidad', geo, k, int(round(tot)), f'{pct:.4f}', e])
        for geo, d in r['posicion'].items():
            for k, (tot, pct) in d.items(): pos.append([p, 'nacional' if geo == '00' else 'entidad', geo, int(k), int(round(tot)), f'{pct:.4f}', e])
    print(f'{len(res)} trimestres → nacionales {len(nac):,}, entidad {len(ent):,}, sector {len(sec):,}, posición {len(pos):,}')
    ancla = [x for x in nac if x[0] == '2025T1' and x[1] == 'ocupados_total'][0][2]; print('ancla 2025T1 ocupados_total', ancla); assert float(ancla) == 59001009
    u = url_neon()
    print('antes:', psql(u, "SELECT 'nac '||count(*)||' '||max(periodo) FROM enoe.indicadores_nacionales UNION ALL SELECT 'ent '||count(*) FROM enoe.indicadores_entidad UNION ALL SELECT 'sec '||count(*) FROM enoe.poblacion_ocupada_por_sector UNION ALL SELECT 'pos '||count(*) FROM enoe.poblacion_ocupada_por_posicion").replace('\n', '; '))
    if not a.aplicar: print('sin --aplicar: no se toca Neon'); return
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='enoe-legado-'))
    for nombre, filas in (('nac', nac), ('ent', ent), ('sec', sec), ('pos', pos)):
        with open(tmp / f'{nombre}.csv', 'w', newline='') as f: csv.writer(f).writerows(filas)
    sql = f"""BEGIN;
DELETE FROM enoe.indicadores_entidad; DELETE FROM enoe.indicadores_nacionales; DELETE FROM enoe.poblacion_ocupada_por_sector; DELETE FROM enoe.poblacion_ocupada_por_posicion;
\\copy enoe.indicadores_nacionales (periodo, indicador, valor, unidad, fuente_calculo, bound_oficial, bound_fuente, delta_rel_pct, calculado_en, etapa) FROM '{tmp}/nac.csv' WITH (FORMAT csv, NULL '')
\\copy enoe.indicadores_entidad (periodo, entidad_clave, indicador, valor, unidad, bound_oficial, delta_rel_pct, calculado_en, etapa) FROM '{tmp}/ent.csv' WITH (FORMAT csv, NULL '')
\\copy enoe.poblacion_ocupada_por_sector (periodo, nivel, geo_clave, sector_clave, total_personas, pct_ocupados, etapa) FROM '{tmp}/sec.csv' WITH (FORMAT csv, NULL '')
\\copy enoe.poblacion_ocupada_por_posicion (periodo, nivel, geo_clave, pos_clave, total_personas, pct_ocupados, etapa) FROM '{tmp}/pos.csv' WITH (FORMAT csv, NULL '')
UPDATE enoe.estadisticas_globales g SET total_filas = s.n, primer_periodo = s.p0, ultimo_periodo = s.p1, cobertura_temporal = s.p0 || '-' || s.p1, actualizado_en = now()
FROM (SELECT 'indicadores_nacionales' t, count(*) n, min(periodo) p0, max(periodo) p1 FROM enoe.indicadores_nacionales UNION ALL SELECT 'indicadores_entidad', count(*), min(periodo), max(periodo) FROM enoe.indicadores_entidad UNION ALL SELECT 'poblacion_ocupada_por_sector', count(*), min(periodo), max(periodo) FROM enoe.poblacion_ocupada_por_sector UNION ALL SELECT 'poblacion_ocupada_por_posicion', count(*), min(periodo), max(periodo) FROM enoe.poblacion_ocupada_por_posicion) s WHERE g.tabla = s.t;
COMMIT;
"""
    (tmp / 'alinear.sql').write_text(sql); psql(u, None, archivo=str(tmp / 'alinear.sql'))
    despues = psql(u, "SELECT 'nac '||count(*)||' '||max(periodo) FROM enoe.indicadores_nacionales UNION ALL SELECT 'ent '||count(*) FROM enoe.indicadores_entidad UNION ALL SELECT 'sec '||count(*) FROM enoe.poblacion_ocupada_por_sector UNION ALL SELECT 'pos '||count(*) FROM enoe.poblacion_ocupada_por_posicion UNION ALL SELECT 'ancla '||valor FROM enoe.indicadores_nacionales WHERE periodo='2025T1' AND indicador='ocupados_total'").replace('\n', '; ')
    print('después:', despues)
    assert f'nac {len(nac)} 2026T2' in despues and f'ent {len(ent)}' in despues and f'sec {len(sec)}' in despues and f'pos {len(pos)}' in despues and 'ancla 59001009' in despues
    print('Neon alineado')

if __name__ == '__main__':
    main()

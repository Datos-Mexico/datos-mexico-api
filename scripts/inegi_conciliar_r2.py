"""Concilia el almacén R2 (prefijo inegi/) con los manifiestos: nada referenciado puede faltar y nada sin
referencia debe quedar. Además normaliza las claves con caracteres fuera del conjunto seguro [A-Za-z0-9_-./]
(espacios en ediciones de paquetes ingeridos antes de que el ingestor las saneara): copia el objeto a la clave
saneada, verifica el tamaño, reescribe los manifiestos y borra la clave vieja.
Sin --aplicar solo informa. Uso: data/.venv/bin/python scripts/inegi_conciliar_r2.py [--aplicar]
"""
import argparse, glob, json, pathlib, re, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import inegi_ingesta as ing
BASE = ing.BASE; SEGURO = re.compile(r'[^A-Za-z0-9_\-./]')
def sanear(k): return SEGURO.sub('_', k)
def manifiestos():
    """archivo → filas (json) de todos los manifiestos de microdatos, tabulados y espejo."""
    out = {}
    for f in glob.glob(str(BASE / 'manifiesto-*.jsonl')) + glob.glob(str(BASE / 'tabulados-*.jsonl')) + [str(BASE / 'espejo.jsonl')]:
        if pathlib.Path(f).exists(): out[f] = [json.loads(l) for l in open(f) if l.strip()]
    return out
CAMPOS = ('clave_r2', 'fuente_r2', 'clave')
def referencias():
    """Claves que el catálogo publica: la versión vigente de cada unidad lógica (misma selección que
    scripts/inegi_catalogo_d1.py). Las versiones superadas y los espejos operativos no cuentan como referencia."""
    import inegi_catalogo_d1 as cat
    ref = {}; TAM.clear()
    for r in cat.cargar('manifiesto-*.jsonl'): ref.setdefault(r['clave_r2'], set()).add('microdatos'); ref.setdefault(r['fuente_r2'], set()).add('fuente'); TAM[r['clave_r2']] = r['bytes_parquet']
    for r in cat.cargar('tabulados-*.jsonl'): ref.setdefault(r['clave_r2'], set()).add('tabulado'); TAM[r['clave_r2']] = r['bytes']
    return ref
TAM = {}  # clave → bytes según el manifiesto vigente (para comprobar la integridad de lo almacenado)
def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--aplicar', action='store_true'); a = ap.parse_args()
    s3 = ing._s3(); mans = manifiestos(); ref = referencias()
    objetos = {}
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=ing.BUCKET, Prefix='inegi/'):
        for o in page.get('Contents', []): objetos[o['Key']] = o['Size']
    faltan = sorted(k for k in ref if k not in objetos)
    distintos = sorted(k for k in ref if k in objetos and k in TAM and objetos[k] != TAM[k])
    print(f'referenciadas con tamaño distinto al del manifiesto: {len(distintos)}'); print('\n'.join(f'  {k} R2={objetos[k]} manifiesto={TAM[k]}' for k in distintos[:20]))
    huerfanos = sorted(k for k in objetos if k not in ref)
    # una fuente huérfana solo se borra si la misma fuente (mismo nombre —sin el sufijo -id de colisión— y mismo tamaño) está referenciada
    def nombre_base(k): return re.sub(r'-\d+(_\w+\.zip)$', r'\1', pathlib.Path(k).name)
    ref_fuentes = {(nombre_base(k), objetos.get(k)) for k in ref if k.startswith('inegi/fuentes/')}
    sin_duplicado = [k for k in huerfanos if k.startswith('inegi/fuentes/') and (nombre_base(k), objetos[k]) not in ref_fuentes]
    print(f'fuentes huérfanas SIN copia referenciada del mismo nombre y tamaño (no se borran): {len(sin_duplicado)}'); print('\n'.join('  ' + k for k in sin_duplicado[:20]))
    huerfanos = [k for k in huerfanos if k not in sin_duplicado]
    raras = sorted(k for k in ref if SEGURO.search(k))
    print(f'objetos en R2 bajo inegi/: {len(objetos):,} ({sum(objetos.values())/1e9:.2f} GB); claves referenciadas: {len(ref):,}')
    print(f'referenciadas y ausentes: {len(faltan)}'); print('\n'.join('  ' + k for k in faltan[:20]))
    print(f'huérfanos (en R2 sin referencia): {len(huerfanos)} ({sum(objetos[k] for k in huerfanos)/1e6:.1f} MB)'); print('\n'.join(f'  {k} {objetos[k]}' for k in huerfanos[:40]))
    print(f'claves con caracteres fuera del conjunto seguro: {len(raras)}'); print('\n'.join('  ' + k for k in raras[:40]))
    (BASE / 'conciliacion.json').write_text(json.dumps({'faltan': faltan, 'huerfanos': huerfanos, 'sin_duplicado': sin_duplicado, 'raras': raras, 'tamanos': {k: objetos[k] for k in huerfanos + sin_duplicado}}, indent=0))
    if not a.aplicar: return
    # 1) normalizar claves raras: copiar, verificar, reescribir manifiestos, borrar la vieja
    renombres = {}
    for k in raras:
        if k not in objetos: continue
        nk = sanear(k)
        if nk in objetos and objetos[nk] != objetos[k]: sys.exit(f'conflicto: {nk} ya existe con otro tamaño')
        if nk not in objetos: s3.copy_object(Bucket=ing.BUCKET, Key=nk, CopySource={'Bucket': ing.BUCKET, 'Key': k})
        if s3.head_object(Bucket=ing.BUCKET, Key=nk)['ContentLength'] != objetos[k]: sys.exit(f'tamaño distinto tras copiar {nk}')
        renombres[k] = nk; objetos[nk] = objetos[k]
    for f, filas in mans.items():
        cambio = False
        for r in filas:
            for c in CAMPOS:
                if r.get(c) in renombres: r[c] = renombres[r[c]]; cambio = True
            if 'edicion' in r and SEGURO.search(r['edicion'] or ''): r['edicion'] = sanear(r['edicion']); cambio = True
        if cambio:
            with open(f, 'w') as w:
                for r in filas: w.write(json.dumps(r, ensure_ascii=False) + '\n')
            print('manifiesto reescrito:', pathlib.Path(f).name)
    for k in renombres: s3.delete_object(Bucket=ing.BUCKET, Key=k); print('renombrado', k, '→', renombres[k])
    # 2) borrar huérfanos (menos los que acaban de convertirse en la clave vigente)
    huerfanos = [k for k in huerfanos if k not in set(renombres.values())]
    for k in huerfanos: s3.delete_object(Bucket=ing.BUCKET, Key=k)
    print(f'{len(huerfanos)} huérfanos borrados; {len(renombres)} claves normalizadas')
if __name__ == '__main__': main()

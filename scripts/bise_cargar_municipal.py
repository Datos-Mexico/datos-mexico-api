"""Carga data/bise/neon-export/observaciones_municipales.csv en la tabla `observaciones` de la D1
remota datosmexico-api-bise (F8 fase 2), añadiendo filas a las nacionales/estatales ya cargadas.

Verificación: cuenta las filas remotas con clave geográfica de 5 dígitos antes y después; si antes
hay una carga parcial (ni 0 ni el total esperado) se detiene. Sentencias de <=500 filas y ~90 KB,
archivos de <=8 MB (límites de D1 ya documentados en la bitácora).
Uso: python3 scripts/bise_cargar_municipal.py
"""
import csv, json, pathlib, subprocess, sys, tempfile
RAIZ = pathlib.Path(__file__).resolve().parent.parent
CSV = RAIZ / 'data' / 'bise' / 'neon-export' / 'observaciones_municipales.csv'
DB = 'datosmexico-api-bise'
COLS = ['indicador', 'geografia', 'periodo', 'valor', 'valor_texto', 'excepcion', 'estatus', 'fuente', 'nota']
TEXTO = {'indicador', 'geografia', 'periodo', 'valor_texto', 'excepcion', 'estatus', 'fuente', 'nota'}

def lit(v, texto):
    if v == '\\N': return 'NULL'
    return "'" + v.replace("'", "''") + "'" if texto else v

def remoto(sql):
    out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes', '--json', '--command', sql], capture_output=True, text=True, cwd=RAIZ).stdout
    return json.loads(out[out.index('['):])[0]['results'][0]['n']

def main():
    csv.field_size_limit(1 << 30)
    with open(CSV, newline='', encoding='utf-8') as f: esperado = sum(1 for _ in csv.reader(f)) - 1
    antes = remoto("SELECT COUNT(*) AS n FROM observaciones WHERE length(geografia) = 5")
    print(f'esperado {esperado} filas municipales; remoto antes: {antes}')
    if antes == esperado: print('ya cargadas'); return
    if antes != 0: sys.exit(f'carga parcial ({antes}); revisar antes de continuar')
    tmp = pathlib.Path(tempfile.mkdtemp(prefix='bise-mun-'))
    k = 0; buf = []; tam = 0; chunk = []; n = 0
    def vaciar_archivo():
        nonlocal k, buf, tam
        if buf: (tmp / f'{k:04d}.sql').write_text('\n'.join(buf), encoding='utf-8'); k += 1; buf = []; tam = 0
    def vaciar_sentencia():
        nonlocal chunk, tam
        if chunk:
            st = f"INSERT INTO observaciones ({','.join(COLS)}) VALUES\n" + ",\n".join(chunk) + ";"
            buf.append(st); tam += len(st); chunk = []
            if tam > 8_000_000: vaciar_archivo()
    with open(CSV, newline='', encoding='utf-8') as f:
        r = csv.reader(f); cab = next(r); idx = [cab.index(c) for c in COLS]
        for row in r:
            chunk.append('(' + ','.join(lit(row[i], COLS[j] in TEXTO) for j, i in enumerate(idx)) + ')'); n += 1
            if len(chunk) == 500 or sum(len(x) for x in chunk) > 90_000: vaciar_sentencia()
    vaciar_sentencia(); vaciar_archivo()
    archivos = sorted(tmp.glob('*.sql')); print(f'{n} filas en {len(archivos)} archivos')
    for a in archivos:
        out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', DB, '--remote', '--yes', '--file', str(a)], capture_output=True, text=True, cwd=RAIZ)
        if out.returncode != 0 or '✘' in out.stdout + out.stderr:
            sys.exit(f'error en {a.name}: {(out.stdout + out.stderr)[-400:]}')
        print(f'  {a.name} ok')
    despues = remoto("SELECT COUNT(*) AS n FROM observaciones WHERE length(geografia) = 5")
    print(f'remoto después: {despues} / esperado {esperado}', 'OK' if despues == esperado else 'DIFIERE')
    for a in archivos: a.unlink()
    tmp.rmdir()

if __name__ == '__main__':
    main()

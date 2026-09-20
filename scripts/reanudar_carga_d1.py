"""Reanuda la carga de UNA tabla en D1 cuando cargar_d1.sh se detuvo a medias por un fallo de red.

Vuelve a partir data/<schema>/sql/<tabla>.sql exactamente igual que cargar_d1.sh (trozos de <=8 MB en
límites de sentencia), salta los trozos ya aplicados (parámetro `desde`, número del trozo en que falló)
y ejecuta el resto con --remote; cada trozo es un lote atómico en D1, así que si el trozo del fallo ya se
aplicó, D1 responde UNIQUE constraint y se da por hecho. Al final compara el conteo remoto con el CSV.
Uso: python3 scripts/reanudar_carga_d1.py <schema> <tabla> <desde>
"""
import csv, pathlib, subprocess, sys, tempfile, time
RAIZ = pathlib.Path(__file__).resolve().parent.parent
def main(schema, tabla, desde):
    src = (RAIZ / f'data/{schema}/sql/{tabla}.sql').read_text(encoding='utf-8')
    partes = src.split(';\n'); trozos = []; buf = []; tam = 0
    for st in partes:
        if not st.strip(): continue
        buf.append(st); tam += len(st)
        if tam > 8_000_000: trozos.append(';\n'.join(buf) + ';\n'); buf = []; tam = 0
    if buf: trozos.append(';\n'.join(buf) + ';\n')
    print(f'{len(trozos)} trozos; reanudando desde {desde}', flush=True)
    tmp = pathlib.Path(tempfile.mkdtemp(prefix=f'reanudar-{schema}-'))
    for k in range(desde, len(trozos)):
        f = tmp / f'{k:04d}.sql'; f.write_text(trozos[k], encoding='utf-8')
        for intento in range(5):
            r = subprocess.run(['npx', 'wrangler', 'd1', 'execute', f'datosmexico-api-{schema}', '--remote', '--yes', '--file', str(f)], cwd=RAIZ, capture_output=True, text=True)
            salida = r.stdout + r.stderr
            if r.returncode == 0 and '✘' not in salida: break
            if 'UNIQUE constraint' in salida and k == desde: print(f'{k:04d} ya estaba aplicado', flush=True); break
            print(f'{k:04d} reintento {intento+1}: {salida.strip()[-120:]}', flush=True); time.sleep(10 * (intento + 1))
        else: sys.exit(f'trozo {k:04d} no se pudo aplicar')
        f.unlink()
        if k % 20 == 0: print(f'{time.strftime("%H:%M:%S")} trozo {k:04d} ok', flush=True)
    csv.field_size_limit(1 << 30)
    with open(RAIZ / f'data/{schema}/neon-export/{tabla}.csv', newline='', encoding='utf-8') as f: esperado = sum(1 for _ in csv.reader(f)) - 1
    out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', f'datosmexico-api-{schema}', '--remote', '--yes', '--json', '--command', f'select count(*) n from {tabla}'], cwd=RAIZ, capture_output=True, text=True).stdout
    import json; n = json.loads(out[out.index('['):])[0]['results'][0]['n']
    print(f'remoto {n} / esperado {esperado}', 'OK' if n == esperado else 'DIFIERE', flush=True)
if __name__ == '__main__': main(sys.argv[1], sys.argv[2], int(sys.argv[3]))

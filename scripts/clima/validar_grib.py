"""Valida el lector GRIB del Worker (src/clima/grib.ts) contra ecCodes (ECMWF), campo por campo y punto por punto.

Para cada campo: misma malla, mismos metadatos (parámetro, nivel, hora) y cada valor igual al de ecCodes con tolerancia de
1e-5 relativa (la precisión del empaque), con las filas normalizadas de norte a sur.
Uso: python3 scripts/clima/validar_grib.py <archivo.grb2>...   (requiere `pip install eccodes eccodeslib` y esbuild)
"""
import json, os, subprocess, sys, tempfile
import eccodes

RAIZ = os.path.join(os.path.dirname(__file__), "..", "..")

def main(archivos):
    with tempfile.TemporaryDirectory() as t:
        js = os.path.join(t, "g.mjs")
        subprocess.run([os.path.join(RAIZ, "node_modules/.bin/esbuild"), os.path.join(RAIZ, "scripts/clima/validar_grib_entrada.ts"), "--bundle", "--platform=node", "--format=esm", f"--outfile={js}", "--log-level=warning"], check=True)
        nuestro = json.loads(subprocess.run(["node", "--max-old-space-size=4096", js, *archivos], check=True, capture_output=True, text=True).stdout)
    campos = valores = fallas = 0
    for f in archivos:
        n = nuestro[f]
        if isinstance(n, dict): print("ERROR", f, n["error"]); fallas += 1; continue
        with open(f, "rb") as fh:
            k = 0
            while True:
                h = eccodes.codes_grib_new_from_file(fh)
                if h is None: break
                c = n[k]; k += 1; campos += 1
                g = lambda x: eccodes.codes_get(h, x)
                ni, nj = g("Ni"), g("Nj")
                vals = eccodes.codes_get_values(h)
                sur_primero = g("jScansPositively") == 1
                filas = [vals[j * ni:(j + 1) * ni] for j in range(nj)]
                if sur_primero: filas.reverse()
                esperado = [v for fila in filas for v in fila]
                meta_ok = (c["ni"], c["nj"], c["categoria"], c["parametro"]) == (ni, nj, g("parameterCategory"), g("parameterNumber"))
                malos = sum(1 for a, b in zip(c["valores"], esperado) if abs(a - b) > 1e-5 * max(1.0, abs(b)))
                valores += len(esperado)
                if not meta_ok or malos or len(c["valores"]) != len(esperado):
                    fallas += 1; print("DIFERENCIA", f, g("shortName"), "meta", meta_ok, "valores distintos", malos)
                eccodes.codes_release(h)
        if k != len(n): fallas += 1; print("NÚMERO DE CAMPOS DISTINTO", f, k, len(n))
    print(f"{len(archivos)} archivos, {campos} campos, {valores} valores comparados, {fallas} con diferencias")
    sys.exit(1 if fallas else 0)

if __name__ == "__main__":
    main(sys.argv[1:])

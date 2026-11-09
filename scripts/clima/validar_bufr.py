"""Valida el decodificador BUFR del Worker (src/clima/bufr.ts) contra ecCodes (ECMWF), elemento por elemento.

Para cada archivo: la secuencia completa de valores decodificados debe ser idéntica a `numericValues` de ecCodes (misma
longitud, mismo orden, faltante = nulo; los textos se comparan aparte) y la observación extraída igual a la que se obtiene con
las claves de ecCodes. (No se compara `expandedDescriptors`: ecCodes lista ahí las plantillas de replicaciones con cero
repeticiones aunque no lleven valores.)
Uso: python3 scripts/clima/validar_bufr.py <archivo.bufr4>...   (requiere `pip install eccodes eccodeslib` y esbuild)
"""
import json, subprocess, sys, os, tempfile
import eccodes

RAIZ = os.path.join(os.path.dirname(__file__), "..", "..")
FALTANTE = (-1e100, 2147483647)

def con_eccodes(ruta):
    h = eccodes.codes_bufr_new_from_file(open(ruta, "rb"))
    eccodes.codes_set(h, "unpack", 1)
    desc = [f"{d:06d}" for d in eccodes.codes_get_array(h, "expandedDescriptors")]
    num = eccodes.codes_get_array(h, "numericValues").tolist()
    def g(k):
        try: v = eccodes.codes_get(h, k)
        except Exception: return None
        return None if v in FALTANTE else v
    obs = {"temperatura_c": g("#1#airTemperature"), "rocio_c": g("#1#dewpointTemperature"), "humedad_pct": g("#1#relativeHumidity"),
           "presion_estacion_hpa": g("#1#nonCoordinatePressure"), "presion_mar_hpa": g("#1#pressureReducedToMeanSeaLevel"),
           "viento_dir_grados": g("#1#windDirection"), "viento_ms": g("#1#windSpeed"), "rafaga_ms": g("#1#maximumWindGustSpeed"),
           "visibilidad_m": g("#1#horizontalVisibility"), "nubosidad_pct": g("#1#cloudCoverTotal"),
           "lat": g("#1#latitude"), "lon": g("#1#longitude"), "nombre": g("#1#stationOrSiteName")}
    for k in ("temperatura_c", "rocio_c"):
        if obs[k] is not None: obs[k] = round(obs[k] - 273.15, 2)
    for k in ("presion_estacion_hpa", "presion_mar_hpa"):
        if obs[k] is not None: obs[k] = round(obs[k] / 100, 1)
    eccodes.codes_release(h)
    return desc, num, obs

def main(archivos):
    with tempfile.TemporaryDirectory() as t:
        js = os.path.join(t, "v.mjs")
        subprocess.run([os.path.join(RAIZ, "node_modules/.bin/esbuild"), os.path.join(RAIZ, "scripts/clima/validar_bufr_entrada.ts"),
                        "--bundle", "--platform=node", "--format=esm", f"--outfile={js}", "--log-level=warning"], check=True)
        nuestro = json.loads(subprocess.run(["node", js, *archivos], check=True, capture_output=True, text=True).stdout)
    fallas = 0; valores = 0
    for f in archivos:
        n = nuestro[f]
        if "error" in n: print("ERROR", f, n["error"]); fallas += 1; continue
        desc, num, obs = con_eccodes(f)
        textos = {"001015", "001128"}
        nd = n["fxy"]
        if len(nd) != len(num): print("LONGITUD DISTINTA", f, len(nd), len(num)); fallas += 1; continue
        mal = []
        for i, (d, v) in enumerate(zip(nd, n["val"])):
            if d in textos: continue
            e = num[i]; e = None if e in FALTANTE else e
            valores += 1
            if (e is None) != (v is None) or (e is not None and abs(e - v) > 1e-6): mal.append((i, d, v, e))
        for k, v in obs.items():
            mio = n["obs"].get(k)
            if isinstance(v, str): v = v.strip()
            if (v is None) != (mio is None) or (v is not None and (abs(v - mio) > 1e-6 if isinstance(v, (int, float)) else v != mio)): mal.append(("obs", k, mio, v))
        if mal: print("VALORES DISTINTOS", f, mal[:5]); fallas += 1
    print(f"{len(archivos)} mensajes, {valores} valores numéricos comparados, {fallas} con diferencias")
    sys.exit(1 if fallas else 0)

if __name__ == "__main__":
    main(sys.argv[1:])

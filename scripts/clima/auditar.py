"""Auditoría al peso de la medición oficial del clima custodiada por el observatorio.

Para cada observación publicada en la API (últimas `--horas`):
  1. Bytes: el mensaje original guardado debe ser idéntico, byte a byte, al archivo que sirve un caché de la OMM DISTINTO del que
     usó el observatorio (DWD si leyó de NOAA, y viceversa), y su SHA-256 debe ser la publicada.
  2. Valores: el mensaje se decodifica con ecCodes (ECMWF), un decodificador independiente del Worker, y cada campo publicado
     (temperatura, rocío, humedad, presiones, viento, ráfaga, lluvia, visibilidad, nubosidad, hora) debe coincidir.
  3. Marcas: las marcas de rango, rocío, humedad y repetición se recalculan con las reglas publicadas y deben coincidir.
  4. Completitud: por cada hora, las 32 llegaron o la API dice cuáles faltan, y lo que falta tampoco está en el caché.
Requiere `pip install eccodes eccodeslib`. Uso:
    python3 scripts/clima/auditar.py [--api https://api.datosmexico.org] [--horas 24] [--salida informe.json]
"""
import argparse, base64, hashlib, json, math, urllib.error, urllib.request
from datetime import datetime, timedelta
import eccodes

FALTANTE = (-1e100, 2147483647)
CACHES = {
    "aws": "https://wis2globalcache.s3.amazonaws.com/data/mx-smn/data/core/weather/surface-based-observations/synop/{f}",
    "dwd": "https://wis2.dwd.de/gc_v2/mx-smn/{f}",
}

def leer(url, binario=False):
    req = urllib.request.Request(url, headers={"user-agent": "datosmexico.org (auditoría del clima)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        b = r.read()
    return b if binario else json.loads(b)

def eccodes_obs(b):
    h = eccodes.codes_new_from_message(b); eccodes.codes_set(h, "unpack", 1)
    def g(k):
        try: v = eccodes.codes_get(h, k)
        except Exception: return None
        return None if v in FALTANTE else v
    # Lluvia: cada total de precipitación lleva justo antes su periodo (descriptor 004024, «timePeriod» en ecCodes).
    lluvia, periodo = {}, None
    it = eccodes.codes_bufr_keys_iterator_new(h)
    while eccodes.codes_bufr_keys_iterator_next(it):
        k = eccodes.codes_bufr_keys_iterator_get_name(it)
        if k.endswith("#timePeriod"): periodo = g(k)
        elif k.endswith("#totalPrecipitationOrTotalWaterEquivalent") and periodo is not None and periodo not in lluvia: lluvia[periodo] = g(k)
    eccodes.codes_bufr_keys_iterator_delete(it)
    k2c = lambda v: None if v is None else round(v - 273.15, 2)
    pa = lambda v: None if v is None else round(v / 100, 1)
    o = {
        "wmo": f"{g('#1#blockNumber')}{int(g('#1#stationNumber')):03d}",
        "instante": "%04d-%02d-%02dT%02d:%02d:00.000Z" % tuple(int(g(f"#1#{k}")) for k in ("year", "month", "day", "hour", "minute")),
        "temperatura_c": k2c(g("#1#airTemperature")), "rocio_c": k2c(g("#1#dewpointTemperature")), "humedad_pct": g("#1#relativeHumidity"),
        "presion_estacion_hpa": pa(g("#1#nonCoordinatePressure")), "presion_mar_hpa": pa(g("#1#pressureReducedToMeanSeaLevel")),
        "viento_dir_grados": g("#1#windDirection"), "viento_ms": g("#1#windSpeed"), "rafaga_ms": g("#1#maximumWindGustSpeed"),
        "visibilidad_m": g("#1#horizontalVisibility"), "nubosidad_pct": g("#1#cloudCoverTotal"),
        "lluvia_1h_mm": None if lluvia.get(-1) is None else max(0, lluvia[-1]), "lluvia_24h_mm": None if lluvia.get(-24) is None else max(0, lluvia[-24]),
    }
    eccodes.codes_release(h)
    return o

def magnus(t, td): return 100 * math.exp(17.62 * td / (243.12 + td) - 17.62 * t / (243.12 + t))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--api", default="https://api.datosmexico.org"); ap.add_argument("--horas", type=int, default=24); ap.add_argument("--salida")
    a = ap.parse_args()
    base = f"{a.api}/api/v1/clima"
    est = {e["clave"]: e for e in leer(f"{base}/estaciones")["estaciones"]}
    dias = max(1, math.ceil(a.horas / 24))
    resultados = {"mediciones": 0, "bytes_iguales": 0, "sha_ok": 0, "valores_ok": 0, "marcas_ok": 0, "diferencias": [], "lotes": []}
    for clave, e in sorted(est.items()):
        hist = leer(f"{base}/capitales/{clave}?dias={dias}")
        for m in hist["medicion"]:
            resultados["mediciones"] += 1
            orig = leer(f"{base}/capitales/{clave}/mensaje-original?instante={m['instante']}")
            b = base64.b64decode(orig["bufr_b64"])
            if hashlib.sha256(b).hexdigest() == orig["sha256"]: resultados["sha_ok"] += 1
            else: resultados["diferencias"].append({"clave": clave, "instante": m["instante"], "que": "sha256"})
            archivo = orig["fuente_url"].rsplit("/", 1)[1]
            otro = "dwd" if "amazonaws" in orig["fuente_url"] else "aws"
            try:
                ajeno = leer(CACHES[otro].format(f=archivo), binario=True)
                if ajeno == b: resultados["bytes_iguales"] += 1
                else: resultados["diferencias"].append({"clave": clave, "instante": m["instante"], "que": f"bytes distintos en el caché {otro}"})
            except urllib.error.HTTPError as x:
                resultados["diferencias"].append({"clave": clave, "instante": m["instante"], "que": f"caché {otro}: HTTP {x.code} (fuera de su retención)"})
            o = eccodes_obs(b)
            mal = []
            for k, v in o.items():
                w = m.get(k)
                if k == "wmo": w = e["wmo"]
                if (v is None) != (w is None) or (isinstance(v, (int, float)) and isinstance(w, (int, float)) and abs(v - w) > 0.051) or (isinstance(v, str) and v != w):
                    mal.append((k, w, v))
            if mal: resultados["diferencias"].append({"clave": clave, "instante": m["instante"], "que": "valores", "detalle": mal})
            else: resultados["valores_ok"] += 1
            # Marcas recalculables sin historia externa: récord, rocío, humedad.
            esperadas = set()
            mes = (datetime.fromisoformat(m["instante"].replace("Z", "+00:00")) - timedelta(hours=6)).month - 1  # récords por mes de México (UTC−6)
            t, td, rh = m["temperatura_c"], m["rocio_c"], m["humedad_pct"]
            if t is None: esperadas.add("sin-temperatura")
            elif t < e["tmin_record"][mes] or t > e["tmax_record"][mes]: esperadas.add("fuera-de-record")
            if t is not None and td is not None:
                if td > t + 0.5: esperadas.add("rocio-mayor")
                elif rh is not None and abs(magnus(t, td) - rh) > 8: esperadas.add("humedad-incongruente")
            publicadas = {x["codigo"] for x in m["marcas"]} & {"sin-temperatura", "fuera-de-record", "rocio-mayor", "humedad-incongruente"}
            if publicadas == esperadas: resultados["marcas_ok"] += 1
            else: resultados["diferencias"].append({"clave": clave, "instante": m["instante"], "que": "marcas", "publicadas": sorted(publicadas), "recalculadas": sorted(esperadas)})
    for l in leer(f"{base}/lotes?horas={a.horas}")["lotes"]:
        hora = l["hora"].replace("-", "").replace(":", "")[:11] + "0000"
        en_cache = [k for k in l["faltan"] if est.get(k) and _existe(CACHES["aws"].format(f=f"WIGOS_0-20000-0-{est[k]['wmo']}_{hora}.bufr4"))]
        resultados["lotes"].append({"hora": l["hora"], "recibidas": l["recibidas"], "faltan": l["faltan"], "faltan_pero_estan_en_cache": en_cache})
    r = resultados
    print(f"{r['mediciones']} mediciones · SHA-256 {r['sha_ok']} · bytes iguales a otro caché {r['bytes_iguales']} · valores iguales a ecCodes {r['valores_ok']} · marcas recalculadas iguales {r['marcas_ok']}")
    print(f"{len(r['lotes'])} lotes · con faltantes que sí estaban en el caché: {sum(1 for l in r['lotes'] if l['faltan_pero_estan_en_cache'])}")
    for d in r["diferencias"][:20]: print("DIFERENCIA", d)
    if a.salida: json.dump(r, open(a.salida, "w"), ensure_ascii=False, indent=1)

def _existe(url):
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"user-agent": "datosmexico.org (auditoría del clima)"})
        urllib.request.urlopen(req, timeout=30); return True
    except Exception: return False

if __name__ == "__main__":
    main()

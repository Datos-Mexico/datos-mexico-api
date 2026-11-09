"""Genera src/clima/estaciones.ts: para cada una de las 32 capitales, el observatorio sinóptico oficial del SMN que la mide, su
aeropuerto testigo y los récords mensuales de temperatura con que se verifica cada lectura.

Fuentes (todas públicas, consultadas al correr el script):
- Capitales y su centro urbano: src/clima/capitales.ts (Marco Geoestadístico del INEGI).
- Observatorios que transmiten a la OMM: lista de estaciones de los mensajes SYNOP del SMN (argumento --wmo, o los 75 de 2026-11-09).
- Coordenadas y altitud de cada observatorio: OSCAR/Surface de la OMM (oscar.wmo.int), la referencia oficial de la red.
- Clave climatológica y récords: catálogo de la Base de Datos Climatológica Nacional del SMN (estaciones_climatologicas.geojson)
  y su archivo «Valores extremos» (Med-Extr/medexNNNNN.txt), que trae la clave OMM de cada observatorio.
- Aeropuertos: aviationweather.gov (NOAA/AWC), solo los que emitieron METAR en las últimas 6 horas.

Reglas declaradas:
- Observatorio de la capital = el sinóptico del SMN más cercano al centro urbano.
- Testigo = el aeropuerto con METAR más cercano al observatorio, válido solo si está a 50 km o menos y con desnivel de 400 m o
  menos; si no, la capital queda «sin testigo» y se dice por qué.
- Rango posible de temperatura por mes = [récord de mínima diaria, récord de máxima diaria] del propio observatorio.

Uso: python3 scripts/clima/generar_estaciones.py <carpeta de caché>
"""
import json, math, os, re, sys, time, urllib.request

RAIZ = os.path.join(os.path.dirname(__file__), "..", "..")
WMO_SMN_2026_11_09 = "76040 76055 76061 76113 76118 76122 76160 76220 76225 76243 76253 76256 76258 76305 76311 76323 76342 76382 76390 76393 76402 76405 76412 76423 76458 76471 76491 76499 76519 76525 76539 76548 76556 76571 76573 76577 76581 76585 76593 76612 76625 76632 76634 76640 76644 76647 76654 76656 76658 76662 76665 76675 76680 76683 76685 76687 76692 76695 76698 76726 76737 76741 76743 76750 76762 76773 76775 76805 76833 76840 76843 76845 76848 76855 76903".split()
TESTIGO_MAX_KM = 50
TESTIGO_MAX_DESNIVEL_M = 400
MESES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

def bajar(url: str, archivo: str, cache: str) -> bytes:
    ruta = os.path.join(cache, archivo)
    if not os.path.exists(ruta):
        req = urllib.request.Request(url, headers={"User-Agent": "datosmexico.org (observatorio; generar_estaciones.py)"})
        open(ruta, "wb").write(urllib.request.urlopen(req, timeout=90).read())
        time.sleep(0.3)
    return open(ruta, "rb").read()

def km(a, b, c, d):
    r = math.radians
    return 2 * 6371 * math.asin(math.sqrt(math.sin(r(c - a) / 2) ** 2 + math.cos(r(a)) * math.cos(r(c)) * math.sin(r(d - b) / 2) ** 2))

def extremos(texto: str) -> dict:
    """De «Valores extremos»: récord de máxima (bloque TEMPERATURA MÁXIMA, columna Valor Máx.) y de mínima (bloque TEMPERATURA
    MÍNIMA, columna Valor Mín.) por mes, con su fecha."""
    bloques = re.split(r"\n(?=TEMPERATURA M[ÁA]XIMA|TEMPERATURA M[ÍI]NIMA|PRECIPITACI)", texto)
    out = {}
    for b in bloques:
        cab = b.strip().split("\n")[0]
        clave = "tmax" if "XIMA" in cab else "tmin" if "NIMA" in cab else None
        if not clave: continue
        filas = {}
        for linea in b.split("\n"):
            c = linea.split("\t")
            if c[0] in MESES:
                # MES, Año ini, Año fin, Núm años, Valor máx, Fecha, Se ha rep, Valor mín, Fecha, Se ha rep, Medio, Desv
                filas[c[0]] = (float(c[4]), c[5], float(c[7]), c[8], int(c[1]))
        out[clave] = filas
    return out

def main(cache: str) -> None:
    os.makedirs(cache, exist_ok=True)
    src = open(os.path.join(RAIZ, "src/clima/capitales.ts"), encoding="utf-8").read()
    capitales = re.findall(r'clave: "(\d+)", estado: "([^"]+)", capital: "([^"]+)", lat: ([-\d.]+), lon: ([-\d.]+)', src)
    oscar = {}
    for w in WMO_SMN_2026_11_09:
        d = json.loads(bajar(f"https://oscar.wmo.int/surface/rest/api/search/station?wigosId=0-20000-0-{w}", f"oscar_{w}.json", cache))
        r = d["stationSearchResults"][0]
        oscar[w] = {"nombre": r["name"], "lat": r["latitude"], "lon": r["longitude"], "altitud": r.get("elevation")}
    catalogo = json.loads(bajar("https://smn.conagua.gob.mx/tools/GUI/estaciones-climatologicas/data/estaciones_climatologicas.geojson", "smn_catalogo.geojson", cache))
    observatorios = [f["properties"] for f in catalogo["features"] if f["properties"].get("tipo") == "OBSERVATORIO"]
    por_wmo = {}
    for p in observatorios:
        t = bajar(p["extremos"], f"medex_{p['clave']}.txt", cache).decode("latin-1").encode("latin-1").decode("utf-8", "replace")
        m = re.search(r"CVE-OMM\s*:\s*(\d+)", t)
        if m: por_wmo[m.group(1)] = (p, extremos(t))
    icaos = "MMAA,MMAS,MMCB,MMCL,MMCM,MMCP,MMCU,MMCV,MMDO,MMEP,MMGL,MMHO,MMIA,MMIO,MMLO,MMLP,MMMD,MMML,MMMM,MMMX,MMMY,MMOX,MMPB,MMQT,MMSM,MMSP,MMTB,MMTG,MMTO,MMVA,MMVR,MMZC,MMAN,MMJA,MMPC,MMCH"
    info = {x["icaoId"]: x for x in json.loads(bajar(f"https://aviationweather.gov/api/data/stationinfo?ids={icaos}&format=json", "awc_estaciones.json", cache))}
    activos = {x["icaoId"] for x in json.loads(bajar(f"https://aviationweather.gov/api/data/metar?ids={icaos}&format=json&hours=6", "awc_metar_6h.json", cache))}
    filas = []
    for clave, estado, capital, lat, lon in capitales:
        lat, lon = float(lat), float(lon)
        d, w = min((km(lat, lon, v["lat"], v["lon"]), k) for k, v in oscar.items())
        o = oscar[w]
        smn, ext = por_wmo[w]
        cands = sorted((km(o["lat"], o["lon"], info[i]["lat"], info[i]["lon"]), i) for i in activos if i in info)
        dk, icao = cands[0]
        desnivel = round((info[icao]["elev"] or 0) - (o["altitud"] or 0))
        motivo = None
        if dk > TESTIGO_MAX_KM: motivo = f"el aeropuerto con METAR más cercano ({icao}) está a {dk:.0f} km"
        elif abs(desnivel) > TESTIGO_MAX_DESNIVEL_M: motivo = f"el aeropuerto con METAR más cercano ({icao}) está {abs(desnivel)} m más {'arriba' if desnivel > 0 else 'abajo'}"
        tmax = [ext["tmax"][m][0] for m in MESES]; tmin = [ext["tmin"][m][2] for m in MESES]
        desde = min(min(ext["tmax"][m][4] for m in MESES), min(ext["tmin"][m][4] for m in MESES))
        filas.append({"clave": clave, "estado": estado, "capital": capital, "wmo": w, "estacion": smn["nombre"], "clicom": smn["clave"],
                      "lat": round(o["lat"], 5), "lon": round(o["lon"], 5), "altitud_m": o["altitud"], "km_capital": round(d, 1),
                      "icao": None if motivo else icao, "aeropuerto": None if motivo else info[icao]["site"],
                      "km_aeropuerto": None if motivo else round(dk, 1), "desnivel_aeropuerto_m": None if motivo else desnivel,
                      "sin_testigo": motivo, "tmax_record": tmax, "tmin_record": tmin, "records_desde": desde})
    lineas = [
        "// Generado por scripts/clima/generar_estaciones.py (OSCAR/Surface de la OMM, Base de Datos Climatológica Nacional del SMN,",
        "// aviationweather.gov). No editar a mano: las reglas de emparejamiento y de testigo están en el script.",
        "export type EstacionCapital = {",
        "  clave: string; estado: string; capital: string;",
        "  /** Observatorio sinóptico del SMN: número OMM, nombre y clave en la Base de Datos Climatológica Nacional. */",
        "  wmo: string; estacion: string; clicom: string; lat: number; lon: number; altitud_m: number; km_capital: number;",
        "  /** Aeropuerto testigo (METAR); nulo si no hay uno a ≤50 km y ≤400 m de desnivel, con el motivo en sin_testigo. */",
        "  icao: string | null; aeropuerto: string | null; km_aeropuerto: number | null; desnivel_aeropuerto_m: number | null; sin_testigo: string | null;",
        "  /** Récords del observatorio por mes (ene…dic), °C: máxima diaria más alta y mínima diaria más baja desde records_desde. */",
        "  tmax_record: number[]; tmin_record: number[]; records_desde: number;",
        "};",
        "export const ESTACIONES: EstacionCapital[] = [",
    ]
    for f in filas: lineas.append("  " + json.dumps(f, ensure_ascii=False) + ",")
    lineas.append("];")
    destino = os.path.join(RAIZ, "src/clima/estaciones.ts")
    open(destino, "w", encoding="utf-8").write("\n".join(lineas) + "\n")
    for f in filas:
        print(f"{f['clave']} {f['capital'][:20]:20} {f['wmo']} {f['estacion'][:24]:24} {f['km_capital']:5} km | {f['icao'] or '—'} {f['km_aeropuerto'] or ''} {f['sin_testigo'] or ''}")

if __name__ == "__main__":
    main(sys.argv[1])

"""Genera src/clima/municipios-smn.ts: para cada una de las 32 capitales, el municipio con que el SMN publica su «Pronóstico
por municipios» (servicio web PronosticoPorMunicipiosGZ, smn.conagua.gob.mx/tools/GUI/webservices/?method=1).

Regla declarada: municipio de la capital = el municipio de la cabecera según el INEGI (Marco Geoestadístico), por clave de
entidad (ides) y nombre (nmun) tal como lo escribe el SMN; se verifica que el punto que el SMN usa para ese municipio esté a
15 km o menos del centro urbano de src/clima/capitales.ts. Si no se cumple, el script se detiene: no se adivina.

Uso: python3 scripts/clima/generar_municipios_smn.py <carpeta de caché>
"""
import gzip, json, math, os, sys, urllib.request

RAIZ = os.path.join(os.path.dirname(__file__), "..", "..")
URL = "https://smn.conagua.gob.mx/tools/GUI/webservices/?method=1"
MAX_KM = 15
# Municipio de la cabecera de cada capital (INEGI), como lo nombra el SMN.
MUNICIPIO = {
    "01": "Aguascalientes", "02": "Mexicali", "03": "La Paz", "04": "Campeche", "05": "Saltillo", "06": "Colima",
    "07": "Tuxtla Gutiérrez", "08": "Chihuahua", "09": "Cuauhtémoc", "10": "Durango", "11": "Guanajuato", "12": "Chilpancingo de los Bravo",
    "13": "Pachuca de Soto", "14": "Guadalajara", "15": "Toluca", "16": "Morelia", "17": "Cuernavaca", "18": "Tepic", "19": "Monterrey",
    "20": "Oaxaca de Juárez", "21": "Puebla", "22": "Querétaro", "23": "Othón P. Blanco", "24": "San Luis Potosí", "25": "Culiacán",
    "26": "Hermosillo", "27": "Centro", "28": "Victoria", "29": "Tlaxcala", "30": "Xalapa", "31": "Mérida", "32": "Zacatecas",
}


def km(a, b, c, d):
    r = math.radians
    return 2 * 6371 * math.asin(math.sqrt(math.sin(r(c - a) / 2) ** 2 + math.cos(r(a)) * math.cos(r(c)) * math.sin(r(d - b) / 2) ** 2))


def main(cache: str) -> None:
    os.makedirs(cache, exist_ok=True)
    ruta = os.path.join(cache, "smn_pronostico_dia.json.gz")
    if not os.path.exists(ruta):
        req = urllib.request.Request(URL, headers={"User-Agent": "datosmexico.org (observatorio; generar_municipios_smn.py)"})
        open(ruta, "wb").write(urllib.request.urlopen(req, timeout=120).read())
    datos = json.loads(gzip.decompress(open(ruta, "rb").read()))
    src = open(os.path.join(RAIZ, "src/clima/capitales.ts"), encoding="utf-8").read()
    capitales = []
    for linea in src.split("\n"):
        if '{ clave: "' in linea:
            g = lambda k: linea.split(f'{k}: ')[1].split(",")[0].strip().strip('"').rstrip(" }")
            capitales.append({"clave": g("clave"), "capital": g("capital"), "lat": float(g("lat")), "lon": float(g("lon"))})
    assert len(capitales) == 32
    filas = []
    for c in capitales:
        cands = {(x["ides"], x["idmun"]): x for x in datos if int(x["ides"]) == int(c["clave"]) and x["nmun"] == MUNICIPIO[c["clave"]]}
        assert len(cands) == 1, f"{c['capital']}: {len(cands)} municipios llamados {MUNICIPIO[c['clave']]} en la entidad {c['clave']}"
        (ides, idmun), x = next(iter(cands.items()))
        d = km(c["lat"], c["lon"], float(x["lat"]), float(x["lon"]))
        assert d <= MAX_KM, f"{c['capital']}: el punto del SMN está a {d:.1f} km"
        filas.append({"clave": c["clave"], "ides": int(ides), "idmun": int(idmun), "municipio": x["nmun"], "lat": float(x["lat"]), "lon": float(x["lon"]), "km_capital": round(d, 1), "dh": int(x["dh"])})
        print(f"{c['clave']} {c['capital']:<28} {x['nmun']:<26} ides {ides:>2} idmun {idmun:>3}  a {d:4.1f} km  dh {x['dh']}")
    cuerpo = ",\n".join("  " + json.dumps(f, ensure_ascii=False) for f in filas)
    open(os.path.join(RAIZ, "src/clima/municipios-smn.ts"), "w", encoding="utf-8").write(
        "// Generado por scripts/clima/generar_municipios_smn.py (servicio web «Pronóstico por municipios» del SMN). No editar a mano.\n"
        "/** Municipio con que el SMN pronostica cada capital: clave de entidad y municipio del SMN, punto que usa y su distancia al centro urbano. */\n"
        "export type MunicipioSmn = { clave: string; ides: number; idmun: number; municipio: string; lat: number; lon: number; km_capital: number; dh: number };\n"
        f"export const MUNICIPIOS_SMN: MunicipioSmn[] = [\n{cuerpo},\n];\n")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/smn-municipios")

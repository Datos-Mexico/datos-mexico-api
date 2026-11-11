"""Genera src/clima/aire-estaciones.ts: para cada capital, las estaciones de monitoreo de la calidad del aire de SINAICA (INECC)
a 15 km o menos de su centro urbano, ordenadas por distancia. La elección de la estación que mide se hace en cada vuelta del
Worker (la más cercana con envío reciente), porque las estaciones se apagan y se prenden: aquí solo se fija la lista.

Fuente: el índice público de SINAICA (https://sinaica.inecc.gob.mx/index.php), que trae embebido el catálogo de sistemas de
monitoreo, redes y estaciones con sus coordenadas (variable `cump`). Medido el 11 de noviembre de 2026: 185 estaciones.

Uso: python3 scripts/clima/generar_aire_estaciones.py <carpeta de caché>
"""
import json, math, os, re, sys, urllib.request

RAIZ = os.path.join(os.path.dirname(__file__), "..", "..")
URL = "https://sinaica.inecc.gob.mx/index.php"
MAX_KM = 15


def km(a, b, c, d):
    r = math.radians
    return 2 * 6371 * math.asin(math.sqrt(math.sin(r(c - a) / 2) ** 2 + math.cos(r(a)) * math.cos(r(c)) * math.sin(r(d - b) / 2) ** 2))


def main(cache: str) -> None:
    os.makedirs(cache, exist_ok=True)
    ruta = os.path.join(cache, "sinaica_index.html")
    if not os.path.exists(ruta):
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (compatible; datosmexico.org observatorio)"})
        open(ruta, "wb").write(urllib.request.urlopen(req, timeout=60).read())
    html = open(ruta, encoding="utf-8").read()
    m = re.search(r"let cump = (\{.*?\});\s*\n", html, re.S)
    assert m, "el índice de SINAICA ya no trae la variable cump"
    cump = json.loads(m.group(1))
    estaciones = []
    for sid, s in cump.items():
        if not isinstance(s, dict): continue
        for rid, r in (s.get("redes") or {}).items():
            for eid, e in (r.get("ests") or {}).items():
                if e.get("lat") is None or e.get("long") is None: continue
                estaciones.append({"id": int(eid), "nombre": e["nom"], "codigo": e.get("cod"), "red": r["nom"], "sistema": s["nom"], "lat": float(e["lat"]), "lon": float(e["long"])})
    assert len(estaciones) > 150, len(estaciones)
    src = open(os.path.join(RAIZ, "src/clima/capitales.ts"), encoding="utf-8").read()
    capitales = []
    for linea in src.split("\n"):
        if '{ clave: "' in linea:
            g = lambda k: linea.split(f"{k}: ")[1].split(",")[0].strip().strip('"').rstrip(" }")
            capitales.append({"clave": g("clave"), "capital": g("capital"), "lat": float(g("lat")), "lon": float(g("lon"))})
    salida = []
    for c in capitales:
        cerca = sorted(({**e, "km": round(km(c["lat"], c["lon"], e["lat"], e["lon"]), 1)} for e in estaciones), key=lambda e: e["km"])
        cerca = [e for e in cerca if e["km"] <= MAX_KM]
        salida.append({"clave": c["clave"], "candidatas": [{"id": e["id"], "nombre": e["nombre"], "red": e["red"], "km": e["km"]} for e in cerca]})
        print(f"{c['clave']} {c['capital']:<28} {len(cerca):>2} candidatas" + (f"; la más cercana {cerca[0]['nombre']} ({cerca[0]['red']}) a {cerca[0]['km']} km" if cerca else ""))
    cuerpo = ",\n".join("  " + json.dumps(x, ensure_ascii=False) for x in salida)
    open(os.path.join(RAIZ, "src/clima/aire-estaciones.ts"), "w", encoding="utf-8").write(
        "// Generado por scripts/clima/generar_aire_estaciones.py (catálogo del índice público de SINAICA, INECC). No editar a mano.\n"
        f"/** Estaciones de calidad del aire a {MAX_KM} km o menos del centro de cada capital, de la más cercana a la más lejana. */\n"
        "export type CandidataAire = { id: number; nombre: string; red: string; km: number };\n"
        f"export const AIRE_ESTACIONES: {{ clave: string; candidatas: CandidataAire[] }}[] = [\n{cuerpo},\n];\n")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/sinaica")

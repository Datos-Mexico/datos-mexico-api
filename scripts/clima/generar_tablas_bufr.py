"""Genera src/clima/bufr-tablas.ts: el subconjunto de las tablas B y D de la OMM (BUFR4) que alcanza a las plantillas
301150 (identificador WIGOS) y 307096 (reporte sinóptico de superficie) con que el SMN publica sus observaciones en WIS2.

Fuente: https://github.com/wmo-im/BUFR4 (etiqueta v46). Reproducible:
    python3 scripts/clima/generar_tablas_bufr.py <carpeta con BUFRCREX_TableB_en_*.csv y BUFR_TableD_en_*.csv>
"""
import csv, glob, os, sys

RAICES = ["301150", "307096"]
VERSION = "v46"

def main(carpeta: str) -> None:
    d: dict[str, list[str]] = {}
    for f in sorted(glob.glob(os.path.join(carpeta, "BUFR_TableD_en_*.csv"))):
        for r in csv.DictReader(open(f, encoding="utf-8-sig")):
            d.setdefault(r["FXY1"], []).append(r["FXY2"])
    b: dict[str, dict] = {}
    for f in sorted(glob.glob(os.path.join(carpeta, "BUFRCREX_TableB_en_*.csv"))):
        for r in csv.DictReader(open(f, encoding="utf-8-sig")):
            b[r["FXY"]] = r
    usados_b: set[str] = set(); usados_d: set[str] = set()
    def recorrer(fxy: str) -> None:
        if fxy[0] == "3":
            if fxy in usados_d: return
            usados_d.add(fxy)
            for h in d[fxy]: recorrer(h)
        elif fxy[0] == "0":
            usados_b.add(fxy)
        elif fxy[0] == "2":
            raise SystemExit(f"operador {fxy} no soportado por el decodificador")
    for r in RAICES: recorrer(r)
    lineas = [
        f"// Generado por scripts/clima/generar_tablas_bufr.py desde las tablas BUFR4 de la OMM ({VERSION}, github.com/wmo-im/BUFR4).",
        "// Solo el subconjunto que alcanzan las plantillas 301150 + 307096 (sinóptica de superficie del SMN). No editar a mano.",
        "/** Tabla B: descriptor → [escala, referencia, ancho en bits, es texto CCITT IA5]. */",
        "export const TABLA_B: Record<string, readonly [number, number, number, boolean]> = {",
    ]
    for k in sorted(usados_b):
        r = b[k]
        lineas.append(f'  "{k}": [{int(r["BUFR_Scale"])}, {int(r["BUFR_ReferenceValue"])}, {int(r["BUFR_DataWidth_Bits"])}, {"true" if r["BUFR_Unit"].strip() == "CCITT IA5" else "false"}],')
    lineas += ["};", "/** Tabla D: secuencia → descriptores que la forman, en orden. */", "export const TABLA_D: Record<string, readonly string[]> = {"]
    for k in sorted(usados_d):
        lineas.append(f'  "{k}": [{", ".join(chr(34) + x + chr(34) for x in d[k])}],')
    lineas.append("};")
    destino = os.path.join(os.path.dirname(__file__), "..", "..", "src", "clima", "bufr-tablas.ts")
    open(destino, "w").write("\n".join(lineas) + "\n")
    print(f"{len(usados_b)} elementos, {len(usados_d)} secuencias → {os.path.normpath(destino)}")

if __name__ == "__main__":
    main(sys.argv[1])

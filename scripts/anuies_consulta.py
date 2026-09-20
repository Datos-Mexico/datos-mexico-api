"""Descarga íntegra del Anuario Estadístico de Educación Superior (ANUIES).

Fuente: https://anuario.anuies.mx/ — la consulta interactiva se sirve por POST (action=consulta)
paginada; el propio sitio ofrece la exportación completa, así que la descarga por páginas es un
uso previsto. Se piden TODAS las variables (matrícula, nuevo ingreso, egresados, lugares
ofertados, titulados, solicitudes) con TODAS las desagregaciones (sexo, edad, discapacidad,
hablantes de lengua indígena, procedencia del nuevo ingreso por entidad y región del extranjero) y TODAS las dimensiones (entidad, municipio, sostenimiento,
ANUIES, clasificación, institución, escuela/campus, nivel, modalidad, campos amplio/específico/
detallado/unitario, carrera), para todas las instituciones, ciclo por ciclo, 2000-2001 a 2025-2026.

Salida: data/anuies/consulta/<ciclo>.jsonl (una fila por línea, tal cual la sirve ANUIES) y
<ciclo>.meta.json (dims, cols, páginas, filas, tiempos, conciliación contra el agregado nacional
que el mismo servicio devuelve sin dimensiones). Reanudable por página. Ritmo: 1 s entre páginas.
"""
import hashlib, json, os, sys, time, urllib.request, uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DIR = RAIZ / "data" / "anuies" / "consulta"
DIR.mkdir(parents=True, exist_ok=True)
LOG = RAIZ / "data" / "anuies" / "consulta.log"
URL = "https://anuario.anuies.mx/"
UA = "Mozilla/5.0 (Macintosh) DatosMexico/1.0 (observatorio academico; https://datosmexico.org)"
CICLOS = [f"{a}-{a+1}" for a in range(2000, 2026)]
VARS = ["MATRÍCULA", "NUEVO INGRESO (NI)", "EGRESADOS", "LUGARES OFERTADOS", "TITULADOS", "SOLICITUDES NI"]
TOTALES = ["MAT_TOTAL", "NI", "E", "LO_REAL", "T", "SNI"]
# procedencia del nuevo ingreso: 8 regiones del extranjero + 32 entidades, códigos del propio formulario de ANUIES
PROCEDENCIA = ["PNI_EUA", "PNI_CAN", "PNI_CAC", "PNI_SUD", "PNI_AFR", "PNI_ASI", "PNI_EUR", "PNI_OCE", "PNI_AGU", "PNI_BC", "PNI_BCS", "PNI_CAM", "PNI_COA", "PNI_COL", "PNI_CHP", "PNI_CHH", "PNI_CDMX", "PNI_DUR", "PNI_GUA", "PNI_GUE", "PNI_HID", "PNI_JAL", "PNI_MEX", "PNI_MIC", "PNI_MOR", "PNI_NAY", "PNI_NL", "PNI_OAX", "PNI_PUE", "PNI_QUE", "PNI_QR", "PNI_SLP", "PNI_SIN", "PNI_SON", "PNI_TAB", "PNI_TAM", "PNI_TLA", "PNI_VER", "PNI_YUC", "PNI_ZAC"]
PAUSA = 1.0

def log(msg):
    linea = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(linea, flush=True)
    with open(LOG, "a") as f: f.write(linea + "\n")

def post(fields, timeout=600):
    b = uuid.uuid4().hex; body = b""
    for k, v in fields:
        body += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    body += f"--{b}--\r\n".encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": f"multipart/form-data; boundary={b}", "User-Agent": UA, "Accept": "application/json"})
    for intento in range(7):
        try:
            t = time.time()
            with urllib.request.urlopen(req, timeout=timeout) as r:
                txt = r.read().decode("utf-8", "replace")
            j = json.loads(txt.lstrip("﻿"))
            if not j.get("ok"): raise RuntimeError(f"ok=false: {str(j.get('error'))[:200]}")
            return j, time.time() - t, len(txt)
        except Exception as e:
            espera = 10 * 2 ** intento
            log(f"  reintento {intento+1}/7 en {espera}s: {type(e).__name__}: {str(e)[:160]}")
            time.sleep(espera)
    raise RuntimeError("agotados los reintentos")

def campos(ciclo, page, page_size, detalle=True):
    f = [("action", "consulta"), ("ciclo", ciclo)]
    f += [("vars[]", v) for v in VARS]
    f += [("desagSexo", "1"), ("desagDiscapacidad", "1"), ("desagEdad", "1"), ("desagHLI", "1"), ("desagProcedencia", "1")]
    f += [("niProcedencia[]", c) for c in PROCEDENCIA]
    inc = "1" if detalle else "0"
    f += [("includeEnts", inc), ("entMode", "all"), ("includeMuns", inc), ("munMode", "all"),
          ("includeSos", inc), ("sosVals", json.dumps(["PARTICULAR", "PÚBLICO"], ensure_ascii=False)),
          ("includeAnuies", inc), ("anuiesVals", json.dumps(["1", "0"])),
          ("includeSub", inc), ("subMode", "all"), ("includeInstitucion", inc), ("includeEscuela", inc),
          ("includeNivel", inc), ("includeModalidad", inc), ("includePrograma", inc), ("includeStem", "0"),
          ("includeCampoAmplio", inc), ("includeCampoEspecifico", inc), ("includeCampoDetallado", inc), ("includeCampoUnitario", inc),
          ("page", str(page)), ("pageSize", str(page_size)), ("maxRows", str(page_size))]
    return f

def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()

def descargar(ciclo):
    meta_p = DIR / f"{ciclo}.meta.json"
    if meta_p.exists() and json.load(open(meta_p)).get("completo"):
        log(f"{ciclo}: ya completo, se omite"); return
    jsonl = DIR / f"{ciclo}.jsonl"
    estado_p = DIR / f"{ciclo}.estado.json"
    estado = json.load(open(estado_p)) if estado_p.exists() else {"paginas": 0, "filas": 0, "page_size": None, "dims": None, "cols": None, "tiempos": []}
    if not jsonl.exists(): estado = {"paginas": 0, "filas": 0, "page_size": None, "dims": None, "cols": None, "tiempos": []}
    page = estado["paginas"] + 1
    page_size = estado["page_size"] or 3000
    log(f"{ciclo}: inicio en página {page} (filas acumuladas {estado['filas']})")
    with open(jsonl, "a") as salida:
        while True:
            j, t, n = post(campos(ciclo, page, page_size))
            meta = j["meta"]; rows = j["rows"]
            if estado["page_size"] is None:
                # el servidor puede adaptar el tamaño de página; fijamos el que devolvió para que todas las páginas sean coherentes
                estado["dims"] = j["dims"]; estado["cols"] = j["cols"]
                if int(meta.get("pageSize", page_size)) != page_size:
                    page_size = int(meta["pageSize"]); log(f"{ciclo}: tamaño de página adaptado por el servidor a {page_size}; se reinicia con ese tamaño")
                    estado["page_size"] = page_size; continue
                estado["page_size"] = page_size
            if int(meta.get("page", page)) != page: raise RuntimeError(f"página devuelta {meta.get('page')} ≠ pedida {page}")
            if int(meta.get("pageSize", page_size)) != page_size: raise RuntimeError(f"pageSize cambió a {meta.get('pageSize')} en la página {page}")
            if j["dims"] != estado["dims"] or [c["key"] for c in j["cols"]] != [c["key"] for c in estado["cols"]]: raise RuntimeError("dims/cols cambiaron entre páginas")
            for r in rows: salida.write(json.dumps(r, ensure_ascii=False) + "\n")
            salida.flush()
            estado["paginas"] = page; estado["filas"] += len(rows); estado["tiempos"].append(round(t, 1))
            json.dump(estado, open(estado_p, "w"))
            log(f"{ciclo}: página {page} filas {len(rows)} ({t:.1f}s, {n/1e6:.1f} MB) acumuladas {estado['filas']} hasMore={meta.get('hasMore')}")
            if not meta.get("hasMore") or not rows: break
            page += 1; time.sleep(PAUSA)
    # conciliación: el agregado nacional sin dimensiones debe coincidir con la suma de las filas detalladas
    time.sleep(PAUSA)
    agg, t, n = post(campos(ciclo, 1, 3000, detalle=False))
    sumas = {k: 0 for k in TOTALES}
    with open(jsonl) as f:
        for linea in f:
            r = json.loads(linea)
            for k in TOTALES:
                v = r.get(k)
                if v not in (None, ""): sumas[k] += int(float(v))
    agregado = {}
    for r in agg["rows"]:
        for k in TOTALES:
            v = r.get(k)
            if v not in (None, ""): agregado[k] = agregado.get(k, 0) + int(float(v))
    coincide = all(sumas.get(k) == agregado.get(k) for k in TOTALES)
    meta_final = {"ciclo": ciclo, "fuente": URL, "descargado_en": time.strftime("%Y-%m-%dT%H:%M:%S"), "paginas": estado["paginas"], "page_size": estado["page_size"], "filas": estado["filas"],
                  "dims": estado["dims"], "cols": estado["cols"], "tiempos_s": estado["tiempos"], "sumas_detalle": sumas, "agregado_nacional": agregado, "agregado_filas": len(agg["rows"]),
                  "conciliacion": "COINCIDE" if coincide else "DIFIERE", "sha256": sha256(jsonl), "bytes": jsonl.stat().st_size, "completo": True}
    json.dump(meta_final, open(meta_p, "w"), ensure_ascii=False, indent=1)
    estado_p.unlink(missing_ok=True)
    log(f"{ciclo}: COMPLETO filas {estado['filas']} páginas {estado['paginas']} conciliación {meta_final['conciliacion']} detalle={sumas} agregado={agregado}")

if __name__ == "__main__":
    ciclos = sys.argv[1:] or CICLOS
    for c in ciclos:
        try: descargar(c)
        except Exception as e: log(f"{c}: ERROR {type(e).__name__}: {e}")
    log("FIN")

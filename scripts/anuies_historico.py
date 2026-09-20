"""Serie histórica de una institución en el Anuario ANUIES (action=historico de anuario.anuies.mx/historico.php).

Devuelve, para la institución pedida, todas las filas de todos los ciclos entre cicloDesde y cicloHasta con
las mismas dimensiones que la consulta por ciclo y una columna CICLO. Sirve para adelantar una institución
(la UNAM) mientras corre la descarga íntegra por ciclo (scripts/anuies_consulta.py); al final, las filas de
la institución en la descarga íntegra deben coincidir con estas (cruce registrado en la bitácora).

Uso: python3 scripts/anuies_historico.py "UNIVERSIDAD NACIONAL AUTÓNOMA DE MÉXICO" [desde] [hasta]
Salida: data/anuies/historico/<clave>.jsonl y <clave>.meta.json. Reanudable por página. 1 s entre páginas.
"""
import hashlib, json, sys, time, unicodedata, urllib.request, uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DIR = RAIZ / "data" / "anuies" / "historico"; DIR.mkdir(parents=True, exist_ok=True)
LOG = RAIZ / "data" / "anuies" / "historico.log"
URL = "https://anuario.anuies.mx/historico.php"
UA = "Mozilla/5.0 (Macintosh) DatosMexico/1.0 (observatorio academico; https://datosmexico.org)"
VARS = ["MATRÍCULA", "NUEVO INGRESO (NI)", "EGRESADOS", "LUGARES OFERTADOS", "TITULADOS", "SOLICITUDES NI"]
PROCEDENCIA = ["PNI_EUA", "PNI_CAN", "PNI_CAC", "PNI_SUD", "PNI_AFR", "PNI_ASI", "PNI_EUR", "PNI_OCE", "PNI_AGU", "PNI_BC", "PNI_BCS", "PNI_CAM", "PNI_COA", "PNI_COL", "PNI_CHP", "PNI_CHH", "PNI_CDMX", "PNI_DUR", "PNI_GUA", "PNI_GUE", "PNI_HID", "PNI_JAL", "PNI_MEX", "PNI_MIC", "PNI_MOR", "PNI_NAY", "PNI_NL", "PNI_OAX", "PNI_PUE", "PNI_QUE", "PNI_QR", "PNI_SLP", "PNI_SIN", "PNI_SON", "PNI_TAB", "PNI_TAM", "PNI_TLA", "PNI_VER", "PNI_YUC", "PNI_ZAC"]
J = lambda a: json.dumps(a, ensure_ascii=False)

def log(msg):
    linea = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"; print(linea, flush=True)
    with open(LOG, "a") as f: f.write(linea + "\n")

def clave(nombre):
    s = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode().lower()
    return "".join(c if c.isalnum() else "-" for c in s).strip("-")

def post(fields, timeout=900):
    b = uuid.uuid4().hex; body = b""
    for k, v in fields: body += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    body += f"--{b}--\r\n".encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": f"multipart/form-data; boundary={b}", "User-Agent": UA, "Accept": "application/json"})
    for intento in range(7):
        try:
            t = time.time()
            with urllib.request.urlopen(req, timeout=timeout) as r: txt = r.read().decode("utf-8", "replace")
            j = json.loads(txt.lstrip("﻿"))
            if not j.get("ok"): raise RuntimeError(f"ok=false: {str(j.get('error'))[:200]}")
            return j, time.time() - t, len(txt)
        except Exception as e:
            espera = 10 * 2 ** intento; log(f"  reintento {intento+1}/7 en {espera}s: {type(e).__name__}: {str(e)[:160]}"); time.sleep(espera)
    raise RuntimeError("agotados los reintentos")

def campos(inst, desde, hasta, page, page_size):
    return [("action", "historico"), ("cicloDesde", desde), ("cicloHasta", hasta), ("vars", J(VARS)),
            ("desagSexo", "1"), ("desagDiscapacidad", "1"), ("desagEdad", "1"), ("desagHLI", "1"), ("niProcedencia", J(PROCEDENCIA)),
            ("includeEnts", "1"), ("entMode", "all"), ("includeMuns", "1"), ("munMode", "all"), ("includeSos", "1"), ("sosVals", J(["PARTICULAR", "PÚBLICO"])),
            ("includeAnuies", "1"), ("anuiesVals", J(["1", "0"])), ("includeSub", "1"), ("subMode", "all"),
            ("includeInstitucion", "1"), ("instMode", "select"), ("institucionesVals", J([inst])), ("includeEscuela", "1"), ("includeNivel", "1"), ("includeModalidad", "1"), ("includePrograma", "1"), ("includeStem", "0"),
            ("includeCampoAmplio", "1"), ("includeCampoEspecifico", "1"), ("includeCampoDetallado", "1"), ("includeCampoUnitario", "1"),
            ("pageSize", str(page_size)), ("page", str(page)), ("maxRows", str(page_size))]

def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()

def descargar(inst, desde, hasta):
    k = clave(inst); jsonl = DIR / f"{k}.jsonl"; estado_p = DIR / f"{k}.estado.json"; meta_p = DIR / f"{k}.meta.json"
    if meta_p.exists() and json.load(open(meta_p)).get("completo"): log(f"{k}: ya completo"); return
    estado = json.load(open(estado_p)) if estado_p.exists() and jsonl.exists() else {"paginas": 0, "filas": 0, "dims": None, "cols": None, "cycles": None, "tiempos": []}
    page = estado["paginas"] + 1; page_size = 3000
    log(f"{k}: inicio en página {page} ({desde}..{hasta})")
    with open(jsonl, "a") as salida:
        while True:
            j, t, n = post(campos(inst, desde, hasta, page, page_size)); meta = j["meta"]; rows = j["rows"]
            if estado["dims"] is None: estado["dims"], estado["cols"], estado["cycles"] = j["dims"], j["cols"], j.get("cycles")
            if int(meta.get("page", page)) != page or int(meta.get("pageSize", page_size)) != page_size: raise RuntimeError(f"paginación inesperada: {meta}")
            if j["dims"] != estado["dims"] or [c["key"] for c in j["cols"]] != [c["key"] for c in estado["cols"]]: raise RuntimeError("dims/cols cambiaron entre páginas")
            for r in rows: salida.write(json.dumps(r, ensure_ascii=False) + "\n")
            salida.flush(); estado["paginas"] = page; estado["filas"] += len(rows); estado["tiempos"].append(round(t, 1)); json.dump(estado, open(estado_p, "w"))
            log(f"{k}: página {page} filas {len(rows)} ({t:.1f}s, {n/1e6:.1f} MB) acumuladas {estado['filas']} hasMore={meta.get('hasMore')}")
            if not meta.get("hasMore") or not rows: break
            page += 1; time.sleep(1.0)
    por_ciclo = {}
    with open(jsonl) as f:
        for linea in f:
            r = json.loads(linea); por_ciclo[r["CICLO"]] = por_ciclo.get(r["CICLO"], 0) + 1
    meta_final = {"institucion": inst, "clave": k, "desde": desde, "hasta": hasta, "fuente": URL, "descargado_en": time.strftime("%Y-%m-%dT%H:%M:%S"), "paginas": estado["paginas"], "filas": estado["filas"],
                  "filas_por_ciclo": dict(sorted(por_ciclo.items())), "dims": estado["dims"], "cols": estado["cols"], "cycles": estado["cycles"], "tiempos_s": estado["tiempos"], "sha256": sha256(jsonl), "bytes": jsonl.stat().st_size, "completo": True}
    json.dump(meta_final, open(meta_p, "w"), ensure_ascii=False, indent=1); estado_p.unlink(missing_ok=True)
    log(f"{k}: COMPLETO filas {estado['filas']} páginas {estado['paginas']} ciclos {len(por_ciclo)}")

if __name__ == "__main__":
    inst = sys.argv[1]; desde = sys.argv[2] if len(sys.argv) > 2 else "2000-2001"; hasta = sys.argv[3] if len(sys.argv) > 3 else "2025-2026"
    try: descargar(inst, desde, hasta)
    except Exception as e: log(f"ERROR {type(e).__name__}: {e}")

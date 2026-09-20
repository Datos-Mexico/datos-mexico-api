#!/usr/bin/env python3
"""Verifica la capa de cubos contra una API (local o producción): catálogo, fichas, miembros, consultas predeterminadas de
todos los cubos, formatos, jerarquías, dimensiones virtuales, errores, y cruces de cifras contra los endpoints del dominio.
Uso: python3 scripts/verificar_cubos.py [https://api.datosmexico.org]
"""
import json, sys, time, urllib.parse, urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8788").rstrip("/")
fallos = []

def get(path, esperado=200, raw=False):
    req = urllib.request.Request(BASE + path, headers={"accept": "application/json", "user-agent": "curl/8.7.1 datosmexico-verificador"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            cuerpo = r.read(); status = r.status; headers = dict(r.headers)
    except urllib.error.HTTPError as e:
        cuerpo = e.read(); status = e.code; headers = dict(e.headers)
    ms = int((time.time() - t0) * 1000)
    if status != esperado:
        fallos.append(f"{path}: HTTP {status} (esperado {esperado}) {cuerpo[:200]!r}"); print("FALLO", path, status, cuerpo[:200]); return None, ms, headers
    if raw: return cuerpo, ms, headers
    return json.loads(cuerpo), ms, headers

def check(cond, msg):
    if not cond: fallos.append(msg); print("FALLO", msg)
    else: print("ok", msg)

cat, ms, _ = get("/api/v1/cubos")
check(cat and cat["n_cubos"] >= 18, f"catálogo con {cat and cat['n_cubos']} cubos ({ms} ms)")
cubos = [c for t in cat["temas"] for c in t["cubos"]]
for c in cubos:
    f, ms, _ = get(c["ficha_url"])
    check(f and f["filas"] > 0 and f["medidas"] and f["dimensiones"], f"ficha {c['clave']}: {f and f['filas']:,} filas, corte {f and f['corte']} ({ms} ms)")
    d, ms, _ = get(c["datos_url"])
    check(d and d["n"] > 0 and all(col["clave"] in d["filas"][0] for col in d["columnas"]), f"datos {c['clave']}: {d and d['n']} filas, {d and d['ms']} ms en D1 ({ms} ms total)")
    dim0 = f["dimensiones"][0]["clave"]
    m, ms, _ = get(f"/api/v1/cubos/{c['clave']}/miembros?dimension={dim0}&limite=5")
    check(m and m["n"] > 0 and all(k in m["items"][0] for k in ("id", "nombre", "n")), f"miembros {c['clave']}.{dim0}: {m and m['n']} ({ms} ms)")

# formatos
u = "/api/v1/cubos/anuies-matricula/datos?medidas=mat_total&columnas=entidad&f.ciclo=2025-2026"
d, _, _ = get(u); a, _, _ = get(u + "&formato=jsonarrays"); csv, _, h = get(u + "&formato=csv", raw=True)
check(d and d["n"] == 32 and a["n"] == 32 and isinstance(a["filas"][0], list) and len(a["filas"][0]) == len(a["columnas"]), "formatos: jsonrecords y jsonarrays con 32 entidades")
check(csv and csv.startswith("﻿".encode()) and csv.count(b"\r\n") == 33 and "text/csv" in h.get("Content-Type", "") and "attachment" in h.get("Content-Disposition", ""), "formato csv: BOM, 33 líneas, adjunto")
check(all(f["entidad_cve"] for f in d["filas"]) and sorted(f["entidad_cve"] for f in d["filas"]) == [f"{i:02d}" for i in range(1, 33)], "claves INEGI de las 32 entidades de ANUIES")
total = sum(f["mat_total"] for f in d["filas"])
resumen, _, _ = get("/api/v1/anuies/ciclos")
oficial = [x for x in resumen["items"] if x["ciclo"] == "2025-2026"][0]["mat_total"]
check(total == oficial, f"cruce ANUIES 2025-2026: suma de entidades {total:,} = ciclo {oficial:,}")

# UNAM por el cubo = UNAM por su endpoint
d, _, _ = get("/api/v1/cubos/anuies-matricula/datos?medidas=mat_total,programas&columnas=ciclo&f.institucion=universidad-nacional-autonoma-de-mexico&orden=ciclo&sentido=desc&limite=1")
s, _, _ = get("/api/v1/unam/anuario/serie")
ult = [x for x in s["items"] if x["ciclo"] == "2025-2026"][0] if "items" in s else None
check(d["filas"][0]["ciclo"] == "2025-2026" and ult and d["filas"][0]["mat_total"] == ult["mat_total"] == 264847, f"cruce UNAM 2025-2026: {d['filas'][0]['mat_total']:,} = serie {ult and ult['mat_total']:,}")

# jerarquía con padres
d, _, _ = get("/api/v1/cubos/anuies-matricula/datos?medidas=mat_total&columnas=carrera&padres=1&f.ciclo=2025-2026&f.institucion=universidad-nacional-autonoma-de-mexico&limite=5")
claves = [c["clave"] for c in d["columnas"]]
check(claves[:4] == ["campo_amplio", "campo_especifico", "campo_detallado", "carrera"], f"padres=1 antepone la jerarquía: {claves}")

# dimensión virtual: edades de la UNAM suman la matrícula de licenciatura reportada por edades
d, _, _ = get("/api/v1/cubos/anuies-edades/datos?medidas=mat_total,ni&columnas=edad&f.ciclo=2025-2026&f.institucion=universidad-nacional-autonoma-de-mexico")
e, _, _ = get("/api/v1/unam/anuario/edades?ciclo=2025-2026")
check(d["n"] == 16 and sum(f["mat_total"] for f in d["filas"]) == e["suma_matricula_edades"] and sum(f["ni"] for f in d["filas"]) == e["suma_ni_edades"], f"virtual edad: 16 grupos, matrícula {sum(f['mat_total'] for f in d['filas']):,} = {e['suma_matricula_edades']:,}")
d2, _, _ = get("/api/v1/cubos/anuies-edades/datos?medidas=mat_total&columnas=nivel&f.ciclo=2025-2026&f.institucion=universidad-nacional-autonoma-de-mexico&f.edad=17|18|19")
check(d2["n"] >= 1 and sum(f["mat_total"] or 0 for f in d2["filas"]) == sum(f["mat_total"] for f in d["filas"] if f["edad_id"] in ("17", "18", "19")), "virtual edad filtrada (17-19) sin desplegarla = suma de esos grupos")
d, _, _ = get("/api/v1/cubos/anuies-procedencia/datos?medidas=ni&columnas=procedencia&f.ciclo=2025-2026&f.institucion=universidad-nacional-autonoma-de-mexico")
p, _, _ = get("/api/v1/unam/anuario/procedencia?ciclo=2025-2026")
check(d["n"] == 40 and sum(f["ni"] or 0 for f in d["filas"]) == p["suma_procedencia"] and sum(1 for f in d["filas"] if f["procedencia_cve"]) == 32, f"virtual procedencia: 40 miembros, suma {sum(f['ni'] or 0 for f in d['filas']):,} = {p['suma_procedencia']:,}, 32 con clave INEGI")

# ENOE: las 32 entidades suman el nacional
d, _, _ = get("/api/v1/cubos/enoe-indicadores-entidad/datos?medidas=ocupados_total&columnas=entidad&f.periodo=2025T1")
n, _, _ = get("/api/v1/cubos/enoe-indicadores-nacional/datos?medidas=ocupados_total&columnas=periodo&f.periodo=2025T1")
check(d["n"] == 32 and sum(f["ocupados_total"] for f in d["filas"]) == n["filas"][0]["ocupados_total"] == 58921494, f"ENOE 2025T1: 32 entidades suman {sum(f['ocupados_total'] for f in d['filas']):,} = nacional")
d, _, _ = get("/api/v1/cubos/enoe-ocupados-sector/datos?medidas=ocupados&columnas=sector&f.periodo=2025T1")
check(d["n"] == 12 and sum(f["ocupados"] for f in d["filas"]) == 58921494 and all(f["sector"] for f in d["filas"]), "ENOE sectores 2025T1: 12 sectores con nombre suman los ocupados")

# Censo: suma de localidades = fila total del INEGI
d, _, _ = get("/api/v1/cubos/censo2020-poblacion/datos?medidas=pobtot,localidades&columnas=entidad&f.entidad=01")
check(d["n"] == 1 and d["filas"][0]["pobtot"] == 1425607, f"Censo Aguascalientes: {d['filas'][0]['pobtot']:,} = 1,425,607")
d, _, _ = get("/api/v1/cubos/censo2020-poblacion/datos?medidas=pobtot&columnas=entidad")
check(d["n"] == 32 and sum(f["pobtot"] for f in d["filas"]) == 126014024, f"Censo nacional: {sum(f['pobtot'] for f in d['filas']):,} = 126,014,024")
d, _, _ = get("/api/v1/cubos/censo2020-poblacion/datos?medidas=pobtot&columnas=localidad&padres=1&f.municipio=01001&limite=3")
check([c["clave"] for c in d["columnas"]][:6] == ["entidad_id", "entidad", "municipio_id", "municipio", "localidad_id", "localidad"], "Censo padres=1: entidad › municipio › localidad")

# CONSAR: SAR total del último mes = endpoint de totales
d, _, _ = get("/api/v1/cubos/consar-recursos/datos?medidas=monto&columnas=mes&f.tipo_recurso=sar_total&orden=mes&sentido=desc&limite=1")
t, _, _ = get("/api/v1/consar/recursos/totales")
ult = t["serie"][-1]
check(d["filas"][0]["mes"] == ult["fecha"] and abs(float(d["filas"][0]["monto"]) - float(ult["monto_mxn_mm"])) < 0.01, f"CONSAR SAR total {d['filas'][0]['mes']}: {d['filas'][0]['monto']:,} = totales {ult['monto_mxn_mm']:,}")

# CDMX: nombramientos = COUNT del padrón
d, _, _ = get("/api/v1/cubos/cdmx-nombramientos/datos?medidas=nombramientos&columnas=sexo")
check(d["n"] in (3, 4) and sum(f["nombramientos"] for f in d["filas"]) == 246836, f"CDMX: {sum(f['nombramientos'] for f in d['filas']):,} nombramientos = 246,836")

# UNAM concurso: seleccionados 2025 febrero escolarizado = encabezados
d, _, _ = get("/api/v1/cubos/unam-concurso/datos?medidas=presentaron,seleccionados,carreras_plantel&columnas=anio&f.concurso=licenciatura&f.sistema=escolarizado&orden=anio&sentido=desc")
check(d["n"] >= 5 and d["filas"][0]["carreras_plantel"] > 100 and d["filas"][0]["seleccionados"] > 0, f"UNAM concurso: {d['n']} años, último {d['filas'][0]}")

# errores
for path, code in [("/api/v1/cubos/no-existe", 404), ("/api/v1/cubos/anuies-matricula/datos?columnas=entidad", 422), ("/api/v1/cubos/anuies-matricula/datos?medidas=nada&columnas=entidad", 422), ("/api/v1/cubos/anuies-matricula/datos?medidas=mat_total&columnas=nada", 422), ("/api/v1/cubos/anuies-matricula/datos?medidas=mat_total&columnas=entidad&orden=zzz", 422), ("/api/v1/cubos/anuies-matricula/miembros", 422), ("/api/v1/cubos/anuies-edades/datos?medidas=mat_total&columnas=edad,procedencia", 422), ("/api/v1/cubos/anuies-matricula/datos?medidas=mat_total&columnas=entidad&formato=xml", 422)]:
    get(path, code)
print("errores 404/422 ok" if not [f for f in fallos if "HTTP" in f] else "errores con fallos")

# límite y limitado
d, _, _ = get("/api/v1/cubos/anuies-matricula/datos?medidas=mat_total&columnas=carrera&f.ciclo=2025-2026&limite=50")
check(d["n"] == 50 and d["limitado"] is True and d["consulta"]["limite"] == 50, "limite=50 → 50 filas y limitado=true")
d, _, _ = get("/api/v1/cubos/anuies-matricula/datos?medidas=mat_total&columnas=entidad&f.ciclo=2025-2026&limite=50")
check(d["n"] == 32 and d["limitado"] is False, "32 entidades con limite=50 → limitado=false")

print("FALLOS", len(fallos))
for f in fallos: print(" -", f)
sys.exit(1 if fallos else 0)

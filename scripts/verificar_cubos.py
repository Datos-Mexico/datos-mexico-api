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
check(cat and cat["n_cubos"] >= 39, f"catálogo con {cat and cat['n_cubos']} cubos ({ms} ms)")
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
check(d["n"] == 32 and sum(f["ocupados_total"] for f in d["filas"]) == n["filas"][0]["ocupados_total"] == 59001009, f"ENOE 2025T1: 32 entidades suman {sum(f['ocupados_total'] for f in d['filas']):,} = nacional")
d, _, _ = get("/api/v1/cubos/enoe-ocupados-sector/datos?medidas=ocupados&columnas=sector&f.periodo=2025T1")
check(d["n"] == 12 and sum(f["ocupados"] for f in d["filas"]) == 59001009 and all(f["sector"] for f in d["filas"]), "ENOE sectores 2025T1: 12 sectores con nombre suman los ocupados")

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

# fase D: ENIGH reproduce by-decil y by-entidad
d, _, _ = get("/api/v1/cubos/enigh-hogares/datos?medidas=hogares,ing_cor,gasto_mon&columnas=decil&orden=decil&sentido=asc")
o, _, _ = get("/api/v1/enigh/hogares/by-decil")
ok_dec = d["n"] == 10 and all(f["hogares"] == x["n_hogares_expandido"] and abs(f["ing_cor"] - x["mean_ing_cor_trim"]) < 0.01 and abs(f["gasto_mon"] - x["mean_gasto_mon_trim"]) < 0.01 for f, x in zip(d["filas"], o))
check(ok_dec, f"ENIGH por decil: 10 deciles, hogares e ingreso promedio iguales a /enigh/hogares/by-decil (decil 1: {d['filas'][0]['ing_cor']:,.2f})")
d, _, _ = get("/api/v1/cubos/enigh-hogares/datos?medidas=hogares,ing_cor&columnas=entidad&f.entidad=19")
o, _, _ = get("/api/v1/enigh/hogares/by-entidad")
nl = [x for x in o if x["clave"] == "19"][0]
check(d["n"] == 1 and d["filas"][0]["hogares"] == nl["n_hogares_expandido"] and abs(d["filas"][0]["ing_cor"] - nl["mean_ing_cor_trim"]) < 0.01 and d["filas"][0]["entidad"] == "Nuevo León", f"ENIGH Nuevo León: {d['filas'][0]['hogares']:,} hogares, ingreso {d['filas'][0]['ing_cor']:,.2f} = by-entidad")
d, _, _ = get("/api/v1/cubos/enigh-hogares/datos?medidas=hogares&columnas=sexo_jefe")
check(sum(f["hogares"] for f in d["filas"]) == 38830230, f"ENIGH hogares expandidos {sum(f['hogares'] for f in d['filas']):,} = 38,830,230")
# BISE: filtro obligatorio, miembros del catálogo, población total 2020
get("/api/v1/cubos/inegi-indicadores/datos?medidas=valor&columnas=geografia", 422)
m, ms, _ = get("/api/v1/cubos/inegi-indicadores/miembros?dimension=indicador&q=poblaci%C3%B3n%20total&limite=20")
check(m and any(i["id"] == "1002000001" for i in m["items"]) and ms < 3000, f"BISE miembros por catálogo: {m and m['n']} coincidencias de 'población total' en {ms} ms")
d, _, _ = get("/api/v1/cubos/inegi-indicadores/datos?medidas=valor&columnas=geografia,periodo&f.indicador=1002000001&f.geografia=00|09&f.periodo=2020")
check(d["n"] == 2 and {f["geografia_id"]: f["valor"] for f in d["filas"]} == {"00": 126014024, "09": 9209944}, "BISE población total 2020: país 126,014,024 y CDMX 9,209,944")
# BISE: dimensión de partición (nivel), catálogos de periodo y nivel, ruta temática en los nombres, árbol
get("/api/v1/cubos/inegi-indicadores/datos?medidas=valor&columnas=periodo&f.indicador=1002000001", 422)
d, _, _ = get("/api/v1/cubos/inegi-indicadores/datos?medidas=valor&columnas=nivel&f.indicador=1002000001&f.periodo=2020")
check(d and {f["nivel"]: f["valor"] for f in d["filas"]}.get("nacional") == 126014024 and {f["nivel"]: f["valor"] for f in d["filas"]}.get("entidad") == 126014024, "BISE agrupado por nivel: nacional = suma de entidades = 126,014,024 (sin triple conteo)")
m, ms, _ = get("/api/v1/cubos/inegi-indicadores/miembros?dimension=periodo&limite=5000")
check(m and m["n"] == 474 and ms < 3000, f"BISE miembros de periodo por catálogo: {m and m['n']} periodos en {ms} ms")
m, _, _ = get("/api/v1/cubos/inegi-indicadores/miembros?dimension=nivel")
check(m and [i["id"] for i in m["items"]] == ["nacional", "entidad", "municipio"], "BISE miembros de nivel: nacional, entidad, municipio")
m, _, _ = get("/api/v1/cubos/inegi-indicadores/miembros?dimension=indicador&q=1002000001")
check(m and m["items"] and " › " in m["items"][0]["nombre"] and "n.º" in m["items"][0]["nombre"], f"BISE nombre con ruta temática: {m and m['items'] and m['items'][0]['nombre']}")
a, _, _ = get("/api/v1/inegi/arbol")
check(a and sum(t["n_indicadores"] for t in a["subtemas"]) == 31045 and len(a["subtemas"]) == 4, "árbol del INEGI: 4 temas raíz con 31,045 relaciones indicador-tema")
r, _, _ = get("/api/v1/inegi/resumen")
check(r and r["arbol"]["temas"] == 182 and r["arbol"]["indicadores_con_ruta"] == 31039, "resumen INEGI: 182 temas, 31,039 indicadores con ruta")
cd, _, _ = get("/api/v1/catalogo/datasets")
cortes = {x["clave"]: x["corte"] for x in (cd if isinstance(cd, list) else cd.get("datasets", cd.get("items", [])))}
check(all(cortes.get(k) and __import__("re").match(p, cortes[k]) for k, p in [("inegi", r"^\d{4}-\d{2}-\d{2}$"), ("denue", r"^\d{4}-\d{2}-\d{2}$"), ("enigh", r"^\d{4}$"), ("enoe", r"^2026T2$")]), f"cortes del catálogo legibles: {cortes}")
# ENOE recalculada: exacta contra el Banco de Indicadores (PEA 2025T1 = 60,491,235; ocupados 2025T1 = 59,001,009)
d, _, _ = get("/api/v1/cubos/enoe-indicadores-nacional/datos?medidas=pea_total,ocupados_total,pob_15ymas&columnas=periodo&f.periodo=2025T1|2026T2")
v = d and {f["periodo"]: f for f in d["filas"]}
check(v and v["2025T1"]["pea_total"] == 60491235 and v["2025T1"]["ocupados_total"] == 59001009 and v["2026T2"]["pea_total"] > 0, f"ENOE nacional 2025T1: PEA {v and v['2025T1']['pea_total']:,}, ocupados {v and v['2025T1']['ocupados_total']:,} = INEGI; 2026T2 presente")
d, _, _ = get("/api/v1/cubos/enoe-indicadores-entidad/datos?medidas=ocupados_total&columnas=periodo&f.periodo=2026T2")
b, _, _ = get("/api/v1/inegi/indicadores/6200093954/observaciones?geografia=00&desde=2026/02&hasta=2026/02")
check(d and b and d["filas"][0]["ocupados_total"] == b["observaciones"][0]["valor"], f"ENOE 2026T2: suma de entidades {d and d['filas'][0]['ocupados_total']:,} = Banco de Indicadores {b and b['observaciones'][0]['valor']:,}")
# Registros vitales: exactos contra el Banco de Indicadores (defunciones 2024 = 819,672; CDMX 67,080; nacimientos 2024 = 1,672,227)
d, _, _ = get("/api/v1/cubos/defunciones-municipio/datos?medidas=defunciones&columnas=entidad&f.anio=2024")
check(d and sum(f["defunciones"] for f in d["filas"]) == 819672 and {f["entidad_id"]: f["defunciones"] for f in d["filas"]}.get("09") == 67080, f"defunciones 2024: {d and sum(f['defunciones'] for f in d['filas']):,} = INEGI 819,672; CDMX 67,080")
c, _, _ = get("/api/v1/cubos/defunciones-causa/datos?medidas=defunciones&columnas=capitulo&f.anio=2024")
l, _, _ = get("/api/v1/cubos/defunciones-lista/datos?medidas=defunciones&columnas=grupo&f.anio=2024")
check(c and l and sum(f["defunciones"] for f in c["filas"]) == 819672 and sum(f["defunciones"] for f in l["filas"]) == 819672 and all(f["capitulo"] for f in c["filas"] if f["capitulo_id"]), "defunciones 2024 por capítulo y por grupo de la lista mexicana suman el total, con nombre")
m, _, _ = get("/api/v1/cubos/defunciones-municipio/datos?medidas=defunciones&columnas=municipio&f.anio=2024&f.entidad=09")
b, _, _ = get("/api/v1/inegi/indicadores/1002000030/observaciones?geografia=09015&desde=2024&hasta=2024")
check(m and b and {f["municipio_id"]: f["defunciones"] for f in m["filas"]}.get("09015") == b["observaciones"][0]["valor"], f"defunciones 2024 Cuauhtémoc (09015) = Banco de Indicadores {b and b['observaciones'][0]['valor']:,}")
n, _, _ = get("/api/v1/cubos/nacimientos-municipio/datos?medidas=nacimientos&columnas=sexo&f.anio=2024")
e, _, _ = get("/api/v1/cubos/nacimientos-madre/datos?medidas=nacimientos&columnas=edad_madre&f.anio=2024")
check(n and e and sum(f["nacimientos"] for f in n["filas"]) == 1672227 and sum(f["nacimientos"] for f in e["filas"]) == 1672227 and {str(f["sexo_id"]): f["nacimientos"] for f in n["filas"]}.get("1") == 846919, f"nacimientos 2024: {n and sum(f['nacimientos'] for f in n['filas']):,} = INEGI 1,672,227 (hombres 846,919); por edad de la madre suma igual")
# ENIGH ampliada: personas, viviendas, gastos e ingresos reproducen las sumas directas de sus tablas
d, _, _ = get("/api/v1/cubos/enigh-personas/datos?medidas=personas&columnas=sexo")
check(d and sum(f["personas"] for f in d["filas"]) == 130325969, f"ENIGH personas expandidas {d and sum(f['personas'] for f in d['filas']):,} = 130,325,969")
d, _, _ = get("/api/v1/cubos/enigh-viviendas/datos?medidas=viviendas&columnas=tenencia")
check(d and sum(f["viviendas"] for f in d["filas"]) == 38356042, f"ENIGH viviendas expandidas {d and sum(f['viviendas'] for f in d['filas']):,} = 38,356,042")
d, _, _ = get("/api/v1/cubos/enigh-gastos/datos?medidas=gasto&columnas=tipo_gasto")
check(d and abs({f["tipo_gasto_id"]: f["gasto"] for f in d["filas"]}.get("G1", 0) - 1710635640154.41) < 1, "ENIGH gasto monetario G1 = 1,710,635,640,154.41")
d, _, _ = get("/api/v1/cubos/enigh-ingresos/datos?medidas=ingreso&columnas=entidad")
check(d and abs(sum(f["ingreso"] for f in d["filas"]) - 2602301126844.02) < 1 and d["n"] == 32, "ENIGH ingreso trimestral por fuente suma 2,602,301,126,844.02 en 32 entidades")
# Seguridad: ENVIPE reproduce el indicador 6200118581; ENSU reproduce el cuadro 1.7 de junio 2026
d, _, _ = get("/api/v1/cubos/envipe-percepcion/datos?medidas=pct_inseguro,personas&columnas=entidad&f.anio=2026&f.ambito=colonia")
b, _, _ = get("/api/v1/inegi/indicadores/6200118581/observaciones?desde=2026&hasta=2026&limit=100")
ob = b and {o["geografia"]: o["valor"] for o in b["observaciones"]}
check(d and ob and d["n"] == 32 and all(abs({f["entidad_id"]: f["pct_inseguro"] for f in d["filas"]}[g] - ob[g]) < 0.005 for g in ob if g != "00"), "ENVIPE 2026: % inseguro en la colonia = Banco de Indicadores en las 32 entidades (±0.005)")
get("/api/v1/cubos/envipe-percepcion/datos?medidas=personas&columnas=entidad&f.anio=2026", 422)
d, _, _ = get("/api/v1/cubos/ensu-percepcion/datos?medidas=personas,inseguro,seguro&columnas=periodo&f.periodo=2026-06")
check(d and d["filas"][0]["personas"] == 47436033 and d["filas"][0]["inseguro"] == 28363876 and d["filas"][0]["seguro"] == 18982949, f"ENSU junio 2026: {d and d['filas'][0]['personas']:,} personas, {d and d['filas'][0]['inseguro']:,} inseguras = cuadro 1.7 del INEGI")
# ENOE microdatos 2025T2-2026T2 desde los CSV oficiales: conteo exacto, llave con tipo y paginación por cursor
d, _, _ = get("/api/v1/enoe/microdatos/sdem/count?periodo=2026T2")
check(d and d["total"] == 417128, f"ENOE microdatos sdem 2026T2: {d and d['total']:,} filas = CSV del INEGI 417,128")
d, _, _ = get("/api/v1/enoe/microdatos/sdem/list?periodo=2026T2&entidad_clave=09&per_page=3")
d2, _, _ = get(f"/api/v1/enoe/microdatos/sdem/list?periodo=2026T2&entidad_clave=09&per_page=3&cursor={d['pagination']['next_cursor']}") if d and d["pagination"]["next_cursor"] else (None, 0, None)
check(d and d2 and all("tipo" in r for r in d["data"]) and d["data"][-1]["n_ren"] != d2["data"][0]["n_ren"] or (d and d2 and d["data"][-1]["tipo"] != d2["data"][0]["tipo"]), "ENOE microdatos 2026T2: filas con `tipo` y el cursor avanza a filas distintas")
d, _, _ = get("/api/v1/enoe/microdatos/sdem/count?periodo=2025T1")
check(d and d["total"] == 409796, "ENOE microdatos 2025T1 (legado) intacto: 409,796")
s2, _, _ = get("/api/v1/inegi/indicadores?q=desempleo&con_datos=true&limit=5")
check(s2 and s2["total"] >= 4 and "desocupada" in s2["terminos"] and any("desocupada" in i["descripcion"].lower() for i in s2["items"]), f"búsqueda con sinónimos: 'desempleo' → {s2 and s2['total']} indicadores vía {s2 and s2['terminos']} (el primero: {s2 and s2['items'][0]['descripcion'][:40]})")
# ENDUTIH: el porcentaje nacional de usuarios de internet 2025 reproduce el indicador 6206972693
d, _, _ = get("/api/v1/cubos/endutih-usuarios/datos?medidas=pct_internet,pct_computadora,personas&columnas=edicion&f.edicion=2025")
check(d and abs(d["filas"][0]["pct_internet"] - 86.0526459579267) < 0.001 and abs(d["filas"][0]["pct_computadora"] - 38.1445287729211) < 0.001, f"ENDUTIH 2025: internet {d and d['filas'][0]['pct_internet']:.4f} %, computadora {d and d['filas'][0]['pct_computadora']:.4f} % = INEGI")
d, _, _ = get("/api/v1/cubos/enadid-mujeres/datos?medidas=mujeres,embarazadas_alguna_vez&columnas=edicion")
check(d and d["filas"][0]["mujeres"] == 33709740 and d["filas"][0]["embarazadas_alguna_vez"] == 22000554, "ENADID 2023: 33,709,740 mujeres de 15-49 y 22,000,554 alguna vez embarazadas = cuadro 2.1")
d, _, _ = get("/api/v1/cubos/endireh-violencia/datos?medidas=pct_vtot_a,pct_vtot_12m,mujeres&columnas=entidad&f.entidad=01")
check(d and abs(d["filas"][0]["pct_vtot_a"] - 72.8197682037626) < 0.0005 and abs(d["filas"][0]["pct_vtot_12m"] - 48.0408) < 0.001, f"ENDIREH 2021 Aguascalientes: {d and d['filas'][0]['pct_vtot_a']:.4f} % (vida) y {d and d['filas'][0]['pct_vtot_12m']:.4f} % (12 meses) = cuadros 21.1/21.2")
# BIE: resumen, INPC subyacente (serie 334452) agosto 2026 = INEGI, partición de desglose, búsqueda con sinónimos
b, _, _ = get("/api/v1/bie/resumen")
check(b and b["series"] >= 88000 and b["observaciones"] > 8000000 and b["temas"] > 20000, f"BIE: {b and b['series']:,} series, {b and b['observaciones']:,} observaciones, {b and b['temas']:,} temas")
d, _, _ = get("/api/v1/cubos/bie-series/datos?medidas=valor&columnas=periodo&f.serie=334452&f.desglose=Nacional&f.periodo=2026/08")
o, _, _ = get("/api/v1/bie/series/334452/observaciones?area=00&desde=2026/08&hasta=2026/08")
check(d and o and d["n"] == 1 and abs(d["filas"][0]["valor"] - o["observaciones"][0]["valor"]) < 1e-9 and o["observaciones"][0]["valor_texto"], f"BIE INPC subyacente 2026/08: {d and d['filas'][0]['valor']} (texto original {o and o['observaciones'][0]['valor_texto']})")
get("/api/v1/cubos/bie-series/datos?medidas=valor&columnas=periodo&f.serie=334452", 422)
s3, _, _ = get("/api/v1/bie/series?q=inflaci%C3%B3n&limit=3")
check(s3 and s3["total"] > 0 and "precios al consumidor" in s3["terminos"], f"BIE búsqueda 'inflación' → {s3 and s3['total']} series vía {s3 and s3['terminos']}")
# Censo: los otros dos cubos suman igual por entidad (PEA nacional, viviendas)
d, _, _ = get("/api/v1/cubos/censo2020-hogares-vivienda/datos?medidas=pea,vivpar_hab,tothog&columnas=entidad&f.entidad=01")
cl, _, _ = get("/api/v1/censo2020/localidades/01/000/0000")
ind = cl
check(d["n"] == 1 and d["filas"][0]["pea"] == ind["pea"] and d["filas"][0]["vivpar_hab"] == ind["vivpar_hab"] and d["filas"][0]["tothog"] == ind["tothog"], f"Censo Aguascalientes PEA {d['filas'][0]['pea']:,}, viviendas {d['filas'][0]['vivpar_hab']:,}, hogares {d['filas'][0]['tothog']:,} = fila total del INEGI")
d2, _, _ = get("/api/v1/cubos/censo2020-caracteristicas/datos?medidas=p3ym_hli,pcon_disc&columnas=entidad&f.entidad=01")
d3, _, _ = get("/api/v1/cubos/censo2020-hogares-vivienda/datos?medidas=tothog&columnas=entidad")
nac, _, _ = get("/api/v1/censo2020/localidades/00/000/0000")
suma_hog = sum(f["tothog"] for f in d3["filas"]); dif = (nac["tothog"] - suma_hog) / nac["tothog"]
check(d3["n"] == 32 and 0 <= dif < 0.0005, f"Censo hogares nacional: suma de entidades {suma_hog:,} vs total {nac['tothog']:,} (diferencia {dif:.3%}, confidencialidad; tolerancia 0.05 %)")
check(d2["n"] == 1 and d2["filas"][0]["p3ym_hli"] == ind["p3ym_hli"] and d2["filas"][0]["pcon_disc"] == ind["pcon_disc"], f"Censo Aguascalientes HLI {d2['filas'][0]['p3ym_hli']:,} = fila total")
# DENUE preagregado = conteo de unidades; sectores con nombre
d, _, _ = get("/api/v1/cubos/denue-unidades/datos?medidas=unidades&columnas=sector")
r, _, _ = get("/api/v1/denue/resumen")
tot_denue = r["unidades_economicas"]
check(sum(f["unidades"] for f in d["filas"]) == tot_denue == 6138075 and all(f["sector"] and not f["sector"].startswith("Sector ") for f in d["filas"]), f"DENUE: {sum(f['unidades'] for f in d['filas']):,} unidades en {d['n']} sectores con nombre = resumen {tot_denue}")
d, _, _ = get("/api/v1/cubos/denue-unidades/datos?medidas=unidades&columnas=actividad&padres=1&f.entidad=01&limite=5")
check([c["clave"] for c in d["columnas"]][:7] == ["sector_id", "sector", "subsector", "rama", "actividad_id", "actividad", "unidades"], "DENUE padres: sector › subsector › rama › actividad")
# CONSAR precios
d, _, _ = get("/api/v1/cubos/consar-precios/datos?medidas=precio,cotizaciones&columnas=afore&f.siefore=sb%2060-64&f.dia=2025-12-31")
check(d["n"] >= 8 and all(f["cotizaciones"] == 1 for f in d["filas"]), f"CONSAR precios 2025-12-31 SB 60-64: {d['n']} AFOREs con una cotización")

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

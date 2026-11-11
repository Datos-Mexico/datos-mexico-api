"""Genera la base de «lo normal» de cada capital: las normales climatológicas oficiales 1991-2020 del observatorio del SMN y,
del registro diario del mismo observatorio, la distribución de cada día del año en 1991-2020. Escribe un archivo SQL para D1
(data/clima/normales.sql, tablas de src/clima/schema_6.sql) y un cotejo legible (data/clima/normales_cotejo.json).

Fuentes (públicas, consultadas al correr el script), de la Base de Datos Climatológica Nacional del SMN (CONAGUA):
- Normal climatológica 1991-2020 de cada estación (Normales9120/<edo>/nor9120_<clave>.txt): normal mensual y anual de
  temperatura máxima, mínima y media, precipitación y días con lluvia, con los años con datos de cada mes.
- Registro diario histórico de la misma estación (Diarios/<edo>/dia<clave>.txt): precipitación, temperatura máxima y mínima.
- Las direcciones salen del catálogo oficial (estaciones_climatologicas.geojson); la estación de cada capital es la de
  src/clima/estaciones.ts (columna clicom), la misma que mide cada hora.

Reglas declaradas:
- Normal mensual = la publicada por el SMN para el observatorio, tal cual (no se recalcula): la de 1991-2020; si el SMN no la
  publica para esa estación, la de 1981-2010, dicho así; si no publica ninguna, no hay normal oficial y se dice. 13 de las 32
  estaciones no tienen normal 1991-2020 en el catálogo (verificado también por dirección directa, 2026-11-11).
- Distribución de un día del año = todas las máximas (o mínimas) diarias de 1991 a 2020 en una ventana de 15 días centrada en
  esa fecha (7 antes y 7 después; el 29 de febrero se centra en el 28 los años no bisiestos). Se publican la media y los
  percentiles 0, 5, …, 100 (interpolación lineal, tipo 7 de Hyndman y Fan). Con ella se dice qué tan raro es un día: «más
  cálido que el 84 % de los días de esta época en 1991-2020».
- Periodo de la distribución, uno por estación: 1991-2020 si el registro diario tiene 24 años o más con dato (80 % de los 30,
  criterio de la OMM, WMO-No. 1203; año con dato = 292 días o más con máxima); si no, 1981-2010 con la misma regla; si
  tampoco, «referencia»: los años con dato de 1991-2020 (10 o más), que NO es una normal y así se publica; con menos de 10,
  «insuficiente»: no hay con qué comparar y se dice. El registro diario
  del SMN tiene huecos largos entre 2011 y 2016 en varios observatorios: por eso algunas capitales no alcanzan normal.
- Suficiencia por día: los años mínimos del nivel (24, o 10 en referencia) con la ventana casi completa (80 %); si no, el día
  queda sin distribución.
- Limpieza mínima, declarada y contada: se descarta el par del día si la máxima es menor que la mínima, y cualquier valor fuera
  de −30 a 55 °C. Nada más se toca: los récords dudosos del SMN quedan en la distribución (pesan poco en los percentiles).
- Día con lluvia: precipitación ≥ 0.1 mm (es el umbral con que el cotejo reproduce los días con lluvia de la normal oficial).
- Cotejo: la media mensual recalculada desde el registro diario (meses con 20 días o más), en el mismo periodo de la normal
  oficial, se compara con ella; la diferencia por estación y mes queda en el archivo de cotejo.

Uso: python3 scripts/clima/generar_normales.py <carpeta de caché>
"""
import datetime as dt, hashlib, json, math, os, re, sys, time, urllib.request

RAIZ = os.path.join(os.path.dirname(__file__), "..", "..")
CATALOGO = "https://smn.conagua.gob.mx/tools/GUI/estaciones-climatologicas/data/estaciones_climatologicas.geojson"
ANIO_0, ANIO_1 = 1991, 2020
MEDIA_VENTANA = 7
PCTS = list(range(0, 101, 5))
MIN_ANIOS, MIN_FRACCION = 24, 0.8
MIN_ANIOS_REFERENCIA = 10
LLUVIA_MM = 0.1
MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"]
VARIABLES = {"TEMPERATURA MÁXIMA": "tmax", "TEMPERATURA MÍNIMA": "tmin", "TEMPERATURA MEDIA": "tmed", "PRECIPITACIÓN": "lluvia_mm", "NÚMERO DE DÍAS CON LLUVIA": "dias_lluvia"}


def bajar(url: str, archivo: str, cache: str) -> bytes:
    ruta = os.path.join(cache, archivo)
    if not os.path.exists(ruta):
        req = urllib.request.Request(url, headers={"User-Agent": "datosmexico.org (observatorio; generar_normales.py)"})
        for intento in range(3):
            try:
                open(ruta, "wb").write(urllib.request.urlopen(req, timeout=120).read()); break
            except Exception:
                if intento == 2: raise
                time.sleep(3)
        time.sleep(0.3)
    return open(ruta, "rb").read()


def texto(b: bytes) -> str:
    try: return b.decode("utf-8")
    except UnicodeDecodeError: return b.decode("latin-1")


def emision(t: str) -> str | None:
    m = re.search(r"EMISI[ÓO]N\s*:\s*(\d{2})/(\d{2})/(\d{4})", t)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def leer_normal(t: str) -> dict:
    """Normal oficial: {variable: {"normal": [13 valores, ene…dic + anual], "anios": [12]}}."""
    out, actual = {}, None
    for linea in t.split("\n"):
        c = [x.strip() for x in linea.split("\t") if x.strip() != ""]
        if not c: continue
        cab = c[0].upper()
        if len(c) == 1 and cab in VARIABLES: actual = VARIABLES[cab]; out[actual] = {}; continue
        if len(c) == 1: actual = None if cab not in VARIABLES else actual; continue
        if actual is None: continue
        num = lambda v: None if v.upper() in ("NULO", "") else float(v)
        if cab == "NORMAL": out[actual]["normal"] = [num(v) for v in c[1:14]] + [None] * (13 - len(c[1:14]))
        elif cab.startswith("AÑOS CON DATOS") or cab.startswith("ANOS CON DATOS"): out[actual]["anios"] = [int(v) for v in c[1:13]]
    return out


def leer_diario(t: str) -> dict:
    """Registro diario: {fecha: (precip, tmax, tmin)} con None donde dice NULO."""
    out = {}
    for linea in t.split("\n"):
        c = linea.strip().split("\t")
        if len(c) < 5 or not re.match(r"^\d{4}-\d{2}-\d{2}$", c[0]): continue
        v = lambda x: None if x.strip().upper() in ("NULO", "") else float(x)
        out[c[0]] = (v(c[1]), v(c[3]), v(c[4]))
    return out


def percentil(orden: list, p: float) -> float:
    h = (len(orden) - 1) * p / 100
    i = math.floor(h)
    return orden[i] if i + 1 >= len(orden) else orden[i] + (h - i) * (orden[i + 1] - orden[i])


def r1(x): return None if x is None else round(x + 0.0, 1)


def sql(v) -> str:
    if v is None: return "NULL"
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def main(cache: str) -> None:
    os.makedirs(cache, exist_ok=True)
    src = open(os.path.join(RAIZ, "src/clima/estaciones.ts"), encoding="utf-8").read()
    estaciones = [json.loads(l.strip().rstrip(",")) for l in src.split("\n") if l.strip().startswith('{"clave"')]
    assert len(estaciones) == 32, len(estaciones)
    catalogo = {f["properties"]["clave"]: f["properties"] for f in json.loads(bajar(CATALOGO, "smn_catalogo.geojson", cache))["features"]}
    ahora = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    dias_del_anio = [(m, d) for m in range(1, 13) for d in range(1, 32) if not (m == 2 and d > 29) and not (m in (4, 6, 9, 11) and d == 31)]
    assert len(dias_del_anio) == 366
    filas_mes, filas_dia, filas_fuente, cotejo = [], [], [], {}
    for e in estaciones:
        p = catalogo[e["clicom"]]
        periodo, url_normal = next(((per, p[k]) for per, k in (("1991-2020", "normales_1991_2020"), ("1981-2010", "normales_1981_2010")) if p.get(k)), (None, None))
        bn = bajar(url_normal, f"nor_{periodo}_{e['clicom']}.txt", cache) if url_normal else b""
        bd = bajar(p["diarios"], f"dia_{e['clicom']}.txt", cache)
        tn, td = texto(bn), texto(bd)
        if url_normal: assert e["wmo"] in tn or f"{int(e['clicom'])}" in tn, f"{e['capital']}: la normal no es de la estación"
        assert f"ESTACIÓN   : {int(e['clicom'])}" in td or f": {int(e['clicom'])} " in td, f"{e['capital']}: el diario no es de la estación {e['clicom']}"
        normal, diario = (leer_normal(tn) if url_normal else {}), leer_diario(td)
        for var, d in normal.items():
            for i, val in enumerate(d.get("normal", [])[:13]):
                filas_mes.append((e["clave"], var, i + 1, val, d["anios"][i] if i < 12 and "anios" in d else None, periodo))
        # Limpieza declarada.
        descartes = {"tmax_menor_que_tmin": 0, "fuera_de_rango": 0}
        limpio = {}
        for f, (pr, tx, tn_) in diario.items():
            if tx is not None and tn_ is not None and tx < tn_: descartes["tmax_menor_que_tmin"] += 1; tx = tn_ = None
            if tx is not None and not (-30 <= tx <= 55): descartes["fuera_de_rango"] += 1; tx = None
            if tn_ is not None and not (-30 <= tn_ <= 55): descartes["fuera_de_rango"] += 1; tn_ = None
            limpio[f] = (pr, tx, tn_)
        # Periodo de la distribución (uno por estación, el mismo para todos los días): 1991-2020 si tiene 24 años con dato o más
        # (año con dato = 292 días o más con máxima, 80 %); si no, 1981-2010 con la misma regla; si tampoco, «referencia» con los
        # años con dato de 1991-2020 (10 o más), que no es una normal y así se dice.
        dias_anio: dict = {}
        for f, x in limpio.items():
            if x[1] is not None: dias_anio[int(f[:4])] = dias_anio.get(int(f[:4]), 0) + 1
        anios_con_dato = lambda a, b: sum(1 for y in range(a, b + 1) if dias_anio.get(y, 0) >= 292)
        if anios_con_dato(1991, 2020) >= MIN_ANIOS: nivel, a0, a1, min_anios = "normal", 1991, 2020, MIN_ANIOS
        elif anios_con_dato(1981, 2010) >= MIN_ANIOS: nivel, a0, a1, min_anios = "normal", 1981, 2010, MIN_ANIOS
        elif anios_con_dato(1991, 2020) >= MIN_ANIOS_REFERENCIA: nivel, a0, a1, min_anios = "referencia", 1991, 2020, MIN_ANIOS_REFERENCIA
        else: nivel, a0, a1, min_anios = "insuficiente", 1991, 2020, 10**9  # ningún día alcanza: sin distribución, dicho así
        sin_publicar = 0
        for (m, d) in dias_del_anio:
            vals = {"tmax": [], "tmin": []}; anios = {"tmax": set(), "tmin": set()}; lluvia = [0, 0]
            for y in range(a0, a1 + 1):
                centro = dt.date(y, m, d) if not (m == 2 and d == 29 and not (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0))) else dt.date(y, 2, 28)
                for k in range(-MEDIA_VENTANA, MEDIA_VENTANA + 1):
                    x = limpio.get((centro + dt.timedelta(days=k)).isoformat())
                    if not x: continue
                    if x[1] is not None: vals["tmax"].append(x[1]); anios["tmax"].add(y)
                    if x[2] is not None: vals["tmin"].append(x[2]); anios["tmin"].add(y)
                    if x[0] is not None: lluvia[0] += 1; lluvia[1] += 1 if x[0] >= LLUVIA_MM else 0
            fila = [e["clave"], f"{m:02d}-{d:02d}"]
            for var in ("tmax", "tmin"):
                v = sorted(vals[var])
                # Suficiencia por día: los años mínimos del nivel, y en cada uno de esos años la ventana casi completa (80 %).
                suf = len(anios[var]) >= min_anios and len(v) >= MIN_FRACCION * (2 * MEDIA_VENTANA + 1) * min_anios
                if not suf: sin_publicar += 1
                fila += [len(v), len(anios[var]), r1(sum(v) / len(v)) if suf else None, json.dumps([r1(percentil(v, q)) for q in PCTS]) if suf else None]
            fila += [lluvia[0], round(lluvia[1] / lluvia[0], 3) if lluvia[0] >= MIN_FRACCION * (2 * MEDIA_VENTANA + 1) * min_anios else None]
            filas_dia.append(tuple(fila))
        # Cotejo: media mensual recalculada desde el registro diario, en el MISMO periodo de la normal oficial, contra ella.
        pa0, pa1 = (1991, 2020) if periodo == "1991-2020" else (1981, 2010)
        por_mes: dict = {}
        for f, x in limpio.items():
            if pa0 <= int(f[:4]) <= pa1: por_mes.setdefault((int(f[:4]), int(f[5:7])), []).append(x)
        dif = {}
        for var, idx in (("tmax", 1), ("tmin", 2)):
            difs = []
            for mes in range(1, 13):
                medias = []
                for y in range(pa0, pa1 + 1):
                    xs = [x[idx] for x in por_mes.get((y, mes), []) if x[idx] is not None]
                    if len(xs) >= 20: medias.append(sum(xs) / len(xs))
                oficial = normal.get(var, {}).get("normal", [None] * 13)[mes - 1]
                difs.append(None if not medias or oficial is None else round(sum(medias) / len(medias) - oficial, 2))
            dif[var] = difs
        dl = []
        for mes in range(1, 13):
            cuentas = []
            for y in range(pa0, pa1 + 1):
                xs = [x[0] for x in por_mes.get((y, mes), []) if x[0] is not None]
                if len(xs) >= 20: cuentas.append(sum(1 for z in xs if z >= LLUVIA_MM))
            oficial = normal.get("dias_lluvia", {}).get("normal", [None] * 13)[mes - 1]
            dl.append(None if not cuentas or oficial is None else round(sum(cuentas) / len(cuentas) - oficial, 2))
        dif["dias_lluvia"] = dl
        fechas = sorted(diario)
        cotejo[e["clave"]] = {"capital": e["capital"], "clicom": e["clicom"], "wmo": e["wmo"], "descartes": descartes, "dias_sin_distribucion": sin_publicar,
                              "dif_media_recalculada_menos_oficial": dif, "max_abs_dif_c": max((abs(x) for v in ("tmax", "tmin") for x in dif[v] if x is not None), default=None), "normal_periodo": periodo,
                              "distribucion": {"nivel": nivel, "periodo": f"{a0}-{a1}", "anios_con_dato": anios_con_dato(a0, a1)}}
        filas_fuente.append((e["clave"], e["clicom"], e["wmo"], nivel, f"{a0}-{a1}", anios_con_dato(a0, a1), periodo, url_normal, hashlib.sha256(bn).hexdigest() if url_normal else None, emision(tn) if url_normal else None, p["diarios"], hashlib.sha256(bd).hexdigest(), emision(td), fechas[0] if fechas else None, fechas[-1] if fechas else None, ahora, json.dumps(cotejo[e["clave"]], ensure_ascii=False)))
        print(f"{e['clave']} {e['capital']:<28} normal {periodo or 'NINGUNA':<9} {emision(tn) if url_normal else '':<10}  diario {fechas[0]}…{fechas[-1]}  cotejo máx {cotejo[e['clave']]['max_abs_dif_c']}  distribución {nivel} {a0}-{a1} ({anios_con_dato(a0, a1)} años)  descartes {descartes}  sin distribución {sin_publicar}")
    os.makedirs(os.path.join(RAIZ, "data/clima"), exist_ok=True)
    with open(os.path.join(RAIZ, "data/clima/normales.sql"), "w", encoding="utf-8") as f:
        f.write("-- Generado por scripts/clima/generar_normales.py; no editar a mano. Reemplaza todo lo anterior.\n")
        f.write("DELETE FROM clima_normal_mes; DELETE FROM clima_normal_dia; DELETE FROM clima_normal_fuente;\n")
        def lotes(tabla, cols, filas, n):
            for i in range(0, len(filas), n):
                f.write(f"INSERT INTO {tabla} ({cols}) VALUES\n" + ",\n".join("(" + ", ".join(sql(v) for v in r) + ")" for r in filas[i:i + n]) + ";\n")
        lotes("clima_normal_mes", "clave, variable, mes, normal, anios, periodo", filas_mes, 400)
        lotes("clima_normal_dia", "clave, dia, n_tmax, anios_tmax, media_tmax, pct_tmax, n_tmin, anios_tmin, media_tmin, pct_tmin, n_lluvia, frac_lluvia", filas_dia, 150)
        lotes("clima_normal_fuente", "clave, clicom, wmo, distribucion_nivel, distribucion_periodo, distribucion_anios, normal_periodo, normal_url, normal_sha256, normal_emision, diario_url, diario_sha256, diario_emision, diario_desde, diario_hasta, generado_en, cotejo", filas_fuente, 8)
    json.dump(cotejo, open(os.path.join(RAIZ, "data/clima/normales_cotejo.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"filas: mes {len(filas_mes)}, día {len(filas_dia)}, fuente {len(filas_fuente)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/smn-normales")

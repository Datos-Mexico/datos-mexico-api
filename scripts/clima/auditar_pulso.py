"""Auditoría del reporte al pulso de los dos datos del clima oficial (Protocolo DPM, auditoría del observatorio).

Solo lee (SELECT) las tablas de producción con `wrangler d1 execute --remote`; no escribe nada. Pruebas:
  1. Pulso contra sistema, medición (`clima-estaciones`): cada minuto en que el observatorio consultó al SMN (tabla
     `clima_consultas`, fuente «sinoptica») debe tener su resumen en el pulso, con un refresco, y nada más; las
     observaciones reportadas se recalculan desde `clima_medicion` (llegadas de ese minuto sin marcas).
  2. Custodia: de que el caché de la OMM publica cada medición (`publicado_en`, su Last-Modified) a que el observatorio la tiene
     verificada y guardada (`llegado_en`), para las que llegaron en su hora (no las del repaso de horas viejas).
  3. Entrega en vivo (`clima-entrega`): la suma de entregas y la peor latencia del pulso en las últimas 24 h contra las cifras que
     el objeto de la entrega publica por su lado (`/api/v1/clima/entrega`), que se calculan desde su propia tabla.
  4. Puntualidad: proporción de resúmenes que el pulso recibió dentro de los cinco minutos del cierre del minuto.
  5. Comprobación de cara pública y clases: todas las rondas y todos los cambios de clase del periodo.
Uso:
    python3 scripts/clima/auditar_pulso.py --desde 2026-11-09T19:09:00Z [--hasta AAAA-MM-DDTHH:MM:00Z] [--salida informe.json]
"""
import argparse, json, statistics, subprocess, urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

DPM, PLAT = "datosmexico-api-dpm", "datosmexico-api-plataforma"
API = "https://api.datosmexico.org/api/v1/clima"


def consulta(db, sql):
    r = subprocess.run(["npx", "wrangler", "d1", "execute", db, "--remote", "--json", "--command", sql], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)[0]["results"]


def t(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def minuto(s):
    return t(s).replace(second=0, microsecond=0)


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))] if xs else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", required=True)
    ap.add_argument("--hasta")
    ap.add_argument("--salida")
    a = ap.parse_args()
    hasta = a.hasta or (datetime.now(timezone.utc).replace(second=0, microsecond=0) - timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:00Z")
    d, h = a.desde, hasta
    inf = {"periodo": {"desde": d, "hasta": h}}

    # 1 · Medición: consultas del observatorio contra resúmenes del pulso.
    res = consulta(DPM, f"SELECT minuto, refrescos, observaciones, recibido, puntual FROM resumenes WHERE sistema='datos-mexico' AND dato='clima-estaciones' AND minuto >= '{d}' AND minuto < '{h}'")
    con = consulta(PLAT, f"SELECT instante, nuevas FROM clima_consultas WHERE fuente='sinoptica' AND instante >= '{d}' AND instante < '{h}'")
    med = consulta(PLAT, f"SELECT clave, instante, publicado_en, llegado_en, marcas FROM clima_medicion WHERE llegado_en >= '{d}' AND llegado_en < '{h}'")
    por_min_res = {minuto(r["minuto"]): r for r in res}
    por_min_con = defaultdict(int)
    for c in con:
        por_min_con[minuto(c["instante"])] += 1
    limpias = Counter(minuto(m["llegado_en"]) for m in med if m["marcas"] in ("[]", "", None))
    solo_sistema = sorted(set(por_min_con) - set(por_min_res))
    solo_pulso = sorted(set(por_min_res) - set(por_min_con))
    comunes = sorted(set(por_min_con) & set(por_min_res))
    refrescos_mal = [m for m in comunes if por_min_res[m]["refrescos"] != 1]
    obs_dif = [(m, por_min_res[m]["observaciones"], limpias.get(m, 0)) for m in comunes if por_min_res[m]["observaciones"] != limpias.get(m, 0)]
    inf["medicion_pulso_contra_sistema"] = {
        "minutos_con_consulta": len(por_min_con), "resumenes_en_pulso": len(por_min_res), "en_ambos": len(comunes),
        "solo_en_sistema": [m.isoformat() for m in solo_sistema][:20], "solo_en_pulso": [m.isoformat() for m in solo_pulso][:20],
        "refrescos_distintos_de_1": len(refrescos_mal),
        "observaciones_iguales": len(comunes) - len(obs_dif), "observaciones_distintas": [(m.isoformat(), r, s) for m, r, s in obs_dif][:20],
    }

    # 2 · Custodia: publicación en la OMM → guardada en el observatorio (solo las que llegaron en su hora).
    en_hora = [m for m in med if m["publicado_en"] and t(m["llegado_en"]) - t(m["instante"]) < timedelta(hours=1)]
    lat = [(t(m["llegado_en"]) - t(m["publicado_en"])).total_seconds() for m in en_hora]
    edad = [(t(m["llegado_en"]) - t(m["instante"])).total_seconds() / 60 for m in en_hora]
    inf["custodia"] = {
        "mediciones_en_su_hora": len(en_hora), "mediciones_del_repaso": len(med) - len(en_hora),
        "segundos_desde_publicacion_omm": {"mediana": pct(lat, 50), "p95": pct(lat, 95), "max": max(lat) if lat else None, "min": min(lat) if lat else None},
        "minutos_desde_la_hora_de_observacion": {"mediana": pct(edad, 50), "p95": pct(edad, 95), "max": max(edad) if edad else None},
    }

    # 3 · Entrega en vivo: pulso contra las cifras del objeto de la entrega (últimas 24 h).
    hace24 = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:00Z")
    ent = consulta(DPM, f"SELECT minuto, entregas, latencia_entrega_max_ms, puntual FROM resumenes WHERE sistema='datos-mexico' AND dato='clima-entrega' AND minuto >= '{d}' AND minuto < '{h}'")
    ent24 = [e for e in ent if e["minuto"] >= hace24]
    req = urllib.request.Request(f"{API}/entrega", headers={"user-agent": "datosmexico.org (auditoría del clima)"})
    cifras = json.loads(urllib.request.urlopen(req, timeout=30).read())
    inf["entrega"] = {
        "minutos_con_entregas_periodo": len(ent), "entregas_periodo": sum(e["entregas"] or 0 for e in ent),
        "peor_latencia_por_minuto_ms": {"mediana": pct([e["latencia_entrega_max_ms"] for e in ent if e["latencia_entrega_max_ms"] is not None], 50), "max": max((e["latencia_entrega_max_ms"] or 0 for e in ent), default=None)},
        "ultimas_24h_pulso": {"entregas": sum(e["entregas"] or 0 for e in ent24), "peor_ms": max((e["latencia_entrega_max_ms"] or 0 for e in ent24), default=None)},
        "ultimas_24h_objeto": {"n": cifras["latencia_24h"]["n"], "max_ms": cifras["latencia_24h"]["max_ms"], "p50_ms": cifras["latencia_24h"]["p50_ms"], "p95_ms": cifras["latencia_24h"]["p95_ms"]},
        "nota": "Las 24 h del pulso cuentan por minuto reportado y las del objeto por instante de entrega: en el borde de la ventana pueden diferir por una entrega.",
    }

    # 4 · Puntualidad.
    todos = res + ent
    inf["puntualidad"] = {"resumenes": len(todos), "puntuales": sum(1 for r in todos if r["puntual"])}

    # 5 · Comprobación de cara pública y clases.
    comp = consulta(DPM, f"SELECT dato, resultado, COUNT(*) AS n FROM comprobaciones WHERE sistema='datos-mexico' AND dato IN ('clima-estaciones','clima-entrega') AND instante >= '{d}' AND instante < '{h}' GROUP BY dato, resultado")
    cls = consulta(DPM, "SELECT dato, desde, clase FROM clases WHERE sistema='datos-mexico' AND dato IN ('clima-estaciones','clima-entrega') ORDER BY dato, desde")
    inf["comprobacion"] = comp
    inf["clases"] = cls
    print(json.dumps(inf, ensure_ascii=False, indent=1, default=str))
    if a.salida:
        with open(a.salida, "w") as f:
            json.dump(inf, f, ensure_ascii=False, indent=1, default=str)


if __name__ == "__main__":
    main()

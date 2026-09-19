"""Paridad de documentación: compara el openapi del legacy con el nuevo, ruta por ruta.

Para cada ruta migrada verifica: método, summary, description, tags, operationId,
parámetros (nombre, in, required, description, tipo base), y los nombres de las
propiedades del esquema de respuesta 200 (resolviendo $ref y anyOf/nullable).
"""
import sys, json, urllib.request, argparse, datetime

def cargar(u):
    if u.startswith("http"):
        req = urllib.request.Request(u, headers={"accept": "application/json", "user-agent": "paridad-datosmexico/1"})
        with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())
    return json.load(open(u))

def resolver(doc, esquema, visto=None):
    visto = visto or set()
    if not isinstance(esquema, dict): return esquema
    if "$ref" in esquema:
        ref = esquema["$ref"]
        if ref in visto: return {}
        nombre = ref.split("/")[-1]
        return resolver(doc, doc["components"]["schemas"][nombre], visto | {ref})
    if "anyOf" in esquema:
        partes = [resolver(doc, p, visto) for p in esquema["anyOf"]]
        partes = [p for p in partes if p.get("type") != "null"]
        return partes[0] if len(partes) == 1 else {"anyOf": partes}
    if "oneOf" in esquema:
        partes = [resolver(doc, p, visto) for p in esquema["oneOf"]]
        partes = [p for p in partes if p.get("type") != "null"]
        return partes[0] if len(partes) == 1 else {"oneOf": partes}
    return esquema

def forma(doc, esquema, prof=0):
    e = resolver(doc, esquema)
    if not isinstance(e, dict): return "?"
    t = e.get("type")
    if isinstance(t, list): t = [x for x in t if x != "null"]; t = t[0] if len(t) == 1 else t
    if t == "object" and "properties" in e:
        return {k: forma(doc, v, prof + 1) for k, v in e["properties"].items()}
    if t == "array" and "items" in e:
        return [forma(doc, e["items"], prof + 1)]
    return t or ("anyOf" if "anyOf" in e else "?")

def tipo_base(doc, esquema):
    e = resolver(doc, esquema); t = e.get("type") if isinstance(e, dict) else None
    if isinstance(t, list): t = [x for x in t if x != "null"]; t = t[0] if len(t) == 1 else t
    return t

def comparar(legacy, nuevo, rutas):
    lineas = []; ok = 0
    for ruta in rutas:
        l = legacy["paths"].get(ruta, {}).get("get"); n = nuevo["paths"].get(ruta, {}).get("get")
        if not l: lineas.append(f"- ✗ `{ruta}`: no existe en legacy"); continue
        if not n: lineas.append(f"- ✗ `{ruta}`: no existe en nuevo"); continue
        difs = []
        for campo in ("summary", "description", "operationId"):
            if (l.get(campo) or "").strip() != (n.get(campo) or "").strip(): difs.append(f"{campo} distinto")
        if sorted(l.get("tags", [])) != sorted(n.get("tags", [])): difs.append("tags distintos")
        pl = {p["name"]: p for p in l.get("parameters", [])}; pn = {p["name"]: p for p in n.get("parameters", [])}
        for nombre in sorted(set(pl) | set(pn)):
            if nombre not in pl: difs.append(f"param {nombre} sobra en nuevo"); continue
            if nombre not in pn: difs.append(f"param {nombre} falta en nuevo"); continue
            a, b = pl[nombre], pn[nombre]
            if a.get("in") != b.get("in"): difs.append(f"param {nombre}: in")
            if bool(a.get("required")) != bool(b.get("required")): difs.append(f"param {nombre}: required")
            if (a.get("description") or "").strip() != (b.get("description") or "").strip(): difs.append(f"param {nombre}: description")
            if tipo_base(legacy, a.get("schema", {})) != tipo_base(nuevo, b.get("schema", {})): difs.append(f"param {nombre}: tipo {tipo_base(legacy, a.get('schema', {}))} vs {tipo_base(nuevo, b.get('schema', {}))}")
        rl = l.get("responses", {}).get("200", {}).get("content", {}).get("application/json", {}).get("schema")
        rn = n.get("responses", {}).get("200", {}).get("content", {}).get("application/json", {}).get("schema")
        fl, fn = forma(legacy, rl or {}), forma(nuevo, rn or {})
        if fl != fn: difs.append(f"forma de respuesta distinta: {json.dumps(fl, ensure_ascii=False)[:300]} vs {json.dumps(fn, ensure_ascii=False)[:300]}")
        if difs: lineas.append(f"- ✗ `{ruta}`: " + "; ".join(difs))
        else: ok += 1; lineas.append(f"- ✓ `{ruta}`")
    return ok, lineas

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--legacy", default="docs/legacy/openapi-legacy.json")
    ap.add_argument("--nuevo", default="https://datosmexico-api.davidfernando.workers.dev/openapi.json")
    ap.add_argument("--prefijo", default="/api/v1/consar"); ap.add_argument("--reporte", default=None)
    a = ap.parse_args(); legacy = cargar(a.legacy); nuevo = cargar(a.nuevo)
    rutas = [r for r in legacy["paths"] if r.startswith(a.prefijo) and "get" in legacy["paths"][r]]
    ok, lineas = comparar(legacy, nuevo, rutas)
    texto = "\n".join([f"# Paridad de documentación — {a.prefijo}", "", f"Fecha: {datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")}Z", "", f"**{ok}/{len(rutas)} rutas con documentación equivalente.**", ""] + lineas) + "\n"
    print(texto)
    if a.reporte: open(a.reporte, "w").write(texto)
    sys.exit(0 if ok == len(rutas) else 1)

if __name__ == "__main__": main()

"""Comparador de paridad: pide lo mismo al legacy y al nuevo y exige respuestas equivalentes.

Uso: python3 scripts/paridad.py rutas.txt [--nuevo URL] [--legacy URL] [--reporte docs/paridad/x.md]
rutas.txt: una ruta por línea (con query string), líneas con # se ignoran.
Equivalencia: misma estructura JSON; números iguales con tolerancia relativa 1e-9;
strings idénticos; orden de listas idéntico; mismo código HTTP.
"""
import sys, json, math, urllib.request, urllib.error, argparse, datetime

def pedir(base, ruta):
    req = urllib.request.Request(base + ruta, headers={"accept": "application/json", "user-agent": "paridad-datosmexico/1"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try: cuerpo = json.loads(e.read().decode("utf-8"))
        except Exception: cuerpo = None
        return e.code, cuerpo

def diff(a, b, ruta="$", out=None, tol=1e-9):
    out = [] if out is None else out
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a: out.append(f"{ruta}.{k}: falta en legacy")
            elif k not in b: out.append(f"{ruta}.{k}: falta en nuevo")
            else: diff(a[k], b[k], f"{ruta}.{k}", out, tol)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b): out.append(f"{ruta}: longitud {len(a)} vs {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)): diff(x, y, f"{ruta}[{i}]", out, tol)
    elif isinstance(a, bool) or isinstance(b, bool):
        if a != b: out.append(f"{ruta}: {a!r} vs {b!r}")
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if not (a == b or math.isclose(a, b, rel_tol=tol, abs_tol=1e-9)): out.append(f"{ruta}: {a!r} vs {b!r}")
    elif a != b:
        out.append(f"{ruta}: {a!r} vs {b!r}")
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rutas"); ap.add_argument("--legacy", default="https://api.datos-itam.org")
    ap.add_argument("--nuevo", default="https://datosmexico-api.davidfernando.workers.dev")
    ap.add_argument("--reporte", default=None)
    a = ap.parse_args()
    rutas = [l.strip() for l in open(a.rutas) if l.strip() and not l.startswith("#")]
    lineas = []; ok = 0
    for r in rutas:
        sl, jl = pedir(a.legacy, r); sn, jn = pedir(a.nuevo, r)
        if sl != sn:
            lineas.append(f"- ✗ `{r}` — HTTP {sl} legacy vs {sn} nuevo"); continue
        d = diff(jl, jn)
        if d: lineas.append(f"- ✗ `{r}` — {len(d)} diferencias: " + "; ".join(d[:6]))
        else: ok += 1; lineas.append(f"- ✓ `{r}` — HTTP {sl}, idéntico")
    cab = [f"# Paridad — {a.rutas}", "", f"Fecha: {datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")}Z · legacy `{a.legacy}` · nuevo `{a.nuevo}`", "",
           f"**{ok}/{len(rutas)} rutas idénticas.**", ""]
    texto = "\n".join(cab + lineas) + "\n"
    print(texto)
    if a.reporte: open(a.reporte, "w").write(texto)
    sys.exit(0 if ok == len(rutas) else 1)

if __name__ == "__main__": main()

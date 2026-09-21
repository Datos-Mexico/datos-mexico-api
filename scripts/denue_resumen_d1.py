#!/usr/bin/env python3
"""Tabla preagregada del DENUE para el cubo del explorador: unidades económicas por entidad, municipio, clase de
actividad (SCIAN 2018, 6 dígitos) y estrato de personal ocupado. Agrupar las 6,138,075 filas de golpe excede el CPU de D1
(código 7429); por entidad (índice idx_ue_ent_mun) cada INSERT … SELECT tarda ~1-3 s y no mueve datos fuera de D1.
Verifica al final que la suma de `n` sea igual al conteo de la tabla origen.
Uso: python3 scripts/denue_resumen_d1.py
"""
import json, subprocess, sys, time

DB = "datosmexico-api-denue"

def d1(sql):
    r = subprocess.run(["npx", "wrangler", "d1", "execute", DB, "--remote", "--json", "--command", sql], capture_output=True, text=True)
    if r.returncode != 0: raise SystemExit(f"D1 falló: {r.stderr[-400:]}")
    return json.loads(r.stdout)[0]

d1("""CREATE TABLE IF NOT EXISTS denue_resumen (
  cve_ent TEXT NOT NULL, entidad TEXT NOT NULL, cve_mun TEXT NOT NULL, municipio TEXT NOT NULL,
  codigo_act TEXT NOT NULL, nombre_act TEXT NOT NULL, per_ocu TEXT NOT NULL, n INTEGER NOT NULL,
  PRIMARY KEY (cve_ent, cve_mun, codigo_act, per_ocu))""")
ya = d1("SELECT cve_ent, SUM(n) AS n FROM denue_resumen GROUP BY cve_ent")["results"]
hechas = {r["cve_ent"]: r["n"] for r in ya}
for i in range(1, 33):
    ent = f"{i:02d}"
    if ent in hechas: print(f"{ent}: ya cargada ({hechas[ent]:,})"); continue
    t0 = time.time()
    d1(f"""INSERT INTO denue_resumen (cve_ent, entidad, cve_mun, municipio, codigo_act, nombre_act, per_ocu, n)
        SELECT cve_ent, MAX(entidad), cve_mun, MAX(municipio), codigo_act, MAX(nombre_act), per_ocu, COUNT(*)
        FROM unidades_economicas WHERE cve_ent = '{ent}' GROUP BY cve_ent, cve_mun, codigo_act, per_ocu""")
    r = d1(f"SELECT SUM(n) AS n, COUNT(*) AS g FROM denue_resumen WHERE cve_ent = '{ent}'")["results"][0]
    print(f"{ent}: {r['n']:,} unidades en {r['g']:,} grupos ({time.time() - t0:.1f} s)", flush=True)
tot = d1("SELECT (SELECT SUM(n) FROM denue_resumen) AS resumen, (SELECT COUNT(*) FROM unidades_economicas) AS origen, (SELECT COUNT(*) FROM denue_resumen) AS grupos")["results"][0]
print(f"resumen {tot['resumen']:,} = origen {tot['origen']:,} · grupos {tot['grupos']:,}")
if tot["resumen"] != tot["origen"]: sys.exit("NO CUADRA")
d1("CREATE INDEX IF NOT EXISTS idx_denue_resumen_act ON denue_resumen (codigo_act)")
print("ok")

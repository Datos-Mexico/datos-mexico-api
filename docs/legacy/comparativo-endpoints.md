# Comparativo CDMX ↔ ENIGH — contrato de endpoints del router legado

Fuente: `datos-itam/api/app/routers/comparativo.py` (952 líneas) y `datos-itam/api/app/schemas/comparativo.py` (205 líneas).
Documento literal para prueba de paridad: SQL, cadenas, nombres de campo, orden y redondeo se copian tal cual del código.

## Encabezado del router

Docstring del módulo (verbatim):

```
Cross-schema comparativos CDMX ↔ ENIGH (tesis central del observatorio).

Todos los endpoints qualify schema explícitamente (cdmx.* y enigh.*) y
documentan unidades (persona/hogar, mensual/trimestral) en los responses.

Caveat heredado en todos los responses:
  - cdmx.nombramientos es snapshot sin fecha alta/baja; sin filtro temporal.

Caveats específicos:
  - C2/C7: deciles ENIGH = factor-weighted cumulative sum sobre ing_cor
    trimestral (reproducen tabulados INEGI, ±0.15% en 8/10 deciles, plan v2 §1.ter).
  - C3: NO es comparación actuarial. Yuxtapone aportes activos de CDMX vs
    pensiones recibidas hoy por hogares ENIGH.
```

```python
router = APIRouter(prefix="/api/v1/comparativo", tags=["comparativo"])
```

Reglas comunes a los 7 endpoints:

- Todos son `GET`, `async`, sin parámetros de query ni de path. El único parámetro de la función es `request: Request` (requerido por el decorador `@limiter.limit`). No hay `Query(...)`/`Path(...)`; por tanto no hay validación 422 posible salvo que se envíen parámetros desconocidos, que FastAPI ignora.
- Ninguno declara `summary` ni `description` en el decorador: OpenAPI deriva el `summary` del nombre de la función (FastAPI convierte `snake_case` a `Title Case`, p. ej. `ingreso_cdmx_vs_nacional` → «Ingreso Cdmx Vs Nacional») y la `description` del docstring de la función. El docstring se copia verbatim en cada sección.
- Todos declaran en `responses` una entrada `200` con `description` + `example` (solo metadatos OpenAPI; los ejemplos NO coinciden con la forma real del `response_model` en C1, C2, C3, C4, C5, C6 y C7 — son ilustrativos y están desalineados) y una entrada `429: {"model": HTTPError429, "description": "Rate limit excedido."}`.
- Todas las consultas se ejecutan con SQLAlchemy async: `async with engine.connect() as conn:` … `(await conn.execute(text(SQL))).mappings().one()` (o `.all()` en el caso de los bounds de decil de C2). NINGUNA consulta recibe parámetros bind: todo el SQL es texto constante (C5 se construye en import-time a partir de una lista de rubros, pero sigue siendo constante en runtime). No hay ramas dinámicas dependientes del request en ningún endpoint.
- **Cruce de esquemas**: ninguna sentencia SQL individual une (`JOIN`) tablas de `cdmx` con tablas de `enigh`. Los endpoints que comparan ambos esquemas (C1, C2, C3, C7) ejecutan consultas separadas — unas sobre `cdmx.nombramientos`, otras sobre `enigh.*` — dentro de la misma conexión y combinan los resultados en Python. C4, C5 y C6 solo tocan `enigh.*` (el «CDMX» de esos endpoints es el filtro `entidad='09'` de la ENIGH, no el padrón `cdmx`).
- Rate limit (slowapi): la clave es `get_real_ip` (primer valor de `X-Forwarded-For` o, si no existe, `request.client.host`, o `"unknown"`); el limitador está deshabilitado cuando `settings.testing` es verdadero. Al exceder el límite el handler global de `main.py` responde `429` con cuerpo `{"detail": "Rate limit exceeded. Try again later."}`.
- Cache: el middleware `CacheControlMiddleware` de `main.py` aplica a toda ruta que empieza con `/api/v1/comparativo` los headers `Cache-Control: public, max-age=3600` y `Vary: Origin` (agregando `Origin` a `Vary` si no estaba).
- Modelos Pydantic: `from pydantic import BaseModel`, sin `Field`, sin `Literal`, sin validadores. Los `float` se rellenan con `round(x, 2)` o `round(x, 3)` según se indica; los `int` provienen de columnas `::bigint`.

---

## 1. `GET /api/v1/comparativo/ingreso/cdmx-vs-nacional` (C1)

### 1.1 Metadatos

- Función: `ingreso_cdmx_vs_nacional(request: Request)`. `summary` derivado del nombre de la función; `description` = docstring:

```
Compara ingreso mensual en las 3 referencias relevantes.

- CDMX servidor (persona): mean/median de sueldo_bruto mensual
- ENIGH hogar nacional: mean ing_cor trim/3 (ponderado factor)
- ENIGH hogar CDMX (entidad 09): mean ing_cor trim/3 ponderado

Las 3 cifras responden preguntas distintas. Brechas y ratios se calculan
vs servidor mean (base común), pero son ilustrativos — las unidades no
son directamente comparables (persona vs hogar).
```

- `response_model=IngresoComparativoResponse`
- `responses[200].description`: `"Comparativo ingreso CDMX (padrón servidores) vs nacional (ENIGH)."`
- `responses[200]` example (verbatim, NO coincide con el modelo real):

```json
{
    "cdmx_mean_mensual": 16842.33,
    "nacional_mean_mensual": 25954.67,
    "ratio_cdmx_vs_nacional_pct": 64.9,
    "n_cdmx": 246821,
    "n_nacional_expandido": 38845190
}
```

- Rate limit: `@limiter.limit("30/minute")`

### 1.2 Parámetros

Ninguno.

### 1.3 SQL

Tres consultas separadas, en este orden, dentro de una misma conexión; sin parámetros bind; sin ramas dinámicas.

`SQL_C1_CDMX` (esquema `cdmx`):

```sql

SELECT
    AVG(sueldo_bruto)::float AS mean_bruto,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY sueldo_bruto)::float AS median_bruto,
    COUNT(*)::bigint AS n
FROM cdmx.nombramientos
WHERE sueldo_bruto IS NOT NULL
```

`SQL_C1_ENIGH_NAC` (esquema `enigh`):

```sql

SELECT
    (SUM(ing_cor * factor) / SUM(factor) / 3.0)::float AS mean_mensual,
    SUM(factor)::bigint AS n_hogares_exp
FROM enigh.concentradohogar
```

`SQL_C1_ENIGH_CDMX` (esquema `enigh`):

```sql

SELECT
    (SUM(c.ing_cor * c.factor) / SUM(c.factor) / 3.0)::float AS mean_mensual,
    SUM(c.factor)::bigint AS n_hogares_exp
FROM enigh.concentradohogar c
WHERE LEFT(c.ubica_geo, 2) = '09'
```

Ejecución:

```python
async with engine.connect() as conn:
    cdmx = (await conn.execute(text(SQL_C1_CDMX))).mappings().one()
    nac = (await conn.execute(text(SQL_C1_ENIGH_NAC))).mappings().one()
    cdmx_enigh = (await conn.execute(text(SQL_C1_ENIGH_CDMX))).mappings().one()
```

Tablas referenciadas: `cdmx.nombramientos`; `enigh.concentradohogar`. No hay JOIN entre esquemas: se combinan en Python. Nótese que el filtro «CDMX» de la ENIGH aquí es `LEFT(c.ubica_geo, 2) = '09'` sobre `concentradohogar` (no `hogares.entidad`, a diferencia de C4/C5/C6).

### 1.4 Post-procesamiento

```python
servidor_mean = cdmx["mean_bruto"]
nac_mean = nac["mean_mensual"]
cdmx_hog_mean = cdmx_enigh["mean_mensual"]
```

- `cdmx_servidor.unit = "pesos mensuales por persona (servidor público CDMX)"`
- `cdmx_servidor.n_servidores = cdmx["n"]`
- `cdmx_servidor.mean_sueldo_bruto_mensual = round(servidor_mean, 2)`
- `cdmx_servidor.median_sueldo_bruto_mensual = round(cdmx["median_bruto"], 2)`
- `enigh_hogar_nacional.unit = "pesos mensuales por hogar (ing_cor expandido)"`, `scope = "nacional"`, `n_hogares_expandido = nac["n_hogares_exp"]`, `mean_ing_cor_mensual = round(nac_mean, 2)`
- `enigh_hogar_cdmx.unit = "pesos mensuales por hogar (ing_cor expandido)"`, `scope = "entidad 09 — Ciudad de México"`, `n_hogares_expandido = cdmx_enigh["n_hogares_exp"]`, `mean_ing_cor_mensual = round(cdmx_hog_mean, 2)`
- `brecha_mean_servidor_vs_hogar_nacional = round(nac_mean - servidor_mean, 2)`
- `ratio_hogar_nacional_sobre_servidor = round(nac_mean / servidor_mean, 3)`
- `brecha_mean_servidor_vs_hogar_cdmx = round(cdmx_hog_mean - servidor_mean, 2)`
- `ratio_hogar_cdmx_sobre_servidor = round(cdmx_hog_mean / servidor_mean, 3)`
- `note` (verbatim, una sola cadena):

```
Brechas calculadas vs mean_servidor_bruto como base. Las unidades difieren (persona individual vs hogar con múltiples miembros), por lo que la 'brecha' no es equivalente a desigualdad entre personas. Un hogar ENIGH promedio tiene 3.35 personas y combina salarios + pensiones + transferencias + rentas + actividad económica.
```

- `caveats` (lista, en este orden):
  1. `CAVEAT_CDMX_SNAPSHOT` (ver Catálogos)
  2. `CAVEAT_ENIGH_UNIDADES` (ver Catálogos)
  3. `"Cifras ENIGH son trimestrales en microdato; se dividen entre 3 para reportar mensual. Las publicaciones oficiales INEGI reportan mensuales directamente."`

No hay manejo de nulos: si alguna tabla está vacía, `AVG`/`SUM` devuelven NULL → `round(None, 2)` lanza `TypeError` → 500. Si `servidor_mean == 0` → `ZeroDivisionError` → 500.

### 1.5 Modelo de respuesta

```python
class IngresoCdmxServidor(BaseModel):
    unit: str
    n_servidores: int
    mean_sueldo_bruto_mensual: float
    median_sueldo_bruto_mensual: float


class IngresoEnighHogar(BaseModel):
    unit: str
    scope: str
    n_hogares_expandido: int
    mean_ing_cor_mensual: float


class IngresoComparativoResponse(BaseModel):
    cdmx_servidor: IngresoCdmxServidor
    enigh_hogar_nacional: IngresoEnighHogar
    enigh_hogar_cdmx: IngresoEnighHogar
    brecha_mean_servidor_vs_hogar_nacional: float
    ratio_hogar_nacional_sobre_servidor: float
    brecha_mean_servidor_vs_hogar_cdmx: float
    ratio_hogar_cdmx_sobre_servidor: float
    note: str
    caveats: list[str]
```

Valores literales que siempre se emiten: `cdmx_servidor.unit`, `enigh_hogar_nacional.unit`, `enigh_hogar_nacional.scope`, `enigh_hogar_cdmx.unit`, `enigh_hogar_cdmx.scope`, `note`, `caveats` (los tres textos indicados arriba).

### 1.6 Errores

- `429` — `{"detail": "Rate limit exceeded. Try again later."}` (más de 30 peticiones/minuto por IP).
- `500` — no capturado: tablas vacías (`None` en `round`) o `servidor_mean == 0`.
- No hay 404/422 propios.

---

## 2. `GET /api/v1/comparativo/decil-servidores-cdmx` (C2 — tesis central)

### 2.1 Metadatos

- Función: `decil_servidores_cdmx(request: Request)`. `summary` derivado del nombre de la función; `description` = docstring:

```
Mapea percentiles del sueldo servidor CDMX a deciles ENIGH bajo 2 escenarios.

**Escenario A — Perceptor único**: el servidor es la única fuente de
ingreso del hogar. Ingreso hogar ≈ sueldo_bruto servidor directo.

**Escenario B — Servidor + perceptor mediano asalariado**: se asume el
hogar con 2 perceptores: el servidor CDMX más una persona con ingreso
equivalente a la mediana nacional de 'Sueldos, salarios o jornal'
(enigh.ingresos.clave='P001'). Aproximación más defendible que
'2× sueldo servidor' porque no asume que la pareja gana igual; ancla
en una distribución empírica externa (n≈106k perceptores asalariados).

Los deciles ENIGH se definen por bounds min/max de ing_cor trimestral
dividido entre 3 para comparar mensual. Pueden haber huecos estrechos
entre el upper de un decil y el lower del siguiente; el mapeo
devuelve el decil más cercano en esos casos.

TESIS CENTRAL del observatorio: cuantifica el posicionamiento del
servidor público CDMX dentro de la distribución de ingresos hogar a
nivel nacional, con supuestos explícitos y acotación por escenarios.
```

- `response_model=DecilServidoresResponse`
- `responses[200].description`: `"Posición del padrón CDMX en los deciles nacionales ENIGH."`
- `responses[200]` example (verbatim, NO coincide con el modelo real):

```json
{
    "cdmx_mean_mensual": 16842.33,
    "decil_corresponde": 4,
    "decil_bracket": [12500, 18900],
    "tesis_central": "El servidor mediano CDMX se ubica en la frontera d2/d3 como perceptor único; con 2 perceptores alcanza d5."
}
```

- Rate limit: `@limiter.limit("20/minute")`

### 2.2 Parámetros

Ninguno.

### 2.3 SQL

Tres consultas separadas, en este orden; sin parámetros bind; sin ramas dinámicas.

`SQL_C2_CDMX_PCTS` (esquema `cdmx`):

```sql

SELECT
    percentile_cont(0.25) WITHIN GROUP (ORDER BY sueldo_bruto)::float AS p25,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY sueldo_bruto)::float AS p50,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY sueldo_bruto)::float AS p75,
    percentile_cont(0.90) WITHIN GROUP (ORDER BY sueldo_bruto)::float AS p90
FROM cdmx.nombramientos WHERE sueldo_bruto IS NOT NULL
```

`SQL_C2_DECIL_BOUNDS` (esquema `enigh`; se lee con `.mappings().all()`):

```sql

SELECT decil::int AS decil,
       (MIN(ing_cor) / 3.0)::float AS lower_mensual,
       (MAX(ing_cor) / 3.0)::float AS upper_mensual
FROM enigh.concentradohogar WHERE decil IS NOT NULL
GROUP BY decil ORDER BY decil
```

Comentario Python que precede a la tercera consulta (verbatim):

```python
# Mediana perceptor asalariado nacional (clave P001 = "Sueldos, salarios o jornal"
# en enigh.cat_ingresos_cat). n=106,397 perceptores; universal a nivel país.
```

`SQL_C2_MEDIANA_ASALARIADO` (esquema `enigh`):

```sql

SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY ing_tri) / 3.0)::float AS median_mensual
FROM enigh.ingresos WHERE ing_tri > 0 AND clave = 'P001'
```

Ejecución:

```python
async with engine.connect() as conn:
    pct_row = (await conn.execute(text(SQL_C2_CDMX_PCTS))).mappings().one()
    bounds_rows = (await conn.execute(text(SQL_C2_DECIL_BOUNDS))).mappings().all()
    median_asal_row = (await conn.execute(text(SQL_C2_MEDIANA_ASALARIADO))).mappings().one()
```

Tablas referenciadas: `cdmx.nombramientos`; `enigh.concentradohogar`; `enigh.ingresos`. (`enigh.cat_ingresos_cat` se menciona solo en un comentario; NO se consulta.) No hay JOIN entre esquemas: combinación en Python.

### 2.4 Post-procesamiento

Función auxiliar (verbatim):

```python
def _map_ingreso_to_decil(ingreso: float, bounds: list[dict]) -> int | None:
    for b in bounds:
        if b["lower_mensual"] <= ingreso <= b["upper_mensual"]:
            return b["decil"]
    # si excede d10, devolver 10; si es menor a d1, devolver 1
    if ingreso > bounds[-1]["upper_mensual"]:
        return 10
    if ingreso < bounds[0]["lower_mensual"]:
        return 1
    return None
```

Nota de paridad: el docstring dice «devuelve el decil más cercano» en los huecos, pero la implementación devuelve `None` cuando el ingreso cae en un microhueco entre el `upper` de un decil y el `lower` del siguiente (sin estar fuera del rango total). Los valores sentinela son `10` (por encima del upper del último bound) y `1` (por debajo del lower del primero). Las comparaciones usan los valores SIN redondear.

Cuerpo:

```python
bounds = [{"decil": r["decil"], "lower_mensual": r["lower_mensual"],
           "upper_mensual": r["upper_mensual"]} for r in bounds_rows]

median_asalariado = median_asal_row["median_mensual"]

percentiles = [
    ("p25", pct_row["p25"]),
    ("p50", pct_row["p50"]),
    ("p75", pct_row["p75"]),
    ("p90", pct_row["p90"]),
]

# Escenario A: servidor solo
mapeo_a = [
    EscenarioMapeoRow(
        percentil=name,
        ingreso_hogar_supuesto_mensual=round(val, 2),
        decil_hogar_enigh=_map_ingreso_to_decil(val, bounds),
    )
    for name, val in percentiles
]

# Escenario B: servidor + mediana asalariado nacional
mapeo_b = [
    EscenarioMapeoRow(
        percentil=name,
        ingreso_hogar_supuesto_mensual=round(val + median_asalariado, 2),
        decil_hogar_enigh=_map_ingreso_to_decil(val + median_asalariado, bounds),
    )
    for name, val in percentiles
]

decil_p50_a = mapeo_a[1].decil_hogar_enigh
decil_p50_b = mapeo_b[1].decil_hogar_enigh
```

`narrative` (f-string verbatim; `${x:,.0f}` = signo de pesos + separador de miles + 0 decimales):

```python
narrative = (
    f"Bajo Escenario A (servidor CDMX como perceptor único), el servidor "
    f"mediano (sueldo ${pct_row['p50']:,.0f}/mes) cae en el decil {decil_p50_a} "
    f"de ingresos hogar nacional. Bajo Escenario B (servidor + perceptor "
    f"mediano asalariado ${median_asalariado:,.0f}/mes), el hogar total "
    f"${pct_row['p50'] + median_asalariado:,.0f}/mes cae en el decil "
    f"{decil_p50_b}. La diferencia entre escenarios refleja el peso relativo "
    f"del perceptor adicional; ambos escenarios son conservadores porque "
    f"omiten transferencias, rentas y otros componentes del ing_cor ENIGH."
)
```

Caveats interpretativos derivados:

```python
# Distancia p50 al upper del decil donde cayó (para caveat interpretativo)
bound_p50 = next(b for b in bounds if b["decil"] == decil_p50_a)
frontera_distancia = round(bound_p50["upper_mensual"] - pct_row["p50"], 2)
decil_siguiente = decil_p50_a + 1 if decil_p50_a < 10 else decil_p50_a
salto_deciles_b = (decil_p50_b - decil_p50_a) if (decil_p50_b and decil_p50_a) else None
```

- `frontera_distancia` puede ser negativa si `decil_p50_a` fue el sentinela `10` con p50 por encima del upper (no ocurre en la práctica).
- `decil_siguiente == decil_p50_a` cuando `decil_p50_a == 10`.
- `salto_deciles_b` es `None` si alguno de los dos deciles es `None` (o `0`, imposible); se interpola como texto `"None"` en `insight_principal`.

Construcción de la respuesta (verbatim en lo literal):

- `cdmx_servidor` es un `dict` (no un modelo):

```python
cdmx_servidor={
    "unit": "pesos mensuales por persona (sueldo_bruto)",
    "percentiles": [
        PercentilRow(percentil=name, sueldo_mensual=round(val, 2)).model_dump()
        for name, val in percentiles
    ],
},
```

  → `{"unit": "...", "percentiles": [{"percentil": "p25", "sueldo_mensual": …}, {"percentil": "p50", …}, {"percentil": "p75", …}, {"percentil": "p90", …}]}`

- `enigh_deciles_mensuales = [DecilBound(decil=b["decil"], lower_mensual=round(b["lower_mensual"], 2), upper_mensual=round(b["upper_mensual"], 2)) for b in bounds]` — orden ascendente por decil (viene del `ORDER BY decil`).
- `escenarios` (lista de 2, en este orden):
  1. `nombre="A: Perceptor único"`, `supuesto="Servidor CDMX es la única fuente de ingreso del hogar"`, `ingreso_adicional_mensual=0.0`, `mapeo=mapeo_a`
  2. `nombre="B: Servidor + perceptor mediano asalariado"`, `supuesto=` (una sola cadena):

     ```
     Hogar con 2 perceptores: servidor CDMX + persona con ingreso equivalente a la mediana nacional de 'Sueldos, salarios o jornal' (enigh.ingresos.clave='P001', n≈106k perceptores, mediana mensual documentada)
     ```

     `ingreso_adicional_mensual=round(median_asalariado, 2)`, `mapeo=mapeo_b`
- `narrative` = la f-string anterior.
- `caveats` (lista, en este orden):
  1. `CAVEAT_CDMX_SNAPSHOT`
  2. `CAVEAT_DECILES_ENIGH`
  3. `"ENIGH.ing_cor incluye transferencias, rentas, pensiones y actividad económica además del salario. Los escenarios A y B acotan pero subestiman el decil real del hogar servidor CDMX si tiene esas fuentes adicionales."`
  4. `"Escenario B usa mediana P001 como proxy del segundo perceptor; parejas con ingresos asimétricos (mayoría real) darían deciles intermedios entre A y B."`
  5. `"Los bounds de decil son min/max de ing_cor dentro del decil. Un sueldo podría caer entre el upper de un decil y el lower del siguiente si el rango tiene microhuecos; en ese caso el decil inmediato superior o inferior aplica por cercanía."`
- `caveats_interpretativos` (modelo `CaveatsInterpretativos`, f-strings verbatim):

```python
caveats_interpretativos=CaveatsInterpretativos(
    frontera_p50=(
        f"Mediana CDMX ${pct_row['p50']:,.0f} cae a ${frontera_distancia:,.0f} "
        f"del boundary d{decil_p50_a}/d{decil_siguiente} "
        f"(upper d{decil_p50_a} = ${bound_p50['upper_mensual']:,.0f}). "
        f"Pequeña variación en distribución CDMX reclasificaría narrativa."
    ),
    narrativa_correcta=(
        f"Servidor mediano CDMX está EN FRONTERA d{decil_p50_a}/d{decil_siguiente} "
        f"nacional, no firmemente dentro de d{decil_p50_a}."
    ),
    insight_principal=(
        f"La posición socioeconómica del hogar depende más de COMPOSICIÓN "
        f"(número de perceptores) que del salario individual. Agregar un "
        f"perceptor mediano nacional al servidor mediano CDMX mueve el hogar "
        f"{salto_deciles_b} deciles arriba (d{decil_p50_a} → d{decil_p50_b})."
    ),
    implicacion_narrativa=(
        f"Afirmar 'servidor público CDMX = decil {decil_p50_a}' es técnicamente "
        f"correcto bajo supuesto específico (perceptor único) pero engañoso sin "
        f"contexto. La posición real depende de variables no visibles en "
        f"cdmx.nombramientos (¿hay cónyuge? ¿cuánto gana? ¿hay otros perceptores?)."
    ),
),
```

### 2.5 Modelo de respuesta

```python
class PercentilRow(BaseModel):
    percentil: str
    sueldo_mensual: float


class DecilBound(BaseModel):
    decil: int
    lower_mensual: float
    upper_mensual: float


class EscenarioMapeoRow(BaseModel):
    percentil: str
    ingreso_hogar_supuesto_mensual: float
    decil_hogar_enigh: int | None


class EscenarioResponse(BaseModel):
    nombre: str
    supuesto: str
    ingreso_adicional_mensual: float
    mapeo: list[EscenarioMapeoRow]


class CaveatsInterpretativos(BaseModel):
    frontera_p50: str
    narrativa_correcta: str
    insight_principal: str
    implicacion_narrativa: str


class DecilServidoresResponse(BaseModel):
    cdmx_servidor: dict
    enigh_deciles_mensuales: list[DecilBound]
    escenarios: list[EscenarioResponse]
    narrative: str
    caveats: list[str]
    caveats_interpretativos: CaveatsInterpretativos
```

Forma efectiva de `cdmx_servidor` (dict libre): `{"unit": str, "percentiles": [{"percentil": str, "sueldo_mensual": float} × 4]}` con `percentil ∈ {"p25","p50","p75","p90"}` en ese orden. `escenarios[*].mapeo` tiene 4 filas con los mismos `percentil` en el mismo orden.

### 2.6 Errores

- `429` — `{"detail": "Rate limit exceeded. Try again later."}` (más de 20/minuto por IP).
- `500` — no capturado:
  - `bounds` vacío → `bounds[-1]` lanza `IndexError`.
  - `decil_p50_a is None` (p50 en un microhueco) → `next(...)` lanza `StopIteration` (y `decil_p50_a < 10` lanzaría `TypeError`).
  - Tablas vacías → `None` en `round`/aritmética → `TypeError`.

---

## 3. `GET /api/v1/comparativo/aportes-vs-jubilaciones-actuales` (C3)

### 3.1 Metadatos

- Función: `aportes_vs_jubilaciones_actuales(request: Request)`. `summary` derivado del nombre de la función; `description` = docstring:

```
Yuxtaposición descriptiva — NO proyección actuarial.

- CDMX.deducciones (bruto - neto) es el agregado total: ISR + IMSS/ISSSTE
  + SAR + otras deducciones. NO es separable a nivel registro.
- ENIGH.jubilaciones son pensiones CURRENTLY cobradas por hogares ENIGH 2024
  NS, no proyecciones de lo que recibirá un servidor CDMX al jubilarse.
- Los sistemas y las generaciones tienen reglas distintas. La comparación
  útil es magnitud relativa, no equivalencia.
```

- `response_model=AportesVsJubilacionesResponse`
- `responses[200].description`: `"Comparativo aportes SAR (descontados al servidor CDMX) vs jubilación actual ENIGH."`
- `responses[200]` example (verbatim, NO coincide con el modelo real):

```json
{
    "aporte_promedio_mensual_cdmx": 1180.50,
    "jubilacion_actual_promedio_mensual_nacional": 6420.00,
    "ratio_aporte_vs_jubilacion_pct": 18.4
}
```

- Rate limit: `@limiter.limit("20/minute")`

### 3.2 Parámetros

Ninguno.

### 3.3 SQL

Dos consultas separadas, en este orden; sin parámetros bind; sin ramas dinámicas.

`SQL_C3_CDMX` (esquema `cdmx`):

```sql

SELECT
    COUNT(*)::bigint AS n,
    AVG(sueldo_bruto)::float AS mean_bruto,
    AVG(sueldo_neto)::float AS mean_neto,
    AVG(sueldo_bruto - sueldo_neto)::float AS mean_deduc,
    (AVG(CASE WHEN sueldo_bruto > 0
              THEN (sueldo_bruto - sueldo_neto) / sueldo_bruto ELSE NULL END) * 100)::float AS pct_deduc
FROM cdmx.nombramientos
WHERE sueldo_bruto IS NOT NULL AND sueldo_neto IS NOT NULL
```

`SQL_C3_ENIGH_JUB` (esquema `enigh`):

```sql

SELECT
    (SUM(jubilacion * factor) / SUM(factor))::float AS mean_jub_trim_todos,
    (100.0 * SUM(CASE WHEN jubilacion > 0 THEN factor ELSE 0 END) / SUM(factor))::float AS pct_con_jub,
    (SUM(CASE WHEN jubilacion > 0 THEN jubilacion * factor ELSE 0 END) /
     NULLIF(SUM(CASE WHEN jubilacion > 0 THEN factor ELSE 0 END), 0))::float AS mean_jub_trim_solo_jub,
    SUM(CASE WHEN jubilacion > 0 THEN factor ELSE 0 END)::bigint AS n_exp_con_jub
FROM enigh.concentradohogar
```

Ejecución:

```python
async with engine.connect() as conn:
    cdmx = (await conn.execute(text(SQL_C3_CDMX))).mappings().one()
    enigh_row = (await conn.execute(text(SQL_C3_ENIGH_JUB))).mappings().one()
```

Tablas referenciadas: `cdmx.nombramientos`; `enigh.concentradohogar`. No hay JOIN entre esquemas: combinación en Python.

### 3.4 Post-procesamiento

```python
mean_jub_solo_trim = enigh_row["mean_jub_trim_solo_jub"] or 0
```

(Único manejo de nulo del router: si `mean_jub_trim_solo_jub` es NULL —ningún hogar con `jubilacion > 0`— se usa `0`.)

`interpretacion` (f-string verbatim):

```python
interpretacion = (
    f"Mensualmente, un servidor CDMX activo aporta ~${cdmx['mean_deduc']:,.0f} "
    f"en deducciones totales (promedio) — este monto INCLUYE ISR + IMSS/ISSSTE "
    f"+ SAR + otras, sin separación a nivel registro. Simultáneamente, "
    f"{enigh_row['pct_con_jub']:.1f}% de los hogares nacionales reciben "
    f"jubilación, con promedio trimestral ${mean_jub_solo_trim:,.0f} "
    f"(${mean_jub_solo_trim/3:,.0f}/mes) solo para quienes la reciben. "
    f"Son dos realidades coexistentes del sistema de pensiones, no un gap "
    f"actuarial predictivo."
)
```

Campos:

- `cdmx_aportes_actuales.unit = "pesos mensuales por servidor público CDMX"`
- `cdmx_aportes_actuales.n_servidores = cdmx["n"]`
- `cdmx_aportes_actuales.mean_sueldo_bruto = round(cdmx["mean_bruto"], 2)`
- `cdmx_aportes_actuales.mean_sueldo_neto = round(cdmx["mean_neto"], 2)`
- `cdmx_aportes_actuales.mean_deduccion_total = round(cdmx["mean_deduc"], 2)`
- `cdmx_aportes_actuales.pct_deduccion_sobre_bruto = round(cdmx["pct_deduc"], 2)`
- `enigh_jubilaciones_actuales.unit_trim = "pesos trimestrales por hogar"`
- `enigh_jubilaciones_actuales.unit_mes = "pesos mensuales por hogar (trim / 3)"`
- `enigh_jubilaciones_actuales.pct_hogares_con_jubilacion = round(enigh_row["pct_con_jub"], 2)`
- `enigh_jubilaciones_actuales.mean_jubilacion_sobre_todos_trim = round(enigh_row["mean_jub_trim_todos"], 2)`
- `enigh_jubilaciones_actuales.mean_jubilacion_solo_jubilados_trim = round(mean_jub_solo_trim, 2)`
- `enigh_jubilaciones_actuales.mean_jubilacion_solo_jubilados_mensual = round(mean_jub_solo_trim / 3, 2)`
- `enigh_jubilaciones_actuales.n_hogares_con_jubilacion_expandido = enigh_row["n_exp_con_jub"]`
- `interpretacion` = la f-string anterior.
- `caveats` (lista, en este orden):
  1. `CAVEAT_CDMX_SNAPSHOT`
  2. `"cdmx.nombramientos.deducciones (bruto - neto) es el agregado total: INCLUYE ISR + IMSS/ISSSTE + SAR + créditos personales + otras deducciones sin separación posible a nivel registro. Usarla como proxy de 'aporte a pensión' sobreestima el aporte real."`
  3. `"ENIGH.jubilaciones son pensiones CURRENTLY cobradas por hogares del universo ENIGH 2024 NS (18.5% de hogares), no proyección de lo que recibirá un servidor CDMX al jubilarse."`
  4. `"NO es comparación actuarial. El gap deducción CDMX hoy vs jubilación promedio ENIGH hoy NO predice el futuro del servidor CDMX. Sistemas (IMSS-1973, IMSS-1997, ISSSTE-2007, cuentas individuales SAR) y generaciones con reglas distintas."`
  5. `"La comparación útil es magnitud relativa (¿qué fracción del ingreso activo se aporta vs qué fracción del hogar pensionado proviene de jubilación?), no equivalencia 1:1."`

### 3.5 Modelo de respuesta

```python
class CdmxAportesActuales(BaseModel):
    unit: str
    n_servidores: int
    mean_sueldo_bruto: float
    mean_sueldo_neto: float
    mean_deduccion_total: float
    pct_deduccion_sobre_bruto: float


class EnighJubilacionesActuales(BaseModel):
    unit_trim: str
    unit_mes: str
    pct_hogares_con_jubilacion: float
    mean_jubilacion_sobre_todos_trim: float
    mean_jubilacion_solo_jubilados_trim: float
    mean_jubilacion_solo_jubilados_mensual: float
    n_hogares_con_jubilacion_expandido: int


class AportesVsJubilacionesResponse(BaseModel):
    cdmx_aportes_actuales: CdmxAportesActuales
    enigh_jubilaciones_actuales: EnighJubilacionesActuales
    interpretacion: str
    caveats: list[str]
```

### 3.6 Errores

- `429` — `{"detail": "Rate limit exceeded. Try again later."}` (más de 20/minuto por IP).
- `500` — no capturado: tablas vacías (`None` en `round` para los campos distintos de `mean_jub_trim_solo_jub`).

---

## 4. `GET /api/v1/comparativo/actividad-cdmx-vs-nacional` (C4)

### 4.1 Metadatos

- Función: `actividad_cdmx_vs_nacional(request: Request)`. `summary` derivado del nombre de la función; `description` = docstring:

```
Contraste urbano/rural: % hogares con actividad agro y no-agro en CDMX vs nacional.

Esperable: CDMX << nacional en agro (9.64% nacional, memory indica residuos
periurbanos Milpa Alta/Tláhuac/Xochimilco en CDMX); CDMX >= nacional en noagro
(22.77% nacional; CDMX es metrópoli comercial con mayor actividad
no-agropecuaria por hogar).
```

- `response_model=ActividadCdmxVsNacionalResponse`
- `responses[200].description`: `"Comparativo actividades de hogares CDMX vs nacional (agro / noagro / jcf)."`
- `responses[200]` example (verbatim, NO coincide con el modelo real):

```json
{
    "cdmx_agro_pct": 0.8,
    "nacional_agro_pct": 31.9,
    "cdmx_noagro_pct": 18.5,
    "nacional_noagro_pct": 14.9
}
```

- Rate limit: `@limiter.limit("30/minute")`

### 4.2 Parámetros

Ninguno.

### 4.3 SQL

Una única consulta; sin parámetros bind; sin ramas dinámicas. Solo esquema `enigh`.

`SQL_C4`:

```sql

WITH hog_agro AS (SELECT DISTINCT folioviv, foliohog FROM enigh.agro),
     hog_noagro AS (SELECT DISTINCT folioviv, foliohog FROM enigh.noagro)
SELECT
    (SELECT SUM(factor)::bigint FROM enigh.hogares) AS total_nac,
    (SELECT SUM(factor)::bigint FROM enigh.hogares WHERE entidad='09') AS total_cdmx,
    (SELECT COALESCE(SUM(h.factor), 0)::bigint
       FROM hog_agro ha JOIN enigh.hogares h USING (folioviv, foliohog)) AS agro_nac,
    (SELECT COALESCE(SUM(h.factor), 0)::bigint
       FROM hog_agro ha JOIN enigh.hogares h USING (folioviv, foliohog) WHERE h.entidad='09') AS agro_cdmx,
    (SELECT COALESCE(SUM(h.factor), 0)::bigint
       FROM hog_noagro ha JOIN enigh.hogares h USING (folioviv, foliohog)) AS noagro_nac,
    (SELECT COALESCE(SUM(h.factor), 0)::bigint
       FROM hog_noagro ha JOIN enigh.hogares h USING (folioviv, foliohog) WHERE h.entidad='09') AS noagro_cdmx
```

Ejecución:

```python
async with engine.connect() as conn:
    r = (await conn.execute(text(SQL_C4))).mappings().one()
```

Tablas referenciadas: `enigh.agro`, `enigh.noagro`, `enigh.hogares`. No se toca `cdmx.*`. (La descripción OpenAPI menciona «jcf» pero no existe ninguna consulta ni campo sobre jóvenes construyendo el futuro.)

### 4.4 Post-procesamiento

```python
total_nac = r["total_nac"]
total_cdmx = r["total_cdmx"]
pct_agro_nac = 100 * r["agro_nac"] / total_nac
pct_agro_cdmx = 100 * r["agro_cdmx"] / total_cdmx
pct_noagro_nac = 100 * r["noagro_nac"] / total_nac
pct_noagro_cdmx = 100 * r["noagro_cdmx"] / total_cdmx
```

- `agro` (`ActividadComparativa`): `tipo="agropecuaria"`, `hogares_expandido_nacional=r["agro_nac"]`, `hogares_expandido_cdmx=r["agro_cdmx"]`, `pct_nacional=round(pct_agro_nac, 2)`, `pct_cdmx=round(pct_agro_cdmx, 2)`, `ratio_cdmx_sobre_nacional=round(pct_agro_cdmx / pct_agro_nac, 3) if pct_agro_nac else 0`
- `noagro` (`ActividadComparativa`): `tipo="no-agropecuaria"`, `hogares_expandido_nacional=r["noagro_nac"]`, `hogares_expandido_cdmx=r["noagro_cdmx"]`, `pct_nacional=round(pct_noagro_nac, 2)`, `pct_cdmx=round(pct_noagro_cdmx, 2)`, `ratio_cdmx_sobre_nacional=round(pct_noagro_cdmx / pct_noagro_nac, 3) if pct_noagro_nac else 0`
- `n_hogares_total_nacional = total_nac`
- `n_hogares_total_cdmx = total_cdmx`
- `note` (una sola cadena):

```
CDMX tiene presencia residual de actividad agro (periurbana: Milpa Alta, Tláhuac, Xochimilco). Noagro es actividad persona-trabajo-tipoact (comercio, servicios, manufactura); el ratio captura concentración económica vs actividad agrícola.
```

- `nota_hipotesis` (una sola cadena):

```
Hipótesis a explorar: CDMX concentra empleo formal asalariado, reduciendo la necesidad/incentivo de auto-empleo no-agropecuario. Estados con menor formalización laboral pueden tener mayor % noagro por acceso limitado a empleo asalariado. Esta hipótesis NO se ha probado con los datos cargados.
```

- `caveats` (lista, en este orden; NO incluye `CAVEAT_CDMX_SNAPSHOT`):
  1. `"Cobertura hogares usa DISTINCT (folioviv, foliohog) sobre agro/noagro porque son tablas persona-trabajo-tipoact, no hogar-raíz."`
  2. `"Un hogar con múltiples miembros con actividades distintas cuenta UNA VEZ en cobertura (pero múltiples veces en sumas de ventas)."`

Sentinela: `ratio_cdmx_sobre_nacional` es `0` (entero, serializado como `0.0` por Pydantic) cuando el pct nacional es 0.

### 4.5 Modelo de respuesta

```python
class ActividadComparativa(BaseModel):
    tipo: str
    hogares_expandido_nacional: int
    hogares_expandido_cdmx: int
    pct_nacional: float
    pct_cdmx: float
    ratio_cdmx_sobre_nacional: float


class ActividadCdmxVsNacionalResponse(BaseModel):
    agro: ActividadComparativa
    noagro: ActividadComparativa
    n_hogares_total_nacional: int
    n_hogares_total_cdmx: int
    note: str
    nota_hipotesis: str
    caveats: list[str]
```

### 4.6 Errores

- `429` — `{"detail": "Rate limit exceeded. Try again later."}` (más de 30/minuto por IP).
- `500` — no capturado: `enigh.hogares` vacío → `total_nac`/`total_cdmx` NULL → `TypeError`; `total_cdmx == 0` → `ZeroDivisionError`.

---

## 5. `GET /api/v1/comparativo/gastos/cdmx-vs-nacional` (C5)

### 5.1 Metadatos

- Función: `gastos_cdmx_vs_nacional(request: Request)`. `summary` derivado del nombre de la función; `description` = docstring:

```
Gasto mensual por rubro — los 9 rubros INEGI oficiales — CDMX vs nacional.

Devuelve mean mensual por rubro en ambos scopes y delta absoluto + relativo,
más estructura de gasto (%) de cada rubro sobre el gasto monetario total.
```

- `response_model=GastosCdmxVsNacionalResponse`
- `responses[200].description`: `"Comparativo gastos rubro a rubro CDMX vs nacional ENIGH."`
- `responses[200]` example (verbatim, NO coincide con el modelo real):

```json
{
    "rubros": [
        {
            "slug": "alimentos",
            "cdmx_pct": 32.1,
            "nacional_pct": 37.7,
            "delta_pp": -5.6
        }
    ]
}
```

- Rate limit: `@limiter.limit("20/minute")`

### 5.2 Parámetros

Ninguno.

### 5.3 SQL

Una única consulta construida en import-time por `_build_c5_sql()` a partir de `_RUBROS_C5` (ver Catálogos). Es constante en runtime (`SQL_C5 = _build_c5_sql()`); no hay parámetros bind ni ramas dependientes del request. Solo esquema `enigh`.

Constructor (verbatim):

```python
def _build_c5_sql() -> str:
    # construye una query única con 18 agregados (9 rubros × 2 scopes)
    parts_nac = [
        f"(SUM(c.{col} * c.factor) / SUM(c.factor) / 3.0)::float AS {col}_nac"
        for col, *_ in _RUBROS_C5
    ]
    parts_cdmx = [
        f"(SUM(c.{col} * c.factor) FILTER (WHERE h.entidad='09') / "
        f" NULLIF(SUM(c.factor) FILTER (WHERE h.entidad='09'), 0) / 3.0)::float AS {col}_cdmx"
        for col, *_ in _RUBROS_C5
    ]
    return f"""
    SELECT
        (SUM(c.gasto_mon * c.factor) / SUM(c.factor) / 3.0)::float AS gmon_nac,
        (SUM(c.gasto_mon * c.factor) FILTER (WHERE h.entidad='09') /
         NULLIF(SUM(c.factor) FILTER (WHERE h.entidad='09'), 0) / 3.0)::float AS gmon_cdmx,
        {', '.join(parts_nac)},
        {', '.join(parts_cdmx)}
    FROM enigh.concentradohogar c
    JOIN enigh.hogares h USING (folioviv, foliohog)
    """


SQL_C5 = _build_c5_sql()
```

Texto SQL resultante exacto (los 9 agregados `_nac` van en UNA sola línea separados por `, `, y los 9 `_cdmx` en otra; obsérvese el doble espacio `/  NULLIF` producto de la concatenación de las dos f-strings `"... / "` + `" NULLIF..."`):

```sql

    SELECT
        (SUM(c.gasto_mon * c.factor) / SUM(c.factor) / 3.0)::float AS gmon_nac,
        (SUM(c.gasto_mon * c.factor) FILTER (WHERE h.entidad='09') /
         NULLIF(SUM(c.factor) FILTER (WHERE h.entidad='09'), 0) / 3.0)::float AS gmon_cdmx,
        (SUM(c.alimentos * c.factor) / SUM(c.factor) / 3.0)::float AS alimentos_nac, (SUM(c.transporte * c.factor) / SUM(c.factor) / 3.0)::float AS transporte_nac, (SUM(c.educa_espa * c.factor) / SUM(c.factor) / 3.0)::float AS educa_espa_nac, (SUM(c.vivienda * c.factor) / SUM(c.factor) / 3.0)::float AS vivienda_nac, (SUM(c.personales * c.factor) / SUM(c.factor) / 3.0)::float AS personales_nac, (SUM(c.limpieza * c.factor) / SUM(c.factor) / 3.0)::float AS limpieza_nac, (SUM(c.vesti_calz * c.factor) / SUM(c.factor) / 3.0)::float AS vesti_calz_nac, (SUM(c.salud * c.factor) / SUM(c.factor) / 3.0)::float AS salud_nac, (SUM(c.transf_gas * c.factor) / SUM(c.factor) / 3.0)::float AS transf_gas_nac,
        (SUM(c.alimentos * c.factor) FILTER (WHERE h.entidad='09') /  NULLIF(SUM(c.factor) FILTER (WHERE h.entidad='09'), 0) / 3.0)::float AS alimentos_cdmx, (SUM(c.transporte * c.factor) FILTER (WHERE h.entidad='09') /  NULLIF(SUM(c.factor) FILTER (WHERE h.entidad='09'), 0) / 3.0)::float AS transporte_cdmx, (SUM(c.educa_espa * c.factor) FILTER (WHERE h.entidad='09') /  NULLIF(SUM(c.factor) FILTER (WHERE h.entidad='09'), 0) / 3.0)::float AS educa_espa_cdmx, (SUM(c.vivienda * c.factor) FILTER (WHERE h.entidad='09') /  NULLIF(SUM(c.factor) FILTER (WHERE h.entidad='09'), 0) / 3.0)::float AS vivienda_cdmx, (SUM(c.personales * c.factor) FILTER (WHERE h.entidad='09') /  NULLIF(SUM(c.factor) FILTER (WHERE h.entidad='09'), 0) / 3.0)::float AS personales_cdmx, (SUM(c.limpieza * c.factor) FILTER (WHERE h.entidad='09') /  NULLIF(SUM(c.factor) FILTER (WHERE h.entidad='09'), 0) / 3.0)::float AS limpieza_cdmx, (SUM(c.vesti_calz * c.factor) FILTER (WHERE h.entidad='09') /  NULLIF(SUM(c.factor) FILTER (WHERE h.entidad='09'), 0) / 3.0)::float AS vesti_calz_cdmx, (SUM(c.salud * c.factor) FILTER (WHERE h.entidad='09') /  NULLIF(SUM(c.factor) FILTER (WHERE h.entidad='09'), 0) / 3.0)::float AS salud_cdmx, (SUM(c.transf_gas * c.factor) FILTER (WHERE h.entidad='09') /  NULLIF(SUM(c.factor) FILTER (WHERE h.entidad='09'), 0) / 3.0)::float AS transf_gas_cdmx
    FROM enigh.concentradohogar c
    JOIN enigh.hogares h USING (folioviv, foliohog)
    
```

(El texto real de `SQL_C5` termina en `foliohog)\n` seguido de cuatro espacios SIN salto de línea final; el bloque anterior agrega un salto de línea antes del cierre para que la valla sea válida.)

Columnas de `enigh.concentradohogar` usadas: `gasto_mon`, `factor`, `alimentos`, `transporte`, `educa_espa`, `vivienda`, `personales`, `limpieza`, `vesti_calz`, `salud`, `transf_gas`, `folioviv`, `foliohog`. Columnas de `enigh.hogares`: `entidad`, `folioviv`, `foliohog`.

Ejecución:

```python
async with engine.connect() as conn:
    r = (await conn.execute(text(SQL_C5))).mappings().one()
```

Tablas referenciadas: `enigh.concentradohogar` (alias `c`), `enigh.hogares` (alias `h`), unidas dentro del mismo esquema `enigh` con `JOIN ... USING (folioviv, foliohog)`. No se toca `cdmx.*`. Aquí el filtro «CDMX» es `h.entidad='09'` (vía `hogares`), a diferencia de C1 que usa `LEFT(ubica_geo, 2)`.

### 5.4 Post-procesamiento

```python
gmon_nac = r["gmon_nac"]
gmon_cdmx = r["gmon_cdmx"]

rubros = []
for col, slug, nombre in _RUBROS_C5:
    nac = r[f"{col}_nac"]
    cdmx = r[f"{col}_cdmx"]
    rubros.append(GastoRubroComparativo(
        slug=slug,
        nombre=nombre,
        mean_cdmx_mensual=round(cdmx, 2),
        mean_nacional_mensual=round(nac, 2),
        delta_absoluto=round(cdmx - nac, 2),
        delta_pct=round((cdmx - nac) / nac * 100, 2) if nac else 0.0,
        pct_del_monetario_cdmx=round(100 * cdmx / gmon_cdmx, 2) if gmon_cdmx else 0.0,
        pct_del_monetario_nacional=round(100 * nac / gmon_nac, 2) if gmon_nac else 0.0,
    ))
```

- Orden de `rubros`: el de `_RUBROS_C5` (alimentos, transporte, educacion_esparcimiento, vivienda, cuidados_personales, limpieza_hogar, vestido_calzado, salud, transferencias_gasto). Siempre 9 elementos.
- Sentinelas: `delta_pct = 0.0` si `nac` es 0/NULL; `pct_del_monetario_cdmx = 0.0` si `gmon_cdmx` es 0/NULL; `pct_del_monetario_nacional = 0.0` si `gmon_nac` es 0/NULL.
- `mean_gasto_mon_mensual_nacional = round(gmon_nac, 2)`
- `mean_gasto_mon_mensual_cdmx = round(gmon_cdmx, 2)`
- `note` (una sola cadena):

```
Valores desde enigh.concentradohogar (tabla summary oficial). Todos los agregados ponderados por factor. Delta positivo = CDMX gasta más que el promedio nacional en ese rubro; negativo = menos.
```

- `caveats` (lista, en este orden; NO incluye `CAVEAT_CDMX_SNAPSHOT`):
  1. `"Los valores son nacional / CDMX (entidad 09). No se desagrega por decil dentro de CDMX. Un hogar CDMX decil 1 y uno decil 10 pueden tener estructuras de gasto muy distintas."`
  2. `"Las publicaciones INEGI oficiales cubren total nacional. El corte CDMX es analítico propio y no tiene bound directo del Comunicado 112/25."`

### 5.5 Modelo de respuesta

```python
class GastoRubroComparativo(BaseModel):
    slug: str
    nombre: str
    mean_cdmx_mensual: float
    mean_nacional_mensual: float
    delta_absoluto: float
    delta_pct: float
    pct_del_monetario_cdmx: float
    pct_del_monetario_nacional: float


class GastosCdmxVsNacionalResponse(BaseModel):
    mean_gasto_mon_mensual_nacional: float
    mean_gasto_mon_mensual_cdmx: float
    rubros: list[GastoRubroComparativo]
    note: str
    caveats: list[str]
```

Valores de `slug`/`nombre` (en orden): ver `_RUBROS_C5` en Catálogos.

### 5.6 Errores

- `429` — `{"detail": "Rate limit exceeded. Try again later."}` (más de 20/minuto por IP).
- `500` — no capturado: si `SUM(c.factor)` es 0/NULL (tabla vacía) → `gmon_nac`/`*_nac` NULL → `round(None, 2)` `TypeError`; si el filtro CDMX no tiene filas, `NULLIF` devuelve NULL → `round(cdmx, 2)` `TypeError`.

---

## 6. `GET /api/v1/comparativo/bancarizacion` (C6)

### 6.1 Metadatos

- Función: `bancarizacion(request: Request)`. `summary` derivado del nombre de la función; `description` = docstring:

```
Uso de tarjeta (crédito o débito) en trimestre — CDMX vs nacional.

Definición operativa: "hogar con ≥1 registro en enigh.gastotarjetas en
el trimestre de referencia". NO mide posesión de tarjeta, solo uso
efectivo en trimestre; captura débito + crédito indistintamente.
```

- `response_model=BancarizacionResponse`
- `responses[200].description`: `"Bancarización (% hogares con cuenta) CDMX vs nacional. Cifra nacional corregida 7.1→8.87% en S7."`
- `responses[200]` example (verbatim, NO coincide con el modelo real):

```json
{
    "cdmx_pct": 22.5,
    "nacional_pct": 8.87,
    "delta_pp": 13.63
}
```

- Rate limit: `@limiter.limit("30/minute")`

### 6.2 Parámetros

Ninguno.

### 6.3 SQL

Una única consulta; sin parámetros bind; sin ramas dinámicas. Solo esquema `enigh`.

`SQL_C6`:

```sql

WITH hog_tarj AS (SELECT DISTINCT folioviv, foliohog FROM enigh.gastotarjetas)
SELECT
    (SELECT SUM(factor)::bigint FROM enigh.hogares) AS total_nac,
    (SELECT SUM(factor)::bigint FROM enigh.hogares WHERE entidad='09') AS total_cdmx,
    COALESCE((SELECT SUM(h.factor)::bigint
              FROM hog_tarj ht JOIN enigh.hogares h USING (folioviv, foliohog)), 0) AS con_tarj_nac,
    COALESCE((SELECT SUM(h.factor)::bigint
              FROM hog_tarj ht JOIN enigh.hogares h USING (folioviv, foliohog)
              WHERE h.entidad='09'), 0) AS con_tarj_cdmx
```

Ejecución:

```python
async with engine.connect() as conn:
    r = (await conn.execute(text(SQL_C6))).mappings().one()
```

Tablas referenciadas: `enigh.gastotarjetas`, `enigh.hogares`. No se toca `cdmx.*`.

### 6.4 Post-procesamiento

```python
pct_nac = 100 * r["con_tarj_nac"] / r["total_nac"]
pct_cdmx = 100 * r["con_tarj_cdmx"] / r["total_cdmx"]
```

- `definicion_operativa` (una sola cadena):

```
Hogar con ≥1 registro en enigh.gastotarjetas en el trimestre de referencia. NO mide posesión de tarjeta; mide USO EFECTIVO en trimestre. Captura débito + crédito sin distinción.
```

- `n_hogares_expandido_nacional = r["total_nac"]`
- `n_hogares_expandido_cdmx = r["total_cdmx"]`
- `hogares_con_uso_tarjeta_nacional = r["con_tarj_nac"]`
- `hogares_con_uso_tarjeta_cdmx = r["con_tarj_cdmx"]`
- `pct_nacional = round(pct_nac, 2)`
- `pct_cdmx = round(pct_cdmx, 2)`
- `delta_pp = round(pct_cdmx - pct_nac, 2)`
- `ratio_cdmx_sobre_nacional = round(pct_cdmx / pct_nac, 3) if pct_nac else 0` (sentinela `0` → `0.0`)
- `caveats` (lista, en este orden; NO incluye `CAVEAT_CDMX_SNAPSHOT`):
  1. `"Definición mide USO, no POSESIÓN. Un hogar con tarjeta que no la usó en trimestre NO está contado. Un hogar sin tarjeta pero que usó una prestada o un pago con tarjeta de tercero SÍ está contado (los casos reales son marginales pero existen)."`
  2. `"gastotarjetas captura débito + crédito sin distinguir. Si se quisiera solo crédito, requiere filtro adicional por clave."`
  3. `"La cifra nacional (~8.87%) parece baja en términos absolutos porque la definición es trimestral, no anual. Un hogar que use tarjeta semestralmente tiene 50% probabilidad de aparecer en un trimestre."`

### 6.5 Modelo de respuesta

```python
class BancarizacionResponse(BaseModel):
    definicion_operativa: str
    n_hogares_expandido_nacional: int
    n_hogares_expandido_cdmx: int
    hogares_con_uso_tarjeta_nacional: int
    hogares_con_uso_tarjeta_cdmx: int
    pct_nacional: float
    pct_cdmx: float
    delta_pp: float
    ratio_cdmx_sobre_nacional: float
    caveats: list[str]
```

### 6.6 Errores

- `429` — `{"detail": "Rate limit exceeded. Try again later."}` (más de 30/minuto por IP).
- `500` — no capturado: `enigh.hogares` vacío → `total_nac` NULL → `TypeError`; `total_cdmx == 0` → `ZeroDivisionError`.

---

## 7. `GET /api/v1/comparativo/top-vs-bottom` (C7)

### 7.1 Metadatos

- Función: `top_vs_bottom(request: Request)`. `summary` derivado del nombre de la función; `description` = docstring:

```
Extremos CDMX (p1/p5/p10 vs p90/p95/p99) mapeados contra ENIGH d1 y d10.

Muestra el rango completo de la brecha entre servidores públicos CDMX y la
distribución nacional de ingresos hogar. Insight central esperable:
incluso el p99 CDMX (top 1% servidores) está debajo del mean mensual d10
nacional — la distribución CDMX está comprimida respecto a la distribución
nacional hogar (última incluye transferencias + rentas + múltiples perceptores).
```

- `response_model=TopVsBottomResponse`
- `responses[200].description`: `"Comparativo d10 nacional vs decil más alto CDMX (top puestos)."`
- `responses[200]` example (verbatim, NO coincide con el modelo real):

```json
{
    "nacional_d10_mensual": 78698.33,
    "cdmx_top_decil_mensual": 45000.00,
    "ratio_pct": 57.2
}
```

- Rate limit: `@limiter.limit("20/minute")`

### 7.2 Parámetros

Ninguno.

### 7.3 SQL

Dos consultas separadas, en este orden; sin parámetros bind; sin ramas dinámicas.

`SQL_C7_CDMX` (esquema `cdmx`):

```sql

SELECT
    percentile_cont(0.01) WITHIN GROUP (ORDER BY sueldo_bruto)::float AS p01,
    percentile_cont(0.05) WITHIN GROUP (ORDER BY sueldo_bruto)::float AS p05,
    percentile_cont(0.10) WITHIN GROUP (ORDER BY sueldo_bruto)::float AS p10,
    percentile_cont(0.90) WITHIN GROUP (ORDER BY sueldo_bruto)::float AS p90,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY sueldo_bruto)::float AS p95,
    percentile_cont(0.99) WITHIN GROUP (ORDER BY sueldo_bruto)::float AS p99,
    COUNT(*)::bigint AS n
FROM cdmx.nombramientos WHERE sueldo_bruto IS NOT NULL
```

`SQL_C7_ENIGH_EXTREMOS` (esquema `enigh`):

```sql

SELECT
    (SUM(ing_cor * factor) FILTER (WHERE decil=1) /
     NULLIF(SUM(factor) FILTER (WHERE decil=1), 0) / 3.0)::float AS d1_mean_mensual,
    (SUM(ing_cor * factor) FILTER (WHERE decil=10) /
     NULLIF(SUM(factor) FILTER (WHERE decil=10), 0) / 3.0)::float AS d10_mean_mensual,
    (MIN(ing_cor) FILTER (WHERE decil=1) / 3.0)::float AS d1_lower,
    (MAX(ing_cor) FILTER (WHERE decil=1) / 3.0)::float AS d1_upper,
    (MIN(ing_cor) FILTER (WHERE decil=10) / 3.0)::float AS d10_lower,
    (MAX(ing_cor) FILTER (WHERE decil=10) / 3.0)::float AS d10_upper
FROM enigh.concentradohogar
```

Ejecución:

```python
async with engine.connect() as conn:
    cdmx = (await conn.execute(text(SQL_C7_CDMX))).mappings().one()
    ext = (await conn.execute(text(SQL_C7_ENIGH_EXTREMOS))).mappings().one()
```

Tablas referenciadas: `cdmx.nombramientos`; `enigh.concentradohogar`. No hay JOIN entre esquemas: combinación en Python. `cdmx["n"]` se consulta pero NO se emite en la respuesta.

### 7.4 Post-procesamiento

```python
# bottom bracket: p01-p10 CDMX vs d1 ENIGH
p01, p05, p10 = cdmx["p01"], cdmx["p05"], cdmx["p10"]
d1_mean = ext["d1_mean_mensual"]
d1_upper = ext["d1_upper"]

# top bracket: p90-p99 CDMX vs d10 ENIGH
p90, p95, p99 = cdmx["p90"], cdmx["p95"], cdmx["p99"]
d10_mean = ext["d10_mean_mensual"]
d10_lower = ext["d10_lower"]
```

Insights (f-strings verbatim):

```python
insight_p99 = (
    f"CDMX p99 (${p99:,.0f}/mes) está por DEBAJO del mean d10 nacional "
    f"(${d10_mean:,.0f}/mes hogar) por ${d10_mean - p99:,.0f}/mes. "
    f"El top 1% de servidores CDMX, a nivel individual, no alcanza el "
    f"promedio de ingreso hogar del decil 10 nacional."
)

insight_p99_vs_d10_lower = (
    f"Para caer en d10 nacional (lower d10 ${d10_lower:,.0f}), un servidor "
    f"necesitaría ganar ~${d10_lower:,.0f}/mes individualmente — superior "
    f"al p99 CDMX ($" f"{p99:,.0f})." if p99 < d10_lower else
    f"El p99 CDMX (${p99:,.0f}) supera el lower d10 nacional "
    f"(${d10_lower:,.0f}), es decir, solo el top 1% de servidores entra "
    f"individualmente en d10 hogar."
)

insight_p01 = (
    f"CDMX p01 (${p01:,.0f}/mes) vs d1 mean nacional (${d1_mean:,.0f}/mes "
    f"hogar). Brecha p01 vs d1_mean = ${p01 - d1_mean:,.0f}. Un servidor "
    f"en el bottom 1% gana {'más' if p01 > d1_mean else 'menos'} que un "
    f"hogar promedio d1 (que incluye múltiples perceptores o transferencias)."
)
```

Ramas condicionales (las únicas del router, y son de Python, no SQL):

- `insight_p99_vs_d10_lower`: si `p99 < d10_lower` → texto «Para caer en d10 nacional (lower d10 $X), un servidor necesitaría ganar ~$X/mes individualmente — superior al p99 CDMX ($Y).»; en caso contrario → «El p99 CDMX ($Y) supera el lower d10 nacional ($X), es decir, solo el top 1% de servidores entra individualmente en d10 hogar.»
- `insight_p01`: `'más'` si `p01 > d1_mean`, `'menos'` en caso contrario.
- `insight_p99` afirma «está por DEBAJO» incondicionalmente aunque `d10_mean - p99` sea negativo (sin rama).

`narrative` (f-string verbatim, incondicional):

```python
narrative = (
    f"El top 1% de servidores CDMX (${p99:,.0f}/mes individual) entra al "
    f"decil 10 nacional como perceptor único (lower d10 = ${d10_lower:,.0f}), "
    f"pero se posiciona en el segmento inferior de ese decil. El mean del "
    f"decil 10 nacional es ${d10_mean:,.0f}/mes como hogar, lo que típicamente "
    f"representa hogares con múltiples perceptores altos o patrimonio generador "
    f"de ingresos adicionales. La distancia p99_servidor vs mean_d10_hogar no "
    f"es evidencia de 'servidores top CDMX debajo del decil 10' sino de que el "
    f"decil 10 nacional está dominado por hogares con composición de ingreso "
    f"más rica que un solo salario."
)
```

Construcción de la respuesta (`top_bracket` y `bottom_bracket` son `dict` libres, verbatim):

```python
top_bracket={
    "unit": "pesos mensuales",
    "cdmx_servidor_percentiles": {
        "p90": round(p90, 2), "p95": round(p95, 2), "p99": round(p99, 2),
    },
    "enigh_d10": {
        "mean_mensual": round(d10_mean, 2),
        "lower_mensual": round(d10_lower, 2),
        "upper_mensual": round(ext["d10_upper"], 2),
    },
    "brecha_p99_vs_d10_mean": round(d10_mean - p99, 2),
    "ratio_d10_mean_sobre_p99": round(d10_mean / p99, 3) if p99 else 0,
},
bottom_bracket={
    "unit": "pesos mensuales",
    "cdmx_servidor_percentiles": {
        "p01": round(p01, 2), "p05": round(p05, 2), "p10": round(p10, 2),
    },
    "enigh_d1": {
        "mean_mensual": round(d1_mean, 2),
        "lower_mensual": round(ext["d1_lower"], 2),
        "upper_mensual": round(d1_upper, 2),
    },
    "brecha_p01_vs_d1_mean": round(p01 - d1_mean, 2),
},
```

- `narrative` = la f-string anterior.
- `insights = [insight_p99, insight_p99_vs_d10_lower, insight_p01]` (siempre 3, en ese orden).
- `caveats` (lista, en este orden):
  1. `CAVEAT_CDMX_SNAPSHOT`
  2. `CAVEAT_DECILES_ENIGH`
  3. `CAVEAT_ENIGH_UNIDADES`
  4. `"ENIGH d10 incluye outliers muy altos (upper ~$5.8M/mes) que elevan el mean de d10. El mean d10 no es el tope del decil; es el promedio. El upper d10 representa el ingreso máximo observado."`
  5. `"La distribución CDMX servidor está inherentemente acotada por regulaciones salariales del sector público; la distribución ENIGH hogar refleja el rango completo de ingresos de la economía."`

Sentinela: `top_bracket.ratio_d10_mean_sobre_p99 = 0` (entero; al ser `dict` libre se serializa como `0`, no `0.0`) si `p99` es 0. Nótese que `bottom_bracket` NO tiene ratio.

### 7.5 Modelo de respuesta

```python
class CdmxPercentilExtremo(BaseModel):
    percentil: str
    sueldo_mensual: float


class EnighDecilExtremo(BaseModel):
    decil: int
    mean_ing_cor_mensual: float
    lower_mensual: float
    upper_mensual: float


class TopVsBottomResponse(BaseModel):
    top_bracket: dict
    bottom_bracket: dict
    narrative: str
    insights: list[str]
    caveats: list[str]
```

`CdmxPercentilExtremo` y `EnighDecilExtremo` están definidos en el módulo de schemas pero NO se usan en el router (código muerto). La forma efectiva de los dicts es:

```
top_bracket = {
  "unit": "pesos mensuales",
  "cdmx_servidor_percentiles": {"p90": float, "p95": float, "p99": float},
  "enigh_d10": {"mean_mensual": float, "lower_mensual": float, "upper_mensual": float},
  "brecha_p99_vs_d10_mean": float,
  "ratio_d10_mean_sobre_p99": float | 0
}
bottom_bracket = {
  "unit": "pesos mensuales",
  "cdmx_servidor_percentiles": {"p01": float, "p05": float, "p10": float},
  "enigh_d1": {"mean_mensual": float, "lower_mensual": float, "upper_mensual": float},
  "brecha_p01_vs_d1_mean": float
}
```

### 7.6 Errores

- `429` — `{"detail": "Rate limit exceeded. Try again later."}` (más de 20/minuto por IP).
- `500` — no capturado: tablas vacías o sin filas en decil 1/10 → `None` en `round`/aritmética/format → `TypeError`.

---

## Catálogos y constantes

### Imports del router (verbatim)

```python
from fastapi import APIRouter, Request
from sqlalchemy import text

from app.database import engine
from app.rate_limit import limiter
from app.schemas.errors import HTTPError429
from app.schemas.comparativo import (
    ActividadCdmxVsNacionalResponse,
    ActividadComparativa,
    AportesVsJubilacionesResponse,
    BancarizacionResponse,
    CaveatsInterpretativos,
    CdmxAportesActuales,
    DecilBound,
    DecilServidoresResponse,
    EnighJubilacionesActuales,
    EscenarioMapeoRow,
    EscenarioResponse,
    GastoRubroComparativo,
    GastosCdmxVsNacionalResponse,
    IngresoCdmxServidor,
    IngresoComparativoResponse,
    IngresoEnighHogar,
    PercentilRow,
    TopVsBottomResponse,
)

router = APIRouter(prefix="/api/v1/comparativo", tags=["comparativo"])
```

### Caveats compartidos (verbatim)

```python
# Caveat heredado aplicado a TODOS los comparativos
CAVEAT_CDMX_SNAPSHOT = (
    "cdmx.nombramientos es snapshot sin fecha alta/baja. Incluye todos los "
    "registros disponibles sin filtro temporal (246,841 registros, 1 por persona)."
)

CAVEAT_ENIGH_UNIDADES = (
    "ENIGH mide ingreso total del hogar (salarios + transferencias + rentas + "
    "pensiones + actividad económica), no sueldo individual; mean 3.35 personas/hogar."
)

CAVEAT_DECILES_ENIGH = (
    "Deciles ENIGH son factor-weighted cumulative sum sobre ing_cor hogar "
    "trimestral; reproducen tabulados oficiales INEGI (±0.15% en 8/10 deciles, "
    "documentado en plan v2 §1.ter)."
)
```

Valores resultantes (una sola cadena cada uno):

- `CAVEAT_CDMX_SNAPSHOT` = `cdmx.nombramientos es snapshot sin fecha alta/baja. Incluye todos los registros disponibles sin filtro temporal (246,841 registros, 1 por persona).`
- `CAVEAT_ENIGH_UNIDADES` = `ENIGH mide ingreso total del hogar (salarios + transferencias + rentas + pensiones + actividad económica), no sueldo individual; mean 3.35 personas/hogar.`
- `CAVEAT_DECILES_ENIGH` = `Deciles ENIGH son factor-weighted cumulative sum sobre ing_cor hogar trimestral; reproducen tabulados oficiales INEGI (±0.15% en 8/10 deciles, documentado en plan v2 §1.ter).`

Uso por endpoint:

| Endpoint | CAVEAT_CDMX_SNAPSHOT | CAVEAT_ENIGH_UNIDADES | CAVEAT_DECILES_ENIGH |
|---|---|---|---|
| C1 ingreso/cdmx-vs-nacional | sí (1º) | sí (2º) | no |
| C2 decil-servidores-cdmx | sí (1º) | no | sí (2º) |
| C3 aportes-vs-jubilaciones-actuales | sí (1º) | no | no |
| C4 actividad-cdmx-vs-nacional | no | no | no |
| C5 gastos/cdmx-vs-nacional | no | no | no |
| C6 bancarizacion | no | no | no |
| C7 top-vs-bottom | sí (1º) | sí (3º) | sí (2º) |

(A pesar del comentario «aplicado a TODOS los comparativos», C4, C5 y C6 NO incluyen `CAVEAT_CDMX_SNAPSHOT`.)

### Constantes SQL (nombres de módulo)

`SQL_C1_CDMX`, `SQL_C1_ENIGH_NAC`, `SQL_C1_ENIGH_CDMX`, `SQL_C2_CDMX_PCTS`, `SQL_C2_DECIL_BOUNDS`, `SQL_C2_MEDIANA_ASALARIADO`, `SQL_C3_CDMX`, `SQL_C3_ENIGH_JUB`, `SQL_C4`, `SQL_C5` (= `_build_c5_sql()`), `SQL_C6`, `SQL_C7_CDMX`, `SQL_C7_ENIGH_EXTREMOS`. Todas son literales `"""..."""` que empiezan y terminan con salto de línea (reproducidos arriba con las líneas en blanco correspondientes).

### `_RUBROS_C5` (verbatim)

```python
# Los 9 rubros INEGI (mismos que en enigh.py, sin gasto_mon)
_RUBROS_C5 = [
    ("alimentos",  "alimentos",              "Alimentos, bebidas y tabaco"),
    ("transporte", "transporte",             "Transporte y comunicaciones"),
    ("educa_espa", "educacion_esparcimiento","Educación y esparcimiento"),
    ("vivienda",   "vivienda",               "Vivienda y servicios"),
    ("personales", "cuidados_personales",    "Cuidados personales"),
    ("limpieza",   "limpieza_hogar",         "Enseres / limpieza del hogar"),
    ("vesti_calz", "vestido_calzado",        "Vestido y calzado"),
    ("salud",      "salud",                  "Salud"),
    ("transf_gas", "transferencias_gasto",   "Transferencias y otros gastos"),
]
```

Tupla = (`col` columna de `enigh.concentradohogar`, `slug` de respuesta, `nombre` de respuesta).

### Funciones auxiliares de módulo

- `_map_ingreso_to_decil(ingreso: float, bounds: list[dict]) -> int | None` (C2; código verbatim en §2.4).
- `_build_c5_sql() -> str` (C5; código verbatim en §5.3).

### Literales de `unit`/`scope`/`tipo`/`nombre`/`supuesto` emitidos

- C1: `"pesos mensuales por persona (servidor público CDMX)"`, `"pesos mensuales por hogar (ing_cor expandido)"` (×2), `"nacional"`, `"entidad 09 — Ciudad de México"`
- C2: `"pesos mensuales por persona (sueldo_bruto)"`, `"A: Perceptor único"`, `"Servidor CDMX es la única fuente de ingreso del hogar"`, `"B: Servidor + perceptor mediano asalariado"`, supuesto B (§2.4); percentiles `"p25"`, `"p50"`, `"p75"`, `"p90"`
- C3: `"pesos mensuales por servidor público CDMX"`, `"pesos trimestrales por hogar"`, `"pesos mensuales por hogar (trim / 3)"`
- C4: `"agropecuaria"`, `"no-agropecuaria"`
- C5: slugs y nombres de `_RUBROS_C5`
- C6: `definicion_operativa` (§6.4)
- C7: `"pesos mensuales"` (×2); claves `"p90"`, `"p95"`, `"p99"`, `"p01"`, `"p05"`, `"p10"`, `"enigh_d10"`, `"enigh_d1"`, `"cdmx_servidor_percentiles"`, `"brecha_p99_vs_d10_mean"`, `"ratio_d10_mean_sobre_p99"`, `"brecha_p01_vs_d1_mean"`

### Rate limits por endpoint

| Endpoint | Límite |
|---|---|
| `/api/v1/comparativo/ingreso/cdmx-vs-nacional` | `30/minute` |
| `/api/v1/comparativo/decil-servidores-cdmx` | `20/minute` |
| `/api/v1/comparativo/aportes-vs-jubilaciones-actuales` | `20/minute` |
| `/api/v1/comparativo/actividad-cdmx-vs-nacional` | `30/minute` |
| `/api/v1/comparativo/gastos/cdmx-vs-nacional` | `20/minute` |
| `/api/v1/comparativo/bancarizacion` | `30/minute` |
| `/api/v1/comparativo/top-vs-bottom` | `20/minute` |

Respuesta 429 (handler global en `main.py`): `{"detail": "Rate limit exceeded. Try again later."}`. Modelo OpenAPI declarado: `HTTPError429` (`detail: str`, default `"Rate limit exceeded. Try again later."`, descripción `"Rate limit por IP excedido para este endpoint."`).

### Redondeo

- 2 decimales: todos los montos en pesos, brechas absolutas, porcentajes (`pct_*`, `delta_pp`, `delta_pct`), bounds de decil.
- 3 decimales: todos los `ratio_*` (`ratio_hogar_nacional_sobre_servidor`, `ratio_hogar_cdmx_sobre_servidor`, `ratio_cdmx_sobre_nacional` en C4 y C6, `ratio_d10_mean_sobre_p99`).
- Los enteros (`n_*`, `hogares_*`, `decil`) se emiten sin redondeo desde columnas `::bigint`/`::int`.
- En las cadenas narrativas los montos se formatean con `:,.0f` (miles con coma, sin decimales, prefijo `$`) y `pct_con_jub` con `:.1f`.

### Tablas referenciadas por esquema

**Esquema `cdmx`** (solo tablas; el router no consulta vistas ni materialized views):

- `cdmx.nombramientos` — columnas usadas: `sueldo_bruto`, `sueldo_neto`. Consultada por C1, C2, C3, C7.

**Esquema `enigh`**:

- `enigh.concentradohogar` — columnas usadas: `ing_cor`, `factor`, `ubica_geo`, `decil`, `jubilacion`, `gasto_mon`, `alimentos`, `transporte`, `educa_espa`, `vivienda`, `personales`, `limpieza`, `vesti_calz`, `salud`, `transf_gas`, `folioviv`, `foliohog`. Consultada por C1, C2, C3, C5, C7.
- `enigh.ingresos` — columnas usadas: `ing_tri`, `clave`. Consultada por C2.
- `enigh.hogares` — columnas usadas: `factor`, `entidad`, `folioviv`, `foliohog`. Consultada por C4, C5, C6.
- `enigh.agro` — columnas usadas: `folioviv`, `foliohog`. Consultada por C4.
- `enigh.noagro` — columnas usadas: `folioviv`, `foliohog`. Consultada por C4.
- `enigh.gastotarjetas` — columnas usadas: `folioviv`, `foliohog`. Consultada por C6.

Mencionada solo en comentario (NO consultada): `enigh.cat_ingresos_cat`.

### Matriz endpoint → tablas y modo de cruce

| Endpoint | `cdmx.*` | `enigh.*` | Sentencias SQL | ¿JOIN entre esquemas en una sola sentencia? |
|---|---|---|---|---|
| C1 ingreso/cdmx-vs-nacional | nombramientos | concentradohogar | 3 | No — combinación en Python |
| C2 decil-servidores-cdmx | nombramientos | concentradohogar, ingresos | 3 | No — combinación en Python |
| C3 aportes-vs-jubilaciones-actuales | nombramientos | concentradohogar | 2 | No — combinación en Python |
| C4 actividad-cdmx-vs-nacional | — | agro, noagro, hogares | 1 | No aplica (solo `enigh`) |
| C5 gastos/cdmx-vs-nacional | — | concentradohogar ⋈ hogares | 1 | No aplica (solo `enigh`; JOIN intra-esquema) |
| C6 bancarizacion | — | gastotarjetas, hogares | 1 | No aplica (solo `enigh`) |
| C7 top-vs-bottom | nombramientos | concentradohogar | 2 | No — combinación en Python |

Conclusión: **ninguna sentencia SQL del router cruza `cdmx` y `enigh`**. El cruce es siempre a nivel Python. Los únicos JOIN son intra-`enigh`: C4 (`hog_agro`/`hog_noagro` CTE ⋈ `enigh.hogares USING (folioviv, foliohog)`), C5 (`enigh.concentradohogar c JOIN enigh.hogares h USING (folioviv, foliohog)`), C6 (`hog_tarj` CTE ⋈ `enigh.hogares USING (folioviv, foliohog)`).

### Dos definiciones distintas de «CDMX» en la ENIGH

- C1: `LEFT(concentradohogar.ubica_geo, 2) = '09'`.
- C4, C5, C6: `hogares.entidad = '09'` (vía JOIN o subconsulta sobre `enigh.hogares`).
- C2, C3, C7: sin corte CDMX en ENIGH (nacional únicamente); «CDMX» proviene exclusivamente de `cdmx.nombramientos`.

# ENIGH 2024 NS — contrato de endpoints del router legado

Fuente: `datos-itam/api/app/routers/enigh.py` (950 líneas) y `datos-itam/api/app/schemas/enigh.py` (183 líneas).
Documento literal para prueba de paridad: cadenas, nombres de campo, orden y redondeo se copian tal cual del código.

## Encabezado del router

```python
router = APIRouter(prefix="/api/v1/enigh", tags=["enigh"])

_RESP_429 = {"model": HTTPError429, "description": "Rate limit excedido."}
```

- Todos los endpoints son `GET`, `async`, y reciben `request: Request` como primer parámetro (requerido por el decorador `@limiter.limit(...)` de slowapi).
- Ninguna ruta declara `summary=` ni `description=` explícitos en el decorador: FastAPI deriva `summary` del nombre de la función y `description` del docstring. En cada sección se transcriben el docstring (= description) y el bloque `responses` (descripción del 200 + `example`).
- Ejecución SQL: `sqlalchemy.text(SQL)` sobre `engine.connect()` asíncrono; resultados vía `.mappings().one()` / `.mappings().all()`. Parámetros ligados por nombre (`:entidad`, `:decil`) mediante el dict del segundo argumento de `conn.execute`.
- Redondeo: siempre `round()` nativo de Python 3 sobre `float` (redondeo a par en empates binarios). La conversión mensual siempre es `valor_trim / 3.0`.
- Errores comunes a todos:
  - `429` — modelo `HTTPError429`, descripción `"Rate limit excedido."` (slowapi).
  - `422` — validación automática de FastAPI para parámetros que violan `pattern` / `ge` / `le` (no se controla en el router).

Docstring del módulo (verbatim):

```
Public REST endpoints for the ENIGH 2024 Nueva Serie dataset (INEGI).

Grupos de endpoints (S7):
  - Grupo D (utilidad)         : /metadata, /validaciones
  - Grupo A (descriptivos)     : /hogares/summary, /hogares/by-decil,
                                 /hogares/by-entidad, /poblacion/demographics,
                                 /gastos/by-rubro
  - Grupo B (actividad)        : /actividad/agro, /actividad/noagro,
                                 /actividad/jcf

Principios (heredados S2-S6):
  - Cifras nacionales siempre con SUM(col * factor) / SUM(factor)
  - Endpoints citables vs INEGI usan `concentradohogar` (summary, no ledger)
  - Cobertura "hogares con actividad X" usa DISTINCT (folioviv, foliohog)
  - Los 9 rubros INEGI vienen de columnas agregadas del concentradohogar,
    NO de `gastoshogar` con prefijos (decisión §1.quater plan v2)
```

Orden de rutas en el archivo:

1. `GET /api/v1/enigh/metadata`
2. `GET /api/v1/enigh/validaciones`
3. `GET /api/v1/enigh/hogares/summary`
4. `GET /api/v1/enigh/hogares/by-decil`
5. `GET /api/v1/enigh/hogares/by-entidad`
6. `GET /api/v1/enigh/poblacion/demographics`
7. `GET /api/v1/enigh/gastos/by-rubro`
8. `GET /api/v1/enigh/actividad/agro`
9. `GET /api/v1/enigh/actividad/noagro`
10. `GET /api/v1/enigh/actividad/jcf`

---

## 1. `GET /api/v1/enigh/metadata`

### 1.1 Declaración

- Función: `enigh_metadata(request: Request)`
- `response_model=EnighMetadata`
- Rate limit: `@limiter.limit("60/minute")`
- Docstring (description): `Metadata del dataset ENIGH 2024 NS: edición, fuentes, schema, totales.`
- `responses[200].description`: `Metadata completa del dataset ENIGH 2024 NS.`
- `responses[200]` example (verbatim):

```json
{
    "edition": "ENIGH 2024 Nueva Serie",
    "periodicity": "trimestral (expandido a nacional con factor)",
    "reference_date": "2024 (levantamiento agosto-noviembre)",
    "schema_version": "007",
    "last_updated": "2026-04-22",
    "total_hogares_muestra": 91414,
    "total_hogares_expandido": 38845190,
    "total_tablas_ingestadas": 17,
    "total_catalogos": 111,
    "sources": [],
    "methodology_notes": []
}
```

- `responses[429]`: `_RESP_429`.

### 1.2 Parámetros

Ninguno (solo `request`).

### 1.3 SQL

Cadena inline (no constante de módulo), sin parámetros:

```sql
SELECT COUNT(*)::bigint AS n_muestra, SUM(factor)::bigint AS n_expandido FROM enigh.concentradohogar
```

Ejecución: `.mappings().one()`.

Tablas: `enigh.concentradohogar`.

### 1.4 Post-procesamiento

Sin cálculo; se arma el modelo con constantes y las dos cifras de la consulta:

| campo | valor |
|---|---|
| `edition` | `ENIGH_EDITION` = `"ENIGH 2024 Nueva Serie"` |
| `periodicity` | `ENIGH_PERIODICITY` = `"trimestral (expandido a nacional con factor)"` |
| `reference_date` | `ENIGH_REFERENCE_DATE` = `"2024 (levantamiento agosto-noviembre)"` |
| `schema_version` | `SCHEMA_VERSION` = `"007"` |
| `last_updated` | literal `"2026-04-22"` (hardcodeado en la función) |
| `total_hogares_muestra` | `r["n_muestra"]` |
| `total_hogares_expandido` | `r["n_expandido"]` |
| `total_tablas_ingestadas` | literal `17` |
| `total_catalogos` | literal `111` |
| `sources` | `SOURCES` (ver Catálogos) |
| `methodology_notes` | `METHODOLOGY_NOTES` (ver Catálogos) |

### 1.5 Modelo de respuesta

```python
class SourceRef(BaseModel):
    title: str
    url: str
    consulted_on: str


class EnighMetadata(BaseModel):
    edition: str
    periodicity: str
    reference_date: str
    schema_version: str
    last_updated: str
    total_hogares_muestra: int
    total_hogares_expandido: int
    total_tablas_ingestadas: int
    total_catalogos: int
    sources: list[SourceRef]
    methodology_notes: list[str]
```

### 1.6 Errores

- `429` únicamente. No hay `HTTPException` propia.

---

## 2. `GET /api/v1/enigh/validaciones`

### 2.1 Declaración

- Función: `enigh_validaciones(request: Request)`
- `response_model=ValidacionesResponse`
- Rate limit: `@limiter.limit("30/minute")`
- Docstring (description), verbatim:

```
Los 13 bounds HIGH vs INEGI oficial (Comunicado 112/25).

- 3 bounds ingreso (total, decil 1, decil 10) — trimestrales
- 10 bounds gasto (gasto_mon + 9 rubros) — mensuales

Todos reproducen al peso al 2026-04-22 (ver proyect memory S3, S5).
```

- `responses[200].description`: `13 bounds HIGH vs INEGI Comunicado 112/25 (3 ingreso trimestrales + 10 gasto mensuales).`
- `responses[200]` example (verbatim):

```json
{
    "count": 13,
    "passing": 13,
    "failing": 0,
    "bounds": [
        {
            "id": "ingreso_total",
            "scope": "total",
            "metric": "Ingreso corriente promedio por hogar (total)",
            "column": "ing_cor",
            "unit": "pesos trimestrales por hogar",
            "calculado": 77864.00,
            "oficial": 77864.0,
            "delta_pct": 0.0,
            "tolerance_pct": 1.0,
            "passing": true,
            "source": "INEGI Comunicado 112/25 p.5/6 cuadro 2"
        }
    ]
}
```

- `responses[429]`: `_RESP_429`.

### 2.2 Parámetros

Ninguno.

### 2.3 SQL

Tres consultas dentro de una misma conexión, en este orden:

**(a)** `SQL_HOGARES_SUMMARY` → `.mappings().one()` (`total_r`):

```sql

SELECT
    COUNT(*)::bigint AS n_muestra,
    SUM(factor)::bigint AS n_expandido,
    (SUM(ing_cor * factor) / SUM(factor))::float AS mean_ing_cor_trim,
    (SUM(gasto_mon * factor) / SUM(factor))::float AS mean_gasto_mon_trim
FROM enigh.concentradohogar

```

**(b)** `SQL_HOGARES_BY_DECIL` → `.mappings().all()` (`d_rows`):

```sql

SELECT
    decil::int AS decil,
    COUNT(*)::bigint AS n_muestra,
    SUM(factor)::bigint AS n_expandido,
    (SUM(ing_cor * factor) / SUM(factor))::float AS mean_ing_cor_trim,
    (SUM(gasto_mon * factor) / SUM(factor))::float AS mean_gasto_mon_trim,
    (100.0 * SUM(factor) / (SELECT SUM(factor) FROM enigh.concentradohogar))::float AS share_factor_pct
FROM enigh.concentradohogar
WHERE decil IS NOT NULL
GROUP BY decil
ORDER BY decil

```

Luego, en Python: `d1 = next(r for r in d_rows if r["decil"] == 1)` y `d10 = next(r for r in d_rows if r["decil"] == 10)`.

**(c)** Consulta dinámica de gastos, construida con f-string a partir de `BOUNDS_GASTOS_MENSUAL`:

```python
rubros_sql = ", ".join(
    f"(SUM({col} * factor) / SUM(factor))::float AS {col}_trim"
    for col, *_ in BOUNDS_GASTOS_MENSUAL
)
f"SELECT {rubros_sql} FROM enigh.concentradohogar"
```

Texto SQL resultante (expandido, en una sola línea en el original):

```sql
SELECT (SUM(gasto_mon * factor) / SUM(factor))::float AS gasto_mon_trim, (SUM(alimentos * factor) / SUM(factor))::float AS alimentos_trim, (SUM(transporte * factor) / SUM(factor))::float AS transporte_trim, (SUM(educa_espa * factor) / SUM(factor))::float AS educa_espa_trim, (SUM(vivienda * factor) / SUM(factor))::float AS vivienda_trim, (SUM(personales * factor) / SUM(factor))::float AS personales_trim, (SUM(limpieza * factor) / SUM(factor))::float AS limpieza_trim, (SUM(vesti_calz * factor) / SUM(factor))::float AS vesti_calz_trim, (SUM(salud * factor) / SUM(factor))::float AS salud_trim, (SUM(transf_gas * factor) / SUM(factor))::float AS transf_gas_trim FROM enigh.concentradohogar
```

→ `.mappings().one()` (`gastos_r`). Sin parámetros ligados en ninguna de las tres.

Tablas: `enigh.concentradohogar`.

### 2.4 Post-procesamiento

Lista `bounds` se llena en dos pasos, en este orden (el orden de salida es exactamente este):

**Ingreso (3 filas)** — itera `BOUNDS_INGRESO_TRIM` como `(scope, name, oficial, tol)`:

- `calc` = `total_r["mean_ing_cor_trim"]` si `scope == "total"`; `d1["mean_ing_cor_trim"]` si `scope == "d1"`; en otro caso `d10["mean_ing_cor_trim"]`.
- `delta = (calc - oficial) / oficial`
- Fila:
  - `id = f"ingreso_{scope}"` → `"ingreso_total"`, `"ingreso_d1"`, `"ingreso_d10"`
  - `scope = scope` → `"total"`, `"d1"`, `"d10"`
  - `metric = name`
  - `column = "ing_cor"`
  - `unit = "pesos trimestrales por hogar"`
  - `calculado = round(calc, 2)`
  - `oficial = float(oficial)`
  - `delta_pct = round(delta * 100, 4)`
  - `tolerance_pct = round(tol * 100, 2)`
  - `passing = abs(delta) <= tol`
  - `source = "INEGI Comunicado 112/25 p.5/6 cuadro 2"`

**Gasto (10 filas)** — itera `BOUNDS_GASTOS_MENSUAL` como `(col, slug, name, oficial, tol)`:

- `calc_trim = gastos_r[f"{col}_trim"]`
- `calc_mensual = calc_trim / 3.0`
- `delta = (calc_mensual - oficial) / oficial`
- Fila:
  - `id = f"gasto_{slug}"` → `"gasto_gasto_monetario"`, `"gasto_alimentos"`, `"gasto_transporte"`, `"gasto_educacion_esparcimiento"`, `"gasto_vivienda"`, `"gasto_cuidados_personales"`, `"gasto_limpieza_hogar"`, `"gasto_vestido_calzado"`, `"gasto_salud"`, `"gasto_transferencias_gasto"`
  - `scope = "mensual"`
  - `metric = name`
  - `column = col`
  - `unit = "pesos mensuales por hogar"`
  - `calculado = round(calc_mensual, 2)`
  - `oficial = float(oficial)`
  - `delta_pct = round(delta * 100, 4)`
  - `tolerance_pct = round(tol * 100, 2)`
  - `passing = abs(delta) <= tol`
  - `source = "INEGI Comunicado 112/25 p.5/6 cuadro 2"`

Resumen:

- `passing = sum(1 for b in bounds if b.passing)`
- `count = len(bounds)` (13), `failing = len(bounds) - passing`.

### 2.5 Modelo de respuesta

```python
class ValidacionRow(BaseModel):
    id: str
    scope: str
    metric: str
    column: str
    unit: str
    calculado: float
    oficial: float
    delta_pct: float
    tolerance_pct: float
    passing: bool
    source: str


class ValidacionesResponse(BaseModel):
    count: int
    passing: int
    failing: int
    bounds: list[ValidacionRow]
```

### 2.6 Errores

- `429`.
- Sin `HTTPException` propia. Si `d_rows` no contiene decil 1 o 10, `next()` lanza `StopIteration` → 500 no controlado. Si `mean_ing_cor_trim` fuera `NULL` (tabla vacía), `TypeError` → 500.

---

## 3. `GET /api/v1/enigh/hogares/summary`

### 3.1 Declaración

- Función: `hogares_summary(request: Request)`
- `response_model=HogaresSummary`
- Rate limit: `@limiter.limit("60/minute")`
- Docstring (description): `Agregado nacional ponderado: hogares muestra + expandido, mean ing_cor, mean gasto_mon.`
- `responses[200].description`: `Agregado nacional ponderado de hogares ENIGH 2024 NS.`
- `responses[200]` example (verbatim):

```json
{
    "n_hogares_muestra": 91414,
    "n_hogares_expandido": 38845190,
    "mean_ing_cor_trim": 77864.00,
    "mean_ing_cor_mensual": 25954.67,
    "mean_gasto_mon_trim": 47673.00,
    "mean_gasto_mon_mensual": 15891.00,
    "edition": "ENIGH 2024 Nueva Serie",
    "source": "INEGI ENIGH 2024 NS — concentradohogar (tabla summary oficial)"
}
```

- `responses[429]`: `_RESP_429`.

### 3.2 Parámetros

Ninguno.

### 3.3 SQL

`SQL_HOGARES_SUMMARY` (idéntico a §2.3-a), sin parámetros, `.mappings().one()`:

```sql

SELECT
    COUNT(*)::bigint AS n_muestra,
    SUM(factor)::bigint AS n_expandido,
    (SUM(ing_cor * factor) / SUM(factor))::float AS mean_ing_cor_trim,
    (SUM(gasto_mon * factor) / SUM(factor))::float AS mean_gasto_mon_trim
FROM enigh.concentradohogar

```

Tablas: `enigh.concentradohogar`.

### 3.4 Post-procesamiento

| campo | expresión |
|---|---|
| `n_hogares_muestra` | `r["n_muestra"]` |
| `n_hogares_expandido` | `r["n_expandido"]` |
| `mean_ing_cor_trim` | `round(r["mean_ing_cor_trim"], 2)` |
| `mean_ing_cor_mensual` | `round(r["mean_ing_cor_trim"] / 3.0, 2)` |
| `mean_gasto_mon_trim` | `round(r["mean_gasto_mon_trim"], 2)` |
| `mean_gasto_mon_mensual` | `round(r["mean_gasto_mon_trim"] / 3.0, 2)` |
| `edition` | `ENIGH_EDITION` = `"ENIGH 2024 Nueva Serie"` |
| `source` | literal `"INEGI ENIGH 2024 NS — concentradohogar (tabla summary oficial)"` |

Nota de paridad: el mensual se redondea a partir del trimestral crudo (no del trimestral ya redondeado).

### 3.5 Modelo de respuesta

```python
class HogaresSummary(BaseModel):
    n_hogares_muestra: int
    n_hogares_expandido: int
    mean_ing_cor_trim: float
    mean_ing_cor_mensual: float
    mean_gasto_mon_trim: float
    mean_gasto_mon_mensual: float
    edition: str
    source: str
```

### 3.6 Errores

- `429` únicamente.

---

## 4. `GET /api/v1/enigh/hogares/by-decil`

### 4.1 Declaración

- Función: `hogares_by_decil(request: Request)`
- `response_model=list[DecilRow]`
- Rate limit: `@limiter.limit("30/minute")`
- Docstring (description): `Distribución de ingreso/gasto por decil nacional (factor-weighted cumulative, INEGI-standard).`
- `responses[200].description`: `10 deciles nacionales por factor-weighted cumulative sum (INEGI-standard).`
- `responses[200]` example (verbatim):

```json
[
    {
        "decil": 1,
        "n_hogares_muestra": 9141,
        "n_hogares_expandido": 3884519,
        "mean_ing_cor_trim": 16795.00,
        "mean_ing_cor_mensual": 5598.33,
        "mean_gasto_mon_trim": 14550.00,
        "share_factor_pct": 10.0
    }
]
```

- `responses[429]`: `_RESP_429`.

### 4.2 Parámetros

Ninguno.

### 4.3 SQL

`SQL_HOGARES_BY_DECIL` (idéntico a §2.3-b), sin parámetros, `.mappings().all()`:

```sql

SELECT
    decil::int AS decil,
    COUNT(*)::bigint AS n_muestra,
    SUM(factor)::bigint AS n_expandido,
    (SUM(ing_cor * factor) / SUM(factor))::float AS mean_ing_cor_trim,
    (SUM(gasto_mon * factor) / SUM(factor))::float AS mean_gasto_mon_trim,
    (100.0 * SUM(factor) / (SELECT SUM(factor) FROM enigh.concentradohogar))::float AS share_factor_pct
FROM enigh.concentradohogar
WHERE decil IS NOT NULL
GROUP BY decil
ORDER BY decil

```

Tablas: `enigh.concentradohogar`.

Nota: el denominador de `share_factor_pct` es `SUM(factor)` de TODA la tabla (incluye filas con `decil IS NULL`, si las hubiera).

### 4.4 Post-procesamiento

Una fila por registro, en el orden de la consulta (`ORDER BY decil` ascendente):

| campo | expresión |
|---|---|
| `decil` | `r["decil"]` |
| `n_hogares_muestra` | `r["n_muestra"]` |
| `n_hogares_expandido` | `r["n_expandido"]` |
| `mean_ing_cor_trim` | `round(r["mean_ing_cor_trim"], 2)` |
| `mean_ing_cor_mensual` | `round(r["mean_ing_cor_trim"] / 3.0, 2)` |
| `mean_gasto_mon_trim` | `round(r["mean_gasto_mon_trim"], 2)` |
| `share_factor_pct` | `round(r["share_factor_pct"], 2)` |

No se expone `mean_gasto_mon_mensual` en este endpoint.

### 4.5 Modelo de respuesta

```python
class DecilRow(BaseModel):
    decil: int
    n_hogares_muestra: int
    n_hogares_expandido: int
    mean_ing_cor_trim: float
    mean_ing_cor_mensual: float
    mean_gasto_mon_trim: float
    share_factor_pct: float
```

La respuesta es una lista JSON (`list[DecilRow]`), no un objeto envolvente.

### 4.6 Errores

- `429` únicamente.

---

## 5. `GET /api/v1/enigh/hogares/by-entidad`

### 5.1 Declaración

- Función: `hogares_by_entidad(request: Request, entidad: str | None = Query(...))`
- `response_model=list[EntidadRow]`
- Rate limit: `@limiter.limit("30/minute")`
- Docstring (description): `Hogares agregados por entidad. Orden descendente por mean ing_cor.`
- `responses[200].description`: ``Hogares agregados por entidad federativa (32 filas o filtrado por `entidad`).``
- `responses[200]` example (verbatim):

```json
[
    {
        "clave": "09",
        "nombre": "Ciudad de México",
        "n_hogares_muestra": 4520,
        "n_hogares_expandido": 2810000,
        "mean_ing_cor_trim": 95300.00,
        "mean_ing_cor_mensual": 31766.67,
        "mean_gasto_mon_trim": 58200.00
    }
]
```

- `responses[404].description`: ``entidad` no encontrada en el filtro.`` (texto exacto: `` `entidad` no encontrada en el filtro. ``)
- `responses[429]`: `_RESP_429`.

### 5.2 Parámetros

| nombre | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|
| `entidad` (query) | `str \| None` | `None` | `pattern=r"^\d{2}$"` | no | `Clave entidad 2 dígitos (01-32). Si omite, devuelve las 32.` |

### 5.3 SQL

`SQL_HOGARES_BY_ENTIDAD`, parámetros `{"entidad": entidad}` (puede ser `None`), `.mappings().all()`:

```sql

SELECT
    LEFT(c.ubica_geo, 2) AS clave,
    e.descripcion AS nombre,
    COUNT(*)::bigint AS n_muestra,
    SUM(c.factor)::bigint AS n_expandido,
    (SUM(c.ing_cor * c.factor) / SUM(c.factor))::float AS mean_ing_cor_trim,
    (SUM(c.gasto_mon * c.factor) / SUM(c.factor))::float AS mean_gasto_mon_trim
FROM enigh.concentradohogar c
JOIN enigh.cat_entidad e ON LEFT(c.ubica_geo, 2) = e.clave
WHERE (CAST(:entidad AS text) IS NULL OR LEFT(c.ubica_geo, 2) = :entidad)
GROUP BY LEFT(c.ubica_geo, 2), e.descripcion
ORDER BY mean_ing_cor_trim DESC

```

Rama dinámica: única, vía SQL (`CAST(:entidad AS text) IS NULL` → sin filtro). No se altera el texto SQL en Python.

Tablas: `enigh.concentradohogar` (alias `c`), `enigh.cat_entidad` (alias `e`).

Nota: la clave de entidad aquí se deriva de `LEFT(concentradohogar.ubica_geo, 2)` (no de `hogares.entidad`).

### 5.4 Post-procesamiento

- Si `entidad` es truthy y `rows` está vacío → `404`.
- Una fila por registro, en el orden de la consulta (`ORDER BY mean_ing_cor_trim DESC`, calculado sobre el valor sin redondear):

| campo | expresión |
|---|---|
| `clave` | `r["clave"]` |
| `nombre` | `r["nombre"]` |
| `n_hogares_muestra` | `r["n_muestra"]` |
| `n_hogares_expandido` | `r["n_expandido"]` |
| `mean_ing_cor_trim` | `round(r["mean_ing_cor_trim"], 2)` |
| `mean_ing_cor_mensual` | `round(r["mean_ing_cor_trim"] / 3.0, 2)` |
| `mean_gasto_mon_trim` | `round(r["mean_gasto_mon_trim"], 2)` |

### 5.5 Modelo de respuesta

```python
class EntidadRow(BaseModel):
    clave: str
    nombre: str
    n_hogares_muestra: int
    n_hogares_expandido: int
    mean_ing_cor_trim: float
    mean_ing_cor_mensual: float
    mean_gasto_mon_trim: float
```

Respuesta: lista JSON (`list[EntidadRow]`).

### 5.6 Errores

- `404` — `HTTPException(404, f"Entidad '{entidad}' no encontrada")` → detail: `Entidad '99' no encontrada` (con la clave recibida entre comillas simples). Solo cuando `entidad` viene y la consulta no devuelve filas.
- `422` — `entidad` que no cumple `^\d{2}$`.
- `429`.

---

## 6. `GET /api/v1/enigh/poblacion/demographics`

### 6.1 Declaración

- Función: `poblacion_demographics(request: Request, entidad: str | None = Query(None, pattern=r"^\d{2}$"))`
- `response_model=DemographicsResponse`
- Rate limit: `@limiter.limit("30/minute")`
- Docstring (description): `Pirámide demográfica ponderada: sexo + 5 cohortes etarios. Opcional por entidad.`
- `responses[200].description`: `Pirámide demográfica ponderada (sexo + 5 cohortes etarios).`
- `responses[200]` example (verbatim):

```json
{
    "scope": "nacional",
    "n_personas_muestra": 308598,
    "n_personas_expandido": 130100000,
    "sexo": [{"sexo": "1", "n": 63500000}, {"sexo": "2", "n": 66600000}],
    "edad": [{"bucket": "0-14", "n_expandido": 30200000}]
}
```

  Advertencia de paridad: el ejemplo NO coincide con el modelo real (`SexoCount` emite `sexo="hombres"/"mujeres"`, `n_expandido` y `pct`; `EdadBucket` incluye `pct`). El contrato es el modelo, no el ejemplo.

- `responses[404].description`: `` `entidad` no encontrada. ``
- `responses[429]`: `_RESP_429`.

### 6.2 Parámetros

| nombre | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|
| `entidad` (query) | `str \| None` | `None` | `pattern=r"^\d{2}$"` | no | (sin description) |

### 6.3 SQL

`SQL_POBLACION_DEMOGRAPHICS`, parámetros `{"entidad": entidad}`, `.mappings().one()`:

```sql

SELECT
    COUNT(*)::bigint AS muestra,
    SUM(p.factor)::bigint AS expandido,
    SUM(CASE WHEN p.sexo='1' THEN p.factor ELSE 0 END)::bigint AS hombres_exp,
    SUM(CASE WHEN p.sexo='2' THEN p.factor ELSE 0 END)::bigint AS mujeres_exp,
    SUM(CASE WHEN p.edad < 15 THEN p.factor ELSE 0 END)::bigint AS edad_0_14,
    SUM(CASE WHEN p.edad BETWEEN 15 AND 29 THEN p.factor ELSE 0 END)::bigint AS edad_15_29,
    SUM(CASE WHEN p.edad BETWEEN 30 AND 44 THEN p.factor ELSE 0 END)::bigint AS edad_30_44,
    SUM(CASE WHEN p.edad BETWEEN 45 AND 64 THEN p.factor ELSE 0 END)::bigint AS edad_45_64,
    SUM(CASE WHEN p.edad >= 65 THEN p.factor ELSE 0 END)::bigint AS edad_65_plus
FROM enigh.poblacion p
LEFT JOIN enigh.hogares h USING (folioviv, foliohog)
WHERE (CAST(:entidad AS text) IS NULL OR h.entidad = :entidad)

```

Rama dinámica: única, vía SQL. El filtro de entidad usa `hogares.entidad` (texto, 2 dígitos), no `ubica_geo`.

Tablas: `enigh.poblacion` (alias `p`), `enigh.hogares` (alias `h`).

Notas de datos: `p.sexo` se compara como texto `'1'`/`'2'`; `p.edad` numérico. Personas con `edad NULL` o `sexo` fuera de `{'1','2'}` cuentan en `muestra`/`expandido` pero en ningún bucket. El endpoint siempre devuelve una sola fila (agregado sin GROUP BY).

### 6.4 Post-procesamiento

- Si `entidad` es truthy y `(r["expandido"] or 0) == 0` → `404`.
- `exp = r["expandido"]`
- `scope = f"entidad {entidad}" if entidad else "nacional"` → p. ej. `"entidad 09"` o `"nacional"`.
- `sexo` (lista de 2, en este orden):
  1. `SexoCount(sexo="hombres", n_expandido=r["hombres_exp"], pct=round(100 * r["hombres_exp"] / exp, 2))`
  2. `SexoCount(sexo="mujeres", n_expandido=r["mujeres_exp"], pct=round(100 * r["mujeres_exp"] / exp, 2))`
- `edad` (lista de 5, en este orden de `(label, col)`):
  - `("0-14", "edad_0_14")`
  - `("15-29", "edad_15_29")`
  - `("30-44", "edad_30_44")`
  - `("45-64", "edad_45_64")`
  - `("65+", "edad_65_plus")`
  - cada una: `EdadBucket(bucket=label, n_expandido=r[col], pct=round(100 * r[col] / exp, 2))`
- `n_personas_muestra = r["muestra"]`, `n_personas_expandido = exp`.
- Los `pct` son respecto al total `expandido` (no suman necesariamente 100 si hay sexo/edad fuera de rango).

### 6.5 Modelo de respuesta

```python
class SexoCount(BaseModel):
    sexo: str
    n_expandido: int
    pct: float


class EdadBucket(BaseModel):
    bucket: str
    n_expandido: int
    pct: float


class DemographicsResponse(BaseModel):
    scope: str
    n_personas_muestra: int
    n_personas_expandido: int
    sexo: list[SexoCount]
    edad: list[EdadBucket]
```

### 6.6 Errores

- `404` — `HTTPException(404, f"Entidad '{entidad}' no encontrada")` → detail `Entidad 'XX' no encontrada`. Solo con `entidad` presente y `expandido` nulo o 0.
- `422` — `entidad` que no cumple `^\d{2}$`.
- `429`.
- Sin `entidad` y tabla vacía: `exp` = `None`/0 → `TypeError`/`ZeroDivisionError` → 500 no controlado.

---

## 7. `GET /api/v1/enigh/gastos/by-rubro`

### 7.1 Declaración

- Función: `gastos_by_rubro(request: Request, decil: int | None = Query(None, ge=1, le=10))`
- `response_model=RubrosResponse`
- Rate limit: `@limiter.limit("30/minute")`
- Docstring (description), verbatim:

```
Los 9 rubros INEGI desde concentradohogar (summary oficial).

Cuando `decil` se especifica, la query se filtra a ese decil y `pct_del_monetario`
se calcula respecto al gasto_mon de ese decil. Los valores `oficial_mensual` solo
aplican al total nacional (no a deciles específicos).
```

- `responses[200].description`: `9 rubros INEGI con cifra mensual y trimestral por hogar.`
- `responses[200]` example (verbatim):

```json
{
    "scope": "nacional",
    "rubros": [
        {
            "slug": "alimentos",
            "nombre": "Alimentos, bebidas y tabaco",
            "mean_mensual": 5994.00,
            "mean_trim": 17982.00,
            "share_pct": 37.7
        }
    ]
}
```

  Advertencia de paridad: el ejemplo NO coincide con el modelo real (`RubrosResponse` tiene `decil`, `mean_gasto_mon_trim`, `rubros`; `RubroRow` tiene `mean_gasto_trim`, `mean_gasto_mensual`, `pct_del_monetario`, `oficial_mensual`, `bound_delta_pct`). El contrato es el modelo.

- `responses[429]`: `_RESP_429`. (No se declara 404 en `responses`, aunque el código sí lo lanza.)

### 7.2 Parámetros

| nombre | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|
| `decil` (query) | `int \| None` | `None` | `ge=1`, `le=10` | no | (sin description) |

### 7.3 SQL

Consulta construida en Python con f-string a partir de `RUBROS`:

```python
cols_select = ", ".join(
    f"(SUM({col} * factor) / SUM(factor))::float AS {col}_trim"
    for col, *_ in RUBROS
)
sql = f"""
SELECT
    (SUM(gasto_mon * factor) / SUM(factor))::float AS gasto_mon_trim,
    {cols_select}
FROM enigh.concentradohogar
WHERE (CAST(:decil AS int) IS NULL OR decil = :decil)
"""
```

Texto SQL resultante (con `cols_select` expandido; en el original la lista va en una sola línea con indentación de 4 espacios más):

```sql

    SELECT
        (SUM(gasto_mon * factor) / SUM(factor))::float AS gasto_mon_trim,
        (SUM(alimentos * factor) / SUM(factor))::float AS alimentos_trim, (SUM(transporte * factor) / SUM(factor))::float AS transporte_trim, (SUM(educa_espa * factor) / SUM(factor))::float AS educa_espa_trim, (SUM(vivienda * factor) / SUM(factor))::float AS vivienda_trim, (SUM(personales * factor) / SUM(factor))::float AS personales_trim, (SUM(limpieza * factor) / SUM(factor))::float AS limpieza_trim, (SUM(vesti_calz * factor) / SUM(factor))::float AS vesti_calz_trim, (SUM(salud * factor) / SUM(factor))::float AS salud_trim, (SUM(transf_gas * factor) / SUM(factor))::float AS transf_gas_trim
    FROM enigh.concentradohogar
    WHERE (CAST(:decil AS int) IS NULL OR decil = :decil)
    
```

Parámetros: `{"decil": decil}` (puede ser `None`). `.mappings().one()`. Rama dinámica: única, vía SQL (`CAST(:decil AS int) IS NULL`).

Tablas: `enigh.concentradohogar`.

### 7.4 Post-procesamiento

- `gasto_mon = r["gasto_mon_trim"] or 0`; si `gasto_mon == 0` → `404` con detail `f"Decil {decil} sin datos"` (con `decil=None` el texto sería `Decil None sin datos`).
- `oficiales = {col: of for col, _, _, of, _ in BOUNDS_GASTOS_MENSUAL}` → dict `col → valor_oficial_mensual` (incluye `gasto_mon: 15891`, que no se usa porque `gasto_mon` no está en `RUBROS`).
- Por cada `(col, slug, nombre)` en `RUBROS`, en ese orden (9 filas):
  - `trim = r[f"{col}_trim"]`
  - `mensual = trim / 3.0`
  - `of = oficiales.get(col)`
  - `delta = ((mensual - of) / of * 100) if (of and decil is None) else None`
  - `RubroRow(`
    - `slug=slug`,
    - `nombre=nombre`,
    - `mean_gasto_trim=round(trim, 2)`,
    - `mean_gasto_mensual=round(mensual, 2)`,
    - `pct_del_monetario=round(100 * trim / gasto_mon, 2)`,
    - `oficial_mensual=float(of) if (of and decil is None) else None`,
    - `bound_delta_pct=round(delta, 4) if delta is not None else None`
  - `)`
- Respuesta: `RubrosResponse(decil=decil, mean_gasto_mon_trim=round(gasto_mon, 2), rubros=rubros_out)`.
- Regla: con `decil` presente, `oficial_mensual` y `bound_delta_pct` son siempre `null`; sin `decil`, siempre están poblados para los 9 rubros (todos tienen oficial en `BOUNDS_GASTOS_MENSUAL`).
- `pct_del_monetario` usa el trimestral crudo sobre `gasto_mon_trim` crudo (equivale a mensual/mensual).

### 7.5 Modelo de respuesta

```python
class RubroRow(BaseModel):
    slug: str
    nombre: str
    mean_gasto_trim: float
    mean_gasto_mensual: float
    pct_del_monetario: float
    oficial_mensual: float | None
    bound_delta_pct: float | None


class RubrosResponse(BaseModel):
    decil: int | None
    mean_gasto_mon_trim: float
    rubros: list[RubroRow]
```

### 7.6 Errores

- `404` — `HTTPException(404, f"Decil {decil} sin datos")` → detail `Decil 7 sin datos` (cuando `gasto_mon_trim` es `NULL` o 0).
- `422` — `decil` fuera de `[1, 10]` o no entero.
- `429`.

---

## 8. `GET /api/v1/enigh/actividad/agro`

### 8.1 Declaración

- Función: `actividad_agro(request: Request)`
- `response_model=ActividadAgroResponse`
- Rate limit: `@limiter.limit("30/minute")`
- Docstring (description): `Hogares con actividad agropecuaria. Cobertura, distribución por decil, top entidades, ventas.`
- `responses[200].description`: `Hogares con actividad agropecuaria por decil nacional (DISTINCT folioviv/foliohog).`
- `responses[200]` example (verbatim):

```json
{
    "total_hogares_con_agro_expandido": 12390000,
    "deciles": [{"decil": 1, "n_hogares_expandido": 1239000, "share_pct": 31.9}]
}
```

  Advertencia de paridad: el ejemplo NO coincide con el modelo real (`ActividadAgroResponse`). El contrato es el modelo.

- `responses[429]`: `_RESP_429`.

### 8.2 Parámetros

Ninguno.

### 8.3 SQL

Cuatro consultas en una misma conexión, en este orden, sin parámetros:

**(a)** `SQL_AGRO_COBERTURA` → `.mappings().one()` (`cob`):

```sql

WITH hog_agro AS (
    SELECT DISTINCT folioviv, foliohog FROM enigh.agro
),
cob AS (
    SELECT COUNT(*)::bigint AS n_muestra,
           SUM(h.factor)::bigint AS n_expandido
    FROM hog_agro ha
    JOIN enigh.hogares h USING (folioviv, foliohog)
),
ventas AS (
    SELECT COALESCE(SUM(valrema), 0)::bigint AS sum_ventas,
           COALESCE(SUM(valproc), 0)::bigint AS sum_procesado
    FROM enigh.agro
)
SELECT cob.n_muestra, cob.n_expandido,
       (SELECT SUM(factor)::bigint FROM enigh.hogares) AS n_universo,
       ventas.sum_ventas, ventas.sum_procesado
FROM cob, ventas

```

**(b)** `SQL_AGRO_GASTO_NEGOCIO` → `.mappings().one()` (`gas`):

```sql

SELECT COALESCE(SUM(gasto), 0)::bigint AS sum_gasto_negocio
FROM enigh.agrogasto

```

**(c)** `SQL_AGRO_POR_DECIL` → `.mappings().all()` (`dec`):

```sql

WITH hog_agro AS (
    SELECT DISTINCT folioviv, foliohog FROM enigh.agro
),
agro_x_decil AS (
    SELECT c.decil::int AS decil,
           COUNT(*)::bigint AS n_muestra,
           SUM(c.factor)::bigint AS n_expandido
    FROM hog_agro ha
    JOIN enigh.concentradohogar c USING (folioviv, foliohog)
    WHERE c.decil IS NOT NULL
    GROUP BY c.decil
),
total_agro AS (SELECT SUM(n_expandido)::bigint AS t FROM agro_x_decil)
SELECT a.decil, a.n_muestra, a.n_expandido,
       (100.0 * a.n_expandido / (SELECT t FROM total_agro))::float AS pct_share_actividad
FROM agro_x_decil a ORDER BY a.decil

```

**(d)** `SQL_AGRO_TOP_ENTIDADES` → `.mappings().all()` (`ent`):

```sql

WITH hog_agro AS (
    SELECT DISTINCT folioviv, foliohog FROM enigh.agro
)
SELECT h.entidad AS clave, e.descripcion AS nombre,
       SUM(h.factor)::bigint AS n_expandido
FROM hog_agro ha
JOIN enigh.hogares h USING (folioviv, foliohog)
JOIN enigh.cat_entidad e ON h.entidad = e.clave
GROUP BY h.entidad, e.descripcion
ORDER BY n_expandido DESC
LIMIT 5

```

Tablas: `enigh.agro`, `enigh.hogares`, `enigh.agrogasto`, `enigh.concentradohogar`, `enigh.cat_entidad`.

Notas de datos:
- `sum_ventas`/`sum_procesado` son sumas muestrales SIN factor sobre todas las filas de `enigh.agro` (columnas `valrema`, `valproc`).
- `sum_gasto_negocio` suma la columna `gasto` de `enigh.agrogasto` (sin factor). La `note` de la respuesta dice `agrogasto.gas_nm_tri`, pero el SQL usa `gasto`.
- `sum_procesado` se consulta pero NO se expone en la respuesta.
- Cobertura por decil usa `concentradohogar.factor`; cobertura total y top entidades usan `hogares.factor`.

### 8.4 Post-procesamiento

- `n_muestra = cob["n_muestra"] or 0`
- `n_exp = cob["n_expandido"] or 0`
- `n_univ = cob["n_universo"] or 1` (centinela 1 para evitar división entre cero)
- `mean_ventas = (cob["sum_ventas"] / n_muestra) if n_muestra > 0 else 0.0` — promedio muestral (no ponderado) por hogar DISTINCT con agro.

| campo | expresión |
|---|---|
| `n_hogares_muestra` | `n_muestra` |
| `n_hogares_expandido` | `n_exp` |
| `pct_del_universo` | `round(100 * n_exp / n_univ, 2)` |
| `sum_ventas_trim` | `cob["sum_ventas"]` (entero, sin redondeo) |
| `sum_gasto_negocio_trim` | `gas["sum_gasto_negocio"]` (entero) |
| `mean_ventas_por_hogar` | `round(mean_ventas, 2)` |
| `por_decil` | por fila de `dec` (orden `ORDER BY a.decil`): `ActividadDecilRow(decil=r["decil"], n_hogares_muestra=r["n_muestra"], n_hogares_expandido=r["n_expandido"], pct_share_actividad=round(r["pct_share_actividad"], 2))` |
| `top_entidades` | por fila de `ent` (orden `n_expandido DESC`, máx. 5): `ActividadEntidadRow(clave=r["clave"], nombre=r["nombre"], n_hogares_expandido=r["n_expandido"])` |
| `note` | literal (ver abajo) |

`note` (verbatim, concatenación de literales adyacentes):

```
Agro = subsistencia rural (31.9% en decil 1, ratio d1/d10 = 12.8×). Ventas y gasto_negocio son trimestrales (agro.valrema/valproc, agrogasto.gas_nm_tri). Cobertura usa DISTINCT (folioviv, foliohog) porque agro es tabla persona-trabajo-tipoact.
```

### 8.5 Modelo de respuesta

```python
class ActividadDecilRow(BaseModel):
    decil: int
    n_hogares_muestra: int
    n_hogares_expandido: int
    pct_share_actividad: float


class ActividadEntidadRow(BaseModel):
    clave: str
    nombre: str
    n_hogares_expandido: int


class ActividadAgroResponse(BaseModel):
    n_hogares_muestra: int
    n_hogares_expandido: int
    pct_del_universo: float
    sum_ventas_trim: int
    sum_gasto_negocio_trim: int
    mean_ventas_por_hogar: float
    por_decil: list[ActividadDecilRow]
    top_entidades: list[ActividadEntidadRow]
    note: str
```

### 8.6 Errores

- `429` únicamente. Sin `HTTPException` propia.

---

## 9. `GET /api/v1/enigh/actividad/noagro`

### 9.1 Declaración

- Función: `actividad_noagro(request: Request)`
- `response_model=ActividadNoagroResponse`
- Rate limit: `@limiter.limit("30/minute")`
- Docstring (description): `Hogares con actividad NO agropecuaria (comercio, servicios, manufactura).`
- `responses[200].description`: `Hogares con actividad no agropecuaria por decil nacional.`
- `responses[200]` example (verbatim):

```json
{
    "total_hogares_con_noagro_expandido": 5800000,
    "deciles": [{"decil": 1, "n_hogares_expandido": 580000, "share_pct": 10.0}]
}
```

  Advertencia de paridad: el ejemplo NO coincide con el modelo real (`ActividadNoagroResponse`). El contrato es el modelo.

- `responses[429]`: `_RESP_429`.

### 9.2 Parámetros

Ninguno.

### 9.3 SQL

Cuatro consultas en una misma conexión, en este orden, sin parámetros:

**(a)** `SQL_NOAGRO_COBERTURA` → `.mappings().one()` (`cob`):

```sql

WITH hog_noagro AS (
    SELECT DISTINCT folioviv, foliohog FROM enigh.noagro
)
SELECT
    COUNT(*)::bigint AS n_muestra,
    SUM(h.factor)::bigint AS n_expandido,
    (SELECT SUM(factor)::bigint FROM enigh.hogares) AS n_universo
FROM hog_noagro hn
JOIN enigh.hogares h USING (folioviv, foliohog)

```

**(b)** `SQL_NOAGRO_TRIM` → `.mappings().one()` (`tri`):

```sql

SELECT COALESCE(SUM(ventas_tri), 0)::bigint AS sum_ventas_trim,
       COALESCE(SUM(ing_tri), 0)::bigint AS sum_ingreso_trim
FROM enigh.noagro

```

**(c)** `SQL_NOAGRO_POR_DECIL` → `.mappings().all()` (`dec`):

```sql

WITH hog_noagro AS (
    SELECT DISTINCT folioviv, foliohog FROM enigh.noagro
),
noagro_x_decil AS (
    SELECT c.decil::int AS decil,
           COUNT(*)::bigint AS n_muestra,
           SUM(c.factor)::bigint AS n_expandido
    FROM hog_noagro hn
    JOIN enigh.concentradohogar c USING (folioviv, foliohog)
    WHERE c.decil IS NOT NULL
    GROUP BY c.decil
),
total_noagro AS (SELECT SUM(n_expandido)::bigint AS t FROM noagro_x_decil)
SELECT a.decil, a.n_muestra, a.n_expandido,
       (100.0 * a.n_expandido / (SELECT t FROM total_noagro))::float AS pct_share_actividad
FROM noagro_x_decil a ORDER BY a.decil

```

**(d)** `SQL_NOAGRO_TOP_ENTIDADES` → `.mappings().all()` (`ent`):

```sql

WITH hog_noagro AS (
    SELECT DISTINCT folioviv, foliohog FROM enigh.noagro
)
SELECT h.entidad AS clave, e.descripcion AS nombre,
       SUM(h.factor)::bigint AS n_expandido
FROM hog_noagro hn
JOIN enigh.hogares h USING (folioviv, foliohog)
JOIN enigh.cat_entidad e ON h.entidad = e.clave
GROUP BY h.entidad, e.descripcion
ORDER BY n_expandido DESC
LIMIT 5

```

Tablas: `enigh.noagro`, `enigh.hogares`, `enigh.concentradohogar`, `enigh.cat_entidad`.

Notas de datos: `sum_ventas_trim`/`sum_ingreso_trim` son sumas muestrales SIN factor sobre todas las filas de `enigh.noagro` (columnas `ventas_tri`, `ing_tri`).

### 9.4 Post-procesamiento

- `n_muestra = cob["n_muestra"] or 0`
- `n_exp = cob["n_expandido"] or 0`
- `n_univ = cob["n_universo"] or 1`
- `mean_ventas = (tri["sum_ventas_trim"] / n_muestra) if n_muestra > 0 else 0.0`

| campo | expresión |
|---|---|
| `n_hogares_muestra` | `n_muestra` |
| `n_hogares_expandido` | `n_exp` |
| `pct_del_universo` | `round(100 * n_exp / n_univ, 2)` |
| `sum_ventas_trim` | `tri["sum_ventas_trim"]` (entero) |
| `sum_ingreso_trim` | `tri["sum_ingreso_trim"]` (entero) |
| `mean_ventas_por_hogar` | `round(mean_ventas, 2)` |
| `por_decil` | por fila de `dec` (orden `ORDER BY a.decil`): `ActividadDecilRow(decil=r["decil"], n_hogares_muestra=r["n_muestra"], n_hogares_expandido=r["n_expandido"], pct_share_actividad=round(r["pct_share_actividad"], 2))` |
| `top_entidades` | por fila de `ent` (orden `n_expandido DESC`, máx. 5): `ActividadEntidadRow(clave=r["clave"], nombre=r["nombre"], n_hogares_expandido=r["n_expandido"])` |
| `note` | literal (ver abajo) |

`note` (verbatim):

```
Noagro = transversal al tejido socioeconómico (banda 8.4-10.5% por decil, ratio d1/d10 = 1.3×). Perfil geográfico urbano/metropolitano (Edo Mex, CDMX, Jalisco). Cobertura usa DISTINCT (folioviv, foliohog).
```

### 9.5 Modelo de respuesta

```python
class ActividadNoagroResponse(BaseModel):
    n_hogares_muestra: int
    n_hogares_expandido: int
    pct_del_universo: float
    sum_ventas_trim: int
    sum_ingreso_trim: int
    mean_ventas_por_hogar: float
    por_decil: list[ActividadDecilRow]
    top_entidades: list[ActividadEntidadRow]
    note: str
```

(`ActividadDecilRow` y `ActividadEntidadRow` como en §8.5.)

### 9.6 Errores

- `429` únicamente.

---

## 10. `GET /api/v1/enigh/actividad/jcf`

### 10.1 Declaración

- Función: `actividad_jcf(request: Request)`
- `response_model=ActividadJcfResponse`
- Rate limit: `@limiter.limit("30/minute")`
- Docstring (description), verbatim:

```
Beneficiarios del Programa Jóvenes Construyendo el Futuro (JCF).

Dataset pequeño (n=327 muestra). Distribución por entidad + promedio ingreso trimestral.
Expandido usa poblacion.factor (factor de persona, no hogar) porque
beneficiarios son individuos.
```

- `responses[200].description`: `Hogares con ingresos por Jóvenes Construyendo el Futuro (327 hogares muestra).`
- `responses[200]` example (verbatim):

```json
{
    "total_hogares_jcf_muestra": 327,
    "total_hogares_jcf_expandido": 113000,
    "by_entidad": [{"clave": "31", "nombre": "Yucatán", "n_hogares_expandido": 8500}]
}
```

  Advertencia de paridad: el ejemplo NO coincide con el modelo real (`ActividadJcfResponse`). El contrato es el modelo.

- `responses[429]`: `_RESP_429`.

### 10.2 Parámetros

Ninguno.

### 10.3 SQL

Tres consultas en una misma conexión, en este orden, sin parámetros:

**(a)** `SQL_JCF_SUMMARY` → `.mappings().one()` (`sm`):

```sql

SELECT
    COUNT(DISTINCT (folioviv, foliohog, numren))::bigint AS n_muestra,
    SUM(ing_tri)::bigint AS sum_ing_tri
FROM enigh.ingresos_jcf

```

**(b)** `exp_sql` (cadena inline dentro de la función) → `.mappings().one()` (`ex`):

```sql

        SELECT COALESCE(SUM(p.factor), 0)::bigint AS n_expandido
        FROM (SELECT DISTINCT folioviv, foliohog, numren FROM enigh.ingresos_jcf) j
        JOIN enigh.poblacion p USING (folioviv, foliohog, numren)
        
```

**(c)** `SQL_JCF_POR_ENTIDAD` → `.mappings().all()` (`ent`):

```sql

SELECT h.entidad AS clave, e.descripcion AS nombre,
       COUNT(DISTINCT (j.folioviv, j.foliohog, j.numren))::bigint AS benef_muestra,
       SUM(p.factor)::bigint AS benef_expandido
FROM enigh.ingresos_jcf j
JOIN enigh.hogares h USING (folioviv, foliohog)
JOIN enigh.poblacion p USING (folioviv, foliohog, numren)
JOIN enigh.cat_entidad e ON h.entidad = e.clave
GROUP BY h.entidad, e.descripcion
ORDER BY benef_expandido DESC

```

Tablas: `enigh.ingresos_jcf`, `enigh.poblacion`, `enigh.hogares`, `enigh.cat_entidad`.

Notas de datos (relevantes para paridad):
- `n_muestra` cuenta personas DISTINCT `(folioviv, foliohog, numren)`; `sum_ing_tri` suma TODAS las filas de `ingresos_jcf` (si una persona tiene más de una fila, se suman todas).
- `n_expandido` total (b) se calcula sobre personas DISTINCT; en cambio `benef_expandido` por entidad (c) es `SUM(p.factor)` sobre las filas del join SIN DISTINCT, de modo que una persona con varias filas en `ingresos_jcf` aporta su factor varias veces. La suma de `beneficiarios_expandido` por entidad puede por tanto exceder a `n_beneficiarios_expandido`.

### 10.4 Post-procesamiento

- `n_mu = sm["n_muestra"] or 0`
- `sum_ing = sm["sum_ing_tri"] or 0`
- `mean_ing = (sum_ing / n_mu) if n_mu > 0 else 0.0`

| campo | expresión |
|---|---|
| `n_beneficiarios_muestra` | `n_mu` |
| `n_beneficiarios_expandido` | `ex["n_expandido"]` |
| `sum_ingreso_trim` | `sum_ing` (entero) |
| `mean_ingreso_trim_por_beneficiario` | `round(mean_ing, 2)` |
| `por_entidad` | por fila de `ent` (orden `benef_expandido DESC`, sin límite): `JcfEntidadRow(clave=r["clave"], nombre=r["nombre"], beneficiarios_muestra=r["benef_muestra"], beneficiarios_expandido=r["benef_expandido"])` |
| `note` | literal (ver abajo) |

`note` (verbatim):

```
Programa federal (2019+) que transfiere apoyo económico a jóvenes 18-29 en capacitación laboral. n=327 en la muestra nacional ENIGH 2024 NS implica cobertura relativamente baja; las cifras expandidas por entidad deben leerse con cautela estadística.
```

### 10.5 Modelo de respuesta

```python
class JcfEntidadRow(BaseModel):
    clave: str
    nombre: str
    beneficiarios_muestra: int
    beneficiarios_expandido: int


class ActividadJcfResponse(BaseModel):
    n_beneficiarios_muestra: int
    n_beneficiarios_expandido: int
    sum_ingreso_trim: int
    mean_ingreso_trim_por_beneficiario: float
    por_entidad: list[JcfEntidadRow]
    note: str
```

### 10.6 Errores

- `429` únicamente.

---

## Catálogos y constantes

### Imports del router

```python
from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import text

from app.database import engine
from app.rate_limit import limiter
from app.schemas.errors import HTTPError429
from app.schemas.enigh import (
    ActividadAgroResponse,
    ActividadDecilRow,
    ActividadEntidadRow,
    ActividadJcfResponse,
    ActividadNoagroResponse,
    DecilRow,
    DemographicsResponse,
    EdadBucket,
    EnighMetadata,
    EntidadRow,
    HogaresSummary,
    JcfEntidadRow,
    RubroRow,
    RubrosResponse,
    SexoCount,
    SourceRef,
    ValidacionRow,
    ValidacionesResponse,
)
```

### Constantes escalares

```python
router = APIRouter(prefix="/api/v1/enigh", tags=["enigh"])

_RESP_429 = {"model": HTTPError429, "description": "Rate limit excedido."}

ENIGH_EDITION = "ENIGH 2024 Nueva Serie"
ENIGH_REFERENCE_DATE = "2024 (levantamiento agosto-noviembre)"
ENIGH_PERIODICITY = "trimestral (expandido a nacional con factor)"
SCHEMA_VERSION = "007"
```

Literales hardcodeados dentro de funciones (no constantes de módulo):

- `/metadata`: `last_updated="2026-04-22"`, `total_tablas_ingestadas=17`, `total_catalogos=111`.
- `/hogares/summary`: `source="INEGI ENIGH 2024 NS — concentradohogar (tabla summary oficial)"`.
- `/validaciones`: `column="ing_cor"`, `unit="pesos trimestrales por hogar"`, `unit="pesos mensuales por hogar"`, `scope="mensual"`, `source="INEGI Comunicado 112/25 p.5/6 cuadro 2"` (mismo `source` para las 13 filas).
- `/poblacion/demographics`: `sexo="hombres"`, `sexo="mujeres"`, buckets `"0-14"`, `"15-29"`, `"30-44"`, `"45-64"`, `"65+"`, scope `"nacional"` / `f"entidad {entidad}"`.
- Divisor mensual: `3.0` en todos los endpoints.

### `BOUNDS_GASTOS_MENSUAL`

```python
# Los 10 HIGH bounds de gastos (INEGI Comunicado 112/25 p.5/6 — mensual):
BOUNDS_GASTOS_MENSUAL: list[tuple[str, str, str, int, float]] = [
    # (col, slug, nombre, valor_oficial_mensual, tol_rel)
    ("gasto_mon",  "gasto_monetario",       "Gasto monetario total",           15_891, 0.005),
    ("alimentos",  "alimentos",             "Alimentos, bebidas y tabaco",      5_994, 0.002),
    ("transporte", "transporte",            "Transporte y comunicaciones",      3_106, 0.002),
    ("educa_espa", "educacion_esparcimiento","Educación y esparcimiento",       1_531, 0.002),
    ("vivienda",   "vivienda",              "Vivienda y servicios",             1_449, 0.002),
    ("personales", "cuidados_personales",   "Cuidados personales",              1_236, 0.002),
    ("limpieza",   "limpieza_hogar",        "Enseres / limpieza del hogar",     1_005, 0.002),
    ("vesti_calz", "vestido_calzado",       "Vestido y calzado",                  610, 0.005),
    ("salud",      "salud",                 "Salud",                              535, 0.005),
    ("transf_gas", "transferencias_gasto",  "Transferencias y otros gastos",      425, 0.005),
]
```

Tabla equivalente (valores numéricos ya sin guiones bajos):

| col | slug | nombre | oficial mensual | tol_rel | tolerance_pct emitido |
|---|---|---|---|---|---|
| `gasto_mon` | `gasto_monetario` | Gasto monetario total | 15891 | 0.005 | 0.5 |
| `alimentos` | `alimentos` | Alimentos, bebidas y tabaco | 5994 | 0.002 | 0.2 |
| `transporte` | `transporte` | Transporte y comunicaciones | 3106 | 0.002 | 0.2 |
| `educa_espa` | `educacion_esparcimiento` | Educación y esparcimiento | 1531 | 0.002 | 0.2 |
| `vivienda` | `vivienda` | Vivienda y servicios | 1449 | 0.002 | 0.2 |
| `personales` | `cuidados_personales` | Cuidados personales | 1236 | 0.002 | 0.2 |
| `limpieza` | `limpieza_hogar` | Enseres / limpieza del hogar | 1005 | 0.002 | 0.2 |
| `vesti_calz` | `vestido_calzado` | Vestido y calzado | 610 | 0.005 | 0.5 |
| `salud` | `salud` | Salud | 535 | 0.005 | 0.5 |
| `transf_gas` | `transferencias_gasto` | Transferencias y otros gastos | 425 | 0.005 | 0.5 |

### `BOUNDS_INGRESO_TRIM`

```python
# Los 3 HIGH bounds de ingreso (INEGI Comunicado 112/25 p.5/6 cuadro 2 — trimestral):
BOUNDS_INGRESO_TRIM: list[tuple[str, str, int, float]] = [
    ("total", "Ingreso corriente promedio por hogar (total)", 77_864, 0.01),
    ("d1",    "Ingreso corriente promedio — decil I",          16_795, 0.02),
    ("d10",   "Ingreso corriente promedio — decil X",         236_095, 0.03),
]
```

| scope | metric | oficial trimestral | tol_rel | tolerance_pct emitido |
|---|---|---|---|---|
| `total` | Ingreso corriente promedio por hogar (total) | 77864 | 0.01 | 1.0 |
| `d1` | Ingreso corriente promedio — decil I | 16795 | 0.02 | 2.0 |
| `d10` | Ingreso corriente promedio — decil X | 236095 | 0.03 | 3.0 |

### `RUBROS`

```python
# 9 rubros INEGI (sin gasto_mon total) — para /gastos/by-rubro y narrative
RUBROS: list[tuple[str, str, str]] = [
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

### `SOURCES`

```python
SOURCES: list[SourceRef] = [
    SourceRef(
        title="Comunicado de Prensa 112/25 — ENIGH 2024",
        url="https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2025/enigh/ENIGH2024.pdf",
        consulted_on="2026-04-21",
    ),
    SourceRef(
        title="Presentación de resultados ENIGH 2024 (JULIO 2025)",
        url="https://www.inegi.org.mx/contenidos/programas/enigh/nc/2024/doc/enigh2024_ns_presentacion_resultados.pdf",
        consulted_on="2026-04-22",
    ),
    SourceRef(
        title="Catálogo ENIGH 2024 — Nueva Serie",
        url="https://www.inegi.org.mx/programas/enigh/nc/2024/",
        consulted_on="2026-04-21",
    ),
]
```

### `METHODOLOGY_NOTES`

Cinco cadenas (cada una es una concatenación de literales adyacentes; se muestran ya unidas):

1. `Todas las cifras nacionales usan SUM(columna * factor) / SUM(factor); los agregados muestrales (simple promedio de filas) NO se exponen.`
2. `Las publicaciones oficiales INEGI se reproducen desde concentradohogar (tabla summary), no desde gastoshogar (tabla ledger de eventos). Ver §1.quater del plan de schema: concentradohogar integra dedup/neteo aplicado por INEGI internamente.`
3. `Las cifras publicadas por INEGI son MENSUALES; el microdato almacena TRIMESTRALES. Los endpoints devuelven ambas unidades cuando aplica.`
4. `Cobertura 'hogares con actividad X' usa DISTINCT (folioviv, foliohog) sobre la tabla de la actividad porque agro/noagro son tablas persona-trabajo-tipoact, no hogar-raíz.`
5. `cat_entidad.clave usa 2 dígitos (01-32); se deriva vía LEFT(ubica_geo, 2) o se toma directo de hogares.entidad según la tabla.`

Código fuente:

```python
METHODOLOGY_NOTES: list[str] = [
    "Todas las cifras nacionales usan SUM(columna * factor) / SUM(factor); "
    "los agregados muestrales (simple promedio de filas) NO se exponen.",
    "Las publicaciones oficiales INEGI se reproducen desde concentradohogar "
    "(tabla summary), no desde gastoshogar (tabla ledger de eventos). "
    "Ver §1.quater del plan de schema: concentradohogar integra dedup/neteo "
    "aplicado por INEGI internamente.",
    "Las cifras publicadas por INEGI son MENSUALES; el microdato almacena "
    "TRIMESTRALES. Los endpoints devuelven ambas unidades cuando aplica.",
    "Cobertura 'hogares con actividad X' usa DISTINCT (folioviv, foliohog) "
    "sobre la tabla de la actividad porque agro/noagro son tablas "
    "persona-trabajo-tipoact, no hogar-raíz.",
    "cat_entidad.clave usa 2 dígitos (01-32); se deriva vía LEFT(ubica_geo, 2) "
    "o se toma directo de hogares.entidad según la tabla.",
]
```

### Notas `note` de respuesta (literales, ya unidas)

- `/actividad/agro`: `Agro = subsistencia rural (31.9% en decil 1, ratio d1/d10 = 12.8×). Ventas y gasto_negocio son trimestrales (agro.valrema/valproc, agrogasto.gas_nm_tri). Cobertura usa DISTINCT (folioviv, foliohog) porque agro es tabla persona-trabajo-tipoact.`
- `/actividad/noagro`: `Noagro = transversal al tejido socioeconómico (banda 8.4-10.5% por decil, ratio d1/d10 = 1.3×). Perfil geográfico urbano/metropolitano (Edo Mex, CDMX, Jalisco). Cobertura usa DISTINCT (folioviv, foliohog).`
- `/actividad/jcf`: `Programa federal (2019+) que transfiere apoyo económico a jóvenes 18-29 en capacitación laboral. n=327 en la muestra nacional ENIGH 2024 NS implica cobertura relativamente baja; las cifras expandidas por entidad deben leerse con cautela estadística.`

### Mensajes de error (`HTTPException`)

| endpoint | status | detail (f-string) |
|---|---|---|
| `/hogares/by-entidad` | 404 | `f"Entidad '{entidad}' no encontrada"` |
| `/poblacion/demographics` | 404 | `f"Entidad '{entidad}' no encontrada"` |
| `/gastos/by-rubro` | 404 | `f"Decil {decil} sin datos"` |
| todos | 429 | slowapi; modelo `HTTPError429`, descripción `Rate limit excedido.` |

### Resumen de rate limits

| endpoint | límite |
|---|---|
| `/metadata` | `60/minute` |
| `/validaciones` | `30/minute` |
| `/hogares/summary` | `60/minute` |
| `/hogares/by-decil` | `30/minute` |
| `/hogares/by-entidad` | `30/minute` |
| `/poblacion/demographics` | `30/minute` |
| `/gastos/by-rubro` | `30/minute` |
| `/actividad/agro` | `30/minute` |
| `/actividad/noagro` | `30/minute` |
| `/actividad/jcf` | `30/minute` |

### Esquema Pydantic completo (`app/schemas/enigh.py`)

Docstring del módulo (verbatim):

```
Pydantic response models for ENIGH 2024 Nueva Serie endpoints.

All monetary averages are **trimestral** (as published by INEGI in the raw
microdata) unless the field name ends in `_mensual`. Expanded counts are
factor-weighted to national totals.
```

Todos los modelos heredan de `pydantic.BaseModel` sin `Field(...)`, sin descripciones de campo, sin alias, sin validadores ni configuración extra. Ningún campo tiene default; los `float | None` aceptan `null`. Orden de declaración:

`SourceRef`, `EnighMetadata`, `ValidacionRow`, `ValidacionesResponse`, `HogaresSummary`, `DecilRow`, `EntidadRow`, `SexoCount`, `EdadBucket`, `DemographicsResponse`, `RubroRow`, `RubrosResponse`, `ActividadDecilRow`, `ActividadEntidadRow`, `ActividadAgroResponse`, `ActividadNoagroResponse`, `JcfEntidadRow`, `ActividadJcfResponse`.

(Definiciones completas en las secciones 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5.)

### Tablas y vistas referenciadas (todas en el esquema `enigh`)

No se referencia ninguna vista ni vista materializada; solo tablas base. Ninguna consulta usa `gastoshogar` (explícitamente evitada por el docstring del módulo).

| tabla | columnas usadas por el router | endpoints |
|---|---|---|
| `enigh.concentradohogar` | `factor`, `ing_cor`, `gasto_mon`, `decil`, `ubica_geo`, `folioviv`, `foliohog`, `alimentos`, `transporte`, `educa_espa`, `vivienda`, `personales`, `limpieza`, `vesti_calz`, `salud`, `transf_gas` | metadata, validaciones, hogares/summary, hogares/by-decil, hogares/by-entidad, gastos/by-rubro, actividad/agro, actividad/noagro |
| `enigh.cat_entidad` | `clave` (texto 2 dígitos), `descripcion` | hogares/by-entidad, actividad/agro, actividad/noagro, actividad/jcf |
| `enigh.hogares` | `folioviv`, `foliohog`, `factor`, `entidad` (texto 2 dígitos) | poblacion/demographics, actividad/agro, actividad/noagro, actividad/jcf |
| `enigh.poblacion` | `folioviv`, `foliohog`, `numren`, `factor`, `sexo` (texto `'1'`/`'2'`), `edad` | poblacion/demographics, actividad/jcf |
| `enigh.agro` | `folioviv`, `foliohog`, `valrema`, `valproc` | actividad/agro |
| `enigh.agrogasto` | `gasto` | actividad/agro |
| `enigh.noagro` | `folioviv`, `foliohog`, `ventas_tri`, `ing_tri` | actividad/noagro |
| `enigh.ingresos_jcf` | `folioviv`, `foliohog`, `numren`, `ing_tri` | actividad/jcf |

Lista plana para migración:

1. `enigh.concentradohogar`
2. `enigh.cat_entidad`
3. `enigh.hogares`
4. `enigh.poblacion`
5. `enigh.agro`
6. `enigh.agrogasto`
7. `enigh.noagro`
8. `enigh.ingresos_jcf`

Joins usados (claves de unión):

- `concentradohogar ⋈ cat_entidad` por `LEFT(c.ubica_geo, 2) = e.clave`
- `hogares ⋈ cat_entidad` por `h.entidad = e.clave`
- `poblacion ⋈ hogares` por `USING (folioviv, foliohog)` (LEFT JOIN)
- `agro / noagro (DISTINCT) ⋈ hogares` por `USING (folioviv, foliohog)`
- `agro / noagro (DISTINCT) ⋈ concentradohogar` por `USING (folioviv, foliohog)`
- `ingresos_jcf ⋈ hogares` por `USING (folioviv, foliohog)`
- `ingresos_jcf ⋈ poblacion` por `USING (folioviv, foliohog, numren)`

# ENOE — contrato de endpoints del router legado

Fuente: `datos-itam/api/app/routers/enoe.py` (2717 líneas) y `datos-itam/api/app/schemas/enoe.py` (527 líneas).
Documento literal para prueba de paridad: cadenas, nombres de campo, orden, SQL y redondeo se copian tal cual del código.
Nada del checkout `datos-itam` fue modificado.

## Encabezado del router

```python
router = APIRouter(prefix="/api/v1/enoe", tags=["enoe"])
```

Imports relevantes: `re`, `time`, `typing.Any/Optional`, `fastapi.APIRouter/HTTPException/Path/Query/Request`, `sqlalchemy.text`, `app.database.engine`, `app.rate_limit.limiter`, `app.schemas.errors.HTTPError404/HTTPError429`, y los modelos de `app.schemas.enoe` listados en la sección «Modelos de respuesta».

Reglas comunes a todos los endpoints:

- Todos son `GET`, `async`, y reciben `request: Request` como primer parámetro (requerido por `@limiter.limit(...)` de slowapi). El decorador `@router.get(...)` va por fuera y `@limiter.limit("N/minute")` por dentro (inmediatamente sobre la función).
- Todos declaran `summary=` y `description=` explícitos en el decorador (ninguno deriva del nombre de la función ni del docstring). Se transcriben verbatim; el nombre de la función se da como referencia.
- 100 % público: no hay `require_admin` ni autenticación.
- Ejecución SQL: `sqlalchemy.text(SQL)` sobre `async with engine.connect() as conn`; resultados vía `.mappings().one()` / `.mappings().one_or_none()` / `.mappings().all()` / `.scalar_one()`. Parámetros ligados por nombre (`:slug`, `:periodo`, …) con el dict pasado como segundo argumento de `conn.execute`. Ningún endpoint abre transacción explícita ni hace commit.
- Redondeo: siempre `round()` nativo de Python 3 sobre `float` (redondeo a par en empates binarios). Indicadores: `round(float(valor), 6)`. Distribuciones: `round(float(pct_ocupados), 4)`. Tiempo de query: `round(ms, 2)`.
- Rate limit: `limiter = Limiter(key_func=get_real_ip if not settings.testing else _no_limit, enabled=not settings.testing)`; `get_real_ip` toma el primer valor de `x-forwarded-for` o `request.client.host` o `"unknown"`. Con `settings.testing` el limiter queda deshabilitado.
- Errores comunes:
  - `429` — modelo `HTTPError429` (`{"detail": "Rate limit exceeded. Try again later."}` por default), descripción declarada `"Rate limit excedido."` (en `/microdatos/{tabla}/list`: `"Rate limit excedido (10 req/min por IP)."`).
  - `422` — validación automática de FastAPI para parámetros que violan `pattern` / `ge` / `le` / `Literal` (shape `HTTPValidationError`, lista de errores), MÁS los `422` explícitos del router vía `HTTPException(status_code=422, detail="...")` (shape `{"detail": "..."}`). Se listan por endpoint.
  - `404`/`503` — `HTTPException` con `detail` string; se listan verbatim por endpoint.
- Modelos de error (`app/schemas/errors.py`):

```python
class HTTPError(BaseModel):
    detail: str

class HTTPError404(HTTPError):
    detail: str = Field(default="Recurso no encontrado",
                        description="El recurso solicitado no existe.",
                        examples=["Persona no encontrada"])

class HTTPError429(HTTPError):
    detail: str = Field(default="Rate limit exceeded. Try again later.",
                        description="Rate limit por IP excedido para este endpoint.",
                        examples=["Rate limit exceeded. Try again later."])
```

Docstring del módulo (verbatim):

```
Public REST endpoints for ENOE — Encuesta Nacional de Ocupación y Empleo.

Dataset: INEGI ENOE 15+
  Cobertura: 2005T1 → 2025T1 (80 trimestres, gap documental 2020T2 ETOE)
  Microdatos: 101,512,667 filas (5 tablas: viv/hog/sdem/coe1/coe2)
  Agregados: 76,557 filas (indicadores nacionales/entidad + cortes sector/posicion)
  3 etapas metodológicas: clasica (2005T1-2020T1), etoe_telefonica (2020T2 sin
  microdatos), enoe_n (2020T3-presente, marco post-Censo 2020).

Sub-fase 3.3 — endpoints catálogos + metadata + health (5 endpoints).
Sub-fase 3.4 — endpoints indicadores agregados nacional + entidad + ranking (5 endpoints).
Patrón heredado de consar:
  - 100% público (sin require_admin)
  - Rate limiting vía slowapi
  - Caveats metodológicos en cada response donde aplique
  - SQL puro con engine.connect() + text()
```

Docstring del módulo de schemas (verbatim):

```
Pydantic response models for ENOE endpoints.

Dataset: Encuesta Nacional de Ocupación y Empleo (INEGI).
  Cobertura: 2005T1 → 2025T1 (80 trimestres, gap documental en 2020T2 ETOE).
  Microdatos: 101.5M filas (5 tablas).
  Agregados: 76,557 filas (4 tablas).

Patrón heredado de consar (Sub-fase 3.3 Fase 3):
  - BaseModel sin ConfigDict.json_schema_extra (OpenAPI infiere de tipos)
  - caveats: list[str] per-response, llenados con constantes CAVEAT_* en el router
  - source: str (referencia oficial INEGI)
```

Orden de rutas en el archivo (numeración de los comentarios del propio router):

| # | Ruta | Rate limit | Tablas (schema-qualified) | Microdatos |
|---|---|---|---|---|
| 1 | `GET /api/v1/enoe/health` | 60/minute | `enoe.cargas`, `enoe.estadisticas_globales` | no |
| 2 | `GET /api/v1/enoe/metadata` | 60/minute | `enoe.indicadores_nacionales`, `enoe.cat_entidad`, `enoe.cargas`, `enoe.estadisticas_globales` | no |
| 3 | `GET /api/v1/enoe/catalogos/indicadores` | 60/minute | `enoe.indicadores_nacionales`, `enoe.indicadores_entidad` | no |
| 4 | `GET /api/v1/enoe/catalogos/entidades` | 60/minute | `enoe.cat_entidad` | no |
| 5 | `GET /api/v1/enoe/catalogos/etapas-metodologicas` | 60/minute | (ninguna — respuesta declarativa) | no |
| 6 | `GET /api/v1/enoe/indicadores/nacional/serie` | 30/minute | `enoe.indicadores_nacionales` | no |
| 7 | `GET /api/v1/enoe/indicadores/nacional/snapshot` | 30/minute | `enoe.indicadores_nacionales` | no |
| 8 | `GET /api/v1/enoe/indicadores/entidad/serie` | 30/minute | `enoe.cat_entidad`, `enoe.indicadores_entidad` | no |
| 9 | `GET /api/v1/enoe/indicadores/entidad/snapshot` | 30/minute | `enoe.indicadores_entidad`, `enoe.cat_entidad` | no |
| 10 | `GET /api/v1/enoe/indicadores/entidad/ranking` | 30/minute | `enoe.indicadores_entidad`, `enoe.cat_entidad` | no |
| 11 | `GET /api/v1/enoe/ocupados/por-sector/snapshot` | 30/minute | `enoe.cat_entidad` (solo nivel=entidad), `enoe.poblacion_ocupada_por_sector` | no |
| 12 | `GET /api/v1/enoe/ocupados/por-sector/serie` | 30/minute | `enoe.cat_entidad` (solo nivel=entidad), `enoe.poblacion_ocupada_por_sector` | no |
| 13 | `GET /api/v1/enoe/ocupados/por-posicion/snapshot` | 30/minute | `enoe.cat_entidad` (solo nivel=entidad), `enoe.poblacion_ocupada_por_posicion` | no |
| 14 | `GET /api/v1/enoe/ocupados/por-posicion/serie` | 30/minute | `enoe.cat_entidad` (solo nivel=entidad), `enoe.poblacion_ocupada_por_posicion` | no |
| 15 | `GET /api/v1/enoe/microdatos/{tabla}/list` | 10/minute | `enoe.microdatos_viv` / `enoe.microdatos_hog` / `enoe.microdatos_sdem` / `enoe.microdatos_coe1` / `enoe.microdatos_coe2` (según `{tabla}`) | **SÍ** |
| 16 | `GET /api/v1/enoe/microdatos/{tabla}/count` | 30/minute | `enoe.microdatos_*` (según `{tabla}`) | **SÍ** |
| 17 | `GET /api/v1/enoe/microdatos/{tabla}/schema` | 60/minute | `information_schema.columns`, `pg_index`, `pg_class`, `pg_namespace`, `enoe.estadisticas_globales` (catálogos del sistema sobre `enoe.microdatos_*`; NO lee filas de microdatos) | metadata solamente |

---

## 1. `GET /api/v1/enoe/health`

### 1.1 Declaración

- Función: `get_enoe_health(request: Request) -> EnoeHealth`
- `response_model=EnoeHealth`
- `summary="Status operacional del dataset ENOE"`
- `description` (verbatim):

```
Verifica conectividad a la base de datos, último periodo cargado, timestamp de la última carga exitosa y totales de microdatos + indicadores agregados. Si la base no es alcanzable retorna HTTP 503. Los counts provienen de la tabla pre-computada `enoe.estadisticas_globales` (refrescada al final de cada script ETL — migration 033).
```

- Rate limit: `@limiter.limit("60/minute")`
- `responses` declarados:
  - `200`: `"Servicio ENOE operativo."` — ejemplo:
    ```python
    {"status": "ok", "ultimo_periodo": "2025T1", "ultima_carga": "2026-05-11T00:00:00Z",
     "total_microdatos": 101512667, "total_indicadores_agregados": 76557,
     "cobertura_temporal": "2005T1-2025T1"}
    ```
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`
  - `503`: `{"description": "Base de datos no alcanzable."}`

### 1.2 Parámetros

Ninguno (solo `request`).

### 1.3 SQL

Comentario del código sobre la constante (verbatim):

```
# Counts EXACTOS leídos de enoe.estadisticas_globales (migration 033).
# La tabla es refrescada explícitamente al final de los scripts ETL.
# Para refrescar manualmente: SELECT enoe.refresh_estadisticas_globales();
```

`SQL_HEALTH` (sin parámetros):

```sql
SELECT
    (SELECT max(finalizado_en) FROM enoe.cargas WHERE status = 'success') AS ultima_carga,
    eg.total_microdatos,
    eg.total_agregados,
    eg.primer_periodo,
    eg.ultimo_periodo
FROM (
    SELECT
        COALESCE(SUM(total_filas) FILTER (WHERE es_microdatos), 0)     AS total_microdatos,
        COALESCE(SUM(total_filas) FILTER (WHERE NOT es_microdatos), 0) AS total_agregados,
        MIN(primer_periodo) FILTER (WHERE es_microdatos)               AS primer_periodo,
        MAX(ultimo_periodo) FILTER (WHERE es_microdatos)               AS ultimo_periodo
    FROM enoe.estadisticas_globales
) eg
```

Ejecución: `(await conn.execute(text(SQL_HEALTH))).mappings().one()` dentro de `try/except Exception`.

Tablas: `enoe.cargas`, `enoe.estadisticas_globales`. Agregadas (no microdatos).

### 1.4 Post-procesamiento

```python
primer = row["primer_periodo"]
ultimo = row["ultimo_periodo"]
cobertura = f"{primer}-{ultimo}" if primer and ultimo else None
```

- `status` siempre `"ok"` (nunca se emite `"degraded"` ni `"error"`; el fallo es 503).
- `ultimo_periodo = ultimo` (puede ser `None`).
- `ultima_carga = row["ultima_carga"]` (datetime o `None`).
- `total_microdatos = int(row["total_microdatos"])`, `total_indicadores_agregados = int(row["total_agregados"])` (los `COALESCE(...,0)` garantizan enteros).
- `cobertura_temporal = cobertura`.

### 1.5 Modelo de respuesta

```python
class EnoeHealth(BaseModel):
    status: str                      # "ok" | "degraded" | "error"  (comentario; en la práctica siempre "ok")
    ultimo_periodo: Optional[str]
    ultima_carga: Optional[datetime]
    total_microdatos: int
    total_indicadores_agregados: int
    cobertura_temporal: Optional[str]
```

### 1.6 Errores

- `503` — cualquier excepción al conectar/ejecutar: `detail=f"ENOE health check failed: {e!s}"`.
- `429` — rate limit.

---

## 2. `GET /api/v1/enoe/metadata`

### 2.1 Declaración

- Función: `get_enoe_metadata(request: Request) -> EnoeMetadata`
- `response_model=EnoeMetadata`
- `summary="Metadata completa del dataset ENOE"`
- `description` (verbatim, contiene `\n`):

```
Información sobre fuente, periodicidad, cobertura temporal y geográfica, tablas disponibles con conteo de filas y `status` de disponibilidad, etapas metodológicas y caveats interpretativos. Los counts provienen de la tabla pre-computada `enoe.estadisticas_globales` (migration 033).

**Sobre `tablas_disponibles[].status`**: el campo señaliza la disponibilidad efectiva de cada tabla del schema:
- `available` — tabla con datos ingestados.
- `schema-ready` — tabla creada pero aún sin datos (roadmap futuro). Las tablas `indicadores_area_metropolitana` e `indicadores_anuales_ampliado` están en este estado: schema completo, ingesta posterior pendiente. Cualquier endpoint que intente consumirlas regresará respuestas vacías hasta entonces.
- `deprecated` — reservado para uso futuro.

El booleano `has_data` se mantiene por compatibilidad con consumidores existentes; es derivable de `status` (`status == 'available'` ⇔ `has_data is True`).
```

- Rate limit: `@limiter.limit("60/minute")`
- `responses` declarados:
  - `200`: `"Metadata completa del dataset ENOE."` — ejemplo:
    ```python
    {"nombre": "Encuesta Nacional de Ocupación y Empleo", "acronimo": "ENOE", "fuente": "INEGI",
     "fuente_url": "https://www.inegi.org.mx/programas/enoe/15ymas/", "periodicidad": "Trimestral",
     "cobertura_temporal": "2005T1-2025T1 (80 trimestres con datos; gap documental en 2020T2)",
     "cobertura_geografica": "Nacional + 32 entidades federativas",
     "n_trimestres_disponibles": 80, "n_indicadores": 13, "n_entidades": 32,
     "etapas_metodologicas": ["clasica", "etoe_telefonica", "enoe_n"],
     "tablas_disponibles": [
         {"nombre": "microdatos_sdem", "descripcion": "Microdatos Sociodemográficos (fuente operativa de los indicadores)",
          "n_filas": 31500762, "has_data": True, "status": "available"},
         {"nombre": "indicadores_area_metropolitana", "descripcion": "Indicadores por área metropolitana (schema-ready, pendiente Fase 4)",
          "n_filas": 0, "has_data": False, "status": "schema-ready"}],
     "total_microdatos": 101512667, "total_agregados": 76557, "caveats": [], "sources": [],
     "last_updated": "2026-05-11T00:00:00Z"}
    ```
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`

### 2.2 Parámetros

Ninguno.

### 2.3 SQL

Comentario del código (verbatim):

```
# Igual que SQL_HEALTH: counts EXACTOS desde enoe.estadisticas_globales
# (migration 033). Los rangos de periodo y n_trimestres siguen consultando
# enoe.indicadores_nacionales directamente — esa tabla solo tiene 1,040
# filas y la consulta cuesta <5ms (no necesita pre-cómputo).
```

`SQL_METADATA_AGREGADOS` (sin parámetros; `.mappings().one()`):

```sql
SELECT
    (SELECT min(periodo)                FROM enoe.indicadores_nacionales) AS primer_periodo,
    (SELECT max(periodo)                FROM enoe.indicadores_nacionales) AS ultimo_periodo,
    (SELECT count(DISTINCT periodo)     FROM enoe.indicadores_nacionales) AS n_trimestres,
    (SELECT count(*)                    FROM enoe.cat_entidad)            AS n_entidades,
    (SELECT max(finalizado_en) FROM enoe.cargas WHERE status = 'success') AS ultima_carga
```

`SQL_METADATA_TABLAS` (sin parámetros; `.mappings().all()`):

```sql
SELECT tabla, total_filas, es_microdatos
FROM enoe.estadisticas_globales
```

Ambas se ejecutan en la misma conexión, en ese orden.

Tablas: `enoe.indicadores_nacionales`, `enoe.cat_entidad`, `enoe.cargas`, `enoe.estadisticas_globales`. Agregadas.

### 2.4 Post-procesamiento

```python
tabla_counts: dict[str, int] = {r["tabla"]: int(r["total_filas"]) for r in tablas_rows}

_SCHEMA_READY_TABLES = {"indicadores_area_metropolitana", "indicadores_anuales_ampliado"}   # local a la función
tablas = [
    TablaDisponible(
        nombre=t,
        descripcion=_TABLA_DESCRIPCIONES[t],
        n_filas=tabla_counts.get(t, 0),
        has_data=tabla_counts.get(t, 0) > 0,
        status="schema-ready" if t in _SCHEMA_READY_TABLES else "available",
    )
    for t in _TABLA_DESCRIPCIONES
]

total_microdatos = sum(int(r["total_filas"]) for r in tablas_rows if r["es_microdatos"])
total_agregados = sum(int(r["total_filas"]) for r in tablas_rows if not r["es_microdatos"])

primer = meta_row["primer_periodo"]
ultimo = meta_row["ultimo_periodo"]
cobertura = (
    f"{primer}-{ultimo} ({int(meta_row['n_trimestres'])} trimestres con datos; "
    "gap documental en 2020T2)"
)
```

Puntos de paridad:

- `tablas_disponibles` se itera en el orden de inserción de `_TABLA_DESCRIPCIONES` (11 entradas, ver Catálogos), NO en el orden de `estadisticas_globales`. Tablas presentes en `estadisticas_globales` pero ausentes de `_TABLA_DESCRIPCIONES` no aparecen (aunque sí suman a `total_microdatos`/`total_agregados`). Tablas del dict ausentes de la DB salen con `n_filas=0`, `has_data=False`.
- `status` es `"schema-ready"` para las dos tablas del set aunque tengan filas; `"available"` para el resto aunque tengan 0 filas (`has_data` y `status` pueden discrepar).
- `total_microdatos`/`total_agregados` se calculan en Python desde `tablas_rows` (no desde `SQL_HEALTH`).
- Valores fijos de la respuesta:
  - `nombre="Encuesta Nacional de Ocupación y Empleo"`, `acronimo="ENOE"`, `fuente="INEGI"`, `fuente_url="https://www.inegi.org.mx/programas/enoe/15ymas/"`, `periodicidad="Trimestral"`, `cobertura_geografica="Nacional + 32 entidades federativas"`.
  - `n_trimestres_disponibles=int(meta_row["n_trimestres"])`, `n_indicadores=len(_INDICADORES_DEFS)` (=13), `n_entidades=int(meta_row["n_entidades"])`.
  - `etapas_metodologicas=[e.slug for e in ETAPAS_DEFS]` → `["clasica", "etoe_telefonica", "enoe_n"]`.
  - `caveats=CAVEATS_GLOBALES` (los 5 caveats, en orden), `sources=[SOURCE_ENOE, SOURCE_RECONS_VARIABLES]`, `last_updated=meta_row["ultima_carga"]`.
- Si `indicadores_nacionales` está vacía, `primer`/`ultimo` son `None` y `cobertura` se formatea como `"None-None (0 trimestres con datos; gap documental en 2020T2)"` (no hay guarda).

### 2.5 Modelo de respuesta

```python
class TablaDisponible(BaseModel):
    nombre: str
    descripcion: str
    n_filas: int
    has_data: bool
    status: Literal["available", "schema-ready", "deprecated"] = "available"

class CaveatMetodologico(BaseModel):
    slug: str
    titulo: str
    descripcion: str
    periodo_aplicable: str
    referencia: str

class EnoeMetadata(BaseModel):
    nombre: str
    acronimo: str
    fuente: str
    fuente_url: str
    periodicidad: str
    cobertura_temporal: str
    cobertura_geografica: str
    n_trimestres_disponibles: int
    n_indicadores: int
    n_entidades: int
    etapas_metodologicas: list[str]
    tablas_disponibles: list[TablaDisponible]
    total_microdatos: int
    total_agregados: int
    caveats: list[CaveatMetodologico]
    sources: list[str]
    last_updated: Optional[datetime]
```

Docstring de `TablaDisponible` (verbatim):

```
Tabla del schema enoe con conteo de filas y estado de disponibilidad.

El campo `status` señaliza la disponibilidad efectiva de la tabla:

- `"available"` — tabla con datos ingestados, consumible vía endpoints.
- `"schema-ready"` — tabla creada pero aún sin datos (roadmap futuro
  del observatorio). Aparece en metadata por trazabilidad pero los
  endpoints que la usarían responderán vacío hasta que se ingesten.
- `"deprecated"` — tabla que existió y fue retirada; reservado para
  uso futuro.

`has_data` se mantiene por compatibilidad con consumidores existentes;
es derivable de `status` (`status == "available"` ⇔ `has_data is True`).
```

### 2.6 Errores

- `429` — rate limit. No hay try/except: un fallo de DB produce 500 genérico.

---

## 3. `GET /api/v1/enoe/catalogos/indicadores`

### 3.1 Declaración

- Función: `get_catalogo_indicadores(request: Request) -> CatalogoIndicadoresResponse`
- `response_model=CatalogoIndicadoresResponse`
- `summary="Catálogo de los 13 indicadores disponibles"`
- `description` (verbatim):

```
Lista los 13 indicadores del observatorio (8 conteos poblacionales + 5 tasas) con su fórmula INEGI (Reconstrucción de variables 2023), cobertura temporal observada y caveat metodológico aplicable. Reutilizable como fuente para dropdowns en el frontend.
```

- Rate limit: `@limiter.limit("60/minute")`
- `responses` declarados:
  - `200`: `"Catálogo de 13 indicadores con cobertura."` — ejemplo:
    ```python
    {"count": 13,
     "indicadores": [{"slug": "tasa_desocupacion", "nombre": "Tasa de desocupación", "descripcion": "% PEA desocupada",
                      "unidad": "porcentaje", "categoria": "tasas", "formula": "(PD / PEA) * 100",
                      "n_observaciones_nacional": 80, "n_observaciones_entidad": 2560,
                      "cobertura_temporal": "2005T1-2025T1"}],
     "source": "INEGI ENOE 15+"}
    ```
    (El ejemplo no coincide con los valores reales: `categoria` real es `"tasa"`, `nombre` real es `"Tasa de Desocupación"`, `source` real es `SOURCE_ENOE`.)
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`

### 3.2 Parámetros

Ninguno.

### 3.3 SQL

`SQL_INDICADOR_COBERTURA` (sin parámetros; `.mappings().all()`):

```sql
SELECT
    indicador,
    COUNT(*)        AS n_observaciones_nacional,
    MIN(periodo)    AS periodo_min,
    MAX(periodo)    AS periodo_max
FROM enoe.indicadores_nacionales
GROUP BY indicador
```

`SQL_INDICADOR_COBERTURA_ENT` (sin parámetros; `.mappings().all()`):

```sql
SELECT indicador, COUNT(*) AS n_obs_ent
FROM enoe.indicadores_entidad
GROUP BY indicador
```

Tablas: `enoe.indicadores_nacionales`, `enoe.indicadores_entidad`. Agregadas.

### 3.4 Post-procesamiento

```python
cobertura_nac = {r["indicador"]: r for r in rows_nac}
cobertura_ent = {r["indicador"]: int(r["n_obs_ent"]) for r in rows_ent}

for defn in _INDICADORES_DEFS:          # orden del catálogo declarativo (13)
    slug = defn["slug"]
    nac = cobertura_nac.get(slug)
    if nac is None:
        n_obs_nac = 0
        cobertura = "sin observaciones"
    else:
        n_obs_nac = int(nac["n_observaciones_nacional"])
        cobertura = f"{nac['periodo_min']}-{nac['periodo_max']}"

    caveat_slug = defn["caveat_slug"]
    caveat_msg = None
    if caveat_slug and caveat_slug in _CAVEATS_BY_SLUG:
        c = _CAVEATS_BY_SLUG[caveat_slug]
        caveat_msg = f"{c.titulo} ({c.slug}): {c.descripcion}"
```

- Se emiten exactamente los 13 de `_INDICADORES_DEFS`, en su orden; indicadores presentes en DB pero no en el catálogo se ignoran.
- `fuente_metodologica=SOURCE_RECONS_VARIABLES` para todos.
- `n_observaciones_entidad=cobertura_ent.get(slug, 0)`.
- `count=len(indicadores)` (=13), `source=SOURCE_ENOE`.
- `caveat_metodologico` formateado `"{titulo} ({slug}): {descripcion}"`; sólo para slugs con `caveat_slug` no nulo: `pob_15ymas`, `tasa_participacion` → `dominio_15_plus`; `condcrit_total`, `tasa_ocupacion_critica_tcco` → `tcco_redefinicion_2020`; `informales_total`, `tasa_informalidad_til1` → `til1_definicion_operativa`.

### 3.5 Modelo de respuesta

```python
class IndicadorCatalogo(BaseModel):
    slug: str
    nombre: str
    descripcion: str
    unidad: str            # "personas" | "porcentaje"
    categoria: str         # "conteo" | "tasa"
    formula: str
    fuente_metodologica: str
    n_observaciones_nacional: int
    n_observaciones_entidad: int
    cobertura_temporal: str
    caveat_metodologico: Optional[str] = None

class CatalogoIndicadoresResponse(BaseModel):
    count: int
    indicadores: list[IndicadorCatalogo]
    source: str
```

### 3.6 Errores

- `429` — rate limit.

---

## 4. `GET /api/v1/enoe/catalogos/entidades`

### 4.1 Declaración

- Función: `get_catalogo_entidades(request: Request) -> CatalogoEntidadesResponse`
- `response_model=CatalogoEntidadesResponse`
- `summary="Catálogo de las 32 entidades federativas"`
- `description` (verbatim):

```
Lista las 32 entidades federativas de México con clave AGEE INEGI 2020 (CHAR(2) '01'..'32'), nombre oficial y abreviatura usada en boletines INEGI. Replica el catálogo de enigh.cat_entidad.
```

- Rate limit: `@limiter.limit("60/minute")`
- `responses` declarados:
  - `200`: `"32 entidades federativas."` — ejemplo: `{"count": 32, "entidades": [{"clave": "09", "nombre": "Ciudad de México", "abreviatura": "CDMX"}], "source": "INEGI ENOE 15+"}`
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`

### 4.2 Parámetros

Ninguno.

### 4.3 SQL

`SQL_ENTIDADES` (sin parámetros; `.mappings().all()`):

```sql
SELECT clave, nombre, abreviatura
FROM enoe.cat_entidad
ORDER BY clave
```

Tablas: `enoe.cat_entidad`.

### 4.4 Post-procesamiento

```python
entidades = [EntidadCatalogo(**dict(r)) for r in rows]
```

`count=len(entidades)`, `source=SOURCE_ENOE`. Sin transformación de valores (si `clave` es `CHAR(2)` llega tal cual).

### 4.5 Modelo de respuesta

```python
class EntidadCatalogo(BaseModel):
    clave: str                       # CHAR(2), '01'..'32'
    nombre: str
    abreviatura: Optional[str] = None

class CatalogoEntidadesResponse(BaseModel):
    count: int
    entidades: list[EntidadCatalogo]
    source: str
```

### 4.6 Errores

- `429` — rate limit.

---

## 5. `GET /api/v1/enoe/catalogos/etapas-metodologicas`

### 5.1 Declaración

- Función: `get_catalogo_etapas(request: Request) -> CatalogoEtapasResponse`
- `response_model=CatalogoEtapasResponse`
- `summary="Catálogo de las 3 etapas metodológicas del ENOE"`
- `description` (verbatim):

```
Las 3 etapas metodológicas que conviven en la serie histórica: clasica (2005T1-2020T1, marco pre-Censo 2020), etoe_telefonica (solo 2020T2, sin microdatos), y enoe_n (2020T3-presente, marco post-Censo 2020). Coherente con el ENUM enoe.etapa_metodologica (migration 031).
```

- Rate limit: `@limiter.limit("60/minute")`
- `responses` declarados:
  - `200`: `"3 etapas metodológicas con su rango."` — ejemplo:
    ```python
    {"count": 3,
     "etapas": [{"slug": "clasica", "periodo_inicial": "2005T1", "periodo_final": "2020T1"},
                {"slug": "etoe_telefonica", "periodo_inicial": "2020T2", "periodo_final": "2020T2"},
                {"slug": "enoe_n", "periodo_inicial": "2020T3", "periodo_final": "2025T1"}],
     "source": "INEGI ENOE 15+"}
    ```
    (El ejemplo usa `periodo_inicial`/`periodo_final`; el modelo real usa `periodo_inicio`/`periodo_fin`, y `enoe_n.periodo_fin` real es `None`.)
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`

### 5.2 Parámetros

Ninguno.

### 5.3 SQL

Ninguno. No toca la base de datos.

### 5.4 Post-procesamiento

```python
return CatalogoEtapasResponse(count=len(ETAPAS_DEFS), etapas=ETAPAS_DEFS, source=SOURCE_ENOE)
```

`ETAPAS_DEFS` es la lista declarativa de 3 `EtapaMetodologica` (ver Catálogos), en orden `clasica`, `etoe_telefonica`, `enoe_n`.

### 5.5 Modelo de respuesta

```python
class EtapaMetodologica(BaseModel):
    slug: str                         # "clasica" | "etoe_telefonica" | "enoe_n"
    nombre: str
    descripcion: str
    periodo_inicio: str               # 'YYYYTQ'
    periodo_fin: Optional[str] = None # None = etapa abierta (enoe_n)
    dominio_edad: str                 # "14+" | "15+"
    n_trimestres: int
    tiene_microdatos: bool
    caveat_aplicable: Optional[str] = None

class CatalogoEtapasResponse(BaseModel):
    count: int
    etapas: list[EtapaMetodologica]
    source: str
```

### 5.6 Errores

- `429` — rate limit.

---

## Helpers compartidos (Sub-fase 3.4) — validación e inyección de caveats

Se documentan aquí porque los endpoints 6-14 los invocan; el orden de invocación en cada endpoint determina qué error se emite primero.

```python
_INDICADOR_SLUGS_VALIDOS: set[str] = {d["slug"] for d in _INDICADORES_DEFS}
_INDICADOR_DEFN_BY_SLUG: dict[str, dict] = {d["slug"]: d for d in _INDICADORES_DEFS}
_INDICADORES_CONTEO: set[str] = {s for s, d in _INDICADOR_DEFN_BY_SLUG.items() if d["categoria"] == "conteo"}
# = {pob_15ymas, pea_total, pnea_total, ocupados_total, desocupados_total, subocupados_total, condcrit_total, informales_total}
_INDICADORES_SENSIBLES_DOMINIO: set[str] = {"pob_15ymas", "pea_total", "pnea_total", "tasa_participacion"}
_PERIODO_RE = re.compile(r"^(20\d{2})T([1-4])$")
```

### `_validate_periodo(periodo, arg_name)`

- `None` → `None`.
- Si no cumple `_PERIODO_RE` → `HTTPException(422, detail=f"'{arg_name}' debe ser 'YYYYTQ' (ej. '2025T1'); recibido: {periodo!r}")`.
- Nota: el regex acepta `2000T1`..`2099T4` (el comentario dice «YYYY 2005-2099» pero el patrón es `20\d{2}`). No se recorta whitespace.

### `_validate_etapa(etapa)`

- `None` → `None`.
- Si `etapa not in {"clasica", "etoe_telefonica", "enoe_n"}` → `HTTPException(422, detail=f"'etapa' debe ser una de: clasica, etoe_telefonica, enoe_n; recibido: {etapa!r}")`.

### `_validate_indicador(slug) -> dict`

- Si `slug` no está en `_INDICADOR_DEFN_BY_SLUG` → `HTTPException(404, detail=f"indicador {slug!r} no existe. Slugs válidos: {valid}. Consultar GET /api/v1/enoe/catalogos/indicadores.")` donde `valid = ", ".join(sorted(_INDICADOR_SLUGS_VALIDOS))` =
  `condcrit_total, desocupados_total, informales_total, ocupados_total, pea_total, pnea_total, pob_15ymas, subocupados_total, tasa_desocupacion, tasa_informalidad_til1, tasa_ocupacion_critica_tcco, tasa_participacion, tasa_subocupacion`.

### `_rango_intersecta(desde, hasta, p_min, p_max) -> bool`

```python
desde_eff = "0000T1" if desde is None else desde
hasta_eff = "9999T4" if hasta is None else hasta
p_min_eff = p_min if p_min is not None else "0000T1"
p_max_eff = p_max if p_max is not None else "9999T4"
return not (hasta_eff < p_min_eff or desde_eff > p_max_eff)
```

Comparación lexicográfica de strings `'YYYYTQ'`.

### `_caveats_para_indicador(indicador_slug, desde=None, hasta=None) -> list[CaveatMetodologico]`

Orden de inserción (determina el orden en `caveats` de la respuesta):

1. si `indicador_slug in {"informales_total", "tasa_informalidad_til1"}` → `CAVEAT_TIL1_INFORMALIDAD`
2. si `indicador_slug in {"condcrit_total", "tasa_ocupacion_critica_tcco"}` → `CAVEAT_TCCO_REDEFINICION`
3. si `indicador_slug in _INDICADORES_SENSIBLES_DOMINIO` y `_rango_intersecta(desde, hasta, "2005T1", "2020T1")` → `CAVEAT_DOMINIO_15PLUS`
4. si `indicador_slug in _INDICADORES_CONTEO` y `_rango_intersecta(desde, hasta, "2020T3", "2021T4")` → `CAVEAT_ETAPA_CAMBIO_MARCO`
5. si `_rango_intersecta(desde, hasta, "2020T2", "2020T2")` → `CAVEAT_GAP_2020T2`

Con `desde=hasta=None` (serie sin filtro) las tres condiciones de rango son verdaderas. Se ignora el filtro `etapa` para caveats.

### `_validar_desde_hasta(desde, hasta)`

- Si ambos no nulos y `desde > hasta` (lexicográfico) → `HTTPException(422, detail=f"'desde' ({desde}) debe ser <= 'hasta' ({hasta})")`.

---

## 6. `GET /api/v1/enoe/indicadores/nacional/serie`

### 6.1 Declaración

- Función: `get_indicador_nacional_serie(...) -> SerieNacionalResponse`
- `response_model=SerieNacionalResponse`
- `summary="Serie temporal nacional de un indicador"`
- `description` (verbatim):

```
Retorna la serie temporal nacional de un indicador, opcionalmente filtrada por rango de periodos (`desde`/`hasta` en formato YYYYTQ) o etapa metodológica. Caveats inyectados dinámicamente según el indicador y el rango (gap 2020T2, dominio 15+, cambio de marco 2020T3, redefinición TIL1/TCCO).
```

- Rate limit: `@limiter.limit("30/minute")`
- `responses` declarados:
  - `200`: `"Serie temporal nacional con caveats inyectados."` — ejemplo:
    ```python
    {"indicador": "tasa_desocupacion", "nombre": "Tasa de desocupación", "unidad": "porcentaje", "categoria": "tasas",
     "cobertura": {"desde": "2005T1", "hasta": "2025T1", "n_observaciones": 80},
     "datos": [{"periodo": "2025T1", "valor": 2.65, "etapa": "enoe_n"}],
     "caveats": [], "source": "INEGI ENOE 15+", "source_url": "https://www.inegi.org.mx/programas/enoe/15ymas/"}
    ```
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`
  - (No declara 404/422 aunque los emite.)

### 6.2 Parámetros (query)

| nombre | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|
| `indicador` | `str` | — | `_validate_indicador` (404) | sí | `Slug del indicador (ej. tasa_desocupacion)` |
| `desde` | `Optional[str]` | `None` | `_validate_periodo` (422) | no | `Periodo inicial YYYYTQ (default: primer punto)` |
| `hasta` | `Optional[str]` | `None` | `_validate_periodo` (422) | no | `Periodo final YYYYTQ (default: último punto)` |
| `etapa` | `Optional[str]` | `None` | `_validate_etapa` (422) | no | `Filtro: clasica \| etoe_telefonica \| enoe_n` |

Orden de validación: `indicador` → `desde` → `hasta` → `etapa` → `_validar_desde_hasta`.

### 6.3 SQL

`SQL_SERIE_NACIONAL`:

```sql
SELECT periodo, valor::float AS valor, etapa::text AS etapa
FROM enoe.indicadores_nacionales
WHERE indicador = :slug
  AND (CAST(:desde AS text) IS NULL OR periodo >= :desde)
  AND (CAST(:hasta AS text) IS NULL OR periodo <= :hasta)
  AND (CAST(:etapa AS text) IS NULL OR etapa::text = :etapa)
ORDER BY periodo
```

Binding: `{"slug": indicador, "desde": desde, "hasta": hasta, "etapa": etapa}` (`None` → NULL). `.mappings().all()`.

Tablas: `enoe.indicadores_nacionales`. Agregada.

### 6.4 Post-procesamiento

```python
datos = [PuntoIndicadorNacional(periodo=r["periodo"], valor=round(float(r["valor"]), 6), etapa=r["etapa"]) for r in rows]
cobertura = CoberturaSerie(
    desde=datos[0].periodo if datos else None,
    hasta=datos[-1].periodo if datos else None,
    n_observaciones=len(datos),
)
```

Respuesta: `indicador=indicador` (el slug recibido), `nombre=defn["nombre"]`, `unidad=defn["unidad"]`, `categoria=defn["categoria"]`, `caveats=_caveats_para_indicador(indicador, desde, hasta)`, `source=SOURCE_ENOE`, `source_url="https://www.inegi.org.mx/programas/enoe/15ymas/"`. Serie vacía → 200 con `datos=[]` y cobertura `None/None/0` (no 404).

### 6.5 Modelo de respuesta

```python
class CoberturaSerie(BaseModel):
    desde: Optional[str]      # 'YYYYTQ' o None si vacía
    hasta: Optional[str]
    n_observaciones: int

class PuntoIndicadorNacional(BaseModel):
    periodo: str              # 'YYYYTQ'
    valor: float
    etapa: str                # "clasica" | "etoe_telefonica" | "enoe_n"

class SerieNacionalResponse(BaseModel):
    indicador: str            # slug
    nombre: str
    unidad: str
    categoria: str            # "conteo" | "tasa"
    cobertura: CoberturaSerie
    datos: list[PuntoIndicadorNacional]
    caveats: list[CaveatMetodologico]
    source: str
    source_url: str
```

### 6.6 Errores

- `404` — indicador inexistente (mensaje de `_validate_indicador`).
- `422` — `desde`/`hasta` mal formados; `etapa` inválida; `desde > hasta` (mensajes de los helpers).
- `429` — rate limit.

---

## 7. `GET /api/v1/enoe/indicadores/nacional/snapshot`

### 7.1 Declaración

- Función: `get_indicador_nacional_snapshot(...) -> SnapshotNacionalResponse`
- `response_model=SnapshotNacionalResponse`
- `summary="Todos los indicadores nacionales en un periodo"`
- `description` (verbatim):

```
Retorna los 13 indicadores nacionales calculados para el periodo indicado (YYYYTQ). HTTP 404 si el periodo no tiene datos (típicamente 2020T2 — sin microdatos por ETOE — o periodos futuros).
```

- Rate limit: `@limiter.limit("30/minute")`
- `responses` declarados:
  - `200`: `"Snapshot de los 13 indicadores en un periodo."` — ejemplo: `{"periodo": "2025T1", "etapa": "enoe_n", "n_indicadores": 13, "indicadores": [{"indicador": "tasa_desocupacion", "nombre": "Tasa de desocupación", "unidad": "porcentaje", "valor": 2.65}], "caveats": [], "source": "INEGI ENOE 15+"}`
  - `404`: `{"model": HTTPError404, "description": "Sin datos para ese periodo (2020T2 gap o periodo futuro)."}`
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`

### 7.2 Parámetros (query)

| nombre | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|
| `periodo` | `str` | — | `_validate_periodo(periodo, "periodo")` (422) | sí | `Periodo YYYYTQ (ej. 2025T1)` |

### 7.3 SQL

`SQL_SNAPSHOT_NACIONAL`:

```sql
SELECT indicador, valor::float AS valor, unidad, etapa::text AS etapa
FROM enoe.indicadores_nacionales
WHERE periodo = :periodo
ORDER BY indicador
```

Binding: `{"periodo": periodo}`. `.mappings().all()`.

Tablas: `enoe.indicadores_nacionales`. Agregada.

### 7.4 Post-procesamiento

```python
if not rows: raise 404
etapa_obs = rows[0]["etapa"]          # mismo periodo => misma etapa
for r in rows:
    defn = _INDICADOR_DEFN_BY_SLUG.get(r["indicador"])
    nombre = defn["nombre"] if defn else r["indicador"]
    IndicadorSnapshot(indicador=r["indicador"], nombre=nombre, unidad=r["unidad"], valor=round(float(r["valor"]), 6))

caveats_set: dict[str, CaveatMetodologico] = {}
for r in rows:
    for c in _caveats_para_indicador(r["indicador"], periodo, periodo):
        caveats_set[c.slug] = c
caveats = list(caveats_set.values())    # deduplicado por slug, orden de primera aparición
```

- Orden de `indicadores`: alfabético por `indicador` (ORDER BY de SQL). Incluye cualquier indicador presente en DB, aun si no está en el catálogo (con `nombre=slug`).
- `unidad` sale de la columna DB, no del catálogo.
- `n_indicadores=len(indicadores)`, `source=SOURCE_ENOE`.

### 7.5 Modelo de respuesta

```python
class IndicadorSnapshot(BaseModel):
    indicador: str
    nombre: str
    unidad: str
    valor: float

class SnapshotNacionalResponse(BaseModel):
    periodo: str
    etapa: str
    n_indicadores: int
    indicadores: list[IndicadorSnapshot]
    caveats: list[CaveatMetodologico]
    source: str
```

### 7.6 Errores

- `422` — `periodo` mal formado: `'periodo' debe ser 'YYYYTQ' (ej. '2025T1'); recibido: {periodo!r}`.
- `404` — sin filas: `detail=f"No hay datos para periodo={periodo!r} (cobertura: 2005T1-2025T1, gap 2020T2). Consultar GET /api/v1/enoe/health para últimos valores."`
- `429` — rate limit.

---

## 8. `GET /api/v1/enoe/indicadores/entidad/serie`

### 8.1 Declaración

- Función: `get_indicador_entidad_serie(...) -> SerieEntidadResponse`
- `response_model=SerieEntidadResponse`
- `summary="Serie temporal de un indicador para una entidad federativa"`
- `description` (verbatim):

```
Retorna la serie temporal de un indicador para la entidad indicada (`entidad_clave` de 2 dígitos, ej. '09' para CDMX). Filtros opcionales `desde`/`hasta` (YYYYTQ) y `etapa`. HTTP 404 si la entidad no existe.
```

- Rate limit: `@limiter.limit("30/minute")`
- `responses` declarados:
  - `200`: `"Serie temporal por entidad federativa."` — ejemplo: `{"indicador": "tasa_desocupacion", "entidad": {"clave": "09", "nombre": "Ciudad de México", "abreviatura": "CDMX"}, "cobertura": {"desde": "2005T1", "hasta": "2025T1", "n_observaciones": 80}, "datos": [{"periodo": "2025T1", "valor": 3.51, "etapa": "enoe_n"}], "caveats": [], "source": "INEGI ENOE 15+"}` (el ejemplo anida `entidad`; el modelo real usa `entidad_clave`/`entidad_nombre`/`entidad_abreviatura` planos).
  - `404`: `{"model": HTTPError404, "description": "`entidad_clave` no existe en el catálogo."}`
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`

### 8.2 Parámetros (query)

| nombre | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|
| `indicador` | `str` | — | `_validate_indicador` (404) | sí | `Slug del indicador` |
| `entidad_clave` | `str` | — | existencia en `enoe.cat_entidad` (404); sin validación de formato | sí | `Clave INEGI 2 dígitos (ej. '09' = CDMX)` |
| `desde` | `Optional[str]` | `None` | `_validate_periodo` (422) | no | `Periodo inicial YYYYTQ` |
| `hasta` | `Optional[str]` | `None` | `_validate_periodo` (422) | no | `Periodo final YYYYTQ` |
| `etapa` | `Optional[str]` | `None` | `_validate_etapa` (422) | no | `Filtro: clasica \| etoe_telefonica \| enoe_n` |

Orden de validación: `indicador` → `desde` → `hasta` → `etapa` → `_validar_desde_hasta` → (SQL) entidad.

### 8.3 SQL

`SQL_ENTIDAD_META` (compartido con 11-14):

```sql
SELECT clave, nombre, abreviatura
FROM enoe.cat_entidad
WHERE clave = :clave
```

Binding: `{"clave": entidad_clave}`. `.mappings().one_or_none()`; `None` → 404.

`SQL_SERIE_ENTIDAD`:

```sql
SELECT periodo, valor::float AS valor, etapa::text AS etapa
FROM enoe.indicadores_entidad
WHERE indicador = :slug
  AND entidad_clave = :clave
  AND (CAST(:desde AS text) IS NULL OR periodo >= :desde)
  AND (CAST(:hasta AS text) IS NULL OR periodo <= :hasta)
  AND (CAST(:etapa AS text) IS NULL OR etapa::text = :etapa)
ORDER BY periodo
```

Binding: `{"slug": indicador, "clave": entidad_clave, "desde": desde, "hasta": hasta, "etapa": etapa}`. `.mappings().all()`. Ambas en la misma conexión.

Tablas: `enoe.cat_entidad`, `enoe.indicadores_entidad`. Agregadas.

### 8.4 Post-procesamiento

Igual que 6.4 con `PuntoIndicadorEntidad`. Además: `entidad_clave=ent_row["clave"]`, `entidad_nombre=ent_row["nombre"]`, `entidad_abreviatura=ent_row["abreviatura"]` (desde el catálogo, no desde el parámetro). `caveats=_caveats_para_indicador(indicador, desde, hasta)`, `source=SOURCE_ENOE`. No hay `source_url` en este modelo. Serie vacía → 200.

### 8.5 Modelo de respuesta

```python
class PuntoIndicadorEntidad(BaseModel):
    periodo: str
    valor: float
    etapa: str

class SerieEntidadResponse(BaseModel):
    indicador: str
    nombre: str
    unidad: str
    categoria: str
    entidad_clave: str
    entidad_nombre: str
    entidad_abreviatura: Optional[str] = None
    cobertura: CoberturaSerie
    datos: list[PuntoIndicadorEntidad]
    caveats: list[CaveatMetodologico]
    source: str
```

### 8.6 Errores

- `404` — indicador inexistente (helper).
- `404` — entidad inexistente: `detail=f"entidad_clave {entidad_clave!r} no existe. Las claves válidas son '01'..'32' (AGEE INEGI). Consultar GET /api/v1/enoe/catalogos/entidades."`
- `422` — periodos/etapa/rango (helpers).
- `429` — rate limit.

---

## 9. `GET /api/v1/enoe/indicadores/entidad/snapshot`

### 9.1 Declaración

- Función: `get_indicador_entidad_snapshot(...) -> SnapshotEntidadResponse`
- `response_model=SnapshotEntidadResponse`
- `summary="Un indicador en un periodo para las 32 entidades federativas"`
- `description` (verbatim):

```
Retorna el valor del indicador para cada una de las 32 entidades en el periodo dado, ordenado por clave AGEE. HTTP 404 si periodo o indicador no tienen datos.
```

- Rate limit: `@limiter.limit("30/minute")`
- `responses` declarados:
  - `200`: `"Snapshot por entidad de un indicador."` — ejemplo: `{"periodo": "2025T1", "etapa": "enoe_n", "indicador": "tasa_desocupacion", "nombre": "Tasa de desocupación", "unidad": "porcentaje", "categoria": "tasas", "n_entidades": 32, "datos": [{"entidad_clave": "09", "entidad_nombre": "Ciudad de México", "entidad_abreviatura": "CDMX", "valor": 3.51}], "caveats": [], "source": "INEGI ENOE 15+"}`
  - `404`: `{"model": HTTPError404, "description": "Sin datos para ese periodo/indicador."}`
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`

### 9.2 Parámetros (query)

| nombre | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|
| `periodo` | `str` | — | `_validate_periodo` (422) | sí | `Periodo YYYYTQ` |
| `indicador` | `str` | — | `_validate_indicador` (404) | sí | `Slug del indicador` |

Orden de validación: `periodo` → `indicador`.

### 9.3 SQL

`SQL_SNAPSHOT_ENTIDAD`:

```sql
SELECT
    ie.entidad_clave,
    ce.nombre       AS entidad_nombre,
    ce.abreviatura  AS entidad_abreviatura,
    ie.valor::float AS valor,
    ie.etapa::text  AS etapa
FROM enoe.indicadores_entidad ie
JOIN enoe.cat_entidad ce ON ce.clave = ie.entidad_clave
WHERE ie.periodo = :periodo
  AND ie.indicador = :slug
ORDER BY ie.entidad_clave
```

Binding: `{"periodo": periodo, "slug": indicador}`. `.mappings().all()`.

Tablas: `enoe.indicadores_entidad`, `enoe.cat_entidad`. Agregadas.

### 9.4 Post-procesamiento

```python
if not rows: raise 404
etapa_obs = rows[0]["etapa"]
datos = [PuntoSnapshotEntidad(entidad_clave=..., entidad_nombre=..., entidad_abreviatura=..., valor=round(float(r["valor"]), 6)) for r in rows]
```

Respuesta: `periodo`, `etapa=etapa_obs`, `indicador`, `nombre/unidad/categoria` del catálogo, `n_entidades=len(datos)`, `caveats=_caveats_para_indicador(indicador, periodo, periodo)`, `source=SOURCE_ENOE`.

### 9.5 Modelo de respuesta

```python
class PuntoSnapshotEntidad(BaseModel):
    entidad_clave: str
    entidad_nombre: str
    entidad_abreviatura: Optional[str] = None
    valor: float

class SnapshotEntidadResponse(BaseModel):
    periodo: str
    etapa: str
    indicador: str
    nombre: str
    unidad: str
    categoria: str
    n_entidades: int
    datos: list[PuntoSnapshotEntidad]
    caveats: list[CaveatMetodologico]
    source: str
```

### 9.6 Errores

- `422` — `periodo` mal formado.
- `404` — indicador inexistente (helper).
- `404` — sin filas: `detail=f"No hay datos para periodo={periodo!r} indicador={indicador!r} (cobertura: 2005T1-2025T1, gap 2020T2)."`
- `429` — rate limit.

---

## 10. `GET /api/v1/enoe/indicadores/entidad/ranking`

### 10.1 Declaración

- Función: `get_indicador_entidad_ranking(...) -> RankingEntidadResponse`
- `response_model=RankingEntidadResponse`
- `summary="Ranking de entidades por indicador en un periodo"`
- `description` (verbatim):

```
Top N entidades ordenadas por el valor del indicador. `orden=desc` (default) lista de mayor a menor valor (típico para tasa_desocupacion 'peor'); `orden=asc` lista de menor a mayor. `limit` ∈ [1, 32].
```

- Rate limit: `@limiter.limit("30/minute")`
- `responses` declarados:
  - `200`: `"Ranking de entidades por valor del indicador."` — ejemplo: `{"periodo": "2025T1", "etapa": "enoe_n", "indicador": "tasa_desocupacion", "orden": "desc", "limit": 5, "datos": [{"posicion": 1, "entidad_clave": "23", "entidad_nombre": "Quintana Roo", "entidad_abreviatura": "QROO", "valor": 4.21}], "source": "INEGI ENOE 15+"}` (el ejemplo usa `datos`/`posicion`; el modelo real usa `ranking`/`rank`.)
  - `404`: `{"model": HTTPError404, "description": "Sin datos para ese periodo/indicador."}`
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`

### 10.2 Parámetros (query)

| nombre | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|
| `periodo` | `str` | — | `_validate_periodo` (422) | sí | `Periodo YYYYTQ` |
| `indicador` | `str` | — | `_validate_indicador` (404) | sí | `Slug del indicador` |
| `orden` | `str` | `"desc"` | `in {"asc", "desc"}` (422 explícito) | no | `'desc' (mayor primero) o 'asc' (menor primero)` |
| `limit` | `int` | `5` | `ge=1, le=32` (422 FastAPI) | no | `Tamaño del ranking, entre 1 y 32` |

Orden de validación: `periodo` → `indicador` → `orden`.

### 10.3 SQL

Comentario (verbatim): `# Construido en runtime con ORDER BY direction dinámico — pero whitelisteado.`

`SQL_RANKING_DESC`:

```sql
SELECT
    ie.entidad_clave,
    ce.nombre        AS entidad_nombre,
    ce.abreviatura   AS entidad_abreviatura,
    ie.valor::float  AS valor,
    ie.etapa::text   AS etapa
FROM enoe.indicadores_entidad ie
JOIN enoe.cat_entidad ce ON ce.clave = ie.entidad_clave
WHERE ie.periodo = :periodo AND ie.indicador = :slug
ORDER BY ie.valor DESC, ie.entidad_clave
LIMIT :limit
```

`SQL_RANKING_ASC`:

```sql
SELECT
    ie.entidad_clave,
    ce.nombre        AS entidad_nombre,
    ce.abreviatura   AS entidad_abreviatura,
    ie.valor::float  AS valor,
    ie.etapa::text   AS etapa
FROM enoe.indicadores_entidad ie
JOIN enoe.cat_entidad ce ON ce.clave = ie.entidad_clave
WHERE ie.periodo = :periodo AND ie.indicador = :slug
ORDER BY ie.valor ASC, ie.entidad_clave
LIMIT :limit
```

Selección: `sql = SQL_RANKING_DESC if orden == "desc" else SQL_RANKING_ASC`. Binding: `{"periodo": periodo, "slug": indicador, "limit": limit}`. `.mappings().all()`. Desempate por `entidad_clave` ascendente en ambos.

Tablas: `enoe.indicadores_entidad`, `enoe.cat_entidad`. Agregadas.

### 10.4 Post-procesamiento

```python
if not rows: raise 404
etapa_obs = rows[0]["etapa"]
ranking = [PuntoRanking(rank=i + 1, entidad_clave=..., entidad_nombre=..., entidad_abreviatura=..., valor=round(float(r["valor"]), 6))
           for i, r in enumerate(rows)]
```

Respuesta: `periodo`, `etapa=etapa_obs`, `indicador`, `nombre`, `unidad` (del catálogo; NO incluye `categoria`), `orden`, `limit` (el solicitado), `total_resultados=len(ranking)`, `ranking`, `caveats=_caveats_para_indicador(indicador, periodo, periodo)`, `source=SOURCE_ENOE`.

### 10.5 Modelo de respuesta

```python
class PuntoRanking(BaseModel):
    rank: int
    entidad_clave: str
    entidad_nombre: str
    entidad_abreviatura: Optional[str] = None
    valor: float

class RankingEntidadResponse(BaseModel):
    periodo: str
    etapa: str
    indicador: str
    nombre: str
    unidad: str
    orden: str            # "desc" | "asc"
    limit: int
    total_resultados: int
    ranking: list[PuntoRanking]
    caveats: list[CaveatMetodologico]
    source: str
```

### 10.6 Errores

- `422` — `periodo` mal formado; `limit` fuera de [1,32] (FastAPI); `orden` inválido: `detail=f"'orden' debe ser 'asc' o 'desc'; recibido: {orden!r}"`.
- `404` — indicador inexistente (helper).
- `404` — sin filas: `detail=f"No hay datos para periodo={periodo!r} indicador={indicador!r} (cobertura: 2005T1-2025T1, gap 2020T2)."`
- `429` — rate limit.

---

## Helpers compartidos (Sub-fase 3.5) — distribuciones

Comentario de bloque (verbatim):

```
# Tablas: enoe.poblacion_ocupada_por_sector (12 sectores '0'..'11', 31,677 filas),
# enoe.poblacion_ocupada_por_posicion (4 posiciones 1..4, 10,560 filas).
# pct_ocupados ya viene precalculado en DB y suma 100.0000 ± ε empíricamente.
# NO existe catálogo SCIAN físico — los nombres provienen del catálogo
# declarativo SECTORES_DEFS / POSICIONES_DEFS abajo (replicado del docstring
# de api/etl/enoe/calculadora.py:195-201, 244-249).
```

```python
_SECTOR_NOMBRE_BY_CLAVE: dict[str, str] = {s["clave"]: s["nombre"] for s in SECTORES_DEFS}
_POSICION_NOMBRE_BY_CLAVE: dict[int, str] = {p["clave"]: p["nombre"] for p in POSICIONES_DEFS}
_SECTOR_CLAVES_VALIDAS: set[str] = set(_SECTOR_NOMBRE_BY_CLAVE.keys())     # {'0'..'11'}
_POSICION_CLAVES_VALIDAS: set[int] = set(_POSICION_NOMBRE_BY_CLAVE.keys())  # {1,2,3,4}
```

### `_caveats_para_distribucion(desde=None, hasta=None)`

Orden de inserción:

1. `_rango_intersecta(desde, hasta, "2005T1", "2020T1")` → `CAVEAT_DOMINIO_15PLUS`
2. `_rango_intersecta(desde, hasta, "2020T3", "2021T4")` → `CAVEAT_ETAPA_CAMBIO_MARCO`
3. `_rango_intersecta(desde, hasta, "2020T2", "2020T2")` → `CAVEAT_GAP_2020T2`

(No distingue conteo/tasa; nunca inyecta TIL1/TCCO.)

### `_resolve_geo_clave(nivel, geo_clave) -> str`

- `nivel == "nacional"` → retorna `"00"` (ignora `geo_clave` aunque venga).
- `nivel == "entidad"` y `geo_clave is None` → `HTTPException(422, detail="'geo_clave' es obligatorio cuando nivel='entidad' (claves '01'..'32').")`
- `not re.fullmatch(r"[0-3][0-9]", geo_clave) or not ("01" <= geo_clave <= "32")` → `HTTPException(422, detail=f"'geo_clave' debe ser '01'..'32'; recibido: {geo_clave!r}")`
- si pasa → retorna `geo_clave`.

Validación de `nivel` (inline en cada endpoint 11-14): `if nivel not in {"nacional", "entidad"}` → `HTTPException(422, detail=f"'nivel' debe ser 'nacional' o 'entidad'; recibido: {nivel!r}")`.

Chequeo de existencia (inline en 11-14, sólo si `nivel == "entidad"`): ejecuta `SQL_ENTIDAD_META` con `{"clave": geo_clave_eff}`; si `None` → 404 (mensaje varía por endpoint, ver abajo); si existe, `geo_nombre = ent_row["nombre"]`.

---

## 11. `GET /api/v1/enoe/ocupados/por-sector/snapshot`

### 11.1 Declaración

- Función: `get_ocupados_por_sector_snapshot(...) -> SnapshotOcupacionSectorResponse`
- `response_model=SnapshotOcupacionSectorResponse`
- `summary="Distribución sectorial de ocupados en un periodo"`
- `description` (verbatim):

```
Composición sectorial de la población ocupada en el periodo dado, a nivel nacional o para una entidad federativa. Cada sector incluye clave SCIAN agregada, nombre, conteo expandido (fac_tri) y % de participación sobre el total ocupado del nivel. Caveats inyectados según el periodo (CPV 2020, dominio 15+, gap 2020T2).
```

- Rate limit: `@limiter.limit("30/minute")`
- `responses` declarados:
  - `200`: `"Composición sectorial nacional o por entidad."` — ejemplo: `{"periodo": "2025T1", "etapa": "enoe_n", "nivel": "nacional", "geo_clave": None, "geo_nombre": None, "total_ocupados_nivel": 60100000, "n_sectores": 12, "distribucion": [{"sector_clave": "6", "sector_nombre": "Comercio", "total_ocupados": 11500000, "participacion_porcentaje": 19.13}], "caveats": [], "source": "INEGI ENOE 15+", "source_url": "https://www.inegi.org.mx/programas/enoe/15ymas/"}` (en el catálogo real `"6"` es «Restaurantes y servicios de alojamiento»; Comercio es `"5"`.)
  - `404`: `{"model": HTTPError404, "description": "Sin datos o `geo_clave` inexistente."}`
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`

### 11.2 Parámetros (query)

| nombre | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|
| `periodo` | `str` | — | `_validate_periodo` (422) | sí | `Periodo YYYYTQ (ej. 2025T1)` |
| `nivel` | `str` | `"nacional"` | `in {"nacional","entidad"}` (422) | no | `'nacional' o 'entidad'` |
| `geo_clave` | `Optional[str]` | `None` | `_resolve_geo_clave` (422) + existencia (404) | sólo si `nivel='entidad'` | `Clave AGEE 2 dígitos (ej. '09'); obligatorio si nivel='entidad'` |

Orden de validación: `periodo` → `nivel` → `_resolve_geo_clave` → (SQL) existencia entidad.

### 11.3 SQL

Si `nivel == "entidad"`: `SQL_ENTIDAD_META` con `{"clave": geo_clave_eff}` (ver 8.3).

`SQL_SNAPSHOT_SECTOR`:

```sql
SELECT sector_clave, total_personas, pct_ocupados::float AS pct_ocupados,
       etapa::text AS etapa
FROM enoe.poblacion_ocupada_por_sector
WHERE periodo = :periodo AND nivel = :nivel AND geo_clave = :geo_clave
ORDER BY sector_clave
```

Binding: `{"periodo": periodo, "nivel": nivel, "geo_clave": geo_clave_eff}` (`geo_clave_eff="00"` para nacional). `.mappings().all()`.

Tablas: `enoe.cat_entidad` (condicional), `enoe.poblacion_ocupada_por_sector`. Agregadas.

### 11.4 Post-procesamiento

```python
if not rows: raise 404
etapa_obs = rows[0]["etapa"]
total_nivel = sum(int(r["total_personas"]) for r in rows)      # suma en Python, no en SQL
distribucion = [
    PuntoOcupacionSector(
        sector_clave=r["sector_clave"],
        sector_nombre=_SECTOR_NOMBRE_BY_CLAVE.get(r["sector_clave"], f"(sector {r['sector_clave']})"),
        total_ocupados=int(r["total_personas"]),
        participacion_porcentaje=round(float(r["pct_ocupados"]), 4),
    )   # periodo y etapa quedan None en snapshot
    for r in rows
]
```

- Orden de `distribucion`: `ORDER BY sector_clave` — si la columna es texto, el orden es lexicográfico (`'0','1','10','11','2',...`).
- Respuesta: `periodo`, `etapa=etapa_obs`, `nivel`, `geo_clave=geo_clave_eff if nivel == "entidad" else None`, `geo_nombre` (None para nacional), `total_ocupados_nivel=total_nivel`, `n_sectores=len(distribucion)`, `caveats=_caveats_para_distribucion(periodo, periodo)`, `source=SOURCE_ENOE`, `source_url="https://www.inegi.org.mx/programas/enoe/15ymas/"`.
- `sector_nombre` de fallback: `"(sector X)"` para claves fuera del catálogo.

### 11.5 Modelo de respuesta

```python
class PuntoOcupacionSector(BaseModel):
    periodo: Optional[str] = None       # presente solo en serie
    sector_clave: str
    sector_nombre: str
    total_ocupados: int = Field(description="Personas ocupadas (factor expandido fac_tri)")
    participacion_porcentaje: float = Field(description="% del total ocupados del nivel")
    etapa: Optional[str] = None         # presente solo en serie

class SnapshotOcupacionSectorResponse(BaseModel):
    periodo: str
    etapa: str
    nivel: Literal["nacional", "entidad"]
    geo_clave: Optional[str] = None
    geo_nombre: Optional[str] = None
    total_ocupados_nivel: int
    n_sectores: int
    distribucion: list[PuntoOcupacionSector]
    caveats: list[CaveatMetodologico]
    source: str
    source_url: str
```

(En el JSON del snapshot cada punto lleva `"periodo": null` y `"etapa": null`.)

### 11.6 Errores

- `422` — `periodo` mal formado; `nivel` inválido; `geo_clave` ausente/inválido con `nivel='entidad'` (mensajes de helpers).
- `404` — entidad inexistente: `detail=f"entidad_clave {geo_clave_eff!r} no existe. Las claves válidas son '01'..'32'. Consultar GET /api/v1/enoe/catalogos/entidades."`
- `404` — sin filas: `detail=f"No hay datos para periodo={periodo!r} nivel={nivel!r} geo_clave={geo_clave_eff!r} (cobertura: 2005T1-2025T1, gap 2020T2)."`
- `429` — rate limit.

---

## 12. `GET /api/v1/enoe/ocupados/por-sector/serie`

### 12.1 Declaración

- Función: `get_ocupados_por_sector_serie(...) -> SerieOcupacionSectorResponse`
- `response_model=SerieOcupacionSectorResponse`
- `summary="Serie temporal de ocupación en un sector económico"`
- `description` (verbatim):

```
Trayectoria temporal de ocupados en un sector específico (clave SCIAN agregada '0'..'11'), nacional o para una entidad. Cada punto incluye conteo expandido y % de participación pre-calculado en DB. Caveats inyectados según el rango (cambio de marco 2020T3, dominio 15+, gap 2020T2).
```

- Rate limit: `@limiter.limit("30/minute")`
- `responses` declarados:
  - `200`: `"Serie temporal de ocupados en un sector."` — ejemplo: `{"sector_clave": "6", "sector_nombre": "Comercio", "nivel": "nacional", "geo_clave": None, "geo_nombre": None, "cobertura": {"desde": "2005T1", "hasta": "2025T1", "n_observaciones": 80}, "datos": [{"periodo": "2025T1", "sector_clave": "6", "sector_nombre": "Comercio", "total_ocupados": 11500000, "participacion_porcentaje": 19.13, "etapa": "enoe_n"}], "caveats": [], "source": "INEGI ENOE 15+"}`
  - `404`: `{"model": HTTPError404, "description": "`sector_clave` o `geo_clave` no existe."}`
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`

### 12.2 Parámetros (query)

| nombre | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|
| `sector_clave` | `str` | — | `in _SECTOR_CLAVES_VALIDAS` (404) | sí | `Clave SCIAN agregada '0'..'11'` |
| `nivel` | `str` | `"nacional"` | `in {"nacional","entidad"}` (422) | no | `'nacional' o 'entidad'` |
| `geo_clave` | `Optional[str]` | `None` | `_resolve_geo_clave` (422) + existencia (404) | sólo si `nivel='entidad'` | `Obligatorio si nivel='entidad'` |
| `desde` | `Optional[str]` | `None` | `_validate_periodo` (422) | no | `Periodo inicial YYYYTQ` |
| `hasta` | `Optional[str]` | `None` | `_validate_periodo` (422) | no | `Periodo final YYYYTQ` |

Orden de validación: `sector_clave` → `nivel` → `_resolve_geo_clave` → `desde` → `hasta` → `_validar_desde_hasta` → (SQL) existencia entidad.

### 12.3 SQL

Si `nivel == "entidad"`: `SQL_ENTIDAD_META` con `{"clave": geo_clave_eff}`.

`SQL_SERIE_SECTOR`:

```sql
SELECT periodo, total_personas, pct_ocupados::float AS pct_ocupados,
       etapa::text AS etapa
FROM enoe.poblacion_ocupada_por_sector
WHERE sector_clave = :sector_clave
  AND nivel = :nivel
  AND geo_clave = :geo_clave
  AND (CAST(:desde AS text) IS NULL OR periodo >= :desde)
  AND (CAST(:hasta AS text) IS NULL OR periodo <= :hasta)
ORDER BY periodo
```

Binding: `{"sector_clave": sector_clave, "nivel": nivel, "geo_clave": geo_clave_eff, "desde": desde, "hasta": hasta}`. `.mappings().all()`.

Tablas: `enoe.cat_entidad` (condicional), `enoe.poblacion_ocupada_por_sector`. Agregadas.

### 12.4 Post-procesamiento

```python
sector_nombre = _SECTOR_NOMBRE_BY_CLAVE[sector_clave]
datos = [PuntoOcupacionSector(periodo=r["periodo"], sector_clave=sector_clave, sector_nombre=sector_nombre,
                              total_ocupados=int(r["total_personas"]),
                              participacion_porcentaje=round(float(r["pct_ocupados"]), 4),
                              etapa=r["etapa"]) for r in rows]
cobertura = CoberturaSerie(desde=datos[0].periodo if datos else None, hasta=datos[-1].periodo if datos else None, n_observaciones=len(datos))
```

Respuesta: `sector_clave`, `sector_nombre`, `nivel`, `geo_clave=geo_clave_eff if nivel == "entidad" else None`, `geo_nombre`, `cobertura`, `datos`, `caveats=_caveats_para_distribucion(desde, hasta)`, `source=SOURCE_ENOE`. Sin `source_url`. Serie vacía → 200.

### 12.5 Modelo de respuesta

```python
class SerieOcupacionSectorResponse(BaseModel):
    sector_clave: str
    sector_nombre: str
    nivel: Literal["nacional", "entidad"]
    geo_clave: Optional[str] = None
    geo_nombre: Optional[str] = None
    cobertura: CoberturaSerie
    datos: list[PuntoOcupacionSector]
    caveats: list[CaveatMetodologico]
    source: str
```

### 12.6 Errores

- `404` — sector inválido: `detail=f"sector_clave {sector_clave!r} no existe. Válidas: {valid}"` con `valid = ", ".join(sorted(_SECTOR_CLAVES_VALIDAS, key=lambda x: int(x)))` = `0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11`.
- `422` — `nivel`, `geo_clave`, `desde`/`hasta`, rango.
- `404` — entidad inexistente: `detail=f"entidad_clave {geo_clave_eff!r} no existe. Consultar GET /api/v1/enoe/catalogos/entidades."`
- `429` — rate limit.

---

## 13. `GET /api/v1/enoe/ocupados/por-posicion/snapshot`

### 13.1 Declaración

- Función: `get_ocupados_por_posicion_snapshot(...) -> SnapshotOcupacionPosicionResponse`
- `response_model=SnapshotOcupacionPosicionResponse`
- `summary="Distribución por posición laboral en un periodo"`
- `description` (verbatim):

```
Composición de la población ocupada por posición laboral (asalariados, empleadores, cuenta propia, no remunerados) en el periodo dado, a nivel nacional o por entidad. % participación pre-calculado en DB.
```

- Rate limit: `@limiter.limit("30/minute")`
- `responses` declarados:
  - `200`: `"Composición por posición laboral."` — ejemplo: `{"periodo": "2025T1", "etapa": "enoe_n", "nivel": "nacional", "geo_clave": None, "geo_nombre": None, "total_ocupados_nivel": 60100000, "n_posiciones": 5, "distribucion": [{"pos_clave": "1", "pos_nombre": "Asalariados", "total_ocupados": 41200000, "participacion_porcentaje": 68.55}], "caveats": [], "source": "INEGI ENOE 15+"}` (real: `pos_clave` es `int`, `pos_nombre` es «Trabajadores subordinados y remunerados», hay `source_url`.)
  - `404`: `{"model": HTTPError404, "description": "Sin datos o `geo_clave` inexistente."}`
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`

### 13.2 Parámetros (query)

| nombre | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|
| `periodo` | `str` | — | `_validate_periodo` (422) | sí | `Periodo YYYYTQ` |
| `nivel` | `str` | `"nacional"` | `in {"nacional","entidad"}` (422) | no | `'nacional' o 'entidad'` |
| `geo_clave` | `Optional[str]` | `None` | `_resolve_geo_clave` (422) + existencia (404) | sólo si `nivel='entidad'` | `Obligatorio si nivel='entidad'` |

Orden: `periodo` → `nivel` → `_resolve_geo_clave` → (SQL) existencia.

### 13.3 SQL

Si `nivel == "entidad"`: `SQL_ENTIDAD_META`.

`SQL_SNAPSHOT_POSICION`:

```sql
SELECT pos_clave, total_personas, pct_ocupados::float AS pct_ocupados,
       etapa::text AS etapa
FROM enoe.poblacion_ocupada_por_posicion
WHERE periodo = :periodo AND nivel = :nivel AND geo_clave = :geo_clave
ORDER BY pos_clave
```

Binding: `{"periodo": periodo, "nivel": nivel, "geo_clave": geo_clave_eff}`. `.mappings().all()`.

Tablas: `enoe.cat_entidad` (condicional), `enoe.poblacion_ocupada_por_posicion`. Agregadas.

### 13.4 Post-procesamiento

```python
if not rows: raise 404
etapa_obs = rows[0]["etapa"]
total_nivel = sum(int(r["total_personas"]) for r in rows)
distribucion = [
    PuntoOcupacionPosicion(
        pos_clave=int(r["pos_clave"]),
        pos_nombre=_POSICION_NOMBRE_BY_CLAVE.get(int(r["pos_clave"]), f"(posicion {r['pos_clave']})"),
        total_ocupados=int(r["total_personas"]),
        participacion_porcentaje=round(float(r["pct_ocupados"]), 4),
    )
    for r in rows
]
```

Respuesta: `periodo`, `etapa=etapa_obs`, `nivel`, `geo_clave=geo_clave_eff if nivel == "entidad" else None`, `geo_nombre`, `total_ocupados_nivel`, `n_posiciones=len(distribucion)`, `distribucion`, `caveats=_caveats_para_distribucion(periodo, periodo)`, `source=SOURCE_ENOE`, `source_url="https://www.inegi.org.mx/programas/enoe/15ymas/"`.

### 13.5 Modelo de respuesta

```python
class PuntoOcupacionPosicion(BaseModel):
    periodo: Optional[str] = None
    pos_clave: int
    pos_nombre: str
    total_ocupados: int = Field(description="Personas ocupadas (factor expandido fac_tri)")
    participacion_porcentaje: float = Field(description="% del total ocupados del nivel")
    etapa: Optional[str] = None

class SnapshotOcupacionPosicionResponse(BaseModel):
    periodo: str
    etapa: str
    nivel: Literal["nacional", "entidad"]
    geo_clave: Optional[str] = None
    geo_nombre: Optional[str] = None
    total_ocupados_nivel: int
    n_posiciones: int
    distribucion: list[PuntoOcupacionPosicion]
    caveats: list[CaveatMetodologico]
    source: str
    source_url: str
```

### 13.6 Errores

- `422` — `periodo`, `nivel`, `geo_clave`.
- `404` — entidad inexistente: `detail=f"entidad_clave {geo_clave_eff!r} no existe. Consultar GET /api/v1/enoe/catalogos/entidades."`
- `404` — sin filas: `detail=f"No hay datos para periodo={periodo!r} nivel={nivel!r} geo_clave={geo_clave_eff!r} (cobertura: 2005T1-2025T1, gap 2020T2)."`
- `429` — rate limit.

---

## 14. `GET /api/v1/enoe/ocupados/por-posicion/serie`

### 14.1 Declaración

- Función: `get_ocupados_por_posicion_serie(...) -> SerieOcupacionPosicionResponse`
- `response_model=SerieOcupacionPosicionResponse`
- `summary="Serie temporal de ocupación en una posición laboral"`
- `description` (verbatim):

```
Trayectoria temporal de ocupados en una posición específica (1=subordinados, 2=empleadores, 3=cuenta propia, 4=no remunerados), nacional o por entidad.
```

- Rate limit: `@limiter.limit("30/minute")`
- `responses` declarados:
  - `200`: `"Serie temporal por posición laboral."` — ejemplo: `{"pos_clave": 1, "pos_nombre": "Asalariados", "nivel": "nacional", "geo_clave": None, "geo_nombre": None, "cobertura": {"desde": "2005T1", "hasta": "2025T1", "n_observaciones": 80}, "datos": [{"periodo": "2025T1", "pos_clave": 1, "pos_nombre": "Asalariados", "total_ocupados": 41200000, "participacion_porcentaje": 68.55, "etapa": "enoe_n"}], "caveats": [], "source": "INEGI ENOE 15+"}`
  - `404`: `{"model": HTTPError404, "description": "`pos_clave` o `geo_clave` no existe."}`
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`

### 14.2 Parámetros (query)

| nombre | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|
| `pos_clave` | `int` | — | `ge=1, le=4` (422 FastAPI); luego `in _POSICION_CLAVES_VALIDAS` (404, inalcanzable) | sí | `Clave posición 1..4` |
| `nivel` | `str` | `"nacional"` | `in {"nacional","entidad"}` (422) | no | `'nacional' o 'entidad'` |
| `geo_clave` | `Optional[str]` | `None` | `_resolve_geo_clave` (422) + existencia (404) | sólo si `nivel='entidad'` | `Obligatorio si nivel='entidad'` |
| `desde` | `Optional[str]` | `None` | `_validate_periodo` (422) | no | `Periodo inicial YYYYTQ` |
| `hasta` | `Optional[str]` | `None` | `_validate_periodo` (422) | no | `Periodo final YYYYTQ` |

Orden: `pos_clave` (404, tras el 422 de FastAPI) → `nivel` → `_resolve_geo_clave` → `desde` → `hasta` → `_validar_desde_hasta` → (SQL) existencia.

### 14.3 SQL

Si `nivel == "entidad"`: `SQL_ENTIDAD_META`.

`SQL_SERIE_POSICION`:

```sql
SELECT periodo, total_personas, pct_ocupados::float AS pct_ocupados,
       etapa::text AS etapa
FROM enoe.poblacion_ocupada_por_posicion
WHERE pos_clave = :pos_clave
  AND nivel = :nivel
  AND geo_clave = :geo_clave
  AND (CAST(:desde AS text) IS NULL OR periodo >= :desde)
  AND (CAST(:hasta AS text) IS NULL OR periodo <= :hasta)
ORDER BY periodo
```

Binding: `{"pos_clave": pos_clave, "nivel": nivel, "geo_clave": geo_clave_eff, "desde": desde, "hasta": hasta}` (`pos_clave` como `int`). `.mappings().all()`.

Tablas: `enoe.cat_entidad` (condicional), `enoe.poblacion_ocupada_por_posicion`. Agregadas.

### 14.4 Post-procesamiento

```python
pos_nombre = _POSICION_NOMBRE_BY_CLAVE[pos_clave]
datos = [PuntoOcupacionPosicion(periodo=r["periodo"], pos_clave=pos_clave, pos_nombre=pos_nombre,
                                total_ocupados=int(r["total_personas"]),
                                participacion_porcentaje=round(float(r["pct_ocupados"]), 4),
                                etapa=r["etapa"]) for r in rows]
cobertura = CoberturaSerie(desde=datos[0].periodo if datos else None, hasta=datos[-1].periodo if datos else None, n_observaciones=len(datos))
```

Respuesta: `pos_clave`, `pos_nombre`, `nivel`, `geo_clave=geo_clave_eff if nivel == "entidad" else None`, `geo_nombre`, `cobertura`, `datos`, `caveats=_caveats_para_distribucion(desde, hasta)`, `source=SOURCE_ENOE`. Sin `source_url`. Serie vacía → 200.

### 14.5 Modelo de respuesta

```python
class SerieOcupacionPosicionResponse(BaseModel):
    pos_clave: int
    pos_nombre: str
    nivel: Literal["nacional", "entidad"]
    geo_clave: Optional[str] = None
    geo_nombre: Optional[str] = None
    cobertura: CoberturaSerie
    datos: list[PuntoOcupacionPosicion]
    caveats: list[CaveatMetodologico]
    source: str
```

### 14.6 Errores

- `422` — `pos_clave` fuera de [1,4] (FastAPI, shape `HTTPValidationError`); `nivel`; `geo_clave`; `desde`/`hasta`; rango.
- `404` — `pos_clave` no en set (código muerto por el `ge/le`): `detail=f"pos_clave {pos_clave!r} no existe. Válidas: {valid}"` con `valid = "1, 2, 3, 4"`.
- `404` — entidad inexistente: `detail=f"entidad_clave {geo_clave_eff!r} no existe. Consultar GET /api/v1/enoe/catalogos/entidades."`
- `429` — rate limit.

---

## Helpers compartidos (Sub-fase 3.6) — microdatos

Comentario de bloque (verbatim):

```
# Acceso a filas individuales de las 5 tablas de microdatos
# (viv/hog/sdem/coe1/coe2, 101.5M filas combinadas).
#
# Decisiones de diseño:
#   - `periodo` OBLIGATORIO: sin él una query barre toda la tabla
#     (Seq Scan ~30s sobre sdem). Con periodo+entidad el index
#     `idx_enoe_<tabla>_periodo_ent` (migration 032) entrega <10ms.
#   - Filtros tabla-específicos (sex/eda solo sdem): un payload
#     uniforme con `sex` opcional para tablas que no lo soportan
#     induciría errores silenciosos. Validación 422 explícita.
#   - Counts EXACTOS (count(*) con mismo WHERE), no `reltuples`:
#     un endpoint público que dice "1,234,567 filas" pero está
#     ±5% engaña al usuario académico. Costo es asumible (índice
#     `(periodo, ent)` cubre count en <50ms).
#   - extras_jsonb: incluido por default (decisión usuario S3.5).
#     Toggle `include_extras=false` para payloads más livianos.
#   - Pagination: LIMIT/OFFSET sobre ORDER BY <PK>. OFFSET >100K
#     degrada — para uso académico exploratorio asumimos page ≤ N
#     razonable. Para extracción masiva: `/export/csv` (futuro).
```

### Allow-list de tablas: `_MD_TABLA_META`

Comentario (verbatim):

```
# Tabla → (nombre_real_postgres, columnas_pk_para_order_by, índice_secundario)
# Cada PK comienza por (periodo, cd_a, ent, con, v_sel, ...) — la columna
# `ent` está en posición 3, por eso filtrar (periodo, ent) sin cd_a deja
# un rango intermedio que el index `(periodo, ent)` cubre contiguo.
```

```python
_MD_TABLA_META: dict[str, dict[str, Any]] = {
    "viv":  {"tabla_real": "microdatos_viv",
             "pk": ("periodo", "cd_a", "ent", "con", "v_sel"),
             "idx_periodo_ent": "idx_enoe_viv_periodo_ent"},
    "hog":  {"tabla_real": "microdatos_hog",
             "pk": ("periodo", "cd_a", "ent", "con", "v_sel", "n_hog"),
             "idx_periodo_ent": "idx_enoe_hog_periodo_ent"},
    "sdem": {"tabla_real": "microdatos_sdem",
             "pk": ("periodo", "cd_a", "ent", "con", "v_sel", "n_hog", "n_ren"),
             "idx_periodo_ent": "idx_enoe_sdem_periodo_ent"},
    "coe1": {"tabla_real": "microdatos_coe1",
             "pk": ("periodo", "cd_a", "ent", "con", "v_sel", "n_hog", "n_ren"),
             "idx_periodo_ent": "idx_enoe_coe1_periodo_ent"},
    "coe2": {"tabla_real": "microdatos_coe2",
             "pk": ("periodo", "cd_a", "ent", "con", "v_sel", "n_hog", "n_ren"),
             "idx_periodo_ent": "idx_enoe_coe2_periodo_ent"},
}
```

El parámetro de ruta `tabla` es `TablaMicrodatos = Literal["viv", "hog", "sdem", "coe1", "coe2"]`; FastAPI rechaza cualquier otro valor con `422` (HTTPValidationError) antes de entrar a la función. El nombre físico se interpola como `enoe.{tabla_real}` en f-string — sólo desde este dict (nunca desde input del usuario). `idx_periodo_ent` no se usa en ningún endpoint (informativo).

### Allow-list de columnas: `_MD_COLUMNAS_CORE_SDEM`

Comentario (verbatim):

```
# Columnas siempre devueltas en /list cuando include_extras=False:
# core (PK + factor + etapa) + las más útiles para análisis básico.
# Solo aplica a sdem que tiene el catálogo más amplio; otras tablas
# devuelven todo el set typed (su payload ya es pequeño).
```

```python
_MD_COLUMNAS_CORE_SDEM: tuple[str, ...] = (
    "periodo", "cd_a", "ent", "con", "v_sel", "n_hog", "n_ren",
    "sex", "eda", "clase1", "clase2", "pos_ocu", "rama_est2",
    "fac_tri", "etapa",
)
```

### `_caveats_para_microdatos(periodo: str)`

Orden de inserción:

1. `periodo == "2020T2"` → `CAVEAT_GAP_2020T2`
2. `"2020T3" <= periodo <= "2021T4"` → `CAVEAT_ETAPA_CAMBIO_MARCO`
3. `"2005T1" <= periodo <= "2020T1"` → `CAVEAT_DOMINIO_15PLUS`

(Mutuamente excluyentes: a lo sumo un caveat.)

### `_validar_filtros_microdatos(tabla, sex, eda_min, eda_max)`

1. Si `tabla != "sdem"` y alguno de `sex`/`eda_min`/`eda_max` no es `None` → `HTTPException(422, detail=f"Los filtros 'sex', 'eda_min' y 'eda_max' solo aplican a tabla='sdem' (microdatos sociodemográficos). Tabla recibida: {tabla!r}. Quita esos filtros o cambia tabla a sdem.")`
2. Si `eda_min` y `eda_max` no nulos y `eda_min > eda_max` → `HTTPException(422, detail=f"'eda_min' ({eda_min}) debe ser <= 'eda_max' ({eda_max}).")`

### `_resolve_entidad_clave(entidad_clave, entidad) -> Optional[str]`

- Ambos no nulos y distintos → `HTTPException(422, detail="Parámetros 'entidad_clave' y 'entidad' enviados con valores distintos ({entidad_clave!r} vs {entidad!r}). Usar solo 'entidad_clave' (canónico); 'entidad' está deprecated.")` (f-string: los `!r` se sustituyen).
- Ambos no nulos e iguales → `entidad_clave`.
- Sólo uno → ese. Ninguno → `None`.

### `_build_microdatos_where(*, tabla, periodo, entidad_clave, sex, eda_min, eda_max) -> (where_clause, params)`

Docstring (verbatim):

```
Construye WHERE parametrizado para microdatos.

SEGURIDAD: todos los valores van por parámetros nombrados (no f-strings).
La única parte dinámica es la lista de cláusulas (whitelisted): periodo
obligatorio + entidad_clave/sex/eda_min/eda_max opcionales.
```

```python
clausulas = ["periodo = :periodo"]
params = {"periodo": periodo}
if entidad_clave is not None:
    clausulas.append("ent = :entidad_clave"); params["entidad_clave"] = entidad_clave
if tabla == "sdem":
    if sex is not None:     clausulas.append("sex = :sex");         params["sex"] = sex
    if eda_min is not None: clausulas.append("eda >= :eda_min");    params["eda_min"] = eda_min
    if eda_max is not None: clausulas.append("eda <= :eda_max");    params["eda_max"] = eda_max
where_clause = " AND ".join(clausulas)
```

Cláusulas posibles, en este orden exacto: `periodo = :periodo` [`AND ent = :entidad_clave`] [`AND sex = :sex`] [`AND eda >= :eda_min`] [`AND eda <= :eda_max`]. Tipos: `periodo`/`entidad_clave` str; `sex`/`eda_min`/`eda_max` int.

---

## 15. `GET /api/v1/enoe/microdatos/{tabla}/list`

### 15.1 Declaración

- Función: `get_microdatos_list(...) -> MicrodatosListResponse`
- `response_model=MicrodatosListResponse`
- `summary="Lista paginada de microdatos individuales"`
- `description` (verbatim, contiene `\n`):

```
Acceso a filas individuales de las 5 tablas de microdatos del ENOE (viv, hog, sdem, coe1, coe2, 101.5M filas combinadas).

**Filtros obligatorios:**
- `periodo`: trimestre YYYYTQ (ej. `2025T1`). Sin este filtro la   query barrería toda la tabla.

**Filtros opcionales:**
- `entidad_clave`: clave INEGI 2 dígitos `01`..`32` (ej. `09` = CDMX). Activa el index `idx_enoe_<tabla>_periodo_ent` (SLA <500ms). El alias `entidad` se acepta por backward compat pero está deprecated.
- `sex`, `eda_min`, `eda_max`: SOLO aplicables a `tabla=sdem` (microdatos sociodemográficos). Otras tablas rechazan estos filtros con HTTP 422 explícito.
- `include_extras`: incluir columna `extras_jsonb` (default `true`). Pasar `false` reduce el payload — útil para listados rápidos.

**Paginación:**
- `page`: 1-indexed, default 1.
- `per_page`: máximo 1000, default 100. El `total` es **exacto** (count(*) con el mismo WHERE), no una aproximación.

**Rate limit:** 10/min por IP (más estricto que los demás endpoints ENOE — protege de descargas masivas a través del API público).

**SLA:** <500ms wall-clock con filtro `periodo` + `entidad_clave` y `per_page` ≤ 100 (con indexes migration 032).

**Caveats:** inyectados según el periodo. Periodos `2020T3-2021T4` tienen subestimación 6-7% en fac_tri (cambio de marco CPV 2020). Periodo `2020T2` no tiene microdatos (gap ETOE).
```

(Nota: en la línea de `periodo` el código concatena `"... Sin este filtro la "` + `"  query barrería ..."`, produciendo el doble espacio «la   query» reproducido arriba.)

- Rate limit: `@limiter.limit("10/minute")`
- `responses` declarados:
  - `200`: `"Página de microdatos."` — ejemplo: `{"tabla": "microdatos_sdem", "filtros": {"periodo": "2025T1", "entidad_clave": "09", "include_extras": True}, "pagination": {"total": 1250000, "page": 1, "per_page": 100, "total_pages": 12500, "has_next": True, "has_previous": False}, "data": [{"folioh": "0900012", "n_ren": "01", "periodo": "2025T1", "etapa": "enoe_n", "extras_jsonb": {}}], "caveats": [], "source": "INEGI ENOE 15+", "tiempo_query_ms": 342.5}`
  - `422`: `{"description": "Filtro `sex`/`eda_*` enviado a una tabla distinta de sdem, o `tabla` inválida."}`
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido (10 req/min por IP)."}`

### 15.2 Parámetros

| nombre | in | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|---|
| `tabla` | path | `TablaMicrodatos` (Literal viv/hog/sdem/coe1/coe2) | — | Literal (422 FastAPI) | sí | `Una de: viv \| hog \| sdem \| coe1 \| coe2` |
| `periodo` | query | `str` | — | `pattern=r"^20\d{2}T[1-4]$"` (422 FastAPI) | sí | `Trimestre YYYYTQ (ej. 2025T1). OBLIGATORIO.` |
| `entidad_clave` | query | `Optional[str]` | `None` | `pattern=r"^(0[1-9]\|[12][0-9]\|3[0-2])$"` | no | `Clave INEGI '01'..'32' (ej. '09' = CDMX). Opcional pero recomendado para SLA.` |
| `entidad` | query | `Optional[str]` | `None` | mismo pattern; `deprecated=True` | no | `DEPRECATED: usar `entidad_clave`. Alias retenido por backward compat; será removido en una versión futura.` |
| `sex` | query | `Optional[int]` | `None` | `ge=1, le=2` | no | `Solo sdem. 1=hombre, 2=mujer.` |
| `eda_min` | query | `Optional[int]` | `None` | `ge=0, le=98` | no | `Solo sdem. Edad mínima (años).` |
| `eda_max` | query | `Optional[int]` | `None` | `ge=0, le=98` | no | `Solo sdem. Edad máxima (años).` |
| `include_extras` | query | `bool` | `True` | — | no | `Incluir columna extras_jsonb (default true).` |
| `page` | query | `int` | `1` | `ge=1` | no | `Página, 1-indexed.` |
| `per_page` | query | `int` | `100` | `ge=1, le=1000` | no | `Filas por página, máximo 1000.` |

Orden de validación en la función: `_validar_filtros_microdatos` → `_resolve_entidad_clave`. (`periodo` NO pasa por `_validate_periodo`; sólo el `pattern`.)

### 15.3 SQL (construido dinámicamente)

```python
meta = _MD_TABLA_META[tabla]; tabla_real = meta["tabla_real"]; pk_cols = meta["pk"]
where_clause, params = _build_microdatos_where(tabla=tabla, periodo=periodo, entidad_clave=entidad_clave_eff,
                                               sex=sex, eda_min=eda_min, eda_max=eda_max)

select_cols = "*" if include_extras else (
    ", ".join(_MD_COLUMNAS_CORE_SDEM) if tabla == "sdem" else "*"
)
order_by = ", ".join(pk_cols)
offset = (page - 1) * per_page

sql_data = (
    f"SELECT {select_cols} FROM enoe.{tabla_real} "
    f"WHERE {where_clause} "
    f"ORDER BY {order_by} "
    f"LIMIT :limit OFFSET :offset"
)
sql_count = f"SELECT count(*) AS total FROM enoe.{tabla_real} WHERE {where_clause}"
params_data = {**params, "limit": per_page, "offset": offset}
```

Comentario del bloque `select_cols` (verbatim, explica por qué las tablas ≠ sdem devuelven `*` aun con `include_extras=false`):

```
# Lista de columnas: SELECT * funciona pero excluir extras_jsonb cuando
# include_extras=False reduce el payload (extras_jsonb puede tener
# 30-80 keys por fila). Para sdem además ofrecemos columnas-core como
# set conservador.
```
```
# Para viv/hog/coe1/coe2: todas las typed (incluye PK + core) pero
# NO extras_jsonb. Lo más simple: enumerar dinámicamente desde
# information_schema... pero por costo agregamos un star-minus.
# PostgreSQL no soporta SELECT * EXCEPT, así que usamos un
# constructor: select todas las typed columns. Las hemos vistos
# en los \d arriba — para evitar drift, hacemos un SELECT con
# CASE alternativo: SELECT * MINUS extras_jsonb via a CTE.
# Aproximación pragmática: emitimos un sub-SELECT que serializa
# row_to_json menos extras_jsonb. Pero overkill — el payload
# de viv/hog/coe1/coe2 sin extras es pequeño igual.
```

Formas resultantes del SQL (texto exacto tras interpolación; `<WHERE>` es la cadena de `_build_microdatos_where`):

| tabla | `include_extras` | `sql_data` |
|---|---|---|
| viv | cualquiera | `SELECT * FROM enoe.microdatos_viv WHERE <WHERE> ORDER BY periodo, cd_a, ent, con, v_sel LIMIT :limit OFFSET :offset` |
| hog | cualquiera | `SELECT * FROM enoe.microdatos_hog WHERE <WHERE> ORDER BY periodo, cd_a, ent, con, v_sel, n_hog LIMIT :limit OFFSET :offset` |
| sdem | `true` | `SELECT * FROM enoe.microdatos_sdem WHERE <WHERE> ORDER BY periodo, cd_a, ent, con, v_sel, n_hog, n_ren LIMIT :limit OFFSET :offset` |
| sdem | `false` | `SELECT periodo, cd_a, ent, con, v_sel, n_hog, n_ren, sex, eda, clase1, clase2, pos_ocu, rama_est2, fac_tri, etapa FROM enoe.microdatos_sdem WHERE <WHERE> ORDER BY periodo, cd_a, ent, con, v_sel, n_hog, n_ren LIMIT :limit OFFSET :offset` |
| coe1 | cualquiera | `SELECT * FROM enoe.microdatos_coe1 WHERE <WHERE> ORDER BY periodo, cd_a, ent, con, v_sel, n_hog, n_ren LIMIT :limit OFFSET :offset` |
| coe2 | cualquiera | `SELECT * FROM enoe.microdatos_coe2 WHERE <WHERE> ORDER BY periodo, cd_a, ent, con, v_sel, n_hog, n_ren LIMIT :limit OFFSET :offset` |

`sql_count`: `SELECT count(*) AS total FROM enoe.<tabla_real> WHERE <WHERE>`.

Ejecución (misma conexión, en este orden, cronometrada con `time.perf_counter()`):

```python
t0 = time.perf_counter()
async with engine.connect() as conn:
    total = int((await conn.execute(text(sql_count), params)).scalar_one())
    rows = (await conn.execute(text(sql_data), params_data)).mappings().all()
t_query_ms = round((time.perf_counter() - t0) * 1000, 2)
```

LIMIT = `per_page`; OFFSET = `(page - 1) * per_page`. La query de datos se ejecuta aunque `total == 0` o `page > total_pages`.

Tablas: `enoe.microdatos_viv`, `enoe.microdatos_hog`, `enoe.microdatos_sdem`, `enoe.microdatos_coe1`, `enoe.microdatos_coe2` (una por request). **MICRODATOS.**

### 15.4 Post-procesamiento

```python
data = []
for r in rows:
    row_dict = dict(r)
    # Coerce types: postgres CHAR(6) viene como 'YYYYTQ' (puede tener
    # trailing whitespace si fue insertado con CHAR fixed-width); strip.
    if isinstance(row_dict.get("periodo"), str):
        row_dict["periodo"] = row_dict["periodo"].strip()
    if isinstance(row_dict.get("etapa"), str):
        row_dict["etapa"] = row_dict["etapa"]          # no-op (asignación idéntica)
    data.append(MicrodatosRow.model_validate(row_dict))

total_pages = (total + per_page - 1) // per_page if total > 0 else 0
pagination = PaginationMetadata(total=total, page=page, per_page=per_page, total_pages=total_pages,
                                has_next=page < total_pages, has_previous=page > 1)

filtros_eco = {"periodo": periodo}
if entidad_clave_eff is not None: filtros_eco["entidad_clave"] = entidad_clave_eff
if sex is not None:               filtros_eco["sex"] = sex
if eda_min is not None:           filtros_eco["eda_min"] = eda_min
if eda_max is not None:           filtros_eco["eda_max"] = eda_max
filtros_eco["include_extras"] = include_extras
```

- Sólo `periodo` recibe `.strip()`; ninguna otra columna `CHAR(n)` se recorta.
- `MicrodatosRow` tiene `extra="allow"`: todas las columnas del SELECT se serializan tal cual (incluye `extras_jsonb` como dict cuando viene). `periodo` y `etapa` son obligatorios en el modelo; si `etapa` es ENUM en Postgres, el driver la entrega como str.
- `filtros` siempre publica `entidad_clave` (canónico) aunque el cliente haya mandado `entidad`; `include_extras` siempre presente al final.
- `tabla=tabla_real` (con prefijo `microdatos_`, sin schema), `caveats=_caveats_para_microdatos(periodo)`, `source=SOURCE_ENOE`, `tiempo_query_ms=t_query_ms`.
- `total_pages=0` cuando `total=0` → `has_next=False`, `has_previous=page > 1`.

### 15.5 Modelo de respuesta

```python
class MicrodatosRow(BaseModel):
    model_config = ConfigDict(extra="allow")
    periodo: str
    etapa: str
    # + columnas dinámicas de la tabla

class PaginationMetadata(BaseModel):
    total: int = Field(description="Total de filas que matchean los filtros (EXACTO).")
    page: int = Field(description="Página actual, 1-indexed.")
    per_page: int
    total_pages: int
    has_next: bool
    has_previous: bool

class MicrodatosListResponse(BaseModel):
    tabla: str
    filtros: dict[str, Any]
    pagination: PaginationMetadata
    data: list[MicrodatosRow]
    caveats: list[CaveatMetodologico]
    source: str
    tiempo_query_ms: Optional[float] = Field(
        default=None,
        description=("Tiempo total de las queries SQL (no incluye serialización ni overhead "
                     "FastAPI). Útil para validar SLA <500ms."),
    )
```

### 15.6 Errores

- `422` (FastAPI) — `tabla` fuera del Literal; `periodo` no cumple pattern; `entidad_clave`/`entidad` no cumplen pattern; `sex`/`eda_*`/`page`/`per_page` fuera de rango.
- `422` (router) — filtros sdem en otra tabla; `eda_min > eda_max`; `entidad_clave` ≠ `entidad` (mensajes de helpers).
- `429` — rate limit (10/minute).

---

## 16. `GET /api/v1/enoe/microdatos/{tabla}/count`

### 16.1 Declaración

- Función: `get_microdatos_count(...) -> MicrodatosCountResponse`
- `response_model=MicrodatosCountResponse`
- `summary="Conteo exacto de microdatos con filtros"`
- `description` (verbatim):

```
Conteo EXACTO (count(*)) de filas de microdatos que coinciden con los filtros. Mismos filtros que `/microdatos/{tabla}/list`.

**SLA:** <200ms con filtro `periodo` + `entidad_clave`.

**Uso típico:** prelookup antes de paginar — saber cuántas filas existen sin descargar las filas.
```

- Rate limit: `@limiter.limit("30/minute")`
- `responses` declarados:
  - `200`: `"Conteo exacto + eco de filtros + caveat opcional."` — ejemplo: `{"tabla": "microdatos_sdem", "filtros": {"periodo": "2025T1", "entidad_clave": "09"}, "total": 1250000, "caveat": None, "source": "INEGI ENOE 15+"}` (el campo real es `caveat_metodologico`.)
  - `422`: `{"description": "Filtro `sex`/`eda_*` enviado a una tabla distinta de sdem."}`
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`

### 16.2 Parámetros

| nombre | in | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|---|
| `tabla` | path | `TablaMicrodatos` | — | Literal (422) | sí | `Una de: viv \| hog \| sdem \| coe1 \| coe2` |
| `periodo` | query | `str` | — | `pattern=r"^20\d{2}T[1-4]$"` | sí | `Trimestre YYYYTQ (ej. 2025T1). OBLIGATORIO.` |
| `entidad_clave` | query | `Optional[str]` | `None` | `pattern=r"^(0[1-9]\|[12][0-9]\|3[0-2])$"` | no | `Clave INEGI '01'..'32'. Opcional pero recomendado para SLA.` |
| `entidad` | query | `Optional[str]` | `None` | mismo pattern; `deprecated=True` | no | `DEPRECATED: usar `entidad_clave`. Alias retenido por backward compat; será removido en una versión futura.` |
| `sex` | query | `Optional[int]` | `None` | `ge=1, le=2` | no | `Solo sdem.` |
| `eda_min` | query | `Optional[int]` | `None` | `ge=0, le=98` | no | `Solo sdem.` |
| `eda_max` | query | `Optional[int]` | `None` | `ge=0, le=98` | no | `Solo sdem.` |

Orden: `_validar_filtros_microdatos` → `_resolve_entidad_clave`.

### 16.3 SQL

```python
where_clause, params = _build_microdatos_where(...)   # idéntico a /list
sql_count = f"SELECT count(*) AS total FROM enoe.{tabla_real} WHERE {where_clause}"
total = int((await conn.execute(text(sql_count), params)).scalar_one())
```

Texto: `SELECT count(*) AS total FROM enoe.<tabla_real> WHERE <WHERE>` con `<WHERE>` según 15.3. Sin ORDER/LIMIT/OFFSET.

Tablas: `enoe.microdatos_*` (una por request). **MICRODATOS.**

### 16.4 Post-procesamiento

```python
filtros_eco = {"periodo": periodo}
if entidad_clave_eff is not None: filtros_eco["entidad_clave"] = entidad_clave_eff
if sex is not None:               filtros_eco["sex"] = sex
if eda_min is not None:           filtros_eco["eda_min"] = eda_min
if eda_max is not None:           filtros_eco["eda_max"] = eda_max
# (sin include_extras)

caveat_msg = None
if periodo == "2020T2":
    caveat_msg = (
        "Periodo 2020T2 no tiene microdatos descargables (ETOE telefónica "
        "sustituyó al ENOE presencial por COVID-19; INEGI solo publicó "
        "agregados). Esperar total=0."
    )
```

Respuesta: `tabla=tabla_real`, `filtros=filtros_eco`, `total=total`, `caveat_metodologico=caveat_msg` (string plano, NO `CaveatMetodologico`), `source=SOURCE_ENOE`.

### 16.5 Modelo de respuesta

```python
class MicrodatosCountResponse(BaseModel):
    tabla: str
    filtros: dict[str, Any]
    total: int
    caveat_metodologico: Optional[str] = None
    source: str
```

### 16.6 Errores

- `422` (FastAPI) — `tabla`, `periodo`, `entidad_clave`/`entidad`, `sex`, `eda_*`.
- `422` (router) — filtros sdem en otra tabla; `eda_min > eda_max`; `entidad_clave` ≠ `entidad`.
- `429` — rate limit.

---

## 17. `GET /api/v1/enoe/microdatos/{tabla}/schema`

### 17.1 Declaración

- Función: `get_microdatos_schema(...) -> MicrodatosSchemaResponse`
- `response_model=MicrodatosSchemaResponse`
- `summary="Schema de una tabla de microdatos"`
- `description` (verbatim):

```
Lista las columnas, tipos, PK e indexes de una tabla de microdatos. Se incluye total de filas (EXACTO desde enoe.estadisticas_globales).

**Uso:** inspeccionar columnas disponibles antes de construir queries vía `/list`. Las columnas core (PK, fac_tri, etapa) traen descripción; las demás se documentan en INEGI Reconstrucción de variables 2023.

**SLA:** <100ms (lectura de catálogos del sistema).
```

- Rate limit: `@limiter.limit("60/minute")`
- `responses` declarados:
  - `200`: `"Metadata estructural de la tabla de microdatos."` — ejemplo: `{"tabla": "microdatos_sdem", "total_filas": 31500762, "cobertura_temporal": "2005T1-2025T1", "primary_key": ["periodo", "cd_a", "ent", "con", "v_sel", "n_hog", "h_mud", "n_ren"], "columnas": [{"nombre": "periodo", "tipo": "character(6)", "nullable": False, "descripcion": "Trimestre YYYYTQ"}], "indexes": ["idx_enoe_microdatos_sdem_periodo_ent"], "caveat_metodologico": "(ver descripción)", "source": "INEGI ENOE 15+"}` (el modelo real usa `pk` no `primary_key`, no tiene `source`, e incluye `total_columnas`; la PK real declarada para sdem no incluye `h_mud`.)
  - `429`: `{"model": HTTPError429, "description": "Rate limit excedido."}`

### 17.2 Parámetros

| nombre | in | tipo | default | validación | requerido | description |
|---|---|---|---|---|---|---|
| `tabla` | path | `TablaMicrodatos` | — | Literal (422) | sí | `Una de: viv \| hog \| sdem \| coe1 \| coe2` |

### 17.3 SQL

`SQL_MD_SCHEMA_COLUMNAS`:

```sql
SELECT column_name, data_type, character_maximum_length,
       is_nullable, ordinal_position
FROM information_schema.columns
WHERE table_schema = 'enoe' AND table_name = :tabla_real
ORDER BY ordinal_position
```

`SQL_MD_SCHEMA_INDEXES`:

```sql
SELECT i.relname AS index_name
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'enoe'
  AND t.relname = :tabla_real
  AND NOT ix.indisprimary
ORDER BY i.relname
```

Query inline de estadísticas:

```sql
SELECT total_filas, cobertura_temporal FROM enoe.estadisticas_globales WHERE tabla = :t
```

Binding: `{"tabla_real": tabla_real}` para las dos primeras (`.mappings().all()`), `{"t": tabla_real}` para la tercera (`.mappings().one_or_none()`). Las tres en la misma conexión, en ese orden.

Tablas: `information_schema.columns`, `pg_catalog.pg_index`, `pg_catalog.pg_class`, `pg_catalog.pg_namespace` (sin schema-qualify en el SQL), `enoe.estadisticas_globales`. Describe `enoe.microdatos_*` pero no lee sus filas.

### 17.4 Post-procesamiento

```python
def _tipo_postgres_descriptivo(data_type: str, char_max_len: Optional[int]) -> str:
    """information_schema da 'character' + length separado; reunir en 'character(6)'."""
    if data_type in ("character", "character varying") and char_max_len:
        suffix = "varying" if data_type == "character varying" else ""
        return f"character {suffix}({char_max_len})".replace("  ", " ").strip()
    return data_type
```

Resultados de esa función: `character(6)` → `"character (6)"` (queda el espacio antes del paréntesis: `"character " + "" + "(6)"` = `"character (6)"`; `replace("  ", " ")` no lo elimina porque es un solo espacio); `character varying(10)` → `"character varying(10)"`; otros tipos → `data_type` tal cual (`smallint`, `integer`, `jsonb`, `USER-DEFINED` para el ENUM, etc.).

```python
columnas = [ColumnaSchema(nombre=r["column_name"],
                          tipo=_tipo_postgres_descriptivo(r["data_type"], r["character_maximum_length"]),
                          nullable=(r["is_nullable"] == "YES"),
                          descripcion=_MD_COLUMNA_DESCRIPCIONES.get(r["column_name"]))
            for r in cols_rows]
indexes = [r["index_name"] for r in idx_rows]
caveat_msg = (
    "Las columnas no listadas con descripción siguen los identificadores "
    "INEGI documentados en Reconstrucción de variables 2023 "
    "(https://www.inegi.org.mx/contenidos/programas/enoe/15ymas/doc/recons_var_15ymas.pdf). "
    "extras_jsonb contiene las columnas DBF que no se promovieron a typed."
)
```

Respuesta: `tabla=tabla_real`, `total_columnas=len(columnas)`, `total_filas=int(stats_row["total_filas"]) if stats_row else 0`, `cobertura_temporal=stats_row["cobertura_temporal"] if stats_row else None`, `columnas`, `pk=list(meta["pk"])` (declarativo desde `_MD_TABLA_META`, no leído del catálogo), `indexes`, `caveat_metodologico=caveat_msg` (constante).

### 17.5 Modelo de respuesta

```python
class ColumnaSchema(BaseModel):
    nombre: str
    tipo: str                          # tipo Postgres (character(2), smallint, integer, jsonb, ...)
    nullable: bool
    descripcion: Optional[str] = None  # llenado solo para columnas core

class MicrodatosSchemaResponse(BaseModel):
    tabla: str                         # nombre tabla SIN prefijo schema (ej. 'microdatos_sdem')
    total_columnas: int
    total_filas: int                   # EXACTO desde estadisticas_globales
    cobertura_temporal: Optional[str]
    columnas: list[ColumnaSchema]
    pk: list[str]
    indexes: list[str]                 # nombres de indexes adicionales (no PK)
    caveat_metodologico: Optional[str] = None
```

### 17.6 Errores

- `422` (FastAPI) — `tabla` fuera del Literal.
- `429` — rate limit.

---

## Catálogos y constantes

Todo verbatim del router salvo indicación.

### `SOURCE_*`

```python
SOURCE_ENOE = (
    "INEGI — Encuesta Nacional de Ocupación y Empleo (ENOE 15+). "
    "https://www.inegi.org.mx/programas/enoe/15ymas/"
)

SOURCE_RECONS_VARIABLES = (
    "INEGI — ENOE Reconstrucción de variables 2023. "
    "https://www.inegi.org.mx/contenidos/programas/enoe/15ymas/doc/recons_var_15ymas.pdf"
)
```

URL literal repetida en `source_url` de 6, 11 y 13 y en `fuente_url` de 2: `"https://www.inegi.org.mx/programas/enoe/15ymas/"`.

### Caveats globales (`CaveatMetodologico`)

```python
CAVEAT_DOMINIO_15PLUS = CaveatMetodologico(
    slug="dominio_15_plus",
    titulo="Dominio operativo de la serie: población de 15 años o más",
    descripcion=(
        "El observatorio reporta indicadores con dominio 15+ uniformemente "
        "en toda la serie. INEGI publicó originalmente la etapa clasica "
        "(2005T1-2020T1) con dominio 14+ siguiendo el marco legal pre-2014. "
        "El ENOE-N (2020T3+) ya nace con 15+ post-reforma constitucional 2014. "
        "Re-cálculo con 15+ en pre-2020T3 mantiene comparabilidad longitudinal."
    ),
    periodo_aplicable="2005T1-2020T1 (recálculo 15+)",
    referencia="Boletín INEGI 209/15 — Reforma constitucional 2014",
)

CAVEAT_ETAPA_CAMBIO_MARCO = CaveatMetodologico(
    slug="cambio_marco_2020T3",
    titulo="Cambio de marco muestral en 2020T3 (post-Censo 2020)",
    descripcion=(
        "Series que cruzan 2020T2/2020T3 deben interpretarse considerando "
        "el rediseño del marco muestral post-Censo 2020. Pre-2020T3 usa marco "
        "pre-Censo 2020 (etapa 'clasica'); post-2020T3 usa marco post-Censo "
        "2020 (etapa 'enoe_n'). El 2020T3-2021T4 conserva factores fac_tri "
        "pre-CPV-2020 → subestimación de 6-7% en conteos absolutos respecto "
        "a publicaciones posteriores. Las tasas (cocientes razón) no se ven "
        "afectadas por este artefacto."
    ),
    periodo_aplicable="2020T3-2021T4 (subestimación absolutos)",
    referencia="Boletín INEGI 280/21",
)

CAVEAT_GAP_2020T2 = CaveatMetodologico(
    slug="gap_2020T2_etoe",
    titulo="Gap 2020T2: ETOE telefónica sustituye al ENOE presencial (COVID-19)",
    descripcion=(
        "INEGI sustituyó el ENOE presencial por la Encuesta Telefónica de "
        "Ocupación y Empleo (ETOE) durante el 2020T2 por la pandemia COVID-19. "
        "La ETOE NO publicó microdatos descargables, solo agregados en la "
        "sección de investigación. El observatorio omite 2020T2 por "
        "asimetría metodológica (decisión D2b documentada en docs internos). "
        "Series con 'desde<=2020T2<=hasta' tendrán un gap de 1 trimestre."
    ),
    periodo_aplicable="2020T2 (1 trimestre omitido)",
    referencia="Comunicado INEGI ETOE — Acervo Información Investigación",
)

CAVEAT_TIL1_INFORMALIDAD = CaveatMetodologico(
    slug="til1_definicion_operativa",
    titulo="Tasa de Informalidad Laboral TIL1: 7 condiciones operativas",
    descripcion=(
        "TIL1 se deriva en runtime desde 7 condiciones unidas con OR "
        "sobre tue2, pos_ocu, rama, seg_soc, remune2c (esta última vive "
        "en extras_jsonb por no estar typed). Sección 3.36 INEGI "
        "Reconstrucción de variables 2023."
    ),
    periodo_aplicable="Todos los periodos",
    referencia=SOURCE_RECONS_VARIABLES,
)

CAVEAT_TCCO_REDEFINICION = CaveatMetodologico(
    slug="tcco_redefinicion_2020",
    titulo="TCCO (Condiciones Críticas de Ocupación): 3 condiciones operativas",
    descripcion=(
        "INEGI ajustó la definición operativa de TCCO en el rediseño 2020. "
        "El observatorio calcula TCCO con el dominio 3-condiciones documentado "
        "en sec 3.24 INEGI Reconstrucción de variables 2023, aplicable a "
        "toda la serie. Series TCCO 2005-2019 no son comparables 1:1 con "
        "publicaciones INEGI pre-2020 que usaban definición previa."
    ),
    periodo_aplicable="Pre-2020T3 (comparación con publicaciones INEGI originales)",
    referencia=f"{SOURCE_RECONS_VARIABLES} (sec 3.24)",
)

CAVEATS_GLOBALES: list[CaveatMetodologico] = [
    CAVEAT_DOMINIO_15PLUS,
    CAVEAT_ETAPA_CAMBIO_MARCO,
    CAVEAT_GAP_2020T2,
    CAVEAT_TIL1_INFORMALIDAD,
    CAVEAT_TCCO_REDEFINICION,
]

_CAVEATS_BY_SLUG: dict[str, CaveatMetodologico] = {c.slug: c for c in CAVEATS_GLOBALES}
```

Valor expandido de `CAVEAT_TCCO_REDEFINICION.referencia`: `"INEGI — ENOE Reconstrucción de variables 2023. https://www.inegi.org.mx/contenidos/programas/enoe/15ymas/doc/recons_var_15ymas.pdf (sec 3.24)"`.

### `_INDICADORES_DEFS` (13 indicadores)

Comentario (verbatim): `# Mantiene paridad con api/etl/enoe/calculadora.py. Si se añade un` / `# indicador nuevo allí, replicarlo aquí.`

| # | slug | nombre | descripcion | unidad | categoria | formula | caveat_slug |
|---|---|---|---|---|---|---|---|
| 1 | `pob_15ymas` | `Población de 15 años o más` | `Universo de referencia del ENOE 15+. Suma expandida vía fac_tri.` | `personas` | `conteo` | `SUM(fac_tri) WHERE eda >= 15` | `dominio_15_plus` |
| 2 | `pea_total` | `Población Económicamente Activa (PEA)` | `Personas 15+ ocupadas o buscando empleo (clase1=1).` | `personas` | `conteo` | `SUM(fac_tri) WHERE eda >= 15 AND clase1 = 1` | `None` |
| 3 | `pnea_total` | `Población No Económicamente Activa (PNEA)` | `Personas 15+ que no participan en el mercado laboral (clase1=2).` | `personas` | `conteo` | `SUM(fac_tri) WHERE eda >= 15 AND clase1 = 2` | `None` |
| 4 | `ocupados_total` | `Población ocupada` | `Personas 15+ con trabajo (clase2=1).` | `personas` | `conteo` | `SUM(fac_tri) WHERE clase2 = 1` | `None` |
| 5 | `desocupados_total` | `Población desocupada` | `Personas 15+ sin trabajo, buscando empleo (clase2=2).` | `personas` | `conteo` | `SUM(fac_tri) WHERE clase2 = 2` | `None` |
| 6 | `subocupados_total` | `Población subocupada` | `Ocupados disponibles para trabajar más horas (sub_o=1).` | `personas` | `conteo` | `SUM(fac_tri) WHERE clase2 = 1 AND sub_o = 1` | `None` |
| 7 | `condcrit_total` | `Ocupados en condiciones críticas (TCCO)` | `Ocupados con al menos una de 3 condiciones críticas (tcco in 1,2,3).` | `personas` | `conteo` | `SUM(fac_tri) WHERE clase2 = 1 AND tcco IN (1, 2, 3)` | `tcco_redefinicion_2020` |
| 8 | `informales_total` | `Ocupados informales (TIL1 base)` | `Ocupados informales según TIL1 (7 condiciones operativas sobre tue2/pos_ocu/rama/seg_soc/remune2c).` | `personas` | `conteo` | `SUM(fac_tri) WHERE clase2 = 1 AND TIL1_predicado` | `til1_definicion_operativa` |
| 9 | `tasa_participacion` | `Tasa de Participación` | `Porcentaje de la población 15+ que está económicamente activa.` | `porcentaje` | `tasa` | `100 × PEA / Pob15+` | `dominio_15_plus` |
| 10 | `tasa_desocupacion` | `Tasa de Desocupación` | `Porcentaje de la PEA sin empleo.` | `porcentaje` | `tasa` | `100 × Desocupados / PEA` | `None` |
| 11 | `tasa_subocupacion` | `Tasa de Subocupación` | `Porcentaje de ocupados disponibles para trabajar más horas.` | `porcentaje` | `tasa` | `100 × Subocupados / Ocupados` | `None` |
| 12 | `tasa_informalidad_til1` | `Tasa de Informalidad Laboral (TIL1)` | `Porcentaje de ocupados en condición de informalidad según TIL1 (sec 3.36 INEGI Reconstrucción de variables 2023).` | `porcentaje` | `tasa` | `100 × Informales / Ocupados` | `til1_definicion_operativa` |
| 13 | `tasa_ocupacion_critica_tcco` | `Tasa de Condiciones Críticas de Ocupación (TCCO)` | `Porcentaje de ocupados con al menos una de 3 condiciones críticas (sec 3.24 INEGI Reconstrucción de variables 2023).` | `porcentaje` | `tasa` | `100 × Ocupados_TCCO / Ocupados` | `tcco_redefinicion_2020` |

Derivados:

```python
_INDICADOR_SLUGS_VALIDOS: set[str] = {d["slug"] for d in _INDICADORES_DEFS}
_INDICADOR_DEFN_BY_SLUG: dict[str, dict] = {d["slug"]: d for d in _INDICADORES_DEFS}
_INDICADORES_CONTEO: set[str] = {s for s, d in _INDICADOR_DEFN_BY_SLUG.items() if d["categoria"] == "conteo"}
_INDICADORES_SENSIBLES_DOMINIO: set[str] = {"pob_15ymas", "pea_total", "pnea_total", "tasa_participacion"}
_PERIODO_RE = re.compile(r"^(20\d{2})T([1-4])$")
```

### `ETAPAS_DEFS` (3 etapas, `EtapaMetodologica`)

```python
ETAPAS_DEFS: list[EtapaMetodologica] = [
    EtapaMetodologica(
        slug="clasica",
        nombre="ENOE Clásica (pre-rediseño)",
        descripcion=(
            "Diseño 2005-2020T1 con marco muestral pre-Censo 2020. "
            "Población originalmente publicada con dominio 14+; el observatorio "
            "re-calcula con dominio 15+ para comparabilidad longitudinal."
        ),
        periodo_inicio="2005T1",
        periodo_fin="2020T1",
        dominio_edad="15+ (recálculo); publicación original 14+",
        n_trimestres=61,
        tiene_microdatos=True,
        caveat_aplicable=(
            "Para comparaciones largas que cruzan 2020T2/2020T3, considerar "
            "cambio de marco muestral post-Censo 2020 (slug 'cambio_marco_2020T3')."
        ),
    ),
    EtapaMetodologica(
        slug="etoe_telefonica",
        nombre="ETOE (Encuesta Telefónica) — COVID-19",
        descripcion=(
            "Diseño emergente 2020T2: encuesta telefónica sustituta del ENOE "
            "presencial durante el confinamiento pandémico. INEGI no publicó "
            "microdatos descargables; solo agregados de investigación. El "
            "observatorio omite este trimestre por asimetría metodológica."
        ),
        periodo_inicio="2020T2",
        periodo_fin="2020T2",
        dominio_edad="15+",
        n_trimestres=1,
        tiene_microdatos=False,
        caveat_aplicable=(
            "Sin microdatos descargables. Etapa registrada para completeness "
            "documental. Series ENOE saltan de 2020T1 a 2020T3."
        ),
    ),
    EtapaMetodologica(
        slug="enoe_n",
        nombre="ENOE-N (Nueva Edición, post-Censo 2020)",
        descripcion=(
            "Diseño actual desde 2020T3 con marco muestral rediseñado "
            "post-Censo 2020. Población 15+ uniformemente. Incluye URL legacy "
            "enoe_n_* (2020T3-2022T4) y enoe_* (2023T1+), rebranding nominal "
            "sin cambio metodológico."
        ),
        periodo_inicio="2020T3",
        periodo_fin=None,
        dominio_edad="15+",
        n_trimestres=19,
        tiene_microdatos=True,
        caveat_aplicable=(
            "2020T3-2021T4: fac_tri pre-CPV-2020 produce subestimación 6-7% "
            "en conteos absolutos (no afecta tasas). Slug 'cambio_marco_2020T3'."
        ),
    ),
]
```

Valores válidos de `etapa` (helper `_validate_etapa`): `{"clasica", "etoe_telefonica", "enoe_n"}` (ENUM `enoe.etapa_metodologica`, migration 031).

### `_TABLA_DESCRIPCIONES` (metadata; orden de emisión)

```python
_TABLA_DESCRIPCIONES: dict[str, str] = {
    "microdatos_viv":  "Microdatos de Vivienda (cuestionario residencial)",
    "microdatos_hog":  "Microdatos de Hogar (cuestionario doméstico)",
    "microdatos_sdem": "Microdatos Sociodemográficos (fuente operativa de los indicadores)",
    "microdatos_coe1": "Cuestionario de Ocupación y Empleo, parte 1",
    "microdatos_coe2": "Cuestionario de Ocupación y Empleo, parte 2",
    "indicadores_nacionales":         "Indicadores agregados a nivel nacional",
    "indicadores_entidad":            "Indicadores agregados por entidad federativa",
    "indicadores_area_metropolitana": "Indicadores por área metropolitana (schema-ready, pendiente Fase 4)",
    "indicadores_anuales_ampliado":   "Indicadores anuales del cuestionario ampliado (solo T1, schema-ready)",
    "poblacion_ocupada_por_sector":   "Cortes de ocupados por sector económico (rama_est2, 11 sectores SCIAN agregados + categoría '0' no especificado)",
    "poblacion_ocupada_por_posicion": "Cortes de ocupados por posición en la ocupación (pos_ocu)",
}
```

Local a `get_enoe_metadata`: `_SCHEMA_READY_TABLES = {"indicadores_area_metropolitana", "indicadores_anuales_ampliado"}`.

### `SECTORES_DEFS` (12 sectores, clave `str`)

Comentario (verbatim):

```
# Fuente: INEGI ENOE — Reconstrucción de variables 2023 (rama_est2 SCIAN
# agregado en 11 sectores + categoría '0' no especificado; pos_ocu en 4
# clases). Verificado contra valores observados en la DB (12 claves sector,
# 4 claves posición).
```

| clave | nombre | descripcion |
|---|---|---|
| `"0"` | `No especificado` | `Ocupados sin clasificación sectorial declarada (~0.7% nacional 2025T1).` |
| `"1"` | `Agricultura, ganadería, silvicultura, caza y pesca` | `Sector primario SCIAN agregado.` |
| `"2"` | `Industria extractiva y de la electricidad` | `Minería, generación eléctrica, agua y gas.` |
| `"3"` | `Industria manufacturera` | `Transformación de bienes (incluye maquila y ensamble).` |
| `"4"` | `Construcción` | `Edificación, obra civil y servicios especializados de construcción.` |
| `"5"` | `Comercio` | `Comercio al por mayor y al por menor.` |
| `"6"` | `Restaurantes y servicios de alojamiento` | `Servicios de preparación de alimentos y hospedaje.` |
| `"7"` | `Transportes, comunicaciones, correo y almacenamiento` | `Transporte de carga y pasajeros, telecomunicaciones, correo, almacenes.` |
| `"8"` | `Servicios profesionales, financieros y corporativos` | `Servicios profesionales, financieros, inmobiliarios y corporativos.` |
| `"9"` | `Servicios sociales` | `Educación, salud, asistencia social y servicios comunitarios.` |
| `"10"` | `Servicios diversos` | `Otros servicios excepto gobierno (servicios personales, reparación, etc.).` |
| `"11"` | `Gobierno y organismos internacionales` | `Administración pública y organismos internacionales y extraterritoriales.` |

(La `descripcion` NO se emite por ningún endpoint; sólo `nombre` vía `_SECTOR_NOMBRE_BY_CLAVE`.)

### `POSICIONES_DEFS` (4 posiciones, clave `int`)

| clave | nombre | descripcion |
|---|---|---|
| `1` | `Trabajadores subordinados y remunerados` | `Personas ocupadas que perciben remuneración por su trabajo bajo subordinación a un empleador (asalariados).` |
| `2` | `Empleadores` | `Personas que dirigen unidades económicas y emplean al menos a un trabajador remunerado.` |
| `3` | `Trabajadores por cuenta propia` | `Personas que explotan su propia empresa o ejercen un oficio sin emplear trabajadores remunerados.` |
| `4` | `Trabajadores no remunerados` | `Personas que prestan servicio sin recibir pago monetario (típicamente trabajadores familiares).` |

Derivados:

```python
_SECTOR_NOMBRE_BY_CLAVE: dict[str, str] = {s["clave"]: s["nombre"] for s in SECTORES_DEFS}
_POSICION_NOMBRE_BY_CLAVE: dict[int, str] = {p["clave"]: p["nombre"] for p in POSICIONES_DEFS}
_SECTOR_CLAVES_VALIDAS: set[str] = set(_SECTOR_NOMBRE_BY_CLAVE.keys())
_POSICION_CLAVES_VALIDAS: set[int] = set(_POSICION_NOMBRE_BY_CLAVE.keys())
```

Fallbacks de nombre: `f"(sector {clave})"` y `f"(posicion {clave})"`.

### Microdatos: `_MD_TABLA_META`, `_MD_COLUMNAS_CORE_SDEM`

Ver sección «Helpers compartidos (Sub-fase 3.6)». Literal `TablaMicrodatos = Literal["viv", "hog", "sdem", "coe1", "coe2"]` (schemas).

### `_MD_COLUMNA_DESCRIPCIONES` (schema)

Comentario (verbatim): `# Descripciones breves para columnas core (mostradas por /schema).` / `# El resto de columnas se reportan sin descripción — la documentación` / `# oficial INEGI (Reconstrucción de variables 2023) es la fuente canónica.`

```python
_MD_COLUMNA_DESCRIPCIONES: dict[str, str] = {
    "periodo":      "Trimestre 'YYYYTQ' (CHAR(6)). PK.",
    "cd_a":         "Cuestionario A. PK.",
    "ent":          "Entidad federativa, clave INEGI '01'..'32'. PK.",
    "con":          "Control. PK.",
    "v_sel":        "Vivienda seleccionada. PK.",
    "n_hog":        "Número de hogar dentro de la vivienda. PK en hog/sdem/coe1/coe2.",
    "n_ren":        "Número de renglón (persona) dentro del hogar. PK en sdem/coe1/coe2.",
    "sex":          "Sexo: 1=hombre, 2=mujer. NOT NULL en sdem.",
    "eda":          "Edad en años, 0-98 (98=98+).",
    "clase1":       "Clasificación principal: 1=PEA, 2=PNEA.",
    "clase2":       "Clasificación de ocupados/desocupados: 1=ocupado, 2=desocupado.",
    "pos_ocu":      "Posición en la ocupación (1=subordinados, 2=empleadores, 3=cuenta propia, 4=no remunerados).",
    "rama_est2":    "Sector económico SCIAN agregado 0..11.",
    "fac_tri":      "Factor de expansión trimestral. NOT NULL.",
    "extras_jsonb": "Columnas no-typed (resto del DBF), serializadas como JSON.",
    "etapa":        "Etapa metodológica ENUM: clasica | etoe_telefonica | enoe_n.",
}
```

### Patrones regex y literales de validación

| Uso | Literal |
|---|---|
| `_PERIODO_RE` (helpers 6-14) | `r"^(20\d{2})T([1-4])$"` |
| `periodo` en 15/16 (`Query(pattern=)`) | `r"^20\d{2}T[1-4]$"` |
| `entidad_clave` / `entidad` en 15/16 | `r"^(0[1-9]|[12][0-9]|3[0-2])$"` |
| `geo_clave` en `_resolve_geo_clave` | `re.fullmatch(r"[0-3][0-9]", geo_clave)` y `"01" <= geo_clave <= "32"` |
| `nivel` | `{"nacional", "entidad"}` |
| `orden` | `{"asc", "desc"}` |
| `etapa` | `{"clasica", "etoe_telefonica", "enoe_n"}` |
| sentinelas de rango | `"0000T1"`, `"9999T4"` |
| geo nacional | `"00"` |
| `limit` ranking | `ge=1, le=32`, default `5` |
| `pos_clave` | `ge=1, le=4` |
| `sex` | `ge=1, le=2` |
| `eda_min`/`eda_max` | `ge=0, le=98` |
| `page` | `ge=1`, default `1` |
| `per_page` | `ge=1, le=1000`, default `100` |

### Literales de texto de error (resumen, verbatim)

- `f"ENOE health check failed: {e!s}"`
- `f"'{arg_name}' debe ser 'YYYYTQ' (ej. '2025T1'); recibido: {periodo!r}"`
- `f"'etapa' debe ser una de: clasica, etoe_telefonica, enoe_n; recibido: {etapa!r}"`
- `f"indicador {slug!r} no existe. Slugs válidos: {valid}. Consultar GET /api/v1/enoe/catalogos/indicadores."`
- `f"'desde' ({desde}) debe ser <= 'hasta' ({hasta})"`
- `f"No hay datos para periodo={periodo!r} (cobertura: 2005T1-2025T1, gap 2020T2). Consultar GET /api/v1/enoe/health para últimos valores."`
- `f"entidad_clave {entidad_clave!r} no existe. Las claves válidas son '01'..'32' (AGEE INEGI). Consultar GET /api/v1/enoe/catalogos/entidades."` (endpoint 8)
- `f"No hay datos para periodo={periodo!r} indicador={indicador!r} (cobertura: 2005T1-2025T1, gap 2020T2)."` (9, 10)
- `f"'orden' debe ser 'asc' o 'desc'; recibido: {orden!r}"`
- `f"'nivel' debe ser 'nacional' o 'entidad'; recibido: {nivel!r}"`
- `"'geo_clave' es obligatorio cuando nivel='entidad' (claves '01'..'32')."`
- `f"'geo_clave' debe ser '01'..'32'; recibido: {geo_clave!r}"`
- `f"entidad_clave {geo_clave_eff!r} no existe. Las claves válidas son '01'..'32'. Consultar GET /api/v1/enoe/catalogos/entidades."` (11)
- `f"entidad_clave {geo_clave_eff!r} no existe. Consultar GET /api/v1/enoe/catalogos/entidades."` (12, 13, 14)
- `f"No hay datos para periodo={periodo!r} nivel={nivel!r} geo_clave={geo_clave_eff!r} (cobertura: 2005T1-2025T1, gap 2020T2)."` (11, 13)
- `f"sector_clave {sector_clave!r} no existe. Válidas: {valid}"` (valid = `0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11`)
- `f"pos_clave {pos_clave!r} no existe. Válidas: {valid}"` (valid = `1, 2, 3, 4`)
- `f"Los filtros 'sex', 'eda_min' y 'eda_max' solo aplican a tabla='sdem' (microdatos sociodemográficos). Tabla recibida: {tabla!r}. Quita esos filtros o cambia tabla a sdem."`
- `f"'eda_min' ({eda_min}) debe ser <= 'eda_max' ({eda_max})."`
- `"Parámetros 'entidad_clave' y 'entidad' enviados con valores distintos ({entidad_clave!r} vs {entidad!r}). Usar solo 'entidad_clave' (canónico); 'entidad' está deprecated."`
- Caveat count 2020T2: `"Periodo 2020T2 no tiene microdatos descargables (ETOE telefónica sustituyó al ENOE presencial por COVID-19; INEGI solo publicó agregados). Esperar total=0."`
- Caveat schema: `"Las columnas no listadas con descripción siguen los identificadores INEGI documentados en Reconstrucción de variables 2023 (https://www.inegi.org.mx/contenidos/programas/enoe/15ymas/doc/recons_var_15ymas.pdf). extras_jsonb contiene las columnas DBF que no se promovieron a typed."`
- Catálogo indicadores: `f"{c.titulo} ({c.slug}): {c.descripcion}"`; `"sin observaciones"`.
- Metadata cobertura: `f"{primer}-{ultimo} ({n} trimestres con datos; gap documental en 2020T2)"`.

### Constantes SQL (nombres, en orden de archivo)

`SQL_HEALTH`, `SQL_METADATA_AGREGADOS`, `SQL_METADATA_TABLAS`, `SQL_INDICADOR_COBERTURA`, `SQL_INDICADOR_COBERTURA_ENT`, `SQL_ENTIDADES`, `SQL_SERIE_NACIONAL`, `SQL_SNAPSHOT_NACIONAL`, `SQL_ENTIDAD_META`, `SQL_SERIE_ENTIDAD`, `SQL_SNAPSHOT_ENTIDAD`, `SQL_RANKING_DESC`, `SQL_RANKING_ASC`, `SQL_SNAPSHOT_SECTOR`, `SQL_SERIE_SECTOR`, `SQL_SNAPSHOT_POSICION`, `SQL_SERIE_POSICION`, `SQL_MD_SCHEMA_COLUMNAS`, `SQL_MD_SCHEMA_INDEXES`; más los f-strings `sql_data`/`sql_count` de 15/16 y el `text("SELECT total_filas, cobertura_temporal FROM enoe.estadisticas_globales WHERE tabla = :t")` inline de 17.

### Tabla de TODAS las tablas/vistas referenciadas

| Tabla (schema-qualified) | Tipo | Endpoints que la usan | Columnas referenciadas en SQL |
|---|---|---|---|
| `enoe.cargas` | agregada/operativa | 1 health, 2 metadata | `finalizado_en`, `status` |
| `enoe.estadisticas_globales` | agregada/pre-computada | 1 health, 2 metadata, 17 microdatos schema | `tabla`, `total_filas`, `es_microdatos`, `primer_periodo`, `ultimo_periodo`, `cobertura_temporal` |
| `enoe.indicadores_nacionales` | agregada | 2 metadata, 3 catálogo indicadores, 6 nacional/serie, 7 nacional/snapshot | `indicador`, `periodo`, `valor`, `unidad`, `etapa` |
| `enoe.indicadores_entidad` | agregada | 3 catálogo indicadores, 8 entidad/serie, 9 entidad/snapshot, 10 entidad/ranking | `indicador`, `entidad_clave`, `periodo`, `valor`, `etapa` |
| `enoe.cat_entidad` | catálogo | 2 metadata (count), 4 catálogo entidades, 8, 9, 10, 11–14 (sólo con `nivel='entidad'`) | `clave`, `nombre`, `abreviatura` |
| `enoe.poblacion_ocupada_por_sector` | agregada | 11 por-sector/snapshot, 12 por-sector/serie | `periodo`, `nivel`, `geo_clave`, `sector_clave`, `total_personas`, `pct_ocupados`, `etapa` |
| `enoe.poblacion_ocupada_por_posicion` | agregada | 13 por-posicion/snapshot, 14 por-posicion/serie | `periodo`, `nivel`, `geo_clave`, `pos_clave`, `total_personas`, `pct_ocupados`, `etapa` |
| `enoe.microdatos_viv` | **MICRODATOS** | 15 list, 16 count (con `tabla=viv`); 17 schema (sólo catálogo) | `periodo`, `ent`, PK `(periodo, cd_a, ent, con, v_sel)`, `*` |
| `enoe.microdatos_hog` | **MICRODATOS** | 15, 16 (`tabla=hog`); 17 (catálogo) | `periodo`, `ent`, PK `(periodo, cd_a, ent, con, v_sel, n_hog)`, `*` |
| `enoe.microdatos_sdem` | **MICRODATOS** | 15, 16 (`tabla=sdem`); 17 (catálogo) | `periodo`, `ent`, `sex`, `eda`, PK `(periodo, cd_a, ent, con, v_sel, n_hog, n_ren)`, `*` o `_MD_COLUMNAS_CORE_SDEM` |
| `enoe.microdatos_coe1` | **MICRODATOS** | 15, 16 (`tabla=coe1`); 17 (catálogo) | `periodo`, `ent`, PK `(periodo, cd_a, ent, con, v_sel, n_hog, n_ren)`, `*` |
| `enoe.microdatos_coe2` | **MICRODATOS** | 15, 16 (`tabla=coe2`); 17 (catálogo) | `periodo`, `ent`, PK `(periodo, cd_a, ent, con, v_sel, n_hog, n_ren)`, `*` |
| `information_schema.columns` | catálogo del sistema | 17 | `column_name`, `data_type`, `character_maximum_length`, `is_nullable`, `ordinal_position`, `table_schema`, `table_name` |
| `pg_index` (pg_catalog) | catálogo del sistema | 17 | `indexrelid`, `indrelid`, `indisprimary` |
| `pg_class` (pg_catalog) | catálogo del sistema | 17 | `oid`, `relname`, `relnamespace` |
| `pg_namespace` (pg_catalog) | catálogo del sistema | 17 | `oid`, `nspname` |

Mencionados sólo en comentarios/descripciones (no ejecutados): función `enoe.refresh_estadisticas_globales()`; ENUM `enoe.etapa_metodologica`; índices `idx_enoe_{viv,hog,sdem,coe1,coe2}_periodo_ent`; tablas `enoe.indicadores_area_metropolitana` y `enoe.indicadores_anuales_ampliado` (aparecen en `_TABLA_DESCRIPCIONES` para metadata pero ningún SQL las consulta directamente — sus counts salen de `enoe.estadisticas_globales`); `enigh.cat_entidad` (mencionada en la descripción de 4).

Endpoints que dependen de tablas de microdatos (`enoe.microdatos_*`): **15** `/microdatos/{tabla}/list` y **16** `/microdatos/{tabla}/count` (lectura de filas). **17** `/microdatos/{tabla}/schema` sólo consulta metadatos del catálogo del sistema sobre esas tablas y `enoe.estadisticas_globales`. Los endpoints 1-14 sólo tocan tablas agregadas/catálogos.

# Contrato legacy — router CONSAR (`/api/v1/consar`)

Documento de paridad del router FastAPI heredado, para reimplementación en otro stack.

- Fuente: `api/app/routers/consar.py` del repositorio legacy `datos-itam` (3167 líneas) y `api/app/schemas/consar.py` (719 líneas).
- Versiones pineadas en `uv.lock`: `fastapi 0.136.0`, `pydantic 2.13.3` (kwargs no declarados en un `BaseModel` se IGNORAN silenciosamente; ver nota en `/pea-cotizantes/serie`).
- Router: `APIRouter(prefix="/api/v1/consar", tags=["consar"])`. Todos los endpoints son `GET`, públicos (sin `require_admin`), con rate limit vía `slowapi` (`@limiter.limit("<n>/minute")`, se indica por endpoint).
- Todos los endpoints declaran el mismo bloque `responses` para OpenAPI:
  - `200`: `{"content": {"application/json": {"example": _CONSAR_GENERIC_EXAMPLE}}}`
  - `429`: `_RESP_429_CONSAR = {"model": HTTPError429, "description": "Rate limit excedido."}`
- Acceso a BD: `async with engine.connect() as conn` (SQLAlchemy async) + `text(SQL)`; los parámetros se enlazan por nombre (`:nombre`) con un `dict`. Los resultados se leen con `.mappings().all()` (o `.one()` / `.one_or_none()` donde se indica).
- Docstring del módulo (verbatim):

```
Public REST endpoints for CONSAR AFORE monthly resources registry.

Dataset: monto_recursos_registrados_afore (datos.gob.mx — CC-BY-4.0)
  Cobertura: 1998-05-01 → 2025-06-01 (326 meses × 11 AFOREs)
  35,617 filas (consar.recursos_mensuales)
  MD5 CSV fuente: 19083c9a46d9d958b1428056c2f5f0b1

Principios heredados S7/S8:
  - Todos los endpoints públicos (sin require_admin)
  - Rate limiting vía slowapi
  - Caveats metodológicos en cada response donde aplique
```

Los `summary` / `description` de los decoradores se transcriben ya concatenados (en el código son literales adyacentes de Python). Ningún modelo Pydantic declara `Field(description=...)`: las "descripciones" de campos que aparecen abajo son los comentarios `#` que acompañan al campo en `schemas/consar.py`.

## Helpers compartidos

### `_parse_fecha(fecha_str: str) -> date`

```python
def _parse_fecha(fecha_str: str) -> date:
    """Acepta 'YYYY-MM' o 'YYYY-MM-01'. Retorna date(YYYY,MM,1).
    HTTP 422 si no es un mes válido."""
    try:
        if len(fecha_str) == 7:  # YYYY-MM
            fecha_str = fecha_str + "-01"
        d = date.fromisoformat(fecha_str)
        if d.day != 1:
            raise ValueError("fecha debe ser día 1 del mes (YYYY-MM o YYYY-MM-01)")
        return d
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"fecha inválida: {e}")
```

Comportamiento exacto:
- Si `len == 7` se agrega `"-01"`; cualquier otra longitud se pasa tal cual a `date.fromisoformat` (que en Python ≥3.11 también acepta `YYYYMMDD`, semanas ISO, etc.).
- Día distinto de 1 → `422` con `detail = "fecha inválida: fecha debe ser día 1 del mes (YYYY-MM o YYYY-MM-01)"`.
- Cadena no ISO → `422` con `detail = "fecha inválida: Invalid isoformat string: '<valor>'"` (mensaje de `ValueError` de CPython).
- Mes fuera de rango → `422` con `detail = "fecha inválida: month must be in 1..12"`.

### `_parse_fecha_dia(fecha_str: str) -> date`

```python
def _parse_fecha_dia(fecha_str: str) -> date:
    """Acepta 'YYYY-MM-DD'. Para datasets de granularidad diaria (#01 precio_bolsa).
    HTTP 422 si formato inválido."""
    try:
        return date.fromisoformat(fecha_str)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"fecha inválida (esperado YYYY-MM-DD): {e}")
```

### Modelo compartido `SerieRango`

```
SerieRango
  desde: date
  hasta: date
```

---

## 1. `GET /api/v1/consar/afores`

- Rate limit: `60/minute`
- `summary`: `Catálogo de las 11 AFOREs`
- `description`: `Lista todas las AFOREs del sistema mexicano de ahorro para el retiro, ordenadas por tamaño (recursos registrados en SAR a 2025-06-01). Incluye fecha_alta_serie (primer mes con datos no-nulos en el CSV oficial).`

### Parámetros

Ninguno.

### SQL (`SQL_AFORES`, sin parámetros)

```sql
SELECT id, codigo, nombre_corto, nombre_csv, tipo_pension,
       fecha_alta_serie, activa, orden_display
FROM consar.afores
ORDER BY orden_display
```

### Post-procesamiento

Ninguno. `count = len(rows)`; cada fila se pasa tal cual a `AforeRow(**dict(r))`; `source = SOURCE_CONSAR`.

### Response model: `AforesResponse`

```
AforesResponse
  count: int
  afores: list[AforeRow]
  source: str                       # = SOURCE_CONSAR

AforeRow
  id: int
  codigo: str
  nombre_corto: str
  nombre_csv: str
  tipo_pension: str                 # privada|publica|bienestar
  fecha_alta_serie: date
  activa: bool
  orden_display: int
```

### Errores

Ninguno explícito (solo 429 por rate limit).

---

## 2. `GET /api/v1/consar/tipos-recurso`

- Rate limit: `60/minute`
- `summary`: `Catálogo de los 15 conceptos de recurso`
- `description`: `Lista los 15 tipos de recurso reportados mensualmente por CONSAR. Categoría: component (atómico), aggregate (suma de components), total (agregado AFORE/sistema), operativo (capital propio de la AFORE).`

### Parámetros

Ninguno.

### SQL (`SQL_TIPOS_RECURSO`, sin parámetros)

```sql
SELECT id, codigo, columna_csv, nombre_corto, nombre_oficial,
       descripcion, categoria, es_total_sar, orden_display
FROM consar.tipos_recurso
ORDER BY orden_display
```

### Post-procesamiento

Ninguno. `count = len(rows)`; `TipoRecursoRow(**dict(r))`. No lleva `source`.

### Response model: `TiposRecursoResponse`

```
TiposRecursoResponse
  count: int
  tipos_recurso: list[TipoRecursoRow]

TipoRecursoRow
  id: int
  codigo: str
  columna_csv: str
  nombre_corto: str
  nombre_oficial: str
  descripcion: Optional[str]
  categoria: str                    # component|aggregate|total|operativo
  es_total_sar: bool
  orden_display: int
```

### Errores

Ninguno explícito.

---

## 3. `GET /api/v1/consar/recursos/totales`

- Rate limit: `30/minute`
- `summary`: `Serie temporal: recursos totales registrados en el SAR (nacional)`
- `description`: `Retorna los 326 puntos mensuales de la serie de recursos totales registrados en el SAR a nivel sistema (suma sobre todas las AFOREs). Cobertura 1998-05-01 a 2025-06-01.`

### Parámetros

Ninguno.

### SQL (`SQL_TOTALES`, sin parámetros)

```sql
SELECT
    rm.fecha,
    SUM(rm.monto_mxn_mm)::float AS monto_mxn_mm,
    COUNT(DISTINCT rm.afore_id)::int AS n_afores
FROM consar.recursos_mensuales rm
JOIN consar.tipos_recurso tr ON tr.id = rm.tipo_recurso_id
WHERE tr.codigo = 'sar_total'
GROUP BY rm.fecha
ORDER BY rm.fecha
```

### Post-procesamiento

- `unit = "millones de pesos MXN corrientes"`
- `n_puntos = len(rows)`; `fecha_min = rows[0]["fecha"]`; `fecha_max = rows[-1]["fecha"]`.
- `serie = [TotalSarPunto(**dict(r))]` — SIN redondeo (`monto_mxn_mm` es el `::float` crudo).
- `caveats = [CAVEAT_UNIDAD, CAVEAT_PENSION_BIENESTAR]`
- `source = SOURCE_CONSAR`

### Response model: `TotalesSarResponse`

```
TotalesSarResponse
  unit: str
  n_puntos: int
  fecha_min: date
  fecha_max: date
  serie: list[TotalSarPunto]
  caveats: list[str]
  source: str

TotalSarPunto
  fecha: date
  monto_mxn_mm: float
  n_afores: int                     # cuántas AFOREs reportaron ese mes
```

### Errores

- `500` — `detail = "no hay datos en consar.recursos_mensuales"` si la consulta no devuelve filas.

---

## 4. `GET /api/v1/consar/recursos/por-afore`

- Rate limit: `30/minute`
- `summary`: `Snapshot mensual: recursos por AFORE en una fecha específica`
- `description`: `Retorna para la fecha indicada (YYYY-MM o YYYY-MM-01) los recursos totales SAR, recursos de los trabajadores y recursos administrados por cada una de las 11 AFOREs. Incluye % del sistema.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `fecha` | `str` | — | sí | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01 (ej. 2025-06 o 2025-06-01)` |

### SQL (`SQL_POR_AFORE`; binding `{"fecha": d}` con `d: date`)

```sql
WITH snapshot AS (
    SELECT
        a.codigo AS afore_codigo,
        a.nombre_corto AS afore_nombre_corto,
        a.orden_display,
        MAX(CASE WHEN tr.codigo = 'sar_total'              THEN rm.monto_mxn_mm END)::float AS sar_total_mm,
        MAX(CASE WHEN tr.codigo = 'recursos_trabajadores'  THEN rm.monto_mxn_mm END)::float AS recursos_trabajadores_mm,
        MAX(CASE WHEN tr.codigo = 'recursos_administrados' THEN rm.monto_mxn_mm END)::float AS recursos_administrados_mm
    FROM consar.afores a
    LEFT JOIN consar.recursos_mensuales rm ON rm.afore_id = a.id AND rm.fecha = :fecha
    LEFT JOIN consar.tipos_recurso tr      ON tr.id = rm.tipo_recurso_id
    GROUP BY a.codigo, a.nombre_corto, a.orden_display
)
SELECT * FROM snapshot ORDER BY orden_display
```

Nota: por el `LEFT JOIN`, SIEMPRE se devuelven las 11 AFOREs (con montos `NULL` si no reportan en esa fecha), ordenadas por `orden_display`.

### Post-procesamiento

```python
total_sistema = sum((r["sar_total_mm"] or 0.0) for r in rows)
if total_sistema == 0: raise 404
snaps = []; n_reportando = 0
for r in rows:
    sar = r["sar_total_mm"]
    pct = (100.0 * sar / total_sistema) if (sar and total_sistema) else None
    if sar is not None and sar > 0:
        n_reportando += 1
    snaps.append(AforeSnapshotRow(
        afore_codigo=r["afore_codigo"],
        afore_nombre_corto=r["afore_nombre_corto"],
        sar_total_mm=sar,                                        # crudo, sin redondeo
        recursos_trabajadores_mm=r["recursos_trabajadores_mm"],  # crudo
        recursos_administrados_mm=r["recursos_administrados_mm"],# crudo
        pct_sistema=round(pct, 3) if pct is not None else None,
    ))
```

- `pct_sistema` es `None` cuando `sar` es `None` **o** `0.0` (truthiness).
- `total_sistema_mm = round(total_sistema, 2)`; `n_afores_reportando = n_reportando`.
- `unit = "millones de pesos MXN corrientes"`; `caveats = [CAVEAT_UNIDAD, CAVEAT_PENSION_BIENESTAR]`.
- Orden de `afores`: el del SQL (`orden_display`).

### Response model: `PorAforeResponse`

```
PorAforeResponse
  fecha: date
  unit: str
  total_sistema_mm: float
  n_afores_reportando: int
  afores: list[AforeSnapshotRow]
  caveats: list[str]

AforeSnapshotRow
  afore_codigo: str
  afore_nombre_corto: str
  sar_total_mm: Optional[float]
  recursos_trabajadores_mm: Optional[float]
  recursos_administrados_mm: Optional[float]
  pct_sistema: Optional[float]      # % del SAR nacional ese mes
```

### Errores

- `422` — `_parse_fecha`.
- `404` — `detail = f"No hay datos para fecha={d.isoformat()} (cobertura: 1998-05 a 2025-06)"` cuando `total_sistema == 0`.

---

## 5. `GET /api/v1/consar/recursos/por-componente`

- Rate limit: `30/minute`
- `summary`: `Snapshot mensual: desglose por tipo de recurso (nacional)`
- `description`: `Retorna para la fecha indicada (YYYY-MM) el monto agregado a nivel sistema para cada uno de los 15 tipos de recurso. Incluye % respecto al sar_total donde sea informativo (components y aggregates).`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `fecha` | `str` | — | sí | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01` |

### SQL (`SQL_POR_COMPONENTE`; binding `{"fecha": d}`)

```sql
SELECT
    tr.codigo AS tipo_codigo,
    tr.nombre_corto AS tipo_nombre_corto,
    tr.categoria,
    tr.orden_display,
    SUM(rm.monto_mxn_mm)::float AS monto_mxn_mm
FROM consar.tipos_recurso tr
LEFT JOIN consar.recursos_mensuales rm ON rm.tipo_recurso_id = tr.id AND rm.fecha = :fecha
GROUP BY tr.codigo, tr.nombre_corto, tr.categoria, tr.orden_display
ORDER BY tr.orden_display
```

### Post-procesamiento

```python
sar_total_row = next((r for r in rows if r["tipo_codigo"] == "sar_total"), None)
sar_total = (sar_total_row["monto_mxn_mm"] if sar_total_row else None) or 0.0
if sar_total == 0: raise 404
comps = []; n_con_dato = 0
for r in rows:
    monto = r["monto_mxn_mm"]
    if monto is None:
        continue                      # filas sin dato se OMITEN del listado
    n_con_dato += 1
    pct = None
    if r["categoria"] in ("component", "aggregate") and sar_total > 0:
        pct = round(100.0 * monto / sar_total, 3)
    comps.append(ComponenteSnapshotRow(
        tipo_codigo=r["tipo_codigo"],
        tipo_nombre_corto=r["tipo_nombre_corto"],
        categoria=r["categoria"],
        monto_mxn_mm=round(monto, 2),
        pct_del_sar_total=pct,        # None para categoria total/operativo
    ))
```

- `unit = "millones de pesos MXN corrientes"`; `sar_total_mm = round(sar_total, 2)`; `n_componentes = n_con_dato`.
- `caveats = [CAVEAT_UNIDAD, CAVEAT_FONDOS_PREV, CAVEAT_BANXICO, CAVEAT_BONO_ISSSTE]`.
- Orden: `orden_display` de `tipos_recurso`.

### Response model: `PorComponenteResponse`

```
PorComponenteResponse
  fecha: date
  unit: str
  sar_total_mm: float
  n_componentes: int
  componentes: list[ComponenteSnapshotRow]
  caveats: list[str]

ComponenteSnapshotRow
  tipo_codigo: str
  tipo_nombre_corto: str
  categoria: str
  monto_mxn_mm: float
  pct_del_sar_total: Optional[float]
```

### Errores

- `422` — `_parse_fecha`.
- `404` — `detail = f"No hay datos para fecha={d.isoformat()} (cobertura: 1998-05 a 2025-06)"`.

---

## 6. `GET /api/v1/consar/recursos/imss-vs-issste`

- Rate limit: `30/minute`
- `summary`: `Serie temporal: RCV-IMSS vs RCV-ISSSTE (privado vs público)`
- `description`: `Retorna la serie mensual agregada a nivel sistema de RCV-IMSS (trabajadores del sector privado afiliados al IMSS) y RCV-ISSSTE (trabajadores del sector público). RCV-ISSSTE reportado desde ~2008 con la reforma ISSSTE.`

### Parámetros

Ninguno.

### SQL (`SQL_IMSS_VS_ISSSTE`, sin parámetros)

```sql
SELECT
    rm.fecha,
    SUM(CASE WHEN tr.codigo = 'rcv_imss'   THEN rm.monto_mxn_mm ELSE 0 END)::float AS rcv_imss_mm,
    SUM(CASE WHEN tr.codigo = 'rcv_issste' THEN rm.monto_mxn_mm ELSE 0 END)::float AS rcv_issste_mm
FROM consar.recursos_mensuales rm
JOIN consar.tipos_recurso tr ON tr.id = rm.tipo_recurso_id
WHERE tr.codigo IN ('rcv_imss', 'rcv_issste')
GROUP BY rm.fecha
ORDER BY rm.fecha
```

### Post-procesamiento

```python
for r in rows:
    imss = r["rcv_imss_mm"] or None      # 0.0 → None
    issste = r["rcv_issste_mm"] or None  # 0.0 → None
    ratio = None
    if imss and issste and imss > 0:
        ratio = round(issste / imss, 4)
    serie.append(ImssVsIsssteePunto(
        fecha=r["fecha"],
        rcv_imss_mm=round(imss, 2) if imss else None,
        rcv_issste_mm=round(issste, 2) if issste else None,
        ratio_issste_sobre_imss=ratio,
    ))
```

- `unit = "millones de pesos MXN corrientes"`; `n_puntos = len(serie)`.
- `caveats` (3, en este orden):
  1. `CAVEAT_UNIDAD`
  2. `RCV-ISSSTE reportado de forma consistente desde 2008-12 con la reforma ISSSTE; puntos anteriores pueden mostrar cero.`
  3. `RCV-IMSS cubre trabajadores privados afiliados al IMSS; RCV-ISSSTE cubre trabajadores públicos. PensionISSSTE es la AFORE pública pero todas las AFOREs manejan ambos tipos de cuenta.`
- Sin `source`. Sin 404/500 (lista vacía → `n_puntos = 0`).

### Response model: `ImssVsIsssteeResponse`

```
ImssVsIsssteeResponse
  unit: str
  n_puntos: int
  serie: list[ImssVsIsssteePunto]
  caveats: list[str]

ImssVsIsssteePunto
  fecha: date
  rcv_imss_mm: Optional[float]
  rcv_issste_mm: Optional[float]
  ratio_issste_sobre_imss: Optional[float]
```

### Errores

Ninguno explícito.

---

## 7. `GET /api/v1/consar/recursos/composicion`

- Rate limit: `30/minute`
- `summary`: `Desglose contable del SAR: 8 componentes vs total reportado`
- `description`: `Para la fecha indicada, retorna los 8 componentes de la identidad sar_total (verificada empíricamente al peso en 98.83% de filas y 100% de filas 2020+). Incluye delta vs total reportado para transparencia sobre el residuo histórico.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `fecha` | `str` | — | sí | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01` |

### SQL

Query 1 — `SQL_COMPOSICION`; binding `{"fecha": d, "codigos": list(COMPONENTES_IDENTIDAD)}` (lista Python enlazada como arreglo `text[]` para `ANY`):

```sql
SELECT
    tr.codigo AS tipo_codigo,
    tr.nombre_corto AS tipo_nombre_corto,
    tr.orden_display,
    SUM(rm.monto_mxn_mm)::float AS monto_mxn_mm
FROM consar.tipos_recurso tr
LEFT JOIN consar.recursos_mensuales rm ON rm.tipo_recurso_id = tr.id AND rm.fecha = :fecha
WHERE tr.codigo = ANY(:codigos)
GROUP BY tr.codigo, tr.nombre_corto, tr.orden_display
ORDER BY tr.orden_display
```

Query 2 — `SQL_SAR_TOTAL_AT`; binding `{"fecha": d}`; se lee con `.mappings().one()`:

```sql
SELECT SUM(rm.monto_mxn_mm)::float AS sar_total
FROM consar.recursos_mensuales rm
JOIN consar.tipos_recurso tr ON tr.id = rm.tipo_recurso_id
WHERE tr.codigo = 'sar_total' AND rm.fecha = :fecha
```

Ambas se ejecutan en la misma conexión, en ese orden.

### Post-procesamiento

```python
sar_total = sar_row["sar_total"]
if sar_total is None or sar_total == 0: raise 404
items = []; suma = 0.0
for r in rows:                           # orden: tr.orden_display (NO el de COMPONENTES_IDENTIDAD)
    monto = r["monto_mxn_mm"] or 0.0     # NULL → 0.0 (la fila SÍ se incluye)
    suma += monto
    items.append(ComposicionItem(
        tipo_codigo=r["tipo_codigo"],
        tipo_nombre_corto=r["tipo_nombre_corto"],
        monto_mxn_mm=round(monto, 2),
        pct_del_sar=round(100.0 * monto / sar_total, 3) if sar_total > 0 else 0.0,
    ))
delta_abs = sar_total - suma             # suma de montos crudos (no redondeados)
delta_pct = (100.0 * delta_abs / sar_total) if sar_total > 0 else 0.0
cierre_al_peso = abs(delta_abs) <= 0.05
```

Campos de salida:
- `unit = "millones de pesos MXN corrientes"`
- `sar_total_reportado_mm = round(sar_total, 2)`
- `suma_8_componentes_mm = round(suma, 2)`
- `delta_abs_mm = round(delta_abs, 2)`
- `delta_pct = round(delta_pct, 4)`
- `cierre_al_peso` (umbral `0.05`)
- `caveats = [CAVEAT_UNIDAD, CAVEAT_FONDOS_PREV, CAVEAT_BANXICO, CAVEAT_BONO_ISSSTE, CAVEAT_AHORRO_PRE_DESAGREGACION]`
- `identidad_caveat = CAVEAT_IDENTIDAD_SAR`

### Response model: `ComposicionResponse`

```
ComposicionResponse
  fecha: date
  unit: str
  sar_total_reportado_mm: float
  suma_8_componentes_mm: float
  delta_abs_mm: float
  delta_pct: float
  cierre_al_peso: bool
  componentes: list[ComposicionItem]
  caveats: list[str]
  identidad_caveat: str

ComposicionItem
  tipo_codigo: str
  tipo_nombre_corto: str
  monto_mxn_mm: float
  pct_del_sar: float
```

### Errores

- `422` — `_parse_fecha`.
- `404` — `detail = f"No hay datos para fecha={d.isoformat()} (cobertura: 1998-05 a 2025-06)"` si `sar_total` es `None` o `0`.

---

## 8. `GET /api/v1/consar/recursos/serie`

- Rate limit: `30/minute`
- `summary`: `Serie temporal por tipo de recurso (opcionalmente filtrada por AFORE)`
- `description`: ``Retorna la serie mensual agregada del tipo de recurso indicado. Si `afore_codigo` se omite, suma todas las AFOREs (nacional). Parámetros `desde`/`hasta` aceptan YYYY-MM o YYYY-MM-01; default a la cobertura completa 1998-05 / 2025-06.``

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `codigo` | `str` | — | sí | debe existir en `consar.tipos_recurso` (404) | `Código del tipo_recurso (p. ej. 'vivienda', 'rcv_imss', 'sar_total')` |
| `afore_codigo` | `Optional[str]` | `None` | no | si se da, debe existir en `consar.afores` (404) | `Código AFORE opcional (p. ej. 'pension_bienestar'); si se omite, suma nacional` |
| `desde` | `Optional[str]` | `None` → `date(1998, 5, 1)` | no | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01 (default 1998-05)` |
| `hasta` | `Optional[str]` | `None` → `date(2025, 6, 1)` | no | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01 (default 2025-06)` |

Orden de validación: parse `desde` → parse `hasta` → `desde > hasta` (422) → existencia de `codigo` (404) → existencia de `afore_codigo` (404) → serie.

### SQL

Query 1 — `SQL_TIPO_META`; binding `{"codigo": codigo}`; `.one_or_none()`:

```sql
SELECT codigo, nombre_corto, nombre_oficial, categoria
FROM consar.tipos_recurso
WHERE codigo = :codigo
```

Query 2 (solo si `afore_codigo is not None`) — `SQL_AFORE_META`; binding `{"codigo": afore_codigo}`; `.one_or_none()`:

```sql
SELECT codigo, nombre_corto, tipo_pension
FROM consar.afores
WHERE codigo = :codigo
```

Query 3 — `SQL_SERIE`; binding `{"codigo": codigo, "afore_codigo": afore_codigo, "desde": d_desde, "hasta": d_hasta}` (`afore_codigo` puede ser `None`):

```sql
SELECT rm.fecha,
       SUM(rm.monto_mxn_mm)::float AS monto_mxn_mm
FROM consar.recursos_mensuales rm
JOIN consar.tipos_recurso tr ON tr.id = rm.tipo_recurso_id
JOIN consar.afores a         ON a.id = rm.afore_id
WHERE tr.codigo = :codigo
  AND (CAST(:afore_codigo AS text) IS NULL OR a.codigo = :afore_codigo)
  AND rm.fecha >= :desde
  AND rm.fecha <= :hasta
GROUP BY rm.fecha
ORDER BY rm.fecha
```

### Post-procesamiento

Caveats dinámicos (en este orden de evaluación, se anexan los que apliquen):

```python
caveats = [CAVEAT_UNIDAD]
if afore_codigo == "pension_bienestar":
    caveats.append(CAVEAT_PENSION_BIENESTAR)
if codigo == "fondos_prevision_social":
    caveats.append(CAVEAT_FONDOS_PREV)
if codigo == "banxico":
    caveats.append(CAVEAT_BANXICO)
if codigo == "bono_pension_issste":
    caveats.append(CAVEAT_BONO_ISSSTE)
if codigo == "rcv_issste":
    caveats.append("RCV-ISSSTE reportado de forma consistente desde 2008-12 con la reforma ISSSTE.")
if codigo in ("ahorro_voluntario", "ahorro_solidario", "ahorro_voluntario_y_solidario"):
    caveats.append(CAVEAT_AHORRO_PRE_DESAGREGACION)
```

- `tipo_recurso = SerieTipoRecursoRef(**tipo_row)`; `afore = SerieAforeRef(**afore_row)` o `None`.
- `unit = "millones de pesos MXN corrientes"`; `n_puntos = len(serie_rows)`.
- `rango = SerieRango(desde=d_desde, hasta=d_hasta)` — es el rango SOLICITADO/por defecto, no el observado en datos.
- `serie = [SeriePunto(fecha=r["fecha"], monto_mxn_mm=round(r["monto_mxn_mm"], 2))]`.
- Una serie vacía NO produce 404 (`n_puntos = 0`, `serie = []`).

### Response model: `SerieResponse`

```
SerieResponse
  tipo_recurso: SerieTipoRecursoRef
  afore: Optional[SerieAforeRef]    # None → suma nacional sobre todas las AFOREs
  unit: str
  n_puntos: int
  rango: SerieRango
  serie: list[SeriePunto]
  caveats: list[str]

SerieTipoRecursoRef
  codigo: str
  nombre_corto: str
  nombre_oficial: str
  categoria: str

SerieAforeRef
  codigo: str
  nombre_corto: str
  tipo_pension: str

SeriePunto
  fecha: date
  monto_mxn_mm: float
```

### Errores

- `422` — `_parse_fecha` en `desde`/`hasta`.
- `422` — `detail = "'desde' debe ser <= 'hasta'"`.
- `404` — `detail = f"tipo_recurso '{codigo}' no existe"`.
- `404` — `detail = f"afore '{afore_codigo}' no existe"`.

---

## 9. `GET /api/v1/consar/comisiones/serie`

- Rate limit: `30/minute`
- `summary`: `Serie temporal: comisión cobrada por AFORE (% anual sobre saldo)`
- `description`: ``Retorna la serie mensual de comisiones cobradas por una AFORE específica (o todas si se omite `afore_codigo`). Comisión expresada como porcentaje anual sobre saldo administrado (e.g. 1.96 = 1.96%). Cobertura 2008-03-01 → 2025-06-01.``

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `afore_codigo` | `Optional[str]` | `None` | no | si se da, debe existir (404) | `Código AFORE opcional (e.g. 'profuturo')` |
| `desde` | `Optional[str]` | `None` → `date(2008, 3, 1)` | no | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01 (default 2008-03)` |
| `hasta` | `Optional[str]` | `None` → `date(2025, 6, 1)` | no | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01 (default 2025-06)` |

### SQL

Query 1 (solo si `afore_codigo is not None`) — `SQL_COMISION_AFORE_META`; binding `{"codigo": afore_codigo}`; `.one_or_none()`:

```sql
SELECT codigo, nombre_corto, tipo_pension
FROM consar.afores
WHERE codigo = :codigo
```

Query 2 — `SQL_COMISION_SERIE`; binding `{"afore_codigo": afore_codigo, "desde": d_desde, "hasta": d_hasta}`:

```sql
SELECT c.fecha,
       c.comision::float AS comision_pct
FROM consar.comisiones c
JOIN consar.afores a ON a.id = c.afore_id
WHERE (CAST(:afore_codigo AS text) IS NULL OR a.codigo = :afore_codigo)
  AND c.fecha >= :desde
  AND c.fecha <= :hasta
ORDER BY c.fecha, a.orden_display
```

IMPORTANTE: sin `afore_codigo` NO hay agregación: la serie contiene una fila por (fecha × AFORE), ordenada por `fecha` y luego `orden_display`, sin identificar la AFORE en cada punto.

### Post-procesamiento

- `afore = ComisionAforeRef(**afore_row)` o `None`.
- `unit = "porcentaje anual sobre saldo administrado"`.
- `n_puntos = len(serie_rows)`; `rango = SerieRango(desde=d_desde, hasta=d_hasta)` (solicitado).
- `serie = [ComisionPunto(fecha=r["fecha"], comision_pct=round(r["comision_pct"], 4))]`.
- `caveats = [CAVEAT_COMISION_REFORMA, CAVEAT_COMISION_BIENESTAR]`.
- Serie vacía no produce 404. `SOURCE_COMISIONES` está definido pero NO se incluye en la respuesta.

### Response model: `ComisionSerieResponse`

```
ComisionSerieResponse
  afore: Optional[ComisionAforeRef] # None → comparativo de todas las afores
  unit: str
  n_puntos: int
  rango: SerieRango
  serie: list[ComisionPunto]
  caveats: list[str]

ComisionAforeRef
  codigo: str
  nombre_corto: str
  tipo_pension: str

ComisionPunto
  fecha: date
  comision_pct: float               # porcentaje anual (e.g. 1.96 = 1.96%)
```

### Errores

- `422` — `_parse_fecha`; `422` — `detail = "'desde' debe ser <= 'hasta'"`.
- `404` — `detail = f"afore '{afore_codigo}' no existe"`.

---

## 10. `GET /api/v1/consar/comisiones/snapshot`

- Rate limit: `30/minute`
- `summary`: `Snapshot mensual: comisión cobrada por cada AFORE en una fecha específica`
- `description`: `Retorna para la fecha indicada (YYYY-MM o YYYY-MM-01) la comisión cobrada por cada una de las 10 AFOREs reportantes. Incluye promedio simple, mínima y máxima del sistema. Pensión Bienestar excluida (régimen sin comisión sobre saldo).`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `fecha` | `str` | — | sí | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01 (cobertura 2008-03 a 2025-06)` |

### SQL (`SQL_COMISION_SNAPSHOT`; binding `{"fecha": d}`)

```sql
SELECT a.codigo AS afore_codigo,
       a.nombre_corto AS afore_nombre_corto,
       a.tipo_pension,
       a.orden_display,
       c.comision::float AS comision_pct
FROM consar.afores a
LEFT JOIN consar.comisiones c
       ON c.afore_id = a.id AND c.fecha = :fecha
WHERE a.codigo <> 'pension_bienestar'  -- no reporta comisión por construcción
ORDER BY a.orden_display
```

### Post-procesamiento

```python
reporting = [r for r in rows if r["comision_pct"] is not None]
if not reporting: raise 404
valores = [r["comision_pct"] for r in reporting]
promedio = sum(valores) / len(valores)
```

- `unit = "porcentaje anual sobre saldo administrado"`
- `n_afores_reportando = len(reporting)`
- `promedio_simple_pct = round(promedio, 4)`; `minima_pct = round(min(valores), 4)`; `maxima_pct = round(max(valores), 4)`
- `afores`: TODAS las filas del SQL (10, incluye las que tienen `NULL`), con `comision_pct = round(v, 4) if v is not None else None`.
- `caveats = [CAVEAT_COMISION_REFORMA, CAVEAT_COMISION_BIENESTAR]`.

### Response model: `ComisionSnapshotResponse`

```
ComisionSnapshotResponse
  fecha: date
  unit: str
  n_afores_reportando: int
  promedio_simple_pct: float
  minima_pct: float
  maxima_pct: float
  afores: list[ComisionSnapshotRow]
  caveats: list[str]

ComisionSnapshotRow
  afore_codigo: str
  afore_nombre_corto: str
  tipo_pension: str
  comision_pct: Optional[float]     # None si la AFORE aún no había arrancado en esa fecha
```

### Errores

- `422` — `_parse_fecha`.
- `404` — `detail = f"No hay datos para fecha={d.isoformat()} (cobertura: 2008-03 a 2025-06)"`.

---

## 11. `GET /api/v1/consar/flujos/serie`

- Rate limit: `30/minute`
- `summary`: `Serie temporal: entradas/salidas mensuales por AFORE (o sistema)`
- `description`: ``Retorna serie mensual de aportaciones brutas (`montos_entradas`) y retiros (`montos_salidas`) en mm MXN corrientes. Si `afore_codigo` se omite, suma sobre todas las AFOREs reportantes (sistema). Cobertura 2009-01-01 → 2025-06-01. `flujo_neto = montos_entradas - montos_salidas` (positivo = AFORE captando neto).``

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `afore_codigo` | `Optional[str]` | `None` | no | si se da, debe existir (404) | `Código AFORE opcional (e.g. 'xxi_banorte')` |
| `desde` | `Optional[str]` | `None` → `date(2009, 1, 1)` | no | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01 (default 2009-01)` |
| `hasta` | `Optional[str]` | `None` → `date(2025, 6, 1)` | no | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01 (default 2025-06)` |

### SQL

Query 1 (solo con `afore_codigo`) — `SQL_FLUJO_AFORE_META`; binding `{"codigo": afore_codigo}`; `.one_or_none()`:

```sql
SELECT codigo, nombre_corto, tipo_pension
FROM consar.afores
WHERE codigo = :codigo
```

Query 2 — `SQL_FLUJO_SERIE`; binding `{"afore_codigo": afore_codigo, "desde": d_desde, "hasta": d_hasta}`:

```sql
SELECT f.fecha,
       SUM(f.montos_entradas)::float AS montos_entradas,
       SUM(f.montos_salidas)::float  AS montos_salidas
FROM consar.flujo_recurso f
JOIN consar.afores a ON a.id = f.afore_id
WHERE (CAST(:afore_codigo AS text) IS NULL OR a.codigo = :afore_codigo)
  AND f.fecha >= :desde
  AND f.fecha <= :hasta
GROUP BY f.fecha
ORDER BY f.fecha
```

### Post-procesamiento

```python
serie = [FlujoPunto(
    fecha=r["fecha"],
    montos_entradas=round(r["montos_entradas"], 4),
    montos_salidas=round(r["montos_salidas"], 4),
    flujo_neto=round(r["montos_entradas"] - r["montos_salidas"], 4),   # resta sobre crudos, luego round
) for r in rows]
```

- `afore = FlujoAforeRef(**afore_row)` o `None`; `unit = "millones de pesos MXN corrientes"`.
- `n_puntos = len(serie)`; `rango = SerieRango(desde=d_desde, hasta=d_hasta)` (solicitado).
- `caveats = [CAVEAT_FLUJO_COBERTURA, CAVEAT_FLUJO_BIENESTAR]`. Serie vacía no produce 404.

### Response model: `FlujoSerieResponse`

```
FlujoSerieResponse
  afore: Optional[FlujoAforeRef]    # None → suma nacional
  unit: str
  n_puntos: int
  rango: SerieRango
  serie: list[FlujoPunto]
  caveats: list[str]

FlujoAforeRef
  codigo: str
  nombre_corto: str
  tipo_pension: str

FlujoPunto
  fecha: date
  montos_entradas: float
  montos_salidas: float
  flujo_neto: float
```

### Errores

- `422` — `_parse_fecha`; `422` — `detail = "'desde' debe ser <= 'hasta'"`.
- `404` — `detail = f"afore '{afore_codigo}' no existe"`.

---

## 12. `GET /api/v1/consar/flujos/snapshot`

- Rate limit: `30/minute`
- `summary`: `Snapshot mensual: entradas/salidas por AFORE en una fecha`
- `description`: `Retorna para la fecha indicada (YYYY-MM o YYYY-MM-01) los flujos por cada AFORE reportante + totales del sistema. Cobertura 2009-01 → 2025-06.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `fecha` | `str` | — | sí | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01` |

### SQL (`SQL_FLUJO_SNAPSHOT`; binding `{"fecha": d}`)

```sql
SELECT a.codigo AS afore_codigo,
       a.nombre_corto AS afore_nombre_corto,
       a.tipo_pension,
       a.orden_display,
       COALESCE(f.montos_entradas, 0)::float AS montos_entradas,
       COALESCE(f.montos_salidas,  0)::float AS montos_salidas
FROM consar.afores a
LEFT JOIN consar.flujo_recurso f
       ON f.afore_id = a.id AND f.fecha = :fecha
WHERE a.codigo <> 'pension_bienestar'
ORDER BY a.orden_display
```

### Post-procesamiento

```python
reporting = [r for r in rows if (r["montos_entradas"] or 0) > 0 or (r["montos_salidas"] or 0) > 0]
if not reporting: raise 404
sis_ent = sum(r["montos_entradas"] for r in reporting)
sis_sal = sum(r["montos_salidas"] for r in reporting)
```

- `unit = "millones de pesos MXN corrientes"`; `n_afores_reportando = len(reporting)`.
- `sistema_entradas_mm = round(sis_ent, 4)`; `sistema_salidas_mm = round(sis_sal, 4)`; `sistema_flujo_neto_mm = round(sis_ent - sis_sal, 4)`.
- `afores`: TODAS las filas (10; las no reportantes salen con `0.0`), cada una con `montos_entradas=round(v,4)`, `montos_salidas=round(v,4)`, `flujo_neto=round(ent - sal, 4)`.
- `caveats = [CAVEAT_FLUJO_COBERTURA, CAVEAT_FLUJO_BIENESTAR]`.

### Response model: `FlujoSnapshotResponse`

```
FlujoSnapshotResponse
  fecha: date
  unit: str
  n_afores_reportando: int
  sistema_entradas_mm: float
  sistema_salidas_mm: float
  sistema_flujo_neto_mm: float
  afores: list[FlujoSnapshotRow]
  caveats: list[str]

FlujoSnapshotRow
  afore_codigo: str
  afore_nombre_corto: str
  tipo_pension: str
  montos_entradas: float
  montos_salidas: float
  flujo_neto: float
```

### Errores

- `422` — `_parse_fecha`.
- `404` — `detail = f"No hay datos para fecha={d.isoformat()} (cobertura: 2009-01 a 2025-06)"`.

---

## 13. `GET /api/v1/consar/traspasos/serie`

- Rate limit: `30/minute`
- `summary`: `Serie temporal: cuentas cedidas/recibidas en traspasos por AFORE (o sistema)`
- `description`: ``Retorna serie mensual de cuentas cedidas (perdidas) y recibidas (ganadas) en traspasos AFORE-AFORE. Si `afore_codigo` se omite, suma sobre todas las AFOREs. Cobertura 1998-11-01 → 2025-06-01. `traspaso_neto = recibido - cedido` (positivo = AFORE ganando cuentas neto).``

### Parámetros (query) — NINGUNO lleva `description` en el código

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `afore_codigo` | `Optional[str]` | `None` | no | si se da, debe existir (404) | (sin description; `Query(None)`) |
| `desde` | `Optional[str]` | `None` → `date(1998, 11, 1)` | no | `_parse_fecha` (422) | (sin description) |
| `hasta` | `Optional[str]` | `None` → `date(2025, 6, 1)` | no | `_parse_fecha` (422) | (sin description) |

### SQL

Query 1 (solo con `afore_codigo`) — `SQL_TRASPASO_AFORE_META`; binding `{"codigo": afore_codigo}`; `.one_or_none()`:

```sql
SELECT codigo, nombre_corto, tipo_pension
FROM consar.afores
WHERE codigo = :codigo
```

Query 2 — `SQL_TRASPASO_SERIE`; binding `{"afore_codigo": afore_codigo, "desde": d_desde, "hasta": d_hasta}`:

```sql
SELECT t.fecha,
       SUM(t.num_tras_cedido)   AS sum_ced,
       SUM(t.num_tras_recibido) AS sum_rec
FROM consar.traspaso t
JOIN consar.afores a ON a.id = t.afore_id
WHERE (CAST(:afore_codigo AS text) IS NULL OR a.codigo = :afore_codigo)
  AND t.fecha >= :desde
  AND t.fecha <= :hasta
GROUP BY t.fecha
ORDER BY t.fecha
```

Nota: sin `::float` — `SUM` devuelve `bigint`/`numeric` según el tipo de columna; Python lo convierte con `int()`. `SUM` de todos-NULL devuelve `NULL`.

### Post-procesamiento

```python
for r in rows:
    ced = r["sum_ced"]; rec = r["sum_rec"]
    neto = (rec - ced) if (ced is not None and rec is not None) else None
    serie.append(TraspasoPunto(
        fecha=r["fecha"],
        num_tras_cedido=int(ced) if ced is not None else None,
        num_tras_recibido=int(rec) if rec is not None else None,
        traspaso_neto=int(neto) if neto is not None else None,
    ))
```

- `afore = TraspasoAforeRef(**afore_row)` o `None`. NO hay campo `unit`.
- `n_puntos = len(serie)`; `rango = SerieRango(desde=d_desde, hasta=d_hasta)` (solicitado).
- `caveats = [CAVEAT_TRASPASO_BIENESTAR, CAVEAT_TRASPASO_IDENTIDAD]` (NO incluye `CAVEAT_TRASPASO_NULLS`).
- Serie vacía no produce 404.

### Response model: `TraspasoSerieResponse`

```
TraspasoSerieResponse
  afore: Optional[TraspasoAforeRef] # None → suma sistema
  n_puntos: int
  rango: SerieRango
  serie: list[TraspasoPunto]
  caveats: list[str]

TraspasoAforeRef
  codigo: str
  nombre_corto: str
  tipo_pension: str

TraspasoPunto
  fecha: date
  num_tras_cedido: Optional[int]
  num_tras_recibido: Optional[int]
  traspaso_neto: Optional[int]      # recibido - cedido (None si ambas son None)
```

### Errores

- `422` — `_parse_fecha`; `422` — `detail = "'desde' debe ser <= 'hasta'"`.
- `404` — `detail = f"afore '{afore_codigo}' no existe"`.

---

## 14. `GET /api/v1/consar/traspasos/snapshot`

- Rate limit: `30/minute`
- `summary`: `Snapshot mensual: traspasos por AFORE + identidad Σced=Σrec`
- `description`: `Retorna para la fecha indicada los traspasos cedidos/recibidos por cada AFORE reportante. Incluye verificación de la identidad implícita Σ cedidos = Σ recibidos (cada traspaso es 1+1).`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `fecha` | `str` | — | sí | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01` |

### SQL (`SQL_TRASPASO_SNAPSHOT`; binding `{"fecha": d}`)

```sql
SELECT a.codigo AS afore_codigo,
       a.nombre_corto AS afore_nombre_corto,
       a.tipo_pension,
       a.orden_display,
       t.num_tras_cedido,
       t.num_tras_recibido
FROM consar.afores a
LEFT JOIN consar.traspaso t
       ON t.afore_id = a.id AND t.fecha = :fecha
WHERE a.codigo <> 'pension_bienestar'
ORDER BY a.orden_display
```

### Post-procesamiento

```python
reporting = [r for r in rows if r["num_tras_cedido"] is not None or r["num_tras_recibido"] is not None]
if not reporting: raise 404
sis_ced = sum((r["num_tras_cedido"]   or 0) for r in reporting)
sis_rec = sum((r["num_tras_recibido"] or 0) for r in reporting)
delta = sis_ced - sis_rec                      # cedido - recibido
identidad = TraspasoIdentidad(
    sistema_total_cedido=int(sis_ced),
    sistema_total_recibido=int(sis_rec),
    delta=int(delta),
    cierre_al_unidad=(delta == 0),
)
```

- `n_afores_reportando = len(reporting)`.
- `afores`: TODAS las filas (10), con `num_tras_cedido=int(v)` / `None`, `num_tras_recibido=int(v)` / `None`, `traspaso_neto = int(rec) - int(ced)` si ambos no-None, si no `None`.
- `caveats = [CAVEAT_TRASPASO_BIENESTAR, CAVEAT_TRASPASO_NULLS, CAVEAT_TRASPASO_IDENTIDAD]`.

### Response model: `TraspasoSnapshotResponse`

```
TraspasoSnapshotResponse
  fecha: date
  n_afores_reportando: int
  identidad: TraspasoIdentidad
  afores: list[TraspasoSnapshotRow]
  caveats: list[str]

TraspasoIdentidad
  sistema_total_cedido: int
  sistema_total_recibido: int
  delta: int                        # cedido - recibido (debería ser 0 por construcción)
  cierre_al_unidad: bool            # True si delta == 0

TraspasoSnapshotRow
  afore_codigo: str
  afore_nombre_corto: str
  tipo_pension: str
  num_tras_cedido: Optional[int]
  num_tras_recibido: Optional[int]
  traspaso_neto: Optional[int]
```

### Errores

- `422` — `_parse_fecha`.
- `404` — `detail = f"No hay datos para fecha={d.isoformat()} (cobertura: 1998-11 a 2025-06)"`.

---

## 15. `GET /api/v1/consar/pea-cotizantes/serie`

- Rate limit: `60/minute`
- `summary`: `Serie anual: cobertura SAR sobre PEA mexicana (2010-2024)`
- `description`: ``Retorna la serie anual nacional de la cobertura del SAR (cotizantes formales) sobre la PEA (Población Económicamente Activa) total. Incluye `brecha_no_cubierta_pct` (=100 - porcentaje) que integra informalidad, desempleo y elegibles no registrados. Cobertura 2010 → 2024 (15 puntos).``

### Parámetros

Ninguno.

### SQL (`SQL_PEA`, sin parámetros)

```sql
SELECT anio, cotizantes, pea, porcentaje_pea_afore::float AS porcentaje_pea_afore
FROM consar.pea_cotizantes
ORDER BY anio
```

### Post-procesamiento

```python
if not rows: raise 500
serie = [PeaCotizantesPunto(
    anio=r["anio"], cotizantes=r["cotizantes"], pea=r["pea"],
    porcentaje_pea_afore=round(r["porcentaje_pea_afore"], 2),
    brecha_no_cubierta_pct=round(100.0 - r["porcentaje_pea_afore"], 2),   # sobre el crudo
) for r in rows]
cobertura_min = min(serie, key=lambda p: p.porcentaje_pea_afore)   # sobre valores YA redondeados; empate → primero
cobertura_max = max(serie, key=lambda p: p.porcentaje_pea_afore)
```

- `n_puntos = len(serie)`; `anio_min = serie[0].anio`; `anio_max = serie[-1].anio`.
- `cobertura_min_pct / cobertura_min_anio / cobertura_max_pct / cobertura_max_anio` de los puntos anteriores.
- `caveats = [CAVEAT_PEA_FUENTES, CAVEAT_PEA_COBERTURA_INTERPRETACION]`.
- El código pasa `source=SOURCE_PEA` al constructor, pero `PeaCotizantesResponse` NO declara `source`; con Pydantic 2 (`extra` por defecto = `ignore`) el campo se DESCARTA y NO aparece en el JSON.

### Response model: `PeaCotizantesResponse`

```
PeaCotizantesResponse
  n_puntos: int
  anio_min: int
  anio_max: int
  serie: list[PeaCotizantesPunto]
  cobertura_min_pct: float
  cobertura_min_anio: int
  cobertura_max_pct: float
  cobertura_max_anio: int
  caveats: list[str]

PeaCotizantesPunto
  anio: int
  cotizantes: int
  pea: int
  porcentaje_pea_afore: float
  brecha_no_cubierta_pct: float     # 100 - porcentaje (informalidad/desempleo/no-cotizantes)
```

### Errores

- `500` — `detail = "no hay datos en consar.pea_cotizantes"`.

---

## 16. `GET /api/v1/consar/activo-neto/serie`

- Rate limit: `60/minute`
- `summary`: `Serie temporal: activo neto atómico por (AFORE × SIEFORE)`
- `description`: `Retorna serie mensual de activo neto en MXN millones para una tupla (afore, siefore). Si la tupla proviene de un sub-variant concat decompuesto, expone mapping_validated y validated_via para transparencia. Cobertura 2019-12 → 2025-06.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `afore_codigo` | `str` | — | sí | par debe existir (404) | `codigo en consar.afores (e.g. xxi_banorte, profuturo)` |
| `siefore_slug` | `str` | — | sí | par debe existir (404) | `slug en consar.cat_siefore (e.g. sb 55-59, sps1)` |

### SQL

Query 1 — `SQL_ACTIVO_NETO_SERIE_META`; binding `{"afore_codigo": ..., "siefore_slug": ...}`; se usa `meta_rows[0]`:

```sql
SELECT af.codigo AS afore_codigo, af.nombre_corto AS afore_nombre_corto,
       af.tipo_pension AS afore_tipo_pension,
       cs.slug AS siefore_slug, cs.nombre AS siefore_nombre, cs.categoria AS siefore_categoria,
       (SELECT mapping_validated FROM consar.afore_siefore_alias asa
         WHERE asa.afore_id = af.id AND asa.siefore_id = cs.id AND asa.fuente_csv = '#07'
         LIMIT 1) AS asa_validated,
       (SELECT validated_via FROM consar.afore_siefore_alias asa
         WHERE asa.afore_id = af.id AND asa.siefore_id = cs.id AND asa.fuente_csv = '#07'
         LIMIT 1) AS asa_validated_via
FROM consar.afores af, consar.cat_siefore cs
WHERE af.codigo = :afore_codigo AND cs.slug = :siefore_slug
```

Query 2 — `SQL_ACTIVO_NETO_SERIE`; mismo binding:

```sql
SELECT an.fecha, an.monto_mxn_mm::float AS monto_mxn_mm
FROM consar.activo_neto an
JOIN consar.afores af ON af.id = an.afore_id
JOIN consar.cat_siefore cs ON cs.id = an.siefore_id
WHERE af.codigo = :afore_codigo AND cs.slug = :siefore_slug
ORDER BY an.fecha
```

### Post-procesamiento

- `serie = [ActivoNetoPunto(fecha=r["fecha"], monto_mxn_mm=r["monto_mxn_mm"])]` — SIN redondeo; puede ser `None`.
- ```python
  asa_validated = meta["asa_validated"]
  is_subvariant = asa_validated is not None
  mapping_meta = ActivoNetoMappingMeta(
      is_subvariant_decomposed=is_subvariant,
      mapping_validated=asa_validated,
      validated_via=meta["asa_validated_via"],
  )
  ```
- `unit = "millones de pesos MXN corrientes"`; `n_puntos = len(serie)`.
- `rango = SerieRango(desde=serie[0].fecha, hasta=serie[-1].fecha)` — rango OBSERVADO.
- `caveats = [CAVEAT_ACTIVO_NETO_UNIDAD, CAVEAT_ACTIVO_NETO_NULLS, CAVEAT_ACTIVO_NETO_DECOMPOSITION]`.
- `SOURCE_ACTIVO_NETO` definido pero no incluido.

### Response model: `ActivoNetoSerieResponse`

```
ActivoNetoSerieResponse
  afore: ActivoNetoAforeRef
  siefore: ActivoNetoSieforeRef
  unit: str
  n_puntos: int
  rango: SerieRango
  serie: list[ActivoNetoPunto]
  mapping_meta: ActivoNetoMappingMeta
  caveats: list[str]

ActivoNetoAforeRef
  codigo: str
  nombre_corto: str
  tipo_pension: str

ActivoNetoSieforeRef
  slug: str
  nombre: str
  categoria: str

ActivoNetoPunto
  fecha: date
  monto_mxn_mm: Optional[float]

ActivoNetoMappingMeta   # docstring: "Provenance del mapping para pares (afore × siefore) que vienen de sub-variants decompuestos en #07 (consar.afore_siefore_alias)."
  is_subvariant_decomposed: bool    # True si el par fue decompuesto desde un sub-variant concat
  mapping_validated: Optional[bool] # None si is_subvariant_decomposed=False (mapping directo, atómico desde origen)
  validated_via: Optional[str]
```

### Errores

- `404` — `detail = f"afore_codigo={afore_codigo!r} o siefore_slug={siefore_slug!r} no existe"` (meta vacío; `!r` → comillas simples).
- `404` — `detail = f"sin datos para ({afore_codigo}, {siefore_slug}) en consar.activo_neto"`.

---

## 17. `GET /api/v1/consar/activo-neto/snapshot`

- Rate limit: `30/minute`
- `summary`: `Snapshot mensual: matriz (AFORE × SIEFORE) de activo neto`
- `description`: `Retorna para una fecha mensual todas las tuplas (afore, siefore) con sus montos. Útil para dashboards de composición por afore. Cobertura 2019-12 → 2025-06.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `fecha` | `str` | — | sí | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01` |

### SQL (`SQL_ACTIVO_NETO_SNAPSHOT`; binding `{"fecha": d}`)

```sql
SELECT af.codigo AS afore_codigo, af.nombre_corto AS afore_nombre_corto,
       cs.slug AS siefore_slug, cs.nombre AS siefore_nombre, cs.categoria AS siefore_categoria,
       an.monto_mxn_mm::float AS monto_mxn_mm
FROM consar.activo_neto an
JOIN consar.afores af ON af.id = an.afore_id
JOIN consar.cat_siefore cs ON cs.id = an.siefore_id
WHERE an.fecha = :fecha
ORDER BY af.orden_display, cs.orden_display
```

### Post-procesamiento

- `filas`: mapeo directo, `monto_mxn_mm` crudo (puede ser `None`).
- `n_null = sum(1 for f in filas if f.monto_mxn_mm is None)`
- `monto_total = sum((f.monto_mxn_mm or 0.0) for f in filas)` → `monto_total_mm = round(monto_total, 4)`.
- `unit = "millones de pesos MXN corrientes"`; `n_filas = len(filas)`; `n_filas_null = n_null`.
- `caveats = [CAVEAT_ACTIVO_NETO_UNIDAD, CAVEAT_ACTIVO_NETO_NULLS, CAVEAT_ACTIVO_NETO_DECOMPOSITION]`.

### Response model: `ActivoNetoSnapshotResponse`

```
ActivoNetoSnapshotResponse
  fecha: date
  unit: str
  n_filas: int
  monto_total_mm: float             # excluye NULLs
  n_filas_null: int
  filas: list[ActivoNetoSnapshotRow]
  caveats: list[str]

ActivoNetoSnapshotRow
  afore_codigo: str
  afore_nombre_corto: str
  siefore_slug: str
  siefore_nombre: str
  siefore_categoria: str
  monto_mxn_mm: Optional[float]
```

### Errores

- `422` — `_parse_fecha`.
- `404` — `detail = f"sin datos para fecha={d.isoformat()} (cobertura: 2019-12 → 2025-06)"`.

---

## 18. `GET /api/v1/consar/activo-neto/agregado`

- Rate limit: `60/minute`
- `summary`: `Serie temporal: agregado de activo neto por categoría (totales por afore)`
- `description`: `Retorna serie mensual de un agregado total reportado en CSV por afore. Categorías: act_neto_total_siefores, act_neto_total_basicas, act_neto_total_adicionales (esta última con 0 rows post-S16 — schema preparado, ver caveats). Cobertura 2019-12 → 2025-06.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `afore_codigo` | `str` | — | sí | debe existir (404) | `codigo en consar.afores` |
| `categoria` | `str` | — | sí | debe estar en `("act_neto_total_siefores", "act_neto_total_basicas", "act_neto_total_adicionales")` → si no, 422 ANTES de tocar BD | `act_neto_total_siefores \| act_neto_total_basicas \| act_neto_total_adicionales` |

### SQL

Query 1 — `SQL_ACTIVO_NETO_AGG_AFORE_META`; binding `{"afore_codigo": afore_codigo}`; se usa `af_rows[0]`:

```sql
SELECT codigo, nombre_corto, tipo_pension
FROM consar.afores WHERE codigo = :afore_codigo
```

Query 2 — `SQL_ACTIVO_NETO_AGG`; binding `{"afore_codigo": afore_codigo, "categoria": categoria}`:

```sql
SELECT ana.fecha, ana.monto_mxn_mm::float AS monto_mxn_mm
FROM consar.activo_neto_agg ana
JOIN consar.afores af ON af.id = ana.afore_id
WHERE af.codigo = :afore_codigo AND ana.categoria = :categoria
ORDER BY ana.fecha
```

### Post-procesamiento

- `serie = [ActivoNetoAggPunto(fecha=r["fecha"], monto_mxn_mm=r["monto_mxn_mm"])]` — crudo.
- `caveats = [CAVEAT_ACTIVO_NETO_UNIDAD]`; si `categoria == "act_neto_total_adicionales"` se anexa `CAVEAT_ACTIVO_NETO_AGG_ADICIONALES`.
- `categoria` se devuelve tal cual; `unit = "millones de pesos MXN corrientes"`; `n_puntos = len(serie)`; `rango` observado (`serie[0].fecha`, `serie[-1].fecha`).

### Response model: `ActivoNetoAggregadoResponse`

```
ActivoNetoAggregadoResponse
  afore: ActivoNetoAforeRef         # (codigo, nombre_corto, tipo_pension)
  categoria: str
  unit: str
  n_puntos: int
  rango: SerieRango
  serie: list[ActivoNetoAggPunto]
  caveats: list[str]

ActivoNetoAggPunto
  fecha: date
  monto_mxn_mm: Optional[float]
```

### Errores

- `422` — `detail = f"categoria inválida: {categoria!r}"`.
- `404` — `detail = f"afore_codigo={afore_codigo!r} no existe"`.
- `404` sin filas, `detail` construido así:
  - base: `f"sin datos para ({afore_codigo}, {categoria}). "`
  - si `categoria == "act_neto_total_adicionales"`: + `"Categoría con 0 rows en CSV oficial — ver caveats."`
  - si no: + `"Esta afore puede no reportar este agregado (e.g. xxi_banorte reporta vía alias xxi-banorte)."`

---

## 19. `GET /api/v1/consar/rendimientos/serie`

- Rate limit: `60/minute`
- `summary`: `Serie temporal: rendimiento atómico por (AFORE × SIEFORE × PLAZO)`
- `description`: `Retorna serie mensual de rendimiento (% anualizado neto) para una tupla (afore, siefore, plazo). Si la tupla proviene de un sub-variant concat decompuesto, expone mapping_validated y validated_via. Cobertura 2019-12 → 2025-06.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `afore_codigo` | `str` | — | sí | par debe existir (404) | `codigo en consar.afores (e.g. xxi_banorte, profuturo)` |
| `siefore_slug` | `str` | — | sí | par debe existir (404) | `slug en consar.cat_siefore (e.g. sb 60-64, sps3)` |
| `plazo` | `str` | — | sí | debe estar en `PLAZOS_VALIDOS` → 422 ANTES de BD | `12_meses \| 24_meses \| 36_meses \| 5_anios \| historico` |

### SQL

Query 1 — `SQL_RENDIMIENTO_SERIE_META`; binding `{"afore_codigo", "siefore_slug"}`; `meta_rows[0]`:

```sql
SELECT af.codigo AS afore_codigo, af.nombre_corto AS afore_nombre_corto,
       af.tipo_pension AS afore_tipo_pension,
       cs.slug AS siefore_slug, cs.nombre AS siefore_nombre, cs.categoria AS siefore_categoria,
       (SELECT mapping_validated FROM consar.afore_siefore_alias asa
         WHERE asa.afore_id = af.id AND asa.siefore_id = cs.id AND asa.fuente_csv = '#10'
         LIMIT 1) AS asa_validated,
       (SELECT validated_via FROM consar.afore_siefore_alias asa
         WHERE asa.afore_id = af.id AND asa.siefore_id = cs.id AND asa.fuente_csv = '#10'
         LIMIT 1) AS asa_validated_via
FROM consar.afores af, consar.cat_siefore cs
WHERE af.codigo = :afore_codigo AND cs.slug = :siefore_slug
```

Query 2 — `SQL_RENDIMIENTO_SERIE`; binding `{"afore_codigo", "siefore_slug", "plazo"}`:

```sql
SELECT r.fecha, r.rendimiento_pct::float AS rendimiento_pct
FROM consar.rendimiento r
JOIN consar.afores af ON af.id = r.afore_id
JOIN consar.cat_siefore cs ON cs.id = r.siefore_id
WHERE af.codigo = :afore_codigo AND cs.slug = :siefore_slug AND r.plazo = :plazo
ORDER BY r.fecha
```

### Post-procesamiento

- `serie = [RendimientoPunto(fecha=r["fecha"], rendimiento_pct=r["rendimiento_pct"])]` — crudo.
- `mapping_meta`: idéntico patrón a activo-neto (`is_subvariant_decomposed = asa_validated is not None`, `mapping_validated = asa_validated`, `validated_via = asa_validated_via`).
- ```python
  caveats = [CAVEAT_RENDIMIENTO_UNIDAD, CAVEAT_RENDIMIENTO_DECOMPOSITION]
  if plazo == "historico":
      caveats.insert(1, CAVEAT_RENDIMIENTO_HISTORICO)   # queda en posición 1
  ```
- `plazo` se devuelve tal cual; `unit = "porcentaje anualizado neto"`; `n_puntos`; `rango` observado.
- `SOURCE_RENDIMIENTO` definido pero no incluido.

### Response model: `RendimientoSerieResponse`

```
RendimientoSerieResponse
  afore: RendimientoAforeRef
  siefore: RendimientoSieforeRef
  plazo: str
  unit: str
  n_puntos: int
  rango: SerieRango
  serie: list[RendimientoPunto]
  mapping_meta: RendimientoMappingMeta
  caveats: list[str]

RendimientoAforeRef
  codigo: str
  nombre_corto: str
  tipo_pension: str

RendimientoSieforeRef
  slug: str
  nombre: str
  categoria: str

RendimientoPunto
  fecha: date
  rendimiento_pct: float

RendimientoMappingMeta   # docstring: "Provenance del mapping para pares (afore × siefore) decompuestos desde sub-variants en #10 (consar.afore_siefore_alias fuente_csv='#10')."
  is_subvariant_decomposed: bool
  mapping_validated: Optional[bool]
  validated_via: Optional[str]
```

### Errores

- `422` — `detail = f"plazo inválido: {plazo!r}. Válidos: {list(PLAZOS_VALIDOS)}"` → p. ej. `plazo inválido: 'x'. Válidos: ['12_meses', '24_meses', '36_meses', '5_anios', 'historico']`.
- `404` — `detail = f"afore_codigo={afore_codigo!r} o siefore_slug={siefore_slug!r} no existe"`.
- `404` — `detail = f"sin datos para ({afore_codigo}, {siefore_slug}, {plazo}). plazo='historico' sólo aplica a sb 60-64."`

---

## 20. `GET /api/v1/consar/rendimientos/snapshot`

- Rate limit: `30/minute`
- `summary`: `Snapshot mensual: matriz (AFORE × SIEFORE) de rendimiento para un plazo`
- `description`: `Retorna para una fecha y plazo todas las tuplas (afore, siefore) con sus rendimientos. Útil para dashboards comparativos de desempeño. Cobertura 2019-12 → 2025-06.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `fecha` | `str` | — | sí | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01` |
| `plazo` | `str` | — | sí | `PLAZOS_VALIDOS` (422) | `12_meses \| 24_meses \| 36_meses \| 5_anios \| historico` |

Orden de validación: `plazo` PRIMERO, luego `fecha`.

### SQL (`SQL_RENDIMIENTO_SNAPSHOT`; binding `{"fecha": d, "plazo": plazo}`)

```sql
SELECT af.codigo AS afore_codigo, af.nombre_corto AS afore_nombre_corto,
       cs.slug AS siefore_slug, cs.nombre AS siefore_nombre, cs.categoria AS siefore_categoria,
       r.rendimiento_pct::float AS rendimiento_pct
FROM consar.rendimiento r
JOIN consar.afores af ON af.id = r.afore_id
JOIN consar.cat_siefore cs ON cs.id = r.siefore_id
WHERE r.fecha = :fecha AND r.plazo = :plazo
ORDER BY af.orden_display, cs.orden_display
```

### Post-procesamiento

- `filas`: mapeo directo, `rendimiento_pct` crudo.
- `rendimiento_min = min(f.rendimiento_pct)`; `rendimiento_max = max(...)` (crudos).
- `caveats = [CAVEAT_RENDIMIENTO_UNIDAD, CAVEAT_RENDIMIENTO_DECOMPOSITION]` con `CAVEAT_RENDIMIENTO_HISTORICO` insertado en índice 1 si `plazo == "historico"`.
- `unit = "porcentaje anualizado neto"`; `n_filas = len(filas)`.

### Response model: `RendimientoSnapshotResponse`

```
RendimientoSnapshotResponse
  fecha: date
  plazo: str
  unit: str
  n_filas: int
  rendimiento_min: float
  rendimiento_max: float
  filas: list[RendimientoSnapshotRow]
  caveats: list[str]

RendimientoSnapshotRow
  afore_codigo: str
  afore_nombre_corto: str
  siefore_slug: str
  siefore_nombre: str
  siefore_categoria: str
  rendimiento_pct: float
```

### Errores

- `422` — plazo inválido (mismo mensaje que el 19).
- `422` — `_parse_fecha`.
- `404` — `detail = f"sin datos para fecha={d.isoformat()} plazo={plazo} (cobertura 2019-12 → 2025-06; historico solo sb 60-64)"`.

---

## 21. `GET /api/v1/consar/rendimientos/sistema`

- Rate limit: `60/minute`
- `summary`: `Serie temporal: rendimiento agregado del sistema (INTER-afore) por SIEFORE × PLAZO`
- `description`: `Retorna serie mensual del rendimiento agregado CONSAR del sistema (promedio ponderado sobre todas las afores) para una siefore y plazo. Distinto de activo_neto_agg que es agregado INTRA-afore. Para 'adicionales' usar siefore_slug='agregado_adicionales'. Cobertura 2019-12 → 2025-06.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `siefore_slug` | `str` | — | sí | debe existir (404) | `slug en consar.cat_siefore (e.g. sb 60-64, agregado_adicionales)` |
| `plazo` | `str` | — | sí | `PLAZOS_VALIDOS` (422, antes de BD) | `12_meses \| 24_meses \| 36_meses \| 5_anios \| historico` |

### SQL

Query 1 — `SQL_RENDIMIENTO_SIS_META`; binding `{"siefore_slug": siefore_slug}`; `meta_rows[0]`:

```sql
SELECT slug, nombre, categoria
FROM consar.cat_siefore WHERE slug = :siefore_slug
```

Query 2 — `SQL_RENDIMIENTO_SIS`; binding `{"siefore_slug", "plazo"}`:

```sql
SELECT r.fecha, r.rendimiento_pct::float AS rendimiento_pct
FROM consar.rendimiento_sis r
JOIN consar.cat_siefore cs ON cs.id = r.siefore_id
WHERE cs.slug = :siefore_slug AND r.plazo = :plazo
ORDER BY r.fecha
```

### Post-procesamiento

- `serie = [RendimientoSistemaPunto(fecha, rendimiento_pct)]` crudo.
- `caveats = [CAVEAT_RENDIMIENTO_UNIDAD, CAVEAT_RENDIMIENTO_SIS]` con `CAVEAT_RENDIMIENTO_HISTORICO` insertado en índice 1 si `plazo == "historico"`.
- `unit = "porcentaje anualizado neto"`; `n_puntos`; `rango` observado.

### Response model: `RendimientoSistemaResponse`

```
RendimientoSistemaResponse
  siefore: RendimientoSieforeRef    # (slug, nombre, categoria)
  plazo: str
  unit: str
  n_puntos: int
  rango: SerieRango
  serie: list[RendimientoSistemaPunto]
  caveats: list[str]

RendimientoSistemaPunto
  fecha: date
  rendimiento_pct: float
```

### Errores

- `422` — plazo inválido.
- `404` — `detail = f"siefore_slug={siefore_slug!r} no existe"`.
- `404` — `detail = f"sin datos para ({siefore_slug}, {plazo}). plazo='historico' sólo aplica a sb 60-64."`

---

## 22. `GET /api/v1/consar/metricas-sensibilidad`

- Rate limit: `60/minute`
- `summary`: `Catálogo descubrible: 7 métricas de sensibilidad regulatoria`
- `description`: `Retorna las 7 métricas de sensibilidad regulatoria reportadas en dataset #03 (coef_liquidez, dcvar, tracking_error, escenarios_var, ppp, pid, var) con su unidad y descripción. Útil para clientes que necesitan descubrir slugs válidos antes de consultar /medidas/serie o /medidas/snapshot.`

### Parámetros

Ninguno.

### SQL (`SQL_METRICAS_CATALOGO`, sin parámetros)

```sql
SELECT id, slug, columna_csv, descripcion, unidad, orden_display
FROM consar.cat_metrica_sensibilidad
ORDER BY orden_display
```

### Post-procesamiento

- Mapeo directo campo a campo a `MetricaSensibilidadRow`.
- `n = len(metricas)`.
- `caveats = [CAVEAT_MEDIDA_PID_CORRECCION, CAVEAT_MEDIDA_SUBVARIANT_METRICAS, CAVEAT_MEDIDA_ESCENARIOS_SPARSITY]`.

### Response model: `MetricasSensibilidadResponse`

```
MetricasSensibilidadResponse
  n: int
  metricas: list[MetricaSensibilidadRow]
  caveats: list[str]

MetricaSensibilidadRow
  id: int
  slug: str
  columna_csv: str
  descripcion: str
  unidad: str
  orden_display: int
```

### Errores

Ninguno explícito.

---

## 23. `GET /api/v1/consar/medidas/serie`

- Rate limit: `60/minute`
- `summary`: `Serie temporal: medida regulatoria por (AFORE × SIEFORE × MÉTRICA)`
- `description`: `Retorna serie mensual de una métrica de sensibilidad regulatoria para una tupla (afore, siefore, métrica). Si la tupla proviene de un sub-variant decompuesto, expone mapping_validated y validated_via. Cobertura 2019-12 → 2025-06.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `afore_codigo` | `str` | — | sí | tripleta debe existir (404) | `codigo en consar.afores (e.g. xxi_banorte, profuturo)` |
| `siefore_slug` | `str` | — | sí | tripleta debe existir (404) | `slug en consar.cat_siefore (e.g. sb 60-64, sps3)` |
| `metrica` | `str` | — | sí | tripleta debe existir (404) | `slug en consar.cat_metrica_sensibilidad (e.g. var, ppp, pid)` |

### SQL

Query 1 — `SQL_MEDIDA_SERIE_META`; binding `{"afore_codigo": afore_codigo, "siefore_slug": siefore_slug, "metrica_slug": metrica}`; `meta_rows[0]`:

```sql
SELECT af.codigo AS afore_codigo, af.nombre_corto AS afore_nombre_corto,
       af.tipo_pension AS afore_tipo_pension,
       cs.slug AS siefore_slug, cs.nombre AS siefore_nombre, cs.categoria AS siefore_categoria,
       cm.slug AS metrica_slug, cm.descripcion AS metrica_descripcion, cm.unidad AS metrica_unidad,
       (SELECT mapping_validated FROM consar.afore_siefore_alias asa
         WHERE asa.afore_id = af.id AND asa.siefore_id = cs.id AND asa.fuente_csv = '#10'
         LIMIT 1) AS asa_validated,
       (SELECT validated_via FROM consar.afore_siefore_alias asa
         WHERE asa.afore_id = af.id AND asa.siefore_id = cs.id AND asa.fuente_csv = '#10'
         LIMIT 1) AS asa_validated_via
FROM consar.afores af, consar.cat_siefore cs, consar.cat_metrica_sensibilidad cm
WHERE af.codigo = :afore_codigo AND cs.slug = :siefore_slug AND cm.slug = :metrica_slug
```

Query 2 — `SQL_MEDIDA_SERIE`; mismo binding:

```sql
SELECT ms.fecha, ms.valor::float AS valor
FROM consar.medida_sensibilidad ms
JOIN consar.afores af ON af.id = ms.afore_id
JOIN consar.cat_siefore cs ON cs.id = ms.siefore_id
JOIN consar.cat_metrica_sensibilidad cm ON cm.id = ms.metrica_id
WHERE af.codigo = :afore_codigo AND cs.slug = :siefore_slug AND cm.slug = :metrica_slug
ORDER BY ms.fecha
```

### Post-procesamiento

- `serie = [MedidaPunto(fecha=r["fecha"], valor=r["valor"])]` crudo.
- `mapping_meta`: mismo patrón (`asa_validated is not None`), alias con `fuente_csv='#10'`.
- ```python
  caveats = [CAVEAT_MEDIDA_PIVOT, CAVEAT_MEDIDA_DECOMPOSITION]
  if metrica == "pid":
      caveats.append(CAVEAT_MEDIDA_PID_CORRECCION)
  if metrica == "escenarios_var":
      caveats.append(CAVEAT_MEDIDA_ESCENARIOS_SPARSITY)
  ```
- NO hay campo `unit` en la respuesta (la unidad va en `metrica.unidad`). `n_puntos`; `rango` observado. `SOURCE_MEDIDA` no se incluye.

### Response model: `MedidaSerieResponse`

```
MedidaSerieResponse
  afore: MedidaAforeRef
  siefore: MedidaSieforeRef
  metrica: MedidaMetricaRef
  n_puntos: int
  rango: SerieRango
  serie: list[MedidaPunto]
  mapping_meta: MedidaMappingMeta
  caveats: list[str]

MedidaAforeRef
  codigo: str
  nombre_corto: str
  tipo_pension: str

MedidaSieforeRef
  slug: str
  nombre: str
  categoria: str

MedidaMetricaRef
  slug: str
  descripcion: str
  unidad: str

MedidaPunto
  fecha: date
  valor: float

MedidaMappingMeta
  is_subvariant_decomposed: bool
  mapping_validated: Optional[bool]
  validated_via: Optional[str]
```

### Errores

- `404` — `detail = f"afore_codigo={afore_codigo!r}, siefore_slug={siefore_slug!r} o metrica={metrica!r} no existe"`.
- `404` — `detail = f"sin datos para ({afore_codigo}, {siefore_slug}, {metrica}). Sub-variants no reportan tracking_error/escenarios_var/pid. escenarios_var es esporádica (76% sparsity incluso en canonical)."`

---

## 24. `GET /api/v1/consar/medidas/snapshot`

- Rate limit: `30/minute`
- `summary`: `Snapshot mensual: matriz (AFORE × SIEFORE) de una métrica para una fecha`
- `description`: `Retorna para una fecha y métrica todas las tuplas (afore, siefore) con su valor. Útil para dashboards comparativos de exposición regulatoria. Cobertura 2019-12 → 2025-06.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `fecha` | `str` | — | sí | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01` |
| `metrica` | `str` | — | sí | debe existir (404) | `slug en consar.cat_metrica_sensibilidad` |

Orden: parse `fecha` → meta métrica (404) → filas (404).

### SQL

Query 1 — `SQL_MEDIDA_SNAPSHOT_META`; binding `{"metrica_slug": metrica}`; `meta_rows[0]`:

```sql
SELECT slug, descripcion, unidad
FROM consar.cat_metrica_sensibilidad WHERE slug = :metrica_slug
```

Query 2 — `SQL_MEDIDA_SNAPSHOT`; binding `{"fecha": d, "metrica_slug": metrica}`:

```sql
SELECT af.codigo AS afore_codigo, af.nombre_corto AS afore_nombre_corto,
       cs.slug AS siefore_slug, cs.nombre AS siefore_nombre, cs.categoria AS siefore_categoria,
       ms.valor::float AS valor
FROM consar.medida_sensibilidad ms
JOIN consar.afores af ON af.id = ms.afore_id
JOIN consar.cat_siefore cs ON cs.id = ms.siefore_id
JOIN consar.cat_metrica_sensibilidad cm ON cm.id = ms.metrica_id
WHERE ms.fecha = :fecha AND cm.slug = :metrica_slug
ORDER BY af.orden_display, cs.orden_display
```

### Post-procesamiento

- `filas` mapeo directo, `valor` crudo; `valor_min = min(...)`, `valor_max = max(...)`.
- `metrica = MedidaMetricaRef(slug=meta["slug"], descripcion=meta["descripcion"], unidad=meta["unidad"])`.
- `caveats = [CAVEAT_MEDIDA_PIVOT, CAVEAT_MEDIDA_DECOMPOSITION]` + `CAVEAT_MEDIDA_PID_CORRECCION` si `metrica == "pid"` + `CAVEAT_MEDIDA_ESCENARIOS_SPARSITY` si `metrica == "escenarios_var"`.

### Response model: `MedidaSnapshotResponse`

```
MedidaSnapshotResponse
  fecha: date
  metrica: MedidaMetricaRef         # (slug, descripcion, unidad)
  n_filas: int
  valor_min: float
  valor_max: float
  filas: list[MedidaSnapshotRow]
  caveats: list[str]

MedidaSnapshotRow
  afore_codigo: str
  afore_nombre_corto: str
  siefore_slug: str
  siefore_nombre: str
  siefore_categoria: str
  valor: float
```

### Errores

- `422` — `_parse_fecha`.
- `404` — `detail = f"metrica={metrica!r} no existe (consultar /metricas-sensibilidad)"`.
- `404` — `detail = f"sin datos para fecha={d.isoformat()} metrica={metrica} (cobertura 2019-12 → 2025-06)"`.

---

## 25. `GET /api/v1/consar/metricas-cuenta`

- Rate limit: `60/minute`
- `summary`: `Catálogo descubrible: 11 métricas operacionales de cuentas administradas`
- `description`: `Retorna las 11 métricas operacionales reportadas en dataset #05 (cuentas_inhabilitadas, total_cuentas_afores, trabajadores_imss/issste/registrados/asignados/independientes, etc.) con su unidad (count BIGINT) y desde_fecha (primera fecha empírica). Útil para clientes que descubren slugs antes de consultar /cuentas/serie, /cuentas/snapshot o /cuentas/sistema.`

### Parámetros

Ninguno.

### SQL (`SQL_METRICAS_CUENTA`, sin parámetros)

```sql
SELECT id, slug, columna_csv, descripcion, unidad, desde_fecha, orden_display, notas
FROM consar.cat_metrica_cuenta
ORDER BY orden_display
```

### Post-procesamiento

- Mapeo directo a `MetricaCuentaRow` (incluye `notas`, que puede ser `None`).
- `n = len(metricas)`; `caveats = [CAVEAT_CUENTA_BIGINT, CAVEAT_CUENTA_DESDE_FECHA, CAVEAT_CUENTA_NO_COMMERCIAL]`.

### Response model: `MetricasCuentaResponse`

```
MetricasCuentaResponse
  n: int
  metricas: list[MetricaCuentaRow]
  caveats: list[str]

MetricaCuentaRow
  id: int
  slug: str
  columna_csv: str
  descripcion: str
  unidad: str
  desde_fecha: date
  orden_display: int
  notas: Optional[str] = None
```

### Errores

Ninguno explícito.

---

## 26. `GET /api/v1/consar/cuentas/serie`

- Rate limit: `60/minute`
- `summary`: `Serie temporal: métrica de cuenta por (AFORE × MÉTRICA)`
- `description`: `Retorna serie mensual de una métrica operacional para una afore commercial. Cobertura por métrica (desde_fecha): 1997-12+ (core), 2001-06+ (asignados), 2012-01+ (subdivisiones bm/siefores), 2005-08+ (independientes/issste), 2024-09+ (cuentas_inhabilitadas reforma 2024). Para etiquetas no-commercial (total_sar, bienestar_010, prestadora_de_servicios) usar /cuentas/sistema.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `afore_codigo` | `str` | — | sí | par debe existir (404) | `codigo en consar.afores (e.g. xxi_banorte, profuturo)` |
| `metrica` | `str` | — | sí | par debe existir (404) | `slug en consar.cat_metrica_cuenta (e.g. trabajadores_imss, total_cuentas_afores)` |

### SQL

Query 1 — `SQL_CUENTA_SERIE_META`; binding `{"afore_codigo": afore_codigo, "metrica_slug": metrica}`; `meta_rows[0]`:

```sql
SELECT
    a.codigo            AS afore_codigo,
    a.nombre_corto      AS afore_nombre_corto,
    a.tipo_pension      AS afore_tipo_pension,
    m.slug              AS metrica_slug,
    m.descripcion       AS metrica_descripcion,
    m.unidad            AS metrica_unidad,
    m.desde_fecha       AS metrica_desde_fecha
FROM consar.afores a, consar.cat_metrica_cuenta m
WHERE a.codigo = :afore_codigo
  AND m.slug   = :metrica_slug
```

Query 2 — `SQL_CUENTA_SERIE`; mismo binding:

```sql
SELECT c.fecha, c.valor
FROM consar.cuenta_administrada c
JOIN consar.afores a              ON a.id = c.afore_id
JOIN consar.cat_metrica_cuenta m  ON m.id = c.metrica_id
WHERE a.codigo = :afore_codigo
  AND m.slug   = :metrica_slug
ORDER BY c.fecha
```

### Post-procesamiento

- `serie = [CuentaPunto(fecha=r["fecha"], valor=r["valor"])]` — `valor` entero crudo (BIGINT).
- `caveats = [CAVEAT_CUENTA_BIGINT, CAVEAT_CUENTA_DESDE_FECHA]`; si `metrica == "cuentas_inhabilitadas"` se anexa `CAVEAT_CUENTA_IDENTIDAD_SAR`.
- `n_puntos`; `rango` observado.

### Response model: `CuentaSerieResponse`

```
CuentaSerieResponse
  afore: CuentaAforeRef
  metrica: CuentaMetricaRef
  n_puntos: int
  rango: SerieRango
  serie: list[CuentaPunto]
  caveats: list[str]

CuentaAforeRef
  codigo: str
  nombre_corto: str
  tipo_pension: str

CuentaMetricaRef
  slug: str
  descripcion: str
  unidad: str
  desde_fecha: date

CuentaPunto
  fecha: date
  valor: int
```

### Errores

- `404` — `detail = f"afore_codigo={afore_codigo!r} o metrica={metrica!r} no existe (consultar /metricas-cuenta)"`.
- `404` — `detail = f"sin datos para ({afore_codigo}, {metrica}). Cobertura desde {meta['metrica_desde_fecha']} (ver desde_fecha en /metricas-cuenta). Algunas afores comerciales no operaron desde 1997 (e.g. azteca, coppel, invercap)."` (la fecha se interpola con `str(date)` → `YYYY-MM-DD`).

---

## 27. `GET /api/v1/consar/cuentas/snapshot`

- Rate limit: `30/minute`
- `summary`: `Snapshot mensual: matriz (AFORE × MÉTRICA) en una fecha`
- `description`: `Retorna para una fecha todas las tuplas (afore commercial, métrica) con su valor. Útil para dashboards comparativos de operación administrativa. Cobertura 1997-12 → 2025-06 (algunas afores no operaron desde 1997).`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `fecha` | `str` | — | sí | `_parse_fecha` (422) | `YYYY-MM o YYYY-MM-01` |

### SQL (`SQL_CUENTA_SNAPSHOT`; binding `{"fecha": d}`)

```sql
SELECT a.codigo            AS afore_codigo,
       a.nombre_corto      AS afore_nombre_corto,
       m.slug              AS metrica_slug,
       m.descripcion       AS metrica_descripcion,
       c.valor             AS valor
FROM consar.cuenta_administrada c
JOIN consar.afores a              ON a.id = c.afore_id
JOIN consar.cat_metrica_cuenta m  ON m.id = c.metrica_id
WHERE c.fecha = :fecha
ORDER BY m.orden_display, a.codigo
```

### Post-procesamiento

- Mapeo directo; `n_filas = len(filas)`.
- `caveats = [CAVEAT_CUENTA_BIGINT, CAVEAT_CUENTA_DESDE_FECHA, CAVEAT_CUENTA_NO_COMMERCIAL]`.

### Response model: `CuentaSnapshotResponse`

```
CuentaSnapshotResponse
  fecha: date
  n_filas: int
  filas: list[CuentaSnapshotRow]
  caveats: list[str]

CuentaSnapshotRow
  afore_codigo: str
  afore_nombre_corto: str
  metrica_slug: str
  metrica_descripcion: str
  valor: int
```

### Errores

- `422` — `_parse_fecha`.
- `404` — `detail = f"sin datos para fecha={d.isoformat()} (cobertura 1997-12 → 2025-06)"`.

---

## 28. `GET /api/v1/consar/cuentas/sistema`

- Rate limit: `60/minute`
- `summary`: `Serie sistema: 3 etiquetas no-commercial (total SAR + bienestar + prestadora)`
- `description`: `Retorna serie temporal de las 3 etiquetas no-commercial agrupadas: total_cuentas_sar (sistema_total), cuentas_bienestar_010 (sistema_categoria_especial), prestadora_de_servicios (administrativa_especial). Permite componer la identidad SAR triple-capa en frontend. Cada etiqueta reporta UNA métrica específica: total_cuentas_sar reporta total_cuentas_sar; cuentas_bienestar_010 reporta cuentas_bienestar_010; prestadora_de_servicios reporta cuentas_inhabilitadas.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `metrica` | `str` | — | sí | debe existir (404) | `slug en consar.cat_metrica_cuenta (e.g. total_cuentas_sar, cuentas_bienestar_010, cuentas_inhabilitadas)` |

### SQL (tres consultas, en este orden, misma conexión)

Query 1 — `SQL_CUENTA_SISTEMA_META`; binding `{"metrica_slug": metrica}`:

```sql
SELECT slug, descripcion, unidad, desde_fecha
FROM consar.cat_metrica_cuenta
WHERE slug = :metrica_slug
```

Query 2 — `SQL_CUENTA_SISTEMA_ETIQUETAS`; sin parámetros (se devuelven TODAS las etiquetas, no solo las presentes en la serie):

```sql
SELECT slug, nombre_display, categoria
FROM consar.cat_cuenta_etiqueta_agg
ORDER BY id
```

Query 3 — `SQL_CUENTA_SISTEMA_SERIE`; binding `{"metrica_slug": metrica}`:

```sql
SELECT g.fecha,
       e.slug      AS etiqueta_slug,
       e.categoria AS etiqueta_categoria,
       m.slug      AS metrica_slug,
       g.valor
FROM consar.cuenta_administrada_agg g
JOIN consar.cat_cuenta_etiqueta_agg e ON e.id = g.etiqueta_id
JOIN consar.cat_metrica_cuenta m      ON m.id = g.metrica_id
WHERE m.slug = :metrica_slug
ORDER BY g.fecha, e.id
```

### Post-procesamiento

- `etiquetas = [CuentaSistemaEtiquetaRef(slug, nombre_display, categoria)]` de la Query 2.
- `metricas = [CuentaMetricaRef(slug, descripcion, unidad, desde_fecha)]` — lista con UN solo elemento (`meta_rows[0]`).
- `serie = [CuentaSistemaPunto(fecha, etiqueta_slug, etiqueta_categoria, metrica_slug, valor)]` crudo.
- `n_puntos = len(serie)`.
- `caveats = [CAVEAT_CUENTA_BIGINT, CAVEAT_CUENTA_NO_COMMERCIAL, CAVEAT_CUENTA_IDENTIDAD_SAR]`.

### Response model: `CuentaSistemaResponse`

```
CuentaSistemaResponse
  n_puntos: int
  etiquetas: list[CuentaSistemaEtiquetaRef]
  metricas: list[CuentaMetricaRef]
  serie: list[CuentaSistemaPunto]
  caveats: list[str]

CuentaSistemaEtiquetaRef
  slug: str
  nombre_display: str
  categoria: str

CuentaMetricaRef
  slug: str
  descripcion: str
  unidad: str
  desde_fecha: date

CuentaSistemaPunto
  fecha: date
  etiqueta_slug: str
  etiqueta_categoria: str
  metrica_slug: str
  valor: int
```

### Errores

- `404` — `detail = f"metrica={metrica!r} no existe (consultar /metricas-cuenta)"`.
- `404` — `detail = f"sin datos no-commercial para metrica={metrica}. Solo 3 métricas tienen datos en /cuentas/sistema: total_cuentas_sar (sentinel SAR), cuentas_bienestar_010 (reforma 2024), cuentas_inhabilitadas (sólo prestadora reporta esta como agg)."`

---

## 29. `GET /api/v1/consar/precios/serie`

- Rate limit: `60/minute`
- `summary`: `Serie diaria NAV: precio por (AFORE × SIEFORE)`
- `description`: `Retorna serie diaria de precios NAV (Net Asset Value) en MXN para una tupla (afore, siefore). Cobertura más profunda del proyecto: 1997-01-08 → 2025-12-06 (28 años). Ventana opcional desde/hasta para reducir payload.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `afore_codigo` | `str` | — | sí | par debe existir (404) | `codigo en consar.afores (e.g. xxi_banorte, profuturo)` |
| `siefore_slug` | `str` | — | sí | par debe existir (404) | `slug en consar.cat_siefore (e.g. sb 60-64, sps3, siav)` |
| `desde` | `Optional[str]` | `None` | no | `_parse_fecha_dia` (422) | `YYYY-MM-DD opcional` |
| `hasta` | `Optional[str]` | `None` | no | `_parse_fecha_dia` (422) | `YYYY-MM-DD opcional` |

NO se valida `desde <= hasta` en este endpoint.

### SQL

Query 1 — `SQL_PRECIO_SERIE_META`; binding `{"afore_codigo", "siefore_slug"}`; `meta_rows[0]`:

```sql
SELECT
    a.codigo            AS afore_codigo,
    a.nombre_corto      AS afore_nombre_corto,
    a.tipo_pension      AS afore_tipo_pension,
    s.slug              AS siefore_slug,
    s.nombre            AS siefore_nombre,
    s.categoria         AS siefore_categoria
FROM consar.afores a, consar.cat_siefore s
WHERE a.codigo = :afore_codigo
  AND s.slug   = :siefore_slug
```

Query 2 — `SQL_PRECIO_SERIE`; binding `{"afore_codigo": afore_codigo, "siefore_slug": siefore_slug, "desde": desde_d, "hasta": hasta_d}` (`desde_d`/`hasta_d` son `date` o `None`):

```sql
SELECT p.fecha, p.precio
FROM consar.precio_bolsa p
JOIN consar.afores a       ON a.id = p.afore_id
JOIN consar.cat_siefore s  ON s.id = p.siefore_id
WHERE a.codigo = :afore_codigo
  AND s.slug   = :siefore_slug
  AND (CAST(:desde AS DATE) IS NULL OR p.fecha >= CAST(:desde AS DATE))
  AND (CAST(:hasta AS DATE) IS NULL OR p.fecha <= CAST(:hasta AS DATE))
ORDER BY p.fecha
```

### Post-procesamiento

- `serie = [PrecioPunto(fecha=r["fecha"], precio=float(r["precio"]))]` (`precio` en BD es `numeric`; se convierte con `float()`, sin redondeo).
- `precio_min = min(precios)`; `precio_max = max(precios)`.
- `n_puntos`; `rango` observado (`serie[0].fecha`, `serie[-1].fecha`), NO la ventana solicitada.
- `caveats = [CAVEAT_PRECIO_NAV, CAVEAT_PRECIO_COBERTURA, CAVEAT_PRECIO_BANAMEX_MERGE]`.

### Response model: `PrecioSerieResponse`

```
PrecioSerieResponse
  afore: PrecioAforeRef
  siefore: PrecioSieforeRef
  n_puntos: int
  rango: SerieRango
  precio_min: float
  precio_max: float
  serie: list[PrecioPunto]
  caveats: list[str]

PrecioAforeRef
  codigo: str
  nombre_corto: str
  tipo_pension: str

PrecioSieforeRef
  slug: str
  nombre: str
  categoria: str

PrecioPunto
  fecha: date
  precio: float
```

### Errores

- `422` — `_parse_fecha_dia` (`detail = "fecha inválida (esperado YYYY-MM-DD): <ValueError>"`).
- `404` — `detail = f"afore_codigo={afore_codigo!r} o siefore_slug={siefore_slug!r} no existe"`.
- `404` sin filas — `detail = f"sin datos para ({afore_codigo}, {siefore_slug})" + (f" en ventana [{desde}, {hasta}]" if desde or hasta else "") + ". Verificar disponibilidad histórica de la combinación."` (`desde`/`hasta` se interpolan como las CADENAS originales; si solo uno se dio, el otro aparece como `None`).

---

## 30. `GET /api/v1/consar/precios/snapshot`

- Rate limit: `30/minute`
- `summary`: `Snapshot diario: matriz (AFORE × SIEFORE) en una fecha`
- `description`: `Retorna para una fecha de mercado todos los pares (afore commercial × siefore) con su precio NAV. Útil para dashboards comparativos diarios. Si fecha no es hábil → 404 (verificar disponibilidad).`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `fecha` | `str` | — | sí | `_parse_fecha_dia` (422) | `YYYY-MM-DD (fecha hábil de mercado)` |

### SQL (`SQL_PRECIO_SNAPSHOT`; binding `{"fecha": d}`)

```sql
SELECT a.codigo            AS afore_codigo,
       a.nombre_corto      AS afore_nombre_corto,
       s.slug              AS siefore_slug,
       s.nombre            AS siefore_nombre,
       s.categoria         AS siefore_categoria,
       p.precio
FROM consar.precio_bolsa p
JOIN consar.afores a       ON a.id = p.afore_id
JOIN consar.cat_siefore s  ON s.id = p.siefore_id
WHERE p.fecha = :fecha
ORDER BY s.orden_display, a.codigo
```

### Post-procesamiento

- `filas` mapeo directo con `precio=float(r["precio"])`.
- `precio_min = min(f.precio)`; `precio_max = max(f.precio)`; `n_filas = len(filas)`.
- `caveats = [CAVEAT_PRECIO_NAV, CAVEAT_PRECIO_COBERTURA, CAVEAT_PRECIO_BANAMEX_MERGE]`.

### Response model: `PrecioSnapshotResponse`

```
PrecioSnapshotResponse
  fecha: date
  n_filas: int
  precio_min: float
  precio_max: float
  filas: list[PrecioSnapshotRow]
  caveats: list[str]

PrecioSnapshotRow
  afore_codigo: str
  afore_nombre_corto: str
  siefore_slug: str
  siefore_nombre: str
  siefore_categoria: str
  precio: float
```

### Errores

- `422` — `_parse_fecha_dia`.
- `404` — `detail = f"sin datos para fecha={d.isoformat()}. Probable día no-hábil de mercado. Cobertura: 1997-01-08 → 2025-12-06 (M-V principalmente)."`

---

## 31. `GET /api/v1/consar/precios/comparativo`

- Rate limit: `30/minute`
- `summary`: `Comparativo: misma SIEFORE entre N afores en ventana temporal`
- `description`: `Retorna serie diaria de precio NAV de la misma siefore para todas las afores que la reportan, dentro de una ventana temporal OBLIGATORIA. Caso de uso: comparar performance NAV entre afores. La ventana es obligatoria para protección del server (payload sin ventana podría ser 7K×11=77K puntos).`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `siefore_slug` | `str` | — | sí | debe existir (404) | `slug en consar.cat_siefore` |
| `desde` | `str` | — | sí | `_parse_fecha_dia` (422) | `YYYY-MM-DD (obligatorio)` |
| `hasta` | `str` | — | sí | `_parse_fecha_dia` (422); `hasta < desde` → 422 | `YYYY-MM-DD (obligatorio)` |

Orden: parse `desde` → parse `hasta` → `hasta_d < desde_d` (422) → meta (404) → series (404).

### SQL

Query 1 — `SQL_PRECIO_COMPARATIVO_META`; binding `{"siefore_slug": siefore_slug}`; `meta_rows[0]`:

```sql
SELECT slug, nombre, categoria
FROM consar.cat_siefore
WHERE slug = :siefore_slug
```

Query 2 — `SQL_PRECIO_COMPARATIVO_SERIES`; binding `{"siefore_slug": siefore_slug, "desde": desde_d, "hasta": hasta_d}`:

```sql
SELECT a.codigo            AS afore_codigo,
       a.nombre_corto      AS afore_nombre_corto,
       p.fecha,
       p.precio
FROM consar.precio_bolsa p
JOIN consar.afores a       ON a.id = p.afore_id
JOIN consar.cat_siefore s  ON s.id = p.siefore_id
WHERE s.slug   = :siefore_slug
  AND p.fecha >= CAST(:desde AS DATE)
  AND p.fecha <= CAST(:hasta AS DATE)
ORDER BY a.codigo, p.fecha
```

### Post-procesamiento

```python
by_afore = {}                                   # dict con orden de inserción = ORDER BY a.codigo
for r in rows:
    ac = r["afore_codigo"]
    if ac not in by_afore:
        by_afore[ac] = {"afore_codigo": ac, "afore_nombre_corto": r["afore_nombre_corto"], "puntos": []}
    by_afore[ac]["puntos"].append(PrecioPunto(fecha=r["fecha"], precio=float(r["precio"])))
series = [PrecioComparativoSerieAfore(afore_codigo=..., afore_nombre_corto=..., n_puntos=len(puntos), serie=puntos)
          for v in by_afore.values()]
```

- `series` ordenadas alfabéticamente por `afore_codigo` (orden SQL), puntos por `fecha`.
- `rango = SerieRango(desde=desde_d, hasta=hasta_d)` — ventana SOLICITADA.
- `n_afores = len(series)`.
- `caveats = [CAVEAT_PRECIO_NAV, CAVEAT_PRECIO_COBERTURA, CAVEAT_PRECIO_BANAMEX_MERGE]`.

### Response model: `PrecioComparativoResponse`

```
PrecioComparativoResponse
  siefore: PrecioSieforeRef         # (slug, nombre, categoria)
  rango: SerieRango
  n_afores: int
  series: list[PrecioComparativoSerieAfore]
  caveats: list[str]

PrecioComparativoSerieAfore
  afore_codigo: str
  afore_nombre_corto: str
  n_puntos: int
  serie: list[PrecioPunto]          # (fecha: date, precio: float)
```

### Errores

- `422` — `_parse_fecha_dia`.
- `422` — `detail = "hasta < desde"`.
- `404` — `detail = f"siefore_slug={siefore_slug!r} no existe"`.
- `404` — `detail = f"sin datos para siefore_slug={siefore_slug!r} en ventana [{desde}, {hasta}]"` (cadenas originales).

---

## 32. `GET /api/v1/consar/precios-gestion/serie`

- Rate limit: `60/minute`
- `summary`: `Serie diaria gestión: precio interno por (AFORE × SIEFORE)`
- `description`: `Retorna serie diaria de precios de gestión interna en MXN para una tupla (afore, siefore). Cobertura 1997-01-07 → 2025-12-06 (28+ años, 7,060 fechas). Range NAV +30% vs precio_bolsa: distinta base/comisión. NO incluye PensionISSSTE.`
- Reusa los modelos `Precio*` del dataset #01 (estructura idéntica).

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `afore_codigo` | `str` | — | sí | par debe existir (404) | `codigo en consar.afores (NO incluye pensionissste en #11)` |
| `siefore_slug` | `str` | — | sí | par debe existir (404) | `slug en consar.cat_siefore (incluye sb5 legacy XXI)` |
| `desde` | `Optional[str]` | `None` | no | `_parse_fecha_dia` (422) | `YYYY-MM-DD opcional` |
| `hasta` | `Optional[str]` | `None` | no | `_parse_fecha_dia` (422) | `YYYY-MM-DD opcional` |

NO se valida `desde <= hasta`.

### SQL

Query 1 — `SQL_GESTION_SERIE_META`; binding `{"afore_codigo", "siefore_slug"}`; `meta_rows[0]`:

```sql
SELECT
    a.codigo            AS afore_codigo,
    a.nombre_corto      AS afore_nombre_corto,
    a.tipo_pension      AS afore_tipo_pension,
    s.slug              AS siefore_slug,
    s.nombre            AS siefore_nombre,
    s.categoria         AS siefore_categoria
FROM consar.afores a, consar.cat_siefore s
WHERE a.codigo = :afore_codigo
  AND s.slug   = :siefore_slug
```

Query 2 — `SQL_GESTION_SERIE`; binding `{"afore_codigo", "siefore_slug", "desde": desde_d, "hasta": hasta_d}`:

```sql
SELECT p.fecha, p.precio
FROM consar.precio_gestion p
JOIN consar.afores a       ON a.id = p.afore_id
JOIN consar.cat_siefore s  ON s.id = p.siefore_id
WHERE a.codigo = :afore_codigo
  AND s.slug   = :siefore_slug
  AND (CAST(:desde AS DATE) IS NULL OR p.fecha >= CAST(:desde AS DATE))
  AND (CAST(:hasta AS DATE) IS NULL OR p.fecha <= CAST(:hasta AS DATE))
ORDER BY p.fecha
```

### Post-procesamiento

Idéntico a `/precios/serie` (`float(precio)`, `precio_min/max`, `rango` observado), salvo:
- `caveats = [CAVEAT_GESTION_PRECIO, CAVEAT_GESTION_COBERTURA, CAVEAT_GESTION_BANAMEX_MERGE, CAVEAT_GESTION_XXI_LEGACY, CAVEAT_GESTION_NO_PENSIONISSSTE]`.

### Response model: `PrecioSerieResponse` (ver endpoint 29; mismos campos y anidados).

### Errores

- `422` — `_parse_fecha_dia`.
- `404` — `detail = f"afore_codigo={afore_codigo!r} o siefore_slug={siefore_slug!r} no existe"`.
- `404` sin filas — `detail = f"sin datos para ({afore_codigo}, {siefore_slug})" + (f" en ventana [{desde}, {hasta}]" if desde or hasta else "") + ". Verificar disponibilidad histórica de la combinación. PensionISSSTE NO aparece en gestión interna."`

---

## 33. `GET /api/v1/consar/precios-gestion/snapshot`

- Rate limit: `30/minute`
- `summary`: `Snapshot gestión: matriz (AFORE × SIEFORE) en una fecha`
- `description`: `Retorna para una fecha de mercado todos los pares (afore × siefore) con su precio de gestión interna. Útil para dashboards comparativos diarios. Si fecha no es hábil → 404. NO incluye PensionISSSTE.`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `fecha` | `str` | — | sí | `_parse_fecha_dia` (422) | `YYYY-MM-DD (fecha hábil de mercado)` |

### SQL (`SQL_GESTION_SNAPSHOT`; binding `{"fecha": d}`)

```sql
SELECT a.codigo            AS afore_codigo,
       a.nombre_corto      AS afore_nombre_corto,
       s.slug              AS siefore_slug,
       s.nombre            AS siefore_nombre,
       s.categoria         AS siefore_categoria,
       p.precio
FROM consar.precio_gestion p
JOIN consar.afores a       ON a.id = p.afore_id
JOIN consar.cat_siefore s  ON s.id = p.siefore_id
WHERE p.fecha = :fecha
ORDER BY s.orden_display, a.codigo
```

### Post-procesamiento

Idéntico a `/precios/snapshot` salvo `caveats = [CAVEAT_GESTION_PRECIO, CAVEAT_GESTION_COBERTURA, CAVEAT_GESTION_BANAMEX_MERGE, CAVEAT_GESTION_XXI_LEGACY, CAVEAT_GESTION_NO_PENSIONISSSTE]`.

### Response model: `PrecioSnapshotResponse` (ver endpoint 30).

### Errores

- `422` — `_parse_fecha_dia`.
- `404` — `detail = f"sin datos para fecha={d.isoformat()}. Probable día no-hábil de mercado. Cobertura: 1997-01-07 → 2025-12-06 (M-V principalmente)."`

---

## 34. `GET /api/v1/consar/precios-gestion/comparativo`

- Rate limit: `30/minute`
- `summary`: `Comparativo gestión: misma SIEFORE entre N afores en ventana`
- `description`: `Retorna serie diaria de precio gestión interna de la misma siefore para todas las afores que la reportan, dentro de una ventana temporal OBLIGATORIA. Caso de uso: comparar performance gestión interna entre afores. La ventana es obligatoria para protección del server (payload sin ventana podría ser 7K×10=70K puntos).`

### Parámetros (query)

| nombre | tipo | default | requerido | validación | description |
|---|---|---|---|---|---|
| `siefore_slug` | `str` | — | sí | debe existir (404) | `slug en consar.cat_siefore` |
| `desde` | `str` | — | sí | `_parse_fecha_dia` (422) | `YYYY-MM-DD (obligatorio)` |
| `hasta` | `str` | — | sí | `_parse_fecha_dia` (422); `hasta < desde` → 422 | `YYYY-MM-DD (obligatorio)` |

### SQL

Query 1 — `SQL_GESTION_COMPARATIVO_META`; binding `{"siefore_slug": siefore_slug}`:

```sql
SELECT slug, nombre, categoria
FROM consar.cat_siefore
WHERE slug = :siefore_slug
```

Query 2 — `SQL_GESTION_COMPARATIVO_SERIES`; binding `{"siefore_slug", "desde": desde_d, "hasta": hasta_d}`:

```sql
SELECT a.codigo            AS afore_codigo,
       a.nombre_corto      AS afore_nombre_corto,
       p.fecha,
       p.precio
FROM consar.precio_gestion p
JOIN consar.afores a       ON a.id = p.afore_id
JOIN consar.cat_siefore s  ON s.id = p.siefore_id
WHERE s.slug   = :siefore_slug
  AND p.fecha >= CAST(:desde AS DATE)
  AND p.fecha <= CAST(:hasta AS DATE)
ORDER BY a.codigo, p.fecha
```

### Post-procesamiento

Idéntico a `/precios/comparativo` (agrupación por `afore_codigo` en orden de inserción, `rango` solicitado, `n_afores`), salvo `caveats = [CAVEAT_GESTION_PRECIO, CAVEAT_GESTION_COBERTURA, CAVEAT_GESTION_BANAMEX_MERGE, CAVEAT_GESTION_XXI_LEGACY, CAVEAT_GESTION_NO_PENSIONISSSTE]`.

### Response model: `PrecioComparativoResponse` (ver endpoint 31).

### Errores

- `422` — `_parse_fecha_dia`.
- `422` — `detail = "hasta < desde"`.
- `404` — `detail = f"siefore_slug={siefore_slug!r} no existe"`.
- `404` — `detail = f"sin datos para siefore_slug={siefore_slug!r} en ventana [{desde}, {hasta}]"`.

---

## Catálogos y constantes

Todas las cadenas se transcriben con su valor efectivo (en el código son literales adyacentes concatenados por Python). Se listan en el orden en que aparecen en el módulo.

### Infraestructura del router

```python
router = APIRouter(prefix="/api/v1/consar", tags=["consar"])

_RESP_429_CONSAR = {"model": HTTPError429, "description": "Rate limit excedido."}
_CONSAR_GENERIC_EXAMPLE = {
    "count": 11,
    "fecha": "2025-06-01",
    "source": "CONSAR — Sistema de Ahorro para el Retiro",
}
```

### Cadenas `unit` literales usadas en respuestas

- `"millones de pesos MXN corrientes"` — endpoints 3, 4, 5, 6, 7, 8, 11, 12, 16, 17, 18.
- `"porcentaje anual sobre saldo administrado"` — endpoints 9, 10.
- `"porcentaje anualizado neto"` — endpoints 19, 20, 21.

### Fechas por defecto y sentinelas

| endpoint | `desde` default | `hasta` default |
|---|---|---|
| `/recursos/serie` | `date(1998, 5, 1)` | `date(2025, 6, 1)` |
| `/comisiones/serie` | `date(2008, 3, 1)` | `date(2025, 6, 1)` |
| `/flujos/serie` | `date(2009, 1, 1)` | `date(2025, 6, 1)` |
| `/traspasos/serie` | `date(1998, 11, 1)` | `date(2025, 6, 1)` |
| `/precios/serie`, `/precios-gestion/serie` | `None` (sin filtro) | `None` (sin filtro) |

Umbrales / sentinelas numéricos:
- `cierre_al_peso = abs(delta_abs) <= 0.05` (endpoint 7).
- `cierre_al_unidad = (delta == 0)` (endpoint 14).
- `is_subvariant_decomposed = (asa_validated is not None)` (endpoints 16, 19, 23).

### Tuplas de validación

```python
COMPONENTES_IDENTIDAD = (
    "rcv_imss",
    "rcv_issste",
    "bono_pension_issste",
    "vivienda",
    "ahorro_voluntario_y_solidario",
    "capital_afores",
    "banxico",
    "fondos_prevision_social",
)

PLAZOS_VALIDOS = ("12_meses", "24_meses", "36_meses", "5_anios", "historico")
```

Categorías válidas de `/activo-neto/agregado` (literal inline, no constante nombrada):
`("act_neto_total_siefores", "act_neto_total_basicas", "act_neto_total_adicionales")`

AFORE excluida por SQL en snapshots de comisiones, flujos y traspasos: `'pension_bienestar'`.

### Caveats — recursos (dataset #09)

`CAVEAT_UNIDAD`:
```
Montos en millones de pesos MXN CORRIENTES (no deflactados). Para comparaciones históricas reales, deflactar con INPC BASE 2018=100 INEGI.
```

`CAVEAT_PENSION_BIENESTAR`:
```
Pensión Bienestar (FPB9) tiene serie corta: inicio 2024-07-01, régimen administrativo diferenciado (reporta solo 2 de 15 conceptos).
```

`CAVEAT_FONDOS_PREV`:
```
fondos_prevision_social es EXCLUSIVO de XXI-Banorte (reportado desde 2009-02). Para otras AFOREs este componente es 0 por construcción.
```

`CAVEAT_BONO_ISSSTE`:
```
bono_pension_issste arranca 2008-12 con la reforma ISSSTE 2007; reconoce aportaciones realizadas bajo el régimen previo.
```

`CAVEAT_BANXICO`:
```
recursos_depositados_banxico captura cuentas asignadas sin AFORE elegida. Se reporta a nivel sistema desde 2012-01; cobertura parcial antes.
```

`CAVEAT_IDENTIDAD_SAR`:
```
Identidad contable sar_total = rcv_imss + rcv_issste + bono_pension_issste + vivienda + ahorro_voluntario_y_solidario + capital_afores + banxico + fondos_prevision_social. Verificada empíricamente: cierre al peso (Δ ≤ 0.05 mm MXN) en 98.83% de filas; cierre al peso en 100% de filas 2020+. Residuo de 24 filas concentrado 100% en XXI-Banorte 2010-2012 (probable artefacto transitorio post-introducción de fondos_prevision_social).
```

`CAVEAT_AHORRO_PRE_DESAGREGACION`:
```
Caveat ahorro_voluntario / ahorro_solidario en 2009-01..08: en el refresh del 2026-02-27 CONSAR cambió la convención de 'missing' para los meses previos a la desagregación voluntario/solidario. Esos 8 meses ahora se publican con los componentes ahorro_voluntario y ahorro_solidario en 0.0 (antes eran celdas vacías). El agregado ahorro_voluntario_y_solidario para esos meses sí reporta el monto histórico real (~570-601 mm MXN por AFORE), por lo que la identidad ahorro_voluntario_y_solidario = ahorro_voluntario + ahorro_solidario NO se cumple en esos 8 meses para 9 AFOREs (72 filas) — y eso es fiel a la fuente, no error de ingesta. Tratar esos ceros como ausencia de información, no como ahorro cero real.
```

`SOURCE_CONSAR` (usado en endpoints 1 y 3):
```
CONSAR vía datos.gob.mx (CC-BY-4.0) — https://repodatos.atdt.gob.mx/api_update/consar/monto_recursos_registrados_afore/09_recursos.csv
```

Caveats inline (no constantes) de `/recursos/imss-vs-issste`:
```
RCV-ISSSTE reportado de forma consistente desde 2008-12 con la reforma ISSSTE; puntos anteriores pueden mostrar cero.
```
```
RCV-IMSS cubre trabajadores privados afiliados al IMSS; RCV-ISSSTE cubre trabajadores públicos. PensionISSSTE es la AFORE pública pero todas las AFOREs manejan ambos tipos de cuenta.
```

Caveat inline de `/recursos/serie` cuando `codigo == "rcv_issste"`:
```
RCV-ISSSTE reportado de forma consistente desde 2008-12 con la reforma ISSSTE.
```

### Caveats — comisiones (dataset #06)

`CAVEAT_COMISION_BIENESTAR`:
```
Pensión Bienestar (FPB9) NO reporta comisión: régimen administrativo diferenciado (serie comienza 2024-07-01 con esquema sin comisión sobre saldo).
```

`CAVEAT_COMISION_REFORMA`:
```
Cobertura empieza 2008-03-01 con la reforma de transparencia CONSAR. Tendencia secular descendente: cap regulatorio fue bajando ~1.96% (2008) → ~0.55% (2025).
```

`SOURCE_COMISIONES` (definido, NO usado en ninguna respuesta):
```
CONSAR vía datos.gob.mx (CC-BY-4.0) — datasets/06_comisiones — actualizado a 2025-06-01.
```

### Caveats — flujos (dataset #04)

`CAVEAT_FLUJO_BIENESTAR`:
```
Pensión Bienestar (FPB9) NO reporta en este dataset (régimen administrativo diferenciado). Solo 10 de las 11 AFOREs aparecen en flujos.
```

`CAVEAT_FLUJO_COBERTURA`:
```
Cobertura empieza 2009-01-01. CSV original es rectangular sin celdas faltantes (todas las afores reportan en todos los meses dentro de la cobertura).
```

### Caveats — traspasos (dataset #08)

`CAVEAT_TRASPASO_BIENESTAR`:
```
Pensión Bienestar (FPB9) NO reporta este dataset (régimen administrativo diferenciado). Solo 10 de las 11 AFOREs aparecen en traspasos.
```

`CAVEAT_TRASPASO_NULLS`:
```
Filas con num_tras_cedido y num_tras_recibido ambos NULL representan meses previos al alta de la AFORE en el sistema (336 filas en el corte 2025-06).
```

`CAVEAT_TRASPASO_IDENTIDAD`:
```
Identidad implícita Σ cedidos = Σ recibidos (cada traspaso es 1 cedido + 1 recibido). Verificada empíricamente: cierre exacto en 100% de meses 2021-2025; residuo histórico concentrado pre-2020 (39% global de 282 meses con datos). Probable explicación: cancelaciones, cuentas asignadas Banxico, ajustes administrativos antes de estandarización de reportes.
```

### Caveats — PEA vs cotizantes (dataset #02)

`CAVEAT_PEA_COBERTURA_INTERPRETACION`:
```
porcentaje_pea_afore mide cobertura formal del SAR sobre la PEA. La diferencia con 100 (brecha_no_cubierta_pct) integra informalidad laboral, desempleo y trabajadores elegibles que aún no se han registrado. No es índice de fracaso del SAR sino reflejo del mercado laboral mexicano.
```

`CAVEAT_PEA_FUENTES`:
```
PEA y cotizantes vienen de fuentes distintas (INEGI ENOE para PEA, CONSAR para cotizantes); CONSAR publica el ratio precalculado en este dataset.
```

`SOURCE_PEA` (se pasa al constructor pero el modelo lo descarta; NO aparece en el JSON):
```
CONSAR vía datos.gob.mx (CC-BY-4.0) — datasets/02_pea_vs_cotizantes — actualizado a 2024.
```

### Caveats — activo neto (dataset #07)

`CAVEAT_ACTIVO_NETO_UNIDAD` (texto idéntico a `CAVEAT_UNIDAD`):
```
Montos en millones de pesos MXN CORRIENTES (no deflactados). Para comparaciones históricas reales, deflactar con INPC BASE 2018=100 INEGI.
```

`CAVEAT_ACTIVO_NETO_NULLS`:
```
NULLs preservados (670 totales en CSV oficial): 560 en sb 95-99 + 110 en sb 55-59. Sparsity estructural por cohortes tardías: algunas afores no reportan esos buckets en todos los meses.
```

`CAVEAT_ACTIVO_NETO_DECOMPOSITION`:
```
Sub-variants concat de #07 (xxi banorte 1..10, sura av1..3, profuturo cp/lp, banamex av plus, xxi banorte ahorro individual) descomponen a tuplas atómicas (afore × siefore) vía consar.afore_siefore_alias. Profuturo cp/lp y Sura av1 confirmados por docs CONSAR; Sura av2/av3 mapeados por inferencia lexicográfica + bijection con #10 (mapping_validated=FALSE).
```

`CAVEAT_ACTIVO_NETO_AGG_ADICIONALES`:
```
Categoría act_neto_total_adicionales tiene 0 rows: el CSV oficial no reporta el agregado de siefores adicionales a nivel afore commercial. Los 1,139 rows con tipo='adicionales' son sub-variants que se descomponen a activo_neto atómico. Schema preparado para futura publicación CONSAR.
```

`SOURCE_ACTIVO_NETO` (definido, NO usado):
```
CONSAR vía datos.gob.mx (CC-BY-4.0) — datasets/07_activos_netos — cobertura 2019-12 → 2025-06.
```

### Caveats — rendimientos (dataset #10)

`CAVEAT_RENDIMIENTO_UNIDAD`:
```
Rendimientos en porcentaje anualizado neto reportado por CONSAR. Plazos 12_meses/24_meses/36_meses/5_anios son ventanas rolling; historico es rendimiento histórico desde inicio del SAR (sólo publicado para sb 60-64).
```

`CAVEAT_RENDIMIENTO_HISTORICO`:
```
plazo='historico' sólo se publica para sb 60-64 (siefore generacional principal post-reforma 2019). Las otras 11 siefores no tienen serie histórica — coherente con la introducción del régimen generacional en la reforma SB 2019; cohortes 55-59 y 65-69+ no existían bajo el régimen previo.
```

`CAVEAT_RENDIMIENTO_DECOMPOSITION`:
```
Sub-variants concat de #10 (banamex(siav2), profuturo(sac/siav), sura(siav/siav1/siav2), xxi-banorte(siav/sps1..sps10) — 17 strings) descomponen a tuplas atómicas (afore × siefore) vía consar.afore_siefore_alias (fuente_csv='#10'). 15 de 17 docs-confirmed; sura(siav2) y (siav1) inferencia lexicográfica con bijection con #07 (mapping_validated expuesto).
```

`CAVEAT_RENDIMIENTO_SIS`:
```
rendimiento_sis es agregado INTER-afore (sistema completo): promedio ponderado CONSAR sobre todas las afores que ofrecen cada siefore. Distinto de activo_neto_agg de #07 que es agregado INTRA-afore (cada afore reporta totales propios).
```

`CAVEAT_RENDIMIENTO_RANGE` (definido, NO usado en ninguna respuesta):
```
Range observado en cobertura 2019-12 → 2025-06: [-11.4729%, +27.1712%]. Negativos representan caídas reales del valor de los recursos administrados.
```

`SOURCE_RENDIMIENTO` (definido, NO usado):
```
CONSAR vía datos.gob.mx (CC-BY-4.0) — datasets/10_rendimientos_precio_bolsa — cobertura 2019-12 → 2025-06 (67 fechas mensuales × 5 plazos).
```

### Caveats — medidas de sensibilidad (dataset #03)

`CAVEAT_MEDIDA_PIVOT`:
```
Long-format derivado de pivot wide→long del CSV oficial #03 (7,840 wide rows × 7 métricas → 46,657 long rows). Skip-empties: solo se materializa una fila cuando valor != '' en CSV. NULLs no se almacenan; consultar con metrica_slug específica para obtener la cobertura real.
```

`CAVEAT_MEDIDA_DECOMPOSITION`:
```
Sub-variants concat (banamex(siav2), profuturo(sac/siav), sura(siav/siav1/siav2), xxi-banorte(siav/sps1..sps10) — 17 strings idénticos a #10) decompuestos vía consar.afore_siefore_alias (reuso fuente_csv='#10', mismo mapping lógico). El campo siefore='siefores adicionales' del CSV se IGNORA en sub-variants — el siefore real proviene del decompose.
```

`CAVEAT_MEDIDA_PID_CORRECCION`:
```
PID (provision_exposicion_instrumentos_derivados) etiquetada como 'pct' del activo expuesto, NO 'monto' absoluto. Corrección empírica vs DDL académico ds3 que asume 'monto'. Validación: Coppel/Inbursa/PensionISSSTE = 0% siempre (no operan derivados); range observado [0, 1.75]% coherente con cap regulatorio CONSAR para exposición a derivados.
```

`CAVEAT_MEDIDA_SUBVARIANT_METRICAS`:
```
Sub-variants concat (productos adicionales SAC/SIAV/SPS) NO reportan tracking_error, escenarios_var ni PID. Decisión arquitectural CONSAR: estas 3 métricas NO aplican a productos no-básicos (1,139 NULLs por métrica × 3 = 3,417 NULLs estructurales).
```

`CAVEAT_MEDIDA_ESCENARIOS_SPARSITY`:
```
escenarios_var tiene 76% sparsity incluso en canonical (1,901 / 6,701 reportados). Métrica esporádica que CONSAR sólo publica cuando hay stress-test reciente.
```

`SOURCE_MEDIDA` (definido, NO usado):
```
CONSAR vía datos.gob.mx (CC-BY-4.0) — datasets/03_medidas — cobertura 2019-12 → 2025-06 (67 fechas mensuales × 7 métricas regulatorias).
```

### Caveats — cuentas administradas (dataset #05)

`CAVEAT_CUENTA_BIGINT`:
```
Métricas reportadas como counts BIGINT (cuentas o trabajadores). Empíricamente todos los valores en CSV son integer (no fraccionarios). Producción adopta BIGINT vs ds3 NUMERIC(20,2) por exactitud semántica y eficiencia.
```

`CAVEAT_CUENTA_DESDE_FECHA`:
```
Cobertura temporal heterogénea por métrica: total_cuentas_afores y trabajadores_imss/registrados desde 1997-12; trabajadores_asignados desde 2001-06; subdivisiones asignados_banco_mexico/siefores desde 2012-01; trabajadores_independientes/issste desde 2005-08; cuentas_inhabilitadas desde 2024-09 (reforma); cuentas_bienestar_010 desde 2024-07 (reforma Pensión Bienestar).
```

`CAVEAT_CUENTA_IDENTIDAD_SAR`:
```
Identidad SAR triple-capa post-reforma 2024 (descriptiva): pre-2024-07 cierre 100% (sentinel total_sar = Σ commercial.total_afores); 2024-07/08 cierre 100% (commercial + bienestar); 2024-09+ emerge residuo creciente NO atribuible (5,552,645 en 2025-06). Causa específica del residuo no determinable con dataset #05; probable atribución a cuentas en transición jurisdiccional bajo reforma 2024.
```

`CAVEAT_CUENTA_NO_COMMERCIAL`:
```
Etiquetas no-commercial agrupadas en /cuentas/sistema con 3 categorías: sistema_total (total_cuentas_sar — agregado SAR completo), sistema_categoria_especial (cuentas_bienestar_010 — categoría reformista 2024), administrativa_especial (prestadora_de_servicios — entidad regulatoria especial).
```

### Caveats — precio bolsa (dataset #01)

`CAVEAT_PRECIO_NAV`:
```
Precios NAV (Net Asset Value) en MXN por SIEFORE. Granularidad diaria de mercado (M-V principalmente, algunos weekends por reporting CONSAR). Range empírico observado [0.560568, 19.045541]: NAV inicial ~$1.00 al lanzamiento de cada SIEFORE, crece con rendimientos acumulados.
```

`CAVEAT_PRECIO_COBERTURA`:
```
Cobertura más profunda del proyecto: 1997-01-08 → 2025-12-06 (28 años, 7,059 fechas). Cohortes generacionales más nuevas (sb 95-99, post-reforma SB 2019) tienen series más cortas. Productos legacy (sac, siav, siav1, siav2) pueden estar discontinuados.
```

`CAVEAT_PRECIO_BANAMEX_MERGE`:
```
AFORE codigo banamex unifica strings 'banamex' y 'citibanamex' del CSV original (rebrand corporativo 2014). Empíricamente disjoint en (fecha × siefore): banamex string reportó 10 siefores excepto sb 55-59 y siav; citibanamex reportó SOLO sb 55-59 y siav. Series unificadas bajo afore_id=3 para preservar continuidad histórica 1997+.
```

### Caveats — precio gestión (dataset #11)

`CAVEAT_GESTION_PRECIO`:
```
Precios de gestión interna en MXN por SIEFORE. Granularidad diaria de mercado (M-V principalmente, algunos weekends por reporting CONSAR). Range empírico observado [0.506404, 24.853032]: max NAV +30% vs precio_bolsa (19.045541), sugiere distinta base/comisión entre serie de precio bolsa y serie de gestión interna. Hallazgo descriptivo, NO interpretativo.
```

`CAVEAT_GESTION_COBERTURA`:
```
Cobertura diaria 1997-01-07 → 2025-12-06 (28+ años, 7,060 fechas). 1 fecha extra vs precio_bolsa: 1997-01-07 (única fecha cubierta exclusivamente por XXI legacy/sb5). Cohortes generacionales más nuevas (sb 95-99, post-reforma SB 2019) tienen series más cortas. Productos legacy (sac, siav) pueden estar discontinuados.
```

`CAVEAT_GESTION_BANAMEX_MERGE`:
```
AFORE codigo banamex unifica strings 'banamex' y 'citibanamex' del CSV original (rebrand corporativo 2014). Empíricamente disjoint en (fecha × siefore): banamex string reportó 10 siefores excepto sb 55-59 y siav; citibanamex reportó SOLO sb 55-59 y siav. Series unificadas bajo afore_id=3 (codigo=banamex) para preservar continuidad histórica 1997+. Validado a 588K rows + 0 PK colisiones.
```

`CAVEAT_GESTION_XXI_LEGACY`:
```
AFORE codigo xxi_banorte unifica strings 'xxi-banorte' (con guion) y 'xxi' (legacy standalone pre-fusión 2013). XXI legacy aparece exclusivamente para SIEFORE sb5 (basica_legacy ≤2012, 3,664 fechas distintas 1997-01-07 → 2012-12-01). XXI-Banorte cubre 17 siefores ≠ sb5 desde 1997-01-08+. Disjoint perfecto en siefore: 0 PK colisiones. Series unificadas bajo afore_id=2 (codigo=xxi_banorte) preservan continuidad histórica.
```

`CAVEAT_GESTION_NO_PENSIONISSSTE`:
```
PensionISSSTE (afore_id=6, AFORE pública del ISSSTE) NO aparece en este dataset. Diferencia estructural vs precio_bolsa: el reporte CONSAR de precios de gestión interna omite la AFORE pública. Filtrar por afore_codigo='pensionissste' devuelve 404. Para precio bolsa de PensionISSSTE consultar /precios/serie.
```

### Tablas de BD referenciadas (esquema `consar`)

`afores`, `tipos_recurso`, `recursos_mensuales`, `comisiones`, `flujo_recurso`, `traspaso`, `pea_cotizantes`, `activo_neto`, `activo_neto_agg`, `afore_siefore_alias`, `cat_siefore`, `rendimiento`, `rendimiento_sis`, `cat_metrica_sensibilidad`, `medida_sensibilidad`, `cat_metrica_cuenta`, `cuenta_administrada`, `cat_cuenta_etiqueta_agg`, `cuenta_administrada_agg`, `precio_bolsa`, `precio_gestion`.

### Observaciones de paridad (comportamientos no obvios)

1. `/comisiones/serie` sin `afore_codigo` devuelve filas por (fecha × AFORE) sin agregar ni identificar la AFORE.
2. Las series con `desde`/`hasta` (8, 9, 11, 13) devuelven `rango` = ventana solicitada/por defecto y NO producen 404 con serie vacía; las series sin ventana (16, 18, 19, 21, 23, 26, 29, 32) devuelven `rango` observado y SÍ producen 404 si no hay filas. Los comparativos (31, 34) devuelven `rango` solicitado y 404 si vacío.
3. Los snapshots con `LEFT JOIN` (4, 10, 12, 14) devuelven TODAS las AFOREs (11 o 10) aunque no reporten; `n_afores_reportando` cuenta solo las que sí.
4. `/pea-cotizantes/serie` pierde `source` por el modelo (ver endpoint 15).
5. `_parse_fecha` solo completa `-01` cuando la cadena mide exactamente 7 caracteres.
6. Redondeos: `round(x, 2)` en montos de recursos (5, 7, 8) y `total_sistema_mm`; `round(x, 3)` en porcentajes de recursos (4, 5, 7 `pct_del_sar`); `round(x, 4)` en `delta_pct` (7), ratio IMSS/ISSSTE (6), comisiones (9, 10), flujos (11, 12), `monto_total_mm` (17); `round(x, 2)` en PEA (15). Sin redondeo en: 3 (`monto_mxn_mm`), 4 (montos por AFORE), 16-18, 19-21, 23-24, 26-28, 29-34.

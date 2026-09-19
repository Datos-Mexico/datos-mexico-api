# Contrato de los endpoints legacy CDMX (FastAPI `datos-itam/api`)

Documento de paridad. Describe, endpoint por endpoint y de forma literal, el comportamiento de los routers
`servidores`, `sectores`, `catalogos`, `dashboard`, `analytics`, `personas`, `nombramientos` y `export` del
API FastAPI legacy (`/Users/davicho/datos-itam/api/app/`), para reimplementarlos en otro stack y verificar
paridad con pruebas automatizadas. Quedan fuera `auth.py`, `ingest.py`, `admin.py` y `demo.py`.

Fuentes leídas: `routers/*.py`, `schemas/*.py`, `models/servidores.py`, `models/catalogs.py`, `models/users.py`,
`dependencies.py`, `rate_limit.py`, `auth.py`, `database.py`, `main.py` (middleware de caché y handler 429) y
`migrations/004_materialized_views.sql` + `005_multischema_cdmx.sql` (definición de las vistas materializadas).

Versiones observadas en el entorno legacy: SQLAlchemy 2.0.49, SQLModel 0.0.38, FastAPI 0.136.0, Pydantic 2.13.3.
Driver: `asyncpg` (motor `create_async_engine`, `pool_pre_ping=True`; en Neon `statement_cache_size=0`, `ssl="require"`).

Convenciones de este documento:

- El SQL escrito con `text(...)` en los routers se copia **verbatim**.
- El SQL de sentencias ORM se transcribe tal como lo compila SQLAlchemy con el dialecto PostgreSQL
  (`stmt.compile(dialect=postgresql.dialect())`). Los marcadores `%(nombre)s` son parámetros ligados; en producción
  asyncpg los envía como `$1, $2, ...` posicionales. Los nombres de tabla van siempre calificados con el esquema `cdmx`.
- "Verbatim" para `summary`/`description` significa el texto exacto que ve OpenAPI (las cadenas concatenadas ya unidas).

---

## 0. Infraestructura transversal

### 0.1 Rate limiting (`app/rate_limit.py`, `app/main.py`)

```python
from slowapi import Limiter
from app.config import settings

def get_real_ip(request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def _no_limit(_request) -> str:
    return ""

limiter = Limiter(
    key_func=get_real_ip if not settings.testing else _no_limit,
    enabled=not settings.testing,
)
```

- La llave del límite es la IP: primer valor de `X-Forwarded-For` (recortado) o `request.client.host` o `"unknown"`.
- Con `settings.testing = True` el limiter está deshabilitado.
- Los límites se declaran por endpoint con `@limiter.limit("N/minute")`. `Limiter` se construye sin `strategy`,
  por lo que aplica el default de slowapi: `fixed-window` en almacenamiento en memoria del proceso (no compartido
  entre workers). Los endpoints **sin** decorador (todos los CRUD admin) **no tienen rate limit**.
- Handler global (main.py):

```python
@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded. Try again later."},
    )
```

  Respuesta 429: `{"detail": "Rate limit exceeded. Try again later."}`.

### 0.2 Autenticación y admin (`app/auth.py`)

Dependencia usada por los endpoints de escritura: `require_admin`.

```python
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")

async def get_current_user(token: str = Depends(oauth2_scheme), session: AsyncSession = Depends(get_session)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        username: str | None = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    result = await session.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_exception
    return user

async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return current_user
```

- Header esperado: `Authorization: Bearer <JWT>`; JWT HS256 (`settings.algorithm = "HS256"`) firmado con
  `settings.secret_key`; claim `sub` = `username`; claim `exp` obligatorio (python-jose lo valida).
- Tabla de usuarios: `public.users` (`id`, `username` UNIQUE, `email` UNIQUE, `hashed_password`, `is_active`, `is_admin`, `created_at`).
  Consulta: `SELECT users.id, users.username, users.email, users.hashed_password, users.is_active, users.is_admin, users.created_at FROM users WHERE users.username = %(username_1)s`.
- Errores (en este orden de evaluación, y **antes** de ejecutar el cuerpo del handler, porque son dependencias):
  - Sin header `Authorization` / esquema distinto de Bearer → `401 {"detail": "Not authenticated"}` con `WWW-Authenticate: Bearer` (comportamiento de `OAuth2PasswordBearer`).
  - Token inválido/expirado, sin `sub`, usuario inexistente o `is_active = false` → `401 {"detail": "Could not validate credentials"}` con `WWW-Authenticate: Bearer`.
  - Usuario válido con `is_admin = false` → `403 {"detail": "Admin privileges required"}`.

Endpoints que requieren `require_admin` (los únicos con auth en estos routers):
`POST /api/v1/catalogos/{tipo}`, `PUT /api/v1/catalogos/{tipo}/{item_id}`, `DELETE /api/v1/catalogos/{tipo}/{item_id}`,
`POST /api/v1/personas/`, `PUT /api/v1/personas/{persona_id}`, `DELETE /api/v1/personas/{persona_id}`,
`POST /api/v1/nombramientos/`, `PUT /api/v1/nombramientos/{nombramiento_id}`, `DELETE /api/v1/nombramientos/{nombramiento_id}`.

Nota: los `GET` de `personas` y `nombramientos` dicen en su `description` "Requiere JWT admin", pero **no declaran ninguna dependencia de auth**: son públicos (sólo rate limit).

### 0.3 Cache-Control (`app/main.py`, `CacheControlMiddleware`)

```python
WRITE_PREFIXES = ("/api/v1/auth", "/api/v1/personas", "/api/v1/nombramientos", "/api/v1/ingest", "/api/v1/admin", "/api/v1/demo")

def _set_public_cache(response, cache_value: str) -> None:
    response.headers["Cache-Control"] = cache_value
    existing_vary = response.headers.get("Vary", "")
    vary_parts = [v.strip() for v in existing_vary.split(",") if v.strip()]
    if not any(v.lower() == "origin" for v in vary_parts):
        vary_parts.append("Origin")
    response.headers["Vary"] = ", ".join(vary_parts)

class CacheControlMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if any(path.startswith(p) for p in WRITE_PREFIXES):
            response.headers["Cache-Control"] = "no-store"
        elif "/catalogos/" in path or path.startswith("/api/v1/sectores"):
            _set_public_cache(response, "public, max-age=3600")
        elif path.startswith("/api/v1/dashboard"):
            _set_public_cache(response, "public, max-age=3600")
        elif path.startswith("/api/v1/analytics"):
            _set_public_cache(response, "public, max-age=900")
        elif path.startswith("/api/v1/enigh"):
            _set_public_cache(response, "public, max-age=3600")
        elif path.startswith("/api/v1/comparativo"):
            _set_public_cache(response, "public, max-age=3600")
        elif path.startswith("/api/v1/consar"):
            _set_public_cache(response, "public, max-age=3600")
        elif path.startswith("/api/v1/enoe"):
            _set_public_cache(response, "public, max-age=3600")
        elif "/servidores/" in path:
            _set_public_cache(response, "public, max-age=300")
        return response
```

Resultado por router (se aplica a cualquier método y a cualquier status, incluidos 404/429):

| Router | Cache-Control | Vary |
|---|---|---|
| `/api/v1/servidores/...` (la ruta debe contener `/servidores/`) | `public, max-age=300` | `Origin` añadido |
| `/api/v1/sectores...` | `public, max-age=3600` | `Origin` añadido |
| `/api/v1/catalogos/...` (incluye POST/PUT/DELETE admin) | `public, max-age=3600` | `Origin` añadido |
| `/api/v1/dashboard...` | `public, max-age=3600` | `Origin` añadido |
| `/api/v1/analytics...` | `public, max-age=900` | `Origin` añadido |
| `/api/v1/personas...`, `/api/v1/nombramientos...` | `no-store` | sin cambio |
| `/api/v1/export/csv` | **sin header** (ninguna rama coincide) | sin cambio |

CORS: `allow_origins=settings.cors_origins`, `allow_methods=["GET","POST","PUT","DELETE"]`, `allow_headers=["*","Authorization"]`.

### 0.4 Sesión de base de datos

`get_session()` entrega `AsyncSession(engine, expire_on_commit=False)`. `dashboard` y `analytics` no usan sesión: abren
`engine.connect()` por consulta. El esquema de trabajo es `cdmx` (calificación explícita; no hay `search_path`).

### 0.5 Barra final en rutas de colección

Las rutas de colección se registran con `"/"` bajo el prefijo (`/api/v1/servidores/`, `/api/v1/sectores/`,
`/api/v1/personas/`, `/api/v1/nombramientos/`). Una petición sin barra final (`/api/v1/servidores`) recibe
`307 Temporary Redirect` hacia la ruta con barra (`redirect_slashes` de Starlette).

### 0.6 Errores de validación (422 de FastAPI)

Parámetros de query/path inválidos (p. ej. `page=0`, `servidor_id=abc`) producen el 422 estándar de FastAPI:
`{"detail": [{"type": "...", "loc": ["query"|"path", "<param>"], "msg": "...", "input": "...", ...}]}`.
Los 422 lanzados explícitamente por los handlers (`HTTPException(422, detail=str)`) tienen forma `{"detail": "<mensaje>"}`.

### 0.7 Serialización JSON (Pydantic v2)

Verificado con Pydantic 2.13.3 en el entorno legacy:

- `Decimal` se serializa como **cadena**: `"sueldo_bruto": "18500.00"` (no número). Aplica a `ServidorListItem`,
  `ServidorDetail` y `NombramientoResponse`. Los ejemplos OpenAPI de `servidores` muestran números, pero la salida real son strings.
- `datetime.date` → `"YYYY-MM-DD"`.
- `float` → número JSON; `None` → `null`.
- `int` asignado a un campo `float` (p. ej. `genderGapPercent = 0`) sale como `0.0`.

### 0.8 Filtros compartidos de servidores/export (`app/dependencies.py`)

```python
@dataclass
class ServidorFilters:
    sector_id: int | None = None
    sexo: str | None = None
    edad_min: int | None = None
    edad_max: int | None = None
    sueldo_min: Decimal | None = None
    sueldo_max: Decimal | None = None
    puesto_search: str | None = None
    tipo_contratacion_id: int | None = None
    tipo_personal_id: int | None = None
    universo_id: int | None = None
    page: int = 1
    per_page: int = 50
    order_by: str = "id"
    order: str = "asc"

def get_filters(
    sector_id: int | None = Query(None),
    sexo: str | None = Query(None),
    edad_min: int | None = Query(None),
    edad_max: int | None = Query(None),
    sueldo_min: Decimal | None = Query(None),
    sueldo_max: Decimal | None = Query(None),
    puesto_search: str | None = Query(None),
    tipo_contratacion_id: int | None = Query(None),
    tipo_personal_id: int | None = Query(None),
    universo_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    order_by: str = Query("id"),
    order: str = Query("asc"),
) -> ServidorFilters: ...

ALLOWED_ORDER_COLUMNS = {
    "id", "nombre", "apellido_1", "edad", "sueldo_bruto", "sueldo_neto", "fecha_ingreso",
}
_PERSONA_ORDER_COLS = {"id", "nombre", "apellido_1", "edad"}
_NOMBRAMIENTO_ORDER_COLS = {"sueldo_bruto", "sueldo_neto", "fecha_ingreso"}

def apply_filters(stmt: Select, filters: ServidorFilters, *, _sexo_joined: bool = False) -> Select:
    """Apply filters to a statement that already joins Persona and Nombramiento."""
    N = Nombramiento
    P = Persona
    if filters.sector_id is not None:
        stmt = stmt.where(N.sector_id == filters.sector_id)
    if filters.sexo is not None:
        if not _sexo_joined:
            stmt = stmt.join(CatSexo, P.sexo_id == CatSexo.id)
        stmt = stmt.where(CatSexo.nombre == filters.sexo)
    if filters.edad_min is not None:
        stmt = stmt.where(P.edad >= filters.edad_min)
    if filters.edad_max is not None:
        stmt = stmt.where(P.edad <= filters.edad_max)
    if filters.sueldo_min is not None:
        stmt = stmt.where(N.sueldo_bruto >= filters.sueldo_min)
    if filters.sueldo_max is not None:
        stmt = stmt.where(N.sueldo_bruto <= filters.sueldo_max)
    if filters.puesto_search is not None:
        from app.models.catalogs import CatPuesto
        stmt = stmt.join(CatPuesto, N.puesto_id == CatPuesto.id).where(
            CatPuesto.nombre.ilike(f"%{filters.puesto_search}%")
        )
    if filters.tipo_contratacion_id is not None:
        stmt = stmt.where(N.tipo_contratacion_id == filters.tipo_contratacion_id)
    if filters.tipo_personal_id is not None:
        stmt = stmt.where(N.tipo_personal_id == filters.tipo_personal_id)
    if filters.universo_id is not None:
        stmt = stmt.where(N.universo_id == filters.universo_id)
    return stmt

def apply_ordering(stmt: Select, filters: ServidorFilters) -> Select:
    col_name = filters.order_by if filters.order_by in ALLOWED_ORDER_COLUMNS else "id"
    if col_name in _PERSONA_ORDER_COLS:
        col = getattr(Persona, col_name)
    else:
        col = getattr(Nombramiento, col_name)
    if filters.order == "desc":
        stmt = stmt.order_by(col.desc())
    else:
        stmt = stmt.order_by(col.asc())
    return stmt
```

Tabla de parámetros de `get_filters` (ninguno tiene `description`; todos son de query):

| Nombre | Tipo | Default | Validación | Requerido | Predicado SQL generado |
|---|---|---|---|---|---|
| `sector_id` | int | null | int parseable | no | `cdmx.nombramientos.sector_id = :v` |
| `sexo` | str | null | — | no | `cdmx.cat_sexos.nombre = :v` (igualdad exacta, sensible a mayúsculas; valores reales `MASCULINO`/`FEMENINO`) |
| `edad_min` | int | null | int | no | `cdmx.personas.edad >= :v` |
| `edad_max` | int | null | int | no | `cdmx.personas.edad <= :v` |
| `sueldo_min` | Decimal | null | decimal parseable | no | `cdmx.nombramientos.sueldo_bruto >= :v` |
| `sueldo_max` | Decimal | null | decimal parseable | no | `cdmx.nombramientos.sueldo_bruto <= :v` |
| `puesto_search` | str | null | — | no | `JOIN cdmx.cat_puestos ON cdmx.nombramientos.puesto_id = cdmx.cat_puestos.id` + `cdmx.cat_puestos.nombre ILIKE '%' || :v || '%'` (la cadena vacía `""` también activa el filtro porque la condición es `is not None`) |
| `tipo_contratacion_id` | int | null | int | no | `cdmx.nombramientos.tipo_contratacion_id = :v` |
| `tipo_personal_id` | int | null | int | no | `cdmx.nombramientos.tipo_personal_id = :v` |
| `universo_id` | int | null | int | no | `cdmx.nombramientos.universo_id = :v` |
| `page` | int | 1 | `ge=1` | no | `OFFSET (page-1)*per_page` |
| `per_page` | int | 50 | `ge=1`, `le=200` | no | `LIMIT per_page` |
| `order_by` | str | `"id"` | sin validación; si no está en `ALLOWED_ORDER_COLUMNS` se usa `id` silenciosamente | no | `ORDER BY <col> ASC|DESC` |
| `order` | str | `"asc"` | sin validación; sólo la cadena exacta `"desc"` produce DESC, cualquier otra (incluida `"DESC"`) produce ASC | no | — |

Orden: `id`, `nombre`, `apellido_1`, `edad` → columna de `cdmx.personas`; `sueldo_bruto`, `sueldo_neto`, `fecha_ingreso` → columna de `cdmx.nombramientos`. Sin llave secundaria de desempate (la paginación con empates no es determinista).

Los filtros se aplican en el orden del código; el `WHERE` resultante concatena los predicados con `AND` en ese orden.

### 0.9 Modelos de tablas (`models/servidores.py`, `models/catalogs.py`)

Esquema `cdmx` para todo (`__table_args__ = {"schema": "cdmx"}`).

| Tabla | Columnas (modelo) |
|---|---|
| `cdmx.personas` | `id` PK int, `nombre` str, `apellido_1` str, `apellido_2` str NULL, `sexo_id` int NULL FK `cdmx.cat_sexos.id`, `edad` int NULL |
| `cdmx.nombramientos` | `id` PK int, `persona_id` int FK `cdmx.personas.id`, `puesto_id` int NULL FK `cdmx.cat_puestos.id`, `sector_id` int NULL FK `cdmx.cat_sectores.id`, `tipo_nomina_id` int NULL FK `cdmx.cat_tipos_nomina.id`, `tipo_contratacion_id` int NULL FK `cdmx.cat_tipos_contratacion.id`, `tipo_personal_id` int NULL FK `cdmx.cat_tipos_personal.id`, `universo_id` int NULL FK `cdmx.cat_universos.id`, `nivel_salarial_id` int NULL FK `cdmx.cat_niveles_salariales.id`, `fecha_ingreso` date NULL, `sueldo_bruto` Decimal NULL, `sueldo_neto` Decimal NULL |
| `cdmx.cat_sectores` | `id` PK, `clave` str, `nombre` str |
| `cdmx.cat_puestos` | `id` PK, `nombre` str |
| `cdmx.cat_tipos_contratacion` | `id` PK, `nombre` str |
| `cdmx.cat_tipos_personal` | `id` PK, `nombre` str |
| `cdmx.cat_tipos_nomina` | `id` PK, `clave` int |
| `cdmx.cat_universos` | `id` PK, `clave` str, `nombre` str |
| `cdmx.cat_sexos` | `id` PK, `nombre` str |
| `cdmx.cat_niveles_salariales` | `id` PK, `clave` int |

### 0.10 Esquemas de paginación y error (`schemas/pagination.py`, `schemas/errors.py`)

```python
class PaginatedResponse(BaseModel, Generic[T]):
    data: list[T]
    total: int
    page: int
    per_page: int
    pages: int
```

```python
class HTTPError(BaseModel):
    detail: str

class HTTPError401(HTTPError):
    detail: str = Field(default="Could not validate credentials",
        description="Token inválido, ausente o usuario inactivo.",
        examples=["Could not validate credentials"])

class HTTPError403(HTTPError):
    detail: str = Field(default="Admin privileges required",
        description="Usuario autenticado pero sin permisos suficientes para la operación.",
        examples=["Admin privileges required"])

class HTTPError404(HTTPError):
    detail: str = Field(default="Recurso no encontrado",
        description="El recurso solicitado no existe.",
        examples=["Persona no encontrada"])

class HTTPError409(HTTPError):
    detail: str = Field(default="Cannot delete: resource has active references",
        description="Estado inconsistente: el recurso tiene referencias FK activas que impiden la operación.",
        examples=["Cannot delete persona with active nombramientos"])

class HTTPError429(HTTPError):
    detail: str = Field(default="Rate limit exceeded. Try again later.",
        description="Rate limit por IP excedido para este endpoint.",
        examples=["Rate limit exceeded. Try again later."])
```

Docstring de `errors.py` (verbatim):

> Modelos reutilizables para responses de error HTTP.
>
> Forma del payload (consistente con FastAPI HTTPException(status_code, detail)):
>
>     {"detail": "mensaje legible"}
>
> Los validation errors 422 emitidos por Pydantic siguen un shape distinto
> (lista de errores estructurados) y no se modelan aquí — FastAPI los registra
> automáticamente vía HTTPValidationError.

---

## 1. Router `servidores` (`routers/servidores.py`)

`router = APIRouter(prefix="/api/v1/servidores", tags=["servidores"])`. Alias locales: `P = Persona`, `N = Nombramiento`.
Orden de declaración: `/`, `/stats`, `/{servidor_id}` (`/stats` se declara antes que el path param; además `servidor_id` es `int`, por lo que `/stats` nunca cae en el detalle).

### 1.1 `GET /api/v1/servidores/`

- **summary**: `Listar servidores con filtros y paginación`
- **description**: `Lista paginada de servidores del padrón CDMX (246K registros). Soporta filtros por `sector_id`, `sexo`, rango de edad, rango de sueldo, `tipo_contratacion_id`, `tipo_personal_id`, `universo_id`, y `puesto_search` (búsqueda ILIKE sobre el nombre del puesto). Cache HTTP `public, max-age=300`.`
- **Rate limit**: `30/minute` por IP. Auth: ninguna.
- **Cache-Control**: `public, max-age=300`, `Vary: Origin`.
- **response_model**: `PaginatedResponse[ServidorListItem]`.
- **responses OpenAPI**: 200 `"Página de servidores."` con ejemplo `{"data":[{"id":42,"nombre":"MARIA","apellido_1":"RODRIGUEZ","apellido_2":"LOPEZ","sexo":"FEMENINO","edad":38,"sueldo_bruto":18500.00,"sueldo_neto":14820.50,"sector":"Secretaría de Educación","puesto":"DOCENTE FRENTE A GRUPO"}],"total":246821,"page":1,"per_page":50,"pages":4937}`; 429 `HTTPError429` `"Rate limit excedido (30 req/min por IP)."`.

**Parámetros**: todos los de `get_filters` (sección 0.8).

**Consulta 1 — total** (`select(func.count(P.id)).select_from(P).join(N, N.persona_id == P.id)` + `apply_filters(count_stmt, filters)` con `_sexo_joined=False`):

```sql
SELECT count(cdmx.personas.id) AS count_1
FROM cdmx.personas JOIN cdmx.nombramientos ON cdmx.nombramientos.persona_id = cdmx.personas.id
```

Con `sexo` se agrega `JOIN cdmx.cat_sexos ON cdmx.personas.sexo_id = cdmx.cat_sexos.id`; con `puesto_search` se agrega `JOIN cdmx.cat_puestos ON cdmx.nombramientos.puesto_id = cdmx.cat_puestos.id`. Con todos los filtros:

```sql
SELECT count(cdmx.personas.id) AS count_1
FROM cdmx.personas JOIN cdmx.nombramientos ON cdmx.nombramientos.persona_id = cdmx.personas.id JOIN cdmx.cat_sexos ON cdmx.personas.sexo_id = cdmx.cat_sexos.id JOIN cdmx.cat_puestos ON cdmx.nombramientos.puesto_id = cdmx.cat_puestos.id
WHERE cdmx.nombramientos.sector_id = %(sector_id_1)s AND cdmx.cat_sexos.nombre = %(nombre_1)s AND cdmx.personas.edad >= %(edad_1)s AND cdmx.personas.edad <= %(edad_2)s AND cdmx.nombramientos.sueldo_bruto >= %(sueldo_bruto_1)s AND cdmx.nombramientos.sueldo_bruto <= %(sueldo_bruto_2)s AND cdmx.cat_puestos.nombre ILIKE %(nombre_2)s AND cdmx.nombramientos.tipo_contratacion_id = %(tipo_contratacion_id_1)s AND cdmx.nombramientos.tipo_personal_id = %(tipo_personal_id_1)s AND cdmx.nombramientos.universo_id = %(universo_id_1)s
```

`total = scalar_one()`. Nota: cuenta filas del JOIN persona×nombramiento, es decir **nombramientos** (una persona con varios nombramientos aparece varias veces en `data` y cuenta varias veces en `total`).

**Consulta 2 — datos** (`apply_filters(stmt, filters, _sexo_joined=True)`, `apply_ordering`, `.offset((page-1)*per_page).limit(per_page)`):

```sql
SELECT cdmx.personas.id, cdmx.personas.nombre, cdmx.personas.apellido_1, cdmx.personas.apellido_2, cdmx.cat_sexos.nombre AS sexo, cdmx.personas.edad, cdmx.nombramientos.sueldo_bruto, cdmx.nombramientos.sueldo_neto, cdmx.cat_sectores.nombre AS sector, cdmx.cat_puestos.nombre AS puesto
FROM cdmx.personas JOIN cdmx.nombramientos ON cdmx.nombramientos.persona_id = cdmx.personas.id LEFT OUTER JOIN cdmx.cat_sexos ON cdmx.personas.sexo_id = cdmx.cat_sexos.id LEFT OUTER JOIN cdmx.cat_sectores ON cdmx.nombramientos.sector_id = cdmx.cat_sectores.id LEFT OUTER JOIN cdmx.cat_puestos ON cdmx.nombramientos.puesto_id = cdmx.cat_puestos.id
[WHERE <predicados de apply_filters en el mismo orden que arriba>]
ORDER BY cdmx.personas.id ASC
LIMIT %(param_1)s OFFSET %(param_2)s
```

`ORDER BY` según `apply_ordering` (default `cdmx.personas.id ASC`; p. ej. `order_by=sueldo_bruto&order=desc` → `ORDER BY cdmx.nombramientos.sueldo_bruto DESC`).

**Defecto heredado (reproducir o documentar la divergencia)**: cuando `puesto_search` no es `None`, `apply_filters` añade un segundo `JOIN cdmx.cat_puestos ON cdmx.nombramientos.puesto_id = cdmx.cat_puestos.id` después del `LEFT OUTER JOIN cdmx.cat_puestos` ya presente, sin alias. SQL compilado verificado:

```sql
... LEFT OUTER JOIN cdmx.cat_puestos ON cdmx.nombramientos.puesto_id = cdmx.cat_puestos.id JOIN cdmx.cat_puestos ON cdmx.nombramientos.puesto_id = cdmx.cat_puestos.id
WHERE cdmx.cat_puestos.nombre ILIKE %(nombre_1)s ORDER BY cdmx.personas.id ASC LIMIT %(param_1)s OFFSET %(param_2)s
```

PostgreSQL rechaza una misma tabla dos veces sin alias en el mismo nivel de `FROM` (`table name "cat_puestos" specified more than once`), por lo que en el legacy `GET /api/v1/servidores/?puesto_search=...` termina en **500** (la consulta de conteo sí es válida; falla la de datos). No hay test que cubra `puesto_search` en este endpoint. La intención evidente es filtrar por `cdmx.cat_puestos.nombre ILIKE '%<puesto_search>%'` sobre el LEFT JOIN existente.

**Post-proceso**:

```python
data = [ServidorListItem(id=r.id, nombre=r.nombre, apellido_1=r.apellido_1, apellido_2=r.apellido_2, sexo=r.sexo, edad=r.edad,
                         sueldo_bruto=r.sueldo_bruto, sueldo_neto=r.sueldo_neto, sector=r.sector, puesto=r.puesto) for r in result.all()]
return PaginatedResponse(data=data, total=total, page=filters.page, per_page=filters.per_page,
                         pages=(total + filters.per_page - 1) // filters.per_page if total > 0 else 0)
```

- `pages = ceil(total / per_page)`, `0` si `total == 0`.
- `sexo` es `str` no opcional: si `cat_sexos.nombre` resulta NULL (persona sin `sexo_id`), la construcción de `ServidorListItem` lanza `ValidationError` → **500**.
- Sin redondeo; `Decimal` pasa tal cual y se serializa como string.

**Respuesta** `PaginatedResponse[ServidorListItem]`:

```python
class ServidorListItem(BaseModel):
    id: int
    nombre: str
    apellido_1: str
    apellido_2: str | None
    sexo: str
    edad: int | None
    sueldo_bruto: Decimal | None   # JSON: string "18500.00" o null
    sueldo_neto: Decimal | None    # JSON: string o null
    sector: str | None
    puesto: str | None
```

más `total: int`, `page: int`, `per_page: int`, `pages: int`.

**Errores**: 422 validación de query (`page<1`, `per_page` fuera de 1..200, tipos); 429 `{"detail":"Rate limit exceeded. Try again later."}`; 500 en los casos descritos.

### 1.2 `GET /api/v1/servidores/stats`

- **summary**: `Estadísticas agregadas con filtros (panel reactivo)`
- **description**: `Estadísticas sobre el subconjunto del padrón que matchea los filtros recibidos: total, promedio, mediana, percentiles (p25/p75), min/max de sueldo bruto, promedio de neto y edad, desglose por género con brecha %, y distribución por rangos de sueldo (`0-5K`, `5K-10K`, ..., `120K+`). Es el endpoint que alimenta el panel de filtros reactivo del laboratorio público. Cache HTTP `public, max-age=300`.`
- **Rate limit**: `15/minute`. Auth: ninguna. Cache: `public, max-age=300`.
- **response_model**: `ServidorStats`.
- **responses OpenAPI**: 200 `"Stats agregadas del subconjunto filtrado."` ejemplo `{"total":8230,"sueldo_bruto_avg":14820.50,"sueldo_bruto_median":12500.00,"sueldo_bruto_p25":9200.0,"sueldo_bruto_p75":18750.0,"sueldo_bruto_min":0.0,"sueldo_bruto_max":95000.0,"sueldo_neto_avg":12200.30,"edad_avg":38.5,"count_hombres":3100,"count_mujeres":5130,"brecha_genero_pct":12.4,"distribucion_sueldo":[{"rango":"5K-10K","count":1820},{"rango":"10K-20K","count":4250}]}`; 429 `"Rate limit excedido (15 req/min por IP)."`.

**Parámetros**: los de `get_filters` (sección 0.8). `page`, `per_page`, `order_by`, `order` se aceptan y se **ignoran**.

**Construcción del WHERE** (SQL crudo, no ORM):

```python
where_clauses = []; params = {}
if filters.sector_id is not None:           where_clauses.append("n.sector_id = :sector_id")
if filters.sexo is not None:                where_clauses.append("csex.nombre = :sexo")
if filters.edad_min is not None:            where_clauses.append("p.edad >= :edad_min")
if filters.edad_max is not None:            where_clauses.append("p.edad <= :edad_max")
if filters.sueldo_min is not None:          where_clauses.append("n.sueldo_bruto >= :sueldo_min")
if filters.sueldo_max is not None:          where_clauses.append("n.sueldo_bruto <= :sueldo_max")
if filters.tipo_contratacion_id is not None: where_clauses.append("n.tipo_contratacion_id = :tipo_contratacion_id")
if filters.tipo_personal_id is not None:    where_clauses.append("n.tipo_personal_id = :tipo_personal_id")
if filters.universo_id is not None:         where_clauses.append("n.universo_id = :universo_id")
if filters.puesto_search is not None:
    where_clauses.append("cp.nombre ILIKE :puesto_search"); params["puesto_search"] = f"%{filters.puesto_search}%"
where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"
join_puesto = "LEFT JOIN cdmx.cat_puestos cp ON n.puesto_id = cp.id" if filters.puesto_search else ""
```

Nota: el predicado de `puesto_search` se añade con `is not None` pero el JOIN con truthiness: `puesto_search=` (cadena vacía) genera `cp.nombre ILIKE '%%'` sin el JOIN → error SQL (`missing FROM-clause entry for table "cp"`) → **500**.

**Consulta 1 — agregados** (`{join_puesto}` y `{where_sql}` interpolados; parámetros ligados con `:nombre`):

```sql
    SELECT
        COUNT(*) AS total,
        AVG(n.sueldo_bruto)::float AS sueldo_bruto_avg,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY n.sueldo_bruto)::float AS sueldo_bruto_median,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY n.sueldo_bruto)::float AS sueldo_bruto_p25,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY n.sueldo_bruto)::float AS sueldo_bruto_p75,
        MIN(n.sueldo_bruto)::float AS sueldo_bruto_min,
        MAX(n.sueldo_bruto)::float AS sueldo_bruto_max,
        AVG(n.sueldo_neto)::float AS sueldo_neto_avg,
        AVG(p.edad)::float AS edad_avg,
        COUNT(*) FILTER (WHERE csex.nombre = 'MASCULINO') AS count_hombres,
        COUNT(*) FILTER (WHERE csex.nombre = 'FEMENINO') AS count_mujeres,
        CASE
            WHEN AVG(n.sueldo_bruto) FILTER (WHERE csex.nombre = 'FEMENINO') > 0
            THEN ((AVG(n.sueldo_bruto) FILTER (WHERE csex.nombre = 'MASCULINO')
                  - AVG(n.sueldo_bruto) FILTER (WHERE csex.nombre = 'FEMENINO'))
                  / AVG(n.sueldo_bruto) FILTER (WHERE csex.nombre = 'FEMENINO') * 100)::float
            ELSE NULL
        END AS brecha_genero_pct
    FROM cdmx.nombramientos n
    JOIN cdmx.personas p ON n.persona_id = p.id
    LEFT JOIN cdmx.cat_sexos csex ON p.sexo_id = csex.id
    {join_puesto}
    WHERE {where_sql}
```

`row = result.mappings().one()` (siempre una fila; con cero coincidencias `total=0` y el resto NULL).

**Consulta 2 — distribución**:

```sql
    SELECT
        CASE
            WHEN n.sueldo_bruto < 5000 THEN '0-5K'
            WHEN n.sueldo_bruto < 10000 THEN '5K-10K'
            WHEN n.sueldo_bruto < 20000 THEN '10K-20K'
            WHEN n.sueldo_bruto < 30000 THEN '20K-30K'
            WHEN n.sueldo_bruto < 50000 THEN '30K-50K'
            WHEN n.sueldo_bruto < 80000 THEN '50K-80K'
            WHEN n.sueldo_bruto < 120000 THEN '80K-120K'
            ELSE '120K+'
        END AS rango,
        COUNT(*) AS count
    FROM cdmx.nombramientos n
    JOIN cdmx.personas p ON n.persona_id = p.id
    LEFT JOIN cdmx.cat_sexos csex ON p.sexo_id = csex.id
    {join_puesto}
    WHERE {where_sql} AND n.sueldo_bruto IS NOT NULL
    GROUP BY rango
    ORDER BY MIN(n.sueldo_bruto)
```

Sólo aparecen rangos con al menos una fila (no se rellenan ceros).

**Post-proceso**: ninguno (sin redondeo); campos mapeados uno a uno; `distribucion = [SueldoDistribucion(rango=r["rango"], count=r["count"]) ...]`.

**Respuesta** `ServidorStats`:

```python
class SueldoDistribucion(BaseModel):
    rango: str
    count: int

class ServidorStats(BaseModel):
    total: int
    sueldo_bruto_avg: float | None
    sueldo_bruto_median: float | None
    sueldo_bruto_p25: float | None
    sueldo_bruto_p75: float | None
    sueldo_bruto_min: float | None
    sueldo_bruto_max: float | None
    sueldo_neto_avg: float | None
    edad_avg: float | None
    count_hombres: int
    count_mujeres: int
    brecha_genero_pct: float | None
    distribucion_sueldo: list[SueldoDistribucion]
```

**Errores**: 422 validación de query; 429; 500 con `puesto_search=""`.

### 1.3 `GET /api/v1/servidores/{servidor_id}`

- **summary**: `Detalle de un servidor por ID`
- **description**: `Detalle completo de un servidor (persona) por su ID numérico: datos personales, sueldo bruto/neto, fecha de ingreso, nivel salarial, sector, puesto, tipos de contratación/personal/nómina y universo. Cache HTTP `public, max-age=300`.`
- **Rate limit**: `60/minute`. Auth: ninguna. Cache: `public, max-age=300`.
- **response_model**: `ServidorDetail`.
- **responses OpenAPI**: 200 `"Detalle del servidor."`; 404 `HTTPError404` `"`servidor_id` no existe en `cdmx.personas`."` ejemplo `{"detail": "Servidor no encontrado"}`; 429 `"Rate limit excedido (60 req/min por IP)."`.

**Parámetros**: path `servidor_id: int` (requerido; no entero → 422).

**Consulta**:

```sql
SELECT cdmx.personas.id, cdmx.personas.nombre, cdmx.personas.apellido_1, cdmx.personas.apellido_2, cdmx.cat_sexos.nombre AS sexo, cdmx.personas.edad, cdmx.nombramientos.sueldo_bruto, cdmx.nombramientos.sueldo_neto, cdmx.nombramientos.fecha_ingreso, cdmx.cat_niveles_salariales.clave AS id_nivel_salarial, cdmx.cat_sectores.nombre AS sector, cdmx.cat_puestos.nombre AS puesto, cdmx.cat_tipos_contratacion.nombre AS tipo_contratacion, cdmx.cat_tipos_personal.nombre AS tipo_personal, CAST(cdmx.cat_tipos_nomina.clave AS VARCHAR) AS tipo_nomina, cdmx.cat_universos.nombre AS universo
FROM cdmx.personas JOIN cdmx.nombramientos ON cdmx.nombramientos.persona_id = cdmx.personas.id LEFT OUTER JOIN cdmx.cat_sexos ON cdmx.personas.sexo_id = cdmx.cat_sexos.id LEFT OUTER JOIN cdmx.cat_sectores ON cdmx.nombramientos.sector_id = cdmx.cat_sectores.id LEFT OUTER JOIN cdmx.cat_puestos ON cdmx.nombramientos.puesto_id = cdmx.cat_puestos.id LEFT OUTER JOIN cdmx.cat_tipos_contratacion ON cdmx.nombramientos.tipo_contratacion_id = cdmx.cat_tipos_contratacion.id LEFT OUTER JOIN cdmx.cat_tipos_personal ON cdmx.nombramientos.tipo_personal_id = cdmx.cat_tipos_personal.id LEFT OUTER JOIN cdmx.cat_tipos_nomina ON cdmx.nombramientos.tipo_nomina_id = cdmx.cat_tipos_nomina.id LEFT OUTER JOIN cdmx.cat_universos ON cdmx.nombramientos.universo_id = cdmx.cat_universos.id LEFT OUTER JOIN cdmx.cat_niveles_salariales ON cdmx.nombramientos.nivel_salarial_id = cdmx.cat_niveles_salariales.id
WHERE cdmx.personas.id = %(id_1)s
```

Sin `LIMIT`. `row = result.one_or_none()`:
- 0 filas (persona inexistente **o persona sin nombramiento**, por el INNER JOIN) → `404 {"detail": "Servidor no encontrado"}`.
- más de 1 fila (persona con varios nombramientos) → `MultipleResultsFound` → **500**.

**Post-proceso**: ninguno; `id_nivel_salarial` toma `cat_niveles_salariales.clave` (entero), `tipo_nomina` es `clave` casteada a texto.

**Respuesta** `ServidorDetail`:

```python
class ServidorDetail(BaseModel):
    id: int
    nombre: str
    apellido_1: str
    apellido_2: str | None
    sexo: str                        # NULL → ValidationError → 500
    edad: int | None
    sueldo_bruto: Decimal | None     # JSON string
    sueldo_neto: Decimal | None      # JSON string
    fecha_ingreso: datetime.date | None   # "YYYY-MM-DD"
    id_nivel_salarial: int | None
    sector: str | None
    puesto: str | None
    tipo_contratacion: str | None
    tipo_personal: str | None
    tipo_nomina: str | None          # clave int casteada a VARCHAR, p. ej. "8"
    universo: str | None
```

**Errores**: 404 `Servidor no encontrado`; 422 path no entero; 429.

---

## 2. Router `sectores` (`routers/sectores.py`)

`router = APIRouter(prefix="/api/v1/sectores", tags=["sectores"])`. Orden de declaración: `/`, `/compare`, `/{sector_id}/stats`. Cache para todo el router: `public, max-age=3600`.

### 2.1 `GET /api/v1/sectores/`

- **summary**: `Listar los 73 sectores del padrón CDMX con estadísticas`
- **description**: `Devuelve los 73 sectores con conteo de nombramientos, sueldo bruto promedio, y desglose hombres/mujeres por sector. Ordenado alfabéticamente. Cache HTTP `public, max-age=3600`.`
- **Rate limit**: `30/minute`. Auth: ninguna.
- **response_model**: `list[SectorWithStats]`.
- **responses OpenAPI**: 200 `"Lista de sectores con stats agregadas."` ejemplo `[{"id":1,"nombre":"Secretaría de Educación","total_servidores":8230,"sueldo_bruto_avg":14820.50,"count_hombres":3100,"count_mujeres":5130}]`; 429 `"Rate limit excedido (30 req/min por IP)."`.

**Parámetros**: ninguno.

**Consulta**:

```sql
    SELECT
        cs.id, cs.nombre,
        COUNT(n.id) AS total_servidores,
        AVG(n.sueldo_bruto)::float AS sueldo_bruto_avg,
        COUNT(*) FILTER (WHERE csex.nombre = 'MASCULINO') AS count_hombres,
        COUNT(*) FILTER (WHERE csex.nombre = 'FEMENINO') AS count_mujeres
    FROM cdmx.cat_sectores cs
    LEFT JOIN cdmx.nombramientos n ON n.sector_id = cs.id
    LEFT JOIN cdmx.personas p ON n.persona_id = p.id
    LEFT JOIN cdmx.cat_sexos csex ON p.sexo_id = csex.id
    GROUP BY cs.id, cs.nombre
    ORDER BY cs.nombre
```

Incluye sectores sin nombramientos (`total_servidores = 0`, `sueldo_bruto_avg = null`). `ORDER BY cs.nombre` usa la collation de la base.

**Post-proceso**: mapeo directo, sin redondeo.

**Respuesta** `list[SectorWithStats]`:

```python
class SectorWithStats(BaseModel):
    id: int
    nombre: str
    total_servidores: int
    sueldo_bruto_avg: float | None
    count_hombres: int
    count_mujeres: int
```

**Errores**: 429.

### 2.2 Helper `_sector_detail(session, sector_id)` (usado por 2.3 y 2.4)

**Consulta 1**:

```sql
    SELECT
        cs.id, cs.nombre,
        COUNT(n.id) AS total_servidores,
        AVG(n.sueldo_bruto)::float AS sueldo_bruto_avg,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY n.sueldo_bruto)::float AS sueldo_bruto_median,
        AVG(n.sueldo_neto)::float AS sueldo_neto_avg,
        AVG(p.edad)::float AS edad_avg,
        COUNT(*) FILTER (WHERE csex.nombre = 'MASCULINO') AS count_hombres,
        COUNT(*) FILTER (WHERE csex.nombre = 'FEMENINO') AS count_mujeres,
        CASE
            WHEN AVG(n.sueldo_bruto) FILTER (WHERE csex.nombre = 'FEMENINO') > 0
            THEN ((AVG(n.sueldo_bruto) FILTER (WHERE csex.nombre = 'MASCULINO')
                  - AVG(n.sueldo_bruto) FILTER (WHERE csex.nombre = 'FEMENINO'))
                  / AVG(n.sueldo_bruto) FILTER (WHERE csex.nombre = 'FEMENINO') * 100)::float
            ELSE NULL
        END AS brecha_genero_pct
    FROM cdmx.cat_sectores cs
    LEFT JOIN cdmx.nombramientos n ON n.sector_id = cs.id
    LEFT JOIN cdmx.personas p ON n.persona_id = p.id
    LEFT JOIN cdmx.cat_sexos csex ON p.sexo_id = csex.id
    WHERE cs.id = :sector_id
    GROUP BY cs.id, cs.nombre
```

`row = result.mappings().one_or_none()`; `None` → `HTTPException(404, "Sector no encontrado")`.

**Consulta 2 — top puestos**:

```sql
    SELECT cp.nombre AS puesto, COUNT(*) AS count, AVG(n.sueldo_bruto)::float AS sueldo_avg
    FROM cdmx.nombramientos n
    JOIN cdmx.cat_puestos cp ON n.puesto_id = cp.id
    WHERE n.sector_id = :sector_id
    GROUP BY cp.nombre
    ORDER BY count DESC
    LIMIT 10
```

(agrupa por **nombre** de puesto, no por id; sin desempate en `ORDER BY count DESC`).

**Post-proceso**: mapeo directo, sin redondeo. Devuelve `SectorDetailStats`.

### 2.3 `GET /api/v1/sectores/compare`

- **summary**: `Comparar dos sectores lado a lado`
- **description**: `Devuelve el detalle estadístico completo (sueldo promedio, mediana, percentiles, top 10 puestos, brecha de género) para dos sectores identificados por su `id`. Útil para visualizaciones comparativas. Si cualquiera de los dos sectores no existe, devuelve `404` (el primer raise gana — `a` antes que `b`). Cache HTTP `public, max-age=3600`.`
- **Rate limit**: `15/minute`. Auth: ninguna.
- **response_model**: `SectorComparison`.
- **responses OpenAPI**: 200 `"Comparación lado a lado de dos sectores."`; 404 `HTTPError404` `"Uno o ambos `sector_id` no existen en `cdmx.cat_sectores`."` ejemplo `{"detail": "Sector no encontrado"}`; 429 `"Rate limit excedido (15 req/min por IP)."`.

**Parámetros** (query):

| Nombre | Tipo | Default | Requerido | description |
|---|---|---|---|---|
| `a` | int | — | sí (`Query(...)`) | `ID del sector A` |
| `b` | int | — | sí | `ID del sector B` |

**Ejecución**: `sector_a = await _sector_detail(session, a)` y luego `sector_b = await _sector_detail(session, b)` (secuencial; 4 consultas en total; si `a` no existe no se consulta `b`).

**Respuesta**:

```python
class TopPuesto(BaseModel):
    puesto: str
    count: int
    sueldo_avg: float | None

class SectorDetailStats(BaseModel):
    id: int
    nombre: str
    total_servidores: int
    sueldo_bruto_avg: float | None
    sueldo_bruto_median: float | None
    sueldo_neto_avg: float | None
    edad_avg: float | None
    count_hombres: int
    count_mujeres: int
    brecha_genero_pct: float | None
    top_puestos: list[TopPuesto]

class SectorComparison(BaseModel):
    sector_a: SectorDetailStats
    sector_b: SectorDetailStats
```

**Errores**: 422 si falta `a` o `b` o no son enteros; 404 `Sector no encontrado`; 429.

### 2.4 `GET /api/v1/sectores/{sector_id}/stats`

- **summary**: `Detalle estadístico de un sector`
- **description**: `Detalle completo de un sector identificado por `sector_id`: totales, promedio y mediana de sueldo bruto, percentiles, promedio de edad, desglose por género (con brecha %), y top 10 puestos del sector con su sueldo promedio. Cache HTTP `public, max-age=3600`.`
- **Rate limit**: `30/minute`. Auth: ninguna.
- **response_model**: `SectorDetailStats`.
- **responses OpenAPI**: 200 `"Detalle completo del sector."` ejemplo `{"id":1,"nombre":"Secretaría de Educación","total_servidores":8230,"sueldo_bruto_avg":14820.50,"sueldo_bruto_median":12500.00,"sueldo_neto_avg":12200.30,"edad_avg":38.5,"count_hombres":3100,"count_mujeres":5130,"brecha_genero_pct":12.4,"top_puestos":[{"puesto":"DOCENTE","count":4200,"sueldo_avg":13200.0}]}`; 404 `"`sector_id` no existe en `cdmx.cat_sectores`."` ejemplo `{"detail": "Sector no encontrado"}`; 429 `"Rate limit excedido (30 req/min por IP)."`.

**Parámetros**: path `sector_id: int`. **Ejecución**: `return await _sector_detail(session, sector_id)` (sección 2.2).

**Errores**: 404 `Sector no encontrado`; 422 path no entero; 429.

---

## 3. Router `catalogos` (`routers/catalogos.py`)

`router = APIRouter(prefix="/api/v1/catalogos", tags=["catalogos"])`. Cache para todo el router (cualquier método): `public, max-age=3600` + `Vary: Origin`.

Constantes compartidas:

```python
_CATALOG_EXAMPLE = [
    {"id": 1, "nombre": "Base", "count": 153000},
    {"id": 2, "nombre": "Honorarios", "count": 28400},
]
_INTERNAL_NOTE = (
    "Requiere JWT admin. El SDK Python `datos-mexico` no expone este "
    "endpoint por ser operacional, no analítico."
)
_RESP_429 = {"model": HTTPError429, "description": "Rate limit excedido (60 req/min por IP)."}
_RESP_200_CATALOG = {
    "description": "Lista del catálogo con conteo de uso.",
    "content": {"application/json": {"example": _CATALOG_EXAMPLE}},
}
```

Helper genérico:

```python
async def _catalog_with_count(session, model, fk_col):
    stmt = (
        select(model.id, model.nombre, func.count(Nombramiento.id).label("count"))
        .outerjoin(Nombramiento, fk_col == model.id)
        .group_by(model.id, model.nombre)
        .order_by(model.nombre)
    )
    result = await session.execute(stmt)
    return [CatalogItemWithCount(id=r.id, nombre=r.nombre, count=r.count) for r in result.all()]
```

Respuesta común de 3.1–3.7:

```python
class CatalogItemWithCount(BaseModel):
    id: int
    nombre: str
    count: int
```

Todos los GET de este router: rate limit `60/minute`, sin auth, sin parámetros (salvo `/puestos`), responses OpenAPI `{200: _RESP_200_CATALOG, 429: _RESP_429}`.

### 3.1 `GET /api/v1/catalogos/tipos-contratacion`

- **summary**: `Catálogo de tipos de contratación con conteo de uso`
- **description**: `Devuelve los tipos de contratación del padrón CDMX (Base, Honorarios, Eventual, etc.) con el conteo de nombramientos que referencian cada uno. Cache HTTP `public, max-age=3600`.`

```sql
SELECT cdmx.cat_tipos_contratacion.id, cdmx.cat_tipos_contratacion.nombre, count(cdmx.nombramientos.id) AS count
FROM cdmx.cat_tipos_contratacion LEFT OUTER JOIN cdmx.nombramientos ON cdmx.nombramientos.tipo_contratacion_id = cdmx.cat_tipos_contratacion.id GROUP BY cdmx.cat_tipos_contratacion.id, cdmx.cat_tipos_contratacion.nombre ORDER BY cdmx.cat_tipos_contratacion.nombre
```

### 3.2 `GET /api/v1/catalogos/tipos-personal`

- **summary**: `Catálogo de tipos de personal con conteo de uso`
- **description**: `Devuelve los tipos de personal (Operativo, Mando, etc.) con conteo de nombramientos por tipo. Cache HTTP `public, max-age=3600`.`

```sql
SELECT cdmx.cat_tipos_personal.id, cdmx.cat_tipos_personal.nombre, count(cdmx.nombramientos.id) AS count
FROM cdmx.cat_tipos_personal LEFT OUTER JOIN cdmx.nombramientos ON cdmx.nombramientos.tipo_personal_id = cdmx.cat_tipos_personal.id GROUP BY cdmx.cat_tipos_personal.id, cdmx.cat_tipos_personal.nombre ORDER BY cdmx.cat_tipos_personal.nombre
```

### 3.3 `GET /api/v1/catalogos/tipos-nomina`

- **summary**: `Catálogo de tipos de nómina con conteo de uso`
- **description**: `Devuelve los tipos de nómina identificados por la columna `clave` (integer, NO `nombre` como los otros catálogos) con conteo de uso. Cache HTTP `public, max-age=3600`.`

```sql
SELECT cdmx.cat_tipos_nomina.id, CAST(cdmx.cat_tipos_nomina.clave AS VARCHAR) AS nombre, count(cdmx.nombramientos.id) AS count
FROM cdmx.cat_tipos_nomina LEFT OUTER JOIN cdmx.nombramientos ON cdmx.nombramientos.tipo_nomina_id = cdmx.cat_tipos_nomina.id GROUP BY cdmx.cat_tipos_nomina.id, cdmx.cat_tipos_nomina.clave ORDER BY cdmx.cat_tipos_nomina.clave
```

`nombre` en la respuesta es la `clave` entera como texto (p. ej. `"8"`); orden numérico por `clave`.

### 3.4 `GET /api/v1/catalogos/universos`

- **summary**: `Catálogo de universos con conteo de uso`
- **description**: `Devuelve los universos del padrón CDMX (agrupaciones administrativas) con conteo de nombramientos por universo. Cache HTTP `public, max-age=3600`.`

```sql
SELECT cdmx.cat_universos.id, cdmx.cat_universos.nombre, count(cdmx.nombramientos.id) AS count
FROM cdmx.cat_universos LEFT OUTER JOIN cdmx.nombramientos ON cdmx.nombramientos.universo_id = cdmx.cat_universos.id GROUP BY cdmx.cat_universos.id, cdmx.cat_universos.nombre ORDER BY cdmx.cat_universos.nombre
```

### 3.5 `GET /api/v1/catalogos/sectores`

- **summary**: `Catálogo de los 73 sectores con conteo de uso`
- **description**: `Devuelve los 73 sectores del padrón CDMX con conteo de nombramientos por sector, ordenados alfabéticamente. Cache HTTP `public, max-age=3600`.`

```sql
SELECT cdmx.cat_sectores.id, cdmx.cat_sectores.nombre, count(cdmx.nombramientos.id) AS count
FROM cdmx.cat_sectores LEFT OUTER JOIN cdmx.nombramientos ON cdmx.nombramientos.sector_id = cdmx.cat_sectores.id GROUP BY cdmx.cat_sectores.id, cdmx.cat_sectores.nombre ORDER BY cdmx.cat_sectores.nombre
```

### 3.6 `GET /api/v1/catalogos/sexos`

- **summary**: `Catálogo de sexos con conteo de uso`
- **description**: `Devuelve el catálogo `cat_sexos` (MASCULINO, FEMENINO, no especificado) con conteo de personas por valor. Cache HTTP `public, max-age=3600`.`

```sql
SELECT cdmx.cat_sexos.id, cdmx.cat_sexos.nombre, count(cdmx.personas.id) AS count
FROM cdmx.cat_sexos LEFT OUTER JOIN cdmx.personas ON cdmx.personas.sexo_id = cdmx.cat_sexos.id GROUP BY cdmx.cat_sexos.id, cdmx.cat_sexos.nombre ORDER BY cdmx.cat_sexos.nombre
```

(cuenta **personas**, no nombramientos).

### 3.7 `GET /api/v1/catalogos/niveles-salariales`

- **summary**: `Catálogo de niveles salariales con conteo de uso`
- **description**: `Devuelve los niveles salariales identificados por `clave` con conteo de nombramientos por nivel. Cache HTTP `public, max-age=3600`.`

```sql
SELECT cdmx.cat_niveles_salariales.id, CAST(cdmx.cat_niveles_salariales.clave AS VARCHAR) AS nombre, count(cdmx.nombramientos.id) AS count
FROM cdmx.cat_niveles_salariales LEFT OUTER JOIN cdmx.nombramientos ON cdmx.nombramientos.nivel_salarial_id = cdmx.cat_niveles_salariales.id GROUP BY cdmx.cat_niveles_salariales.id, cdmx.cat_niveles_salariales.clave ORDER BY cdmx.cat_niveles_salariales.clave
```

### 3.8 `GET /api/v1/catalogos/puestos`

- **summary**: `Catálogo paginado de puestos con búsqueda`
- **description**: `Devuelve los 1 772 puestos del padrón CDMX paginados, con conteo de nombramientos por puesto. Soporta búsqueda ILIKE vía `search`. Ordenado por conteo descendente. Cache HTTP `public, max-age=3600`.`
- **Rate limit**: `60/minute`. Auth: ninguna.
- **response_model**: `PaginatedResponse[PuestoWithCount]`.
- **responses OpenAPI**: 200 `"Página del catálogo de puestos."` ejemplo `{"data":[{"id":1024,"nombre":"POLICIA","count":80000},{"id":1025,"nombre":"DOCENTE FRENTE A GRUPO","count":12500}],"total":1772,"page":1,"per_page":50,"pages":36}`; 429 `_RESP_429`.

**Parámetros** (query, sin `description`):

| Nombre | Tipo | Default | Validación |
|---|---|---|---|
| `search` | str \| None | null | — ; sólo aplica si es truthy (`""` no filtra) |
| `page` | int | 1 | `ge=1` |
| `per_page` | int | 50 | `ge=1`, `le=200` |

**Consulta 1 — total** (sobre `cdmx.cat_puestos` sin JOIN):

```sql
-- sin search
SELECT count(*) AS count_1
FROM (SELECT cdmx.cat_puestos.id AS id
FROM cdmx.cat_puestos) AS anon_1

-- con search (parámetro = '%' + search + '%')
SELECT count(*) AS count_1
FROM (SELECT cdmx.cat_puestos.id AS id
FROM cdmx.cat_puestos
WHERE cdmx.cat_puestos.nombre ILIKE %(nombre_1)s) AS anon_1
```

**Consulta 2 — datos**:

```sql
SELECT cdmx.cat_puestos.id, cdmx.cat_puestos.nombre, count(cdmx.nombramientos.id) AS count
FROM cdmx.cat_puestos LEFT OUTER JOIN cdmx.nombramientos ON cdmx.nombramientos.puesto_id = cdmx.cat_puestos.id
[WHERE cdmx.cat_puestos.nombre ILIKE %(nombre_1)s]
GROUP BY cdmx.cat_puestos.id, cdmx.cat_puestos.nombre ORDER BY count(cdmx.nombramientos.id) DESC
LIMIT %(param_1)s OFFSET %(param_2)s
```

`LIMIT per_page OFFSET (page-1)*per_page`. Sin desempate en el orden.

**Post-proceso**: `pages = (total + per_page - 1) // per_page` (sin guardia; con `total=0` da 0).

**Respuesta** `PaginatedResponse[PuestoWithCount]`:

```python
class PuestoWithCount(BaseModel):
    id: int
    nombre: str
    count: int
```

**Errores**: 422 validación; 429.

### 3.9 CRUD genérico — mapa de catálogos

```python
CATALOG_MAP: dict[str, dict[str, Any]] = {
    "sexos":               {"model": CatSexo,            "fk_col": Persona.sexo_id,                 "fields": ["nombre"]},
    "puestos":             {"model": CatPuesto,          "fk_col": Nombramiento.puesto_id,          "fields": ["nombre"]},
    "tipos-contratacion":  {"model": CatTipoContratacion,"fk_col": Nombramiento.tipo_contratacion_id,"fields": ["nombre"]},
    "tipos-personal":      {"model": CatTipoPersonal,    "fk_col": Nombramiento.tipo_personal_id,   "fields": ["nombre"]},
    "tipos-nomina":        {"model": CatTipoNomina,      "fk_col": Nombramiento.tipo_nomina_id,     "fields": ["clave"]},
    "universos":           {"model": CatUniverso,        "fk_col": Nombramiento.universo_id,        "fields": ["clave", "nombre"]},
    "sectores":            {"model": CatSector,          "fk_col": Nombramiento.sector_id,          "fields": ["clave", "nombre"]},
    "niveles-salariales":  {"model": CatNivelSalarial,   "fk_col": Nombramiento.nivel_salarial_id,  "fields": ["clave"]},
}

def _get_catalog(tipo: str):
    info = CATALOG_MAP.get(tipo)
    if info is None:
        raise HTTPException(status_code=404, detail=f"Catalog type '{tipo}' not found")
    return info

def _item_to_dict(item) -> dict:
    return {"id": item.id, **{c.name: getattr(item, c.name) for c in item.__table__.columns if c.name != "id"}}

_CATALOG_TIPOS = "`sexos`, `puestos`, `tipos-contratacion`, `tipos-personal`, `tipos-nomina`, `universos`, `sectores`, `niveles-salariales`"
```

Tabla por `tipo`:

| `tipo` | Tabla | `fields` | Tabla/columna de referencia (`fk_col`) | Dict devuelto |
|---|---|---|---|---|
| `sexos` | `cdmx.cat_sexos` | `nombre` | `cdmx.personas.sexo_id` | `{"id","nombre"}` |
| `puestos` | `cdmx.cat_puestos` | `nombre` | `cdmx.nombramientos.puesto_id` | `{"id","nombre"}` |
| `tipos-contratacion` | `cdmx.cat_tipos_contratacion` | `nombre` | `cdmx.nombramientos.tipo_contratacion_id` | `{"id","nombre"}` |
| `tipos-personal` | `cdmx.cat_tipos_personal` | `nombre` | `cdmx.nombramientos.tipo_personal_id` | `{"id","nombre"}` |
| `tipos-nomina` | `cdmx.cat_tipos_nomina` | `clave` (int) | `cdmx.nombramientos.tipo_nomina_id` | `{"id","clave"}` |
| `universos` | `cdmx.cat_universos` | `clave` (str), `nombre` | `cdmx.nombramientos.universo_id` | `{"id","clave","nombre"}` |
| `sectores` | `cdmx.cat_sectores` | `clave` (str), `nombre` | `cdmx.nombramientos.sector_id` | `{"id","clave","nombre"}` |
| `niveles-salariales` | `cdmx.cat_niveles_salariales` | `clave` (int) | `cdmx.nombramientos.nivel_salarial_id` | `{"id","clave"}` |

Los tres endpoints CRUD **no tienen `response_model`** (devuelven el dict de `_item_to_dict` tal cual, o vacío en DELETE) y **no tienen rate limit**. Los esquemas `CatalogCreateNombre`, `CatalogCreateClave`, `CatalogCreateClaveNombre`, `CatalogUpdate*` y `CatalogResponse` de `schemas/catalogs.py` existen pero **no se usan** (el body se recibe como `dict = Body(...)`).

### 3.10 `POST /api/v1/catalogos/{tipo}`

- **status_code**: 201
- **summary**: `Crear un item en un catálogo (admin)`
- **description**: `[Uso interno administrativo] Inserta un item nuevo en uno de los catálogos: `sexos`, `puestos`, `tipos-contratacion`, `tipos-personal`, `tipos-nomina`, `universos`, `sectores`, `niveles-salariales`. Cada catálogo tiene su lista de campos requeridos (`nombre`, `clave`, o combinación). Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.`
- **Auth**: `require_admin`. Rate limit: ninguno. Cache: `public, max-age=3600` (efecto colateral del middleware).
- **responses OpenAPI**: 201 `"Item de catálogo creado."`; 401 `HTTPError401` `"JWT ausente o inválido."`; 403 `HTTPError403` `"Usuario autenticado sin privilegios admin."`; 404 `HTTPError404` `"El `tipo` de catálogo no existe (debe ser uno de los 8 listados)."` ejemplo `{"detail": "Catalog type 'foo' not found"}`; 422 `"Campo requerido del catálogo ausente en el body."`.

**Parámetros**: path `tipo: str`; body JSON objeto (`dict = Body(...)`; si no es objeto JSON → 422 de FastAPI).

**Lógica**:

```python
info = _get_catalog(tipo)                      # 404 si tipo desconocido
for field in info["fields"]:
    if field not in body:
        raise HTTPException(status_code=422, detail=f"Missing required field: '{field}'")
kwargs = {f: body[f] for f in info["fields"]}  # claves extra del body se ignoran
item = model(**kwargs); session.add(item); await session.commit(); await session.refresh(item)
return _item_to_dict(item)
```

SQL (ORM): `INSERT INTO cdmx.<tabla> (<fields>) VALUES (...) RETURNING cdmx.<tabla>.id` (id generado por la base) y luego `SELECT <columnas> FROM cdmx.<tabla> WHERE cdmx.<tabla>.id = :pk` (refresh). No hay validación de tipos en el body (los modelos SQLModel `table=True` no validan): un valor de tipo incorrecto llega a la base y produce error → 500. No hay chequeo de duplicados.

**Respuesta**: 201 con el dict de la fila (`{"id": ..., "nombre": ...}` o `{"id": ..., "clave": ..., "nombre": ...}` según tabla).

**Errores** (orden): 401/403 (dependencia) → 422 body no-objeto → 404 `Catalog type '<tipo>' not found` → 422 `Missing required field: '<field>'`.

### 3.11 `PUT /api/v1/catalogos/{tipo}/{item_id}`

- **summary**: `Actualizar un item de catálogo (admin)`
- **description**: `[Uso interno administrativo] Actualiza un item existente en uno de los catálogos (`sexos`, `puestos`, `tipos-contratacion`, `tipos-personal`, `tipos-nomina`, `universos`, `sectores`, `niveles-salariales`). Sólo los campos válidos para ese catálogo son aplicados. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.`
- **Auth**: `require_admin`. Rate limit: ninguno.
- **responses OpenAPI**: 200 `"Item actualizado."`; 401 `"JWT ausente o inválido."`; 403 `"Usuario autenticado sin privilegios admin."`; 404 `"`tipo` de catálogo o `item_id` no existe."` ejemplo `{"detail": "sectores item 999 not found"}`.

**Parámetros**: path `tipo: str`, `item_id: int`; body JSON objeto.

**Lógica**:

```python
info = _get_catalog(tipo)                                   # 404 "Catalog type '<tipo>' not found"
item = await session.get(model, item_id)                    # SELECT ... FROM cdmx.<tabla> WHERE id = :pk
if item is None:
    raise HTTPException(status_code=404, detail=f"{tipo} item {item_id} not found")
for field in info["fields"]:
    if field in body:
        setattr(item, field, body[field])                   # campos ausentes no se tocan; claves extra se ignoran
session.add(item); await session.commit(); await session.refresh(item)
return _item_to_dict(item)
```

SQL: `SELECT` por PK; `UPDATE cdmx.<tabla> SET <campo>=... WHERE cdmx.<tabla>.id = :pk` sólo si cambió algún atributo; `SELECT` de refresh. Body vacío `{}` → 200 sin cambios.

**Respuesta**: 200 con el dict de la fila. **Errores**: 401/403; 422 body no-objeto; 404 `Catalog type '<tipo>' not found`; 404 `<tipo> item <item_id> not found`.

### 3.12 `DELETE /api/v1/catalogos/{tipo}/{item_id}`

- **status_code**: 204
- **summary**: `Eliminar un item de catálogo (admin) — bloqueado si hay FK refs`
- **description**: `[Uso interno administrativo] Elimina un item de catálogo. **Devuelve 409 si hay nombramientos o personas que referencian este item** — primero hay que migrarlos o eliminarlos. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.`
- **Auth**: `require_admin`. Rate limit: ninguno.
- **responses OpenAPI**: 204 `"Item eliminado (sin body)."`; 401; 403; 404 `"`tipo` o `item_id` no existe."` ejemplo `{"detail": "puestos item 999 not found"}`; 409 `HTTPError409` `"El item tiene FK refs activas (no se puede borrar)."` ejemplo `{"detail": "Cannot delete: 80000 records reference this puestos item"}`.

**Parámetros**: path `tipo: str`, `item_id: int`.

**Lógica**:

```python
info = _get_catalog(tipo)
item = await session.get(model, item_id)
if item is None: raise HTTPException(404, f"{tipo} item {item_id} not found")
ref_count = (await session.execute(select(func.count()).where(fk_col == item_id))).scalar_one()
if ref_count > 0: raise HTTPException(409, f"Cannot delete: {ref_count} records reference this {tipo} item")
await session.delete(item); await session.commit()
```

SQL de conteo (ejemplos compilados):

```sql
-- tipo != sexos
SELECT count(*) AS count_1
FROM cdmx.nombramientos
WHERE cdmx.nombramientos.<fk_col> = %(<fk_col>_1)s
-- tipo = sexos
SELECT count(*) AS count_1
FROM cdmx.personas
WHERE cdmx.personas.sexo_id = %(sexo_id_1)s
```

Borrado: `DELETE FROM cdmx.<tabla> WHERE cdmx.<tabla>.id = :pk`.

**Respuesta**: 204 sin body. **Errores**: 401/403; 404 `Catalog type '<tipo>' not found`; 404 `<tipo> item <item_id> not found`; 409 `Cannot delete: <n> records reference this <tipo> item`.

---

## 4. Router `dashboard` (`routers/dashboard.py`)

`router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])`. Cache: `public, max-age=3600`.

Comentario del módulo: `Snapshot metrics come from materialized views (see migrations/004_materialized_views.sql). Refresh via POST /api/v1/admin/refresh-materialized-views.`

### 4.1 `GET /api/v1/dashboard/stats`

- **summary**: `Snapshot agregado del padrón CDMX`
- **description**: `Devuelve un snapshot completo del dataset de servidores públicos de la CDMX (246K nombramientos): totales, percentiles salariales (p25/p50/p75/p90), distribuciones por sueldo / edad / contratación / tipo de personal, top 15 sectores, brecha de género por sector (top 10 por magnitud absoluta), posiciones más frecuentes, distribución de antigüedad, y desglose bruto vs neto por rango. Las cifras provienen mayoritariamente de las cinco materialized views `cdmx.mv_dashboard_*` (refresco vía `POST /api/v1/admin/refresh-materialized-views`). Cache HTTP `public, max-age=3600`.`
- **Rate limit**: `10/minute`. Auth: ninguna.
- **response_model**: `DashboardStats`.
- **responses OpenAPI**: 200 `"Snapshot completo del padrón CDMX."` con el ejemplo largo del código (campos `totalServidores: 246821, totalSectors: 73, avgSalary: 16842.33, medianSalary: 12500.00, minSalary: 0.0, maxSalary: 220000.0, p25: 8500.0, p50: 12500.0, p75: 22000.0, p90: 45000.0, genderGapPercent: 14.2, hombres: 132540, mujeres: 114281, avgSalaryMale: 17920.50, avgSalaryFemale: 15685.40, salaryDistribution: [{"label":"Menos de $5K","count":12005},{"label":"$5K - $10K","count":89215}], ageDistribution: [{"label":"18-25","count":4210},{"label":"26-35","count":51820}], contractTypes: [{"label":"Base","count":153000}], personalTypes: [{"label":"Operativo","count":188100}], salaryByAge: [{"label":"26-35","avg":14200.55}], top15Sectors: [{"name":"Secretaría de Seguridad Ciudadana","count":88500,"avgSalary":14200.0,"avgMale":14820.0,"avgFemale":13050.0}], allSectors: [], genderGapBySector: [{"name":"Servicios de Salud Pública","avgMale":18000.0,"avgFemale":14200.0,"gap":26.76}], topPositions: [{"name":"POLICIA","count":80000,"avgSalary":13800.0}], seniorityDistribution: [{"label":"0-5 años","count":64000}], salaryBySeniority: [{"label":"0-5 años","avg":12000.0,"count":64000}], avgSeniority: 11.4, avgNetSalary: 13950.20, avgDeduction: 2892.13, avgDeductionPercent: 17.18, brutoNetoByRange: [{"label":"$10K - $20K","avgBruto":14200.0,"avgNeto":11700.0,"count":95000}]`); 429 `"Rate limit excedido (10 req/min por IP)."`.

**Parámetros**: ninguno.

**Ejecución**: 11 consultas lanzadas en paralelo con `asyncio.gather`, cada una en su propia conexión (`async with engine.connect() as conn: return await conn.execute(text(sql))`), en este orden de resultados: `overview, salary_dist, age_dist, contract, personal, salary_age, sectors, positions, seniority_dist, salary_seniority, bruto_neto`.

**Consultas (verbatim)**:

```sql
-- SQL_OVERVIEW
SELECT * FROM cdmx.mv_dashboard_overview WHERE key = 1
```

```sql
-- SQL_SALARY_DISTRIBUTION
SELECT label, count FROM (
    SELECT 'Menos de $5K' AS label, COUNT(*) AS count, 1 AS ord
    FROM cdmx.nombramientos WHERE sueldo_bruto < 5000 AND sueldo_bruto IS NOT NULL
    UNION ALL
    SELECT '$5K - $10K', COUNT(*), 2
    FROM cdmx.nombramientos WHERE sueldo_bruto >= 5000 AND sueldo_bruto < 10000
    UNION ALL
    SELECT '$10K - $20K', COUNT(*), 3
    FROM cdmx.nombramientos WHERE sueldo_bruto >= 10000 AND sueldo_bruto < 20000
    UNION ALL
    SELECT '$20K - $40K', COUNT(*), 4
    FROM cdmx.nombramientos WHERE sueldo_bruto >= 20000 AND sueldo_bruto < 40000
    UNION ALL
    SELECT 'Más de $40K', COUNT(*), 5
    FROM cdmx.nombramientos WHERE sueldo_bruto >= 40000
) sub ORDER BY ord
```

```sql
-- SQL_AGE_DISTRIBUTION
SELECT label, count FROM (
    SELECT '18-25' AS label, COUNT(*) AS count, 1 AS ord
    FROM cdmx.personas WHERE edad BETWEEN 18 AND 25
    UNION ALL
    SELECT '26-35', COUNT(*), 2
    FROM cdmx.personas WHERE edad BETWEEN 26 AND 35
    UNION ALL
    SELECT '36-45', COUNT(*), 3
    FROM cdmx.personas WHERE edad BETWEEN 36 AND 45
    UNION ALL
    SELECT '46-55', COUNT(*), 4
    FROM cdmx.personas WHERE edad BETWEEN 46 AND 55
    UNION ALL
    SELECT '56+', COUNT(*), 5
    FROM cdmx.personas WHERE edad > 55
) sub ORDER BY ord
```

```sql
-- SQL_CONTRACT_TYPES
SELECT ct.nombre AS label, COUNT(*) AS count
FROM cdmx.nombramientos n
JOIN cdmx.cat_tipos_contratacion ct ON n.tipo_contratacion_id = ct.id
GROUP BY ct.nombre
ORDER BY count DESC
```

```sql
-- SQL_PERSONAL_TYPES
SELECT tp.nombre AS label, COUNT(*) AS count
FROM cdmx.nombramientos n
JOIN cdmx.cat_tipos_personal tp ON n.tipo_personal_id = tp.id
GROUP BY tp.nombre
ORDER BY count DESC
```

```sql
-- SQL_SALARY_BY_AGE
SELECT label, avg FROM cdmx.mv_dashboard_salary_by_age ORDER BY ord
```

```sql
-- SQL_SECTORS
SELECT name, count, avg_salary, avg_male, avg_female FROM cdmx.mv_dashboard_sectors ORDER BY count DESC
```

```sql
-- SQL_TOP_POSITIONS
SELECT name, count, avg_salary FROM cdmx.mv_dashboard_top_positions ORDER BY avg_salary DESC
```

```sql
-- SQL_SENIORITY_DISTRIBUTION
SELECT label, count_all AS count FROM cdmx.mv_dashboard_seniority ORDER BY ord
```

```sql
-- SQL_SALARY_BY_SENIORITY
SELECT label, avg_salary AS avg, count_with_salary AS count FROM cdmx.mv_dashboard_seniority ORDER BY ord
```

```sql
-- SQL_BRUTO_NETO_BY_RANGE
SELECT label, avg_bruto, avg_neto, count FROM (
    SELECT 'Menos de $5K' AS label,
        AVG(sueldo_bruto)::float AS avg_bruto,
        AVG(sueldo_neto)::float AS avg_neto,
        COUNT(*) AS count, 1 AS ord
    FROM cdmx.nombramientos
    WHERE sueldo_bruto < 5000 AND sueldo_bruto IS NOT NULL AND sueldo_neto IS NOT NULL
    UNION ALL
    SELECT '$5K - $10K', AVG(sueldo_bruto)::float, AVG(sueldo_neto)::float, COUNT(*), 2
    FROM cdmx.nombramientos
    WHERE sueldo_bruto >= 5000 AND sueldo_bruto < 10000 AND sueldo_neto IS NOT NULL
    UNION ALL
    SELECT '$10K - $20K', AVG(sueldo_bruto)::float, AVG(sueldo_neto)::float, COUNT(*), 3
    FROM cdmx.nombramientos
    WHERE sueldo_bruto >= 10000 AND sueldo_bruto < 20000 AND sueldo_neto IS NOT NULL
    UNION ALL
    SELECT '$20K - $40K', AVG(sueldo_bruto)::float, AVG(sueldo_neto)::float, COUNT(*), 4
    FROM cdmx.nombramientos
    WHERE sueldo_bruto >= 20000 AND sueldo_bruto < 40000 AND sueldo_neto IS NOT NULL
    UNION ALL
    SELECT 'Más de $40K', AVG(sueldo_bruto)::float, AVG(sueldo_neto)::float, COUNT(*), 5
    FROM cdmx.nombramientos
    WHERE sueldo_bruto >= 40000 AND sueldo_neto IS NOT NULL
) sub ORDER BY ord
```

Definición de las vistas materializadas (anexo A). Columnas de `cdmx.mv_dashboard_overview` usadas: `total, total_sectors, avg_salary, median_salary, min_salary, max_salary, p25, p50, p75, p90, hombres, mujeres, avg_male, avg_female, avg_net, avg_deduction, avg_deduction_pct, avg_seniority` (todas filtradas por `sueldo_bruto IS NOT NULL` en la vista).

**Post-proceso (Python; `round` = redondeo de `float` de Python, half-to-even sobre binario)**:

```python
ov = overview_r.mappings().one()          # MultipleResultsFound/NoResultFound → 500

all_sectors = [SectorStats(name=r["name"], count=r["count"], avgSalary=round(r["avg_salary"], 2),
                           avgMale=round(r["avg_male"], 2), avgFemale=round(r["avg_female"], 2))
               for r in sectors_r.mappings().all()]      # orden: count DESC (de la MV)

gender_gap_sectors = []
for s in all_sectors:
    if s.avgMale > 0 and s.avgFemale > 0:
        gap = round((s.avgMale - s.avgFemale) / s.avgFemale * 100, 2)   # usa los valores YA redondeados a 2
        gender_gap_sectors.append(GenderGapSector(name=s.name, avgMale=s.avgMale, avgFemale=s.avgFemale, gap=gap))
gender_gap_sectors.sort(key=lambda x: abs(x.gap), reverse=True)        # sort estable: empates conservan orden count DESC

avg_male = ov["avg_male"] or 0
avg_female = ov["avg_female"] or 0
gender_gap_pct = round((avg_male - avg_female) / avg_female * 100, 2) if avg_female > 0 else 0
```

Campos de `DashboardStats`:

| Campo | Valor |
|---|---|
| `totalServidores` | `ov["total"]` |
| `totalSectors` | `ov["total_sectors"]` |
| `avgSalary` | `round(ov["avg_salary"] or 0, 2)` |
| `medianSalary` | `round(ov["median_salary"] or 0, 2)` |
| `minSalary` | `round(ov["min_salary"] or 0, 2)` |
| `maxSalary` | `round(ov["max_salary"] or 0, 2)` |
| `p25`, `p50`, `p75`, `p90` | `round(ov["pXX"] or 0, 2)` |
| `genderGapPercent` | `gender_gap_pct` (int `0` → `0.0`) |
| `hombres`, `mujeres` | `ov["hombres"]`, `ov["mujeres"]` |
| `avgSalaryMale` | `round(avg_male, 2)` |
| `avgSalaryFemale` | `round(avg_female, 2)` |
| `salaryDistribution` | `[LabelCount(label, count)]` de SQL_SALARY_DISTRIBUTION (5 filas fijas, orden `ord`) |
| `ageDistribution` | `[LabelCount]` de SQL_AGE_DISTRIBUTION (5 filas fijas) |
| `contractTypes` | `[LabelCount]` de SQL_CONTRACT_TYPES |
| `personalTypes` | `[LabelCount]` de SQL_PERSONAL_TYPES |
| `salaryByAge` | `[LabelAvg(label, avg=round(r["avg"], 2))]` (si `avg` es NULL → `TypeError` → 500) |
| `top15Sectors` | `all_sectors[:15]` |
| `allSectors` | `all_sectors` |
| `genderGapBySector` | `gender_gap_sectors[:10]` |
| `topPositions` | `[TopPosition(name, count, avgSalary=round(r["avg_salary"], 2))]` (10 filas de la MV, orden `avg_salary DESC`) |
| `seniorityDistribution` | `[LabelCount(label, count)]` de SQL_SENIORITY_DISTRIBUTION (6 filas, orden `ord`) |
| `salaryBySeniority` | `[SeniorityWithSalary(label, avg=round(r["avg"], 2), count)]` (`avg` NULL → 500) |
| `avgSeniority` | `round(ov["avg_seniority"] or 0, 2)` |
| `avgNetSalary` | `round(ov["avg_net"] or 0, 2)` |
| `avgDeduction` | `round(ov["avg_deduction"] or 0, 2)` |
| `avgDeductionPercent` | `round(ov["avg_deduction_pct"] or 0, 2)` |
| `brutoNetoByRange` | `[BrutoNetoRange(label, avgBruto=round(r["avg_bruto"], 2), avgNeto=round(r["avg_neto"], 2), count)]` (5 filas; `avg_*` NULL en un rango vacío → 500) |

**Respuesta** `DashboardStats` (camelCase literal):

```python
class LabelCount(BaseModel):        label: str; count: int
class LabelAvg(BaseModel):          label: str; avg: float
class SectorStats(BaseModel):       name: str; count: int; avgSalary: float; avgMale: float; avgFemale: float
class GenderGapSector(BaseModel):   name: str; avgMale: float; avgFemale: float; gap: float
class TopPosition(BaseModel):       name: str; count: int; avgSalary: float
class SeniorityWithSalary(BaseModel): label: str; avg: float; count: int
class BrutoNetoRange(BaseModel):    label: str; avgBruto: float; avgNeto: float; count: int

class DashboardStats(BaseModel):
    totalServidores: int
    totalSectors: int
    avgSalary: float
    medianSalary: float
    minSalary: float
    maxSalary: float
    p25: float
    p50: float
    p75: float
    p90: float
    genderGapPercent: float
    hombres: int
    mujeres: int
    avgSalaryMale: float
    avgSalaryFemale: float
    salaryDistribution: list[LabelCount]
    ageDistribution: list[LabelCount]
    contractTypes: list[LabelCount]
    personalTypes: list[LabelCount]
    salaryByAge: list[LabelAvg]
    top15Sectors: list[SectorStats]
    allSectors: list[SectorStats]
    genderGapBySector: list[GenderGapSector]
    topPositions: list[TopPosition]
    seniorityDistribution: list[LabelCount]
    salaryBySeniority: list[SeniorityWithSalary]
    avgSeniority: float
    avgNetSalary: float
    avgDeduction: float
    avgDeductionPercent: float
    brutoNetoByRange: list[BrutoNetoRange]
```

Etiquetas literales: sueldo `'Menos de $5K'`, `'$5K - $10K'`, `'$10K - $20K'`, `'$20K - $40K'`, `'Más de $40K'`; edad `'18-25'`, `'26-35'`, `'36-45'`, `'46-55'`, `'56+'`; antigüedad (de la MV) `'0-2 años'`, `'3-5 años'`, `'6-10 años'`, `'11-20 años'`, `'21-30 años'`, `'30+ años'`.

**Errores**: 429; 500 si las MV no existen o no están pobladas (`ov` sin fila), o por `round(None)`.

---

## 5. Router `analytics` (`routers/analytics.py`)

`router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])`. Cache: `public, max-age=900`. Todas las consultas se ejecutan con `async with engine.connect() as conn` (sin sesión). Todos con rate limit `20/minute`, sin auth.

### 5.1 `GET /api/v1/analytics/puestos/ranking`

- **summary**: `Top puestos por sueldo promedio (RANK + PERCENT_RANK + LAG)`
- **description**: `Top puestos del padrón CDMX ordenados por sueldo bruto promedio descendente. Cada fila incluye `rank` (RANK), `percent_rank` (PERCENT_RANK normalizado 0..1) y `gap_vs_next` (diferencia absoluta vs el sueldo del puesto anterior — útil para detectar saltos discontinuos en la curva). Filtro implícito: sólo puestos con `COUNT(*) >= 5` para evitar outliers de un solo nombramiento. Cache HTTP `public, max-age=900`.`
- **response_model**: `list[PuestoRanking]`.
- **responses OpenAPI**: 200 `"Lista rankeada de puestos."` ejemplo `[{"puesto_id":1024,"nombre":"DIRECTOR EJECUTIVO","avg_sueldo":78500.00,"count":12,"rank":1,"percent_rank":1.0,"gap_vs_next":null},{"puesto_id":1025,"nombre":"DIRECTOR GENERAL DE AREA","avg_sueldo":72100.50,"count":45,"rank":2,"percent_rank":0.9982,"gap_vs_next":6399.50}]`; 429 `"Rate limit excedido (20 req/min por IP)."`.

**Parámetros** (query): `limit: int = Query(20, ge=1, le=100)` (sin description).

**Consulta** (`{"limit": limit}`):

```sql
WITH agg AS (
    SELECT
        cp.id AS puesto_id,
        cp.nombre AS nombre,
        AVG(n.sueldo_bruto)::float AS avg_sueldo,
        COUNT(*) AS cnt
    FROM cdmx.nombramientos n
    JOIN cdmx.cat_puestos cp ON n.puesto_id = cp.id
    WHERE n.sueldo_bruto IS NOT NULL
    GROUP BY cp.id, cp.nombre
    HAVING COUNT(*) >= 5
)
SELECT
    puesto_id,
    nombre,
    avg_sueldo,
    cnt AS count,
    RANK() OVER (ORDER BY avg_sueldo DESC) AS rank,
    PERCENT_RANK() OVER (ORDER BY avg_sueldo) AS percent_rank,
    LAG(avg_sueldo) OVER (ORDER BY avg_sueldo DESC) AS prev_avg
FROM agg
ORDER BY avg_sueldo DESC
LIMIT :limit
```

**Post-proceso**:

```python
PuestoRanking(
    puesto_id=r["puesto_id"], nombre=r["nombre"],
    avg_sueldo=round(r["avg_sueldo"], 2), count=r["count"], rank=r["rank"],
    percent_rank=round(r["percent_rank"], 4),
    gap_vs_next=round(r["avg_sueldo"] - r["prev_avg"], 2) if r["prev_avg"] is not None else None,
)
```

Nota de paridad: `gap_vs_next = avg_sueldo − prev_avg`, donde `prev_avg` es el promedio del puesto **anterior en orden descendente** (mayor), por lo que el valor real es **≤ 0** (negativo), no el positivo del ejemplo OpenAPI. Se calcula con `avg_sueldo` sin redondear. La primera fila tiene `gap_vs_next = null`.

**Respuesta**:

```python
class PuestoRanking(BaseModel):
    puesto_id: int
    nombre: str
    avg_sueldo: float
    count: int
    rank: int
    percent_rank: float
    gap_vs_next: float | None
```

**Errores**: 422 (`limit` fuera de 1..100); 429.

### 5.2 `GET /api/v1/analytics/sectores/ranking`

- **summary**: `Sectores rankeados por sueldo promedio (con desviación vs media global)`
- **description**: `Los 73 sectores del padrón CDMX rankeados por sueldo bruto promedio descendente. Cada fila incluye `avg_vs_global_pct` (desviación porcentual del sector respecto al promedio global computado con `AVG() OVER ()`), útil para identificar sectores atípicos por encima o debajo de la media institucional. Cache HTTP `public, max-age=900`.`
- **response_model**: `list[SectorRanking]`.
- **responses OpenAPI**: 200 `"Lista rankeada de los 73 sectores."` ejemplo `[{"sector_id":12,"nombre":"Procuraduría General de Justicia","avg_sueldo":24500.00,"count":8200,"rank":1,"percent_rank":1.0,"avg_vs_global_pct":45.45},{"sector_id":45,"nombre":"Sistema de Aguas de la Ciudad","avg_sueldo":16842.33,"count":6750,"rank":37,"percent_rank":0.5,"avg_vs_global_pct":0.00}]`; 429 `"Rate limit excedido (20 req/min por IP)."`.

**Parámetros**: ninguno.

**Consulta**:

```sql
WITH agg AS (
    SELECT
        cs.id AS sector_id,
        cs.nombre AS nombre,
        AVG(n.sueldo_bruto)::float AS avg_sueldo,
        COUNT(*) AS cnt
    FROM cdmx.nombramientos n
    JOIN cdmx.cat_sectores cs ON n.sector_id = cs.id
    WHERE n.sueldo_bruto IS NOT NULL
    GROUP BY cs.id, cs.nombre
)
SELECT
    sector_id,
    nombre,
    avg_sueldo,
    cnt AS count,
    RANK() OVER (ORDER BY avg_sueldo DESC) AS rank,
    PERCENT_RANK() OVER (ORDER BY avg_sueldo) AS percent_rank,
    AVG(avg_sueldo) OVER () AS avg_global
FROM agg
ORDER BY rank
```

Sin `LIMIT`. Sólo sectores con al menos un nombramiento con sueldo. `avg_global` es el promedio **no ponderado** de los promedios sectoriales.

**Post-proceso**:

```python
SectorRanking(
    sector_id=r["sector_id"], nombre=r["nombre"],
    avg_sueldo=round(r["avg_sueldo"], 2), count=r["count"], rank=r["rank"],
    percent_rank=round(r["percent_rank"], 4),
    avg_vs_global_pct=round((r["avg_sueldo"] - r["avg_global"]) / r["avg_global"] * 100, 2) if r["avg_global"] else 0.0,
)
```

**Respuesta**:

```python
class SectorRanking(BaseModel):
    sector_id: int
    nombre: str
    avg_sueldo: float
    count: int
    rank: int
    percent_rank: float
    avg_vs_global_pct: float
```

**Errores**: 429.

### 5.3 `GET /api/v1/analytics/brecha-edad`

- **summary**: `Brecha salarial por grupo etario (con referencia global)`
- **description**: `Brecha salarial hombre/mujer (`gap_pct = (avg_male - avg_female) / avg_female * 100`) por bucket de edad: `18-25`, `26-35`, `36-45`, `46-55`, `56+`. Devuelve también `running_avg_global` (promedio del padrón completo replicado en cada fila, vía `AVG() OVER ()`) para que el consumidor compare cada bucket con el promedio global sin emitir un request adicional. Cache HTTP `public, max-age=900`.`
- **response_model**: `list[BrechaEdadRow]`.
- **responses OpenAPI**: 200 `"Brecha por grupo etario (5 buckets)."` ejemplo `[{"bucket_edad":"18-25","avg_male":9820.00,"avg_female":9450.00,"count_male":2310,"count_female":1900,"gap_pct":3.92,"running_avg_global":16842.33},{"bucket_edad":"46-55","avg_male":22480.50,"avg_female":18925.20,"count_male":30200,"count_female":26800,"gap_pct":18.79,"running_avg_global":16842.33}]`; 429 `"Rate limit excedido (20 req/min por IP)."`.

**Parámetros**: ninguno.

**Consulta**:

```sql
WITH buckets AS (
    SELECT
        CASE
            WHEN p.edad BETWEEN 18 AND 25 THEN '18-25'
            WHEN p.edad BETWEEN 26 AND 35 THEN '26-35'
            WHEN p.edad BETWEEN 36 AND 45 THEN '36-45'
            WHEN p.edad BETWEEN 46 AND 55 THEN '46-55'
            WHEN p.edad > 55 THEN '56+'
            ELSE NULL
        END AS bucket_edad,
        CASE WHEN p.edad BETWEEN 18 AND 25 THEN 1
             WHEN p.edad BETWEEN 26 AND 35 THEN 2
             WHEN p.edad BETWEEN 36 AND 45 THEN 3
             WHEN p.edad BETWEEN 46 AND 55 THEN 4
             WHEN p.edad > 55 THEN 5 END AS ord,
        n.sueldo_bruto,
        csex.nombre AS sexo
    FROM cdmx.nombramientos n
    JOIN cdmx.personas p ON n.persona_id = p.id
    LEFT JOIN cdmx.cat_sexos csex ON p.sexo_id = csex.id
    WHERE n.sueldo_bruto IS NOT NULL AND p.edad IS NOT NULL
),
agg AS (
    SELECT
        bucket_edad,
        ord,
        AVG(sueldo_bruto) FILTER (WHERE sexo = 'MASCULINO')::float AS avg_male,
        AVG(sueldo_bruto) FILTER (WHERE sexo = 'FEMENINO')::float AS avg_female,
        COUNT(*) FILTER (WHERE sexo = 'MASCULINO') AS count_male,
        COUNT(*) FILTER (WHERE sexo = 'FEMENINO') AS count_female,
        AVG(sueldo_bruto)::float AS avg_bucket
    FROM buckets
    WHERE bucket_edad IS NOT NULL
    GROUP BY bucket_edad, ord
)
SELECT
    bucket_edad,
    avg_male,
    avg_female,
    count_male,
    count_female,
    CASE
        WHEN avg_male IS NOT NULL AND avg_female IS NOT NULL AND avg_female > 0
            THEN ((avg_male - avg_female) / avg_female * 100)::float
        ELSE NULL
    END AS gap_pct,
    AVG(avg_bucket) OVER ()::float AS running_avg_global
FROM agg
ORDER BY ord
```

`running_avg_global` es el promedio **no ponderado** de los 5 promedios por bucket (no el promedio del padrón). Edades < 18 quedan fuera. Sólo aparecen buckets con filas.

**Post-proceso**:

```python
BrechaEdadRow(
    bucket_edad=r["bucket_edad"],
    avg_male=round(r["avg_male"], 2) if r["avg_male"] is not None else None,
    avg_female=round(r["avg_female"], 2) if r["avg_female"] is not None else None,
    count_male=r["count_male"], count_female=r["count_female"],
    gap_pct=round(r["gap_pct"], 2) if r["gap_pct"] is not None else None,
    running_avg_global=round(r["running_avg_global"], 2),
)
```

**Respuesta**:

```python
class BrechaEdadRow(BaseModel):
    bucket_edad: str
    avg_male: float | None
    avg_female: float | None
    count_male: int
    count_female: int
    gap_pct: float | None
    running_avg_global: float
```

**Errores**: 429.

---

## 6. Router `personas` (`routers/personas.py`)

`router = APIRouter(prefix="/api/v1/personas", tags=["personas"])`. Cache: `no-store` (todo el router, por `WRITE_PREFIXES`).

```python
_PERSONA_EXAMPLE = {"id": 42, "nombre": "MARIA", "apellido_1": "RODRIGUEZ", "apellido_2": "LOPEZ", "sexo_id": 2, "edad": 38}
_INTERNAL_NOTE = ("Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.")
```

Esquemas:

```python
class PersonaCreate(BaseModel):
    nombre: str
    apellido_1: str
    apellido_2: str | None = None
    sexo_id: int | None = None
    edad: int | None = None

class PersonaUpdate(BaseModel):
    nombre: str | None = None
    apellido_1: str | None = None
    apellido_2: str | None = None
    sexo_id: int | None = None
    edad: int | None = None

class PersonaResponse(BaseModel):
    id: int
    nombre: str
    apellido_1: str
    apellido_2: str | None = None
    sexo_id: int | None = None
    edad: int | None = None
```

Proyección ORM de `select(Persona)`: `SELECT cdmx.personas.id, cdmx.personas.nombre, cdmx.personas.apellido_1, cdmx.personas.apellido_2, cdmx.personas.sexo_id, cdmx.personas.edad FROM cdmx.personas`.

### 6.1 `GET /api/v1/personas/`

- **summary**: `Listar personas del padrón con paginación y búsqueda`
- **description**: `[Uso interno administrativo] Lista paginada de personas del padrón CDMX. Soporta filtros por `nombre` (ILIKE sobre nombre, apellido_1 y apellido_2 simultáneamente) y `sexo_id`. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.`
- **Rate limit**: `30/minute`. **Auth: ninguna** (pese al texto).
- **response_model**: `PaginatedResponse[PersonaResponse]`.
- **responses OpenAPI**: 200 `"Página de personas."` ejemplo `{"data":[_PERSONA_EXAMPLE],"total":246821,"page":1,"per_page":50,"pages":4937}`; 429 `"Rate limit excedido (30 req/min por IP)."`.

**Parámetros** (query, sin description):

| Nombre | Tipo | Default | Validación |
|---|---|---|---|
| `page` | int | 1 | `ge=1` |
| `per_page` | int | 50 | `ge=1`, `le=200` |
| `nombre` | str \| None | null | sólo aplica si truthy (`""` no filtra) |
| `sexo_id` | int \| None | null | aplica si no es None |

**Consultas** (`like = f"%{nombre}%"`; los tres ILIKE reciben el mismo valor):

```sql
-- total
SELECT count(cdmx.personas.id) AS count_1
FROM cdmx.personas
[WHERE (cdmx.personas.nombre ILIKE %(nombre_1)s OR cdmx.personas.apellido_1 ILIKE %(apellido_1_1)s OR cdmx.personas.apellido_2 ILIKE %(apellido_2_1)s)] [AND] [cdmx.personas.sexo_id = %(sexo_id_1)s]

-- datos
SELECT cdmx.personas.id, cdmx.personas.nombre, cdmx.personas.apellido_1, cdmx.personas.apellido_2, cdmx.personas.sexo_id, cdmx.personas.edad
FROM cdmx.personas
[WHERE ... mismos predicados ...]
ORDER BY cdmx.personas.id
LIMIT %(param_1)s OFFSET %(param_2)s
```

**Post-proceso**: `data = [PersonaResponse.model_validate(r, from_attributes=True) ...]`; `pages = (total + per_page - 1) // per_page if total > 0 else 0`.

**Errores**: 422 validación; 429.

### 6.2 `GET /api/v1/personas/{persona_id}`

- **summary**: `Detalle de una persona por ID`
- **description**: `[Uso interno administrativo] Detalle de una persona del padrón por su ID numérico. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.`
- **Rate limit**: `60/minute`. **Auth: ninguna**.
- **response_model**: `PersonaResponse`.
- **responses OpenAPI**: 200 `"Detalle de persona."` ejemplo `_PERSONA_EXAMPLE`; 404 `"`persona_id` no existe."` ejemplo `{"detail": "Persona no encontrada"}`; 429 `"Rate limit excedido (60 req/min por IP)."`.

**Parámetros**: path `persona_id: int`.

```sql
SELECT cdmx.personas.id, cdmx.personas.nombre, cdmx.personas.apellido_1, cdmx.personas.apellido_2, cdmx.personas.sexo_id, cdmx.personas.edad
FROM cdmx.personas
WHERE cdmx.personas.id = %(id_1)s
```

`scalar_one_or_none()`; `None` → `404 {"detail": "Persona no encontrada"}`. Devuelve el objeto ORM serializado con `PersonaResponse`.

### 6.3 `POST /api/v1/personas/`

- **status_code**: 201
- **summary**: `Crear una persona (admin)`
- **description**: `[Uso interno administrativo] Inserta una persona nueva en el padrón. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.`
- **Auth**: `require_admin`. Rate limit: ninguno.
- **response_model**: `PersonaResponse`.
- **responses OpenAPI**: 201 `"Persona creada."` ejemplo `_PERSONA_EXAMPLE`; 401 `"JWT ausente o inválido."`; 403 `"Usuario autenticado sin privilegios admin."`; 422 `"`sexo_id` no existe en `cdmx.cat_sexos`, o body inválido."`.

**Body**: `PersonaCreate` (`nombre`, `apellido_1` requeridos).

**Lógica**:

```python
if body.sexo_id is not None:
    sexo = await session.get(CatSexo, body.sexo_id)       # SELECT ... FROM cdmx.cat_sexos WHERE id = :pk
    if sexo is None:
        raise HTTPException(status_code=422, detail=f"sexo_id {body.sexo_id} does not exist")
persona = Persona(**body.model_dump()); session.add(persona); await session.commit(); await session.refresh(persona)
return persona
```

SQL: `INSERT INTO cdmx.personas (nombre, apellido_1, apellido_2, sexo_id, edad) VALUES (...) RETURNING cdmx.personas.id` + `SELECT` de refresh.

**Errores** (orden): 401/403; 422 Pydantic (body); 422 `{"detail": "sexo_id <n> does not exist"}`.

### 6.4 `PUT /api/v1/personas/{persona_id}`

- **summary**: `Actualizar una persona (admin)`
- **description**: `[Uso interno administrativo] Actualiza campos de una persona existente. Sólo los campos enviados en el body se modifican (`exclude_unset=True`). Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.`
- **Auth**: `require_admin`. Rate limit: ninguno. **response_model**: `PersonaResponse`.
- **responses OpenAPI**: 200 `"Persona actualizada."`; 401; 403; 404 `"`persona_id` no existe."` ejemplo `{"detail": "Persona no encontrada"}`; 422 `"`sexo_id` no existe, o body inválido."`.

**Parámetros**: path `persona_id: int`; body `PersonaUpdate` (todos opcionales).

**Lógica**:

```python
persona = await session.get(Persona, persona_id)          # 404 "Persona no encontrada"
update_data = body.model_dump(exclude_unset=True)         # sólo claves presentes en el JSON; null explícito SÍ se aplica
if "sexo_id" in update_data and update_data["sexo_id"] is not None:
    sexo = await session.get(CatSexo, update_data["sexo_id"])
    if sexo is None:
        raise HTTPException(status_code=422, detail=f"sexo_id {update_data['sexo_id']} does not exist")
for key, value in update_data.items(): setattr(persona, key, value)
session.add(persona); await session.commit(); await session.refresh(persona)
return persona
```

SQL: `SELECT` por PK; `UPDATE cdmx.personas SET ... WHERE cdmx.personas.id = :pk` (sólo columnas cambiadas); `SELECT` de refresh. Enviar `"nombre": null` asigna NULL (la base decidirá si lo acepta → posible 500).

**Errores**: 401/403; 422 Pydantic; 404 `Persona no encontrada`; 422 `sexo_id <n> does not exist`.

### 6.5 `DELETE /api/v1/personas/{persona_id}`

- **status_code**: 204
- **summary**: `Eliminar una persona (admin) — requiere que no tenga nombramientos`
- **description**: `[Uso interno administrativo] Elimina una persona del padrón. **Devuelve 409 si la persona tiene nombramientos activos** — primero hay que eliminar los nombramientos. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.`
- **Auth**: `require_admin`. Rate limit: ninguno.
- **responses OpenAPI**: 204 `"Persona eliminada (sin body)."`; 401; 403; 404 `"`persona_id` no existe."` ejemplo `{"detail": "Persona no encontrada"}`; 409 `HTTPError409` `"La persona tiene nombramientos referenciados."` ejemplo `{"detail": "Cannot delete persona with active nombramientos"}`.

**Lógica**:

```python
persona = await session.get(Persona, persona_id)          # 404 "Persona no encontrada"
count = (await session.execute(select(func.count(Nombramiento.id)).where(Nombramiento.persona_id == persona_id))).scalar_one()
if count > 0: raise HTTPException(409, "Cannot delete persona with active nombramientos")
await session.delete(persona); await session.commit()
```

```sql
SELECT count(cdmx.nombramientos.id) AS count_1
FROM cdmx.nombramientos
WHERE cdmx.nombramientos.persona_id = %(persona_id_1)s
```

Borrado: `DELETE FROM cdmx.personas WHERE cdmx.personas.id = :pk`. Respuesta 204 sin body.

**Errores**: 401/403; 404 `Persona no encontrada`; 409 `Cannot delete persona with active nombramientos`.

---

## 7. Router `nombramientos` (`routers/nombramientos.py`)

`router = APIRouter(prefix="/api/v1/nombramientos", tags=["nombramientos"])`. Cache: `no-store`.

```python
FK_MODELS = {
    "puesto_id": CatPuesto,                 # cdmx.cat_puestos
    "sector_id": CatSector,                 # cdmx.cat_sectores
    "tipo_nomina_id": CatTipoNomina,        # cdmx.cat_tipos_nomina
    "tipo_contratacion_id": CatTipoContratacion,  # cdmx.cat_tipos_contratacion
    "tipo_personal_id": CatTipoPersonal,    # cdmx.cat_tipos_personal
    "universo_id": CatUniverso,             # cdmx.cat_universos
    "nivel_salarial_id": CatNivelSalarial,  # cdmx.cat_niveles_salariales
}

async def _validate_fks(session, data: dict):
    """Validate that all FK references exist."""
    for field, model in FK_MODELS.items():        # en este orden
        value = data.get(field)
        if value is not None:
            obj = await session.get(model, value)  # SELECT ... FROM cdmx.<tabla> WHERE id = :pk
            if obj is None:
                raise HTTPException(status_code=422, detail=f"{field} {value} does not exist")

_NOMB_EXAMPLE = {"id": 12345, "persona_id": 42, "puesto_id": 1024, "sector_id": 8, "tipo_nomina_id": 8,
                 "tipo_contratacion_id": 1, "tipo_personal_id": 2, "universo_id": 3, "nivel_salarial_id": 11,
                 "fecha_ingreso": "2015-03-12", "sueldo_bruto": "18500.00", "sueldo_neto": "14820.50"}
_INTERNAL_NOTE = ("Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.")
```

Esquemas:

```python
class NombramientoCreate(BaseModel):
    persona_id: int
    puesto_id: int | None = None
    sector_id: int | None = None
    tipo_nomina_id: int | None = None
    tipo_contratacion_id: int | None = None
    tipo_personal_id: int | None = None
    universo_id: int | None = None
    nivel_salarial_id: int | None = None
    fecha_ingreso: datetime.date | None = None
    sueldo_bruto: Decimal | None = None
    sueldo_neto: Decimal | None = None

class NombramientoUpdate(BaseModel):   # igual que Create sin persona_id, todo opcional
    puesto_id, sector_id, tipo_nomina_id, tipo_contratacion_id, tipo_personal_id, universo_id, nivel_salarial_id: int | None = None
    fecha_ingreso: datetime.date | None = None
    sueldo_bruto: Decimal | None = None
    sueldo_neto: Decimal | None = None

class NombramientoResponse(BaseModel):
    id: int
    persona_id: int
    puesto_id: int | None = None
    sector_id: int | None = None
    tipo_nomina_id: int | None = None
    tipo_contratacion_id: int | None = None
    tipo_personal_id: int | None = None
    universo_id: int | None = None
    nivel_salarial_id: int | None = None
    fecha_ingreso: datetime.date | None = None   # "YYYY-MM-DD"
    sueldo_bruto: Decimal | None = None          # JSON string "18500.00"
    sueldo_neto: Decimal | None = None           # JSON string
```

Proyección ORM de `select(Nombramiento)`: `SELECT cdmx.nombramientos.id, cdmx.nombramientos.persona_id, cdmx.nombramientos.puesto_id, cdmx.nombramientos.sector_id, cdmx.nombramientos.tipo_nomina_id, cdmx.nombramientos.tipo_contratacion_id, cdmx.nombramientos.tipo_personal_id, cdmx.nombramientos.universo_id, cdmx.nombramientos.nivel_salarial_id, cdmx.nombramientos.fecha_ingreso, cdmx.nombramientos.sueldo_bruto, cdmx.nombramientos.sueldo_neto FROM cdmx.nombramientos`.

### 7.1 `GET /api/v1/nombramientos/`

- **summary**: `Listar nombramientos con paginación y filtros`
- **description**: `[Uso interno administrativo] Lista paginada de nombramientos. Soporta filtros por `persona_id` y `sector_id`. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.`
- **Rate limit**: `30/minute`. **Auth: ninguna**.
- **response_model**: `PaginatedResponse[NombramientoResponse]`.
- **responses OpenAPI**: 200 `"Página de nombramientos."` ejemplo `{"data":[_NOMB_EXAMPLE],"total":246821,"page":1,"per_page":50,"pages":4937}`; 429 `"Rate limit excedido (30 req/min por IP)."`.

**Parámetros** (query, sin description): `page: int = 1 (ge=1)`, `per_page: int = 50 (ge=1, le=200)`, `persona_id: int | None = None`, `sector_id: int | None = None` (ambos aplican si no son None).

```sql
-- total
SELECT count(cdmx.nombramientos.id) AS count_1
FROM cdmx.nombramientos
[WHERE cdmx.nombramientos.persona_id = %(persona_id_1)s] [AND cdmx.nombramientos.sector_id = %(sector_id_1)s]

-- datos
SELECT <12 columnas> FROM cdmx.nombramientos
[WHERE ...]
ORDER BY cdmx.nombramientos.id
LIMIT %(param_1)s OFFSET %(param_2)s
```

**Post-proceso**: `NombramientoResponse.model_validate(r, from_attributes=True)`; `pages = (total + per_page - 1) // per_page if total > 0 else 0`.

**Errores**: 422 validación; 429.

### 7.2 `GET /api/v1/nombramientos/{nombramiento_id}`

- **summary**: `Detalle de un nombramiento por ID`
- **description**: `[Uso interno administrativo] Detalle de un nombramiento por su ID numérico. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.`
- **Rate limit**: `60/minute`. **Auth: ninguna**. **response_model**: `NombramientoResponse`.
- **responses OpenAPI**: 200 `"Detalle de nombramiento."` ejemplo `_NOMB_EXAMPLE`; 404 `"`nombramiento_id` no existe."` ejemplo `{"detail": "Nombramiento no encontrado"}`; 429 `"Rate limit excedido (60 req/min por IP)."`.

```sql
SELECT <12 columnas> FROM cdmx.nombramientos
WHERE cdmx.nombramientos.id = %(id_1)s
```

`scalar_one_or_none()`; `None` → `404 {"detail": "Nombramiento no encontrado"}`.

### 7.3 `POST /api/v1/nombramientos/`

- **status_code**: 201
- **summary**: `Crear un nombramiento (admin)`
- **description**: `[Uso interno administrativo] Inserta un nombramiento nuevo asociado a una `persona_id`. Valida que la persona exista y que todos los IDs de catálogo (`puesto_id`, `sector_id`, etc.) referenciados existan. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.`
- **Auth**: `require_admin`. Rate limit: ninguno. **response_model**: `NombramientoResponse`.
- **responses OpenAPI**: 201 `"Nombramiento creado."`; 401; 403; 422 `"`persona_id` o algún `*_id` de catálogo no existe."`.

**Body**: `NombramientoCreate` (`persona_id` requerido).

**Lógica**:

```python
persona = await session.get(Persona, body.persona_id)     # SELECT ... FROM cdmx.personas WHERE id = :pk
if persona is None: raise HTTPException(422, f"persona_id {body.persona_id} does not exist")
await _validate_fks(session, body.model_dump())            # 422 "<campo> <valor> does not exist"
nombramiento = Nombramiento(**body.model_dump()); session.add(...); await session.commit(); await session.refresh(...)
return nombramiento
```

SQL: `INSERT INTO cdmx.nombramientos (persona_id, puesto_id, sector_id, tipo_nomina_id, tipo_contratacion_id, tipo_personal_id, universo_id, nivel_salarial_id, fecha_ingreso, sueldo_bruto, sueldo_neto) VALUES (...) RETURNING cdmx.nombramientos.id` + refresh.

**Errores** (orden): 401/403; 422 Pydantic; 422 `persona_id <n> does not exist`; 422 `<fk_field> <valor> does not exist` (primer FK inválido en el orden de `FK_MODELS`).

### 7.4 `PUT /api/v1/nombramientos/{nombramiento_id}`

- **summary**: `Actualizar un nombramiento (admin)`
- **description**: `[Uso interno administrativo] Actualiza campos de un nombramiento existente. Sólo los campos enviados se modifican (`exclude_unset=True`). Valida FKs referenciadas. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.`
- **Auth**: `require_admin`. Rate limit: ninguno. **response_model**: `NombramientoResponse`.
- **responses OpenAPI**: 200 `"Nombramiento actualizado."`; 401; 403; 404 `"`nombramiento_id` no existe."` ejemplo `{"detail": "Nombramiento no encontrado"}`; 422 `"Algún `*_id` de catálogo en el body no existe."`.

**Lógica**:

```python
nombramiento = await session.get(Nombramiento, nombramiento_id)   # 404 "Nombramiento no encontrado"
update_data = body.model_dump(exclude_unset=True)
await _validate_fks(session, update_data)                          # sólo FKs presentes y no nulas
for key, value in update_data.items(): setattr(nombramiento, key, value)
session.add(...); await session.commit(); await session.refresh(...)
return nombramiento
```

`persona_id` no es actualizable (no está en `NombramientoUpdate`). SQL: `SELECT` por PK; `UPDATE cdmx.nombramientos SET ... WHERE cdmx.nombramientos.id = :pk`; refresh.

**Errores**: 401/403; 422 Pydantic; 404 `Nombramiento no encontrado`; 422 `<fk_field> <valor> does not exist`.

### 7.5 `DELETE /api/v1/nombramientos/{nombramiento_id}`

- **status_code**: 204
- **summary**: `Eliminar un nombramiento (admin)`
- **description**: `[Uso interno administrativo] Elimina un nombramiento existente. No tiene constraint FK de cascada — la persona padre permanece. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.`
- **Auth**: `require_admin`. Rate limit: ninguno.
- **responses OpenAPI**: 204 `"Nombramiento eliminado (sin body)."`; 401; 403; 404 `"`nombramiento_id` no existe."` ejemplo `{"detail": "Nombramiento no encontrado"}`.

**Lógica**: `session.get(Nombramiento, id)` → 404 `Nombramiento no encontrado`; `DELETE FROM cdmx.nombramientos WHERE cdmx.nombramientos.id = :pk`; 204 sin body.

---

## 8. Router `export` (`routers/export.py`)

`router = APIRouter(prefix="/api/v1/export", tags=["export"])`. `P = Persona`, `N = Nombramiento`, `MAX_EXPORT_ROWS = 50_000`. Cache: **ningún header** (no coincide ninguna rama del middleware).

### 8.1 `GET /api/v1/export/csv`

- **summary**: `Exportar nombramientos CDMX en CSV (≤ 50 000 filas)`
- **description**: `Exporta hasta 50 000 filas del padrón CDMX en formato CSV (`text/csv`, `Content-Disposition: attachment`) con los mismos filtros que `GET /api/v1/servidores/`. Columnas: `id`, `nombre`, `apellido_1`, `apellido_2`, `sexo`, `edad`, `sueldo_bruto`, `sueldo_neto`, `fecha_ingreso`, `sector`, `puesto`, `tipo_contratacion`, `tipo_personal`, `tipo_nomina`, `universo`. Para exports más grandes consumir paginado vía `/api/v1/servidores/`. Rate limit estricto (5/min/IP) — endpoint diseñado para descarga puntual, no para bulk extraction continua.`
- **Rate limit**: `5/minute`. Auth: ninguna. Sin `response_model`.
- **responses OpenAPI**: 200 `"Stream CSV con headers de descarga."`, content `text/csv` ejemplo:
  `id,nombre,apellido_1,apellido_2,sexo,edad,sueldo_bruto,sueldo_neto,fecha_ingreso,sector,puesto,tipo_contratacion,tipo_personal,tipo_nomina,universo\n1,JUAN,PEREZ,GARCIA,MASCULINO,42,18500.00,14820.50,2015-03-12,Secretaría de Movilidad,JEFE DE UNIDAD,Base,Operativo,8,A\n`; 429 `"Rate limit excedido (5 req/min por IP)."`.

**Parámetros**: los de `get_filters` (sección 0.8). `page` y `per_page` se aceptan y se **ignoran** (no hay OFFSET); `order_by`/`order` sí aplican.

**Consulta** (`apply_filters(stmt, filters, _sexo_joined=True)` + `apply_ordering` + `.limit(MAX_EXPORT_ROWS)`):

```sql
SELECT cdmx.personas.id, cdmx.personas.nombre, cdmx.personas.apellido_1, cdmx.personas.apellido_2, cdmx.cat_sexos.nombre AS sexo, cdmx.personas.edad, cdmx.nombramientos.sueldo_bruto, cdmx.nombramientos.sueldo_neto, cdmx.nombramientos.fecha_ingreso, cdmx.cat_sectores.nombre AS sector, cdmx.cat_puestos.nombre AS puesto, cdmx.cat_tipos_contratacion.nombre AS tipo_contratacion, cdmx.cat_tipos_personal.nombre AS tipo_personal, CAST(cdmx.cat_tipos_nomina.clave AS VARCHAR) AS tipo_nomina, cdmx.cat_universos.nombre AS universo
FROM cdmx.personas JOIN cdmx.nombramientos ON cdmx.nombramientos.persona_id = cdmx.personas.id LEFT OUTER JOIN cdmx.cat_sexos ON cdmx.personas.sexo_id = cdmx.cat_sexos.id LEFT OUTER JOIN cdmx.cat_sectores ON cdmx.nombramientos.sector_id = cdmx.cat_sectores.id LEFT OUTER JOIN cdmx.cat_puestos ON cdmx.nombramientos.puesto_id = cdmx.cat_puestos.id LEFT OUTER JOIN cdmx.cat_tipos_contratacion ON cdmx.nombramientos.tipo_contratacion_id = cdmx.cat_tipos_contratacion.id LEFT OUTER JOIN cdmx.cat_tipos_personal ON cdmx.nombramientos.tipo_personal_id = cdmx.cat_tipos_personal.id LEFT OUTER JOIN cdmx.cat_tipos_nomina ON cdmx.nombramientos.tipo_nomina_id = cdmx.cat_tipos_nomina.id LEFT OUTER JOIN cdmx.cat_universos ON cdmx.nombramientos.universo_id = cdmx.cat_universos.id
[WHERE <predicados de apply_filters>]
ORDER BY cdmx.personas.id ASC
LIMIT %(param_1)s          -- 50000
```

Mismo defecto que 1.1 con `puesto_search` (segundo `JOIN cdmx.cat_puestos` sin alias → error de PostgreSQL → 500). Sin `OFFSET`. `rows = result.all()` carga todo en memoria antes de emitir.

**Formato CSV** (`csv.writer` con dialecto por defecto `excel`):

```python
columns = ["id", "nombre", "apellido_1", "apellido_2", "sexo", "edad",
           "sueldo_bruto", "sueldo_neto", "fecha_ingreso",
           "sector", "puesto", "tipo_contratacion", "tipo_personal",
           "tipo_nomina", "universo"]
def generate():
    output = io.StringIO(); writer = csv.writer(output)
    writer.writerow(columns); yield output.getvalue(); output.seek(0); output.truncate(0)
    for row in rows:
        writer.writerow([getattr(row, col, None) for col in columns])
        yield output.getvalue(); output.seek(0); output.truncate(0)
return StreamingResponse(generate(), media_type="text/csv",
                         headers={"Content-Disposition": "attachment; filename=remuneraciones_cdmx.csv"})
```

- Delimitador `,`; comillas `"` sólo cuando el campo contiene delimitador, comillas o salto de línea (`QUOTE_MINIMAL`); comillas internas duplicadas (`""`); terminador de línea `\r\n`; sin BOM.
- Encabezado exacto: `id,nombre,apellido_1,apellido_2,sexo,edad,sueldo_bruto,sueldo_neto,fecha_ingreso,sector,puesto,tipo_contratacion,tipo_personal,tipo_nomina,universo\r\n`.
- `None` → campo vacío; `Decimal` → `str(Decimal)` (p. ej. `18500.00`); `date` → `2015-03-12`; `tipo_nomina` → clave como texto.
- Ejemplo verificado: `1,"JUAN, JR",O'HARA,,MASCULINO,42,18500.00,,2015-03-12,"Secretaría ""X""",,,,8,A\r\n`.
- Codificación: UTF-8 (Starlette codifica los chunks `str` con `charset=utf-8`).
- Headers de respuesta: `content-type: text/csv; charset=utf-8`, `content-disposition: attachment; filename=remuneraciones_cdmx.csv`; sin `Content-Length` (transferencia chunked).

**Errores**: 422 validación de query; 429; 500 con `puesto_search`.

---

## 9. Catálogos y constantes

### 9.1 `routers/servidores.py`

- `router = APIRouter(prefix="/api/v1/servidores", tags=["servidores"])`; `P = Persona`; `N = Nombramiento`.
- Rangos de `distribucion_sueldo` (literal, en orden de `MIN(sueldo_bruto)`): `'0-5K'` (<5000), `'5K-10K'` (<10000), `'10K-20K'` (<20000), `'20K-30K'` (<30000), `'30K-50K'` (<50000), `'50K-80K'` (<80000), `'80K-120K'` (<120000), `'120K+'`.
- Valores de sexo comparados: `'MASCULINO'`, `'FEMENINO'`.
- Mensajes: `"Servidor no encontrado"`.

### 9.2 `routers/sectores.py`

- `router = APIRouter(prefix="/api/v1/sectores", tags=["sectores"])`.
- Mensajes: `"Sector no encontrado"`. `LIMIT 10` en top puestos.

### 9.3 `routers/catalogos.py`

- `router = APIRouter(prefix="/api/v1/catalogos", tags=["catalogos"])`.
- `CATALOG_MAP` (sección 3.9), `_CATALOG_EXAMPLE`, `_INTERNAL_NOTE`, `_RESP_429`, `_RESP_200_CATALOG` (sección 3), `_CATALOG_TIPOS = "`sexos`, `puestos`, `tipos-contratacion`, `tipos-personal`, `tipos-nomina`, `universos`, `sectores`, `niveles-salariales`"`.
- Mensajes: `f"Catalog type '{tipo}' not found"`, `f"Missing required field: '{field}'"`, `f"{tipo} item {item_id} not found"`, `f"Cannot delete: {ref_count} records reference this {tipo} item"`.

### 9.4 `routers/dashboard.py`

- `router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])`.
- `SQL_OVERVIEW`, `SQL_SALARY_DISTRIBUTION`, `SQL_AGE_DISTRIBUTION`, `SQL_CONTRACT_TYPES`, `SQL_PERSONAL_TYPES`, `SQL_SALARY_BY_AGE`, `SQL_SECTORS`, `SQL_TOP_POSITIONS`, `SQL_SENIORITY_DISTRIBUTION`, `SQL_SALARY_BY_SENIORITY`, `SQL_BRUTO_NETO_BY_RANGE` (sección 4.1, verbatim).
- Etiquetas literales: `'Menos de $5K'`, `'$5K - $10K'`, `'$10K - $20K'`, `'$20K - $40K'`, `'Más de $40K'`, `'18-25'`, `'26-35'`, `'36-45'`, `'46-55'`, `'56+'`.
- Cortes: top 15 sectores, top 10 brecha por sector, redondeo a 2 decimales.

### 9.5 `routers/analytics.py`

- `router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])`.
- `SQL_PUESTOS_RANKING`, `SQL_SECTORES_RANKING`, `SQL_BRECHA_EDAD` (sección 5, verbatim). `HAVING COUNT(*) >= 5` en puestos. `limit` default 20, 1..100. Redondeos: 2 decimales (montos y %), 4 decimales (`percent_rank`).

### 9.6 `routers/personas.py`

- `router = APIRouter(prefix="/api/v1/personas", tags=["personas"])`; `_PERSONA_EXAMPLE`; `_INTERNAL_NOTE`.
- Mensajes: `"Persona no encontrada"`, `f"sexo_id {n} does not exist"`, `"Cannot delete persona with active nombramientos"`.

### 9.7 `routers/nombramientos.py`

- `router = APIRouter(prefix="/api/v1/nombramientos", tags=["nombramientos"])`; `FK_MODELS`; `_NOMB_EXAMPLE`; `_INTERNAL_NOTE`.
- Mensajes: `"Nombramiento no encontrado"`, `f"persona_id {n} does not exist"`, `f"{field} {value} does not exist"`.

### 9.8 `routers/export.py`

- `router = APIRouter(prefix="/api/v1/export", tags=["export"])`; `P`, `N`; `MAX_EXPORT_ROWS = 50_000`; `columns` (sección 8.1); `media_type="text/csv"`; `Content-Disposition: attachment; filename=remuneraciones_cdmx.csv`.

### 9.9 `dependencies.py`

- `ALLOWED_ORDER_COLUMNS = {"id", "nombre", "apellido_1", "edad", "sueldo_bruto", "sueldo_neto", "fecha_ingreso"}`
- `_PERSONA_ORDER_COLS = {"id", "nombre", "apellido_1", "edad"}`
- `_NOMBRAMIENTO_ORDER_COLS = {"sueldo_bruto", "sueldo_neto", "fecha_ingreso"}`
- Defaults de `ServidorFilters`: `page=1`, `per_page=50`, `order_by="id"`, `order="asc"`.

### 9.10 `rate_limit.py` / `auth.py` / `main.py`

- Límites por endpoint: servidores list `30/minute`, stats `15/minute`, detalle `60/minute`; sectores list `30/minute`, compare `15/minute`, stats `30/minute`; catálogos GET `60/minute` (los 8); dashboard `10/minute`; analytics `20/minute` (los 3); personas GET list `30/minute`, GET detalle `60/minute`; nombramientos GET list `30/minute`, GET detalle `60/minute`; export `5/minute`; CRUD admin (9 endpoints): sin límite.
- 429: `{"detail": "Rate limit exceeded. Try again later."}`.
- 401: `{"detail": "Not authenticated"}` (sin token) / `{"detail": "Could not validate credentials"}` (token inválido), header `WWW-Authenticate: Bearer`. 403: `{"detail": "Admin privileges required"}`.
- `oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")`.
- `WRITE_PREFIXES = ("/api/v1/auth", "/api/v1/personas", "/api/v1/nombramientos", "/api/v1/ingest", "/api/v1/admin", "/api/v1/demo")`.
- Valores de Cache-Control: `"no-store"`, `"public, max-age=3600"`, `"public, max-age=900"`, `"public, max-age=300"`; `Vary: Origin`.

### 9.11 Resumen de auth/admin por endpoint

| Endpoint | Auth |
|---|---|
| `GET /api/v1/servidores/`, `/stats`, `/{servidor_id}` | pública |
| `GET /api/v1/sectores/`, `/compare`, `/{sector_id}/stats` | pública |
| `GET /api/v1/catalogos/*` (8) | pública |
| `POST /api/v1/catalogos/{tipo}`, `PUT /{tipo}/{item_id}`, `DELETE /{tipo}/{item_id}` | `require_admin` |
| `GET /api/v1/dashboard/stats` | pública |
| `GET /api/v1/analytics/*` (3) | pública |
| `GET /api/v1/personas/`, `/{persona_id}` | pública |
| `POST /api/v1/personas/`, `PUT /{persona_id}`, `DELETE /{persona_id}` | `require_admin` |
| `GET /api/v1/nombramientos/`, `/{nombramiento_id}` | pública |
| `POST /api/v1/nombramientos/`, `PUT /{nombramiento_id}`, `DELETE /{nombramiento_id}` | `require_admin` |
| `GET /api/v1/export/csv` | pública |

---

## 10. Tablas, vistas y vistas materializadas referenciadas

Tablas (esquema `cdmx`):

| Objeto | Tipo | Usado por |
|---|---|---|
| `cdmx.personas` | tabla | servidores (3), sectores (3), catalogos (`sexos`, DELETE `sexos`), dashboard (`SQL_AGE_DISTRIBUTION`), analytics (`brecha-edad`), personas (5), nombramientos (POST valida persona), export |
| `cdmx.nombramientos` | tabla | servidores (3), sectores (3), catalogos (7 conteos + DELETE), dashboard (4 SQL inline), analytics (3), personas (DELETE cuenta refs), nombramientos (5), export |
| `cdmx.cat_sexos` | tabla | servidores (3), sectores (3), catalogos (`sexos`, CRUD `sexos`), analytics (`brecha-edad`), personas (POST/PUT validan `sexo_id`), export |
| `cdmx.cat_sectores` | tabla | servidores (list, detail), sectores (3), catalogos (`sectores`, CRUD), analytics (`sectores/ranking`), nombramientos (FK), export |
| `cdmx.cat_puestos` | tabla | servidores (list, stats con `puesto_search`, detail), sectores (top puestos), catalogos (`puestos`, CRUD), analytics (`puestos/ranking`), nombramientos (FK), export |
| `cdmx.cat_tipos_contratacion` | tabla | servidores (detail), catalogos (`tipos-contratacion`, CRUD), dashboard (`SQL_CONTRACT_TYPES`), nombramientos (FK), export |
| `cdmx.cat_tipos_personal` | tabla | servidores (detail), catalogos (`tipos-personal`, CRUD), dashboard (`SQL_PERSONAL_TYPES`), nombramientos (FK), export |
| `cdmx.cat_tipos_nomina` | tabla | servidores (detail), catalogos (`tipos-nomina`, CRUD), nombramientos (FK), export |
| `cdmx.cat_universos` | tabla | servidores (detail), catalogos (`universos`, CRUD), nombramientos (FK), export |
| `cdmx.cat_niveles_salariales` | tabla | servidores (detail), catalogos (`niveles-salariales`, CRUD), nombramientos (FK) |
| `public.users` | tabla | `require_admin` (todos los endpoints admin) |

Vistas materializadas (esquema `cdmx`, creadas en `public` por la migración 004 y movidas a `cdmx` por la 005; sólo las usa `GET /api/v1/dashboard/stats`):

| Objeto | Consulta que la usa |
|---|---|
| `cdmx.mv_dashboard_overview` | `SQL_OVERVIEW` |
| `cdmx.mv_dashboard_sectors` | `SQL_SECTORS` |
| `cdmx.mv_dashboard_top_positions` | `SQL_TOP_POSITIONS` |
| `cdmx.mv_dashboard_salary_by_age` | `SQL_SALARY_BY_AGE` |
| `cdmx.mv_dashboard_seniority` | `SQL_SENIORITY_DISTRIBUTION`, `SQL_SALARY_BY_SENIORITY` |

No hay vistas ordinarias referenciadas.

---

## Anexo A. Definición de las vistas materializadas (`migrations/004_materialized_views.sql`, verbatim)

Nota: al crearse vivían en `public` y las tablas base también; la migración 005 ejecutó
`ALTER MATERIALIZED VIEW public.mv_dashboard_* SET SCHEMA cdmx` (y movió las tablas base a `cdmx`). Las referencias
internas de la vista siguen a las tablas por OID, así que la semántica es la de abajo sobre `cdmx.*`. Las vistas
dependen de `CURRENT_DATE` en el momento del `REFRESH` (antigüedad).

```sql
-- Migration 004: Materialized views for /dashboard/stats hot path.
--
-- Replaces 5 of the 11 SQL queries in app/routers/dashboard.py with MVs
-- backed by UNIQUE indexes (required for REFRESH MATERIALIZED VIEW CONCURRENTLY).
--
-- Refresh strategy: POST /api/v1/admin/refresh-materialized-views
-- (JWT-protected). Call after /api/v1/ingest/csv runs or on a nightly cron.
--
-- The 6 remaining SQLs in dashboard.py (SALARY_DISTRIBUTION, AGE_DISTRIBUTION,
-- CONTRACT_TYPES, PERSONAL_TYPES, BRUTO_NETO_BY_RANGE) stay inline because
-- they are cheap enough with existing indexes and don't justify materializing.

BEGIN;

-- ============================================================
-- 1. mv_dashboard_overview (single-row summary)
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mv_dashboard_overview CASCADE;
CREATE MATERIALIZED VIEW mv_dashboard_overview AS
SELECT
    1 AS key,
    COUNT(*) AS total,
    COUNT(DISTINCT n.sector_id) AS total_sectors,
    AVG(n.sueldo_bruto)::float AS avg_salary,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY n.sueldo_bruto)::float AS median_salary,
    MIN(n.sueldo_bruto)::float AS min_salary,
    MAX(n.sueldo_bruto)::float AS max_salary,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY n.sueldo_bruto)::float AS p25,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY n.sueldo_bruto)::float AS p50,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY n.sueldo_bruto)::float AS p75,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY n.sueldo_bruto)::float AS p90,
    COUNT(*) FILTER (WHERE csex.nombre = 'MASCULINO') AS hombres,
    COUNT(*) FILTER (WHERE csex.nombre = 'FEMENINO') AS mujeres,
    AVG(n.sueldo_bruto) FILTER (WHERE csex.nombre = 'MASCULINO')::float AS avg_male,
    AVG(n.sueldo_bruto) FILTER (WHERE csex.nombre = 'FEMENINO')::float AS avg_female,
    AVG(n.sueldo_neto)::float AS avg_net,
    AVG(n.sueldo_bruto - n.sueldo_neto)::float AS avg_deduction,
    CASE WHEN AVG(n.sueldo_bruto) > 0
        THEN (AVG(n.sueldo_bruto - n.sueldo_neto) / AVG(n.sueldo_bruto) * 100)::float
        ELSE 0 END AS avg_deduction_pct,
    AVG(EXTRACT(YEAR FROM AGE(CURRENT_DATE, n.fecha_ingreso)))::float AS avg_seniority
FROM nombramientos n
JOIN personas p ON n.persona_id = p.id
LEFT JOIN cat_sexos csex ON p.sexo_id = csex.id
WHERE n.sueldo_bruto IS NOT NULL;

CREATE UNIQUE INDEX idx_mv_dashboard_overview_key
    ON mv_dashboard_overview(key);

-- ============================================================
-- 2. mv_dashboard_sectors
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mv_dashboard_sectors CASCADE;
CREATE MATERIALIZED VIEW mv_dashboard_sectors AS
SELECT
    cs.id AS sector_id,
    cs.nombre AS name,
    COUNT(n.id) AS count,
    AVG(n.sueldo_bruto)::float AS avg_salary,
    COALESCE(AVG(n.sueldo_bruto) FILTER (WHERE csex.nombre = 'MASCULINO'), 0)::float AS avg_male,
    COALESCE(AVG(n.sueldo_bruto) FILTER (WHERE csex.nombre = 'FEMENINO'), 0)::float AS avg_female
FROM cat_sectores cs
JOIN nombramientos n ON n.sector_id = cs.id
JOIN personas p ON n.persona_id = p.id
LEFT JOIN cat_sexos csex ON p.sexo_id = csex.id
WHERE n.sueldo_bruto IS NOT NULL
GROUP BY cs.id, cs.nombre
ORDER BY count DESC;

CREATE UNIQUE INDEX idx_mv_dashboard_sectors_id
    ON mv_dashboard_sectors(sector_id);

-- ============================================================
-- 3. mv_dashboard_top_positions
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mv_dashboard_top_positions CASCADE;
CREATE MATERIALIZED VIEW mv_dashboard_top_positions AS
SELECT
    cp.id AS puesto_id,
    cp.nombre AS name,
    COUNT(*) AS count,
    AVG(n.sueldo_bruto)::float AS avg_salary
FROM nombramientos n
JOIN cat_puestos cp ON n.puesto_id = cp.id
WHERE n.sueldo_bruto IS NOT NULL
GROUP BY cp.id, cp.nombre
ORDER BY avg_salary DESC
LIMIT 10;

CREATE UNIQUE INDEX idx_mv_dashboard_top_positions_id
    ON mv_dashboard_top_positions(puesto_id);

-- ============================================================
-- 4. mv_dashboard_salary_by_age
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mv_dashboard_salary_by_age CASCADE;
CREATE MATERIALIZED VIEW mv_dashboard_salary_by_age AS
SELECT label, avg, ord FROM (
    SELECT '18-25' AS label, AVG(n.sueldo_bruto)::float AS avg, 1 AS ord
    FROM nombramientos n JOIN personas p ON n.persona_id = p.id
    WHERE p.edad BETWEEN 18 AND 25 AND n.sueldo_bruto IS NOT NULL
    UNION ALL
    SELECT '26-35', AVG(n.sueldo_bruto)::float, 2
    FROM nombramientos n JOIN personas p ON n.persona_id = p.id
    WHERE p.edad BETWEEN 26 AND 35 AND n.sueldo_bruto IS NOT NULL
    UNION ALL
    SELECT '36-45', AVG(n.sueldo_bruto)::float, 3
    FROM nombramientos n JOIN personas p ON n.persona_id = p.id
    WHERE p.edad BETWEEN 36 AND 45 AND n.sueldo_bruto IS NOT NULL
    UNION ALL
    SELECT '46-55', AVG(n.sueldo_bruto)::float, 4
    FROM nombramientos n JOIN personas p ON n.persona_id = p.id
    WHERE p.edad BETWEEN 46 AND 55 AND n.sueldo_bruto IS NOT NULL
    UNION ALL
    SELECT '56+', AVG(n.sueldo_bruto)::float, 5
    FROM nombramientos n JOIN personas p ON n.persona_id = p.id
    WHERE p.edad > 55 AND n.sueldo_bruto IS NOT NULL
) sub;

CREATE UNIQUE INDEX idx_mv_dashboard_salary_by_age_label
    ON mv_dashboard_salary_by_age(label);

-- ============================================================
-- 5. mv_dashboard_seniority (merges seniority distribution + salary_by_seniority)
-- ============================================================
DROP MATERIALIZED VIEW IF EXISTS mv_dashboard_seniority CASCADE;
CREATE MATERIALIZED VIEW mv_dashboard_seniority AS
SELECT label, ord, count_all, count_with_salary, avg_salary FROM (
    SELECT '0-2 años' AS label, 1 AS ord,
        (SELECT COUNT(*) FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 0 AND 2) AS count_all,
        (SELECT COUNT(*) FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL AND sueldo_bruto IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 0 AND 2) AS count_with_salary,
        (SELECT AVG(sueldo_bruto)::float FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL AND sueldo_bruto IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 0 AND 2) AS avg_salary
    UNION ALL
    SELECT '3-5 años', 2,
        (SELECT COUNT(*) FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 3 AND 5),
        (SELECT COUNT(*) FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL AND sueldo_bruto IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 3 AND 5),
        (SELECT AVG(sueldo_bruto)::float FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL AND sueldo_bruto IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 3 AND 5)
    UNION ALL
    SELECT '6-10 años', 3,
        (SELECT COUNT(*) FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 6 AND 10),
        (SELECT COUNT(*) FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL AND sueldo_bruto IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 6 AND 10),
        (SELECT AVG(sueldo_bruto)::float FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL AND sueldo_bruto IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 6 AND 10)
    UNION ALL
    SELECT '11-20 años', 4,
        (SELECT COUNT(*) FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 11 AND 20),
        (SELECT COUNT(*) FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL AND sueldo_bruto IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 11 AND 20),
        (SELECT AVG(sueldo_bruto)::float FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL AND sueldo_bruto IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 11 AND 20)
    UNION ALL
    SELECT '21-30 años', 5,
        (SELECT COUNT(*) FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 21 AND 30),
        (SELECT COUNT(*) FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL AND sueldo_bruto IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 21 AND 30),
        (SELECT AVG(sueldo_bruto)::float FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL AND sueldo_bruto IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) BETWEEN 21 AND 30)
    UNION ALL
    SELECT '30+ años', 6,
        (SELECT COUNT(*) FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) > 30),
        (SELECT COUNT(*) FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL AND sueldo_bruto IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) > 30),
        (SELECT AVG(sueldo_bruto)::float FROM nombramientos
         WHERE fecha_ingreso IS NOT NULL AND sueldo_bruto IS NOT NULL
           AND EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) > 30)
) sub;

CREATE UNIQUE INDEX idx_mv_dashboard_seniority_label
    ON mv_dashboard_seniority(label);

COMMIT;
```

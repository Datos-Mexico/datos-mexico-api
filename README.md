# datos-mexico-api

API pública del observatorio [Datos México](https://datosmexico.org): `https://api.datosmexico.org`.
Documentación interactiva en [`/docs`](https://api.datosmexico.org/docs) (Swagger), [`/redoc`](https://api.datosmexico.org/redoc) y
[`/openapi.json`](https://api.datosmexico.org/openapi.json).

## Qué sirve

| Dominio | Contenido | Prefijo |
|---|---|---|
| CONSAR | Ahorro para el retiro: cuentas, recursos, rendimientos, comisiones, por AFORE y periodo | `/api/v1/consar/*` |
| ENIGH | Ingreso y gasto de los hogares (INEGI), tabulados y microdatos agregados | `/api/v1/enigh/*` |
| CDMX | Nómina y servidores públicos del Gobierno de la Ciudad de México | `/api/v1/servidores/*`, `/api/v1/sectores/*`, … |
| ENOE | Indicadores laborales trimestrales 2005T1-2026T2 (nacional y por entidad, recalculados desde los microdatos oficiales y exactos contra el Banco de Indicadores del INEGI) y los microdatos completos 2005T1-2026T2 (111 millones de filas, paginados por cursor; desde 2025T2 con todas las filas de los CSV oficiales) | `/api/v1/enoe/*` |
| INEGI Banco de Indicadores | Los 31,817 indicadores con sus observaciones nacionales, estatales y municipales, el árbol temático del INEGI (182 temas) que da a cada indicador su ruta y búsqueda sin acentos con sinónimos | `/api/v1/inegi/*` |
| INEGI BIE | Banco de Información Económica: las 88,675 series económicas del INEGI (INPC, PIB, IGAE, comercio exterior, coyuntura, cuentas nacionales…) por área geográfica, 8.7 millones de observaciones, con su árbol temático (22,762 temas) y búsqueda con sinónimos | `/api/v1/bie/*` |
| INEGI datos abiertos | Catálogo y descarga de todos los microdatos (4,259 archivos de 103 programas, convertidos a Parquet con sus catálogos y sus originales) y de los 18,150 tabulados de 183 programas | `/api/v1/inegi/datos-abiertos/*` |
| DENUE | Las 6,138,075 unidades económicas, con búsqueda por cercanía | `/api/v1/denue/*` |
| Censo 2020 | Indicadores por localidad (ITER) y por AGEB y manzana | `/api/v1/censo2020/*` |
| ANUIES | Anuario Estadístico de Educación Superior completo: 6,066 instituciones, 26 ciclos (2000-2001 a 2025-2026), 953,653 programas-ciclo con 167 cifras cada uno, por sexo, edad, discapacidad, lengua indígena y procedencia | `/api/v1/anuies/*` |
| UNAM | Concurso de Selección a licenciatura (distribución de aciertos por carrera-plantel, encabezados oficiales, universo, cobertura, cronología; CC BY 4.0) y la UNAM en el Anuario ANUIES | `/api/v1/unam/*` |
| Cubos | La capa que consume el explorador del observatorio (datosmexico.org/observatorio): 39 cubos con medidas y dimensiones sobre ANUIES, ENOE, CONSAR, Censo 2020, registros vitales (defunciones 1990-2024 y nacimientos 1985-2024), DENUE, ENIGH, ENDUTIH, ENADID, ENDIREH, percepción de inseguridad (ENVIPE y ENSU), CDMX, UNAM y los dos bancos del INEGI (Banco de Indicadores y BIE); consulta agregada con filtros, jerarquías y descarga JSON/CSV desde una URL que reproduce cada tabla | `/api/v1/cubos/*` |
| Erratas | Registro público de erratas detectadas en las fuentes, con revisión | `/api/v1/erratas/*` |
| Catálogo | Qué bases hay, su origen, su esquema y su fecha de corte | `/api/v1/catalogo/*` |

Las bases oficiales son de solo lectura a través de la API. La única escritura pública es el reporte de erratas
(requiere cuenta); las demás escrituras son administrativas o de la tabla de demostración del curso.

## Principios

- **Fidelidad a la fuente.** Cada valor se conserva como lo publica la institución; los códigos con ceros a la
  izquierda se guardan como texto; una columna solo se promueve a número si todos sus valores lo son.
- **Verificación medible.** Cada carga se verifica por conteo de filas contra el origen; los originales del INEGI se
  conservan con su SHA-256; la paridad con la API anterior se probó ruta por ruta (`docs/paridad/`).
- **Sin motor externo.** Todo vive en Cloudflare: Workers (Hono + chanfana), D1 (SQLite) para catálogos y tablas
  consultables, R2 para archivos Parquet y originales. Los microdatos de la ENOE se leen directamente de particiones
  Parquet en R2 desde el worker.
- **Bitácora.** Cada decisión técnica, cuello de botella y verificación está en `docs/BITACORA.md`.

## Estructura

```
src/            worker (TypeScript): un módulo por dominio, cubos/ (capa declarativa del explorador), más lib/ (auth, límites, caché, errores)
scripts/        ingesta y verificación (Python: pyarrow, boto3; zsh para cargas a D1)
data/           (no versionado) exportes, manifiestos, secretos locales
docs/           BITACORA.md, PLAN.md, INEGI-UNIVERSO.md, paridad/ (comparación con el legacy), legacy/ (contratos originales)
wrangler.jsonc  bindings: bases D1, bucket R2, límites por ruta
```

## Desarrollo

```
npm install
npm run check          # tsc --noEmit
npx wrangler dev       # local; los datos viven en remoto, usar --remote para consultarlos
npx wrangler deploy
```

Secretos del worker (`SECRET_KEY`) con `wrangler secret put`; en local, `.dev.vars`. Los scripts de ingesta leen
`data/.secretos.env` (token del INEGI, token de Cloudflare, credenciales S3 de R2); ninguno de esos archivos se versiona.

## Manifiestos y reproducibilidad

Cada tabla publicada tiene una línea en un manifiesto (`data/inegi/manifiesto-*.jsonl`, `data/enoe/particiones/manifiesto.jsonl`, …)
con origen, filas, esquema, tamaño, clave en R2, hash del original, máquina y fecha. El catálogo en D1 se reconstruye
desde los manifiestos (`scripts/inegi_catalogo_d1.py`) y el almacén se concilia contra ellos (`scripts/inegi_conciliar_r2.py`):
nada referenciado puede faltar y nada sin referencia debe quedar.

## Licencia y uso

Los datos pertenecen a sus fuentes (INEGI, CONSAR, Gobierno de la Ciudad de México, ANUIES, UNAM) bajo sus términos de uso; el dataset del Concurso de Selección de la UNAM es del observatorio (CC BY 4.0). El código de
este repositorio se publica como contribución académica del observatorio; términos en `https://datosmexico.org/privacidad`.

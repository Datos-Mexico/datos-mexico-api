# BITÁCORA — api.datosmexico.org

Formato: fecha · qué se hizo · evidencia · pendiente inmediato.

## 2026-09-19 · F0 inventario
- Legacy: `~/datos-itam/api` (FastAPI, rama `feature/consar-caveat-2009-ahorro`
  con 2 scripts modificados sin commitear — NO tocar). Routers: consar 3167
  líneas, enoe 2717, comparativo 952, enigh 950, demo 493 (basura de prueba).
- Neon `remuneraciones_cdmx`: 56 GB en total. ENOE microdatos ≈ 54 GB (sdem 25,
  coe1 14, coe2 9.4, hog 3.6, viv 2). ENIGH ≈ 1.5 GB (gastoshogar 1 GB).
  CONSAR ≈ 190 MB (precio_bolsa 85 MB / 648k filas, precio_gestion 79 MB / 600k).
  CDMX ≈ 100 MB. Conteos CONSAR: afores 11, tipos_recurso 15, recursos_mensuales
  36,647 (el openapi dice 35,617: desfase a revisar), cat_siefore 28,
  afore_siefore_alias 34.
- Conexión a Neon: `.env.neon` del legacy; el URL trae `ssl=require` y un `$`
  final que rompen psql → normalizar a `sslmode=require` (script en bitácora).
- Cloudflare: cuenta 1f0e02cf… (compartida con Dafel, reparacdmx, etc.), wrangler
  4.40.3 logueado. D1 existentes ajenas: no tocar. `api.datosmexico.org` sin DNS.
- API legacy viva: /openapi.json 200; texto con wording viejo y rutas /demo.

## 2026-09-19 · F1 esqueleto EN LÍNEA
- Stack: Hono 4 + chanfana 3 (OpenAPI 3.1, Swagger en /docs, ReDoc en /redoc,
  /openapi.json) + zod 4, TypeScript estricto, wrangler 4.135. Sin dependencias
  extra. `generateOperationIds: true` es obligatorio (chanfana aborta el deploy
  si una ruta no trae operationId).
- Worker `datosmexico-api` desplegado: https://datosmexico-api.davidfernando.workers.dev
  (/health 200, /docs 200, /redoc 200, /openapi.json 200, / → 302 /docs).
  Quirk: justo tras el primer deploy, /health y /docs dieron 404 «error code
  1042» por ~30 s de propagación; después todo 200.
- D1 `datosmexico-api-consar` creada (id 7a13a6f9-…), binding `DB_CONSAR`.
- Contrato de docs: `docs/legacy/openapi-legacy.json` (106 rutas, 205 schemas,
  34 rutas CONSAR con operationId estilo FastAPI, tag `consar`).

## 2026-09-19 · F2 CONSAR — datos
- Export Neon → CSV (`data/consar/neon-export/`, 36 MB, 22 tablas, 1,413,148
  filas en total). Conteos exactos en `csv_a_sql.py` y en esta bitácora:
  precio_bolsa 648,469 · precio_gestion 600,265 · medida_sensibilidad 50,785 ·
  recursos_mensuales 36,647 · rendimiento 34,894 · cuenta_administrada 20,109 ·
  activo_neto 9,271 · rendimiento_sis 3,285 · traspaso 3,260 · comisiones 2,131 ·
  flujo_recurso 2,040 · activo_neto_agg 1,460 · cuenta_administrada_agg 385 ·
  afore_siefore_alias 34 · cat_siefore 28 · tipos_recurso 15 · pea_cotizantes 15 ·
  afores 11 · cat_metrica_cuenta 11 · cat_metrica_sensibilidad 7 · afore_alias 3 ·
  cat_cuenta_etiqueta_agg 3.
- DDL SQLite traducido del Postgres (`data/consar/schema.sqlite.sql`): 22 tablas,
  PK/UNIQUE/FK idénticas, 31 CHECK traducidos (`EXTRACT(day)` → `substr(fecha,9,2)`,
  `= ANY(ARRAY)` → `IN`). Fechas TEXT ISO, numeric → REAL, boolean → 0/1.
- Prueba local: sqlite3 carga todo, 22/22 conteos idénticos al CSV,
  `PRAGMA foreign_key_check` limpio. Archivo 153 MB.
- Carga remota a D1 en curso (`data/consar/carga-remota.log`).
- Pendiente inmediato: endpoints CONSAR (spec en `docs/legacy/consar-endpoints.md`
  cuando termine de extraerse) y comparador de paridad.
- Carga remota a D1 COMPLETA (08:57–08:58 UTC, ~1 min): 22/22 tablas con conteo
  idéntico al export (verificado con `select count(*)` por tabla en una sola
  llamada multi-sentencia). Quirk D1: un `UNION ALL` con 6 términos falla con
  «too many terms in compound SELECT» (SQLITE_ERROR 7500); usar sentencias
  separadas por `;` en el mismo `--command`. Tamaño D1: 152.7 MB.
- Fidelidad de valores (no solo conteos): `scripts/fidelidad_consar.py` compara
  por tabla sumas de columnas numéricas, min/max de fechas y distintos de textos
  entre Neon y D1; reporte en `docs/paridad/consar-fidelidad-datos.md`.
- Fidelidad Neon ≡ D1: 22/22 tablas verificadas por valores (reporte
  `docs/paridad/consar-fidelidad-datos.md`).

## 2026-09-19 · F2 CONSAR — endpoints (patrón establecido)
- Patrón: una clase `OpenAPIRoute` por endpoint en `src/consar/*.ts`, con
  `operationId` idéntico al legacy (estilo FastAPI), `tags: ["consar"]`, summary
  y description verbatim, respuesta 429 documentada igual («Rate limit
  excedido.»), zod para el esquema de respuesta con los mismos nombres de campo.
  Booleanos de D1 (0/1) se convierten a true/false con `bool()`; fechas viajan
  como TEXT ISO, igual que el JSON del legacy.
- Constantes y caveats del legacy copiados verbatim en `src/consar/constantes.ts`.
- /api/v1/consar/afores y /api/v1/consar/tipos-recurso: paridad de DATOS ✓
  (`docs/paridad/consar-datos.md`) y de DOCUMENTACIÓN ✓ (`docs/paridad/consar-docs.md`,
  2/34). Quirk: tras cada deploy, esperar ~10 s antes de medir (404 transitorio).
- Quirk: Cloudflare responde 403 a urllib con user-agent por defecto; los
  comparadores mandan `user-agent: paridad-datosmexico/1`.
- Rate limiting real (60/min en el legacy vía slowapi) NO está implementado aún
  en el nuevo; queda documentado el 429 y se registra como pendiente (opción:
  binding de rate limiting de Workers).
- Pendiente inmediato: los 32 endpoints CONSAR restantes conforme a
  `docs/legacy/consar-endpoints.md` (extracción en curso).
- Endpoints 3-15 (recursos, comisiones, flujos, traspasos, PEA) EN LÍNEA con
  paridad de datos 52/52 rutas (incluye 404/422 con el mismo `detail`) y
  documentación 15/34. Piezas clave: `redondear()` replica round() de Python
  (empates a par sobre el valor exacto del double); `parseFecha()` replica los
  mensajes de `_parse_fecha`; los errores de validación de chanfana llegan a
  Hono como HTTPException con cuerpo `{errors:[…]}` y se traducen a la lista
  422 de FastAPI (`type/loc/msg/input`).

## 2026-09-19 · F2 CONSAR — COMPLETA (34/34 endpoints)
- Los 34 endpoints de `/api/v1/consar` viven en el Worker. Paridad de DATOS:
  **132/132 rutas idénticas** contra el legacy (`docs/paridad/consar-datos.md`),
  cubriendo series completas, snapshots, ventanas, y todos los 404/422 con el
  mismo `detail`. Paridad de DOCUMENTACIÓN: **34/34** (`docs/paridad/consar-docs.md`):
  summary, description, operationId, tags, parámetros (nombre, requerido,
  descripción, tipo) y forma de la respuesta 200.
- Archivos: `src/consar/{catalogos,recursos,flujos,activo_rendimiento,medidas_cuentas,precios}.ts`
  + `constantes.ts` (todos los caveats verbatim). Utilerías: `lib/{db,errores,fechas,numeros,texto,comun,limites}.ts`.
- Rate limiting: bindings `RL_30`/`RL_60` (namespaces 5030/5060) con los cupos
  exactos del legacy por ruta y el mismo cuerpo 429. Verificado en local (60
  pasan, la 61.ª recibe 429). En producción el contador de Cloudflare es
  aproximado y por servidor dentro de cada centro de datos: ráfagas de 150
  peticiones con conexiones nuevas no lo disparan; ver prueba con keep-alive.
- Quirk: `wrangler dev` con D1 local vacía devuelve 500 en rutas de datos (no
  hay tablas locales); las pruebas de datos se hacen contra remoto.
- Rate limiting verificado en producción con conexión reutilizada (keep-alive):
  80 peticiones a una ruta de 30/min → 24 pasan y 56 reciben 429 con el cuerpo
  del legacy. Con conexiones nuevas por petición el contador se reparte entre
  servidores del centro de datos y no dispara: es la naturaleza «permisiva y
  eventualmente consistente» del binding (documentada por Cloudflare).
- HALLAZGO (no corregido, por paridad de textos): los `description` del legacy
  dicen cobertura «1998-05-01 a 2025-06-01» y «326 puntos», pero los datos
  cargados llegan a **2025-12-01 (332 puntos)**. Los textos están atrasados en
  el legacy; corregirlos en ambos lados es decisión editorial del CEO.

## 2026-09-19 · F3 DOMINIO — api.datosmexico.org EN LÍNEA
- `routes: [{ pattern: "api.datosmexico.org", custom_domain: true }]` → wrangler
  creó el DNS y el certificado. /health, /docs, /openapi.json y
  /api/v1/consar/afores responden 200 en ~0.2 s. workers.dev sigue activo.

## 2026-09-19 · F4/F5 ENIGH y CDMX — arranque
- D1 creadas: `datosmexico-api-enigh` (75a0d706-…) y `datosmexico-api-cdmx`
  (183ddd7e-…); bindings `DB_ENIGH` y `DB_CDMX` en wrangler.jsonc.
- Esquemas Postgres volcados a `docs/legacy/{enigh,cdmx}-postgres-schema.md`
  (columnas, constraints, índices, vistas, vistas materializadas, conteos).
  ENIGH: 17 tablas de datos + catálogos; gastoshogar 5,311,497 filas (la más
  grande). CDMX: personas 246,845 · nombramientos 246,836 · 8 catálogos ·
  vista `v_servidores_publicos` · 5 vistas materializadas `mv_dashboard_*`.
- Herramientas generalizadas: `scripts/ddl_pg_a_sqlite.py <schema>` (orden por
  FK, CHECK traducidos, vistas listadas como comentarios) y
  `scripts/csv_a_sql.py <schema>`.
- Export Neon → CSV de enigh y cdmx en curso (`data/export-enigh-cdmx.log`).
- Contratos de endpoints ENIGH y CDMX en extracción (`docs/legacy/{enigh,cdmx}-endpoints.md`).
- Decisión propuesta: NO migrar `/auth/*`, `/ingest/*`, `/admin/*` ni `/demo/*`
  (escritura, administración y basura de prueba). Pendiente de confirmar con el CEO.
- CDMX cargado en D1: 10/10 tablas con conteo idéntico (personas 246,845;
  nombramientos 246,836). Vistas/matviews pendientes de resolver con el contrato.
- LÍMITE DE D1 DESCUBIERTO: **máximo 100 columnas por tabla** («too many
  columns»). ENIGH tiene 4 tablas anchas: poblacion 185, hogares 148,
  concentradohogar 127, noagro 115. Solución en `ddl_pg_a_sqlite.py`: partir en
  `tabla` (PK + columnas prioritarias que usan los endpoints + resto hasta 100)
  y `tabla_2` (PK + restantes); mapa en `data/enigh/particiones.json`;
  `csv_a_sql.py` reparte las columnas. Los endpoints usan solo la parte 1, con
  los nombres originales. Otros quirks: crear 128 tablas en un solo `--file`
  falla con `{"D1_RESET_DO":true}` → aplicar en partes de 20 sentencias; un
  INSERT de 500 filas anchas excede el tamaño de sentencia (SQLITE_TOOBIG) →
  lotes de ≤500 filas y ≤400 KB. DDL ahora idempotente (IF NOT EXISTS).
- Esquema ENIGH aplicado en remoto: 132 tablas. Carga de datos en curso
  (`data/enigh/carga-remota.log`, primero las 8 tablas de los endpoints).
- ENIGH: 10 endpoints implementados (`src/enigh/endpoints.ts`) con validación
  manual que replica los 422 de Pydantic (`lib/validacion.ts`: pattern, int
  parsing, ge/le, con `ctx`). Summary de FastAPI derivado del nombre de la
  función («Enigh Metadata», etc.). Paridad pendiente de la carga.

## 2026-09-19 · F4 ENIGH y COMPARATIVO — COMPLETOS
- BUG DE CARGA DETECTADO Y CORREGIDO: el convertidor CSV→SQL escribía «09» como
  número → SQLite lo guardaba como 9 (claves de entidad, folios con ceros a la
  izquierda, ubica_geo). Ahora las columnas TEXT del DDL se citan SIEMPRE
  (`csv_a_sql.py` lee los tipos del DDL). Se vaciaron y recargaron enigh y cdmx
  (loader genérico `scripts/cargar_d1.sh <schema> [prioritarias]`: verifica
  conteo antes/después, nunca duplica, parte cada archivo en trozos de 8 MB;
  D1 se queda sin memoria con archivos grandes y con INSERT de 500 filas anchas:
  lote = min(500, 5000/columnas) y ≤ 90 KB por sentencia).
- CONSAR no estaba afectado (sus textos no son numéricos; la fidelidad por
  valores lo confirmó).
- ENIGH: paridad de DATOS 24/24 rutas (incluye 404 y 422 con `ctx` de Pydantic)
  y de DOCUMENTACIÓN 10/10. `::bigint` sobre numeric REDONDEA en Postgres →
  `CAST(ROUND(x) AS INTEGER)`.
- COMPARATIVO: 7 endpoints (`src/comparativo/endpoints.ts`), paridad de DATOS
  7/7 y de DOCUMENTACIÓN 7/7. `percentile_cont` reproducido en
  `lib/estadistica.ts` (posición (n−1)·p + interpolación lineal, igual que
  Postgres); `f"{x:,.0f}"`/`f"{x:.1f}"` en `lib/formato.ts`. Binding RL_20 para
  los cupos de 20/min. Campos `dict` libres se documentan como
  `z.record(z.string(), z.unknown())` (mismo JSON Schema que Pydantic `dict`).
- CDMX: datos cargados 10/10 tablas (recarga limpia). Contrato en
  `docs/legacy/cdmx-endpoints.md` (32 endpoints; 9 son escritura admin y NO se
  migran). Pendiente: implementar los 23 GET.

## 2026-09-19 · F5 CDMX — COMPLETO (23 GET)
- 23 endpoints GET en `src/cdmx/{comun,servidores,sectores_catalogos,dashboard_analytics,personas_nombramientos}.ts`.
  NO se migran los 9 POST/PUT/DELETE administrativos (escritura con JWT).
- Paridad de DOCUMENTACIÓN: 23/23 (servidores 3, sectores 3, catálogos 8,
  dashboard 1, analytics 3, personas 2, nombramientos 2, export 1). Quirks:
  chanfana recorta la barra final de `/servidores/` en el openapi → middleware
  en `/openapi.json` la restituye para las 4 colecciones; `Decimal` de Pydantic
  se documenta como `anyOf[number, string(pattern)]` → `z.union`.
- Paridad de DATOS: 49/55 idénticas; las 6 restantes difieren SOLO en el orden
  de filas empatadas (el legacy no fija desempate); verificado que el conjunto
  de filas es idéntico (`docs/paridad/cdmx-datos.md`, sección «Empates»). El
  nuevo aplica desempate determinista.
- Decisiones de fidelidad: `Decimal` → cadena con dos decimales (`dec2`);
  `ORDER BY … ASC NULLS LAST / DESC NULLS FIRST` (Postgres vs SQLite);
  `COUNT(*) FILTER` → `COUNT(CASE …)` (SUM daría NULL en conjuntos vacíos);
  vistas materializadas del dashboard copiadas como tablas con su contenido
  (dependen de CURRENT_DATE del REFRESH del legacy); Cache-Control por prefijo
  igual que el middleware del legacy (`lib/cache.ts`); 307 en colecciones sin
  barra final; bindings RL_5/RL_10/RL_15 para los cupos de export, dashboard y
  stats/compare.
- Divergencias deliberadas (mejoras): `puesto_search` funciona en
  `/servidores/` y `/export/csv` (en el legacy produce 500 por un JOIN
  duplicado) y `puesto_search=` vacío no rompe `/servidores/stats`.
- Pendiente: ENOE (indicadores agregados a D1; microdatos 54 GB → R2), catálogo
  público de datasets, BISE.

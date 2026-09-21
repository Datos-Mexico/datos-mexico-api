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
- Export Neon → CSV (`data/consar/neon-export/`, 36 MB, 22 tablas, 1,413,128
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
- Paridad de DATOS: 49/55 idénticas; las 6 restantes difieren SOLO por filas
  empatadas en la llave de orden (el legacy no fija desempate; Postgres devuelve
  un orden arbitrario). Verificación por conjuntos en `docs/paridad/cdmx-datos.md`
  (sección «Empates»): mismo conjunto de filas, o diferencias confinadas al
  empate de la frontera cuando un LIMIT/página corta dentro del grupo empatado.
  Para que los empates coincidan con Postgres (AVG sobre numeric exacto), los
  promedios de sueldo se calculan sobre centavos enteros
  (`SUM(ROUND(x*100))/(100*COUNT)`); con AVG sobre REAL dos promedios iguales
  salían distintos en el último bit y rompían RANK/PERCENT_RANK. El nuevo aplica
  desempate determinista.
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

## 2026-09-19 · F6 ENOE — agregados COMPLETOS (14/17)
- D1 `datosmexico-api-enoe` (db6e43ac-…): 11 tablas agregadas/catálogos con
  fidelidad 11/11 por valores. Las 5 tablas de microdatos (54 GB) quedan fuera
  de D1 por el límite de 10 GB; van a R2 en la fase siguiente, junto con los
  3 endpoints `/microdatos/{tabla}/list|count|schema`.
- 14 endpoints (`src/enoe/{constantes,endpoints}.ts`): paridad de DATOS 41/41
  rutas (incluye 404/422 con mensajes literales de los helpers del legacy) y
  de DOCUMENTACIÓN 14/17 (los 3 faltantes son los de microdatos).
- Quirks del DDL: casts a enums calificados (`::enoe.etapa_metodologica`) y
  `SUBSTRING(x FROM a FOR b)` en CHECK → el traductor ahora quita todo cast y
  traduce a `substr`. Timestamps de Postgres → isoformat de Python con `Z` y
  microsegundos solo si no son cero (`isoZ`). `cargas`: el CSV tiene un campo
  con salto de línea (wc -l cuenta 479 líneas para 478 filas); la fidelidad por
  conteo real confirma 478.
- ENIGH: fidelidad por valores completada 132/132 (las 4 tablas anchas se
  verifican por trozos de ≤ 90 columnas: D1 también limita el result set a 100
  columnas).

### Estado global al cierre de esta tanda
| Bloque | Endpoints | Paridad datos | Paridad docs |
|---|---|---|---|
| CONSAR | 34 | 132/132 rutas | 34/34 |
| ENIGH | 10 | 24/24 | 10/10 |
| COMPARATIVO | 7 | 7/7 | 7/7 |
| CDMX (GET) | 23 | 49/55 idénticas + 6 solo empates (conjuntos iguales) | 23/23 |
| ENOE (agregados) | 14 | 41/41 | 14/17 |
| **Total** | **88** | | |
No migrados por decisión: auth (3), ingest (1), admin (2), demo (7), catalogos/personas/nombramientos POST/PUT/DELETE (9). Pendientes: microdatos ENOE (3) → R2.

## 2026-09-19 · F7 CATÁLOGO PÚBLICO — primera versión EN LÍNEA
- `GET /api/v1/catalogo/datasets`: qué bases tenemos, fuente, licencia,
  periodicidad, corte más reciente leído en vivo, tablas con filas y columnas.
- `GET /api/v1/catalogo/datasets/{dataset}/esquema`: tablas, columnas (tipo,
  nulabilidad, PK) y relaciones (FK) leídas de D1 → base del visualizador.
- Metadata curada en `src/catalogo/datasets.ts`; conteos con caché de 10 min.

## 2026-09-19 · F6b MICRODATOS ENOE — R2 + puente a Neon
- Decisión (CEO, con costos): los 54 GB de microdatos se guardan en R2 como
  Parquet por tabla y trimestre (`datosmexico-datos/enoe/microdatos/<tabla>/<periodo>.parquet`,
  bucket nuevo solo del observatorio). Costo < 1 USD/mes contra ~40 USD/mes si
  se partieran en varias D1. R2 es además el respaldo permanente y la descarga
  directa para investigadores.
- Pipeline `scripts/microdatos_r2.py`: Neon → CSV comprimido (copia a STDOUT,
  sin shell: la ruta del proyecto lleva espacio) → Parquet con tipos del
  esquema Postgres (códigos con ceros a la izquierda como texto, zstd) →
  verificación de conteo por trimestre contra Neon → subida con wrangler →
  `manifiesto.jsonl` (reanudable). Corriendo en segundo plano
  (`data/enoe/microdatos/pipeline.log`), ~20 s por trimestre de viv.
- Los 3 endpoints `/microdatos/{tabla}/list|count|schema` viven en
  `src/enoe/microdatos.ts` y consultan Neon vía Hyperdrive
  (`datosmexico-neon`, gratis) con el driver `postgres` — PUENTE TEMPORAL.
  Cuando se apague Neon, el origen cambia a R2 SQL (por probar) o a D1 por
  trimestres cargadas desde los mismos Parquet; el contrato no cambia.
- Primera consulta tras inactividad tarda ~6 s (Neon suspende el cómputo);
  después responde en menos de un segundo.
- Paridad microdatos: DATOS 21/21 rutas (ignorando `tiempo_query_ms`, que es
  una medición y no un dato: el nuevo responde en ~160 ms contra ~1,200 ms del
  legacy) y DOCUMENTACIÓN ENOE completa 17/17. Con esto los **91 endpoints
  públicos del legacy están migrados**.
- Pendiente para apagar Neon: habilitar R2 Data Catalog (Iceberg) en el bucket,
  registrar los Parquet como tablas con pyiceberg y probar R2 SQL (COUNT,
  LIMIT/OFFSET, filtros por periodo/ent) contra los mismos casos de paridad.
- BISE (F8): el token del INEGI es personal y no está en ningún archivo
  local (el sitio lo lee de la variable de entorno INEGI_TOKEN). Se solicitó
  al CEO.

## 2026-09-19 — Tokens obtenidos; arranca F8 (Banco de Indicadores del INEGI)
- Token del INEGI: estaba en el correo de registro (registro.api@inegi.org.mx,
  2026-07-25). Guardado en `data/.secretos.env` (ignorado por git) como
  `INEGI_TOKEN`; verificado contra la API.
- Token de Cloudflare `datosmexico-r2-catalog` (Workers R2 Data Catalog: Edit +
  Workers R2 Storage: Edit, todas las cuentas, sin caducidad) creado en el panel
  y guardado como `CF_CATALOG_TOKEN` en el mismo archivo. Verificado con
  `/user/tokens/verify` (activo) y contra el catálogo Iceberg del bucket
  (`/v1/config` responde 200 con el prefijo del almacén).
- Catálogos del BISE descargados a `data/bise/catalogos/`: CL_INDICATOR
  31,817 indicadores, CL_UNIT 223, CL_FREQ 13, CL_TOPIC 272, CL_SOURCE 258,
  CL_NOTE 1,157, CL_UNIT_MULT 6. CL_GEO, CL_PERIOD y CL_OBS_STATUS no existen
  en el servicio (responden HTML); las claves geográficas se toman del marco
  (00 nacional + 01-32) y los estatus de observación se documentan a partir de
  los valores que aparezcan en los datos.
- Límites medidos de la API del INEGI (INDICATOR/.../BISE/2.0):
  - La URL no puede pasar de ~294 caracteres; si se pasa responde una página
    HTML "Página no encontrada" con estado 200 (no un error). Con 33
    geografías caben 4 indicadores de 10 dígitos por petición.
  - Si algún indicador del lote no tiene observación alguna en las geografías
    pedidas: 400 "No se encontraron resultados" cuando ninguno tiene y 401 "No
    autorizado" cuando solo algunos tienen (el 401 no es de autorización).
  - 6 peticiones en paralelo tardan lo mismo que una (~0.8 s).
  - Muestra aleatoria de 40 indicadores × 33 geografías: todos con datos;
    93 observaciones por indicador en promedio (mediana 66, máximo 627);
    estimación del universo nacional + estatal: ~3 millones de observaciones,
    que caben holgadamente en una D1.
- Diseño F8: base `datosmexico-api-bise`. Tablas: catálogos (unidades,
  frecuencias, temas, fuentes, notas, multiplicadores), `indicadores`
  (metadatos del catálogo + los de la serie: frecuencia, tema, unidad,
  multiplicador, nota, fuentes, última actualización del INEGI, estatus,
  conteo de observaciones y primer/último periodo) y `observaciones`
  (indicador, geografía, periodo, valor numérico y valor original como texto,
  excepción, estatus, fuente, nota). Cobertura de esta fase: nacional y 32
  entidades. Los municipios quedan como fase posterior (el mismo mecanismo,
  otro universo de geografías).
- `scripts/bise_descarga.py`: descarga reanudable, 6 hilos, lotes por longitud
  de URL, respuestas crudas comprimidas en `data/bise/crudo/` (respaldo fiel
  de lo que respondió el INEGI) y `data/bise/manifiesto.jsonl` con el estado
  por indicador (`ok` / `sin_datos`). Lanzada en segundo plano; bitácora de
  avance en `data/bise/descarga.log`.
- Prueba del camino para apagar Neon (R2 Data Catalog + R2 SQL), hecha con el
  token nuevo (al que hubo que añadir el permiso "Workers R2 SQL: Read"):
  - pyiceberg 0.12 se conecta al catálogo con solo el token (sin llaves S3:
    el catálogo presta credenciales). Espacio `enoe` creado; el trimestre
    viv 2005T2 (120,251 filas, 25 columnas) se registró como tabla Iceberg
    `enoe.viv_prueba` con `append` en 14 s y se leyó completo en 2.3 s.
    Iceberg escribe sus propios archivos bajo `__r2_data_catalog/`: no reusa
    los Parquet ya subidos (registrar todo duplicaría los ~54 GB; a ~0.015
    USD/GB-mes son ~0.8 USD/mes más; aceptable si se decide ese camino).
  - R2 SQL (POST a api.sql.cloudflarestorage.com): COUNT(*) 11 s en frío y
    1.3 s en caliente; filtro + GROUP BY 1.3 s; **OFFSET no está soportado**
    ("unsupported feature: OFFSET clause is not supported"). Los endpoints
    `/microdatos/{tabla}/list` paginan con offset, así que R2 SQL no cubre el
    contrato tal cual. Opciones: (a) D1 por trimestre cargadas desde los
    Parquet (contrato idéntico, ~54 GB repartidos en varias D1: ~40 USD/mes),
    (b) paginación por llave (`con` > último) sobre R2 SQL, cambiando el
    contrato de `list` en el nuevo (documentado) y dejando Neon solo mientras
    viva el legacy. Decisión pendiente del CEO; la tabla de prueba se
    conserva hasta entonces.
- Descarga BISE terminada en 18 min (6 hilos): 31,039 indicadores con datos,
  778 sin observaciones nacionales ni estatales (el INEGI responde 400 "No se
  encontraron resultados" también pidiéndolos solos; ejemplos: 716967 "Personal
  ocupado total - 488320 Servicios de carga y descarga…", 6204482224 "INC.
  Series originales. Coeficiente de Gini"), 0 errores de red. 44 MB de
  respuestas crudas comprimidas en `data/bise/crudo/`.
- Hallazgo de calidad en la fuente: el INEGI repite observaciones dentro de
  la misma respuesta (misma clave indicador+geografía+periodo dos veces):
  36,462 repeticiones en 300 indicadores; 35,924 idénticas y 538 iguales en
  valor pero distintas en OBS_STATUS (3 vs 1). La carga falló por la llave
  primaria y se resolvió conservando la primera aparición y escribiendo cada
  repetición descartada en `data/bise/duplicados.csv` (auditable). Total
  final: **2,690,682 observaciones** (118,428 con valor nulo y excepción NA,
  -, ND o NS, conservadas con su excepción). Formatos de periodo: `AAAA`
  (1.19 M) y `AAAA/NN` (1.54 M; NN = mes o trimestre según la frecuencia).
- `cargar_d1.sh`: el conteo esperado se calcula ahora por registros CSV y no
  por líneas (las descripciones del INEGI traen saltos de línea; el conteo
  por líneas daba 224/1160/31819 contra 223/1157/31817 reales).

## 2026-09-19 · F8 fase 1 EN LÍNEA — Banco de Indicadores del INEGI
- D1 `datosmexico-api-bise` cargada y verificada: 31,817 indicadores (31,039
  con datos), 2,690,682 observaciones, 7 catálogos; suma de
  `n_observaciones` = filas de `observaciones`; conteos remotos = CSV.
- Cinco endpoints nuevos (tag `inegi`), desplegados y verificados en
  producción contra los archivos de origen (resumen exacto; 5 series
  completas idénticas observación por observación; 404/422 con la forma
  FastAPI del resto de la API; Cache-Control público 1 h; cupo 30/min en la
  serie y 60/min en el resto):
  - `GET /api/v1/inegi/resumen` — cuántos indicadores tenemos y hasta cuándo.
  - `GET /api/v1/inegi/indicadores` — búsqueda (q en descripción y tema;
    filtros tema/frecuencia/unidad/con_datos; paginación).
  - `GET /api/v1/inegi/indicadores/{id}` — ficha con catálogos resueltos,
    fuentes y geografías disponibles.
  - `GET /api/v1/inegi/indicadores/{id}/observaciones` — serie con valor
    numérico y decimal original, filtros geografía/desde/hasta, paginación.
  - `GET /api/v1/inegi/catalogos/{catalogo}` — unidades, frecuencias, temas,
    fuentes, notas, multiplicadores, geografías.
- Entrada `inegi` en `/api/v1/catalogo/datasets` (corte = último periodo con
  observaciones). Nota: el corte dice 2050 porque un indicador del tema
  Población es una proyección; el resumen distingue `ultimo_periodo` de
  `ultima_actualizacion_inegi` (2026-09-18, es decir, la base está al día).
- Limitación de la fuente registrada: los nombres del catálogo son cortos
  («Total», «Mujeres»: 15,519 descripciones distintas para 31,817 ids), así
  que la búsqueda incluye la descripción del tema y la ficha resuelve tema,
  unidad, frecuencia y fuentes.
- Enunciado que ya se puede sostener públicamente: «tenemos los 31,817
  indicadores del Banco de Indicadores del INEGI a nivel nacional y estatal,
  con la última actualización publicada por el INEGI (2026-09-18)».
  Pendientes de F8: municipios (fase 2) y refresco periódico (fase 3).

### Estado global al cierre de esta tanda
| Bloque | Endpoints | Paridad datos | Paridad docs |
|---|---|---|---|
| CONSAR | 34 | 132/132 rutas | 34/34 |
| ENIGH | 10 | 24/24 | 10/10 |
| COMPARATIVO | 7 | 7/7 | 7/7 |
| CDMX (GET) | 23 | 49/55 idénticas + 6 solo empates (conjuntos iguales) | 23/23 |
| ENOE (agregados + microdatos) | 17 | 41/41 + 21/21 | 17/17 |
| Catálogo público | 2 | nuevo | propia |
| INEGI Banco de Indicadores | 5 | nuevo (verificado contra origen) | propia |
| **Total** | **98** | | |
- F8 fase 2 (municipios), sondeo de viabilidad: la API acepta claves
  municipales de 5 dígitos (una o varias por petición; las claves de 10
  dígitos no existen). En una muestra aleatoria de 60 indicadores, 3 tienen
  datos para Azcapotzalco (≈5 %, unos 1,600 indicadores del catálogo).
  Lanzado `scripts/bise_sondeo_municipal.py`: una petición por indicador con
  20 cabeceras de 20 entidades para saber exactamente cuáles tienen datos
  municipales (`data/bise/sondeo_municipal.jsonl`, reanudable). Con ese
  universo se estimará el costo de la fase 2 (≈2,469 municipios × ~1,600
  indicadores; a 24 claves por petición son ~165 mil peticiones, ~2 h con 6
  hilos; ~20 millones de observaciones, dentro del límite de una D1). La
  descarga municipal completa no arranca sin el visto bueno del CEO.
- Resultado del sondeo municipal (31,817 peticiones, 32 min, 0 errores):
  **594 indicadores tienen datos municipales** (1.9 % del catálogo), todos
  con datos también a nivel nacional/estatal; ninguno de los 778 «sin datos»
  es municipal (quedan como series sin cobertura en los tres niveles que
  consulta la API). Temas: Población 130, Economía y sectores productivos 49,
  Vivienda 48, Lengua indígena 47, Delitos registrados 45, Discapacidad 32,
  Educación 26, Empleo 19… En 20 cabeceras respondieron en promedio 19.8
  municipios y 3.5 observaciones por municipio. Estimación de la fase 2:
  594 × 2,469 municipios × 3.5 ≈ **5.2 millones de observaciones** y unas
  67 mil peticiones (~45 min con 6 hilos): cabe en la misma D1 (≈400 MB) y
  dentro de las escrituras incluidas en el plan. Dado el costo despreciable y
  que es el mismo mecanismo, la fase 2 arranca ahora: mismas tablas
  (`observaciones` con clave geográfica de 5 dígitos, `geografias` con nivel
  «municipio»), respuestas crudas aparte en `data/bise/crudo_municipal/`.
- Pipeline de microdatos: `viv` (79) y `hog` (79) completos en R2. La
  exportación de `sdem` desde Neon tardó 685 s en el primer trimestre (a ese
  ritmo, sdem + coe1 + coe2 ≈ 2 días en serie), así que se detuvo la instancia
  única y se relanzaron tres en paralelo, una por tabla (`pipeline-sdem.log`,
  `pipeline-coe1.log`, `pipeline-coe2.log`); comparten el manifiesto (una
  línea por trimestre, escrita en modo append) y cada una omite lo ya hecho.
- Causa de la lentitud del pipeline: cada trimestre se exportaba con
  `where periodo=…` y Neon no tiene índice por periodo (y el legacy no se
  toca), así que cada trimestre recorría la tabla entera (sdem ≈ 40 M filas:
  11-21 min por trimestre × 80). Nuevo `scripts/microdatos_r2_tabla.py`: una
  sola lectura completa de la tabla que reparte las filas en un CSV por
  trimestre y luego publica cada uno exactamente como antes (mismos Parquet,
  claves R2 y manifiesto; marca `lectura_unica`). Corriendo para sdem, coe1
  y coe2 en paralelo (`pipeline-<tabla>.log`).
- Diagnóstico del pipeline (14:30 UTC): las tres copias completas se
  congelaron a los ~20 min (Neon en `ClientWrite`, psql en `poll`, Python en
  `read`: el pooler deja de reenviar). Mediciones: el cómputo de Neon entrega
  ~1 MB/s de CSV en total, con 1, 2 o 4 flujos (cuello = CPU del cómputo
  formateando filas anchas), por lo que el paralelismo no ayuda. Nueva
  versión de `microdatos_r2_tabla.py`: host directo (sin pooler), un solo
  flujo, copias de 10 trimestres por consulta (8 recorridos por tabla en vez
  de 80) y vigilante que reinicia la copia si pasan 180 s sin datos. Corre en
  serie coe2 → coe1 → sdem (`pipeline-grupos.log`); estimación ~6 h en total.
  Opción para acelerar, a decisión del CEO: subir temporalmente el cómputo de
  Neon (cuesta; es infraestructura del legacy).

## 2026-09-19 · F8 fase 2 EN LÍNEA — municipios en el Banco de Indicadores
- Descarga municipal: 67,122 peticiones (594 indicadores × 113 lotes de 22
  municipios), 95 min, 0 errores; 1,500 lotes sin datos (400 del INEGI).
  4,780,070 observaciones crudas → 4,765,583 tras descartar 14,487
  repeticiones más del propio INEGI (todas auditadas en `duplicados.csv`,
  ahora 50,949 en total).
- Catálogo de municipios: los 2,478 del Marco Geoestadístico 2025, tomados
  de las capas municipales que ya usan los mapas del sitio (misma fuente y
  edición; claves de 5 dígitos y nombres NOMGEO literales).
- D1 `datosmexico-api-bise` tras la fase 2: `observaciones` 7,456,265 filas
  (2,690,682 nacionales/estatales + 4,765,583 municipales; conteo remoto =
  CSV), `geografias` 2,511 (1 + 32 + 2,478), `indicadores` recargada con
  conteos y periodos de los tres niveles (suma de `n_observaciones` = filas).
- Endpoints desplegados con tres niveles: `geografia` acepta 2 o 5 dígitos,
  la ficha lista las geografías con su nivel, el resumen y el catálogo
  describen la cobertura municipal. Verificación en producción contra los
  archivos de origen: resumen exacto (31,817 / 31,039 / 7,456,265), 8 series
  completas idénticas observación por observación (3 de ellas con municipios,
  hasta 4,948 observaciones), 404/422 correctos, catálogo de geografías 2,511.
- Enunciado público que ya se sostiene: «tenemos los 31,817 indicadores del
  Banco de Indicadores del INEGI: nacional, 32 entidades y, en los 594 que el
  INEGI publica por municipio, los 2,478 municipios; última actualización del
  INEGI 2026-09-18». Pendiente de F8: fase 3, refresco periódico.
- Pipeline (17:15 UTC): coe2 y coe1 completos en R2 (80 trimestres cada
  una); sdem en curso. Patrón de los congelamientos de Neon: ocurren casi
  siempre al FINAL de la copia (ya llegaron todas las filas del grupo y no
  llega el cierre), lo que obligaba a repetir 25 min de copia. Ajuste: si
  el vigilante corta la copia y el conteo coincide con lo esperado para el
  grupo, se acepta (la publicación vuelve a verificar trimestre por
  trimestre). Se relanza sdem con el ajuste al terminar el grupo en curso.

## 2026-09-19 · Microdatos ENOE: pipeline terminado y CORRECCIÓN de destino
- Las cinco tablas quedaron procesadas: viv 79, hog 80, sdem 80, coe1 80,
  coe2 80 trimestres (399 Parquet, 2.4 GB con zstd frente a ~54 GB en
  Postgres). Verificación contra Neon (conteo por trimestre, tabla por
  tabla) en `data/enoe/microdatos/verificacion.log`.
- Hallazgo grave y corregido a tiempo: `wrangler r2 object put` SIN
  `--remote` escribe en el almacén local de wrangler
  (`.wrangler/state/v3/r2`) e imprime el mismo "Upload complete"; por eso
  el listado del bucket en Cloudflare no mostraba ningún Parquet (solo la
  tabla Iceberg de prueba, que sí se escribió por la API). Los 399 archivos
  siguen en `data/enoe/microdatos/<tabla>/`. Corrección: `--remote` en los
  dos scripts del pipeline y `scripts/microdatos_subir_remoto.py`, que sube
  todo con `--remote`, compara tamaños con el manifiesto y verifica al final
  con la API de Cloudflare que cada clave existe en el bucket con el tamaño
  correcto (`subida-remota.log`).
- Regla nueva para el observatorio: toda orden de wrangler que toque datos
  (d1 execute, r2 object) lleva `--remote` explícito y se verifica por un
  canal distinto (API o conteo remoto), nunca solo por el mensaje de éxito.
- Verificación final contra Neon (trimestre por trimestre, sin faltantes ni
  sobrantes ni conteos distintos): viv 9,843,149 · hog 10,037,505 · sdem
  31,498,811 · coe1 25,066,601 · coe2 25,066,601 = **101,512,667 filas**, las
  mismas que el legacy publica como «101.5 millones».
- Subida remota terminada (16 min): 399/399 claves presentes en el bucket
  con el tamaño del manifiesto, 2.55 GB. Almacén local de wrangler borrado.
  **Los microdatos de la ENOE (101,512,667 filas) están publicados en R2**
  como Parquet por tabla y trimestre, verificados contra Neon; los
  endpoints `/microdatos/*` siguen sirviendo desde Neon vía Hyperdrive
  hasta la decisión del CEO sobre el origen definitivo.

## 2026-09-19 (noche) · Hacia «todo el INEGI»: universo medible y DENUE
- Instrucción del CEO: seguir hasta poder decir «TODOS» los datos del INEGI.
  Para que sea verificable, el universo se define por producto de datos
  abiertos del INEGI y se registra el estado de cada uno (ver
  `docs/INEGI-UNIVERSO.md`).
- BIE (Banco de Información Económica): la API responde «No se encontraron
  resultados» (código 100) para su catálogo y para indicadores conocidos
  (INPC 539260, PIB 496150, 736183) y la página del BIE devuelve 500. Los
  temas económicos (INPC, INPP, PIB trimestral, IGAE, empleo) están en el
  Banco de Indicadores ya cargado (851 indicadores con «precios» en la
  descripción). Se registra como cubierto por el Banco de Indicadores.
- DENUE: la API de consulta del DENUE exige un token propio distinto al del
  Banco de Indicadores («No autorizado. Utilice una clave válida»); la
  descarga masiva por entidad no lo necesita: 32 archivos
  `denue_NN_csv.zip` (no existe el 00 nacional), edición 05/2026, 42
  columnas en latin-1, diccionario de datos y metadatos incluidos.
  Aguascalientes: 71,871 unidades. Descarga de los 32 en curso
  (`data/denue/masiva/descarga.log`).
- D1 `datosmexico-api-denue` (binding DB_DENUE): `unidades_economicas` con
  los 42 campos (tres renombrados a minúsculas: tipo_cencom, nom_cencom,
  tipo_unieco), índices por entidad-municipio, actividad y código postal;
  `actividades` (SCIAN 2018 derivado con conteos), `diccionario` (el del
  INEGI) y `edicion`. `scripts/denue_a_csv.py` valida columnas por estado,
  ids únicos y coordenadas numéricas.
- Cinco endpoints nuevos (tag `denue`): resumen, búsqueda paginada
  (nombre/razón social, entidad, municipio, código postal, actividad SCIAN
  por código o prefijo, estrato), ficha por id, cercanía a una coordenada
  (caja de búsqueda en SQL + haversine, radio ≤ 5 km) y catálogo de
  actividades. Cupo 30/min en búsqueda y cercanía.
- Restricción del CEO (22:10 UTC): el costo total debe quedarse en los 5 USD
  del plan de Workers. Consecuencias: (a) para los microdatos NO se reparten
  en varias D1 (≈40 USD/mes); el origen definitivo será R2 (Parquet ya
  publicados, dentro del nivel gratuito de R2) con R2 SQL para consultas y
  paginación por llave en la API nueva, más descarga directa de cada
  trimestre; el legacy conserva su contrato con offset mientras viva.
  (b) D1 incluye 5 GB en el plan: hoy consar 153 MB + enigh 1.13 GB + cdmx
  63 MB + enoe 11 MB + bise 789 MB = 2.15 GB; el DENUE se estima en ~2.9 GB
  (472 B/fila con índices, 6,138,075 filas) → ~5.05 GB, en el límite (el
  excedente costaría centavos; si el CEO exige estrictamente 5 GB se quita
  un índice o se mueve algo a R2). Las bases siguientes grandes (Censo 2020
  por AGEB/manzana, microdatos de encuestas) irán a R2 como Parquet.
- DENUE convertido: 6,138,075 unidades económicas en 33 archivos (el Estado
  de México viene partido en denue_15_1 y denue_15_2; el archivo denue_15
  «normal» es una página 404 de 2,263 bytes que hubo que descartar), 989
  actividades SCIAN, 42 entradas de diccionario. Carga remota en curso
  (`data/denue/carga-remota.log`).

## 2026-09-20 · Censo de Población y Vivienda 2020 (ITER) y AGEB/manzana
- ITER 2020 (4a edición, datos abiertos): 195,662 filas × 286 columnas
  (189,432 localidades; 2,469 totales municipales; 32 estatales + nacional;
  3,662 resúmenes de localidades de una y dos viviendas). Valores especiales
  del INEGI: 22,398,055 celdas '*' (confidencialidad) y 41,192 'N/D'.
  Decisión de fidelidad: columnas NUMERIC en D1 → los números quedan como
  números (se recortan los espacios a la izquierda del CSV) y '*'/'N/D' se
  conservan como texto; nada se pierde y las sumas funcionan con SQL.
- Tres tablas (`iter`, `iter_2`, `iter_3`, llave entidad+mun+loc) por el
  límite de 100 columnas, `iter_diccionario` (los 286 indicadores del INEGI)
  y `edicion`. D1 `datosmexico-api-censo2020` (binding DB_CENSO2020).
  `scripts/iter_a_csv.py` genera CSV, DDL y particiones y valida llaves
  únicas. Carga remota en curso (`data/censo2020/carga-remota.log`).
- Cinco endpoints (tag `censo2020`): resumen (con la prueba de que la
  población nacional, la suma estatal y la municipal coinciden), búsqueda de
  localidades/municipios/entidades por nombre, clave y nivel, ficha con los
  286 indicadores, diccionario e «indicador para todas las geografías de un
  nivel» (la consulta para mapas).
- AGEB y manzana urbana 2020: 32 archivos `ageb_mza_urbana_NN_cpv2020_csv.zip`
  (descarga en curso); por tamaño van a R2 como Parquet por entidad, no a D1.
- ITER 2020 cargado y cuadrado: iter/iter_2/iter_3 195,662 filas cada una,
  diccionario 286 (llave = columna: el INEGI numera dos veces las nueve
  columnas de identificación), edición 5; D1 de 152 MB.
- AGEB/manzana: el INEGI usa tres valores especiales ('*', 'N/D' y también
  'N/A') y publica decimales en algunas columnas (promedios, relaciones,
  grado de escolaridad): el Parquet tipa cada columna según lo que trae
  (Int64 o Float64) y conserva los especiales por fila en
  `celdas_especiales` (JSON columna→valor), reconstruible al 100 %.
- AGEB/manzana 2020 publicado en R2: 32/32 Parquet verificados por la API
  de Cloudflare, 1,683,504 filas (manzanas y sus totales), 372 MB, claves
  `censo2020/ageb_manzana/ageb_mza_NN.parquet`, manifiesto con conteos de
  celdas '*', 'N/D' y 'N/A' por entidad. Dos sorpresas de la fuente: el
  estado 14 viene en latin-1 (los demás en UTF-8) y trae un segundo CSV de
  «bitácora de cambios» dentro de conjunto_de_datos.
- Directrices nuevas del CEO (2026-09-20): (1) el Swagger nuevo debe ser al
  menos tan completo como el viejo, incluidos los métodos de escritura
  «por lo menos una vez» donde aporten valor; (2) excedente de D1 aceptable
  mientras sea centavos (otros 5 USD solo con valor demostrable); (3) el
  repositorio de la API se publica en la organización Datos-Mexico solo
  cuando de verdad tengamos «todo el INEGI», sin firmas de IA; (4) auditar
  qué falta del INEGI y cargar en paralelo cuando acelere sin perder rigor.
  Auditoría del openapi: legacy 114 operaciones (96 GET, 9 POST, 5 PUT, 4
  DELETE; seguridad OAuth2 password → JWT; sin descripciones de tags), nuevo
  99 GET. Faltan en el nuevo: auth (token, me), CRUD de catálogos, personas
  y nombramientos (9), admin refresh de vistas, ingest CSV, y el demo del
  curso de Bases de Datos del ITAM (4 GET + 5 escrituras). Extracto de sus
  contratos en `docs/legacy/escritura-auth-demo-endpoints.md`.

## 2026-09-20 · DENUE y Censo 2020 (ITER) EN LÍNEA
- DENUE: la carga se cortó a la mitad por «fetch failed» (red); nuevo
  `scripts/reanudar_carga_d1.py` (reparte igual que cargar_d1.sh, salta los
  trozos aplicados, reintenta y acepta UNIQUE en el trozo del corte porque
  cada trozo es un lote atómico). Final: 6,138,075 = CSV; D1 de 3.2 GB.
- Censo 2020: dos defectos corregidos antes de publicar: (a) el nivel
  «resumen de localidades de una y dos viviendas» (LOC 9998/9999) existe en
  los tres niveles, así que la suma estatal daba 126,411,503; ahora nacional
  = suma estatal = suma municipal = 126,014,024; (b) `SELECT nivel, *` sobre
  la tabla de 100 columnas rompía el límite de 100 columnas por resultado de
  D1 (el nivel se calcula en el worker). Búsqueda de localidades une iter_3
  para hogares y viviendas.
- Verificación en producción (`verificar_denue_censo.py`): 0 fallos en 31
  comprobaciones (DENUE: resumen, 5 fichas, totales por estado, CP y
  prefijo SCIAN, cercanía; Censo: resumen, 5 fichas de 286 campos, niveles,
  indicador por entidad con suma 126,014,024, 404/422; openapi 109 rutas;
  catálogo). Total **108 endpoints** (98 + DENUE 5 + Censo 5).

## 2026-09-20 · Swagger completo: autenticación, erratas, demo y operación
- Directriz del CEO precisada: modificar tablas oficiales por API no es
  académicamente correcto. Decisión de diseño (escrita en la portada del
  Swagger): las bases oficiales son de solo lectura; los métodos de
  escritura existen solo donde son correctos. Los 9 CRUD del legacy sobre
  personas, nombramientos y catálogos de la CDMX y la carga de CSV por API
  NO se exponen (documentado como decisión); las cargas son scripts
  versionados y verificados.
- Nuevo: **Erratas** (`/api/v1/erratas`): registro público de posibles
  errores en datos oficiales (base del catálogo, tabla, registro, campo,
  valor observado, valor propuesto, fuente, comentario), con autoría
  (usuario del JWT y fecha), revisión por administrador (aceptada /
  rechazada, nota, revisor, fecha) y `edicion_aplicada` para ligar la
  corrección a la edición en que se cargó. GET públicos; POST con login;
  PUT/DELETE admin. El dato publicado nunca cambia por esta vía.
- Autenticación con el contrato del legacy: `POST /auth/token` (OAuth2
  password flow, form-urlencoded, JWT HS256 de 30 min firmado con el
  secreto `SECRET_KEY` del worker), `GET /auth/me`, `POST /auth/register`
  (403 siempre). Contraseñas verificadas con bcrypt contra los hashes
  migrados. D1 `datosmexico-api-plataforma` (binding DB_PLATAFORMA):
  `users` (migrados `admin` y `DemoAbril`; los otros 21 usuarios del legacy
  eran residuos de pruebas automatizadas: testadmin_*, login_*, wrongpw_*,
  me_*), `demo_curso_bd` (12 filas) y `erratas`. Cuentas nuevas
  `observatorio` (admin) y `colaborador`, contraseñas en
  `data/.secretos.env`; alta/rotación con `scripts/plataforma_usuario.py`
  (sustituye al create_admin.py del legacy).
- Demo del curso de Bases de Datos (ITAM): los 9 endpoints del legacy
  (lista, detalle, resumen, toggle del bono con login, alta/edición/baja y
  reinicio con admin), mismos cupos (60/120/30/20 por minuto; binding nuevo
  RL_120), fechas con el formato de Pydantic y montos con dos decimales.
- Operación: `POST /admin/refresh-materialized-views` recalcula las cinco
  tablas del tablero desde las oficiales con las definiciones de la
  migración 004 del legacy (percentiles, filtros por sexo, años cumplidos de
  antigüedad). Prueba local contra la copia del padrón: las 17,417 cifras de
  `/dashboard/stats` coinciden salvo la antigüedad (depende de la fecha de
  hoy; el legacy tiene su instantánea de meses atrás) y un empate en el
  décimo puesto mejor pagado (el legacy no fija desempate; el nuevo ordena
  por conteo y nombre). En producción NO se ejecutó: se conserva la
  instantánea del legacy para la paridad hasta que el CEO decida.
- Portada del Swagger: 21 grupos con descripción y fuente, principio de solo
  lectura, términos de uso, contacto, licencia, enlace al modelo
  institucional; esquema de seguridad OAuth2 (candado en 10 operaciones).
  Total **126 operaciones: 115 GET, 6 POST, 3 PUT, 2 DELETE** (el legacy:
  114 con 18 escrituras sobre tablas oficiales).
- Pruebas: 41 comprobaciones de escritura en local (0 fallos) y las mismas
  41 en producción con las cuentas nuevas (0 fallos): tokens, 401 con
  `WWW-Authenticate`, 403 de admin, 422 en cuerpos incompletos, ciclo
  completo de una errata (reportar → revisar → listar → borrar), ciclo del
  demo (toggle, alta, duplicado 409, edición, baja, reinicio); el refresco
  en producción solo se probó en control de acceso (401/403).
- Hallazgo local: `wrangler dev` no toma los secretos del entorno del
  proceso, solo de `.dev.vars` (ignorado por git); y un hash bcrypt dentro de
  comillas dobles en zsh se corrompe (`$2b$12$` se expande): los hashes se
  escriben desde Python a un archivo SQL.

## 2026-09-20 · Auditoría real del universo INEGI
- El CEO pidió estimar cuánto falta para «todo el INEGI». Fuentes: el árbol
  oficial de datos abiertos (`arbol.json`, 214 programas / 427
  programa-edición) y la API interna de «Descarga masiva»
  (`/app/api/descarga/descarga/descargamasiva/lista/*`, POST con JSON de
  cadenas; `obtenerlistado` → programas, `obtenercarpetas` → carpetas,
  `obtenerarchivos` → archivos con formatos y tamaños; exige cabeceras de
  navegador). Recorrido completo en `scripts/inegi_inventario_masivo.py` →
  `data/inegi-universo/archivos.csv` (25,742 registros archivo×formato,
  18,959 archivos lógicos).
- Universo: microdatos 139 programas / 4,781 archivos / 49.2 GB en todos los
  formatos (CSV: 756 archivos, 6.3 GB, 66 programas; 73 programas solo en
  DBF/DTA/SAV); tabulados 183 programas / 14,178 archivos / 13.6 GB (casi
  todo Excel); DENUE 486 archivos; Indicadores 392; INV 3. Cubierto hoy:
  Banco de Indicadores completo, DENUE completo, ENOE completa, ENIGH 2024,
  Censo 2020 ITER + AGEB/manzana. Resultado y plan en
  `docs/INEGI-UNIVERSO.md`.
- Hallazgo: los «microdatos» de los Censos Económicos en descarga masiva son
  ejemplos con valores alterados (los reales son confidenciales); lo público
  son los resultados definitivos en datos abiertos (CSV nacional por
  sector/estrato, 107 variables) y 2,044 tabulados Excel.

## 2026-09-20 · «Todo el INEGI»: ingesta distribuida en marcha
- Instrucción del CEO: máximo esfuerzo, todo hoy si se puede, en paralelo
  desde varias máquinas, todo al sistema nuevo y con el mismo rigor.
- Ingestor genérico `scripts/inegi_ingesta.py` (microdatos): universo de
  4,259 archivos de datos (17.4 GB) tomado del inventario; por archivo:
  descarga con SHA-256, el zip original se sube íntegro a R2
  (`inegi/fuentes/…`), cada tabla se convierte a Parquet zstd con tipado
  riguroso (todo se lee como texto y una columna solo pasa a entero o
  decimal si todos sus valores lo son sin ceros a la izquierda; los códigos
  se conservan como texto), se verifica filas Parquet = filas leídas y se
  sube por la API REST de R2 (sin wrangler; se comprueba el tamaño
  devuelto). Manifiesto por máquina con programa, edición, tabla, filas,
  columnas, esquema (nombre y tipo), bytes, clave R2, fuente, URL, SHA-256,
  máquina y fecha. Formatos: CSV preferido; DBF con parser tolerante (los
  campos numéricos con texto 'N', 'NA', '3 1' se conservan como texto); Stata
  y SPSS vía pyreadstat.
- `scripts/inegi_tabulados_r2.py`: archiva íntegros los 14,178 tabulados
  (Excel/HTML/PDF) en `inegi/tabulados/…` con SHA-256 y manifiesto.
- Reparto: esta Mac corre los shards 0/3 y 1/3 de microdatos (6 hilos cada
  uno) y 0/2 de tabulados (4 hilos); la HP ENVY (frame-os, NixOS, usuario
  `frame`, avisada la sesión The Frame) corre 2/3 de microdatos y 1/2 de
  tabulados con `nice 19` e `ionice -c 3` y 2 hilos cada uno (límite
  acordado: carga sostenida ≤ 3, ≥ 40 GB libres). En la HP el venv necesita
  `LD_LIBRARY_PATH` con la libstdc++ de nix (`entorno.sh`). El Mac mini
  sigue sin acceso por llave (pendiente del CEO).
- Prueba ENBIARE 2021/2025: 8 tablas, 411,499 filas, 24-30 s por archivo.
- Cuellos de botella encontrados y resueltos en la ingesta masiva (madrugada
  del 20): (1) la API de Cloudflare (la que usa wrangler y `r2 object put`)
  limita ~1,200 peticiones por 5 minutos: con miles de tablas chicas daba 7
  archivos/min → subida por la API S3 de R2 (las credenciales S3 de un token
  de R2 son su id y el SHA-256 del token; sin tope) → 250+ archivos/min.
  (2) La lectura DBF/Stata/SPSS en Python puro era lenta y devoraba memoria →
  conversión en flujo a CSV temporal y lectura vectorizada con pyarrow
  (300 mil filas en 3 s). (3) El INEGI limita la velocidad por dirección IP
  bajo carga (una descarga se quedó en 0 B/40 s; también corta descargas a
  medias) → endpoint `POST /api/v1/admin/espejo` (admin): el worker descarga
  desde la red de Cloudflare y guarda el original en R2; el ingestor toma la
  fuente de R2 (14 MB/s) y solo cae al INEGI si no está. Impulsor
  `scripts/inegi_espejo.py` con 24 hilos: 4,900 archivos en 15 min.
  Correcciones de datos: nombres con espacios y caracteres de control en el
  inventario (se codifican en la URL y se limpian en la clave), archivos
  distintos con el mismo nombre en el mismo programa y edición (la clave lleva
  el id del INEGI; 88 casos), descargas truncadas (se verifica la longitud).
- Catálogo consultable de lo ingerido: tablas `da_programas`, `da_microdatos`
  (con esquema por tabla) y `da_tabulados` en la D1 del INEGI, endpoints
  `/api/v1/inegi/datos-abiertos/{resumen,programas,programas/{slug},tabulados,
  descarga/*}`; la descarga entrega Parquet, zip original o tabulado desde R2.

## 2026-09-20 · TODO LO DESCARGABLE DEL INEGI EN LÍNEA
- Cierre verificado a las 08:03 UTC: microdatos 4,259/4,259 archivos de los
  103 programas con datos (20,569 tablas Parquet, 762,522,995 filas, 11.9
  GB; originales conservados con SHA-256, 18.7 GB); tabulados 18,150/18,150
  de 183 programas (14.5 GB íntegros). Catálogo en D1 (`da_programas`,
  `da_microdatos`, `da_tabulados`) = manifiestos; verificación en producción
  con 0 fallos (`verificar_datos_abiertos.py`: resumen, 8 tablas al azar
  R2 = API = filas, descarga de tabulado, 404/422).
- Últimos obstáculos resueltos: paquetes con zips anidados (ENOE 2005-2014
  series originales y ajustadas, ENSU, ENSI, MTI, ENUT 2002, ENVIN…) →
  extracción hasta dos niveles; zips con nombres de codificación
  inconsistente o Deflate64 (Censo 2010 por estado) → extracción miembro a
  miembro con `unzip` de respaldo; 18 originales truncados por el INEGI en el
  espejo → el worker ahora verifica la longitud y borra copias incompletas,
  el ingestor valida el zip y cae al INEGI; esquemas de tablas con miles de
  columnas → gzip+base64 en D1 (límite de 100 KB por sentencia) y
  descompresión en el worker; dos tabulados del CE 2023 con el mismo nombre
  para ids distintos → clave con id.
- Los catálogos que acompañan a los microdatos (tablas cat_*) ahora se
  ingieren; los paquetes procesados antes de ese cambio (primeras ~3,000
  unidades) no los tienen: pendiente una pasada complementaria desde las
  fuentes en R2 (rápida) para completarlos.
- Costo tras la ingesta: D1 5.5 GB (≈0.38 USD/mes de excedente) y R2 48 GB
  (≈0.57 USD/mes sobre los 10 GB incluidos); total ≈ 1 USD/mes sobre el
  plan, dentro del margen acordado (centavos, con aviso).
- Tiempo real de la ingesta masiva: de las 23:30 a las 01:56 (2.5 h) con
  esta Mac como carga principal, la HP como apoyo de baja prioridad y el
  worker como espejo de descargas.

## 2026-09-20 · Decisiones del CEO tras el cierre del INEGI
- Aprobado: pasada complementaria de catálogos; ENOE con paginación por
  cursor para dejar de depender de Neon (Neon y el legacy siguen encendidos al
  menos un mes, hasta después del Datatón; no se apaga nada todavía); publicar
  el repositorio como público en la organización tras la pasada de catálogos,
  la ENOE y una revisión final; borrar los dos objetos de prueba. El acceso al
  Mac mini queda descartado (no hizo falta).

## 2026-09-20 · Pruebas borradas
- R2: `inegi/fuentes/pruebas/natalidad_2016_dbf.zip` (37.9 MB) eliminado.
- R2 Data Catalog: tabla Iceberg `enoe.viv_prueba` purgada (pyiceberg
  `purge_table`), espacio `enoe` borrado y los 5 archivos residuales bajo
  `__r2_data_catalog/` eliminados por S3. El catálogo queda vacío; la API no lo
  usa.

## 2026-09-20 · ENOE microdatos servidos desde R2 (sin Neon ni Hyperdrive)
- Diseño: `scripts/enoe_particiones_r2.py` lee cada Parquet por trimestre ya
  verificado, comprueba el conteo y que la llave primaria sea única, ordena por
  la PK y escribe una partición por entidad
  (`enoe/particiones/<tabla>/<periodo>/<ent>.parquet`, zstd, grupos de 2,000
  filas, estadísticas). 399 trimestres → 12,768 particiones, 101,512,667 filas
  (= origen), 0 errores, 6 min. Índice y esquema en D1 `datosmexico-api-enoe`
  (`microdatos_particiones`, `microdatos_columnas`; carga y verificación remota
  con `scripts/enoe_particiones_d1.py`).
- Worker: `src/enoe/microdatos.ts` reescrito. Lee la partición completa de R2
  (≤ 3 MB) y la decodifica con hyparquet + hyparquet-compressors (zstd) en el
  propio worker: primero solo las columnas de la llave (y sex/eda si hay
  filtro), localiza el cursor por búsqueda binaria y lee únicamente los grupos
  de filas necesarios para la página. Paginación por cursor
  (`pagination.next_cursor`, llave de la última fila, base64url); `page` se
  rechaza con 422 explicando el cambio; cursor de otra tabla o entidad → 422.
  `total` exacto: del índice sin filtros de fila; con sex/eda se leen solo esas
  dos columnas de las particiones del trimestre.
- Orden: dentro del trimestre, entidad primero y luego el resto de la PK
  (ent, cd_a, con, v_sel[, n_hog[, n_ren]]). Con `entidad_clave` coincide con el
  legacy; sin él, el legacy ordenaba cd_a antes que ent. Documentado en el
  Swagger y en el schema (`almacenamiento.orden`).
- Fidelidad: `ing_x_hrs` (numeric(17,5) en Postgres, double en Parquet) se
  devuelve como texto con 5 decimales, igual que el legacy; `extras_jsonb` se
  devuelve como objeto; `periodo` recortado.
- Verificación contra el legacy (verificador propio, con cupo de 10/min):
  conteos iguales en 8 casos (viv/hog/sdem/coe1/coe2, con y sin entidad, con
  sex/eda, 2020T2 vacío); primera y segunda página idénticas fila a fila;
  recorrido completo por cursor de viv 2005T2 ent 09 (3,306 filas en 14
  páginas) idéntico y sin repeticiones al conjunto completo del legacy; 5,000
  filas sin filtro de entidad = legacy ent 01 completo + inicio de ent 02
  (cruce de frontera); 422 esperados; schema con total_filas y columnas
  iguales en las 5 tablas. FALLOS: 0 en la versión de prueba y en producción.
- Retirados del worker: binding Hyperdrive y dependencia `postgres`. La
  configuración de Hyperdrive en Cloudflare y Neon siguen existiendo para el
  legacy; la API nueva ya no depende de nada fuera de Cloudflare.
- Costo: +2.6 GB en R2 (≈ 4 centavos/mes). Latencia típica de `list` con
  entidad: 150-400 ms; sin entidad y con filtros: hasta ~2 s (lee 32
  particiones).

## 2026-09-20 · Pasada complementaria de catálogos (`scripts/inegi_complemento.py`)
- Revisó los 4,259 paquetes contra la regla vigente leyendo los originales del
  espejo en R2 (sin tocar al INEGI): lista miembros (zips anidados incluidos) y
  procesa solo los que faltan en los manifiestos, con la misma lectura, tipado
  y nomenclatura del ingestor. Resultado: 22,597 tablas nuevas en 2,376
  paquetes (catálogos de códigos: entidades, municipios, sí/no, preguntas…).
- Hallazgo: el INEGI publica en el CNGSPSPE 2017 (medio ambiente) 13 archivos
  con extensión .dbf que no son DBF (cabecera nula); quedan documentados en el
  manifiesto con estado `ilegible`, cabecera y tamaño, y el original íntegro en
  R2. Ninguna otra falla.

## 2026-09-20 · Conciliación del almacén (`scripts/inegi_conciliar_r2.py`) y catálogo final
- Regla: nada referenciado por la versión vigente de los manifiestos (la misma
  selección que el catálogo) puede faltar en R2, y nada sin referencia debe
  quedar. Primera pasada: 0 faltantes; 1,893 claves con espacios (ediciones
  como «2015 Nov», anteriores al saneado del ingestor: MOPRADEF, MOLEC, BIARE,
  MEITEF, ENA, ITAEE…) que la ruta de descarga no aceptaba; 1,687 huérfanos
  (copias del mismo objeto bajo el esquema de claves anterior, versiones
  superadas por la corrección de colisiones con sufijo -id, y 2 tabulados del
  CE). Las fuentes huérfanas solo se borran si la misma fuente (nombre sin
  sufijo y tamaño) está referenciada: las 9 dudosas resultaron duplicados
  exactos de su copia con sufijo -id.
- Hallazgo: un tabulado (CSIT 2008-2026, `Esquema_BD_Mwtwf.xlsx`) tenía dos
  versiones de tamaño distinto; el INEGI declara 53,041,220 bytes (copia del
  espejo), la copia directa de la Mac (44,924,928) fue una descarga truncada
  sin Content-Length. Marcada `truncado` en el manifiesto y borrada.
- Aplicación: 1,892 claves normalizadas por copia en servidor con verificación
  de tamaño, manifiestos reescritos (claves y ediciones), 57 borrados directos
  y el resto absorbido por las claves normalizadas. Segunda pasada: 66,594
  objetos = 66,594 referenciados, 0 faltantes, 0 huérfanos, 0 claves raras,
  0 tamaños distintos al manifiesto.
- Catálogo reconstruido: da_programas 202, da_tabulados 18,150, da_microdatos
  44,185 (767,179,090 filas). Verificación en producción: cobertura 100 %,
  8 tablas al azar iguales byte a byte y en filas, envipe 91 tablas,
  tabulados CE 2,044, descargas y 404/422 correctos. FALLOS: 0. Una descarga
  con clave normalizada (MOPRADEF 2015_Nov) responde 200 con su tamaño.
- Almacén R2 final: 79,793 objetos, 50.76 GB (fuentes 18.68, tabulados 14.24,
  microdatos 11.99, ENOE particiones 2.93 + trimestres 2.55, censo2020 0.37).
  Costo ≈ 0.61 USD/mes sobre los 10 GB incluidos.

## 2026-09-20 · Repositorio publicado
- Revisión final: 126 archivos versionados (src, scripts, docs, README,
  configuración); ningún secreto ni `.dev.vars` ni `data/` en el historial;
  sin firmas de IA en commits, código ni documentación; un solo autor; rutas
  personales retiradas de scripts y documentos del legacy; `pg_dump.err`
  eliminado.
- Publicado como público en la organización:
  https://github.com/Datos-Mexico/datos-mexico-api (rama `main`, remoto
  `origin`). Conforme a la política de nombres `datos-mexico-{tipo}`.

## 2026-09-20 — TODA la UNAM: Anuario ANUIES completo + Concurso de Selección en la API (F12)

**Encargo del CEO.** Así como ya se puede decir «tenemos TODO el INEGI», ahora toca TODA la UNAM (después
IPN, ITAM, etc.). Compartió siete gráficos exportados del perfil de la UNAM en DataMéxico (Secretaría de
Economía; datos ANUIES hasta 2022 y 2019) como referencia visual —comparativa por área, treemaps por
plantel y por carrera, mapa de procedencia, situación académica por sexo— y la fuente: ANUIES, Anuario
Estadístico de Educación Superior. Pidió gráficos interactivos en /unam con una barra de secciones (proceso de
selección + secciones nuevas). El rediseño visual del explorador queda para después.

**Fuente y método.** anuies.mx solo enlaza a anuario.anuies.mx, una consulta interactiva (PHP) que arma el
Excel en el navegador desde un servicio POST (`action=consulta`, paginado, `pageSize` que el servidor adapta a
1,000 cuando la consulta lleva todas las desagregaciones). Ese mismo sitio ofrece la exportación completa, así
que la descarga por páginas es un uso previsto; se pace a 1 s entre páginas, dos trabajadores. Ciclos
2000-2001 a 2025-2026 (26). Por ciclo se piden las 6 variables (matrícula, nuevo ingreso, egresados, lugares
ofertados, titulados, solicitudes) con las 4 desagregaciones (sexo, edad en 16 grupos, discapacidad, lengua
indígena) más la procedencia del nuevo ingreso (32 entidades + 8 regiones) y las 14 dimensiones (entidad,
municipio, sostenimiento, ANUIES, clasificación, institución, escuela/campus, nivel, modalidad, 4 campos de
formación, carrera): 167 cifras por fila, todas las instituciones. `scripts/anuies_consulta.py`, reanudable,
con dims/cols verificados página a página y **conciliación por ciclo**: el mismo servicio sin dimensiones
devuelve el agregado nacional, y la suma de las filas detalladas debe coincidir en las 6 variables (COINCIDE
en todos los ciclos cerrados hasta ahora). La serie histórica de la UNAM (`action=historico`, historico.php,
`scripts/anuies_historico.py`) se bajó aparte en 5 páginas: 13,253 filas en 26 ciclos; en los ciclos ya
cerrados coincide fila por fila y en matrícula con la descarga íntegra (411/459/444 filas, 153,525/154,660/
156,122 de matrícula en 2000-2003). DataMéxico (apidatamexico, cubos `anuies_enrollment`/`anuies_status`)
solo llega a 2022: queda como cruce, no como fuente.

**Términos.** anuario.anuies.mx dice «© ANUIES 2025 — Todos los derechos reservados» y no publica licencia
abierta; se cita la fuente en cada endpoint y en el catálogo. Decisión de uso a confirmar por el CEO.

**Almacén y base.** D1 `datosmexico-api-anuies` (7a70874c…): `programas` (48 columnas: 14 dimensiones,
ciclo, clave de institución y las 31 cifras base), `programas_edad` (96) y `programas_procedencia` (40) por el
límite de 100 columnas de D1, solo con fila cuando el ciclo trae algún valor; `ciclos` (filas, conciliación,
SHA-256 del jsonl, Parquet), `columnas` (título y grupo de ANUIES), `instituciones` (clave estable = nombre
sin acentos con guiones; ficha del último ciclo). `scripts/anuies_d1.py`: INSERTs multifila ≤ 40 KB en
trozos ≤ 2 MB (con 90 KB / 7.5 MB el import de D1 falló con `D1_RESET_DO`), verificación remota por ciclo
(count, sumas de las 6 variables, filas de edad y procedencia). Parquet por ciclo (182 columnas, zstd) en R2
`anuies/anuario/<ciclo>.parquet` (`scripts/anuies_parquet_r2.py`, manifiesto en data/anuies).

**Concurso de Selección.** El dataset de datos-mexico-unam/data/processed (CC BY 4.0; 17 CSV + diccionario +
licencia) se cargó tal cual en D1 `datosmexico-api-unam` (5d10dfb0…) con `scripts/unam_concurso_d1.py`
(tipado por columna, códigos/folios/huellas forzados a TEXT), conteos verificados tabla por tabla
(encabezados 1,236; distribucion 79,698; universo 2,403; …) y los 19 archivos en R2 `unam/concurso/` con
SHA-256 en la tabla `archivos`.

**Endpoints.** `/api/v1/anuies/*`: resumen, ciclos, columnas, valores, instituciones (búsqueda), instituciones/{clave},
serie, agregado (por cualquier dimensión, con filtros exactos), procedencia, edades, programas (paginación por
llave `after`), programas/{id}, descarga. `/api/v1/unam/*`: resumen, concurso/encabezados, concurso/distribucion/
{anio}/{concurso}/{codigo}, concurso/universo, concurso/tablas/{tabla}, concurso/archivos, descarga, y las
vistas del anuario con la UNAM fija: anuario/serie, planteles, carreras, campos, niveles, agregado,
procedencia, edades. Caché 1 h; cupos 30/min en agregados. Probado en versión de vista previa
(0aa2fb0c) con los ciclos cargados; dos 500 durante la prueba fueron del import de D1 en curso (la base no
sirve consultas mientras importa), no del código.

**Sitio (F13, rama `unam-anuario`).** `app/(marketing)/unam/layout.tsx` monta la barra de secciones
(`components/unam/NavUnam.tsx`): Proceso de selección (lo existente), Matrícula, Egreso y titulación,
Planteles, Carreras y posgrados, Procedencia, Datos. Datos como assets: `scripts/build-unam-anuario.ts`
trae de la API `lib/unam/anuario/datos.json` (serie por ciclo y por nivel + último ciclo) y
`public/unam/v1/anuario-ciclos.json` (todos los ciclos; el navegador lo trae solo si alguien cambia de ciclo,
`?ciclo=` en la URL). Gráficos con recharts (ya en el sitio): serie apilada por sexo con selector de nivel,
barras agrupadas por campo (porcentaje/personas, por sexo), treemaps de planteles y carreras con ficha al
clic, coropleta de procedencia sobre la geometría MG 2025 del hero (escala logarítmica, como la referencia),
situación académica por sexo, pirámide de edades, tablas ordenables. Los nombres de ANUIES (mayúsculas
sostenidas) se muestran con mayúscula inicial y el original va en `title`. Producción solo con el go del CEO.

**Cierre F12 (2026-09-20, 14:23 descarga · 14:50 producción).** 26/26 ciclos, 965 páginas, 953,653 filas, 3.3 GB de
JSON crudo con SHA-256; conciliación COINCIDE en los 26 (tabla completa en `docs/ANUIES-UNIVERSO.md`). Rendimiento
medido: 8,067 filas/min con dos descargas y 10,333 con cuatro (el servidor de ANUIES es el límite; tiempo medio por
página 29.6 s). Una descarga (2015-2016) quedó sin trabajador al rebalancear y se reanudó desde su estado en la página
40: el registro muestra las 40 páginas en secuencia sin solapamiento. D1: 26 ciclos verificados (count y sumas de las 6
variables, filas de edad y procedencia), 6,066 instituciones, 167 columnas; 26 Parquet (182 columnas) en R2 anotados en
`ciclos`. Verificador (`verificar_anuies.py`, scratchpad): ciclos vs manifiestos y SHA-256, serie de la UNAM vs la
descarga independiente `historico` (26/26 en filas, matrícula y egresados), DataMéxico 2018-2022 exacto, agregados que
suman la serie, procedencia y edades que no exceden el total, paginación por llave sin repetidos, búsqueda, 404/422,
concurso vs CSV, identidad doble del histograma y descargas con `Content-Length` correcto: FALLOS 0 en preview
(e0144cd8) y en producción (versión e5a91b4f). Cifra pública: la UNAM tiene 264,847 estudiantes en 2025-2026 según el
anuario ANUIES; la matrícula nacional es 5,760,478. Costo: +3.3 GB de JSON local (no en R2), Parquet 26 archivos ≈ 60 MB
en R2, D1 anuies ≈ 0.9 GB.

**Cierre F13 (2026-09-20, 21:29 UTC).** Decisiones del CEO: sí al uso citando la fuente y sí a los nombres con
mayúscula inicial; en el sitio la fuente no es protagonista: una nota al pie en chico por sección («derechos
reservados por la ANUIES; las citas de cada gráfico, el método y su verificación están en el repositorio») que enlaza
al apéndice de `docs/ANUIES-UNIVERSO.md`, donde va la cita completa de cada gráfico con su endpoint y sus columnas. Go
explícito para producción: PR #164 de datos-mexico-site fusionado por rebase (punta `59046d0`), Workers Builds en
verde (2 min) y verificación en vivo de las seis rutas de /unam (200, cifras y nota al pie presentes; el asset de los
26 ciclos responde). Sin firmas de IA en commits ni en el PR.

**Ajustes pedidos por el CEO tras ver producción (2026-09-20, 22:05 UTC).** (1) El mapa de procedencia marcaba el
estado con el anillo azul de foco del navegador: ahora dibuja su contorno con la tinta del sitio encima de todos, el
idioma de la coropleta de la Home. (2) «La animación épica» de su grabación de DataMéxico: dos treemaps enlazados; al
hacer clic en un plantel, el treemap de carreras se reacomoda con animación a las carreras de ese plantel, y al revés.
Treemap propio (squarify + tween de 750 ms con requestAnimationFrame, color estable por nombre, sin dependencias);
los 858 programas del último ciclo viajan inline y los de los 26 ciclos en el asset (4.3 MB, solo si cambia el ciclo).
Prefijo «Universidad Nacional Autónoma de México - » retirado de los rótulos (original en `title`). PR #165 fusionado
por rebase con go explícito (punta `0a5fbc8`), Workers Builds en verde, verificado en vivo con un clic real en FES
Iztacala. Sin firmas de IA (autor único en los tres commits).

**Enlace en ambos sentidos (2026-09-20, 22:21 UTC).** El CEO pidió que el treemap de abajo también controle al de
arriba y que ambos quepan en una pantalla: una sola selección viva (elegir en uno suelta la del otro), altura 460 → 300
px, ficha lateral compacta. PR #166 fusionado por rebase con go explícito (punta `f858187`), Workers Builds en verde,
verificado en vivo (clic en Licenciatura en Psicología → FES Iztacala 55 %, CU 29.2 %, FES Zaragoza 15.8 %). Sin firmas.

## 2026-09-20 — Capa de cubos para el explorador nuevo (F14)

**Encargo.** El CEO abrió el rediseño del explorador del observatorio (`datosmexico.org/observatorio`), réplica del
explorador de DataMéxico (11 capturas de su tour guiado, guardadas en el sitio como `docs/internal/observatorio-rediseno/
referencia/`), 100 % sobre esta API; el legacy `datos-itam.org` sigue vivo con un botón pequeño. Plan completo y análisis
captura por captura en el sitio (`docs/internal/observatorio-rediseno/MISION.md`).

**Por qué una capa nueva.** La API es por dominio (156 rutas con formas distintas); el explorador necesita una forma
uniforme —medidas, dimensiones, filtros, orden— y, sobre todo, que la pestaña «API» muestre **una URL que reproduce
exactamente la tabla** que el usuario ve (como el LogicLayer de DataMéxico). De ahí `src/cubos/`:
- `tipos.ts`: un cubo = binding D1 + cláusula FROM (con joins a catálogos) + condición base + medidas (expresión SQL
  agregada, unidad, si es sumable) + dimensiones (expresión de id, de nombre, tipo categórica/temporal/geográfica, clave
  INEGI, padre en la jerarquía, o **virtual**: sus miembros son columnas de una tabla ancha).
- `motor.ts`: lee la consulta (`medidas`, `columnas`, `f.<dim>=a|b`, `padres`, `orden`, `sentido`, `limite`), arma
  `SELECT … GROUP BY … ORDER BY … LIMIT n+1` con todos los valores ligados (nada del usuario se interpola: las claves se
  validan contra la definición), despliega dimensiones virtuales y produce JSON o CSV.
- `definiciones/`: 18 cubos en 6 temas (ANUIES 4, ENOE 4, CONSAR 7, Censo 2020 1, CDMX 1, UNAM 1). Invariantes de las
  definiciones se comprueban al arrancar el worker.
- `endpoints.ts`: `GET /api/v1/cubos`, `/{cubo}`, `/{cubo}/miembros`, `/{cubo}/datos`. Caché 1 h; 30/min en datos y miembros.

**Decisiones de método (lo que sumaba mal y cómo quedó).**
- ENOE: las 32 entidades suman exactamente el nacional (2025T1: 58,921,494 ocupados), así que los cubos por entidad
  llevan `nivel = 'entidad'` y el nacional vive en su propio cubo; nunca se suman nacional y entidades en una misma tabla.
  Las tasas van marcadas `sumable: false`.
- Censo 2020: el universo son las localidades; las filas de totales (loc 0000, mun 000) y los agregados 9998/9999
  (repiten población ya contenida en las localidades) quedan fuera; así entidad y país reproducen al INEGI
  (Aguascalientes 1,425,607; país 126,014,024).
- CONSAR: los saldos no se suman entre meses (nota en cada cubo); comisiones y rendimientos se promedian; el
  predeterminado de recursos filtra `sar_total` porque los tipos de recurso se anidan.
- ANUIES: entidad con clave INEGI por correspondencia estática (`entidad_cve`) para el mapa del explorador.

**Lo que D1 no aguantó y la salida.** La primera versión desplegaba las dimensiones virtuales (edad: 16 miembros × 6
medidas; procedencia: 40) con `UNION ALL`, y D1 falló con `too many terms in compound SELECT` y `too many SQL variables`.
Quedó una sola consulta ancha (una columna por miembro × medida) que el worker despliega y ordena. Medido en D1
remoto: ANUIES sin filtro por carrera × ciclo 11.1 s (peor caso; 953k filas → ~200k grupos), por escuela 2.3 s, entidad × ciclo
0.7 s; Censo por localidad 0.7 s; CDMX por puesto 0.3 s; edades 2025-2026 por entidad 0.2 s. Los predeterminados de
ANUIES filtran los últimos cinco ciclos. DENUE no entra aún: entidad × actividad excede el CPU de D1 (`7429`); irá con
tabla preagregada.

**Verificación (`scripts/verificar_cubos.py`, contra wrangler dev --remote).** Catálogo 18/18 con ficha, miembros y
consulta predeterminada; formatos jsonrecords/jsonarrays/csv (BOM, adjunto); claves INEGI de 32 entidades; cruces:
ANUIES 2025-2026 suma de entidades 5,760,478 = ciclo; UNAM 264,847 = /unam/anuario/serie; edades UNAM 264,847 =
/unam/anuario/edades; procedencia 63,446 = /unam/anuario/procedencia; ENOE 32 entidades = nacional; 12 sectores suman
ocupados; Censo entidad y país; CONSAR SAR total 2025-12-01 10,996,258.9 = /consar/recursos/totales; CDMX 246,836
nombramientos; UNAM concurso 2026 licenciatura escolarizado 141,218 presentaron, 178 carreras-plantel; 8 errores
404/422; límite y `limitado`. **FALLOS 0.**

**Producción (2026-09-20).** Commit `7f996b3`, `wrangler deploy` versión `3cdd6f5b`; `scripts/verificar_cubos.py
https://api.datosmexico.org` → **FALLOS 0** (los 18 cubos y todos los cruces); el verificador previo de ANUIES/UNAM
sigue en FALLOS 0. Publicado en github.com/Datos-Mexico/datos-mexico-api. Sin firmas de IA.

**CORS (2026-09-20, tarde).** La pestaña API del explorador muestra los encabezados reales de la respuesta y el navegador
solo dejaba ver `cache-control` y `content-type`: faltaba `Access-Control-Expose-Headers`. Ahora `exposeHeaders: ["*"]`
(peticiones sin credenciales). Desplegado; verificador de cubos en FALLOS 0.

## 2026-09-21 — Fase D del explorador: 24 cubos en 9 temas

**Nuevo.** ENIGH 2024 (`enigh-hogares`: hogares expandidos, ingreso y gasto promedio ponderados por el factor y sus
componentes, por entidad, decil, tamaño de localidad, estrato, clase de hogar y sexo de la jefatura), Banco de Indicadores
del INEGI (`inegi-indicadores`), Censo 2020 completo (`censo2020-caracteristicas` sobre iter_2 y `censo2020-hogares-vivienda`
sobre iter_3, 185 medidas con los títulos del diccionario del INEGI), precios de bolsa de las SIEFOREs (`consar-precios`) y
DENUE (`denue-unidades`) con jerarquía SCIAN sector › subsector › rama › clase y estrato de personal.

**Dos mecanismos nuevos en el motor.** (1) `filtro_obligatorio`: la tabla de observaciones del BISE tiene 7.4 millones
de filas y agruparla entera no es viable; toda consulta exige `f.indicador` (422 con la explicación si falta).
(2) `miembros` con origen propio: los 31,039 indicadores salen del catálogo `indicadores` (134 ms con búsqueda) en lugar de
agrupar la tabla de hechos; las geografías, del catálogo `geografias`.

**DENUE preagregado.** Agrupar las 6,138,075 unidades por entidad × actividad excedía el CPU de D1 (código 7429);
`scripts/denue_resumen_d1.py` hace 32 `INSERT … SELECT` por entidad dentro de D1 (1-6 s cada uno) hacia `denue_resumen`
(603,668 grupos) y comprueba SUM(n) = COUNT(*) = 6,138,075. Los 20 sectores llevan el título oficial del SCIAN 2018;
subsector y rama no tienen nombre en el DENUE (queda dicho en la ficha).

**Censo: qué cuadra y qué no.** En `iter` la población total de cada localidad se publica siempre, y las filas 9998/9999
la repiten: quedan fuera y las sumas reproducen al INEGI exacto (126,014,024). En `iter_2`/`iter_3` el INEGI suprime (*) las
localidades de una y dos viviendas y publica sus cifras agregadas en 9998/9999: esas filas SÍ entran (Aguascalientes: PEA
706,930, HLI 2,539, hogares 386,445 = fila total). Aun así, en 29 entidades la suma queda por debajo de la fila total en
fracciones de punto (hogares en el país: 35,213,375 contra 35,219,141, 0.016 %): cifras suprimidas por confidencialidad en
otras localidades pequeñas que no se publican en ningún renglón. Queda en las notas del cubo y el verificador lo tolera
hasta 0.05 %.

**Verificación.** ENIGH reproduce `/enigh/hogares/by-decil` y `by-entidad` al centavo (decil 1: 16,795.15; Nuevo León
117,033.88; 38,830,230 hogares); BISE población total 2020 país 126,014,024 y CDMX 9,209,944; DENUE 6,138,075 en 20
sectores con nombre; precios 2025-12-31 SB 60-64 en 10 AFOREs. `scripts/verificar_cubos.py` → **FALLOS 0** en local y en
producción.

## 2026-09-21 — Auditoría INEGI del observatorio: los tres errores de rigor, la ruta temática y la ENOE al día

Origen: auditoría adversarial de /observatorio frente al INEGI (informe al CEO, 2026-09-20). Se cubre en orden todo lo
encontrado salvo el refresco automático (pospuesto por decisión del CEO).

**1. Triple conteo en el Banco de Indicadores (corregido).** Sin filtro de nivel, `inegi-indicadores` sumaba país +
entidades + municipios (población 2020: 376,273,161 en vez de 126,014,024). Mecanismo nuevo en el motor:
`Dimension.particion` (`{ implicita_en: [...] }`): toda consulta debe filtrar esa dimensión o llevarla en columnas (o
agrupar por una dimensión que la implica, como geografía); si no, 422 con la explicación. Aplicado a `nivel` del cubo BISE.
Verificado: agrupar por nivel da nacional = suma de entidades = 126,014,024.

**2. Error 500 al pedir los periodos sin indicador (corregido).** La lista de miembros de `periodo` recorría 7.4 millones
de filas. Catálogo nuevo `periodos` en D1 (474 periodos, 7,456,265 observaciones = total exacto; `data/bise/sql/periodos.sql`
derivado de los CSV) y `nivel` desde `(SELECT DISTINCT nivel FROM geografias)`. Además el motor rechaza con 422 (en vez
de intentar el barrido) los miembros de una dimensión sin catálogo cuando falta el filtro obligatorio del cubo.

**3. Cortes del catálogo (corregido).** INEGI decía «2050» (proyecciones de población): ahora es la fecha de la última
actualización publicada por el INEGI entre todos los indicadores (2026-09-18); ENIGH pasa de nulo a «2024» (año de
levantamiento); DENUE de «20/05/2026» a «2026-05-20». Verificador: formatos legibles obligatorios.

**4. Nombres de indicadores con su ruta temática (nuevo).** 17,682 de los 31,039 indicadores con datos comparten el
nombre corto con otro («Total», «Mujeres», «Total nacional»…). El sitio del INEGI los organiza en un árbol de temas que su
API de desarrolladores no publica; lo sirve la API interna del propio sitio (interna_v1_3, métodos `NodosTemas` y
`EstructuraIndicador`, identificados con las peticiones de red del navegador el 2026-09-20; token de cliente público del
sitio, guardado en `data/.secretos.env` como INEGI_TOKEN_WEB, no versionado). `scripts/bise_arbol.py` recorre el árbol
(182 temas en 5 niveles, 25,412 relaciones directas + 5,633 rutas pedidas indicador por indicador; 0 errores, 0 sin ruta;
6 indicadores cuelgan de dos temas) y `scripts/bise_arbol_d1.py` carga `arbol_temas`, `indicador_temas` y las columnas
`indicadores.ruta / tema_arbol / orden_arbol`. En la API: `ruta`, `tema_arbol`, `orden_arbol` en la búsqueda y la ficha
(`ruta_temas` completa), `q` busca también en la ruta, filtro `tema_arbol`, endpoint nuevo `/api/v1/inegi/arbol`, y el
cubo nombra cada indicador «nombre — ruta · n.º posición (unidad)». Límite honesto: el INEGI mismo muestra 2,672 series
del PIB por actividad económica como «Total nacional (Pesos a precios 2013), Estados Unidos Mexicanos, 2021» repetido (lo
comprobé en su sitio); con ruta y unidad siguen coincidiendo 16,625 nombres, y solo la posición los distingue. Queda dicho en
la ficha del cubo y en el resumen (`arbol.indicadores_con_nombre_repetido`).

**5. ENOE al día y exacta (serie recalculada 2005T1-2026T2).** La serie heredada llegaba a 2025T1; el INEGI publica hasta
2026T2 y los CSV de la descarga masiva ya estaban en R2 (datos abiertos). `scripts/enoe_indicadores_inegi.py` recalcula
los 13 indicadores (nacional y 32 entidades), ocupados por sector (rama_est2) y por posición (pos_ocu) para los 85
trimestres desde el SDEM oficial (fac_tri; fac hasta 2020T1; ent o cve_ent desde 2025T3) con dominio 15+ en todos los
conteos y población de 15 y más = PEA + PNEA (clase1 IN (1,2), como la publica el INEGI). Verificación contra el Banco de
Indicadores (6200093963, 6200093960, 6200032077, 6200093954, 6200093973): **2,805 comparaciones por indicador, diferencia
0 en las cinco** (población 15+, PEA, PNEA, ocupados, desocupados; 85 trimestres × 33 geografías). Hallazgo sobre la
serie heredada: estaba 0.7 % por debajo de forma uniforme (2025T1: 58,921,494 ocupados contra 59,001,009 del INEGI) porque
el cargador de DBF descartaba filas repetidas en la llave (ON CONFLICT DO NOTHING) y no acotaba ocupados/desocupados a 15+;
la validación de entonces lo atribuyó a «post-estratificación». Las cuatro tablas de D1 se reemplazaron (1,105 + 35,360 +
33,660 + 11,220 filas; `bound_oficial` y `delta_rel_pct` guardan la cifra del INEGI y la diferencia, 0). Los microdatos
servidos por /enoe/microdatos siguen hasta 2025T1 (particiones desde Neon): extenderlos con los CSV es tarea aparte.

**6. DENUE /resumen (corregido de paso).** Contaba 6.1 millones de filas en cada llamada (18-33 s) y a veces excedía D1
(500). Ahora lee `denue_resumen` (SUM(n) = 6,138,075, 2,478 municipios, estratos idénticos) y se memoriza 30 min: 2.3 s.

**Verificación.** `scripts/verificar_cubos.py` con 13 comprobaciones nuevas (partición, catálogos, ruta, árbol, cortes,
ENOE exacta contra el Banco de Indicadores en 2025T1 y 2026T2) → **FALLOS 0** en la vista previa (a5722d53) y en producción.

## 2026-09-21 — Auditoría INEGI, segunda entrega: registros vitales, seguridad pública y ENIGH completa (11 cubos nuevos, 35 en total)

**Registros vitales (D1 nueva `datosmexico-api-vitales`, `scripts/vitales_d1.py`).** Los 75 archivos anuales de
microdatos que ya estaban en R2 (EDR defunciones 1990-2024, ENR nacimientos 1985-2024; 120,523,123 registros) se
agregan en cinco tablas (defunciones por municipio 691,762 filas; por causa y edad 1,122,995; por causa detallada
349,602; nacimientos por municipio 588,733; por edad de la madre 160,305) y cinco cubos. Decisión clave: todo por lugar de
RESIDENCIA habitual, porque es la base de las series «registradas» del INEGI: por residencia, 2024 cuadra con el Banco
de Indicadores en las 32 entidades y en 2,450/2,450 municipios (defunciones) y 2,443/2,443 (nacimientos); por lugar de
registro u ocurrencia no cuadra ninguna entidad. Verificación completa contra 1002000030-34 y 1002000026-28 (1994-2024,
nacional + entidades + municipios): defunciones totales, por sexo y de menores de un año **76,238 / 75,918 / 75,806 /
60,395 comparaciones, 0 distintas**; nacimientos 76,180 comparaciones, 2 distintas (Solidaridad y Tulum, Quintana Roo,
2008: el INEGI reasignó 239 nacimientos al municipio creado ese año; la suma de ambos coincide). Codificación verificada
contra la columna `edad` (edad_agru 1 = menores de 1 año … 30 = no especificada). Los archivos 1990-1997 usan CIE-9 sin
lista mexicana: los cubos de causa empiezan en 1998. Catálogos de causas del INEGI 2024 re-decodificados de CP437
(«C¢lera» → «Cólera»).

**Seguridad pública (D1 nueva `datosmexico-api-seguridad`, `scripts/seguridad_d1.py`).** ENVIPE: la persona elegida de
18+ y su percepción de inseguridad en colonia, municipio y entidad (ap4_3_1/2/3, fac_ele). Hallazgo metodológico: el
indicador 6200118581 del INEGI («Percepción de la inseguridad») es exactamente el % de «inseguro en su colonia» sobre toda
la población de 18+ incluido «no sabe»: **297/297 comparaciones exactas (±0.005 pp) en 9 ediciones × 33 geografías**.
La edición 2020 se excluye: con ningún factor de la tabla (fac_ele 42.93 %, fac_ele_am 52.01 %) se reproduce el 48.74 %
publicado, y no se publica lo que no cuadra. La **tasa de prevalencia delictiva no se publica**: ninguna reconstrucción
desde el módulo de victimización (TMod_Vic) reprodujo 6200002197 (23,472.5 por 100 mil en 2025; la más cercana, «cualquier
delito», 25,594.7; sin delitos del hogar, 20,180.4). ENSU: % que considera inseguro vivir en su ciudad (bp1_1, fac_sel),
40 trimestres 2016-03 a 2026-06, hasta 90 ciudades; verificado contra el cuadro 1.7 de los tabulados básicos de junio
2026 archivados en el observatorio, emparejando por población de 18+ (los nombres oficiales del cuadro pasan al
catálogo): **91/91 (país + 90 ciudades) exactos en población, seguro e inseguro**. 2013-2015 (piloto) fuera.

**ENIGH completa (sobre D1 existente).** Cuatro cubos nuevos: personas (130,325,969 expandidas), viviendas (38,356,042),
gastos por rubro (5.3 millones de registros, 1,055 claves) e ingresos por fuente (83 claves); sus sumas reproducen las de
cada tabla y las notas explican por qué el G1 (1.71 billones) y las fuentes (2.60 billones) no igualan gasto_mon (1.85) ni
ing_cor (3.02) del concentrado.

**Censos Económicos (no hay cubo).** Los microdatos no son públicos; en la descarga masiva del INEGI no existe el programa;
en el Banco de Indicadores solo hay 80 indicadores con esa fuente (sin nivel municipal), ya consultables en
`inegi-indicadores`; los 2,044 tabulados de los Censos Económicos 1999-2024 están archivados y descargables en
/api/v1/inegi/datos-abiertos (programa `ce`). Los resultados por municipio y rama viven en el SAIC del INEGI: sería un
frente de ingesta aparte.

**Detalles de rigor que salieron al verificar.** (1) `enigh-gastos` sobre los 5.3 millones de registros tardaba 19 s por
consulta: se creó `gastos_resumen` dentro de D1 (32 INSERT … SELECT por entidad; 55,836 filas; SUM(registros) = 5,311,497 y
G1 idéntico al peso). (2) Las claves de residencia 33/34/35 de la EDR/ENR (Estados Unidos, otros países de Latinoamérica,
otros países) faltaban en el catálogo y un JOIN interno perdía 873 nacimientos de 2024: catálogo completo, totales
exactos. (3) El capítulo XXII de la CIE-10 (códigos U: COVID-19) no viene en el capgpo del INEGI: se agrega con su título
oficial. (4) La API de Cloudflare devolvió un «Authentication error [code: 10000]» transitorio a media carga de 2.9
millones de filas: los cargadores ahora reintentan (4 intentos) y reanudan por tabla.

**Verificador.** 13 comprobaciones más (vitales exactas vs Banco de Indicadores incluido Cuauhtémoc 09015; ENIGH; ENVIPE
32 entidades ±0.005; partición de ámbito; ENSU junio 2026 = cuadro 1.7) → **FALLOS 0** en la vista previa (41179ac6) y en
producción (versión 6e810896).

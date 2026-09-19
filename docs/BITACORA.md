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

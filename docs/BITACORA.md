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

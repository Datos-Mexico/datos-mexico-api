# PLAN — api.datosmexico.org en Cloudflare

Decisión del CEO, 19-sep-2026. Un paso a la vez. Sin firmas de IA en ningún artefacto.

## Qué se construye
Una API nueva, `api.datosmexico.org`, corriendo por completo en Cloudflare
(Workers + D1 + R2), con `/docs` (Swagger) y `/openapi.json`, con el mismo
rigor o más que el legacy. El legacy (`api.datos-itam.org`, FastAPI en Railway
+ Postgres en Neon, 56 GB) NO se tira: convive hasta que lo nuevo demuestre
paridad base por base.

## Reglas
1. Nada del observatorio se mezcla con otros proyectos de la cuenta Cloudflare.
   Nombres: Worker `datosmexico-api`, D1 `datosmexico-api-consar` (una base D1
   por dataset), R2 `datosmexico-datos`. No tocar ningún recurso ajeno.
2. Paridad medida: para cada endpoint migrado, un comparador pide lo mismo al
   legacy y al nuevo y exige respuestas equivalentes dato por dato. El reporte
   se guarda en `docs/paridad/`.
3. La librería de Python NO se toca todavía (orden del CEO).
4. Nombres propios verbatim de la fuente. Wording ITAM canónico: «estudiantes,
   egresados y colaboradores del ITAM». Sin «respaldo institucional».
5. Cero atribución a IA en commits, código, docs y descripciones.
6. Ramas y PRs en el repo de la org cuando exista; nada visible al público sin
   el go del CEO. La primera publicación va a `*.workers.dev`; el dominio
   `api.datosmexico.org` se conecta cuando la paridad de CONSAR esté verde.

## Orden
- F0  Inventario del legacy y decisiones de stack.            → docs/BITACORA.md
- F1  Esqueleto: Worker + Hono + chanfana, /docs, /health,
      /openapi.json con descripción canónica.                  → workers.dev
- F2  CONSAR: esquema en D1, carga desde Neon, endpoints,
      comparador de paridad verde.                             → docs/paridad/consar.md
- F3  Dominio api.datosmexico.org (Workers custom domain).
- F4  ENIGH agregados (endpoints /enigh/* que no toquen microdatos).
- F5  Servidores públicos CDMX.
- F6  ENOE indicadores (agregados). Microdatos crudos: R2 (después).
- F7  Catálogo público «qué datos tenemos y hasta cuándo» + esquema legible por
      máquina por dataset (base del visualizador de relaciones).
- F8  Ingesta del Banco de Indicadores del INEGI (BISE): fase 1 = los 31,817
      indicadores del catálogo a nivel nacional y por entidad (D1
      `datosmexico-api-bise`, endpoints /api/v1/inegi/*); fase 2 = municipios
      con el mismo mecanismo; fase 3 = refresco periódico contra LASTUPDATE.
- Después: panel del observatorio (tablas tipo hoja de cálculo, visualizador
  de esquemas), librería de Python nueva o apuntada, apagado del legacy.

## Datatón (21-sep)
El producto del Datatón consume archivos publicados y muestra la API nueva
con Swagger como origen. No depende de que todo esté migrado.

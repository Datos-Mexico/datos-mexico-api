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
- F9  TODO lo descargable del INEGI (descarga masiva): HECHO 2026-09-20 —
      microdatos 4,259/4,259 en Parquet + originales, tabulados 18,150/18,150,
      catálogo y descarga en /api/v1/inegi/datos-abiertos/*; pasada complementaria
      de catálogos HECHA (22,597 tablas más); almacén conciliado contra manifiestos
      (scripts/inegi_conciliar_r2.py). Pendiente: refresco periódico contra el inventario.
- F10 ENOE microdatos desde R2 con paginación por cursor: HECHO 2026-09-20 —
      la API nueva ya no depende de Neon/Hyperdrive; Neon y el legacy siguen
      encendidos al menos hasta un mes después del Datatón (decisión del CEO).
- F11 Publicación del repositorio en la org Datos-Mexico como `datos-mexico-api`
      (público, sin firmas IA) tras revisión final: HECHO 2026-09-20 —
      https://github.com/Datos-Mexico/datos-mexico-api
- F12 TODA la UNAM: HECHO 2026-09-20 en la API (versión e5a91b4f, verificador FALLOS 0) —
      Anuario ANUIES completo 26/26 ciclos, 953,653 filas, 6,066 instituciones, conciliado;
      concurso 17 tablas; docs/ANUIES-UNIVERSO.md. Detalle del encargo:
      (a) Anuario ANUIES completo, todas las instituciones, 2000-2001 a 2025-2026, descargado
      íntegro por ciclo del servicio de anuario.anuies.mx con conciliación contra el agregado
      nacional (scripts/anuies_consulta.py), D1 `datosmexico-api-anuies` + Parquet por ciclo en R2,
      endpoints /api/v1/anuies/*; (b) dataset del Concurso de Selección (datos-mexico-unam, CC BY 4.0)
      en D1 `datosmexico-api-unam` + CSV en R2, endpoints /api/v1/unam/concurso/*; (c) vistas de la
      UNAM sobre el anuario en /api/v1/unam/anuario/* (serie, planteles, carreras, campos, niveles,
      procedencia, edades). Después: IPN, ITAM y las demás salen del mismo anuario.
- F13 Sitio (rama unam-anuario, PR abierto, ESPERA EL GO DEL CEO): /unam con barra de secciones (Proceso de selección + secciones nuevas con gráficos
      interactivos sobre F12: matrícula, egreso y titulación por área y sexo, planteles, carreras,
      procedencia por entidad, edades, serie 2000-2025). Rama + PR + preview; producción solo con el
      go del CEO. Referencia visual: exportes de DataMéxico (SE) del perfil UNAM (datos ANUIES 2022).
- F14 Capa de cubos para el explorador nuevo (HECHA 2026-09-20, en producción): `src/cubos/` —
      definición declarativa por cubo (medidas como expresiones agregadas, dimensiones con id/nombre,
      jerarquías, dimensiones virtuales sobre tablas anchas) y un motor que arma el SQL con parámetros
      ligados. Endpoints /api/v1/cubos (catálogo por tema), /{cubo} (ficha), /{cubo}/miembros,
      /{cubo}/datos (jsonrecords/jsonarrays/csv, filtros f.<dim>=a|b, padres, orden, límite).
      18 cubos: ANUIES (matrícula, trayectoria, edades, procedencia), ENOE (entidad, nacional, sector,
      posición), CONSAR (recursos, comisiones, cuentas, activo neto, rendimientos, traspasos, flujos),
      Censo 2020 (localidad › municipio › entidad), CDMX (nombramientos), UNAM (concurso). Verificador
      `scripts/verificar_cubos.py` (cruces contra los endpoints de cada dominio). Fase D (HECHA
      2026-09-21): 24 cubos en 9 temas con ENIGH 2024 (promedios ponderados por factor), Banco de
      Indicadores del INEGI (filtro obligatorio por indicador, miembros desde el catálogo), Censo
      completo (iter_2/iter_3 con los agregados 9998/9999), precios CONSAR y DENUE sobre la tabla
      preagregada `denue_resumen` (scripts/denue_resumen_d1.py). Plan del explorador en el sitio,
      docs/internal/observatorio-rediseno/MISION.md.
- F15 Auditoría INEGI del observatorio (CERRADA 2026-09-21 con el CEO; traspaso en docs/TRASPASO-INEGI.md; sin refresco
      automático por ahora). HECHO en la API: partición `nivel` en el cubo BISE (fin del triple conteo),
      catálogo `periodos` (fin del 500), cortes legibles, árbol temático del INEGI (`/inegi/arbol`,
      `ruta` en búsqueda/ficha/cubo; scripts/bise_arbol.py + bise_arbol_d1.py), ENOE recalculada
      2005T1-2026T2 exacta contra el Banco de Indicadores (scripts/enoe_indicadores_inegi.py),
      DENUE /resumen sobre la tabla preagregada; 15 cubos nuevos (registros vitales 5, seguridad 3,
      ENIGH 4, ENDUTIH, ENADID, BIE) en cuatro D1 nuevas (vitales, seguridad, encuestas, bie), todos
      exactos contra lo publicado por el INEGI; BIE completo (88,675 series) por la API interna del sitio
      del INEGI; búsqueda con sinónimos; microdatos ENOE 2025T2-2026T2; librería de Python 0.3.0 (PR #19).
      Sitio en producción (PRs #171-#173): mapa municipal, 422 legibles, /observatorio/datos-abiertos, hero
      «INEGI · CONSAR». Sistema anterior alineado a la ENOE exacta (Neon). Librería Python 0.3.0 en PyPI. Sin cubo: Censos Económicos (microdatos no públicos; SAIC sería otro frente) y la
      prevalencia delictiva de la ENVIPE (no reproducible). Microdatos ENOE 2025T2-2026T2 en /enoe/microdatos hechos.
- F16 «Tenemos todos los datos del INEGI» (EN CURSO 2026-09-21; traspaso en docs/TRASPASO-INEGI.md): cerrar las nueve
      exclusiones declaradas, cada una verificada contra una cifra del INEGI. HECHAS: 1 DENUE histórico (25 ediciones
      2010-2026 por entidad + 20 por sector, scripts/denue_historico.py, cubos denue-historico y -municipal, verificación
      por edición contra comunicados); 2 Marco Geoestadístico 2025 íntegro (scripts/mg_2025.py, 16 capas, ocho totales
      exactos, /api/v1/inegi/mg/*); 4 catálogos y clasificadores (SCIAN 2023/2018/2013, SINCO 2019/2011, CMO, AGEEML;
      scripts/catalogos_inegi.py + clasificadores_d1.py, D1 datosmexico-api-clasificadores, /api/v1/clasificadores/*,
      /api/v1/geo/*); 5 microdatos ENOE 2005T1-2025T1 desde los CSV oficiales (enoe/particiones-csv, 80 trimestres);
      8 metodologías (ENSANUT 39.11/36.07, ENVIPE prevalencia 330/330, ENVIPE 2020 48.74 %: scripts/metodologias_inegi.py,
      docs/METODOLOGIAS-INEGI.md, cubos ensanut-imc y envipe-prevalencia). 7 SAIC PRIMERA FASE EN PRODUCCIÓN (API interna descubierta, scripts/saic_descarga.py por fases con nohup, el servidor
      cobra por variable y no paraleliza; saic_cargar.py, /api/v1/inegi/saic/*, cubo saic-censos; nacionales = BISE
      5300000001). 6 ediciones fuera de la descarga masiva HECHA (513 bases: 7 experimentales del INEGI + 18 ENSANUT del INSP; inegi_ingesta.py --extra).
      7 CERRADA (segunda sesión): los cinco Censos Económicos completos desde los datos abiertos del INEGI (33 CSV por
      edición, scripts/ce_datos_abiertos.py, 33.6 M celdas cotejadas contra el SAIC), D1 con saic_mun para 1.0-1.8 M filas
      municipales por censo. 3 HECHA: tabulados explorables (scripts/tabulados_explorables.py, D1 datosmexico-api-tabulados,
      6 cubos tabulados-*: Censo 2020 básicos, Intercensal 2015, Censo 2010 básicos, Conteo 2005, cuentas por sectores
      institucionales anuales y trimestrales; 407 cuadros, 5.69 M celdas). PENDIENTES MENORES: Censo 2010 ampliado y
      complementarios 2020 con el mismo lector; decisiones del CEO (15 ediciones DENUE, licencia INSP).
- F8  Ingesta del Banco de Indicadores del INEGI (BISE): fase 1 = los 31,817
      indicadores del catálogo a nivel nacional y por entidad (D1
      `datosmexico-api-bise`, endpoints /api/v1/inegi/*); fase 2 = municipios
      con el mismo mecanismo; fase 3 = refresco periódico contra LASTUPDATE.
- Microdatos ENOE: PUBLICADOS en R2 (399 Parquet, 2.55 GB, verificados);
  origen definitivo de /microdatos/* pendiente de decisión (Neon vía
  Hyperdrive mientras tanto).
- Después: panel del observatorio (tablas tipo hoja de cálculo, visualizador
  de esquemas), librería de Python nueva o apuntada, apagado del legacy.

## Datatón (21-sep)
El producto del Datatón consume archivos publicados y muestra la API nueva
con Swagger como origen. No depende de que todo esté migrado.

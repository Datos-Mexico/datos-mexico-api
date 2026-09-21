# Traspaso — «Tenemos todos los datos del INEGI» (estado al 2026-09-21)

Punto de entrada para la siguiente sesión. Lo que está, cómo se verificó, cómo se repite, qué falta y cómo atacarlo.
Reglas vigentes: rigor académico máximo; cero atribución a IA en commits, PRs, código y docs; nunca imprimir secretos
(`data/.secretos.env`); el sitio solo vía rama + PR y producción solo con go explícito del CEO; el sistema anterior
(api.datos-itam.org, Neon) se queda en producción, ya alineado, y sus microdatos no se tocan; NO refresco automático
hasta nueva orden del CEO; ANUIES nunca en el hero ni cerca; todo queda en `docs/BITACORA.md` y en `docs/PLAN.md`.

## 1. Estado (producción: API versión 9cf4be1a + Neon alineado; verificador `scripts/verificar_cubos.py` FALLOS 0)

| Frente | Qué hay | Verificación |
|---|---|---|
| Banco de Indicadores (BISE) | 31,817 indicadores = catálogo del INEGI (recomprobado 21-sep), 7,456,265 observaciones (nacional, 32 entidades, 2,478 municipios), árbol de 182 temas con ruta por indicador, búsqueda sin acentos con sinónimos | conteos = manifiestos; sumas exactas (población 2020 126,014,024) |
| BIE | 88,678 series = `TotalIndicadores` raíz del INEGI (88,675 con datos, 3 vacías del INEGI); 126,016 serie-área listadas, 126,013 con valores; 154 áreas; 22,762 temas | PEA trimestral del BIE = BISE 85/85; INPC 334452 ago-2026 = INEGI |
| Descarga masiva | 202 programas; 103 con microdatos: 4,259/4,259 archivos (Parquet + original con SHA-256, 767 M filas); 183 con tabulados: 18,150/18,150 archivados | inventario del INEGI reproducido (`scripts/inegi_inventario_masivo.py`), sin novedades el 21-sep |
| ENOE | indicadores 2005T1-2026T2 recalculados desde los CSV oficiales (exactos vs BISE, Δ = 0 en 2,805 × 5); microdatos 2025T2-2026T2 completos con llave + `tipo`; 2005T1-2025T1 heredados (les falta ~3 % de filas) | `scripts/enoe_indicadores_inegi.py`, `enoe_particiones_csv.py --comparar 2025T1` |
| Registros vitales | defunciones 1990-2024, nacimientos 1985-2024, por residencia | exactos vs BISE nacional/entidad/municipio |
| Encuestas con cubo | ENIGH 2024 (5 cubos), ENVIPE 2017-2026 sin 2020, ENSU 2016-2026, ENDUTIH 2015-2025, ENADID 2023, ENDIREH 2021 | cada uno exacto contra una cifra publicada (ver bitácora 21-sep) |
| Censo 2020 | ITER por localidad (3 cubos), AGEB/manzana en Parquet | 126,014,024 exacto |
| DENUE | edición mayo 2026 completa (6,138,075), cubo sobre `denue_resumen` | SUM = COUNT |
| Sitio | explorador con 39 cubos, mapa municipal, `/observatorio/datos-abiertos`, errores 422 legibles | clics reales en producción |
| Librería Python | 0.3.0 en PyPI apuntando a la API nueva | 27/27 integración, 234 unitarias |

## 2. Exclusiones declaradas (lo que NO tenemos) y cómo atacarlas

1. **DENUE histórico (ediciones 2015-2025).** El INEGI las publica en www.inegi.org.mx/app/descarga/?ti=6 (descarga por
   entidad y edición). Plan: inventariar con Chrome las ediciones disponibles, descargar por edición a R2
   (`denue/<edicion>/...`), cargar `denue_resumen_<edicion>` y darle al cubo la dimensión edición. Verificar: totales por
   entidad contra el comunicado de cada edición.
2. **Marco Geoestadístico completo.** Hoy solo geometría de estados y municipios en el sitio (MG 2025). Plan: descargar el
   MG 2025 íntegro (32 paquetes estatales: entidades, municipios, localidades, AGEB, manzanas, servicios) a R2 como
   datos abiertos con manifiesto y catálogo en D1; exponer descarga y conteos en la API. Verificar: 2,478 municipios,
   número de localidades y AGEB contra el propio catálogo del MG.
3. **Tabulados como tablas explorables** (4,647 archivos de censos de población, Censos Económicos y cuentas por sectores
   institucionales; 18,150 en total). Plan: empezar por los Censos Económicos 2024 (cuadros por entidad y sector) y el
   Censo 2020 (tabulados básicos): leer Excel con openpyxl, un cubo por familia de cuadros, verificación cuadro por cuadro.
4. **Catálogos y clasificadores autónomos** (SCIAN 2023/2018 completo, SINCO, CMO, catálogo único de localidades).
   Plan: descargar de sus páginas del INEGI (Chrome para localizar los archivos), cargar como catálogos en D1 y exponerlos en
   `/api/v1/inegi/catalogos/*`.
5. **Microdatos ENOE 2005T1-2025T1 completos.** Rehacer las particiones desde los CSV oficiales con
   `scripts/enoe_particiones_csv.py` (la llave necesita `tipo`; en 2005-2020T1 el factor es `fac` y hay que confirmar que
   `tipo` exista; si no, buscar la variable que hace única la llave). Reemplaza `enoe/particiones/*/<periodo>/*.parquet`
   y el índice; el worker ya lee `llave_extra` por partición.
6. **Ediciones fuera de la descarga masiva** (ENDIREH 2016; ENSANUT Continua 2020-2023 del INSP; otras). Plan: buscar
   con Chrome en la página de cada programa (sección «Microdatos») y en ensanut.insp.mx; si existen, ingerirlas con
   `scripts/inegi_ingesta.py` (mismo manifiesto y verificación).
7. **Censos Económicos por municipio y rama (SAIC).** Microdatos no públicos; el SAIC (www.inegi.org.mx/app/saic/) sirve
   cuadros. Plan: con Chrome, identificar la API interna del SAIC (como se hizo con el BIE: pestaña Red del navegador),
   descargar los cuadros por entidad, municipio y rama, y verificar contra los tabulados de los Censos Económicos.
8. **Resuelta (2026-09-21):** las tres cifras se reproducen exactas con `scripts/metodologias_inegi.py` (ENSANUT 2018:
   sección de adultos mayores + depuración del INSP + F_ANTROP_INSP → 39.1/36.1, n = 16,579; prevalencia delictiva: víctimas
   de TMod_Vic sin el código 03 «vandalismo» → 6200002197 exacto en 330 comparaciones; ENVIPE 2020: solo el levantamiento de
   marzo, TVivienda.PER = 1 → 48.74 %). Fuentes, fórmulas y diferencias en `docs/METODOLOGIAS-INEGI.md`. Pendiente: cargar
   con `--cargar` (ensanut → datosmexico-api-encuestas; envipe-prevalencia y envipe-2020 → datosmexico-api-seguridad) y
   desplegar los cubos `envipe-prevalencia` y `ensanut-imc`. Regla vigente: no se publica lo que no cuadra.
9. **Fuera de alcance por decisión:** cartografía e imágenes del geoportal, PDF y boletines, catálogos del SNIEG/RNM.

## 3. Cómo se repite cada cosa (manual, por decisión del CEO)

- BISE: `bise_descarga.py` + `bise_descarga_municipal.py` → `bise_a_csv.py` → carga (bitácora 19-sep); árbol
  `bise_arbol.py` + `bise_arbol_d1.py`; búsqueda `bise_busqueda_d1.py`.
- BIE: `bie_arbol.py` → `bie_descarga.py` (borrar `data/bie/manifiesto.jsonl` para rebajar valores; 24 hilos, ~2 h) →
  `bie_d1.py --preparar --cargar` (4 min). Tokens públicos del sitio del INEGI en `.secretos.env` (INEGI_TOKEN_WEB, _WEB2).
- Descarga masiva: `inegi_inventario_masivo.py` (universo) → `inegi_ingesta.py` (por shard) → `inegi_catalogo_d1.py`.
- ENOE: `enoe_indicadores_inegi.py --cargar` (indicadores) → `enoe_legado_alinear.py --aplicar` (Neon) →
  `enoe_particiones_csv.py --desde <trim> --cargar` (microdatos).
- Vitales, seguridad, encuestas: `vitales_d1.py`, `seguridad_d1.py`, `endutih_d1.py`, `enadid_d1.py`, `endireh_d1.py`
  (todos con `--cargar`; verifican antes y no cargan si algo difiere).
- Siempre al final: `npx wrangler versions upload` → `python3 scripts/verificar_cubos.py <preview>` → FALLOS 0 →
  `npx wrangler deploy` → verificar producción → commit + push.

## 4. Quirks medidos (no volver a tropezar)

- La API de desarrolladores del INEGI no sirve el BIE (400 «No se encontraron resultados» con cualquier id); el sitio del
  INEGI sí, por `interna_v1_3` (métodos en `bie_arbol.py`/`bie_descarga.py`). Para descubrir APIs internas: Chrome, pestaña
  Red (read_network_requests) mientras se usa la interfaz del INEGI.
- D1: sentencias ≤ 90 KB (SQLITE_TOOBIG), archivos ≤ 8 MB, 400-500 filas por INSERT; la API de Cloudflare da
  «Authentication error [code: 10000]» transitorio en cargas largas → reintentar y reanudar por tabla (ya en los scripts).
- Valores del BIE con separadores de miles («42,106,336») y códigos «NC»; 2025T3+ de la ENOE renombra `ent`→`cve_ent`,
  `mun`→`cve_mun`; la llave de la ENOE no es única sin `tipo` desde 2020T3.
- Ninguna tabla de hechos > ~1 M filas se agrupa entera en una consulta del explorador: preagregar dentro de D1
  (`denue_resumen`, `gastos_resumen`) o exigir filtro (`filtro_obligatorio`) y partición (`particion`).
- Catálogos del INEGI en CP437 mal decodificado («C¢lera»); tabulados Excel apilan bloques (estimaciones, CV, errores):
  vale el primero.

## 5. Decisiones del CEO que gobiernan

Sin refresco automático (por ahora). Sistema anterior alineado, no apagado. ANUIES: mención mínima, jamás en el hero.
Producción del sitio solo con go explícito por PR. Publicación en PyPI solo con go explícito (v0.3.0 ya publicada).

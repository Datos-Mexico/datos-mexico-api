# Traspaso — «Tenemos todos los datos del INEGI» (estado al 2026-09-21, fin de la segunda sesión de F16)

Punto de entrada para la siguiente sesión. Lo que está, cómo se verificó, cómo se repite, qué falta y cómo atacarlo.
Reglas vigentes: rigor académico máximo; cero atribución a IA en commits, PRs, código y docs; nunca imprimir secretos
(`data/.secretos.env`); el sitio solo vía rama + PR y producción solo con go explícito del CEO; el sistema anterior
(api.datos-itam.org, Neon) se queda en producción, ya alineado, y sus microdatos no se tocan; NO refresco automático
hasta nueva orden del CEO; ANUIES nunca en el hero ni cerca; todo queda en `docs/BITACORA.md` y en `docs/PLAN.md`.

## 1. Estado (producción: API versión 13deb4a8, 2026-09-21; `scripts/verificar_cubos.py` FALLOS 0 en vista previa y producción, 260 comprobaciones; `tabulados_explorables.py --verificar` 360/360 celdas)

| Frente | Qué hay | Verificación |
|---|---|---|
| Banco de Indicadores (BISE) | 31,817 indicadores, 7,456,265 observaciones (nacional, 32 entidades, 2,478 municipios), árbol de 182 temas, búsqueda con sinónimos | conteos = manifiestos; población 2020 126,014,024 |
| BIE | 88,678 series, 8,736,757 observaciones, 154 áreas, 22,762 temas | PEA trimestral = BISE 85/85; INPC ago-2026 |
| Descarga masiva + fuera de ella | 207 programas; microdatos 4,772 archivos / 44,731 tablas / 805.6 M filas (Parquet + original SHA-256), incluidas 513 bases fuera de la descarga masiva (INEGI experimentales + ENSANUT del INSP); tabulados 18,150/18,150 | inventario del INEGI reproducido; extra verificado SHA-256/filas/HEAD |
| ENOE | indicadores 2005T1-2026T2 exactos vs BISE; **microdatos 2005T1-2026T2 completos desde los CSV oficiales** (85 trimestres; el legado descartaba 2.1 % de filas) | Δ = 0 en 2,805 × 5; 0 diferencias vs legado en 5 trimestres × 5 tablas; conteos = CSV |
| DENUE | edición 05/2026 completa (6,138,075) + **histórico de 25 ediciones 2010-2026 por entidad** (13.4 M filas municipio × clase × estrato; Parquet completo por edición en R2) y 20 por sector archivadas | 6 ediciones exactas contra el comunicado, 4 sin cifra, 15 con diferencias de −33 a +852 (2 con archivos defectuosos del INEGI); tabla en `/api/v1/denue/ediciones` |
| Marco Geoestadístico 2025 | íntegro: 16 capas × 32 estados como Parquet nacional por capa (WKB, EPSG:6372), zips originales, catálogos CSV | los 8 totales que declara el INEGI en el producto, exactos (2,478 mun; 64,808 AGEB urbanas; 2,634,771 manzanas…) |
| Clasificadores | SCIAN 2023/2018/2013 (+ productos), SINCO 2019/2011, CMO histórica, AGEEML (32 / 2,478 / 296,633 localidades con coordenadas) | conteos por nivel = publicados por el INEGI en cada catálogo |
| Registros vitales, encuestas | defunciones 1990-2024, nacimientos 1985-2024; ENIGH 2024, ENVIPE 2017-2026 **incluida 2020** y **prevalencia delictiva**, ENSU, ENDUTIH, ENADID, ENDIREH, **ENSANUT 2018 (IMC)** | cada cubo exacto contra una cifra publicada (bitácora 21-sep) |
| Censo 2020 | ITER por localidad, AGEB/manzana en Parquet | 126,014,024 exacto |
| Tabulados explorables | 593 cuadros / 7.51 M celdas tal cual, 9 familias: Censo 2020 básicos (113) y complementarios (4), Intercensal 2015 (110, con precisión), Censo 2010 básicos (81) y ampliado (77), Conteo 2005 (41), Censo 2000 (95), cuentas por sectores institucionales anuales (10) y trimestrales (66); D1 `datosmexico-api-tabulados`, `/api/v1/inegi/tabulados/*`, cubos `tabulados-*` | celdas leídas = celdas numéricas de cada hoja; poblaciones totales 2005/2010/2015/2020 = BISE; muestra al azar de celdas vs API |
| Censos Económicos 2004-2024 | **los cinco censos completos** desde los datos abiertos del INEGI (33 CSV por edición = el cuadro del SAIC): nacional, 32 entidades y todos los municipios × 6 niveles de actividad × 6 estratos × 98 variables; Parquet por año en R2 (1.1-1.9 M filas); D1 con las 98 para nacional/entidades y las 9 del cubo para municipios | 33.6 M celdas cotejadas contra la API del SAIC (Δ máx 0.00055, redondeo); UE nacionales = BISE 5300000001; municipios suman la entidad por sector |
| Sitio | explorador (53 cubos, 13 temas, catálogo dinámico: los cubos nuevos aparecen sin cambios en el sitio) | clics reales |
| Librería Python | 0.3.0 en PyPI | 27/27 integración |

## 2. Exclusiones declaradas: estado y plan

1. **DENUE histórico — HECHO.** `scripts/denue_historico.py` (ámbito `entidad` = 25 ediciones 2010-2026, 815 CSV;
   `DENUE_AMBITO=sector` = 20 ediciones 2015-2026, 484 CSV); inventario por la API interna de la descarga masiva; espejo por
   el worker; Parquet completo por edición (`denue/historico/<ed>/`), resumen a D1 (`denue_ediciones`, `denue_historico`,
   `denue_hist_entidad`, catálogos por edición y nombres estables `denue_hist_act_nombre` / `denue_hist_ent_nombre`).
   Cubos `denue-historico` y `denue-historico-municipal` (solo ediciones exactas o sin cifra: `verificado IS NOT 0`);
   endpoints `/api/v1/denue/ediciones`, `/denue/historico`, `/denue/historico/descarga/{edición}`.
   **Decisión pendiente del CEO:** incluir en los cubos las 15 ediciones que difieren de una a 852 unidades del comunicado
   (basta quitar `donde` en `src/cubos/definiciones/denue_historico.ts`); 07/2013 (archivo de CDMX truncado, −214,602) y
   05/2024 (+21,661) deben seguir fuera.
2. **Marco Geoestadístico — HECHO.** `scripts/mg_2025.py --procesar --subir --cargar`; `/api/v1/inegi/mg/*`.
   Pendiente menor: `mg_2025_integrado.zip` (257 MB, capas nacionales) está dentro del zip nacional archivado, no aparte.
3. **Tabulados como tablas explorables — HECHO (censos de población y cuentas por sectores).** `scripts/tabulados_explorables.py
   --bajar --leer --cargar --verificar URL`: los cuadros en Excel se leen tal cual a formato largo (d1…d5 = categorías de la fila,
   columna = encabezado con su grupo, valor, orden) en D1 `datosmexico-api-tabulados`; un cubo por familia (`tabulados-censo2020`,
   `-intercensal2015`, `-censo2010`, `-conteo2005`, `-csi-anual`, `-csi-trimestral`, tema nuevo `cuentas-nacionales`) y endpoints
   `/api/v1/inegi/tabulados`, `/{familia}`, `/{familia}/{cuadro}` (celdas filtrables por d1…d5 y columna), `/archivo` (el Excel
   original desde R2). Control de no pérdida por hoja y verificación de celdas conocidas + muestra al azar contra la API.
   Nueve familias (censo2000, conteo2005, censo2010 y -ampliado, intercensal2015, censo2020 y -complementarios, csi-anual,
   csi-trimestral). Fuera: 1990/1995 (no están en la descarga masiva) y tres cuadros del ampliado 2010 sin Excel en el sitio.
   El lector reporta las hojas que no convierte (hoy ninguna): revisar ese aviso en cada familia nueva.
4. **Catálogos y clasificadores — HECHO.** `scripts/catalogos_inegi.py` (descarga y normaliza; `data/catalogos/README.md`)
   → `scripts/clasificadores_d1.py --cargar` (D1 `datosmexico-api-clasificadores`); `/api/v1/clasificadores/*`, `/api/v1/geo/*`.
5. **Microdatos ENOE 2005T1-2025T1 — HECHO.** `scripts/enoe_particiones_csv.py` (llave por conteo: sin `tipo` hasta 2020T1,
   `tipo` desde 2021T3, `tipo,d_sem` en la ENOE-N 2020T3-2021T2; anchos del legado por trimestre); particiones en
   `enoe/particiones-csv/`; índice D1 apuntado en los 80 trimestres. Las particiones viejas (`enoe/particiones/`) siguen en
   R2: borrarlas es decisión del CEO.
6. **Ediciones fuera de la descarga masiva — HECHO.** `scripts/inegi_ediciones_programas.py` (699 ediciones del sitio del
   INEGI por `/app/menu/0/<idm>/1` y la pestaña «Microdatos») + `scripts/ensanut_insp_inventario.py` (INSP) →
   `data/inegi/fuera-descarga-masiva.csv` → `inegi_ingesta.py --extra` → `inegi_verificar_extra.py` (FALLOS 0) →
   `inegi_catalogo_d1.py`. 513 bases (7 ediciones experimentales del INEGI + 18 de la ENSANUT en el INSP; ENDIREH 2016 ya
   estaba). **Decisión pendiente del CEO:** redistribución de las bases del INSP (acceso libre según sus FAQ, sin licencia).
7. **Censos Económicos 2004-2024 por municipio, actividad y estrato — HECHO.** Fuente definitiva: los «datos abiertos» de
   los Censos Económicos (`/contenidos/programas/ce/2024/datosabiertos/conjunto_de_datos_ce_<ent>_<edición>_csv.zip`, 33 zips
   por edición para 2004-2024; no están en la descarga masiva): el mismo cuadro que sirve el SAIC, con más decimales.
   `scripts/ce_datos_abiertos.py --bajar --parquet --verificar` (4 min de descarga; Parquet por año censal con el esquema del
   SAIC; verificación celda por celda contra todo lo bajado por la API del SAIC: 33.6 M celdas, Δ máx 0.00055 = redondeo) →
   `scripts/saic_cargar.py --subir --cargar` (D1 censo2020: `saic_a`/`saic_b` nacional y entidades con las 98 variables,
   `saic_mun` municipios con las 9 del cubo; `saic_anios.fuente = 'datos abiertos'`, `completo = 1`). La API del SAIC
   (`saic_descarga.py`, `saic_vigilar.sh`) queda solo como muestra de verificación: cobra ~0.65 s por variable y 1,000 filas
   sin paralelismo (50-60 h para todo) y su `ThreadPoolExecutor` se bloqueó una vez sin conexiones abiertas.
8. **Metodologías — HECHO** (`scripts/metodologias_inegi.py`, `docs/METODOLOGIAS-INEGI.md`): ENSANUT 2018 39.11/36.07 (sección
   de adultos mayores + depuración del INSP + F_ANTROP_INSP), prevalencia delictiva exacta en 330/330 (víctimas sin el código
   03 «vandalismo»), ENVIPE 2020 48.74 % (solo levantamiento de marzo, TVivienda.PER = 1). Cubos `ensanut-imc` (tema salud) y
   `envipe-prevalencia` en producción.
9. **Fuera de alcance por decisión:** cartografía e imágenes del geoportal, PDF y boletines, catálogos del SNIEG/RNM.

## 3. Cómo se repite cada cosa (manual, por decisión del CEO)

- BISE: `bise_descarga.py` + `bise_descarga_municipal.py` → `bise_a_csv.py` → carga; árbol `bise_arbol.py` + `bise_arbol_d1.py`.
- BIE: `bie_arbol.py` → `bie_descarga.py` (borrar manifiesto para rebajar) → `bie_d1.py --preparar --cargar`.
- Descarga masiva: `inegi_inventario_masivo.py` → `inegi_ingesta.py` → `inegi_catalogo_d1.py`.
- ENOE: `enoe_indicadores_inegi.py --cargar` → `enoe_legado_alinear.py --aplicar` → `enoe_particiones_csv.py --desde <trim> --cargar --prefijo enoe/particiones-csv`.
- DENUE histórico: `denue_historico.py --inventario --espejar --bajar --resumir --subir --cargar` (ámbito entidad).
- MG: `mg_2025.py --procesar --subir --cargar` (nueva edición: cambiar upc y clave; verificar contra su contenido.txt).
- Clasificadores: `catalogos_inegi.py` → `clasificadores_d1.py --cargar`. Metodologías: `metodologias_inegi.py <sub> --cargar`.
- Censos Económicos: `ce_datos_abiertos.py --bajar --parquet --verificar` → `saic_cargar.py --subir --cargar` (nueva edición: agregar a `EDICIONES`; el SAIC solo como muestra: `saic_descarga.py --descargar --anios <año> --ambitos 00,ent`).
- Tabulados: `tabulados_explorables.py --bajar --leer --cargar --verificar https://api.datosmexico.org` (familia nueva: entrada en `FAMILIAS` con programa, edición, patrón y lector `censo` o `csi`).
- Vitales, seguridad, encuestas: `vitales_d1.py`, `seguridad_d1.py`, `endutih_d1.py`, `enadid_d1.py`, `endireh_d1.py`.
- Siempre al final: `npx wrangler versions upload` → `python3 scripts/verificar_cubos.py <preview>` → FALLOS 0 →
  `npx wrangler deploy` → verificar producción → commit + push.

## 4. Quirks medidos (no volver a tropezar)

- Descarga directa del INEGI: 0.7 MB/s por IP. Espejo por el worker (`POST /api/v1/admin/espejo`, claves solo bajo
  `inegi/fuentes/` o `inegi/tabulados/`): 968 archivos del DENUE en 15 min, el MG de 2.9 GB en 12 min.
- API interna de la descarga masiva: `clasificaciones?tinfo=6` → `obtenerarchivos` con tipoInfo OTROS; el DENUE por entidad
  se lista con `ag` = clave de la entidad (25 ediciones), el sectorial en «Otros|DENUE|Actividad económica|».
- DENUE 2010-2013: encabezados en español con variantes por entidad, sin clave de municipio en 2010 y 07/2013 (se asigna
  por nombre), ids repetidos entre archivos, encabezado pegado a la primera fila en 01/2016; los archivos de 05/2024 no
  cuadran con su comunicado (+21,661) y el de CDMX de 07/2013 está truncado.
- D1: sentencias ≤ 80-90 KB (las descripciones largas del SCIAN rompen lotes de 300 filas), archivos ≤ 8 MB; un
  `CREATE INDEX` sobre 13.5 M filas da SQLITE_NOMEM (la llave primaria debe empezar por el filtro obligatorio); máx 100
  columnas por tabla; `auth error 10000` transitorio → reintentar.
- Motor de cubos: `nombre` y `orden` de una dimensión van al GROUP BY: no admiten agregados (MAX/MIN) y un nombre que cambia
  entre ediciones parte las filas → tablas de nombres estables.
- `unzip` de macOS falla con nombres acentuados del INEGI: extraer con zipfile.
- SAIC: costo proporcional a variables × filas; sin paralelismo del lado del servidor; `varcens` deben ser hojas
  (los grupos AA…AI responden «No existe información»); redondea a 3 decimales (Q000B con doble redondeo). Los datos abiertos
  de los CE viven solo bajo `/ce/2024/datosabiertos/` (las páginas de 2019 y anteriores no los enlazan); en 2004/2009 la rama
  7225 se repite como subrama y clase; códigos de sector con espacio final.
- Tabulados en Excel: 2005 no deja fila en blanco entre título y encabezados; subencabezados numéricos (hijos, cuartos);
  llamadas a nota pegadas («Población total1»); libros trimestrales de las CSI con prefijo «__a» en los conceptos; D1 rechaza
  sentencias > ~100 KB (SQLITE_TOOBIG): armar lotes por tamaño (≤ 60 KB), no por filas; wrangler falla a veces con
  «Firewall or VPN blocking the request» (transitorio, reintentar).
- La ENOE-N 2020T3-2021T2 repite la vivienda hasta tres veces (una por mes): llave + tipo + d_sem.

## 5. Decisiones del CEO que gobiernan

Sin refresco automático (por ahora). Sistema anterior alineado, no apagado. ANUIES: mención mínima, jamás en el hero.
Producción del sitio solo con go explícito por PR. Publicación en PyPI solo con go explícito (v0.3.0 ya publicada).
Costo (segunda sesión): D1 censo2020 191 MB → 713 MB (Censos Económicos municipales) y D1 tabulados nueva 1.1 GB; R2 +0.7 GB (165 zips de los CE, 5 Parquet, xls del Censo 2010): ~1.3 USD/mes adicionales. Costo (primera sesión): D1 creció ~1.2 GB (DENUE histórico ~1 GB, clasificadores ~0.1 GB, MG ~0.01 GB) y R2 ~20 GB
(DENUE 18 GB de fuentes + 6.3 GB Parquet, MG 5 GB): ~1 USD/mes adicional, dentro de lo que el CEO aceptó como centavos con aviso.

## 6. Prompt de la siguiente sesión

> Contexto: datos-mexico-api, F16 «tenemos todos los datos del INEGI», leer `docs/TRASPASO-INEGI.md` (estado al 2026-09-21, segunda
> sesión: 8 de 9 exclusiones cerradas, tabulados en nueve familias; producción 13deb4a8, verificador FALLOS 0; librería PR #21
> abierto). Objetivo: (1) fusionar el PR #21 de datos-mexico-py y publicar 0.4.0 en PyPI si hay go; (2) resolver con el CEO las decisiones
> abiertas (15 ediciones del DENUE con diferencias de 1-852 unidades; licencia del INSP; borrar `enoe/particiones/` viejas);
> (3) si el CEO quiere más tabulados explorables, la lista de la descarga masiva tiene 181 programas con Excel: mismo lector,
> una entrada en `FAMILIAS` por familia, con el control de hojas omitidas en cero antes de cargar.
> Reglas: verificador FALLOS 0 antes de desplegar, cero atribución a IA, sin secretos, API directo a main tras verificar,
> sin refresco automático, ANUIES nunca en el hero. Cierra con traspaso, bitácora, plan y memoria al día.

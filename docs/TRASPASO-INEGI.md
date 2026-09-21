# Traspaso — «Tenemos todos los datos del INEGI» (estado al 2026-09-21, fin de la primera sesión de F16)

Punto de entrada para la siguiente sesión. Lo que está, cómo se verificó, cómo se repite, qué falta y cómo atacarlo.
Reglas vigentes: rigor académico máximo; cero atribución a IA en commits, PRs, código y docs; nunca imprimir secretos
(`data/.secretos.env`); el sitio solo vía rama + PR y producción solo con go explícito del CEO; el sistema anterior
(api.datos-itam.org, Neon) se queda en producción, ya alineado, y sus microdatos no se tocan; NO refresco automático
hasta nueva orden del CEO; ANUIES nunca en el hero ni cerca; todo queda en `docs/BITACORA.md` y en `docs/PLAN.md`.

## 1. Estado (producción: API versión 2da88977, commit `576f24d`; `scripts/verificar_cubos.py` FALLOS 0 en vista previa y producción, 214 comprobaciones)

| Frente | Qué hay | Verificación |
|---|---|---|
| Banco de Indicadores (BISE) | 31,817 indicadores, 7,456,265 observaciones (nacional, 32 entidades, 2,478 municipios), árbol de 182 temas, búsqueda con sinónimos | conteos = manifiestos; población 2020 126,014,024 |
| BIE | 88,678 series, 8,736,757 observaciones, 154 áreas, 22,762 temas | PEA trimestral = BISE 85/85; INPC ago-2026 |
| Descarga masiva | 202 programas; microdatos 4,259/4,259 (Parquet + original SHA-256); tabulados 18,150/18,150 | inventario del INEGI reproducido |
| ENOE | indicadores 2005T1-2026T2 exactos vs BISE; **microdatos 2005T1-2026T2 completos desde los CSV oficiales** (85 trimestres; el legado descartaba 2.1 % de filas) | Δ = 0 en 2,805 × 5; 0 diferencias vs legado en 5 trimestres × 5 tablas; conteos = CSV |
| DENUE | edición 05/2026 completa (6,138,075) + **histórico de 25 ediciones 2010-2026 por entidad** (13.4 M filas municipio × clase × estrato; Parquet completo por edición en R2) y 20 por sector archivadas | 6 ediciones exactas contra el comunicado, 4 sin cifra, 15 con diferencias de −33 a +852 (2 con archivos defectuosos del INEGI); tabla en `/api/v1/denue/ediciones` |
| Marco Geoestadístico 2025 | íntegro: 16 capas × 32 estados como Parquet nacional por capa (WKB, EPSG:6372), zips originales, catálogos CSV | los 8 totales que declara el INEGI en el producto, exactos (2,478 mun; 64,808 AGEB urbanas; 2,634,771 manzanas…) |
| Clasificadores | SCIAN 2023/2018/2013 (+ productos), SINCO 2019/2011, CMO histórica, AGEEML (32 / 2,478 / 296,633 localidades con coordenadas) | conteos por nivel = publicados por el INEGI en cada catálogo |
| Registros vitales, encuestas | defunciones 1990-2024, nacimientos 1985-2024; ENIGH 2024, ENVIPE 2017-2026 **incluida 2020** y **prevalencia delictiva**, ENSU, ENDUTIH, ENADID, ENDIREH, **ENSANUT 2018 (IMC)** | cada cubo exacto contra una cifra publicada (bitácora 21-sep) |
| Censo 2020 | ITER por localidad, AGEB/manzana en Parquet | 126,014,024 exacto |
| Censos Económicos (SAIC) | 5 censos × (nacional, entidades, municipios) × 6 niveles de actividad × 6 estratos × 98 variables; **primera fase en producción** (nacional 2013/2018/2023, entidades 2023 por sector y subsector), descarga en curso | UE nacionales = BISE 5300000001 en 2013 y 2018; 2023 5,468,180 = SAIC; entidades y sectores suman el nacional |
| Sitio | explorador (43 cubos, 12 temas, catálogo dinámico: los cubos nuevos aparecen sin cambios en el sitio) | clics reales |
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
3. **Tabulados como tablas explorables — PENDIENTE.** Los Censos Económicos quedan cubiertos por el SAIC (punto 7). Faltan
   los tabulados de censos de población (Censo 2020 básicos, Intercensal 2015, censos 1990-2010) y las cuentas por sectores
   institucionales. Plan: leer los xlsx archivados en R2 (`inegi/tabulados/<programa>/`) con openpyxl, un cubo por familia
   de cuadros, verificación cuadro por cuadro.
4. **Catálogos y clasificadores — HECHO.** `scripts/catalogos_inegi.py` (descarga y normaliza; `data/catalogos/README.md`)
   → `scripts/clasificadores_d1.py --cargar` (D1 `datosmexico-api-clasificadores`); `/api/v1/clasificadores/*`, `/api/v1/geo/*`.
5. **Microdatos ENOE 2005T1-2025T1 — HECHO.** `scripts/enoe_particiones_csv.py` (llave por conteo: sin `tipo` hasta 2020T1,
   `tipo` desde 2021T3, `tipo,d_sem` en la ENOE-N 2020T3-2021T2; anchos del legado por trimestre); particiones en
   `enoe/particiones-csv/`; índice D1 apuntado en los 80 trimestres. Las particiones viejas (`enoe/particiones/`) siguen en
   R2: borrarlas es decisión del CEO.
6. **Ediciones fuera de la descarga masiva — EN CURSO** (agente en esta sesión: inventario en
   `data/inegi/fuera-descarga-masiva.csv`, scripts `inegi_ediciones_programas.py`, `ensanut_insp_inventario.py`, cambios en
   `inegi_ingesta.py` / `inegi_catalogo_d1.py` sin commit). Al retomar: leer su reporte en la bitácora si lo dejó, verificar
   y commitear.
7. **SAIC (Censos Económicos 2004-2024 por municipio, actividad y estrato) — PRIMERA FASE EN PRODUCCIÓN, descarga en curso.**
   API interna descubierta (`scripts/saic_descarga.py`: catálogos GET `/app/api/saic/{anios,ageos,acteco,varcen,estrato}/seg/…/6/`;
   datos POST `consulta/{total,tabla}/6/` con `varcens:[{nom,pos}]` hoja); 5 años × (nacional, 32 entidades, 2,478 municipios)
   × 6 niveles de actividad × 6 estratos × 98 variables = 1,660 tareas por fases (nacional y entidades con todo → municipios
   por sector → municipios por subsector/rama/clase con estrato total → resto). **Cuello de botella medido:** ~0.65 s por
   variable y 1,000 filas, sin paralelismo del servidor (98 variables: 11 s solo, 66 s con 8 hilos): la descarga completa
   tarda decenas de horas; corre con nohup y es reanudable (`data/saic/manifiesto.jsonl`; si el proceso murió:
   `data/.venv/bin/python scripts/saic_descarga.py --descargar --hilos 6`). Carga: `scripts/saic_cargar.py --parquet --subir
   --cargar [--anios 2023,2018]` (borrar `data/saic/parquet/saic_<año>.parquet` para regenerar un año); D1 censo2020 tablas
   `saic_a`/`saic_b` + catálogos; endpoints `/api/v1/inegi/saic/*` y cubo `saic-censos` (`completo` por año en el resumen).
   Verificación: UE nacionales = BISE 5300000001 (2013: 4,230,745; 2018: 4,800,157); 2023: 5,468,180 y 27,965,433 personas.
   Al retomar: repetir la carga con lo descargado, y cuando termine la fase municipal, ampliar el verificador (suma de
   municipios = entidad por sector) y las notas del cubo.
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
- SAIC: `saic_descarga.py --catalogos --descargar --hilos 6` (reanudable, nohup) → `saic_cargar.py --parquet --subir --cargar`.
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
  (los grupos AA…AI responden «No existe información»).
- La ENOE-N 2020T3-2021T2 repite la vivienda hasta tres veces (una por mes): llave + tipo + d_sem.

## 5. Decisiones del CEO que gobiernan

Sin refresco automático (por ahora). Sistema anterior alineado, no apagado. ANUIES: mención mínima, jamás en el hero.
Producción del sitio solo con go explícito por PR. Publicación en PyPI solo con go explícito (v0.3.0 ya publicada).
Costo: D1 creció ~1.2 GB en esta sesión (DENUE histórico ~1 GB, clasificadores ~0.1 GB, MG ~0.01 GB) y R2 ~20 GB
(DENUE 18 GB de fuentes + 6.3 GB Parquet, MG 5 GB): ~1 USD/mes adicional, dentro de lo que el CEO aceptó como centavos con aviso.

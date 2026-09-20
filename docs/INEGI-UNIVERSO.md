# Universo INEGI — qué significa «tenemos todo el INEGI» y cuánto llevamos

Regla: solo se afirma en público lo que aparece aquí como CARGADO y es
verificable con un endpoint de resumen. El universo son los productos con
datos abiertos descargables del INEGI (no las publicaciones en PDF ni los
tabulados interactivos). Se actualiza en cada tanda.

| Producto INEGI | Qué es | Estado | Medida verificable |
|---|---|---|---|
| Banco de Indicadores (BISE) | Todas las series de indicadores del INEGI (incluye los temas económicos que antes vivían en el BIE: INPC, INPP, PIB trimestral, IGAE, empleo) | CARGADO | 31,817 indicadores; 7,456,265 observaciones; nacional, 32 entidades y 2,478 municipios; `/api/v1/inegi/resumen` |
| DENUE | Directorio de todas las unidades económicas activas (edición 05/2026) | CARGADO | 6,138,075 unidades económicas, 32 estados, 989 actividades SCIAN, 42 campos; `/api/v1/denue/resumen` |
| ENOE | Encuesta de ocupación y empleo: 13 indicadores trimestrales + microdatos completos (viv, hog, sdem, coe1, coe2) | CARGADO | 101,512,667 filas de microdatos en R2 (2005T1-2025T1); indicadores en `/api/v1/enoe` |
| ENIGH 2024 | Ingresos y gastos de los hogares, microdatos completos y 111 catálogos | CARGADO | 91,414 hogares; `/api/v1/enigh/metadata` |
| Marco Geoestadístico 2025 | Geometrías de entidades y municipios | USADO | 32 entidades y 2,478 municipios (mapas del sitio y catálogo `geografias`) |
| Censo de Población y Vivienda 2020 | Resultados por localidad (ITER), por AGEB y manzana, y microdatos de la muestra | ITER y AGEB/manzana CARGADOS; microdatos de la muestra PENDIENTE | ITER: 195,662 filas × 286 indicadores, población 126,014,024 (`/api/v1/censo2020/resumen`); AGEB/manzana: 1,683,504 filas en 32 Parquet en R2 |
| Censos Económicos 2019 (y 2024 al publicarse) | Resultados por unidad económica agregada (SAIC) y datos abiertos | PENDIENTE | — |
| Censo Agropecuario 2022 | Resultados por entidad y municipio; microdatos | PENDIENTE | — |
| Encuestas en hogares (ENVIPE, ENSU, ENADID, ENDUTIH, ENUT, ENCO, ENCIG, ENAPE, ENASEM, ENVE…) | Microdatos por edición | PENDIENTE | — |
| Encuestas económicas (EMEC, EMIM, EMS, ENEC, EMOE…) | Series y microdatos | PENDIENTE (series en el Banco de Indicadores) | — |
| Registros administrativos (natalidad, mortalidad, nupcialidad, vehículos, finanzas públicas, transporte, seguridad y justicia) | Microdatos anuales | PENDIENTE | — |
| Censos Nacionales de Gobierno | Tabulados y microdatos | PENDIENTE | — |
| Inventario Nacional de Viviendas | Datos por manzana | PENDIENTE | — |
| BIE (Banco de Información Económica) | Integrado al Banco de Indicadores; su API responde «sin resultados» y su página 500 (2026-09-19) | CUBIERTO POR BISE | 851 indicadores de precios, además de PIB, IGAE y empleo en BISE |

Orden propuesto tras el DENUE: Censo 2020 (ITER + AGEB/manzana) → Censos
Económicos → registros administrativos → encuestas en hogares (microdatos a
R2 como la ENOE) → Censo Agropecuario → Censos de Gobierno → Inventario de
Viviendas. Cada uno con su resumen verificable y su entrada en el catálogo.

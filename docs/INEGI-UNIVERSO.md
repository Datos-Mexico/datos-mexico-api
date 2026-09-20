# Universo INEGI — auditoría real (2026-09-20) y CIERRE: todo lo descargable del INEGI está en el observatorio (2026-09-20 08:03 UTC)

Fuente: la API interna de «Descarga masiva» del INEGI (la misma que usa https://www.inegi.org.mx/app/descarga/), recorrida programa por programa y carpeta por carpeta el 2026-09-20 (`scripts/inegi_inventario_masivo.py`, `data/inegi-universo/archivos.csv`). Complementa al árbol oficial de datos abiertos (`arbol.json`: 214 programas, 427 programa-edición) y a los totales de la propia API: DENUE 486 archivos, Indicadores 392, Inventario Nacional de Viviendas 3, Microdatos 4,936, Tabulados 15,394, Sala de prensa 71.

## Estado al cierre (verificado en producción, `/api/v1/inegi/datos-abiertos/resumen`)

| Qué | Universo (inventario INEGI) | En el observatorio | Cobertura |
|---|---|---|---|
| Microdatos: programas | 103 con archivos de datos (139 en el listado; 36 solo traen documentos) | 103 | 100 % |
| Microdatos: archivos | 4,259 | 4,259 (44,185 tablas Parquet incluidos los catálogos de códigos, 767,179,090 filas, 12.0 GB) | 100 % |
| Originales del INEGI conservados (zip con SHA-256) | 4,259 | 4,259 (18.7 GB) | 100 % |
| Tabulados: programas | 183 | 183 | 100 % |
| Tabulados: archivos | 18,150 | 18,150 (14.5 GB, íntegros, con ETag) | 100 % |
| Banco de Indicadores | 31,817 indicadores | 31,817 (7,456,265 observaciones) | 100 % |
| DENUE | 6,138,075 unidades | 6,138,075 | 100 % |

Verificación: cada tabla Parquet tiene filas = filas leídas del original; el catálogo en D1 coincide con los manifiestos (44,185 tablas, 18,150 tabulados); el almacén está conciliado contra los manifiestos (66,594 objetos bajo `inegi/` = 66,594 referenciados, sin faltantes ni huérfanos, todos con el tamaño registrado); muestra de 8 tablas al azar comprobada byte a byte entre R2 y la descarga por la API con conteo de filas; descargas de tabulados iguales al tamaño registrado. Almacén R2 total: 50.8 GB (79,793 objetos, incluidas las particiones de la ENOE).

Enunciado público sostenible: «Tenemos todo lo que el INEGI pone a descarga: los microdatos de sus 103 programas con datos (4,259 archivos, con sus catálogos de códigos), los 18,150 tabulados de 183 programas, el Banco de Indicadores completo y el DENUE completo, con cada original conservado y verificado.» Única excepción documentada: 13 archivos .dbf del CNGSPSPE 2017 que el INEGI publica ilegibles (cabecera nula); el original íntegro está archivado. Fuera de la frase: microdatos confidenciales (no se publican), sistemas solo interactivos y productos geográficos completos.

## Cifras del universo (inventario)

| Clasificación | Programas | Archivos lógicos | Tamaño (todos los formatos) | En CSV |
|---|---|---|---|---|
| Microdatos | 139 | 4,781 | 49.2 GB | 756 archivos, 6.32 GB (66 programas; los otros 73 solo en DBF/DTA/SAV) |
| Tabulados | 183 | 14,178 | 13.6 GB | casi todo Excel (14,002 archivos) |
| DENUE | 1 | 486 | (32 zips CSV por estado + otros formatos) | CARGADO completo |
| Banco de Indicadores | 1 | 392 | (descargas por tema; la API cubre el 100 %) | CARGADO completo, tres niveles |

## Qué tenemos ya (verificable en la API)

| Producto | Estado | Medida |
|---|---|---|
| Banco de Indicadores (todas las series del INEGI, incluye lo que era el BIE) | CARGADO | 31,817 indicadores, 7,456,265 observaciones, nacional/estatal/municipal |
| DENUE (negocios) | CARGADO | 6,138,075 unidades económicas, edición 05/2026 |
| Censo 2020: resultados por localidad (ITER) y por AGEB/manzana | CARGADO | 195,662 filas × 286 indicadores; 1,683,504 manzanas |
| ENOE 15+ | CARGADO | 101,512,667 filas de microdatos (2005T1-2025T1) + 13 indicadores |
| ENIGH 2024 | CARGADO | 91,414 hogares, 17 tablas, 111 catálogos |

## Qué falta y cuánto cuesta

- **Microdatos de 139 programas (4,781 archivos)**: ya tenemos ENOE completa, ENIGH 2024 y parte del Censo 2020. Faltan 136 programas: encuestas en hogares (ENVIPE, ENDUTIH, ENADID, ENSU, ENCIG, ENDIREH, ENUT, ENIF…), censos de gobierno (17 programas, decenas de ediciones), registros vitales (nacimientos, defunciones, matrimonios, divorcios), Censo Agropecuario, Intercensal 2015, Censo 2010/2000, ediciones anteriores de ENIGH. Tamaño total comprimido ≈ 6.3 GB en CSV más ≈ 10 GB en DBF/DTA/SAV (programas sin CSV). Mecanismo: ingestor genérico «datos abiertos INEGI» (zip → Parquet con tipos del diccionario → R2 con manifiesto y verificación de conteos → catálogo y endpoints de consulta), como ya se hizo con AGEB/manzana. Ritmo medido: 1-2 min por archivo con 6 en paralelo. **Estimación: 3-5 días de proceso automático continuo más 1-2 días de revisión de excepciones** (diccionarios en formatos distintos, codificaciones, archivos partidos).
- **Tabulados (14,178 archivos Excel, 13.6 GB)**: son cuadros de presentación con diseños heterogéneos; no se pueden convertir a tablas de base de datos con rigor de forma automática. Propuesta honesta: archivarlos íntegros en R2 con índice (programa, edición, título, formato, tamaño) y consulta por catálogo; las series numéricas ya están en el Banco de Indicadores. **Estimación: 1-2 días**.
- **Geografía** (Marco Geoestadístico, Mapa Digital, Inventario Nacional de Viviendas): fuera de este sistema salvo el INV (3 archivos); el Marco ya se usa para mapas y catálogo de municipios.

## Nota sobre los Censos Económicos

Sus microdatos por establecimiento son confidenciales: lo que la descarga masiva ofrece como «microdatos» son ejemplos con valores alterados (0.01 GB). Lo público son (a) los resultados definitivos en datos abiertos (`tr_ce_nac_2024.csv`: 7,370 filas × 107 variables por sector, subsector, rama, clase y estrato, más catálogos y diccionario; ediciones 2019 y 2014 equivalentes) y (b) 2,044 tabulados Excel (2.1 GB). El observatorio carga (a) como base consultable y archiva (b).

## Enunciado público sostenible hoy

«Tenemos completos el Banco de Indicadores del INEGI (todas sus series, a tres niveles geográficos), el DENUE, la ENOE y el Censo 2020 por localidad y manzana.» «Todo el INEGI» (todos los microdatos y todos los tabulados de descarga masiva) es alcanzable con el ingestor genérico en 1-2 semanas de trabajo continuo; el avance se medirá contra este inventario (archivos cargados / archivos del universo).

## Orden propuesto

1. Censos Económicos (microdatos agregados 2004-2024 y tabulados nacionales). 2. Registros vitales (nacimientos, defunciones, matrimonios, divorcios: series largas, alto valor social). 3. Encuestas en hogares por tamaño y uso (ENVIPE, ENSU, ENDUTIH, ENADID, ENCIG, ENDIREH, ENUT, ENIF, ENSANUT). 4. Censos de gobierno. 5. Censo 2020 muestra, Intercensal 2015, Censo 2010/2000. 6. Ediciones anteriores de ENIGH y resto. 7. Tabulados archivados e indexados.

## Programas con microdatos (universo)

- Censos y Conteos de Población y Vivienda — 1727 archivos, 13.61 GB, ediciones 6 — CARGADO
- Encuesta Nacional de Ocupación y Empleo (ENOE), población de 15 años y más de edad — 359 archivos, 11.71 GB, ediciones 29 — CARGADO
- Encuesta Intercensal — 131 archivos, 5.60 GB, ediciones 1 — CARGADO
- Encuesta Nacional de Ocupación y Empleo (ENOE), población de 14 años y más de edad — 25 archivos, 2.37 GB, ediciones 12 — CARGADO
- Encuesta Nacional de Ingresos y Gastos de los Hogares (ENIGH) — 304 archivos, 1.87 GB, ediciones 5 — CARGADO
- Estadística de Nacimientos Registrados (ENR) — 40 archivos, 1.39 GB, ediciones 40 — CARGADO
- Encuesta Nacional de Gastos de los Hogares (ENGASTO) — 46 archivos, 1.12 GB, ediciones 2 — CARGADO
- Encuesta Nacional sobre la Dinámica de las Relaciones en los Hogares (ENDIREH) — 40 archivos, 1.08 GB, ediciones 5 — CARGADO
- Encuesta Nacional de Victimización y Percepción sobre Seguridad Pública (ENVIPE) — 58 archivos, 0.82 GB, ediciones 16 — CARGADO
- Encuesta Nacional de Calidad e Impacto Gubernamental (ENCIG) — 28 archivos, 0.56 GB, ediciones 8 — CARGADO
- Mortalidad — 19 archivos, 0.56 GB, ediciones 10 — CARGADO
- Encuesta Nacional de Empleo Urbano (ENEU) — 20 archivos, 0.55 GB, ediciones 20 — CARGADO
- Estadísticas de Defunciones Registradas (EDR) — 11 archivos, 0.53 GB, ediciones 11 — CARGADO
- Tradicional — 244 archivos, 0.48 GB, ediciones 15 — CARGADO
- Encuesta Nacional de Seguridad Pública Urbana (ENSU) — 52 archivos, 0.45 GB, ediciones 14 — CARGADO
- Encuesta Nacional de Empleo (ENE) — 13 archivos, 0.41 GB, ediciones 11 — CARGADO
- Penal — 558 archivos, 0.37 GB, ediciones 8 — CARGADO
- Nueva construcción — 208 archivos, 0.35 GB, ediciones 4 — CARGADO
- Encuesta Nacional de la Dinámica Demográfica (ENADID) — 20 archivos, 0.34 GB, ediciones 7 — CARGADO
- Nupcialidad — 19 archivos, 0.32 GB, ediciones 11 — CARGADO
- Relaciones Laborales de Jurisdicción Local — 11 archivos, 0.31 GB, ediciones 11 — CARGADO
- Encuesta Nacional de Ingresos y Gastos de los Hogares Estacional (ENIGH-A) — 204 archivos, 0.30 GB, ediciones 2 — CARGADO
- Módulo de Condiciones Socioeconómicas de la ENIGH (MCS-ENIGH) — 137 archivos, 0.30 GB, ediciones 4 — CARGADO
- Censo Nacional de Gobiernos Municipales y Demarcaciones Territoriales de la Ciudad de México — 219 archivos, 0.28 GB, ediciones 6 — CARGADO
- Características de las Localidades y del Entorno Urbano — 195 archivos, 0.21 GB, ediciones 1 — CARGADO
- Estadística de Matrimonios (EMAT) — 11 archivos, 0.20 GB, ediciones 11 — CARGADO
- Encuesta Demográfica Retrospectiva (EDER) — 14 archivos, 0.19 GB, ediciones 3 — CARGADO
- Encuesta Nacional de Población Privada de la Libertad (ENPOL) — 8 archivos, 0.19 GB, ediciones 2 — CARGADO
- Módulo de Trabajo Infantil (MTI) — 15 archivos, 0.16 GB, ediciones 6 — CARGADO
- Encuesta Nacional de Acceso a la Información Pública y Protección de Datos Personales (ENAID) — 4 archivos, 0.15 GB, ediciones 2 — CARGADO
- Estadística de Divorcios (ED) — 12 archivos, 0.14 GB, ediciones 12 — CARGADO
- Censo Nacional de Impartición de Justicia Estatal — 367 archivos, 0.13 GB, ediciones 9 — CARGADO
- Judiciales en Materia Penal — 16 archivos, 0.12 GB, ediciones 16 — CARGADO
- Encuesta Nacional sobre Disponibilidad y Uso de Tecnologías de la Información en los Hogares (ENDUTIH) — 22 archivos, 0.12 GB, ediciones 11 — CARGADO
- Censo Nacional de Gobierno, Seguridad Pública y Sistema Penitenciario Estatales — 361 archivos, 0.11 GB, ediciones 9 — CARGADO
- Encuesta Nacional de Empleo y Seguridad Social (ENESS) — 18 archivos, 0.11 GB, ediciones 6 — CARGADO
- Encuesta Nacional sobre Discriminación (ENADIS) — 10 archivos, 0.11 GB, ediciones 2 — CARGADO
- Encuesta Nacional de Salud y Nutrición (ENSANUT) — 11 archivos, 0.10 GB, ediciones 1 — CARGADO
- Módulo de Condiciones Socioeconómicas — 40 archivos, 0.10 GB, ediciones 1 — CARGADO
- Censo Nacional de Procuración de Justicia Estatal — 272 archivos, 0.09 GB, ediciones 9 — CARGADO
- Accidentes de Tránsito Terrestre en Zonas Urbanas y Suburbanas — 31 archivos, 0.09 GB, ediciones 29 — CARGADO
- Encuesta Nacional de Micronegocios (ENAMIN) — 17 archivos, 0.09 GB, ediciones 8 — CARGADO
- Encuesta Nacional de los Hogares (ENH) — 48 archivos, 0.08 GB, ediciones 4 — CARGADO
- Estadísticas de Defunciones Fetales (EDF) — 13 archivos, 0.08 GB, ediciones 13 — CARGADO
- ENASEM Tradicional — 13 archivos, 0.07 GB, ediciones 3 — CARGADO
- Módulo sobre Ciberacoso (MOCIBA) — 48 archivos, 0.06 GB, ediciones 10 — CARGADO
- Encuesta Nacional sobre Confianza del Consumidor (ENCO) — 44 archivos, 0.05 GB, ediciones 17 — CARGADO
- Módulo sobre Disponibilidad y Uso de Tecnologías de la Información en los Hogares (MODUTIH) — 26 archivos, 0.05 GB, ediciones 13 — CARGADO
- Museos — 6 archivos, 0.05 GB, ediciones 6 — CARGADO
- Módulo de Educación, Capacitación y Empleo (MECE) — 14 archivos, 0.05 GB, ediciones 7 — CARGADO
- Módulo de Bienestar Autorreportado (BIARE) — 23 archivos, 0.04 GB, ediciones 15 — CARGADO
- Encuesta Nacional sobre Uso del Tiempo (ENUT) — 12 archivos, 0.04 GB, ediciones 5 — CARGADO
- Censo Nacional de Procuración de Justicia Federal — 136 archivos, 0.03 GB, ediciones 6 — CARGADO
- Censo Nacional de Impartición de Justicia Federal — 131 archivos, 0.03 GB, ediciones 7 — CARGADO
- Encuesta Nacional de Trabajo Infantil (ENTI) — 4 archivos, 0.03 GB, ediciones 2 — CARGADO
- Encuesta Nacional sobre Consumo de Energéticos en Viviendas Particulares (ENCEVI) — 5 archivos, 0.02 GB, ediciones 1 — CARGADO
- Encuesta Continua sobre la Percepción de la Seguridad Pública (ECOSEP) — 6 archivos, 0.02 GB, ediciones 6 — CARGADO
- Censo Nacional de Transparencia, Acceso a la Información Pública y Protección de Datos Personales Estatal — 104 archivos, 0.02 GB, ediciones 3 — CARGADO
- Encuesta de Cohesión Social para la Prevención de la Violencia y la Delincuencia (ECOPRED) — 2 archivos, 0.02 GB, ediciones 1 — CARGADO
- Encuesta Nacional sobre Inseguridad (ENSI) — 6 archivos, 0.02 GB, ediciones 3 — CARGADO
- Indicadores Laborales para los Municipios de México (ILMM) — 9 archivos, 0.02 GB, ediciones 9 — CARGADO
- Censo Nacional de Transparencia, Acceso a la Información Pública y Protección de Datos Personales Federal — 105 archivos, 0.02 GB, ediciones 3 — CARGADO
- Encuesta Nacional de Inserción Laboral de los Egresados de la Educación Media Superior (ENILEMS) — 6 archivos, 0.02 GB, ediciones 3 — CARGADO
- Encuesta Origen Destino en Hogares de la Zona Metropolitana del Valle de México (EOD) — 2 archivos, 0.02 GB, ediciones 1 — CARGADO
- Encuesta sobre la Percepción Pública de la Ciencia y la Tecnología (ENPECYT) — 14 archivos, 0.01 GB, ediciones 7 — CARGADO
- Encuesta Nacional de Inclusión Financiera (ENIF) — 16 archivos, 0.01 GB, ediciones 6 — CARGADO
- Salud en Establecimientos Particulares — 8 archivos, 0.01 GB, ediciones 8 — CARGADO
- Encuesta Nacional de Bienestar Autorreportado (ENBIARE) — 5 archivos, 0.01 GB, ediciones 2 — CARGADO
- Módulo de Movilidad Social Intergeneracional (MMSI) — 5 archivos, 0.01 GB, ediciones 1 — CARGADO
- Centros de Justicia para las Mujeres (CJM) — 6 archivos, 0.01 GB, ediciones 3 — CARGADO
- Censo Nacional de Derechos Humanos Estatal — 61 archivos, 0.01 GB, ediciones 3 — CARGADO
- Encuesta Nacional sobre Prácticas de Lectura — 3 archivos, 0.01 GB, ediciones 1 — CARGADO
- Encuesta sobre el Seguro Médico para una Nueva Generación (ESMNG) — 2 archivos, 0.01 GB, ediciones 1 — CARGADO
- Encuesta Nacional de Gobierno - Seguridad Pública y Justicia Municipal (ENGSPJM) — 15 archivos, 0.01 GB, ediciones 1 — CARGADO
- Censo Nacional de Poderes Legislativos Estatales — 52 archivos, 0.01 GB, ediciones 2 — CARGADO
- Encuesta Nacional sobre las Finanzas de los Hogares (ENFIH) — 5 archivos, 0.01 GB, ediciones 1 — CARGADO
- Censos Económicos (CE) — 27 archivos, 0.01 GB, ediciones 7 — CARGADO
- Módulo sobre Eventos Culturales Seleccionados (MODECULT) — 44 archivos, 0.01 GB, ediciones 11 — CARGADO
- Encuesta Nacional de Vivienda (ENVI) — 4 archivos, 0.01 GB, ediciones 2 — CARGADO
- Censo Nacional de Sistema Penitenciario Federal — 36 archivos, 0.01 GB, ediciones 2 — CARGADO
- Censo Nacional de Derechos Humanos Federal — 61 archivos, 0.01 GB, ediciones 2 — CARGADO
- Censo de Alojamientos de Asistencia Social — 1 archivos, 0.01 GB, ediciones 1 — CARGADO
- Módulo sobre Migración — 2 archivos, 0.01 GB, ediciones 1 — CARGADO
- Encuesta Nacional de Cultura Cívica (ENCUCI) — 2 archivos, 0.01 GB, ediciones 1 — CARGADO
- Censo Nacional de Gobierno Federal — 28 archivos, 0.01 GB, ediciones 3 — CARGADO
- Encuesta Nacional sobre Diversidad Sexual y de Género (ENDISEG) — 3 archivos, 0.01 GB, ediciones 1 — CARGADO
- Encuesta Nacional sobre Salud Financiera (ENSAFI) 2023 — 2 archivos, 0.01 GB, ediciones 1 — CARGADO
- Encuesta Nacional de Consumo Cultural de México (ENCCUM) — 2 archivos, 0.00 GB, ediciones 1 — CARGADO
- Módulo sobre Lectura (MOLEC) — 34 archivos, 0.00 GB, ediciones 13 — CARGADO
- Módulo de Práctica Deportiva y Ejercicio Físico (MOPRADEF) — 64 archivos, 0.00 GB, ediciones 30 — CARGADO
- Encuesta Nacional de Confianza en la Administración Pública (ENCOAP) — 12 archivos, 0.00 GB, ediciones 2 — CARGADO
- Encuesta Laboral y de Corresponsabilidad Social (ELCOS) — 2 archivos, 0.00 GB, ediciones 1 — CARGADO
- Censo Nacional de Seguridad Pública Federal — 23 archivos, 0.00 GB, ediciones 2 — CARGADO
- Encuesta Nacional de Gobierno, Poder Ejecutivo Estatal — 12 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta Nacional para el Sistema de Cuidados (ENASIC) — 3 archivos, 0.00 GB, ediciones 1 — CARGADO
- Módulo de Hogares y Medio Ambiente (MOHOMA) — 1 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta sobre Violencia Intrafamiliar (ENVIF) — 2 archivos, 0.00 GB, ediciones 1 — CARGADO
- Módulo de Trayectorias Laborales (MOTRAL) — 4 archivos, 0.00 GB, ediciones 2 — CARGADO
- Encuesta Nacional sobre Violencia en el Noviazgo (ENVIN) — 2 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta Nacional de Adicciones — 2 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta sobre la Penetración de Televisión Abierta en los Hogares (ENPETAH) — 4 archivos, 0.00 GB, ediciones 1 — CARGADO
- Organismos Públicos de Derechos Humanos — 47 archivos, 0.00 GB, ediciones 3 — CARGADO
- Encuesta Nacional sobre Acceso y Permanencia en la Educación (ENAPE) — 2 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta para Caracterizar a la población en situación de Desplazamiento Forzado Interno en el Estado de Chihuahua (ECADEFI - CHIH) 2021 — 6 archivos, 0.00 GB, ediciones 1 — CARGADO
- Programa de la Industria Manufacturera, Maquiladora y de Servicios de Exportación (IMMEX) — 6 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta Nacional de Empleo, Salarios, Tecnología y Capacitación en el Sector Manufacturero (ENESTyC) — 75 archivos, 0.00 GB, ediciones 5 — CARGADO
- Encuesta de Evaluación Cognitiva 2021 — 3 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta Sobre Investigación y Desarrollo Tecnológico (ESIDET) — 23 archivos, 0.00 GB, ediciones 6 — CARGADO
- Encuesta Nacional de Victimización de Empresas (ENVE) — 12 archivos, 0.00 GB, ediciones 4 — CARGADO
- Encuesta Nacional de Estándares y Capacitación Profesional Policial (ENECAP) — 4 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta Nacional de Adolescentes en el Sistema de Justicia Penal (ENASJUP) — 6 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta sobre Tecnologías de Información y las Comunicaciones (ENTIC) — 7 archivos, 0.00 GB, ediciones 2 — CARGADO
- Encuesta Nacional de Financiamiento de las Empresas (ENAFIN) — 9 archivos, 0.00 GB, ediciones 3 — CARGADO
- Encuesta Nacional sobre Productividad y Competitividad de las Micro, Pequeñas y Medianas Empresas  (ENAPROCE) — 14 archivos, 0.00 GB, ediciones 2 — CARGADO
- Encuesta de Comercio Internacional de Servicios (ECIS) — 1 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta Mensual de Servicios (EMS) — 6 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta Nacional de Calidad Regulatoria e Impacto Gubernamental en Empresas (ENCRIGE) — 3 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta sobre el Impacto Económico Generado por COVID-19 en las Empresas (ECOVID-IE) — 12 archivos, 0.00 GB, ediciones 3 — CARGADO
- Encuesta Mensual sobre Empresas Comerciales (EMEC) — 3 archivos, 0.00 GB, ediciones 1 — CARGADO
- Relaciones Laborales de Jurisdicción Local prueba — 5 archivos, 0.00 GB, ediciones 2 — CARGADO
- Actualización del Marco Censal Agropecuario — 4 archivos, 0.00 GB, ediciones 1 — CARGADO
- Balanza Comercial de Mercancías de México — 1 archivos, 0.00 GB, ediciones 1 — CARGADO
- Censo Agrícola, Ganadero y Forestal — 12 archivos, 0.00 GB, ediciones 3 — CARGADO
- Encuesta Industrial Anual (EIA) — 6 archivos, 0.00 GB, ediciones 2 — CARGADO
- Encuesta Mensual de la Industria Manufacturera (EMIM) — 9 archivos, 0.00 GB, ediciones 2 — CARGADO
- Encuesta Nacional Agropecuaria — 16 archivos, 0.00 GB, ediciones 4 — CARGADO
- Encuesta Anual de la Industria Manufacturera (EAIM) — 7 archivos, 0.00 GB, ediciones 2 — CARGADO
- Encuesta Anual de Servicios Privados no Financieros (EASPNF) — 3 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta Anual de Transportes (EAT) — 1 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta Nacional de Agencias Funerarias ante COVID-19 (ENAF) 2020 — 4 archivos, 0.00 GB, ediciones 1 — CARGADO
- Industria Maquiladora de Exportación — 1 archivos, 0.00 GB, ediciones 1 — CARGADO
- Censo Ejidal — 12 archivos, 0.00 GB, ediciones 3 — CARGADO
- Encuesta Anual de Comercio (EAC) — 3 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta de Turismo de Internación (ETI) — 6 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta de Viajeros Fronterizos (EVF) — 3 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta Industrial Mensual (EIM) — 1 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta Industrial Mensual Ampliada (EIMA) — 1 archivos, 0.00 GB, ediciones 1 — CARGADO
- Encuesta Mensual de Opinión Empresarial (EMOE) — 3 archivos, 0.00 GB, ediciones 1 — CARGADO
- Perfil de las Empresas Manufactureras de Exportación — 6 archivos, 0.00 GB, ediciones 1 — CARGADO

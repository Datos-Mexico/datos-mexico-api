# Universo ANUIES: qué es «todo el anuario» y cuánto tenemos

Fuente: ANUIES, Anuario Estadístico de Educación Superior, consulta interactiva en https://anuario.anuies.mx/ (ciclos 2000-2001 a 2025-2026, los 26 que el sitio ofrece al 2026-09-20).

**Unidad:** un programa (carrera) en una escuela/campus de una institución, por ciclo, nivel y modalidad, con 14 dimensiones y 167 cifras (matrícula, nuevo ingreso, egresados, lugares ofertados, titulados y solicitudes por sexo; matrícula y nuevo ingreso por 16 grupos de edad y sexo; con discapacidad; hablantes de lengua indígena; procedencia del nuevo ingreso por 32 entidades y 8 regiones del extranjero). Todas las instituciones del país.

**Descarga:** `scripts/anuies_consulta.py`, POST `action=consulta` paginado (1,000 filas por página con todas las desagregaciones), 965 páginas, 3.3 GB de JSON crudo conservado en `data/anuies/consulta/` con SHA-256 por ciclo. Cuatro descargas en paralelo como máximo (el servidor de ANUIES rinde 27 % más con cuatro que con dos: el freno es suyo, no nuestro). Tiempo medio por página: 29.6 s; 11:50 a 14:23 del 2026-09-20.

**Verificación:** por cada ciclo, la suma de las filas detalladas en las 6 variables coincide con el agregado nacional que el mismo servicio devuelve sin dimensiones (26/26 COINCIDE). La serie histórica de la UNAM pedida por otra vía del servicio (`action=historico`) coincide fila por fila y en matrícula con la descarga íntegra. DataMéxico (Secretaría de Economía, datos ANUIES) coincide exacto en matrícula y egresados de la UNAM para sus cinco años (2018-2022 = ciclos 2017-2018 a 2021-2022).

**Lo que se puede afirmar:** el observatorio tiene el Anuario ANUIES completo, 953,653 programas-ciclo en 26 ciclos, con todas sus cifras, verificado ciclo por ciclo contra el total nacional de la propia ANUIES, servido en `/api/v1/anuies/*` y descargable en Parquet por ciclo.

**Términos:** anuario.anuies.mx declara «© ANUIES — Todos los derechos reservados» sin licencia abierta; se cita la fuente en cada endpoint y en el catálogo. La decisión de uso es del CEO.

| Ciclo | Filas | Matrícula nacional | Nuevo ingreso | Egresados | Titulados | Conciliación |
|---|---|---|---|---|---|---|
| 2000-2001 | 14,320 | 2,197,702 | 596,885 | 322,064 | 189,977 | COINCIDE |
| 2001-2002 | 14,731 | 2,288,370 | 616,486 | 336,223 | 189,402 | COINCIDE |
| 2002-2003 | 16,947 | 2,391,258 | 645,159 | 366,705 | 211,959 | COINCIDE |
| 2003-2004 | 17,944 | 2,476,603 | 661,423 | 363,994 | 228,918 | COINCIDE |
| 2004-2005 | 19,120 | 2,538,256 | 672,091 | 404,148 | 262,587 | COINCIDE |
| 2005-2006 | 20,261 | 2,613,466 | 699,258 | 414,490 | 264,853 | COINCIDE |
| 2006-2007 | 22,259 | 2,709,255 | 733,466 | 447,370 | 293,485 | COINCIDE |
| 2007-2008 | 22,992 | 2,814,871 | 770,886 | 453,977 | 312,289 | COINCIDE |
| 2008-2009 | 24,673 | 2,931,053 | 809,159 | 457,424 | 317,637 | COINCIDE |
| 2009-2010 | 27,484 | 3,107,713 | 876,472 | 494,902 | 351,109 | COINCIDE |
| 2010-2011 | 29,972 | 3,322,698 | 963,100 | 515,669 | 380,784 | COINCIDE |
| 2011-2012 | 32,137 | 3,550,920 | 1,023,514 | 555,761 | 399,057 | COINCIDE |
| 2012-2013 | 34,472 | 3,732,653 | 1,055,167 | 594,601 | 426,067 | COINCIDE |
| 2013-2014 | 35,776 | 3,882,625 | 1,041,912 | 638,644 | 458,250 | COINCIDE |
| 2014-2015 | 36,953 | 4,032,992 | 1,099,503 | 674,634 | 483,257 | COINCIDE |
| 2015-2016 | 39,196 | 4,244,401 | 1,178,924 | 715,401 | 514,445 | COINCIDE |
| 2016-2017 | 42,723 | 4,430,248 | 1,221,739 | 747,942 | 545,330 | COINCIDE |
| 2017-2018 | 46,428 | 4,561,792 | 1,248,474 | 784,031 | 576,056 | COINCIDE |
| 2018-2019 | 43,739 | 4,705,400 | 1,343,962 | 791,966 | 600,017 | COINCIDE |
| 2019-2020 | 48,110 | 4,931,200 | 1,409,386 | 826,817 | 612,814 | COINCIDE |
| 2020-2021 | 53,489 | 4,983,204 | 1,291,677 | 855,731 | 525,593 | COINCIDE |
| 2021-2022 | 54,950 | 5,068,493 | 1,357,872 | 892,836 | 569,063 | COINCIDE |
| 2022-2023 | 57,336 | 5,192,618 | 1,436,015 | 943,323 | 699,282 | COINCIDE |
| 2023-2024 | 60,827 | 5,393,078 | 1,437,157 | 982,072 | 793,387 | COINCIDE |
| 2024-2025 | 67,006 | 5,519,791 | 1,475,911 | 1,009,855 | 791,224 | COINCIDE |
| 2025-2026 | 69,808 | 5,760,478 | 1,598,180 | 1,064,302 | 812,033 | COINCIDE |

Total: 953,653 filas · 26/26 conciliados.

Refresco: cada anuario nuevo (ANUIES publica el ciclo N-(N+1) durante el año N+1) se baja con `python3 scripts/anuies_consulta.py <ciclo>`, se carga con `anuies_d1.py` y `anuies_parquet_r2.py`, y el sitio se regenera con `scripts/build-unam-anuario.ts`.

# Resumen de paridad — api.datosmexico.org (Cloudflare) contra api.datos-itam.org (legacy)

Generado: 2026-09-20 08:05 UTC. Cada fila enlaza el reporte detallado. «Datos»: misma respuesta JSON petición a petición (números con tolerancia relativa 1e-9, códigos HTTP y mensajes de error incluidos). «Docs»: mismo summary, description, operationId, tags, parámetros y forma de la respuesta 200 en el OpenAPI. «Fidelidad»: la base D1 reproduce la de Neon tabla por tabla (conteos, sumas, rangos de fecha, distintos).

| Bloque | Datos | Docs | Fidelidad D1 |
|---|---|---|---|
| CONSAR | [132/132 rutas idénticas.](consar-datos.md) | [34/34 rutas con documentación equivalente.](consar-docs.md) | [22/22 tablas con fidelidad verificada Neon ≡ D1.](consar-fidelidad-datos.md) |
| ENIGH | [24/24 rutas idénticas.](enigh-datos.md) | [10/10 rutas con documentación equivalente.](enigh-docs.md) | [4/4 tablas con fidelidad verificada por valores (sumas, rangos de fecha, distintos).](enigh-fidelidad-datos.md) |
| COMPARATIVO | [7/7 rutas idénticas.](comparativo-datos.md) | [7/7 rutas con documentación equivalente.](comparativo-docs.md) | — |
| CDMX servidores | [49/55 rutas idénticas.](cdmx-datos.md) | [3/3 rutas con documentación equivalente.](cdmx-servidores-docs.md) | [10/10 tablas con fidelidad verificada por valores (sumas, rangos de fecha, distintos).](cdmx-fidelidad-datos.md) |
| CDMX sectores | (ver CDMX servidores) | [3/3 rutas con documentación equivalente.](cdmx-sectores-docs.md) | — |
| CDMX catálogos | (ver CDMX servidores) | [8/8 rutas con documentación equivalente.](cdmx-catalogos-docs.md) | — |
| CDMX dashboard | (ver CDMX servidores) | [1/1 rutas con documentación equivalente.](cdmx-dashboard-docs.md) | — |
| CDMX analytics | (ver CDMX servidores) | [3/3 rutas con documentación equivalente.](cdmx-analytics-docs.md) | — |
| CDMX personas | (ver CDMX servidores) | [2/2 rutas con documentación equivalente.](cdmx-personas-docs.md) | — |
| CDMX nombramientos | (ver CDMX servidores) | [2/2 rutas con documentación equivalente.](cdmx-nombramientos-docs.md) | — |
| CDMX export | (ver CDMX servidores) | [1/1 rutas con documentación equivalente.](cdmx-export-docs.md) | — |
| ENOE | [41/41 rutas idénticas.](enoe-datos.md) | [17/17 rutas con documentación equivalente.](enoe-docs.md) | [11/11 tablas con fidelidad verificada por valores (sumas, rangos de fecha, distintos).](enoe-fidelidad-datos.md) |
| ENOE microdatos | [21/21 rutas idénticas (ignorando `tiempo_query_ms`, que es una medición).](enoe-microdatos-datos.md) | (incluidas en ENOE) | Parquet por trimestre en R2 con conteo verificado contra Neon (`data/enoe/microdatos/manifiesto.jsonl`). |
| INEGI Banco de Indicadores | Sin contraparte en el legacy (endpoints nuevos). Verificación en producción contra los archivos de origen: resumen exacto (31,817 indicadores / 31,039 con datos / 7,456,265 observaciones en tres niveles geográficos) y 8 series completas idénticas observación por observación, 3 de ellas municipales. | Documentación propia (tag `inegi`). | 9/9 tablas con conteos iguales al origen; suma de `n_observaciones` = filas de `observaciones`. |
| INEGI DENUE | Sin contraparte en el legacy. Verificación en producción contra los CSV de descarga masiva: resumen exacto (6,138,075 unidades, 989 actividades), 5 fichas con 42 campos idénticos, totales por estado, código postal y prefijo SCIAN iguales al CSV, cercanía a una coordenada con distancia 0 para la propia unidad. | Documentación propia (tag `denue`). | 4/4 tablas con conteos iguales al CSV. |
| INEGI Censo 2020 (ITER) | Sin contraparte en el legacy. Verificación en producción: 195,662 filas; población nacional = suma estatal = suma municipal = 126,014,024 (cifra oficial); 5 fichas con 286 campos idénticos; conteos por nivel iguales al CSV. | Documentación propia (tag `censo2020`). | 5/5 tablas con conteos iguales al CSV. AGEB/manzana: 32/32 Parquet en R2 verificados por la API de Cloudflare (1,683,504 filas). |
| Autenticación, demo y operación (escritura) | Contrato del legacy reproducido y probado en local y producción: 41 comprobaciones (tokens, 401/403/422, ciclo completo del demo). Los 9 CRUD del legacy sobre tablas oficiales y la carga CSV por API no se exponen por diseño. | [auth 3/3, demo 9/9, admin 1/1 rutas con documentación equivalente](../BITACORA.md) | `users` 2 (migrados), `demo_curso_bd` 12/12 = Neon. |
| Erratas (nuevo) | Registro público de observaciones sobre datos oficiales con autoría, revisión y edición aplicada; ciclo completo probado en producción. | Documentación propia (tag `erratas`). | — |
| INEGI datos abiertos (microdatos y tabulados de todos los programas) | Sin contraparte en el legacy. 4,259/4,259 archivos de microdatos (20,569 tablas, 762,522,995 filas) y 18,150/18,150 tabulados; catálogo = manifiestos; 8 tablas al azar iguales byte a byte entre R2 y la API con filas verificadas. | Documentación propia (tag `inegi-datos-abiertos`). | Cada tabla: filas Parquet = filas del original; originales con SHA-256 en R2. |

Notas:
- CDMX: 6 rutas difieren solo por el orden de filas empatadas en la llave de orden (el legacy no fija desempate); verificación por conjuntos en `cdmx-datos.md`.
- ENOE microdatos: consultan Neon vía Hyperdrive como puente temporal; el respaldo permanente son los Parquet en R2.
- INEGI: el propio INEGI repite 36,462 observaciones en 300 indicadores; se conserva la primera y las repeticiones quedan en `data/bise/duplicados.csv`.
- Los textos del legacy dicen cobertura CONSAR «hasta 2025-06»; los datos llegan a 2025-12 (hallazgo registrado en la bitácora).

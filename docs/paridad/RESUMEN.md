# Resumen de paridad — api.datosmexico.org (Cloudflare) contra api.datos-itam.org (legacy)

Generado: 2026-09-19 10:37 UTC. Cada fila enlaza el reporte detallado. «Datos»: misma respuesta JSON petición a petición (números con tolerancia relativa 1e-9, códigos HTTP y mensajes de error incluidos). «Docs»: mismo summary, description, operationId, tags, parámetros y forma de la respuesta 200 en el OpenAPI. «Fidelidad»: la base D1 reproduce la de Neon tabla por tabla (conteos, sumas, rangos de fecha, distintos).

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
| ENOE | [41/41 rutas idénticas.](enoe-datos.md) | [14/17 rutas con documentación equivalente.](enoe-docs.md) | [11/11 tablas con fidelidad verificada por valores (sumas, rangos de fecha, distintos).](enoe-fidelidad-datos.md) |

Notas:
- CDMX: 6 rutas difieren solo por el orden de filas empatadas en la llave de orden (el legacy no fija desempate); verificación por conjuntos en `cdmx-datos.md`.
- ENOE: 14/17 en docs porque los 3 endpoints de microdatos (54 GB) esperan la fase R2.
- Los textos del legacy dicen cobertura CONSAR «hasta 2025-06»; los datos llegan a 2025-12 (hallazgo registrado en la bitácora).

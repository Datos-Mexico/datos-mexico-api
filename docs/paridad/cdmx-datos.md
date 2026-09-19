# Paridad — docs/paridad/cdmx-rutas.txt

Fecha: 2026-09-19T10:18:32Z · legacy `https://api.datos-itam.org` · nuevo `https://datosmexico-api.davidfernando.workers.dev`

**49/55 rutas idénticas.**

- ✓ `/api/v1/servidores/` — HTTP 200, idéntico
- ✓ `/api/v1/servidores/?page=2&per_page=10` — HTTP 200, idéntico
- ✓ `/api/v1/servidores/?sector_id=8&sexo=FEMENINO&edad_min=30&edad_max=40&per_page=5` — HTTP 200, idéntico
- ✓ `/api/v1/servidores/?sueldo_min=50000&order_by=sueldo_bruto&order=desc&per_page=5` — HTTP 200, idéntico
- ✓ `/api/v1/servidores/?tipo_contratacion_id=1&tipo_personal_id=2&universo_id=3&per_page=5` — HTTP 200, idéntico
- ✓ `/api/v1/servidores/?order_by=fecha_ingreso&order=DESC&per_page=3` — HTTP 200, idéntico
- ✓ `/api/v1/servidores/?order_by=noexiste&per_page=3` — HTTP 200, idéntico
- ✓ `/api/v1/servidores/?page=0` — HTTP 422, idéntico
- ✓ `/api/v1/servidores/?per_page=500` — HTTP 422, idéntico
- ✓ `/api/v1/servidores/?sector_id=abc` — HTTP 422, idéntico
- ✓ `/api/v1/servidores/?sueldo_min=abc` — HTTP 422, idéntico
- ✓ `/api/v1/servidores/stats` — HTTP 200, idéntico
- ✓ `/api/v1/servidores/stats?sector_id=8` — HTTP 200, idéntico
- ✓ `/api/v1/servidores/stats?sexo=MASCULINO&edad_min=50` — HTTP 200, idéntico
- ✓ `/api/v1/servidores/stats?puesto_search=POLICIA` — HTTP 200, idéntico
- ✓ `/api/v1/servidores/stats?sector_id=99999` — HTTP 200, idéntico
- ✓ `/api/v1/servidores/1` — HTTP 200, idéntico
- ✓ `/api/v1/servidores/42` — HTTP 200, idéntico
- ✓ `/api/v1/servidores/99999999` — HTTP 404, idéntico
- ✓ `/api/v1/servidores/abc` — HTTP 422, idéntico
- ✓ `/api/v1/sectores/` — HTTP 200, idéntico
- ✗ `/api/v1/sectores/compare?a=1&b=2` — 8 diferencias: $.sector_a.top_puestos[9].puesto: 'SUPERVISOR ADMINISTRATIVO E' vs 'ADMINISTRATIVO TECNICO OPERACIONAL'; $.sector_a.top_puestos[9].sueldo_avg: 21300.0 vs 13623.583333333334; $.sector_b.top_puestos[7].puesto: 'SECRETARIO' vs 'COORDINADOR B'; $.sector_b.top_puestos[7].sueldo_avg: 109981.0 vs 46576; $.sector_b.top_puestos[8].puesto: 'COORDINADOR B' vs 'DIRECTOR EJECUTIVO B'; $.sector_b.top_puestos[8].sueldo_avg: 46576.0 vs 74482
- ✓ `/api/v1/sectores/compare?a=1&b=99999` — HTTP 404, idéntico
- ✓ `/api/v1/sectores/compare?a=1` — HTTP 422, idéntico
- ✗ `/api/v1/sectores/1/stats` — 2 diferencias: $.top_puestos[9].puesto: 'SUPERVISOR ADMINISTRATIVO E' vs 'ADMINISTRATIVO TECNICO OPERACIONAL'; $.top_puestos[9].sueldo_avg: 21300.0 vs 13623.583333333334
- ✓ `/api/v1/sectores/8/stats` — HTTP 200, idéntico
- ✓ `/api/v1/sectores/99999/stats` — HTTP 404, idéntico
- ✓ `/api/v1/sectores/x/stats` — HTTP 422, idéntico
- ✓ `/api/v1/catalogos/tipos-contratacion` — HTTP 200, idéntico
- ✓ `/api/v1/catalogos/tipos-personal` — HTTP 200, idéntico
- ✓ `/api/v1/catalogos/tipos-nomina` — HTTP 200, idéntico
- ✓ `/api/v1/catalogos/universos` — HTTP 200, idéntico
- ✓ `/api/v1/catalogos/sectores` — HTTP 200, idéntico
- ✓ `/api/v1/catalogos/sexos` — HTTP 200, idéntico
- ✓ `/api/v1/catalogos/niveles-salariales` — HTTP 200, idéntico
- ✓ `/api/v1/catalogos/puestos` — HTTP 200, idéntico
- ✓ `/api/v1/catalogos/puestos?search=POLICIA&per_page=10` — HTTP 200, idéntico
- ✗ `/api/v1/catalogos/puestos?page=3&per_page=25` — 4 diferencias: $.data[0].id: 1444 vs 49; $.data[0].nombre: 'RESPONSABLE TÉCNICO OPERATIVO D' vs 'ADMINISTRATIVO CESCALAFON DIGITAL'; $.data[1].id: 49 vs 1444; $.data[1].nombre: 'ADMINISTRATIVO CESCALAFON DIGITAL' vs 'RESPONSABLE TÉCNICO OPERATIVO D'
- ✓ `/api/v1/catalogos/puestos?page=0` — HTTP 422, idéntico
- ✗ `/api/v1/dashboard/stats` — 22 diferencias: $.allSectors[72].avgFemale: 10000.0 vs 11129; $.allSectors[72].avgMale: 0.0 vs 11129; $.allSectors[72].avgSalary: 10000.0 vs 11129; $.allSectors[72].name: 'SALUD' vs 'CONSEJO PARA PREVENIR Y ELIMINAR LA DISCRIMINACIÓN DE LA CIUDAD DE MÉXICO'; $.allSectors[73].avgFemale: 11129.0 vs 10000; $.allSectors[73].avgMale: 11129.0 vs 0
- ✗ `/api/v1/analytics/puestos/ranking` — 23 diferencias: $[1].count: 21 vs 16; $[1].gap_vs_next: 0.0 vs -5241; $[1].nombre: 'COORDINADOR GENERAL B' vs 'ALCALDE DE LA CDMX'; $[1].puesto_id: 555 vs 100; $[2].count: 8 vs 21; $[2].gap_vs_next: -5241.0 vs 0
- ✗ `/api/v1/analytics/puestos/ranking?limit=100` — 74 diferencias: $[1].count: 8 vs 16; $[1].gap_vs_next: 0.0 vs -5241; $[1].nombre: 'SUBSECRETARIO' vs 'ALCALDE DE LA CDMX'; $[1].puesto_id: 1576 vs 100; $[2].count: 16 vs 21; $[2].gap_vs_next: -5241.0 vs 0
- ✓ `/api/v1/analytics/puestos/ranking?limit=0` — HTTP 422, idéntico
- ✓ `/api/v1/analytics/sectores/ranking` — HTTP 200, idéntico
- ✓ `/api/v1/analytics/brecha-edad` — HTTP 200, idéntico
- ✓ `/api/v1/personas/` — HTTP 200, idéntico
- ✓ `/api/v1/personas/?nombre=MARIA&per_page=5` — HTTP 200, idéntico
- ✓ `/api/v1/personas/?sexo_id=2&page=2&per_page=5` — HTTP 200, idéntico
- ✓ `/api/v1/personas/1` — HTTP 200, idéntico
- ✓ `/api/v1/personas/99999999` — HTTP 404, idéntico
- ✓ `/api/v1/nombramientos/` — HTTP 200, idéntico
- ✓ `/api/v1/nombramientos/?persona_id=1` — HTTP 200, idéntico
- ✓ `/api/v1/nombramientos/?sector_id=8&per_page=5&page=3` — HTTP 200, idéntico
- ✓ `/api/v1/nombramientos/1` — HTTP 200, idéntico
- ✓ `/api/v1/nombramientos/99999999` — HTTP 404, idéntico
## Empates sin desempate en el legacy

Las rutas siguientes difieren SOLO por filas con llave de ordenamiento igual (el SQL del legacy no fija desempate y Postgres devuelve un orden arbitrario; el nuevo aplica un desempate determinista). Cuando un LIMIT o una página corta dentro de un grupo empatado, las filas incluidas pueden variar; se verifica que toda diferencia queda dentro del empate de la frontera. Los promedios de sueldo se calculan sobre centavos enteros para que los empates sean los mismos que en Postgres (AVG sobre numeric).

- ✓ `/api/v1/sectores/compare?a=1&b=2` $.sector_a.top_puestos: 1 fila(s) distintas — todas en el empate de la frontera del corte (`count` = 12.0)
- ✓ `/api/v1/sectores/compare?a=1&b=2` $.sector_b.top_puestos: 2 fila(s) distintas — todas en el empate de la frontera del corte (`count` = 1.0)
- ✓ `/api/v1/sectores/1/stats` $.top_puestos: 1 fila(s) distintas — todas en el empate de la frontera del corte (`count` = 12.0)
- ✓ `/api/v1/catalogos/puestos?page=3&per_page=25` $.data: mismo conjunto de 25 filas (solo cambia el orden dentro de empates de `count`)
- ✓ `/api/v1/dashboard/stats` $.allSectors: mismo conjunto de 75 filas (solo cambia el orden dentro de empates de `count`)
- ✓ `/api/v1/dashboard/stats` $.top15Sectors: mismo conjunto de 15 filas (solo cambia el orden dentro de empates de `count`)
- ✓ `/api/v1/dashboard/stats` $.genderGapBySector: mismo conjunto de 10 filas (solo cambia el orden dentro de empates de `gap`)
- ✓ `/api/v1/dashboard/stats` $.topPositions: mismo conjunto de 10 filas (solo cambia el orden dentro de empates de `avgSalary`)
- ✓ `/api/v1/analytics/puestos/ranking` $: mismo conjunto de 20 filas (solo cambia el orden dentro de empates de `avg_sueldo`)
- ✓ `/api/v1/analytics/puestos/ranking?limit=100` $: mismo conjunto de 100 filas (solo cambia el orden dentro de empates de `avg_sueldo`)

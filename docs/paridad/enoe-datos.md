# Paridad — docs/paridad/enoe-rutas.txt

Fecha: 2026-09-19T10:36:55Z · legacy `https://api.datos-itam.org` · nuevo `https://datosmexico-api.davidfernando.workers.dev`

**41/41 rutas idénticas.**

- ✓ `/api/v1/enoe/health` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/metadata` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/catalogos/indicadores` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/catalogos/entidades` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/catalogos/etapas-metodologicas` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/indicadores/nacional/serie?indicador=tasa_desocupacion` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/indicadores/nacional/serie?indicador=pob_15ymas&desde=2019T1&hasta=2021T4` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/indicadores/nacional/serie?indicador=informales_total&etapa=enoe_n` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/indicadores/nacional/serie?indicador=condcrit_total&desde=2022T1` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/indicadores/nacional/serie?indicador=noexiste` — HTTP 404, idéntico
- ✓ `/api/v1/enoe/indicadores/nacional/serie?indicador=tasa_desocupacion&desde=2020` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/indicadores/nacional/serie?indicador=tasa_desocupacion&etapa=x` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/indicadores/nacional/serie?indicador=tasa_desocupacion&desde=2021T1&hasta=2020T1` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/indicadores/nacional/serie` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/indicadores/nacional/snapshot?periodo=2025T1` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/indicadores/nacional/snapshot?periodo=2020T2` — HTTP 404, idéntico
- ✓ `/api/v1/enoe/indicadores/nacional/snapshot?periodo=2005T1` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/indicadores/nacional/snapshot?periodo=abc` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/indicadores/entidad/serie?indicador=tasa_desocupacion&entidad_clave=09` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/indicadores/entidad/serie?indicador=pea_total&entidad_clave=01&desde=2020T1&hasta=2020T4` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/indicadores/entidad/serie?indicador=tasa_desocupacion&entidad_clave=99` — HTTP 404, idéntico
- ✓ `/api/v1/enoe/indicadores/entidad/snapshot?periodo=2025T1&indicador=tasa_informalidad_til1` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/indicadores/entidad/snapshot?periodo=2020T2&indicador=tasa_desocupacion` — HTTP 404, idéntico
- ✓ `/api/v1/enoe/indicadores/entidad/ranking?periodo=2025T1&indicador=tasa_desocupacion` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/indicadores/entidad/ranking?periodo=2025T1&indicador=tasa_desocupacion&orden=asc&limit=32` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/indicadores/entidad/ranking?periodo=2025T1&indicador=tasa_desocupacion&orden=x` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/indicadores/entidad/ranking?periodo=2025T1&indicador=tasa_desocupacion&limit=0` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/ocupados/por-sector/snapshot?periodo=2025T1` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/ocupados/por-sector/snapshot?periodo=2025T1&nivel=entidad&geo_clave=09` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/ocupados/por-sector/snapshot?periodo=2025T1&nivel=entidad` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/ocupados/por-sector/snapshot?periodo=2025T1&nivel=entidad&geo_clave=99` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/ocupados/por-sector/snapshot?periodo=2025T1&nivel=otro` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/ocupados/por-sector/serie?sector_clave=5` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/ocupados/por-sector/serie?sector_clave=11&nivel=entidad&geo_clave=09&desde=2023T1` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/ocupados/por-sector/serie?sector_clave=12` — HTTP 404, idéntico
- ✓ `/api/v1/enoe/ocupados/por-posicion/snapshot?periodo=2025T1` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/ocupados/por-posicion/snapshot?periodo=2010T3&nivel=entidad&geo_clave=32` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/ocupados/por-posicion/serie?pos_clave=1` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/ocupados/por-posicion/serie?pos_clave=4&nivel=entidad&geo_clave=09&desde=2020T1&hasta=2021T4` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/ocupados/por-posicion/serie?pos_clave=5` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/ocupados/por-posicion/serie?pos_clave=abc` — HTTP 422, idéntico

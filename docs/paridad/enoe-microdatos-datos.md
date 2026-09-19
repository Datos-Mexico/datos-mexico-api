# Paridad — docs/paridad/enoe-microdatos-rutas.txt

Fecha: 2026-09-19T11:06:32Z · legacy `https://api.datos-itam.org` · nuevo `https://datosmexico-api.davidfernando.workers.dev`

**21/21 rutas idénticas.**

- ✓ `/api/v1/enoe/microdatos/viv/schema` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/microdatos/sdem/schema` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/microdatos/coe2/schema` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/microdatos/otra/schema` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/microdatos/sdem/count?periodo=2025T1&entidad_clave=09` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/microdatos/sdem/count?periodo=2025T1&entidad=09&sex=2&eda_min=15&eda_max=29` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/microdatos/viv/count?periodo=2010T3&entidad_clave=32` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/microdatos/hog/count?periodo=2020T2` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/microdatos/viv/count?periodo=2025T1&sex=1` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/microdatos/sdem/count?periodo=2025T1&eda_min=50&eda_max=20` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/microdatos/sdem/count?periodo=2025T1&entidad_clave=09&entidad=10` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/microdatos/sdem/count?periodo=2025` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/microdatos/sdem/count?periodo=2025T1&entidad_clave=99` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/microdatos/sdem/count` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/microdatos/sdem/list?periodo=2025T1&entidad_clave=09&per_page=5` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/microdatos/sdem/list?periodo=2025T1&entidad_clave=09&per_page=3&page=2&include_extras=false` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/microdatos/viv/list?periodo=2005T2&entidad_clave=01&per_page=2` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/microdatos/coe1/list?periodo=2021T1&entidad_clave=15&per_page=2&include_extras=false` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/microdatos/sdem/list?periodo=2020T2&per_page=5` — HTTP 200, idéntico
- ✓ `/api/v1/enoe/microdatos/sdem/list?periodo=2025T1&entidad_clave=09&per_page=5000` — HTTP 422, idéntico
- ✓ `/api/v1/enoe/microdatos/sdem/list?periodo=2025T1&entidad_clave=09&page=0` — HTTP 422, idéntico

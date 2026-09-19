# Paridad — docs/paridad/enigh-rutas.txt

Fecha: 2026-09-19T10:03:22Z · legacy `https://api.datos-itam.org` · nuevo `https://datosmexico-api.davidfernando.workers.dev`

**24/24 rutas idénticas.**

- ✓ `/api/v1/enigh/metadata` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/validaciones` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/hogares/summary` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/hogares/by-decil` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/hogares/by-entidad` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/hogares/by-entidad?entidad=09` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/hogares/by-entidad?entidad=32` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/hogares/by-entidad?entidad=99` — HTTP 404, idéntico
- ✓ `/api/v1/enigh/hogares/by-entidad?entidad=9` — HTTP 422, idéntico
- ✓ `/api/v1/enigh/hogares/by-entidad?entidad=abc` — HTTP 422, idéntico
- ✓ `/api/v1/enigh/poblacion/demographics` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/poblacion/demographics?entidad=15` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/poblacion/demographics?entidad=01` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/poblacion/demographics?entidad=99` — HTTP 404, idéntico
- ✓ `/api/v1/enigh/poblacion/demographics?entidad=x` — HTTP 422, idéntico
- ✓ `/api/v1/enigh/gastos/by-rubro` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/gastos/by-rubro?decil=1` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/gastos/by-rubro?decil=10` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/gastos/by-rubro?decil=0` — HTTP 422, idéntico
- ✓ `/api/v1/enigh/gastos/by-rubro?decil=11` — HTTP 422, idéntico
- ✓ `/api/v1/enigh/gastos/by-rubro?decil=abc` — HTTP 422, idéntico
- ✓ `/api/v1/enigh/actividad/agro` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/actividad/noagro` — HTTP 200, idéntico
- ✓ `/api/v1/enigh/actividad/jcf` — HTTP 200, idéntico

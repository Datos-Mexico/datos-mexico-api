# Paridad — docs/paridad/consar-rutas.txt

Fecha: 2026-09-19T09:13:15Z · legacy `https://api.datos-itam.org` · nuevo `https://datosmexico-api.davidfernando.workers.dev`

**52/52 rutas idénticas.**

- ✓ `/api/v1/consar/afores` — HTTP 200, idéntico
- ✓ `/api/v1/consar/tipos-recurso` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/totales` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/por-afore?fecha=2025-06` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/por-afore?fecha=2010-01-01` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/por-afore?fecha=1998-05` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/por-afore?fecha=1990-01` — HTTP 404, idéntico
- ✓ `/api/v1/consar/recursos/por-afore?fecha=2025-06-15` — HTTP 422, idéntico
- ✓ `/api/v1/consar/recursos/por-afore?fecha=hola` — HTTP 422, idéntico
- ✓ `/api/v1/consar/recursos/por-afore?fecha=2025-13` — HTTP 422, idéntico
- ✓ `/api/v1/consar/recursos/por-afore` — HTTP 422, idéntico
- ✓ `/api/v1/consar/recursos/por-componente?fecha=2025-06` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/por-componente?fecha=2005-03` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/por-componente?fecha=1997-01` — HTTP 404, idéntico
- ✓ `/api/v1/consar/recursos/imss-vs-issste` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/composicion?fecha=2025-06` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/composicion?fecha=2011-06` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/composicion?fecha=2009-03` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/composicion?fecha=1990-01` — HTTP 404, idéntico
- ✓ `/api/v1/consar/recursos/serie?codigo=sar_total` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/serie?codigo=vivienda&afore_codigo=xxi_banorte` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/serie?codigo=rcv_issste&desde=2008-01&hasta=2012-12-01` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/serie?codigo=ahorro_voluntario&afore_codigo=pension_bienestar` — HTTP 200, idéntico
- ✓ `/api/v1/consar/recursos/serie?codigo=fondos_prevision_social&desde=2030-01` — HTTP 422, idéntico
- ✓ `/api/v1/consar/recursos/serie?codigo=noexiste` — HTTP 404, idéntico
- ✓ `/api/v1/consar/recursos/serie?codigo=sar_total&afore_codigo=noexiste` — HTTP 404, idéntico
- ✓ `/api/v1/consar/recursos/serie?codigo=sar_total&desde=2020-01&hasta=2019-01` — HTTP 422, idéntico
- ✓ `/api/v1/consar/recursos/serie?codigo=sar_total&desde=2020-01-15` — HTTP 422, idéntico
- ✓ `/api/v1/consar/recursos/serie` — HTTP 422, idéntico
- ✓ `/api/v1/consar/comisiones/serie` — HTTP 200, idéntico
- ✓ `/api/v1/consar/comisiones/serie?afore_codigo=profuturo` — HTTP 200, idéntico
- ✓ `/api/v1/consar/comisiones/serie?afore_codigo=pension_bienestar` — HTTP 200, idéntico
- ✓ `/api/v1/consar/comisiones/serie?desde=2015-01&hasta=2015-12` — HTTP 200, idéntico
- ✓ `/api/v1/consar/comisiones/serie?afore_codigo=noexiste` — HTTP 404, idéntico
- ✓ `/api/v1/consar/comisiones/serie?desde=2020-01&hasta=2010-01` — HTTP 422, idéntico
- ✓ `/api/v1/consar/comisiones/snapshot?fecha=2025-06` — HTTP 200, idéntico
- ✓ `/api/v1/consar/comisiones/snapshot?fecha=2008-03-01` — HTTP 200, idéntico
- ✓ `/api/v1/consar/comisiones/snapshot?fecha=2000-01` — HTTP 404, idéntico
- ✓ `/api/v1/consar/flujos/serie` — HTTP 200, idéntico
- ✓ `/api/v1/consar/flujos/serie?afore_codigo=xxi_banorte&desde=2020-01&hasta=2020-12` — HTTP 200, idéntico
- ✓ `/api/v1/consar/flujos/serie?afore_codigo=noexiste` — HTTP 404, idéntico
- ✓ `/api/v1/consar/flujos/snapshot?fecha=2025-06` — HTTP 200, idéntico
- ✓ `/api/v1/consar/flujos/snapshot?fecha=2009-01` — HTTP 200, idéntico
- ✓ `/api/v1/consar/flujos/snapshot?fecha=2005-01` — HTTP 404, idéntico
- ✓ `/api/v1/consar/traspasos/serie` — HTTP 200, idéntico
- ✓ `/api/v1/consar/traspasos/serie?afore_codigo=coppel` — HTTP 200, idéntico
- ✓ `/api/v1/consar/traspasos/serie?desde=1998-11&hasta=1999-06` — HTTP 200, idéntico
- ✓ `/api/v1/consar/traspasos/serie?desde=2030-01` — HTTP 422, idéntico
- ✓ `/api/v1/consar/traspasos/snapshot?fecha=2025-06` — HTTP 200, idéntico
- ✓ `/api/v1/consar/traspasos/snapshot?fecha=1999-01` — HTTP 200, idéntico
- ✓ `/api/v1/consar/traspasos/snapshot?fecha=1998-01` — HTTP 404, idéntico
- ✓ `/api/v1/consar/pea-cotizantes/serie` — HTTP 200, idéntico

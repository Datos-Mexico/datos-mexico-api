# Endpoints de escritura, autenticación y demo del legacy (extraídos del openapi el 2026-09-20)

## POST /api/v1/auth/register
- tag: ['auth'] · operationId: register_api_v1_auth_register_post
- summary: Registro de usuarios — deshabilitado
- description: Endpoint de registro de usuarios **intencionalmente deshabilitado**. La route existe en el código y siempre devuelve `403 Forbidden` con el mensaje correspondiente. Si en el futuro el observatorio decide abrir registro público, la route ya está lista en el contrato del API y sólo requiere reemplazar el cuerpo de la función por la lógica de creación. La provisión actual de cuentas admin se hace por CLI (`api/scripts/create_admin.py`); contacto: `df.avila.diaz@gmail.com`.
- security: None
- requestBody (application/json) requeridos ['username', 'email', 'password']: {"username": ["string", null], "email": ["string", null], "password": ["string", null]}
- 403: Registro deshabilitado actualmente. La route existe en el código pero está intencionalmente bloqueada. 
- 422: Validation Error {"detail": "array"}

## POST /api/v1/auth/token
- tag: ['auth'] · operationId: login_api_v1_auth_token_post
- summary: Obtener JWT por OAuth2 password flow
- description: Autenticación por OAuth2 password flow. Recibe `username` y `password` como `application/x-www-form-urlencoded` y devuelve un JWT bearer con vigencia `ACCESS_TOKEN_EXPIRE_MINUTES` (default 30 minutos). El token debe enviarse en endpoints autenticados como `Authorization: Bearer <token>`. Algoritmo de firma: `HS256` (simétrico, secret en variable de entorno `SECRET_KEY`).
- security: None
- requestBody (application/x-www-form-urlencoded) requeridos ['username', 'password']: {"grant_type": ["anyOf", null], "username": ["string", null], "password": ["string", null], "scope": ["string", null], "client_id": ["anyOf", null], "client_secret": ["anyOf", null]}
- 200: Token JWT bearer emitido. Vigencia: `ACCESS_TOKEN_EXPIRE_MINUTES` (default 30 minutos). {"access_token": "string", "token_type": "string"}
- 401: Credenciales incorrectas (usuario inexistente o password no coincide). {"detail": "string"}
- 422: Validation Error {"detail": "array"}

## GET /api/v1/auth/me
- tag: ['auth'] · operationId: get_me_api_v1_auth_me_get
- summary: Perfil del usuario autenticado
- description: Devuelve el perfil del usuario asociado al JWT enviado en el header `Authorization`. Útil para que un cliente confirme la vigencia del token y obtenga su flag `is_admin`. No incluye el `hashed_password` ni datos sensibles.
- security: [{'OAuth2PasswordBearer': []}]
- 200: Perfil del usuario autenticado. {"id": "integer", "username": "string", "email": "string", "is_active": "boolean", "is_admin": "boolean", "created_at": "string"}
- 401: Token ausente, expirado, inválido, o usuario inactivo. {"detail": "string"}

## POST /api/v1/catalogos/{tipo}
- tag: ['catalogos'] · operationId: create_catalog_item_api_v1_catalogos__tipo__post
- summary: Crear un item en un catálogo (admin)
- description: [Uso interno administrativo] Inserta un item nuevo en uno de los catálogos: `sexos`, `puestos`, `tipos-contratacion`, `tipos-personal`, `tipos-nomina`, `universos`, `sectores`, `niveles-salariales`. Cada catálogo tiene su lista de campos requeridos (`nombre`, `clave`, o combinación). Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.
- security: [{'OAuth2PasswordBearer': []}]
- parámetros: [('tipo', 'path', True, 'string', None)]
- requestBody (application/json) requeridos None: {}
- 201: Item de catálogo creado. 
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 404: El `tipo` de catálogo no existe (debe ser uno de los 8 listados). {"detail": "string"}
- 422: Campo requerido del catálogo ausente en el body. 

## PUT /api/v1/catalogos/{tipo}/{item_id}
- tag: ['catalogos'] · operationId: update_catalog_item_api_v1_catalogos__tipo___item_id__put
- summary: Actualizar un item de catálogo (admin)
- description: [Uso interno administrativo] Actualiza un item existente en uno de los catálogos (`sexos`, `puestos`, `tipos-contratacion`, `tipos-personal`, `tipos-nomina`, `universos`, `sectores`, `niveles-salariales`). Sólo los campos válidos para ese catálogo son aplicados. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.
- security: [{'OAuth2PasswordBearer': []}]
- parámetros: [('tipo', 'path', True, 'string', None), ('item_id', 'path', True, 'integer', None)]
- requestBody (application/json) requeridos None: {}
- 200: Item actualizado. 
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 404: `tipo` de catálogo o `item_id` no existe. {"detail": "string"}
- 422: Validation Error {"detail": "array"}

## DELETE /api/v1/catalogos/{tipo}/{item_id}
- tag: ['catalogos'] · operationId: delete_catalog_item_api_v1_catalogos__tipo___item_id__delete
- summary: Eliminar un item de catálogo (admin) — bloqueado si hay FK refs
- description: [Uso interno administrativo] Elimina un item de catálogo. **Devuelve 409 si hay nombramientos o personas que referencian este item** — primero hay que migrarlos o eliminarlos. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.
- security: [{'OAuth2PasswordBearer': []}]
- parámetros: [('tipo', 'path', True, 'string', None), ('item_id', 'path', True, 'integer', None)]
- 204: Item eliminado (sin body). 
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 404: `tipo` o `item_id` no existe. {"detail": "string"}
- 409: El item tiene FK refs activas (no se puede borrar). {"detail": "string"}
- 422: Validation Error {"detail": "array"}

## POST /api/v1/admin/refresh-materialized-views
- tag: ['admin'] · operationId: refresh_materialized_views_api_v1_admin_refresh_materialized_views_post
- summary: [Operacional] Refrescar las 5 materialized views del schema cdmx
- description: **Operacional — no debe consumirse desde producción de forma programática** (cron externo, scheduler del consumidor, etc.). Refresca las cinco materialized views del schema `cdmx` (`mv_dashboard_overview`, `mv_dashboard_sectors`, `mv_dashboard_top_positions`, `mv_dashboard_salary_by_age`, `mv_dashboard_seniority`) ejecutando `REFRESH MATERIALIZED VIEW CONCURRENTLY` (no bloquea lecturas concurrentes pero es operación cara: típicamente 2-8 segundos en el dataset actual). Diseñado para invocación manual o disparado únicamente por pipeline interno del observatorio tras una ingesta. Rate limit estricto (5/min/IP). Requiere JWT admin.
- security: [{'OAuth2PasswordBearer': []}]
- 200: Refresco completado. {"refreshed": "array", "duration_ms": "integer"}
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 429: Rate limit excedido (5 req/min por IP). {"detail": "string"}

## POST /api/v1/personas/
- tag: ['personas'] · operationId: create_persona_api_v1_personas__post
- summary: Crear una persona (admin)
- description: [Uso interno administrativo] Inserta una persona nueva en el padrón. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.
- security: [{'OAuth2PasswordBearer': []}]
- requestBody (application/json) requeridos ['nombre', 'apellido_1']: {"nombre": ["string", null], "apellido_1": ["string", null], "apellido_2": ["anyOf", null], "sexo_id": ["anyOf", null], "edad": ["anyOf", null]}
- 201: Persona creada. {"id": "integer", "nombre": "string", "apellido_1": "string", "apellido_2": "anyOf", "sexo_id": "anyOf", "edad": "anyOf"}
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 422: `sexo_id` no existe en `cdmx.cat_sexos`, o body inválido. 

## PUT /api/v1/personas/{persona_id}
- tag: ['personas'] · operationId: update_persona_api_v1_personas__persona_id__put
- summary: Actualizar una persona (admin)
- description: [Uso interno administrativo] Actualiza campos de una persona existente. Sólo los campos enviados en el body se modifican (`exclude_unset=True`). Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.
- security: [{'OAuth2PasswordBearer': []}]
- parámetros: [('persona_id', 'path', True, 'integer', None)]
- requestBody (application/json) requeridos None: {"nombre": ["anyOf", null], "apellido_1": ["anyOf", null], "apellido_2": ["anyOf", null], "sexo_id": ["anyOf", null], "edad": ["anyOf", null]}
- 200: Persona actualizada. {"id": "integer", "nombre": "string", "apellido_1": "string", "apellido_2": "anyOf", "sexo_id": "anyOf", "edad": "anyOf"}
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 404: `persona_id` no existe. {"detail": "string"}
- 422: `sexo_id` no existe, o body inválido. 

## DELETE /api/v1/personas/{persona_id}
- tag: ['personas'] · operationId: delete_persona_api_v1_personas__persona_id__delete
- summary: Eliminar una persona (admin) — requiere que no tenga nombramientos
- description: [Uso interno administrativo] Elimina una persona del padrón. **Devuelve 409 si la persona tiene nombramientos activos** — primero hay que eliminar los nombramientos. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.
- security: [{'OAuth2PasswordBearer': []}]
- parámetros: [('persona_id', 'path', True, 'integer', None)]
- 204: Persona eliminada (sin body). 
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 404: `persona_id` no existe. {"detail": "string"}
- 409: La persona tiene nombramientos referenciados. {"detail": "string"}
- 422: Validation Error {"detail": "array"}

## POST /api/v1/nombramientos/
- tag: ['nombramientos'] · operationId: create_nombramiento_api_v1_nombramientos__post
- summary: Crear un nombramiento (admin)
- description: [Uso interno administrativo] Inserta un nombramiento nuevo asociado a una `persona_id`. Valida que la persona exista y que todos los IDs de catálogo (`puesto_id`, `sector_id`, etc.) referenciados existan. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.
- security: [{'OAuth2PasswordBearer': []}]
- requestBody (application/json) requeridos ['persona_id']: {"persona_id": ["integer", null], "puesto_id": ["anyOf", null], "sector_id": ["anyOf", null], "tipo_nomina_id": ["anyOf", null], "tipo_contratacion_id": ["anyOf", null], "tipo_personal_id": ["anyOf", null], "universo_id": ["anyOf", null], "nivel_salarial_id": ["anyOf", null], "fecha_ingreso": ["anyOf", null], "sueldo_bruto": ["anyOf", null], "sueldo_neto": ["anyOf", null]}
- 201: Nombramiento creado. {"id": "integer", "persona_id": "integer", "puesto_id": "anyOf", "sector_id": "anyOf", "tipo_nomina_id": "anyOf", "tipo_contratacion_id": "anyOf", "tipo_personal_id": "anyOf", "universo_id": "anyOf", "nivel_salarial_id": "anyOf", "fecha_ingreso": "anyOf", "sueldo_bruto": "anyOf", "sueldo_neto": "anyOf"}
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 422: `persona_id` o algún `*_id` de catálogo no existe. 

## PUT /api/v1/nombramientos/{nombramiento_id}
- tag: ['nombramientos'] · operationId: update_nombramiento_api_v1_nombramientos__nombramiento_id__put
- summary: Actualizar un nombramiento (admin)
- description: [Uso interno administrativo] Actualiza campos de un nombramiento existente. Sólo los campos enviados se modifican (`exclude_unset=True`). Valida FKs referenciadas. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.
- security: [{'OAuth2PasswordBearer': []}]
- parámetros: [('nombramiento_id', 'path', True, 'integer', None)]
- requestBody (application/json) requeridos None: {"puesto_id": ["anyOf", null], "sector_id": ["anyOf", null], "tipo_nomina_id": ["anyOf", null], "tipo_contratacion_id": ["anyOf", null], "tipo_personal_id": ["anyOf", null], "universo_id": ["anyOf", null], "nivel_salarial_id": ["anyOf", null], "fecha_ingreso": ["anyOf", null], "sueldo_bruto": ["anyOf", null], "sueldo_neto": ["anyOf", null]}
- 200: Nombramiento actualizado. {"id": "integer", "persona_id": "integer", "puesto_id": "anyOf", "sector_id": "anyOf", "tipo_nomina_id": "anyOf", "tipo_contratacion_id": "anyOf", "tipo_personal_id": "anyOf", "universo_id": "anyOf", "nivel_salarial_id": "anyOf", "fecha_ingreso": "anyOf", "sueldo_bruto": "anyOf", "sueldo_neto": "anyOf"}
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 404: `nombramiento_id` no existe. {"detail": "string"}
- 422: Algún `*_id` de catálogo en el body no existe. 

## DELETE /api/v1/nombramientos/{nombramiento_id}
- tag: ['nombramientos'] · operationId: delete_nombramiento_api_v1_nombramientos__nombramiento_id__delete
- summary: Eliminar un nombramiento (admin)
- description: [Uso interno administrativo] Elimina un nombramiento existente. No tiene constraint FK de cascada — la persona padre permanece. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.
- security: [{'OAuth2PasswordBearer': []}]
- parámetros: [('nombramiento_id', 'path', True, 'integer', None)]
- 204: Nombramiento eliminado (sin body). 
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 404: `nombramiento_id` no existe. {"detail": "string"}
- 422: Validation Error {"detail": "array"}

## POST /api/v1/ingest/csv
- tag: ['ingest'] · operationId: ingest_csv_api_v1_ingest_csv_post
- summary: Cargar CSV completo del padrón CDMX (admin) — operación cara
- description: [Uso interno administrativo] Carga un CSV completo del padrón CDMX (`remuneraciones_cdmx.csv`, ~246K filas, 45MB) en una sola transacción. Mantiene caches en memoria por catálogo para deduplicar IDs durante la pasada (idempotente para los catálogos: si un valor ya existe, se reutiliza su ID; nuevo valor crea fila en el catálogo correspondiente). Crea filas en `cdmx.personas` y `cdmx.nombramientos` por cada fila válida; filas con `nombre`/`apellido_1` ausentes se cuentan como errores (con detalle en `error_details[]` hasta 50 entries). Tiempo típico: ~30-90 s para el dataset completo. **Tras esta carga corresponde invocar manualmente `POST /api/v1/admin/refresh-materialized-views`** para refrescar el snapshot del dashboard. Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional.
- security: [{'OAuth2PasswordBearer': []}]
- requestBody (multipart/form-data) requeridos ['file']: {"file": ["string", null]}
- 200: Resumen de la ingesta (filas insertadas, errores, duración). {"inserted": "integer", "errors": "integer", "error_details": "array", "duration_seconds": "number"}
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 422: El archivo subido no termina en `.csv`. 

## GET /api/v1/demo/estudiantes
- tag: ['demo'] · operationId: list_estudiantes_api_v1_demo_estudiantes_get
- summary: Lista del curso ITAM Bases de Datos sección 001
- description: Retorna las 12 personas del curso (1 profesor + 4 equipo + 7 estudiantes) con sueldo diario, tipo, y estado actual de `reclamar_bono`. Lectura pública sin auth. Orden: profesor → equipo (por sueldo desc) → estudiantes (por sueldo desc).
- security: None
- 200: Lista completa con los 12 registros. {"count": "integer", "estudiantes": "array", "seccion": "string", "fuente": "string"}
- 429: Rate limit excedido (60 req/min por IP). {"detail": "string"}

## GET /api/v1/demo/estudiantes/{id}
- tag: ['demo'] · operationId: get_estudiante_api_v1_demo_estudiantes__id__get
- summary: Detalle de una persona del curso
- description: Devuelve los campos completos (`nombre_completo`, `rol`, `tipo`, `seccion`, `sueldo_diario_mxn`, `reclamar_bono`, fechas) de una persona del curso por su `id`. Lectura pública sin auth.
- security: None
- parámetros: [('id', 'path', True, 'integer', None)]
- 200: Detalle del registro. {"id": "integer", "nombre_completo": "string", "rol": "string", "tipo": "string", "seccion": "string", "sueldo_diario_mxn": "string", "reclamar_bono": "boolean", "fecha_creacion": "string", "fecha_actualizacion": "string"}
- 404: El `id` no existe. {"detail": "string"}
- 429: Rate limit excedido (120 req/min por IP). {"detail": "string"}
- 422: Validation Error {"detail": "array"}

## GET /api/v1/demo/resumen
- tag: ['demo'] · operationId: get_resumen_api_v1_demo_resumen_get
- summary: Agregados para la KPI bar del dashboard /demo
- description: Totales en una sola llamada: empleados, bonos reclamados, monto distribuido (N × $50,000 MXN), monto disponible (resto del pool), monto total posible (12 × $50,000 = $600,000 MXN), y nómina diaria total.
- security: None
- 200: Snapshot agregado para la KPI bar. {"total_empleados": "integer", "bonos_reclamados": "integer", "bono_unitario_mxn": "integer", "monto_distribuido_mxn": "integer", "monto_disponible_mxn": "integer", "monto_total_posible_mxn": "integer", "nomina_diaria_total_mxn": "string", "fecha": "string"}
- 429: Rate limit excedido (60 req/min por IP). {"detail": "string"}

## PUT /api/v1/demo/estudiantes/{id}/toggle-bono
- tag: ['demo'] · operationId: toggle_bono_api_v1_demo_estudiantes__id__toggle_bono_put
- summary: Toggle del campo reclamar_bono (requiere login)
- description: Invierte el booleano `reclamar_bono` de la fila indicada. Cualquier usuario autenticado puede tocar cualquier fila — la cuenta `DemoAbril` es compartida durante la demo en vivo. Para auditoría se retorna `actor_username`. El monto del bono es flat $50,000 MXN.
- security: [{'OAuth2PasswordBearer': []}]
- parámetros: [('id', 'path', True, 'integer', None)]
- 200: Toggle aplicado. {"id": "integer", "nombre_completo": "string", "reclamar_bono": "boolean", "fecha_actualizacion": "string", "actor_username": "string"}
- 401: JWT ausente o inválido. {"detail": "string"}
- 404: El `id` no existe. {"detail": "string"}
- 429: Rate limit excedido (30 req/min por IP). {"detail": "string"}
- 422: Validation Error {"detail": "array"}

## POST /api/v1/admin/demo/estudiantes
- tag: ['demo-admin'] · operationId: crear_estudiante_api_v1_admin_demo_estudiantes_post
- summary: Crear un nuevo registro en demo.curso_bd (admin)
- description: Inserta una persona nueva en `demo.curso_bd`. El campo `nombre_completo` tiene UNIQUE constraint — duplicados devuelven 409. Requiere JWT admin.
- security: [{'OAuth2PasswordBearer': []}]
- requestBody (application/json) requeridos ['nombre_completo']: {"nombre_completo": ["string", null], "rol": ["string", null], "tipo": ["string", null], "seccion": ["anyOf", "Si se omite, hereda el default de la columna ('BASES DE DATOS - 001')."], "sueldo_diario_mxn": ["anyOf", null]}
- 201: Registro creado. {"id": "integer", "nombre_completo": "string", "rol": "string", "tipo": "string", "seccion": "string", "sueldo_diario_mxn": "string", "reclamar_bono": "boolean", "fecha_creacion": "string", "fecha_actualizacion": "string"}
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 409: Violación de UNIQUE constraint sobre `nombre_completo`. {"detail": "string"}
- 429: Rate limit excedido (20 req/min por IP). {"detail": "string"}
- 422: Validation Error {"detail": "array"}

## PUT /api/v1/admin/demo/estudiantes/{id}
- tag: ['demo-admin'] · operationId: editar_estudiante_api_v1_admin_demo_estudiantes__id__put
- summary: Editar campos de un registro (admin)
- description: Edición parcial: solo los campos enviados se modifican. Requiere JWT admin.
- security: [{'OAuth2PasswordBearer': []}]
- parámetros: [('id', 'path', True, 'integer', None)]
- requestBody (application/json) requeridos None: {"nombre_completo": ["anyOf", null], "rol": ["anyOf", null], "tipo": ["anyOf", null], "seccion": ["anyOf", null], "sueldo_diario_mxn": ["anyOf", null], "reclamar_bono": ["anyOf", null]}
- 200: Registro actualizado. {"id": "integer", "nombre_completo": "string", "rol": "string", "tipo": "string", "seccion": "string", "sueldo_diario_mxn": "string", "reclamar_bono": "boolean", "fecha_creacion": "string", "fecha_actualizacion": "string"}
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 404: El `id` no existe. {"detail": "string"}
- 422: Body vacío (ningún campo enviado). 
- 429: Rate limit excedido (20 req/min por IP). {"detail": "string"}

## DELETE /api/v1/admin/demo/estudiantes/{id}
- tag: ['demo-admin'] · operationId: borrar_estudiante_api_v1_admin_demo_estudiantes__id__delete
- summary: Borrar un registro (admin)
- description: Elimina permanentemente una fila de `demo.curso_bd`. No tiene constraint de cascada porque la tabla es independiente. Requiere JWT admin.
- security: [{'OAuth2PasswordBearer': []}]
- parámetros: [('id', 'path', True, 'integer', None)]
- 200: Registro eliminado. {"id": "integer", "deleted": "boolean"}
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 404: El `id` no existe. {"detail": "string"}
- 429: Rate limit excedido (20 req/min por IP). {"detail": "string"}
- 422: Validation Error {"detail": "array"}

## POST /api/v1/admin/demo/reset
- tag: ['demo-admin'] · operationId: reset_bonos_api_v1_admin_demo_reset_post
- summary: Resetear todos los reclamar_bono a FALSE (admin)
- description: Útil para repetir la demo si alguien tocó filas antes de tiempo. Solo afecta filas con `reclamar_bono=TRUE`. Requiere JWT admin.
- security: [{'OAuth2PasswordBearer': []}]
- 200: Reset aplicado. {"filas_reseteadas": "integer", "fecha": "string"}
- 401: JWT ausente o inválido. {"detail": "string"}
- 403: Usuario autenticado sin privilegios admin. {"detail": "string"}
- 429: Rate limit excedido (10 req/min por IP). {"detail": "string"}

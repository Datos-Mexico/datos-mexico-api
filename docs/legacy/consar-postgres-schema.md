# consar — columnas (tabla | columna | tipo | nulo | default)
activo_neto | afore_id | integer num(32,0) | NO | 
activo_neto | siefore_id | integer num(32,0) | NO | 
activo_neto | fecha | date | NO | 
activo_neto | monto_mxn_mm | numeric num(14,4) | YES | 
activo_neto_agg | afore_id | integer num(32,0) | NO | 
activo_neto_agg | categoria | character varying(48) | NO | 
activo_neto_agg | fecha | date | NO | 
activo_neto_agg | monto_mxn_mm | numeric num(14,4) | YES | 
afore_alias | alias_text | character varying(64) | NO | 
afore_alias | afore_id | integer num(32,0) | NO | 
afore_alias | fuente | character varying(64) | YES | 
afore_alias | notas | text | YES | 
afore_alias | created_at | timestamp with time zone | NO | now()
afore_siefore_alias | alias_text | character varying(80) | NO | 
afore_siefore_alias | afore_id | integer num(32,0) | NO | 
afore_siefore_alias | siefore_id | integer num(32,0) | NO | 
afore_siefore_alias | fuente_csv | character varying(8) | NO | 
afore_siefore_alias | mapping_validated | boolean | NO | true
afore_siefore_alias | validated_via | character varying(64) | NO | 
afore_siefore_alias | notas | text | YES | 
afore_siefore_alias | created_at | timestamp with time zone | NO | now()
afores | id | integer num(32,0) | NO | nextval('consar.afores_id_seq'::regclass)
afores | codigo | character varying(32) | NO | 
afores | nombre_corto | character varying(64) | NO | 
afores | nombre_csv | character varying(128) | NO | 
afores | tipo_pension | character varying(16) | NO | 
afores | fecha_alta_serie | date | NO | 
afores | activa | boolean | NO | true
afores | orden_display | integer num(32,0) | NO | 
cat_cuenta_etiqueta_agg | id | smallint num(16,0) | NO | nextval('consar.cat_cuenta_etiqueta_agg_id_seq'::regclass)
cat_cuenta_etiqueta_agg | slug | character varying(40) | NO | 
cat_cuenta_etiqueta_agg | csv_string | character varying(120) | NO | 
cat_cuenta_etiqueta_agg | nombre_display | character varying(150) | NO | 
cat_cuenta_etiqueta_agg | categoria | character varying(40) | NO | 
cat_cuenta_etiqueta_agg | notas | text | YES | 
cat_cuenta_etiqueta_agg | created_at | timestamp with time zone | NO | now()
cat_metrica_cuenta | id | smallint num(16,0) | NO | nextval('consar.cat_metrica_cuenta_id_seq'::regclass)
cat_metrica_cuenta | columna_csv | character varying(80) | NO | 
cat_metrica_cuenta | slug | character varying(40) | NO | 
cat_metrica_cuenta | descripcion | text | NO | 
cat_metrica_cuenta | unidad | character varying(16) | NO | 'count'::character varying
cat_metrica_cuenta | desde_fecha | date | NO | 
cat_metrica_cuenta | orden_display | integer num(32,0) | NO | 
cat_metrica_cuenta | notas | text | YES | 
cat_metrica_cuenta | created_at | timestamp with time zone | NO | now()
cat_metrica_sensibilidad | id | smallint num(16,0) | NO | nextval('consar.cat_metrica_sensibilidad_id_seq'::regclass)
cat_metrica_sensibilidad | columna_csv | character varying(80) | NO | 
cat_metrica_sensibilidad | slug | character varying(40) | NO | 
cat_metrica_sensibilidad | descripcion | text | NO | 
cat_metrica_sensibilidad | unidad | character varying(16) | NO | 
cat_metrica_sensibilidad | orden_display | integer num(32,0) | NO | 
cat_metrica_sensibilidad | created_at | timestamp with time zone | NO | now()
cat_siefore | id | integer num(32,0) | NO | nextval('consar.cat_siefore_id_seq'::regclass)
cat_siefore | slug | character varying(40) | NO | 
cat_siefore | nombre | character varying(80) | NO | 
cat_siefore | categoria | character varying(32) | NO | 
cat_siefore | descripcion | text | YES | 
cat_siefore | vigente | boolean | NO | true
cat_siefore | orden_display | integer num(32,0) | NO | 
cat_siefore | created_at | timestamp with time zone | NO | now()
comisiones | fecha | date | NO | 
comisiones | afore_id | integer num(32,0) | NO | 
comisiones | comision | numeric num(7,4) | NO | 
cuenta_administrada | fecha | date | NO | 
cuenta_administrada | afore_id | integer num(32,0) | NO | 
cuenta_administrada | metrica_id | smallint num(16,0) | NO | 
cuenta_administrada | valor | bigint num(64,0) | NO | 
cuenta_administrada_agg | fecha | date | NO | 
cuenta_administrada_agg | etiqueta_id | smallint num(16,0) | NO | 
cuenta_administrada_agg | metrica_id | smallint num(16,0) | NO | 
cuenta_administrada_agg | valor | bigint num(64,0) | NO | 
flujo_recurso | fecha | date | NO | 
flujo_recurso | afore_id | integer num(32,0) | NO | 
flujo_recurso | montos_entradas | numeric num(20,4) | NO | 
flujo_recurso | montos_salidas | numeric num(20,4) | NO | 
medida_sensibilidad | fecha | date | NO | 
medida_sensibilidad | afore_id | integer num(32,0) | NO | 
medida_sensibilidad | siefore_id | integer num(32,0) | NO | 
medida_sensibilidad | metrica_id | smallint num(16,0) | NO | 
medida_sensibilidad | valor | numeric num(14,4) | NO | 
pea_cotizantes | anio | smallint num(16,0) | NO | 
pea_cotizantes | cotizantes | bigint num(64,0) | NO | 
pea_cotizantes | pea | bigint num(64,0) | NO | 
pea_cotizantes | porcentaje_pea_afore | numeric num(6,2) | NO | 
precio_bolsa | fecha | date | NO | 
precio_bolsa | afore_id | integer num(32,0) | NO | 
precio_bolsa | siefore_id | integer num(32,0) | NO | 
precio_bolsa | precio | numeric num(20,8) | NO | 
precio_gestion | fecha | date | NO | 
precio_gestion | afore_id | integer num(32,0) | NO | 
precio_gestion | siefore_id | integer num(32,0) | NO | 
precio_gestion | precio | numeric num(20,8) | NO | 
recursos_mensuales | fecha | date | NO | 
recursos_mensuales | afore_id | integer num(32,0) | NO | 
recursos_mensuales | tipo_recurso_id | integer num(32,0) | NO | 
recursos_mensuales | monto_mxn_mm | numeric num(14,2) | NO | 
rendimiento | afore_id | integer num(32,0) | NO | 
rendimiento | siefore_id | integer num(32,0) | NO | 
rendimiento | fecha | date | NO | 
rendimiento | plazo | character varying(16) | NO | 
rendimiento | rendimiento_pct | numeric num(8,4) | NO | 
rendimiento_sis | siefore_id | integer num(32,0) | NO | 
rendimiento_sis | fecha | date | NO | 
rendimiento_sis | plazo | character varying(16) | NO | 
rendimiento_sis | rendimiento_pct | numeric num(8,4) | NO | 
tipos_recurso | id | integer num(32,0) | NO | nextval('consar.tipos_recurso_id_seq'::regclass)
tipos_recurso | codigo | character varying(40) | NO | 
tipos_recurso | columna_csv | character varying(80) | NO | 
tipos_recurso | nombre_corto | character varying(80) | NO | 
tipos_recurso | nombre_oficial | character varying(160) | NO | 
tipos_recurso | descripcion | text | YES | 
tipos_recurso | categoria | character varying(16) | NO | 
tipos_recurso | es_total_sar | boolean | NO | false
tipos_recurso | orden_display | integer num(32,0) | NO | 
traspaso | fecha | date | NO | 
traspaso | afore_id | integer num(32,0) | NO | 
traspaso | num_tras_cedido | integer num(32,0) | YES | 
traspaso | num_tras_recibido | integer num(32,0) | YES | 

# consar — constraints
consar.activo_neto | activo_neto_afore_id_fkey | FOREIGN KEY (afore_id) REFERENCES consar.afores(id) ON DELETE RESTRICT
consar.activo_neto | activo_neto_fecha_first_of_month | CHECK ((EXTRACT(day FROM fecha) = (1)::numeric))
consar.activo_neto | activo_neto_monto_nonneg | CHECK (((monto_mxn_mm IS NULL) OR (monto_mxn_mm >= (0)::numeric)))
consar.activo_neto | activo_neto_pkey | PRIMARY KEY (afore_id, siefore_id, fecha)
consar.activo_neto | activo_neto_siefore_id_fkey | FOREIGN KEY (siefore_id) REFERENCES consar.cat_siefore(id) ON DELETE RESTRICT
consar.activo_neto_agg | activo_neto_agg_afore_id_fkey | FOREIGN KEY (afore_id) REFERENCES consar.afores(id) ON DELETE RESTRICT
consar.activo_neto_agg | activo_neto_agg_categoria_ck | CHECK (((categoria)::text = ANY ((ARRAY['act_neto_total_siefores'::character varying, 'act_neto_total_basicas'::character varying, 'act_neto_total_adicionales'::character varying])::text[])))
consar.activo_neto_agg | activo_neto_agg_fecha_first_of_month | CHECK ((EXTRACT(day FROM fecha) = (1)::numeric))
consar.activo_neto_agg | activo_neto_agg_monto_nonneg | CHECK (((monto_mxn_mm IS NULL) OR (monto_mxn_mm >= (0)::numeric)))
consar.activo_neto_agg | activo_neto_agg_pkey | PRIMARY KEY (afore_id, categoria, fecha)
consar.afore_alias | afore_alias_afore_id_fkey | FOREIGN KEY (afore_id) REFERENCES consar.afores(id) ON DELETE RESTRICT
consar.afore_alias | afore_alias_pkey | PRIMARY KEY (alias_text)
consar.afore_siefore_alias | afore_siefore_alias_afore_id_fkey | FOREIGN KEY (afore_id) REFERENCES consar.afores(id) ON DELETE RESTRICT
consar.afore_siefore_alias | afore_siefore_alias_fuente_ck | CHECK (((fuente_csv)::text = ANY ((ARRAY['#07'::character varying, '#10'::character varying])::text[])))
consar.afore_siefore_alias | afore_siefore_alias_pkey | PRIMARY KEY (alias_text)
consar.afore_siefore_alias | afore_siefore_alias_siefore_id_fkey | FOREIGN KEY (siefore_id) REFERENCES consar.cat_siefore(id) ON DELETE RESTRICT
consar.afore_siefore_alias | afore_siefore_alias_validated_via_ck | CHECK (((validated_via)::text = ANY ((ARRAY['consar_prospecto'::character varying, 'consar_publicacion'::character varying, 'bijection_with_10'::character varying, 'inferencia_orden_lexicografico'::character varying])::text[])))
consar.afores | afores_codigo_key | UNIQUE (codigo)
consar.afores | afores_nombre_csv_key | UNIQUE (nombre_csv)
consar.afores | afores_pkey | PRIMARY KEY (id)
consar.afores | afores_tipo_pension_ck | CHECK (((tipo_pension)::text = ANY ((ARRAY['privada'::character varying, 'publica'::character varying, 'bienestar'::character varying])::text[])))
consar.cat_cuenta_etiqueta_agg | cat_cuenta_etiqueta_agg_categoria_ck | CHECK (((categoria)::text = ANY ((ARRAY['sistema_total'::character varying, 'sistema_categoria_especial'::character varying, 'administrativa_especial'::character varying])::text[])))
consar.cat_cuenta_etiqueta_agg | cat_cuenta_etiqueta_agg_csv_string_key | UNIQUE (csv_string)
consar.cat_cuenta_etiqueta_agg | cat_cuenta_etiqueta_agg_pkey | PRIMARY KEY (id)
consar.cat_cuenta_etiqueta_agg | cat_cuenta_etiqueta_agg_slug_key | UNIQUE (slug)
consar.cat_metrica_cuenta | cat_metrica_cuenta_columna_csv_key | UNIQUE (columna_csv)
consar.cat_metrica_cuenta | cat_metrica_cuenta_pkey | PRIMARY KEY (id)
consar.cat_metrica_cuenta | cat_metrica_cuenta_slug_key | UNIQUE (slug)
consar.cat_metrica_cuenta | cat_metrica_cuenta_unidad_ck | CHECK (((unidad)::text = 'count'::text))
consar.cat_metrica_sensibilidad | cat_metrica_sensibilidad_columna_csv_key | UNIQUE (columna_csv)
consar.cat_metrica_sensibilidad | cat_metrica_sensibilidad_pkey | PRIMARY KEY (id)
consar.cat_metrica_sensibilidad | cat_metrica_sensibilidad_slug_key | UNIQUE (slug)
consar.cat_metrica_sensibilidad | cat_metrica_sensibilidad_unidad_ck | CHECK (((unidad)::text = ANY ((ARRAY['ratio'::character varying, 'pct'::character varying, 'count'::character varying, 'dias'::character varying])::text[])))
consar.cat_siefore | cat_siefore_categoria_ck | CHECK (((categoria)::text = ANY ((ARRAY['basica_edad'::character varying, 'basica_pensionados'::character varying, 'basica_inicial'::character varying, 'basica_legacy'::character varying, 'cuenta_administrada'::character varying, 'ahorro_voluntario'::character varying, 'previsional_social'::character varying, 'sistema_agregado'::character varying])::text[])))
consar.cat_siefore | cat_siefore_pkey | PRIMARY KEY (id)
consar.cat_siefore | cat_siefore_slug_key | UNIQUE (slug)
consar.comisiones | comisiones_afore_id_fkey | FOREIGN KEY (afore_id) REFERENCES consar.afores(id) ON DELETE RESTRICT
consar.comisiones | comisiones_fecha_first_of_month | CHECK ((EXTRACT(day FROM fecha) = (1)::numeric))
consar.comisiones | comisiones_pct_range | CHECK (((comision >= (0)::numeric) AND (comision <= (100)::numeric)))
consar.comisiones | comisiones_pkey | PRIMARY KEY (fecha, afore_id)
consar.cuenta_administrada | cuenta_administrada_afore_id_fkey | FOREIGN KEY (afore_id) REFERENCES consar.afores(id) ON DELETE RESTRICT
consar.cuenta_administrada | cuenta_administrada_fecha_first_of_month | CHECK ((EXTRACT(day FROM fecha) = (1)::numeric))
consar.cuenta_administrada | cuenta_administrada_metrica_id_fkey | FOREIGN KEY (metrica_id) REFERENCES consar.cat_metrica_cuenta(id) ON DELETE RESTRICT
consar.cuenta_administrada | cuenta_administrada_pkey | PRIMARY KEY (fecha, afore_id, metrica_id)
consar.cuenta_administrada_agg | cuenta_administrada_agg_etiqueta_id_fkey | FOREIGN KEY (etiqueta_id) REFERENCES consar.cat_cuenta_etiqueta_agg(id) ON DELETE RESTRICT
consar.cuenta_administrada_agg | cuenta_administrada_agg_fecha_first_of_month | CHECK ((EXTRACT(day FROM fecha) = (1)::numeric))
consar.cuenta_administrada_agg | cuenta_administrada_agg_metrica_id_fkey | FOREIGN KEY (metrica_id) REFERENCES consar.cat_metrica_cuenta(id) ON DELETE RESTRICT
consar.cuenta_administrada_agg | cuenta_administrada_agg_pkey | PRIMARY KEY (fecha, etiqueta_id, metrica_id)
consar.flujo_recurso | flujo_fecha_first_of_month | CHECK ((EXTRACT(day FROM fecha) = (1)::numeric))
consar.flujo_recurso | flujo_montos_no_neg | CHECK (((montos_entradas >= (0)::numeric) AND (montos_salidas >= (0)::numeric)))
consar.flujo_recurso | flujo_recurso_afore_id_fkey | FOREIGN KEY (afore_id) REFERENCES consar.afores(id) ON DELETE RESTRICT
consar.flujo_recurso | flujo_recurso_pkey | PRIMARY KEY (fecha, afore_id)
consar.medida_sensibilidad | medida_sensibilidad_afore_id_fkey | FOREIGN KEY (afore_id) REFERENCES consar.afores(id) ON DELETE RESTRICT
consar.medida_sensibilidad | medida_sensibilidad_fecha_first_of_month | CHECK ((EXTRACT(day FROM fecha) = (1)::numeric))
consar.medida_sensibilidad | medida_sensibilidad_metrica_id_fkey | FOREIGN KEY (metrica_id) REFERENCES consar.cat_metrica_sensibilidad(id) ON DELETE RESTRICT
consar.medida_sensibilidad | medida_sensibilidad_pkey | PRIMARY KEY (fecha, afore_id, siefore_id, metrica_id)
consar.medida_sensibilidad | medida_sensibilidad_siefore_id_fkey | FOREIGN KEY (siefore_id) REFERENCES consar.cat_siefore(id) ON DELETE RESTRICT
consar.pea_cotizantes | pea_anio_range | CHECK (((anio >= 1990) AND (anio <= 2100)))
consar.pea_cotizantes | pea_cotizantes_le_pea | CHECK ((cotizantes <= pea))
consar.pea_cotizantes | pea_cotizantes_pkey | PRIMARY KEY (anio)
consar.pea_cotizantes | pea_pct_range | CHECK (((porcentaje_pea_afore >= (0)::numeric) AND (porcentaje_pea_afore <= (100)::numeric)))
consar.precio_bolsa | precio_bolsa_afore_id_fkey | FOREIGN KEY (afore_id) REFERENCES consar.afores(id) ON DELETE RESTRICT
consar.precio_bolsa | precio_bolsa_pkey | PRIMARY KEY (fecha, afore_id, siefore_id)
consar.precio_bolsa | precio_bolsa_siefore_id_fkey | FOREIGN KEY (siefore_id) REFERENCES consar.cat_siefore(id) ON DELETE RESTRICT
consar.precio_gestion | precio_gestion_afore_id_fkey | FOREIGN KEY (afore_id) REFERENCES consar.afores(id) ON DELETE RESTRICT
consar.precio_gestion | precio_gestion_pkey | PRIMARY KEY (fecha, afore_id, siefore_id)
consar.precio_gestion | precio_gestion_siefore_id_fkey | FOREIGN KEY (siefore_id) REFERENCES consar.cat_siefore(id) ON DELETE RESTRICT
consar.recursos_mensuales | recursos_fecha_first_of_month | CHECK ((EXTRACT(day FROM fecha) = (1)::numeric))
consar.recursos_mensuales | recursos_mensuales_afore_id_fkey | FOREIGN KEY (afore_id) REFERENCES consar.afores(id) ON DELETE RESTRICT
consar.recursos_mensuales | recursos_mensuales_pkey | PRIMARY KEY (fecha, afore_id, tipo_recurso_id)
consar.recursos_mensuales | recursos_mensuales_tipo_recurso_id_fkey | FOREIGN KEY (tipo_recurso_id) REFERENCES consar.tipos_recurso(id) ON DELETE RESTRICT
consar.recursos_mensuales | recursos_monto_nonneg | CHECK ((monto_mxn_mm >= (0)::numeric))
consar.rendimiento | rendimiento_afore_id_fkey | FOREIGN KEY (afore_id) REFERENCES consar.afores(id) ON DELETE RESTRICT
consar.rendimiento | rendimiento_fecha_first_of_month | CHECK ((EXTRACT(day FROM fecha) = (1)::numeric))
consar.rendimiento | rendimiento_pkey | PRIMARY KEY (afore_id, siefore_id, fecha, plazo)
consar.rendimiento | rendimiento_plazo_ck | CHECK (((plazo)::text = ANY ((ARRAY['12_meses'::character varying, '24_meses'::character varying, '36_meses'::character varying, '5_anios'::character varying, 'historico'::character varying])::text[])))
consar.rendimiento | rendimiento_siefore_id_fkey | FOREIGN KEY (siefore_id) REFERENCES consar.cat_siefore(id) ON DELETE RESTRICT
consar.rendimiento_sis | rendimiento_sis_fecha_first_of_month | CHECK ((EXTRACT(day FROM fecha) = (1)::numeric))
consar.rendimiento_sis | rendimiento_sis_pkey | PRIMARY KEY (siefore_id, fecha, plazo)
consar.rendimiento_sis | rendimiento_sis_plazo_ck | CHECK (((plazo)::text = ANY ((ARRAY['12_meses'::character varying, '24_meses'::character varying, '36_meses'::character varying, '5_anios'::character varying, 'historico'::character varying])::text[])))
consar.rendimiento_sis | rendimiento_sis_siefore_id_fkey | FOREIGN KEY (siefore_id) REFERENCES consar.cat_siefore(id) ON DELETE RESTRICT
consar.tipos_recurso | tipos_recurso_categoria_ck | CHECK (((categoria)::text = ANY ((ARRAY['component'::character varying, 'aggregate'::character varying, 'total'::character varying, 'operativo'::character varying])::text[])))
consar.tipos_recurso | tipos_recurso_codigo_key | UNIQUE (codigo)
consar.tipos_recurso | tipos_recurso_columna_csv_key | UNIQUE (columna_csv)
consar.tipos_recurso | tipos_recurso_pkey | PRIMARY KEY (id)
consar.traspaso | traspaso_afore_id_fkey | FOREIGN KEY (afore_id) REFERENCES consar.afores(id) ON DELETE RESTRICT
consar.traspaso | traspaso_fecha_first_of_month | CHECK ((EXTRACT(day FROM fecha) = (1)::numeric))
consar.traspaso | traspaso_no_neg | CHECK ((((num_tras_cedido IS NULL) OR (num_tras_cedido >= 0)) AND ((num_tras_recibido IS NULL) OR (num_tras_recibido >= 0))))
consar.traspaso | traspaso_pkey | PRIMARY KEY (fecha, afore_id)

# consar — índices
CREATE UNIQUE INDEX activo_neto_pkey ON consar.activo_neto USING btree (afore_id, siefore_id, fecha)
CREATE INDEX idx_activo_neto_fecha ON consar.activo_neto USING btree (fecha)
CREATE INDEX idx_activo_neto_siefore_fecha ON consar.activo_neto USING btree (siefore_id, fecha)
CREATE UNIQUE INDEX activo_neto_agg_pkey ON consar.activo_neto_agg USING btree (afore_id, categoria, fecha)
CREATE INDEX idx_activo_neto_agg_categoria ON consar.activo_neto_agg USING btree (categoria)
CREATE INDEX idx_activo_neto_agg_fecha ON consar.activo_neto_agg USING btree (fecha)
CREATE UNIQUE INDEX afore_alias_pkey ON consar.afore_alias USING btree (alias_text)
CREATE INDEX idx_afore_alias_afore_id ON consar.afore_alias USING btree (afore_id)
CREATE UNIQUE INDEX afore_siefore_alias_pkey ON consar.afore_siefore_alias USING btree (alias_text)
CREATE INDEX idx_afore_siefore_alias_afore_id ON consar.afore_siefore_alias USING btree (afore_id)
CREATE INDEX idx_afore_siefore_alias_fuente ON consar.afore_siefore_alias USING btree (fuente_csv)
CREATE INDEX idx_afore_siefore_alias_siefore_id ON consar.afore_siefore_alias USING btree (siefore_id)
CREATE INDEX idx_afore_siefore_alias_validated ON consar.afore_siefore_alias USING btree (mapping_validated)
CREATE UNIQUE INDEX afores_codigo_key ON consar.afores USING btree (codigo)
CREATE UNIQUE INDEX afores_nombre_csv_key ON consar.afores USING btree (nombre_csv)
CREATE UNIQUE INDEX afores_pkey ON consar.afores USING btree (id)
CREATE UNIQUE INDEX cat_cuenta_etiqueta_agg_csv_string_key ON consar.cat_cuenta_etiqueta_agg USING btree (csv_string)
CREATE UNIQUE INDEX cat_cuenta_etiqueta_agg_pkey ON consar.cat_cuenta_etiqueta_agg USING btree (id)
CREATE UNIQUE INDEX cat_cuenta_etiqueta_agg_slug_key ON consar.cat_cuenta_etiqueta_agg USING btree (slug)
CREATE INDEX idx_cat_cuenta_etiqueta_agg_categoria ON consar.cat_cuenta_etiqueta_agg USING btree (categoria)
CREATE UNIQUE INDEX cat_metrica_cuenta_columna_csv_key ON consar.cat_metrica_cuenta USING btree (columna_csv)
CREATE UNIQUE INDEX cat_metrica_cuenta_pkey ON consar.cat_metrica_cuenta USING btree (id)
CREATE UNIQUE INDEX cat_metrica_cuenta_slug_key ON consar.cat_metrica_cuenta USING btree (slug)
CREATE INDEX idx_cat_metrica_cuenta_slug ON consar.cat_metrica_cuenta USING btree (slug)
CREATE UNIQUE INDEX cat_metrica_sensibilidad_columna_csv_key ON consar.cat_metrica_sensibilidad USING btree (columna_csv)
CREATE UNIQUE INDEX cat_metrica_sensibilidad_pkey ON consar.cat_metrica_sensibilidad USING btree (id)
CREATE UNIQUE INDEX cat_metrica_sensibilidad_slug_key ON consar.cat_metrica_sensibilidad USING btree (slug)
CREATE INDEX idx_cat_metrica_sensibilidad_slug ON consar.cat_metrica_sensibilidad USING btree (slug)
CREATE UNIQUE INDEX cat_siefore_pkey ON consar.cat_siefore USING btree (id)
CREATE UNIQUE INDEX cat_siefore_slug_key ON consar.cat_siefore USING btree (slug)
CREATE INDEX idx_cat_siefore_categoria ON consar.cat_siefore USING btree (categoria)
CREATE INDEX idx_cat_siefore_vigente ON consar.cat_siefore USING btree (vigente)
CREATE UNIQUE INDEX comisiones_pkey ON consar.comisiones USING btree (fecha, afore_id)
CREATE INDEX idx_consar_comisiones_afore_fecha ON consar.comisiones USING btree (afore_id, fecha)
CREATE UNIQUE INDEX cuenta_administrada_pkey ON consar.cuenta_administrada USING btree (fecha, afore_id, metrica_id)
CREATE INDEX idx_cuenta_administrada_afore_metrica ON consar.cuenta_administrada USING btree (afore_id, metrica_id, fecha)
CREATE INDEX idx_cuenta_administrada_metrica_fecha ON consar.cuenta_administrada USING btree (metrica_id, fecha)
CREATE UNIQUE INDEX cuenta_administrada_agg_pkey ON consar.cuenta_administrada_agg USING btree (fecha, etiqueta_id, metrica_id)
CREATE INDEX idx_cuenta_administrada_agg_etiqueta_metrica ON consar.cuenta_administrada_agg USING btree (etiqueta_id, metrica_id, fecha)
CREATE INDEX idx_cuenta_administrada_agg_metrica_fecha ON consar.cuenta_administrada_agg USING btree (metrica_id, fecha)
CREATE UNIQUE INDEX flujo_recurso_pkey ON consar.flujo_recurso USING btree (fecha, afore_id)
CREATE INDEX idx_consar_flujo_afore_fecha ON consar.flujo_recurso USING btree (afore_id, fecha)
CREATE INDEX idx_medida_sensibilidad_afore_metrica ON consar.medida_sensibilidad USING btree (afore_id, metrica_id, fecha)
CREATE INDEX idx_medida_sensibilidad_metrica_fecha ON consar.medida_sensibilidad USING btree (metrica_id, fecha)
CREATE INDEX idx_medida_sensibilidad_siefore_metrica ON consar.medida_sensibilidad USING btree (siefore_id, metrica_id, fecha)
CREATE UNIQUE INDEX medida_sensibilidad_pkey ON consar.medida_sensibilidad USING btree (fecha, afore_id, siefore_id, metrica_id)
CREATE UNIQUE INDEX pea_cotizantes_pkey ON consar.pea_cotizantes USING btree (anio)
CREATE INDEX idx_precio_bolsa_afore_siefore ON consar.precio_bolsa USING btree (afore_id, siefore_id, fecha)
CREATE INDEX idx_precio_bolsa_siefore_fecha ON consar.precio_bolsa USING btree (siefore_id, fecha)
CREATE UNIQUE INDEX precio_bolsa_pkey ON consar.precio_bolsa USING btree (fecha, afore_id, siefore_id)
CREATE INDEX idx_precio_gestion_afore_siefore ON consar.precio_gestion USING btree (afore_id, siefore_id, fecha)
CREATE INDEX idx_precio_gestion_siefore_fecha ON consar.precio_gestion USING btree (siefore_id, fecha)
CREATE UNIQUE INDEX precio_gestion_pkey ON consar.precio_gestion USING btree (fecha, afore_id, siefore_id)
CREATE INDEX idx_consar_recursos_afore_fecha ON consar.recursos_mensuales USING btree (afore_id, fecha)
CREATE INDEX idx_consar_recursos_tipo_fecha ON consar.recursos_mensuales USING btree (tipo_recurso_id, fecha)
CREATE UNIQUE INDEX recursos_mensuales_pkey ON consar.recursos_mensuales USING btree (fecha, afore_id, tipo_recurso_id)
CREATE INDEX idx_rendimiento_fecha ON consar.rendimiento USING btree (fecha)
CREATE INDEX idx_rendimiento_plazo_fecha ON consar.rendimiento USING btree (plazo, fecha)
CREATE INDEX idx_rendimiento_siefore_fecha ON consar.rendimiento USING btree (siefore_id, fecha)
CREATE UNIQUE INDEX rendimiento_pkey ON consar.rendimiento USING btree (afore_id, siefore_id, fecha, plazo)
CREATE INDEX idx_rendimiento_sis_fecha ON consar.rendimiento_sis USING btree (fecha)
CREATE INDEX idx_rendimiento_sis_plazo_fecha ON consar.rendimiento_sis USING btree (plazo, fecha)
CREATE UNIQUE INDEX rendimiento_sis_pkey ON consar.rendimiento_sis USING btree (siefore_id, fecha, plazo)
CREATE UNIQUE INDEX tipos_recurso_codigo_key ON consar.tipos_recurso USING btree (codigo)
CREATE UNIQUE INDEX tipos_recurso_columna_csv_key ON consar.tipos_recurso USING btree (columna_csv)
CREATE UNIQUE INDEX tipos_recurso_pkey ON consar.tipos_recurso USING btree (id)
CREATE UNIQUE INDEX tipos_recurso_single_total_sar ON consar.tipos_recurso USING btree (es_total_sar) WHERE (es_total_sar = true)
CREATE INDEX idx_consar_traspaso_afore_fecha ON consar.traspaso USING btree (afore_id, fecha)
CREATE UNIQUE INDEX traspaso_pkey ON consar.traspaso USING btree (fecha, afore_id)

# consar — vistas

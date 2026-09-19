# enoe — columnas (tabla | columna | tipo | nulo | default)
cargas | id | bigint num(64,0) | NO | nextval('enoe.cargas_id_seq'::regclass)
cargas | periodo | character(6) | NO | 
cargas | archivo | character varying(20) | NO | 
cargas | md5_origen | character(32) | YES | 
cargas | url_origen | text | YES | 
cargas | bytes_origen | bigint num(64,0) | YES | 
cargas | filas_leidas | integer num(32,0) | NO | 0
cargas | filas_insertadas | integer num(32,0) | NO | 0
cargas | filas_skip_conflict | integer num(32,0) | NO | 0
cargas | db_target | character varying(10) | NO | 
cargas | iniciado_en | timestamp with time zone | NO | now()
cargas | finalizado_en | timestamp with time zone | YES | 
cargas | duracion_seg | numeric num(10,3) | YES | 
cargas | status | character varying(20) | NO | 'in_progress'::character varying
cargas | error_mensaje | text | YES | 
cargas | bounds_validados | jsonb | YES | 
cat_area_metropolitana | clave | character varying(5) | NO | 
cat_area_metropolitana | nombre | character varying(120) | NO | 
cat_area_metropolitana | ent_principal | character(2) | NO | 
cat_area_metropolitana | autorrepresentada | boolean | NO | true
cat_area_metropolitana | fecha_alta_serie | date | YES | 
cat_area_metropolitana | provisional | boolean | NO | true
cat_clase_actividad | variable | USER-DEFINED | NO | 
cat_clase_actividad | clave | smallint num(16,0) | NO | 
cat_clase_actividad | nombre | character varying(120) | NO | 
cat_clase_actividad | descripcion | text | YES | 
cat_entidad | clave | character(2) | NO | 
cat_entidad | nombre | character varying(100) | NO | 
cat_entidad | abreviatura | character varying(10) | YES | 
estadisticas_globales | tabla | text | NO | 
estadisticas_globales | total_filas | bigint num(64,0) | NO | 
estadisticas_globales | primer_periodo | text | YES | 
estadisticas_globales | ultimo_periodo | text | YES | 
estadisticas_globales | cobertura_temporal | text | YES | 
estadisticas_globales | es_microdatos | boolean | NO | false
estadisticas_globales | actualizado_en | timestamp with time zone | NO | now()
indicadores_anuales_ampliado | periodo | character(6) | NO | 
indicadores_anuales_ampliado | nivel | character varying(20) | NO | 
indicadores_anuales_ampliado | geo_clave | character varying(5) | NO | 
indicadores_anuales_ampliado | indicador | character varying(60) | NO | 
indicadores_anuales_ampliado | valor | numeric num(16,6) | NO | 
indicadores_anuales_ampliado | unidad | character varying(20) | NO | 
indicadores_anuales_ampliado | calculado_en | timestamp with time zone | NO | now()
indicadores_anuales_ampliado | etapa | USER-DEFINED | NO | 
indicadores_area_metropolitana | periodo | character(6) | NO | 
indicadores_area_metropolitana | am_clave | character varying(5) | NO | 
indicadores_area_metropolitana | indicador | character varying(60) | NO | 
indicadores_area_metropolitana | valor | numeric num(16,6) | NO | 
indicadores_area_metropolitana | unidad | character varying(20) | NO | 
indicadores_area_metropolitana | n_muestra | integer num(32,0) | YES | 
indicadores_area_metropolitana | calculado_en | timestamp with time zone | NO | now()
indicadores_area_metropolitana | provisional | boolean | NO | true
indicadores_area_metropolitana | etapa | USER-DEFINED | NO | 
indicadores_entidad | periodo | character(6) | NO | 
indicadores_entidad | entidad_clave | character(2) | NO | 
indicadores_entidad | indicador | character varying(60) | NO | 
indicadores_entidad | valor | numeric num(16,6) | NO | 
indicadores_entidad | unidad | character varying(20) | NO | 
indicadores_entidad | bound_oficial | numeric num(16,6) | YES | 
indicadores_entidad | delta_rel_pct | numeric num(10,6) | YES | 
indicadores_entidad | calculado_en | timestamp with time zone | NO | now()
indicadores_entidad | etapa | USER-DEFINED | NO | 
indicadores_nacionales | periodo | character(6) | NO | 
indicadores_nacionales | indicador | character varying(60) | NO | 
indicadores_nacionales | valor | numeric num(16,6) | NO | 
indicadores_nacionales | unidad | character varying(20) | NO | 
indicadores_nacionales | fuente_calculo | text | NO | 
indicadores_nacionales | bound_oficial | numeric num(16,6) | YES | 
indicadores_nacionales | bound_fuente | text | YES | 
indicadores_nacionales | delta_rel_pct | numeric num(10,6) | YES | 
indicadores_nacionales | calculado_en | timestamp with time zone | NO | now()
indicadores_nacionales | etapa | USER-DEFINED | NO | 
microdatos_coe1 | periodo | character(6) | NO | 
microdatos_coe1 | cd_a | character(2) | NO | 
microdatos_coe1 | ent | character(2) | NO | 
microdatos_coe1 | con | character(5) | NO | 
microdatos_coe1 | v_sel | character(2) | NO | 
microdatos_coe1 | n_hog | smallint num(16,0) | NO | 
microdatos_coe1 | n_ren | smallint num(16,0) | NO | 
microdatos_coe1 | p1 | smallint num(16,0) | YES | 
microdatos_coe1 | p3 | smallint num(16,0) | YES | 
microdatos_coe1 | p3b | smallint num(16,0) | YES | 
microdatos_coe1 | p3i | smallint num(16,0) | YES | 
microdatos_coe1 | p3j | smallint num(16,0) | YES | 
microdatos_coe1 | p3q | smallint num(16,0) | YES | 
microdatos_coe1 | fac_tri | integer num(32,0) | NO | 
microdatos_coe1 | extras_jsonb | jsonb | NO | '{}'::jsonb
microdatos_coe1 | upm | character varying(7) | YES | 
microdatos_coe1 | d_sem | character varying(3) | YES | 
microdatos_coe1 | per | character varying(3) | YES | 
microdatos_coe1 | n_ent | character varying(2) | YES | 
microdatos_coe1 | ur | smallint num(16,0) | YES | 
microdatos_coe1 | fac_men | integer num(32,0) | YES | 
microdatos_coe1 | etapa | USER-DEFINED | NO | 
microdatos_coe2 | periodo | character(6) | NO | 
microdatos_coe2 | cd_a | character(2) | NO | 
microdatos_coe2 | ent | character(2) | NO | 
microdatos_coe2 | con | character(5) | NO | 
microdatos_coe2 | v_sel | character(2) | NO | 
microdatos_coe2 | n_hog | smallint num(16,0) | NO | 
microdatos_coe2 | n_ren | smallint num(16,0) | NO | 
microdatos_coe2 | p6_9 | smallint num(16,0) | YES | 
microdatos_coe2 | p6b1 | smallint num(16,0) | YES | 
microdatos_coe2 | p6b2 | integer num(32,0) | YES | 
microdatos_coe2 | p6c | smallint num(16,0) | YES | 
microdatos_coe2 | p6d | smallint num(16,0) | YES | 
microdatos_coe2 | p6_4 | integer num(32,0) | YES | 
microdatos_coe2 | p9 | smallint num(16,0) | YES | 
microdatos_coe2 | fac_tri | integer num(32,0) | NO | 
microdatos_coe2 | extras_jsonb | jsonb | NO | '{}'::jsonb
microdatos_coe2 | upm | character varying(7) | YES | 
microdatos_coe2 | d_sem | character varying(3) | YES | 
microdatos_coe2 | per | character varying(3) | YES | 
microdatos_coe2 | n_ent | character varying(2) | YES | 
microdatos_coe2 | ur | smallint num(16,0) | YES | 
microdatos_coe2 | fac_men | integer num(32,0) | YES | 
microdatos_coe2 | etapa | USER-DEFINED | NO | 
microdatos_hog | periodo | character(6) | NO | 
microdatos_hog | cd_a | character(2) | NO | 
microdatos_hog | ent | character(2) | NO | 
microdatos_hog | con | character(5) | NO | 
microdatos_hog | v_sel | character(2) | NO | 
microdatos_hog | n_hog | smallint num(16,0) | NO | 
microdatos_hog | h_mud | smallint num(16,0) | YES | 
microdatos_hog | fac_tri | integer num(32,0) | NO | 
microdatos_hog | extras_jsonb | jsonb | NO | '{}'::jsonb
microdatos_hog | est_d_tri | character varying(4) | YES | 
microdatos_hog | est_d_men | character varying(4) | YES | 
microdatos_hog | t_loc_tri | character(1) | YES | 
microdatos_hog | t_loc_men | character(1) | YES | 
microdatos_hog | upm | character varying(7) | YES | 
microdatos_hog | est | character(2) | YES | 
microdatos_hog | d_sem | character varying(3) | YES | 
microdatos_hog | per | character varying(3) | YES | 
microdatos_hog | n_ent | character varying(2) | YES | 
microdatos_hog | ur | smallint num(16,0) | YES | 
microdatos_hog | fac_men | integer num(32,0) | YES | 
microdatos_hog | r_def | character varying(2) | YES | 
microdatos_hog | tipolev | character(1) | YES | 
microdatos_hog | inf | character varying(2) | YES | 
microdatos_hog | r_pre | character varying(2) | YES | 
microdatos_hog | etapa | USER-DEFINED | NO | 
microdatos_sdem | periodo | character(6) | NO | 
microdatos_sdem | cd_a | character(2) | NO | 
microdatos_sdem | ent | character(2) | NO | 
microdatos_sdem | con | character(5) | NO | 
microdatos_sdem | v_sel | character(2) | NO | 
microdatos_sdem | n_hog | smallint num(16,0) | NO | 
microdatos_sdem | n_ren | smallint num(16,0) | NO | 
microdatos_sdem | sex | smallint num(16,0) | NO | 
microdatos_sdem | eda | smallint num(16,0) | NO | 
microdatos_sdem | par_c | character varying(3) | YES | 
microdatos_sdem | e_con | smallint num(16,0) | YES | 
microdatos_sdem | r_def | smallint num(16,0) | YES | 
microdatos_sdem | nac_dia | character varying(2) | YES | 
microdatos_sdem | nac_mes | character varying(2) | YES | 
microdatos_sdem | nac_anio | character varying(4) | YES | 
microdatos_sdem | dur_est | smallint num(16,0) | YES | 
microdatos_sdem | cs_p13_1 | character varying(2) | YES | 
microdatos_sdem | cs_p13_2 | character varying(2) | YES | 
microdatos_sdem | cs_p14_c | character varying(6) | YES | 
microdatos_sdem | cs_p15 | smallint num(16,0) | YES | 
microdatos_sdem | cs_p17 | smallint num(16,0) | YES | 
microdatos_sdem | clase1 | smallint num(16,0) | YES | 
microdatos_sdem | clase2 | smallint num(16,0) | YES | 
microdatos_sdem | clase3 | smallint num(16,0) | YES | 
microdatos_sdem | fac_tri | integer num(32,0) | NO | 
microdatos_sdem | extras_jsonb | jsonb | NO | '{}'::jsonb
microdatos_sdem | c_res | smallint num(16,0) | YES | 
microdatos_sdem | pos_ocu | smallint num(16,0) | YES | 
microdatos_sdem | rama | smallint num(16,0) | YES | 
microdatos_sdem | rama_est1 | smallint num(16,0) | YES | 
microdatos_sdem | rama_est2 | smallint num(16,0) | YES | 
microdatos_sdem | scian | smallint num(16,0) | YES | 
microdatos_sdem | ingocup | integer num(32,0) | YES | 
microdatos_sdem | ing7c | smallint num(16,0) | YES | 
microdatos_sdem | ing_x_hrs | numeric num(17,5) | YES | 
microdatos_sdem | salario | integer num(32,0) | YES | 
microdatos_sdem | sub_o | smallint num(16,0) | YES | 
microdatos_sdem | imssissste | smallint num(16,0) | YES | 
microdatos_sdem | hrsocup | smallint num(16,0) | YES | 
microdatos_sdem | tcco | smallint num(16,0) | YES | 
microdatos_sdem | seg_soc | smallint num(16,0) | YES | 
microdatos_sdem | dur_des | smallint num(16,0) | YES | 
microdatos_sdem | niv_ins | smallint num(16,0) | YES | 
microdatos_sdem | c_ocu11c | smallint num(16,0) | YES | 
microdatos_sdem | c_inac5c | smallint num(16,0) | YES | 
microdatos_sdem | tue1 | smallint num(16,0) | YES | 
microdatos_sdem | tue2 | smallint num(16,0) | YES | 
microdatos_sdem | tue3 | smallint num(16,0) | YES | 
microdatos_sdem | tue_ppal | smallint num(16,0) | YES | 
microdatos_sdem | anios_esc | smallint num(16,0) | YES | 
microdatos_sdem | n_hij | character varying(2) | YES | 
microdatos_sdem | eda5c | smallint num(16,0) | YES | 
microdatos_sdem | eda7c | smallint num(16,0) | YES | 
microdatos_sdem | eda12c | smallint num(16,0) | YES | 
microdatos_sdem | eda19c | smallint num(16,0) | YES | 
microdatos_sdem | est_d_tri | character varying(4) | YES | 
microdatos_sdem | est_d_men | character varying(4) | YES | 
microdatos_sdem | t_loc_tri | character(1) | YES | 
microdatos_sdem | t_loc_men | character(1) | YES | 
microdatos_sdem | upm | character varying(7) | YES | 
microdatos_sdem | est | character(2) | YES | 
microdatos_sdem | d_sem | character varying(3) | YES | 
microdatos_sdem | per | character varying(3) | YES | 
microdatos_sdem | n_ent | character varying(2) | YES | 
microdatos_sdem | ur | smallint num(16,0) | YES | 
microdatos_sdem | fac_men | integer num(32,0) | YES | 
microdatos_sdem | ambito1 | smallint num(16,0) | YES | 
microdatos_sdem | ambito2 | smallint num(16,0) | YES | 
microdatos_sdem | buscar5c | smallint num(16,0) | YES | 
microdatos_sdem | pre_asa | smallint num(16,0) | YES | 
microdatos_sdem | tip_con | smallint num(16,0) | YES | 
microdatos_sdem | t_tra | smallint num(16,0) | YES | 
microdatos_sdem | mh_col | smallint num(16,0) | YES | 
microdatos_sdem | mh_fil2 | smallint num(16,0) | YES | 
microdatos_sdem | zona | smallint num(16,0) | YES | 
microdatos_sdem | medica5c | smallint num(16,0) | YES | 
microdatos_sdem | domestico | smallint num(16,0) | YES | 
microdatos_sdem | dispo | smallint num(16,0) | YES | 
microdatos_sdem | nodispo | smallint num(16,0) | YES | 
microdatos_sdem | busqueda | smallint num(16,0) | YES | 
microdatos_sdem | pnea_est | smallint num(16,0) | YES | 
microdatos_sdem | etapa | USER-DEFINED | NO | 
microdatos_viv | periodo | character(6) | NO | 
microdatos_viv | cd_a | character(2) | NO | 
microdatos_viv | ent | character(2) | NO | 
microdatos_viv | con | character(5) | NO | 
microdatos_viv | v_sel | character(2) | NO | 
microdatos_viv | tipo | character(1) | YES | 
microdatos_viv | mes_cal | character(2) | YES | 
microdatos_viv | n_pro_viv | smallint num(16,0) | YES | 
microdatos_viv | mun | character(3) | YES | 
microdatos_viv | loc | character(4) | YES | 
microdatos_viv | ageb | character varying(5) | YES | 
microdatos_viv | fac_tri | integer num(32,0) | NO | 
microdatos_viv | extras_jsonb | jsonb | NO | '{}'::jsonb
microdatos_viv | est_d_tri | character varying(4) | YES | 
microdatos_viv | est_d_men | character varying(4) | YES | 
microdatos_viv | t_loc_tri | character(1) | YES | 
microdatos_viv | t_loc_men | character(1) | YES | 
microdatos_viv | upm | character varying(7) | YES | 
microdatos_viv | est | character(2) | YES | 
microdatos_viv | d_sem | character varying(3) | YES | 
microdatos_viv | per | character varying(3) | YES | 
microdatos_viv | n_ent | character varying(2) | YES | 
microdatos_viv | ur | smallint num(16,0) | YES | 
microdatos_viv | fac_men | integer num(32,0) | YES | 
microdatos_viv | etapa | USER-DEFINED | NO | 
poblacion_ocupada_por_posicion | periodo | character(6) | NO | 
poblacion_ocupada_por_posicion | nivel | character varying(20) | NO | 
poblacion_ocupada_por_posicion | geo_clave | character varying(5) | NO | 
poblacion_ocupada_por_posicion | pos_clave | smallint num(16,0) | NO | 
poblacion_ocupada_por_posicion | total_personas | bigint num(64,0) | NO | 
poblacion_ocupada_por_posicion | pct_ocupados | numeric num(8,4) | YES | 
poblacion_ocupada_por_posicion | etapa | USER-DEFINED | NO | 
poblacion_ocupada_por_sector | periodo | character(6) | NO | 
poblacion_ocupada_por_sector | nivel | character varying(20) | NO | 
poblacion_ocupada_por_sector | geo_clave | character varying(5) | NO | 
poblacion_ocupada_por_sector | sector_clave | character varying(2) | NO | 
poblacion_ocupada_por_sector | total_personas | bigint num(64,0) | NO | 
poblacion_ocupada_por_sector | pct_ocupados | numeric num(8,4) | YES | 
poblacion_ocupada_por_sector | etapa | USER-DEFINED | NO | 

# enoe — constraints
enoe.cargas | cargas_pkey | PRIMARY KEY (id)
enoe.cat_area_metropolitana | cat_area_metropolitana_ent_principal_fkey | FOREIGN KEY (ent_principal) REFERENCES enoe.cat_entidad(clave)
enoe.cat_area_metropolitana | cat_area_metropolitana_pkey | PRIMARY KEY (clave)
enoe.cat_clase_actividad | cat_clase_actividad_pkey | PRIMARY KEY (variable, clave)
enoe.cat_entidad | cat_entidad_pkey | PRIMARY KEY (clave)
enoe.estadisticas_globales | chk_total_filas_nonneg | CHECK ((total_filas >= 0))
enoe.estadisticas_globales | estadisticas_globales_pkey | PRIMARY KEY (tabla)
enoe.indicadores_anuales_ampliado | chk_etapa_periodo | CHECK ((((etapa = 'clasica'::enoe.etapa_metodologica) AND (periodo >= '2005T1'::bpchar) AND (periodo <= '2020T1'::bpchar)) OR ((etapa = 'etoe_telefonica'::enoe.etapa_metodologica) AND (periodo = '2020T2'::bpchar)) OR ((etapa = 'enoe_n'::enoe.etapa_metodologica) AND (periodo >= '2020T3'::bpchar))))
enoe.indicadores_anuales_ampliado | chk_solo_t1 | CHECK ((SUBSTRING(periodo FROM 5 FOR 2) = 'T1'::text))
enoe.indicadores_anuales_ampliado | indicadores_anuales_ampliado_pkey | PRIMARY KEY (periodo, nivel, geo_clave, indicador)
enoe.indicadores_area_metropolitana | chk_etapa_periodo | CHECK ((((etapa = 'clasica'::enoe.etapa_metodologica) AND (periodo >= '2005T1'::bpchar) AND (periodo <= '2020T1'::bpchar)) OR ((etapa = 'etoe_telefonica'::enoe.etapa_metodologica) AND (periodo = '2020T2'::bpchar)) OR ((etapa = 'enoe_n'::enoe.etapa_metodologica) AND (periodo >= '2020T3'::bpchar))))
enoe.indicadores_area_metropolitana | indicadores_area_metropolitana_am_clave_fkey | FOREIGN KEY (am_clave) REFERENCES enoe.cat_area_metropolitana(clave)
enoe.indicadores_area_metropolitana | indicadores_area_metropolitana_pkey | PRIMARY KEY (periodo, am_clave, indicador)
enoe.indicadores_entidad | chk_etapa_periodo | CHECK ((((etapa = 'clasica'::enoe.etapa_metodologica) AND (periodo >= '2005T1'::bpchar) AND (periodo <= '2020T1'::bpchar)) OR ((etapa = 'etoe_telefonica'::enoe.etapa_metodologica) AND (periodo = '2020T2'::bpchar)) OR ((etapa = 'enoe_n'::enoe.etapa_metodologica) AND (periodo >= '2020T3'::bpchar))))
enoe.indicadores_entidad | indicadores_entidad_entidad_clave_fkey | FOREIGN KEY (entidad_clave) REFERENCES enoe.cat_entidad(clave)
enoe.indicadores_entidad | indicadores_entidad_pkey | PRIMARY KEY (periodo, entidad_clave, indicador)
enoe.indicadores_nacionales | chk_etapa_periodo | CHECK ((((etapa = 'clasica'::enoe.etapa_metodologica) AND (periodo >= '2005T1'::bpchar) AND (periodo <= '2020T1'::bpchar)) OR ((etapa = 'etoe_telefonica'::enoe.etapa_metodologica) AND (periodo = '2020T2'::bpchar)) OR ((etapa = 'enoe_n'::enoe.etapa_metodologica) AND (periodo >= '2020T3'::bpchar))))
enoe.indicadores_nacionales | indicadores_nacionales_pkey | PRIMARY KEY (periodo, indicador)
enoe.microdatos_coe1 | chk_etapa_periodo | CHECK ((((etapa = 'clasica'::enoe.etapa_metodologica) AND (periodo >= '2005T1'::bpchar) AND (periodo <= '2020T1'::bpchar)) OR ((etapa = 'etoe_telefonica'::enoe.etapa_metodologica) AND (periodo = '2020T2'::bpchar)) OR ((etapa = 'enoe_n'::enoe.etapa_metodologica) AND (periodo >= '2020T3'::bpchar))))
enoe.microdatos_coe1 | microdatos_coe1_fac_tri_nonneg | CHECK ((fac_tri >= 0))
enoe.microdatos_coe1 | microdatos_coe1_pkey | PRIMARY KEY (periodo, cd_a, ent, con, v_sel, n_hog, n_ren)
enoe.microdatos_coe2 | chk_etapa_periodo | CHECK ((((etapa = 'clasica'::enoe.etapa_metodologica) AND (periodo >= '2005T1'::bpchar) AND (periodo <= '2020T1'::bpchar)) OR ((etapa = 'etoe_telefonica'::enoe.etapa_metodologica) AND (periodo = '2020T2'::bpchar)) OR ((etapa = 'enoe_n'::enoe.etapa_metodologica) AND (periodo >= '2020T3'::bpchar))))
enoe.microdatos_coe2 | microdatos_coe2_fac_tri_nonneg | CHECK ((fac_tri >= 0))
enoe.microdatos_coe2 | microdatos_coe2_pkey | PRIMARY KEY (periodo, cd_a, ent, con, v_sel, n_hog, n_ren)
enoe.microdatos_hog | chk_etapa_periodo | CHECK ((((etapa = 'clasica'::enoe.etapa_metodologica) AND (periodo >= '2005T1'::bpchar) AND (periodo <= '2020T1'::bpchar)) OR ((etapa = 'etoe_telefonica'::enoe.etapa_metodologica) AND (periodo = '2020T2'::bpchar)) OR ((etapa = 'enoe_n'::enoe.etapa_metodologica) AND (periodo >= '2020T3'::bpchar))))
enoe.microdatos_hog | microdatos_hog_fac_tri_nonneg | CHECK ((fac_tri >= 0))
enoe.microdatos_hog | microdatos_hog_pkey | PRIMARY KEY (periodo, cd_a, ent, con, v_sel, n_hog)
enoe.microdatos_sdem | chk_etapa_periodo | CHECK ((((etapa = 'clasica'::enoe.etapa_metodologica) AND (periodo >= '2005T1'::bpchar) AND (periodo <= '2020T1'::bpchar)) OR ((etapa = 'etoe_telefonica'::enoe.etapa_metodologica) AND (periodo = '2020T2'::bpchar)) OR ((etapa = 'enoe_n'::enoe.etapa_metodologica) AND (periodo >= '2020T3'::bpchar))))
enoe.microdatos_sdem | microdatos_sdem_fac_tri_nonneg | CHECK ((fac_tri >= 0))
enoe.microdatos_sdem | microdatos_sdem_pkey | PRIMARY KEY (periodo, cd_a, ent, con, v_sel, n_hog, n_ren)
enoe.microdatos_viv | chk_etapa_periodo | CHECK ((((etapa = 'clasica'::enoe.etapa_metodologica) AND (periodo >= '2005T1'::bpchar) AND (periodo <= '2020T1'::bpchar)) OR ((etapa = 'etoe_telefonica'::enoe.etapa_metodologica) AND (periodo = '2020T2'::bpchar)) OR ((etapa = 'enoe_n'::enoe.etapa_metodologica) AND (periodo >= '2020T3'::bpchar))))
enoe.microdatos_viv | microdatos_viv_fac_tri_nonneg | CHECK ((fac_tri >= 0))
enoe.microdatos_viv | microdatos_viv_pkey | PRIMARY KEY (periodo, cd_a, ent, con, v_sel)
enoe.poblacion_ocupada_por_posicion | chk_etapa_periodo | CHECK ((((etapa = 'clasica'::enoe.etapa_metodologica) AND (periodo >= '2005T1'::bpchar) AND (periodo <= '2020T1'::bpchar)) OR ((etapa = 'etoe_telefonica'::enoe.etapa_metodologica) AND (periodo = '2020T2'::bpchar)) OR ((etapa = 'enoe_n'::enoe.etapa_metodologica) AND (periodo >= '2020T3'::bpchar))))
enoe.poblacion_ocupada_por_posicion | poblacion_ocupada_por_posicion_pkey | PRIMARY KEY (periodo, nivel, geo_clave, pos_clave)
enoe.poblacion_ocupada_por_sector | chk_etapa_periodo | CHECK ((((etapa = 'clasica'::enoe.etapa_metodologica) AND (periodo >= '2005T1'::bpchar) AND (periodo <= '2020T1'::bpchar)) OR ((etapa = 'etoe_telefonica'::enoe.etapa_metodologica) AND (periodo = '2020T2'::bpchar)) OR ((etapa = 'enoe_n'::enoe.etapa_metodologica) AND (periodo >= '2020T3'::bpchar))))
enoe.poblacion_ocupada_por_sector | poblacion_ocupada_por_sector_pkey | PRIMARY KEY (periodo, nivel, geo_clave, sector_clave)

# enoe — índices
CREATE UNIQUE INDEX cargas_pkey ON enoe.cargas USING btree (id)
CREATE INDEX idx_enoe_cargas_periodo_status ON enoe.cargas USING btree (periodo, status, iniciado_en DESC)
CREATE UNIQUE INDEX cat_area_metropolitana_pkey ON enoe.cat_area_metropolitana USING btree (clave)
CREATE UNIQUE INDEX cat_clase_actividad_pkey ON enoe.cat_clase_actividad USING btree (variable, clave)
CREATE UNIQUE INDEX cat_entidad_pkey ON enoe.cat_entidad USING btree (clave)
CREATE UNIQUE INDEX estadisticas_globales_pkey ON enoe.estadisticas_globales USING btree (tabla)
CREATE UNIQUE INDEX indicadores_anuales_ampliado_pkey ON enoe.indicadores_anuales_ampliado USING btree (periodo, nivel, geo_clave, indicador)
CREATE INDEX idx_enoe_ind_am_indicador ON enoe.indicadores_area_metropolitana USING btree (indicador, periodo, am_clave)
CREATE UNIQUE INDEX indicadores_area_metropolitana_pkey ON enoe.indicadores_area_metropolitana USING btree (periodo, am_clave, indicador)
CREATE INDEX idx_enoe_ind_ent_etapa ON enoe.indicadores_entidad USING btree (etapa, entidad_clave, indicador, periodo)
CREATE INDEX idx_enoe_ind_ent_indicador ON enoe.indicadores_entidad USING btree (indicador, periodo, entidad_clave)
CREATE UNIQUE INDEX indicadores_entidad_pkey ON enoe.indicadores_entidad USING btree (periodo, entidad_clave, indicador)
CREATE INDEX idx_enoe_ind_nac_etapa ON enoe.indicadores_nacionales USING btree (etapa, indicador, periodo)
CREATE INDEX idx_enoe_ind_nac_indicador ON enoe.indicadores_nacionales USING btree (indicador, periodo)
CREATE UNIQUE INDEX indicadores_nacionales_pkey ON enoe.indicadores_nacionales USING btree (periodo, indicador)
CREATE INDEX idx_enoe_coe1_periodo_ent ON enoe.microdatos_coe1 USING btree (periodo, ent)
CREATE UNIQUE INDEX microdatos_coe1_pkey ON enoe.microdatos_coe1 USING btree (periodo, cd_a, ent, con, v_sel, n_hog, n_ren)
CREATE INDEX idx_enoe_coe2_periodo_ent ON enoe.microdatos_coe2 USING btree (periodo, ent)
CREATE UNIQUE INDEX microdatos_coe2_pkey ON enoe.microdatos_coe2 USING btree (periodo, cd_a, ent, con, v_sel, n_hog, n_ren)
CREATE INDEX idx_enoe_hog_periodo_ent ON enoe.microdatos_hog USING btree (periodo, ent)
CREATE UNIQUE INDEX microdatos_hog_pkey ON enoe.microdatos_hog USING btree (periodo, cd_a, ent, con, v_sel, n_hog)
CREATE INDEX idx_enoe_sdem_periodo_clase ON enoe.microdatos_sdem USING btree (periodo, clase1, clase2)
CREATE INDEX idx_enoe_sdem_periodo_eda ON enoe.microdatos_sdem USING btree (periodo, eda) WHERE (eda >= 15)
CREATE INDEX idx_enoe_sdem_periodo_ent ON enoe.microdatos_sdem USING btree (periodo, ent)
CREATE UNIQUE INDEX microdatos_sdem_pkey ON enoe.microdatos_sdem USING btree (periodo, cd_a, ent, con, v_sel, n_hog, n_ren)
CREATE INDEX idx_enoe_viv_periodo_ent ON enoe.microdatos_viv USING btree (periodo, ent)
CREATE UNIQUE INDEX microdatos_viv_pkey ON enoe.microdatos_viv USING btree (periodo, cd_a, ent, con, v_sel)
CREATE UNIQUE INDEX poblacion_ocupada_por_posicion_pkey ON enoe.poblacion_ocupada_por_posicion USING btree (periodo, nivel, geo_clave, pos_clave)
CREATE UNIQUE INDEX poblacion_ocupada_por_sector_pkey ON enoe.poblacion_ocupada_por_sector USING btree (periodo, nivel, geo_clave, sector_clave)

# enoe — vistas

# enoe — vistas materializadas

# enoe — conteos
cargas|478
cat_area_metropolitana|39
cat_clase_actividad|16
cat_entidad|32
estadisticas_globales|11
indicadores_anuales_ampliado|0
indicadores_area_metropolitana|0
indicadores_entidad|33280
indicadores_nacionales|1040
poblacion_ocupada_por_posicion|10560
poblacion_ocupada_por_sector|31677

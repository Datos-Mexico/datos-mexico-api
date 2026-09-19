# cdmx — columnas (tabla | columna | tipo | nulo | default)
cat_niveles_salariales | id | integer num(32,0) | NO | nextval('cdmx.cat_niveles_salariales_id_seq'::regclass)
cat_niveles_salariales | clave | integer num(32,0) | NO | 
cat_puestos | id | integer num(32,0) | NO | nextval('cdmx.cat_puestos_id_seq'::regclass)
cat_puestos | nombre | character varying(300) | NO | 
cat_sectores | id | integer num(32,0) | NO | nextval('cdmx.cat_sectores_id_seq'::regclass)
cat_sectores | clave | character varying(20) | NO | 
cat_sectores | nombre | character varying(300) | NO | 
cat_sexos | id | integer num(32,0) | NO | nextval('cdmx.cat_sexos_id_seq'::regclass)
cat_sexos | nombre | character varying(20) | NO | 
cat_tipos_contratacion | id | integer num(32,0) | NO | nextval('cdmx.cat_tipos_contratacion_id_seq'::regclass)
cat_tipos_contratacion | nombre | character varying(100) | NO | 
cat_tipos_nomina | id | integer num(32,0) | NO | nextval('cdmx.cat_tipos_nomina_id_seq'::regclass)
cat_tipos_nomina | clave | integer num(32,0) | NO | 
cat_tipos_personal | id | integer num(32,0) | NO | nextval('cdmx.cat_tipos_personal_id_seq'::regclass)
cat_tipos_personal | nombre | character varying(100) | NO | 
cat_universos | id | integer num(32,0) | NO | nextval('cdmx.cat_universos_id_seq'::regclass)
cat_universos | clave | character varying(10) | NO | 
cat_universos | nombre | character varying(200) | NO | 
nombramientos | id | integer num(32,0) | NO | nextval('cdmx.nombramientos_id_seq'::regclass)
nombramientos | persona_id | integer num(32,0) | NO | 
nombramientos | puesto_id | integer num(32,0) | YES | 
nombramientos | sector_id | integer num(32,0) | YES | 
nombramientos | tipo_nomina_id | integer num(32,0) | YES | 
nombramientos | tipo_contratacion_id | integer num(32,0) | YES | 
nombramientos | tipo_personal_id | integer num(32,0) | YES | 
nombramientos | universo_id | integer num(32,0) | YES | 
nombramientos | nivel_salarial_id | integer num(32,0) | YES | 
nombramientos | fecha_ingreso | date | YES | 
nombramientos | sueldo_bruto | numeric num(12,2) | YES | 
nombramientos | sueldo_neto | numeric num(12,2) | YES | 
personas | id | integer num(32,0) | NO | nextval('cdmx.personas_id_seq'::regclass)
personas | nombre | character varying(200) | NO | 
personas | apellido_1 | character varying(200) | NO | 
personas | apellido_2 | character varying(200) | YES | 
personas | sexo_id | integer num(32,0) | YES | 
personas | edad | integer num(32,0) | YES | 
v_servidores_publicos | id | integer num(32,0) | YES | 
v_servidores_publicos | nombre | character varying(200) | YES | 
v_servidores_publicos | apellido_1 | character varying(200) | YES | 
v_servidores_publicos | apellido_2 | character varying(200) | YES | 
v_servidores_publicos | sexo | character varying(20) | YES | 
v_servidores_publicos | edad | integer num(32,0) | YES | 
v_servidores_publicos | puesto_id | integer num(32,0) | YES | 
v_servidores_publicos | tipo_nomina_id | integer num(32,0) | YES | 
v_servidores_publicos | tipo_contratacion_id | integer num(32,0) | YES | 
v_servidores_publicos | tipo_personal_id | integer num(32,0) | YES | 
v_servidores_publicos | fecha_ingreso | date | YES | 
v_servidores_publicos | universo_id | integer num(32,0) | YES | 
v_servidores_publicos | sector_id | integer num(32,0) | YES | 
v_servidores_publicos | id_nivel_salarial | integer num(32,0) | YES | 
v_servidores_publicos | sueldo_bruto | numeric num(12,2) | YES | 
v_servidores_publicos | sueldo_neto | numeric num(12,2) | YES | 

# cdmx — constraints
cdmx.cat_niveles_salariales | cat_niveles_salariales_clave_key | UNIQUE (clave)
cdmx.cat_niveles_salariales | cat_niveles_salariales_pkey | PRIMARY KEY (id)
cdmx.cat_puestos | cat_puestos_nombre_key | UNIQUE (nombre)
cdmx.cat_puestos | cat_puestos_pkey | PRIMARY KEY (id)
cdmx.cat_sectores | cat_sectores_clave_key | UNIQUE (clave)
cdmx.cat_sectores | cat_sectores_pkey | PRIMARY KEY (id)
cdmx.cat_sexos | cat_sexos_nombre_key | UNIQUE (nombre)
cdmx.cat_sexos | cat_sexos_pkey | PRIMARY KEY (id)
cdmx.cat_tipos_contratacion | cat_tipos_contratacion_nombre_key | UNIQUE (nombre)
cdmx.cat_tipos_contratacion | cat_tipos_contratacion_pkey | PRIMARY KEY (id)
cdmx.cat_tipos_nomina | cat_tipos_nomina_clave_key | UNIQUE (clave)
cdmx.cat_tipos_nomina | cat_tipos_nomina_pkey | PRIMARY KEY (id)
cdmx.cat_tipos_personal | cat_tipos_personal_nombre_key | UNIQUE (nombre)
cdmx.cat_tipos_personal | cat_tipos_personal_pkey | PRIMARY KEY (id)
cdmx.cat_universos | cat_universos_clave_key | UNIQUE (clave)
cdmx.cat_universos | cat_universos_pkey | PRIMARY KEY (id)
cdmx.nombramientos | nombramientos_nivel_salarial_id_fkey | FOREIGN KEY (nivel_salarial_id) REFERENCES cdmx.cat_niveles_salariales(id)
cdmx.nombramientos | nombramientos_persona_id_fkey | FOREIGN KEY (persona_id) REFERENCES cdmx.personas(id)
cdmx.nombramientos | nombramientos_pkey | PRIMARY KEY (id)
cdmx.nombramientos | nombramientos_puesto_id_fkey | FOREIGN KEY (puesto_id) REFERENCES cdmx.cat_puestos(id)
cdmx.nombramientos | nombramientos_sector_id_fkey | FOREIGN KEY (sector_id) REFERENCES cdmx.cat_sectores(id)
cdmx.nombramientos | nombramientos_tipo_contratacion_id_fkey | FOREIGN KEY (tipo_contratacion_id) REFERENCES cdmx.cat_tipos_contratacion(id)
cdmx.nombramientos | nombramientos_tipo_nomina_id_fkey | FOREIGN KEY (tipo_nomina_id) REFERENCES cdmx.cat_tipos_nomina(id)
cdmx.nombramientos | nombramientos_tipo_personal_id_fkey | FOREIGN KEY (tipo_personal_id) REFERENCES cdmx.cat_tipos_personal(id)
cdmx.nombramientos | nombramientos_universo_id_fkey | FOREIGN KEY (universo_id) REFERENCES cdmx.cat_universos(id)
cdmx.personas | personas_pkey | PRIMARY KEY (id)
cdmx.personas | personas_sexo_id_fkey | FOREIGN KEY (sexo_id) REFERENCES cdmx.cat_sexos(id)

# cdmx — índices
CREATE UNIQUE INDEX cat_niveles_salariales_clave_key ON cdmx.cat_niveles_salariales USING btree (clave)
CREATE UNIQUE INDEX cat_niveles_salariales_pkey ON cdmx.cat_niveles_salariales USING btree (id)
CREATE UNIQUE INDEX cat_puestos_nombre_key ON cdmx.cat_puestos USING btree (nombre)
CREATE UNIQUE INDEX cat_puestos_pkey ON cdmx.cat_puestos USING btree (id)
CREATE INDEX idx_cat_puestos_nombre_trgm ON cdmx.cat_puestos USING gin (nombre gin_trgm_ops)
CREATE UNIQUE INDEX cat_sectores_clave_key ON cdmx.cat_sectores USING btree (clave)
CREATE UNIQUE INDEX cat_sectores_pkey ON cdmx.cat_sectores USING btree (id)
CREATE UNIQUE INDEX cat_sexos_nombre_key ON cdmx.cat_sexos USING btree (nombre)
CREATE UNIQUE INDEX cat_sexos_pkey ON cdmx.cat_sexos USING btree (id)
CREATE UNIQUE INDEX cat_tipos_contratacion_nombre_key ON cdmx.cat_tipos_contratacion USING btree (nombre)
CREATE UNIQUE INDEX cat_tipos_contratacion_pkey ON cdmx.cat_tipos_contratacion USING btree (id)
CREATE UNIQUE INDEX cat_tipos_nomina_clave_key ON cdmx.cat_tipos_nomina USING btree (clave)
CREATE UNIQUE INDEX cat_tipos_nomina_pkey ON cdmx.cat_tipos_nomina USING btree (id)
CREATE UNIQUE INDEX cat_tipos_personal_nombre_key ON cdmx.cat_tipos_personal USING btree (nombre)
CREATE UNIQUE INDEX cat_tipos_personal_pkey ON cdmx.cat_tipos_personal USING btree (id)
CREATE UNIQUE INDEX cat_universos_clave_key ON cdmx.cat_universos USING btree (clave)
CREATE UNIQUE INDEX cat_universos_pkey ON cdmx.cat_universos USING btree (id)
CREATE UNIQUE INDEX idx_mv_dashboard_overview_key ON cdmx.mv_dashboard_overview USING btree (key)
CREATE UNIQUE INDEX idx_mv_dashboard_salary_by_age_label ON cdmx.mv_dashboard_salary_by_age USING btree (label)
CREATE UNIQUE INDEX idx_mv_dashboard_sectors_id ON cdmx.mv_dashboard_sectors USING btree (sector_id)
CREATE UNIQUE INDEX idx_mv_dashboard_seniority_label ON cdmx.mv_dashboard_seniority USING btree (label)
CREATE UNIQUE INDEX idx_mv_dashboard_top_positions_id ON cdmx.mv_dashboard_top_positions USING btree (puesto_id)
CREATE INDEX idx_nomb_fecha_ingreso ON cdmx.nombramientos USING btree (fecha_ingreso)
CREATE INDEX idx_nomb_nivel_salarial ON cdmx.nombramientos USING btree (nivel_salarial_id)
CREATE INDEX idx_nomb_persona_id ON cdmx.nombramientos USING btree (persona_id)
CREATE INDEX idx_nomb_puesto_id ON cdmx.nombramientos USING btree (puesto_id)
CREATE INDEX idx_nomb_puesto_sueldo ON cdmx.nombramientos USING btree (puesto_id, sueldo_bruto)
CREATE INDEX idx_nomb_sector_id ON cdmx.nombramientos USING btree (sector_id)
CREATE INDEX idx_nomb_sueldo_bruto ON cdmx.nombramientos USING btree (sueldo_bruto)
CREATE INDEX idx_nomb_tipo_contratacion ON cdmx.nombramientos USING btree (tipo_contratacion_id)
CREATE INDEX idx_nomb_tipo_nomina ON cdmx.nombramientos USING btree (tipo_nomina_id)
CREATE INDEX idx_nomb_tipo_personal ON cdmx.nombramientos USING btree (tipo_personal_id)
CREATE INDEX idx_nomb_universo_id ON cdmx.nombramientos USING btree (universo_id)
CREATE UNIQUE INDEX nombramientos_pkey ON cdmx.nombramientos USING btree (id)
CREATE INDEX idx_personas_apellido_1_trgm ON cdmx.personas USING gin (apellido_1 gin_trgm_ops)
CREATE INDEX idx_personas_apellido_2_trgm ON cdmx.personas USING gin (apellido_2 gin_trgm_ops)
CREATE INDEX idx_personas_edad ON cdmx.personas USING btree (edad)
CREATE INDEX idx_personas_nombre_trgm ON cdmx.personas USING gin (nombre gin_trgm_ops)
CREATE INDEX idx_personas_sexo_id ON cdmx.personas USING btree (sexo_id)
CREATE UNIQUE INDEX personas_pkey ON cdmx.personas USING btree (id)

# cdmx — vistas
v_servidores_publicos ::  SELECT p.id,     p.nombre,     p.apellido_1,     p.apellido_2,     cs.nombre AS sexo,     p.edad,     n.puesto_id,     n.tipo_nomina_id,     n.tipo_contratacion_id,     n.tipo_personal_id,     n.fecha_ingreso,     n.universo_id,     n.sector_id,     cns.clave AS id_nivel_salarial,     n.sueldo_bruto,     n.sueldo_neto    FROM (((cdmx.personas p      JOIN cdmx.nombramientos n ON ((n.persona_id = p.id)))      LEFT JOIN cdmx.cat_sexos cs ON ((p.sexo_id = cs.id)))      LEFT JOIN cdmx.cat_niveles_salariales cns ON ((n.nivel_salarial_id = cns.id)));

# cdmx — vistas materializadas
mv_dashboard_overview ::  SELECT 1 AS key,     count(*) AS total,     count(DISTINCT n.sector_id) AS total_sectors,     (avg(n.sueldo_bruto))::double precision AS avg_salary,     percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((n.sueldo_bruto)::double precision)) AS median_salary,     (min(n.sueldo_bruto))::double precision AS min_salary,     (max(n.sueldo_bruto))::double precision AS max_salary,     percentile_cont((0.25)::double precision) WITHIN GROUP (ORDER BY ((n.sueldo_bruto)::double precision)) AS p25,     percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((n.sueldo_bruto)::double precision)) AS p50,     percentile_cont((0.75)::double precision) WITHIN GROUP (ORDER BY ((n.sueldo_bruto)::double precision)) AS p75,     percentile_cont((0.9)::double precision) WITHIN GROUP (ORDER BY ((n.sueldo_bruto)::double precision)) AS p90,     count(*) FILTER (WHERE ((csex.nombre)::text = 'MASCULINO'::text)) AS hombres,     count(*) FILTER (WHERE ((csex.nombre)::text = 'FEMENINO'::text)) AS mujeres,     (avg(n.sueldo_bruto) FILTER (WHERE ((csex.nombre)::text = 'MASCULINO'::text)))::double precision AS avg_male,     (avg(n.sueldo_bruto) FILTER (WHERE ((csex.nombre)::text = 'FEMENINO'::text)))::double precision AS avg_female,     (avg(n.sueldo_neto))::double precision AS avg_net,     (avg((n.sueldo_bruto - n.sueldo_neto)))::double precision AS avg_deduction,         CASE             WHEN (avg(n.sueldo_bruto) > (0)::numeric) THEN (((avg((n.sueldo_bruto - n.sueldo_neto)) / avg(n.sueldo_bruto)) * (100)::numeric))::double precision             ELSE (0)::double precision         END AS avg_deduction_pct,     (avg(EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (n.fecha_ingreso)::timestamp with time zone))))::double precision AS avg_seniority    FROM ((cdmx.nombramientos n      JOIN cdmx.personas p ON ((n.persona_id = p.id)))      LEFT JOIN cdmx.cat_sexos csex ON ((p.sexo_id = csex.id)))   WHERE (n.sueldo_bruto IS NOT NULL);
mv_dashboard_sectors ::  SELECT cs.id AS sector_id,     cs.nombre AS name,     count(n.id) AS count,     (avg(n.sueldo_bruto))::double precision AS avg_salary,     (COALESCE(avg(n.sueldo_bruto) FILTER (WHERE ((csex.nombre)::text = 'MASCULINO'::text)), (0)::numeric))::double precision AS avg_male,     (COALESCE(avg(n.sueldo_bruto) FILTER (WHERE ((csex.nombre)::text = 'FEMENINO'::text)), (0)::numeric))::double precision AS avg_female    FROM (((cdmx.cat_sectores cs      JOIN cdmx.nombramientos n ON ((n.sector_id = cs.id)))      JOIN cdmx.personas p ON ((n.persona_id = p.id)))      LEFT JOIN cdmx.cat_sexos csex ON ((p.sexo_id = csex.id)))   WHERE (n.sueldo_bruto IS NOT NULL)   GROUP BY cs.id, cs.nombre   ORDER BY (count(n.id)) DESC;
mv_dashboard_top_positions ::  SELECT cp.id AS puesto_id,     cp.nombre AS name,     count(*) AS count,     (avg(n.sueldo_bruto))::double precision AS avg_salary    FROM (cdmx.nombramientos n      JOIN cdmx.cat_puestos cp ON ((n.puesto_id = cp.id)))   WHERE (n.sueldo_bruto IS NOT NULL)   GROUP BY cp.id, cp.nombre   ORDER BY ((avg(n.sueldo_bruto))::double precision) DESC  LIMIT 10;
mv_dashboard_salary_by_age ::  SELECT label,     avg,     ord    FROM ( SELECT '18-25'::text AS label,             (avg(n.sueldo_bruto))::double precision AS avg,             1 AS ord            FROM (cdmx.nombramientos n              JOIN cdmx.personas p ON ((n.persona_id = p.id)))           WHERE (((p.edad >= 18) AND (p.edad <= 25)) AND (n.sueldo_bruto IS NOT NULL))         UNION ALL          SELECT '26-35'::text,             (avg(n.sueldo_bruto))::double precision AS avg,             2            FROM (cdmx.nombramientos n              JOIN cdmx.personas p ON ((n.persona_id = p.id)))           WHERE (((p.edad >= 26) AND (p.edad <= 35)) AND (n.sueldo_bruto IS NOT NULL))         UNION ALL          SELECT '36-45'::text,             (avg(n.sueldo_bruto))::double precision AS avg,             3            FROM (cdmx.nombramientos n              JOIN cdmx.personas p ON ((n.persona_id = p.id)))           WHERE (((p.edad >= 36) AND (p.edad <= 45)) AND (n.sueldo_bruto IS NOT NULL))         UNION ALL          SELECT '46-55'::text,             (avg(n.sueldo_bruto))::double precision AS avg,             4            FROM (cdmx.nombramientos n              JOIN cdmx.personas p ON ((n.persona_id = p.id)))           WHERE (((p.edad >= 46) AND (p.edad <= 55)) AND (n.sueldo_bruto IS NOT NULL))         UNION ALL          SELECT '56+'::text,             (avg(n.sueldo_bruto))::double precision AS avg,             5            FROM (cdmx.nombramientos n              JOIN cdmx.personas p ON ((n.persona_id = p.id)))           WHERE ((p.edad > 55) AND (n.sueldo_bruto IS NOT NULL))) sub;
mv_dashboard_seniority ::  SELECT label,     ord,     count_all,     count_with_salary,     avg_salary    FROM ( SELECT '0-2 años'::text AS label,             1 AS ord,             ( SELECT count(*) AS count                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (0)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (2)::numeric)))) AS count_all,             ( SELECT count(*) AS count                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND (nombramientos.sueldo_bruto IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (0)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (2)::numeric)))) AS count_with_salary,             ( SELECT (avg(nombramientos.sueldo_bruto))::double precision AS avg                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND (nombramientos.sueldo_bruto IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (0)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (2)::numeric)))) AS avg_salary         UNION ALL          SELECT '3-5 años'::text,             2,             ( SELECT count(*) AS count                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (3)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (5)::numeric)))) AS count,             ( SELECT count(*) AS count                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND (nombramientos.sueldo_bruto IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (3)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (5)::numeric)))) AS count,             ( SELECT (avg(nombramientos.sueldo_bruto))::double precision AS avg                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND (nombramientos.sueldo_bruto IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (3)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (5)::numeric)))) AS avg         UNION ALL          SELECT '6-10 años'::text,             3,             ( SELECT count(*) AS count                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (6)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (10)::numeric)))) AS count,             ( SELECT count(*) AS count                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND (nombramientos.sueldo_bruto IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (6)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (10)::numeric)))) AS count,             ( SELECT (avg(nombramientos.sueldo_bruto))::double precision AS avg                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND (nombramientos.sueldo_bruto IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (6)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (10)::numeric)))) AS avg         UNION ALL          SELECT '11-20 años'::text,             4,             ( SELECT count(*) AS count                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (11)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (20)::numeric)))) AS count,             ( SELECT count(*) AS count                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND (nombramientos.sueldo_bruto IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (11)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (20)::numeric)))) AS count,             ( SELECT (avg(nombramientos.sueldo_bruto))::double precision AS avg                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND (nombramientos.sueldo_bruto IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (11)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (20)::numeric)))) AS avg         UNION ALL          SELECT '21-30 años'::text,             5,             ( SELECT count(*) AS count                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (21)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (30)::numeric)))) AS count,             ( SELECT count(*) AS count                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND (nombramientos.sueldo_bruto IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (21)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (30)::numeric)))) AS count,             ( SELECT (avg(nombramientos.sueldo_bruto))::double precision AS avg                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND (nombramientos.sueldo_bruto IS NOT NULL) AND ((EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) >= (21)::numeric) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) <= (30)::numeric)))) AS avg         UNION ALL          SELECT '30+ años'::text,             6,             ( SELECT count(*) AS count                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) > (30)::numeric))) AS count,             ( SELECT count(*) AS count                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND (nombramientos.sueldo_bruto IS NOT NULL) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) > (30)::numeric))) AS count,             ( SELECT (avg(nombramientos.sueldo_bruto))::double precision AS avg                    FROM cdmx.nombramientos                   WHERE ((nombramientos.fecha_ingreso IS NOT NULL) AND (nombramientos.sueldo_bruto IS NOT NULL) AND (EXTRACT(year FROM age((CURRENT_DATE)::timestamp with time zone, (nombramientos.fecha_ingreso)::timestamp with time zone)) > (30)::numeric))) AS avg) sub;

# cdmx — conteos
cat_sexos|3
cat_tipos_nomina|10
cat_tipos_contratacion|7
cat_tipos_personal|13
cat_universos|27
cat_sectores|78
cat_niveles_salariales|721
cat_puestos|1779
personas|246845
nombramientos|246836

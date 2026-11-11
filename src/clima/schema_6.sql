-- Ficha de cada capital (programa clima, 2026-11-11). Base D1 datosmexico-api-plataforma. Aplicar UNA vez; todo es aditivo.
-- Cuatro piezas nuevas: lo normal (SMN), el pronóstico oficial del SMN por municipio, el pronóstico de modelo a 10 días y la
-- calidad del aire. Ninguna se mezcla con la medición: cada cifra lleva su fuente y su papel.

-- Lo normal: normal climatológica oficial del observatorio (SMN), tal cual la publica, por mes (13 = anual).
CREATE TABLE IF NOT EXISTS clima_normal_mes (
  clave TEXT NOT NULL, variable TEXT NOT NULL,  -- tmax | tmin | tmed | lluvia_mm | dias_lluvia
  mes INTEGER NOT NULL, normal REAL, anios INTEGER, periodo TEXT,
  PRIMARY KEY (clave, variable, mes)
);
-- Lo normal de cada día del año: distribución de la máxima y la mínima diarias del registro del observatorio en una ventana de
-- 15 días (scripts/clima/generar_normales.py). pct_* = percentiles 0, 5, …, 100 en JSON; nulos si el día no alcanza suficiencia.
CREATE TABLE IF NOT EXISTS clima_normal_dia (
  clave TEXT NOT NULL, dia TEXT NOT NULL,       -- MM-DD
  n_tmax INTEGER, anios_tmax INTEGER, media_tmax REAL, pct_tmax TEXT,
  n_tmin INTEGER, anios_tmin INTEGER, media_tmin REAL, pct_tmin TEXT,
  n_lluvia INTEGER, frac_lluvia REAL,           -- fracción de días con lluvia (≥ 0.1 mm)
  PRIMARY KEY (clave, dia)
);
CREATE TABLE IF NOT EXISTS clima_normal_fuente (
  clave TEXT PRIMARY KEY, clicom TEXT NOT NULL, wmo TEXT NOT NULL,
  distribucion_nivel TEXT NOT NULL,             -- normal | referencia | insuficiente
  distribucion_periodo TEXT NOT NULL, distribucion_anios INTEGER NOT NULL,
  normal_periodo TEXT, normal_url TEXT, normal_sha256 TEXT, normal_emision TEXT,
  diario_url TEXT NOT NULL, diario_sha256 TEXT NOT NULL, diario_emision TEXT, diario_desde TEXT, diario_hasta TEXT,
  generado_en TEXT NOT NULL, cotejo TEXT NOT NULL
);

-- Pronóstico oficial del SMN por municipio (servicio web PronosticoPorMunicipiosGZ, diario a 4 días, y 48HrsGZ, horario).
-- Se guardan TODAS las emisiones, sin reemplazar: así se podrá medir qué tanto acierta el SMN a cada anticipación.
CREATE TABLE IF NOT EXISTS clima_smn_emision (
  tipo TEXT NOT NULL,                           -- dia | hora
  emision TEXT NOT NULL,                        -- hora de generación del archivo (cabecera gzip, ISO UTC)
  sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, descargado_en TEXT NOT NULL,
  registros INTEGER NOT NULL, municipios INTEGER NOT NULL, inicio TEXT, fin TEXT, detalle TEXT,
  PRIMARY KEY (tipo, emision)
);
CREATE TABLE IF NOT EXISTS clima_smn_dia (
  clave TEXT NOT NULL, fecha TEXT NOT NULL, emision TEXT NOT NULL,   -- fecha: AAAA-MM-DD, día en hora del centro
  tmax_c REAL, tmin_c REAL, prob_lluvia_pct REAL, lluvia_mm REAL, viento_kmh REAL, rafaga_kmh REAL, viento_dir_grados REAL,
  nubes_pct REAL, cielo TEXT,
  PRIMARY KEY (clave, fecha, emision)
);
CREATE TABLE IF NOT EXISTS clima_smn_hora (
  clave TEXT NOT NULL, hora TEXT NOT NULL, emision TEXT NOT NULL,    -- hora: ISO UTC en punto
  temperatura_c REAL, rocio_c REAL, humedad_pct REAL, prob_lluvia_pct REAL, lluvia_mm REAL,
  viento_kmh REAL, rafaga_kmh REAL, viento_dir_grados REAL, cielo TEXT,
  PRIMARY KEY (clave, hora, emision)
);
CREATE INDEX IF NOT EXISTS clima_smn_hora_emision ON clima_smn_hora (emision);

-- Pronóstico de modelo para la ficha (Open-Meteo, 10 días): se pide a demanda, se guarda la última respuesta por capital y se
-- sirve de aquí; el presupuesto diario de llamadas protege el límite de la fuente (lo comparte con el refresco de cada 5 min).
CREATE TABLE IF NOT EXISTS clima_modelo_ficha (
  clave TEXT PRIMARY KEY, consultado_en TEXT NOT NULL, cuerpo TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clima_presupuesto (
  fecha TEXT NOT NULL, fuente TEXT NOT NULL, llamadas REAL NOT NULL,
  PRIMARY KEY (fecha, fuente)
);

-- Calidad del aire: concentraciones horarias de SINAICA (INECC, preliminares) de las estaciones que miden cada capital, la
-- estación elegida en cada vuelta y el índice que publica SINAICA (para cotejar el que se calcula aquí con la NOM-172).
CREATE TABLE IF NOT EXISTS clima_aire_hora (
  estacion INTEGER NOT NULL, parametro TEXT NOT NULL,   -- PM2.5 | PM10 | O3 | NO2 | SO2 | CO
  fin_local TEXT NOT NULL,                              -- fin de la hora como la fecha SINAICA (hora local de la red)
  fin_utc TEXT NOT NULL, valor REAL NOT NULL, llegado_en TEXT NOT NULL,
  PRIMARY KEY (estacion, parametro, fin_local)
);
CREATE INDEX IF NOT EXISTS clima_aire_hora_utc ON clima_aire_hora (estacion, parametro, fin_utc);
CREATE TABLE IF NOT EXISTS clima_aire_eleccion (clave TEXT PRIMARY KEY, estaciones TEXT NOT NULL, elegido_en TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clima_aire_sinaica (
  estacion INTEGER NOT NULL, calculado_en TEXT, cumple TEXT NOT NULL, calc TEXT NOT NULL, leido_en TEXT NOT NULL,
  PRIMARY KEY (estacion, calculado_en)
);

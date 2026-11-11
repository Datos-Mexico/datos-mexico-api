-- Clima oficial de las 32 capitales (programa 2026-11). Base D1 datosmexico-api-plataforma. Aplicar UNA vez; todo es aditivo.
-- Tres fuentes con papeles distintos: la medición oficial del SMN (manda), el aeropuerto (testigo independiente) y el modelo
-- (pronóstico, contra el que se mide el error del modelo). Nada se borra ni se rellena: lo que no pasa la verificación se marca.

-- Medición oficial: observación sinóptica horaria del observatorio del SMN de cada capital, tomada de WIS2 (OMM).
CREATE TABLE IF NOT EXISTS clima_medicion (
  clave TEXT NOT NULL,              -- clave INEGI de la entidad
  instante TEXT NOT NULL,           -- hora de la observación según el SMN (ISO UTC, en punto)
  wmo TEXT NOT NULL,
  temperatura_c REAL, rocio_c REAL, humedad_pct REAL,
  presion_estacion_hpa REAL, presion_mar_hpa REAL,
  viento_dir_grados REAL, viento_ms REAL, viento_periodo_min REAL, rafaga_ms REAL,
  lluvia_1h_mm REAL, lluvia_24h_mm REAL, visibilidad_m REAL, nubosidad_pct REAL,
  publicado_en TEXT,                -- Last-Modified del caché global de la OMM (≈ cuándo la publicó el SMN)
  llegado_en TEXT NOT NULL,         -- cuándo la tuvo el observatorio, ya verificada y guardada
  fuente_url TEXT NOT NULL,         -- archivo BUFR exacto que se leyó
  sha256 TEXT NOT NULL,             -- huella del archivo
  bufr_b64 TEXT NOT NULL,           -- el mensaje original, para auditar y volver a decodificar
  marcas TEXT NOT NULL DEFAULT '[]',-- verificación: lista de marcas; vacía = pasó todo
  testigo_icao TEXT, testigo_instante TEXT, testigo_dif_c REAL, testigo_tipica_c REAL,
  PRIMARY KEY (clave, instante)
);

-- Cada hora de observación: cuántas de las 32 llegaron, cuáles faltan, cuántas quedaron marcadas, cuándo llegaron.
CREATE TABLE IF NOT EXISTS clima_lotes (
  hora TEXT PRIMARY KEY,
  recibidas INTEGER NOT NULL, marcadas INTEGER NOT NULL, faltan TEXT NOT NULL,
  primera_llegada TEXT, ultima_llegada TEXT, consultas INTEGER NOT NULL, actualizado_en TEXT NOT NULL,
  repasos INTEGER NOT NULL DEFAULT 0   -- vueltas del repaso de historia (máximo 2 por hora incompleta)
);

-- Testigo: METAR del aeropuerto de cada capital (SENEAM), leído de aviationweather.gov (NOAA).
CREATE TABLE IF NOT EXISTS clima_aeropuerto (
  icao TEXT NOT NULL, instante TEXT NOT NULL, tipo TEXT NOT NULL,      -- METAR | SPECI
  temperatura_c REAL, rocio_c REAL, qnh_hpa REAL, viento_dir_grados REAL, viento_ms REAL, rafaga_ms REAL, visibilidad_m REAL,
  crudo TEXT NOT NULL, recibido_noaa TEXT, llegado_en TEXT NOT NULL,
  PRIMARY KEY (icao, instante, tipo)
);

-- Pronóstico de modelo (Open-Meteo) en el punto de cada observatorio para cada hora: el valor de la última consulta anterior a
-- esa hora, congelado al pasar la hora. Es la base del indicador propio «error del modelo».
CREATE TABLE IF NOT EXISTS clima_pronostico_hora (
  clave TEXT NOT NULL, hora TEXT NOT NULL,
  temperatura_c REAL, humedad_pct REAL, viento_ms REAL, presion_mar_hpa REAL,
  consultado_en TEXT NOT NULL,
  PRIMARY KEY (clave, hora)
);

-- Error del modelo: modelo − medición oficial, por capital y hora. Se calcula al llegar cada medición.
CREATE TABLE IF NOT EXISTS clima_error_modelo (
  clave TEXT NOT NULL, hora TEXT NOT NULL,
  temperatura_medida_c REAL, temperatura_modelo_c REAL, error_temperatura_c REAL,
  humedad_medida_pct REAL, humedad_modelo_pct REAL, error_humedad_pct REAL,
  viento_medido_ms REAL, viento_modelo_ms REAL, error_viento_ms REAL,
  PRIMARY KEY (clave, hora)
);

-- Sonda diaria del portal de estaciones automáticas (EMAs) de CONAGUA: si vuelve a publicar, la medición migra a 10 minutos.
CREATE TABLE IF NOT EXISTS clima_sonda_emas (
  fecha TEXT PRIMARY KEY, estaciones INTEGER, con_datos INTEGER, detalle TEXT, consultado_en TEXT NOT NULL
);

-- Bitácora de consultas a las fuentes (para el pulso y la cara pública de comprobación).
CREATE TABLE IF NOT EXISTS clima_consultas (
  instante TEXT NOT NULL, fuente TEXT NOT NULL,   -- sinoptica | aeropuerto | modelo | emas | avisos | aire | pronostico_smn | avisos_falla
  pedidos INTEGER NOT NULL, nuevas INTEGER NOT NULL, detalle TEXT,
  PRIMARY KEY (instante, fuente)
);

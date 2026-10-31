-- Clima actual de las 32 capitales estatales (Open-Meteo), custodiado por el observatorio. Base D1 datosmexico-api-plataforma.
CREATE TABLE IF NOT EXISTS clima_actual (
  clave TEXT PRIMARY KEY,          -- clave INEGI de la entidad
  estado TEXT NOT NULL,
  capital TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  temperatura_c REAL,
  humedad_pct REAL,
  viento_kmh REAL,
  codigo_tiempo INTEGER,
  tiempo_fuente TEXT NOT NULL,     -- instante de la observación según la fuente (ISO UTC)
  intervalo_fuente_s INTEGER,      -- periodo declarado por la fuente en la respuesta (900)
  obtenido_en TEXT NOT NULL,       -- instante del refresco
  verificado_en TEXT               -- último refresco en que la respuesta pasó las comprobaciones (32/32, tiempo reciente)
);
CREATE TABLE IF NOT EXISTS clima_refrescos (
  obtenido_en TEXT PRIMARY KEY,
  observaciones_nuevas INTEGER NOT NULL,
  verificado INTEGER NOT NULL,
  detalle TEXT
);

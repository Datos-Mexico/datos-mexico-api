-- Sismos del Servicio Sismológico Nacional (SSN, UNAM), custodiados desde su canal RSS de últimos sismos. D1 datosmexico-api-plataforma.
-- Sonda del Protocolo DPM: cada minuto se lee el canal; cada sismo nuevo se guarda con el instante en que el observatorio lo vio,
-- y así se MIDE la latencia de publicación del SSN (visto − origen). Es la investigación del primer dato por segundo de México.
CREATE TABLE IF NOT EXISTS sismos_ssn (
  clave TEXT PRIMARY KEY,            -- fecha de origen (UTC) + lat + lon
  origen_utc TEXT NOT NULL,          -- instante del sismo según el SSN (publicado en hora de México, UTC-6)
  visto_en TEXT NOT NULL,            -- primer instante en que el observatorio lo vio en el canal
  latencia_s INTEGER NOT NULL,       -- visto_en − origen_utc, en segundos
  magnitud REAL,
  lat REAL,
  lon REAL,
  profundidad_km REAL,
  lugar TEXT,
  enlace TEXT
);
CREATE INDEX IF NOT EXISTS sismos_ssn_origen ON sismos_ssn (origen_utc);
CREATE TABLE IF NOT EXISTS sismos_lecturas (
  leido_en TEXT PRIMARY KEY,
  items INTEGER NOT NULL,
  nuevos INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  detalle TEXT
);

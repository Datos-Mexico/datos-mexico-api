-- Malla de pronóstico del mapa animado del clima (GFS de la NOAA recortado a México). Base D1 datosmexico-api-plataforma.
-- Aplicar UNA vez; aditivo. Los archivos viven en R2 (clima/malla/<corrida>/); aquí solo el avance de cada corrida.
CREATE TABLE IF NOT EXISTS clima_malla (
  corrida TEXT PRIMARY KEY,          -- AAAAMMDDHH del ciclo GFS (00, 06, 12, 18 UTC)
  horas_listas INTEGER NOT NULL,     -- de 54
  estado TEXT NOT NULL,              -- bajando | completa | fallida
  fallas INTEGER NOT NULL DEFAULT 0, -- vueltas con error (a las 30, fallida)
  iniciada_en TEXT NOT NULL, completa_en TEXT, detalle TEXT
);

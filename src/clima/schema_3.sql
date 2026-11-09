-- Mallas de pronóstico del mapa animado del clima (GFS de la NOAA). Base D1 datosmexico-api-plataforma. Aplicar UNA vez; aditivo.
-- Los archivos viven en R2 (clima/malla/<malla>/<corrida>/); aquí solo el avance de cada corrida.
CREATE TABLE IF NOT EXISTS clima_malla (
  malla TEXT NOT NULL,               -- mexico (0.25°, cada hora) | mundo (1°, cada 3 horas)
  corrida TEXT NOT NULL,             -- AAAAMMDDHH del ciclo GFS (00, 06, 12, 18 UTC)
  horas_listas INTEGER NOT NULL,     -- pasos ya guardados en R2
  estado TEXT NOT NULL,              -- bajando | completa | fallida
  fallas INTEGER NOT NULL DEFAULT 0, -- vueltas con error (a las 30, fallida)
  iniciada_en TEXT NOT NULL, completa_en TEXT, detalle TEXT,
  bloqueo_hasta TEXT,                -- candado: una sola vuelta trabaja la corrida a la vez (vence solo a los 3 minutos)
  PRIMARY KEY (malla, corrida)
);

-- Protocolo DPM 0.4.0 (PULSO.md §3, §7 bis, §10): comprobación de cara pública. Aditiva; aplicar una sola vez.
ALTER TABLE datos ADD COLUMN url_comprobacion TEXT;
ALTER TABLE datos_historial ADD COLUMN url_comprobacion TEXT;
CREATE TABLE IF NOT EXISTS comprobaciones (
  sistema TEXT NOT NULL,
  dato TEXT NOT NULL,
  instante TEXT NOT NULL,
  resultado TEXT NOT NULL CHECK (resultado IN ('coincide', 'no-coincide', 'sin-respuesta')),
  ultimo_refresco_visto TEXT,
  refrescos_hora_vistos INTEGER,
  ultimo_reportado TEXT,
  refrescos_hora_reportados INTEGER,
  detalle TEXT,
  PRIMARY KEY (sistema, dato, instante)
);

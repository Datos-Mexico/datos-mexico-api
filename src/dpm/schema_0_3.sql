-- Protocolo DPM 0.3.0 (datos-mexico-dpm/PULSO.md §3, §4): fuentes por evento y vía de entrega.
-- Aditiva e idempotente por columna (D1 no tiene ADD COLUMN IF NOT EXISTS: aplicar una sola vez; si una columna ya existe,
-- la sentencia falla y las demás se aplican por separado).
ALTER TABLE datos ADD COLUMN fuente_tipo TEXT NOT NULL DEFAULT 'calendario';
ALTER TABLE datos ADD COLUMN latencia_fuente_ms INTEGER;
ALTER TABLE datos ADD COLUMN via TEXT NOT NULL DEFAULT 'consulta';
ALTER TABLE datos_historial ADD COLUMN fuente_tipo TEXT NOT NULL DEFAULT 'calendario';
ALTER TABLE datos_historial ADD COLUMN latencia_fuente_ms INTEGER;
ALTER TABLE datos_historial ADD COLUMN via TEXT NOT NULL DEFAULT 'consulta';
ALTER TABLE datos_historial ADD COLUMN nota TEXT;
ALTER TABLE resumenes ADD COLUMN eventos INTEGER;
ALTER TABLE resumenes ADD COLUMN latencia_fuente_max_ms INTEGER;
ALTER TABLE resumenes ADD COLUMN entregas INTEGER;
ALTER TABLE resumenes ADD COLUMN latencia_entrega_max_ms INTEGER;

-- Protocolo DPM 0.5.0 (PULSO.md §7.4, PROTOCOLO.md §6): un dato por entrega sin entregas en la hora conserva la clase de su hora
-- más reciente con entregas (máximo 24 horas atrás) y dice de qué hora es. Aditiva; aplicar una sola vez.
ALTER TABLE datos ADD COLUMN ventana_hasta TEXT;
ALTER TABLE clases ADD COLUMN ventana_hasta TEXT;

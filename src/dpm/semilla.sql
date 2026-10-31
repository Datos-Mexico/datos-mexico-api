-- Los cuatro sistemas con adhesión declarada el 2026-10-31 (datos-mexico-dpm/REGISTRO.md). Sin llave: la emite un administrador.
INSERT OR IGNORE INTO sistemas (sistema, nombre, operador, url, estado, adhesion_declarada, llave_hash, creado_en) VALUES
  ('datos-mexico', 'Datos México', 'Observatorio Datos México', 'https://datosmexico.org', 'declarada', '2026-10-31', NULL, '2026-10-31T00:00:00.000Z'),
  ('reparacdmx', 'ReparaCDMX', 'David Fernando Ávila Díaz', 'https://reparacdmx.com', 'declarada', '2026-10-31', NULL, '2026-10-31T00:00:00.000Z'),
  ('indepar', 'INDEPAR', 'David Fernando Ávila Díaz', 'https://indeparmx.org', 'declarada', '2026-10-31', NULL, '2026-10-31T00:00:00.000Z'),
  ('bpm-stream', 'BPM Stream', 'David Fernando Ávila Díaz', 'https://bpm-stream.com', 'declarada', '2026-10-31', NULL, '2026-10-31T00:00:00.000Z');
INSERT OR IGNORE INTO estados (sistema, desde, estado) VALUES
  ('datos-mexico', '2026-10-31T00:00:00.000Z', 'declarada'),
  ('reparacdmx', '2026-10-31T00:00:00.000Z', 'declarada'),
  ('indepar', '2026-10-31T00:00:00.000Z', 'declarada'),
  ('bpm-stream', '2026-10-31T00:00:00.000Z', 'declarada');

-- Pulso del Protocolo DPM (datos-mexico-dpm/PULSO.md §10, protocolo 0.4.0). Base D1 datosmexico-api-dpm.
-- Instalaciones anteriores: aplicar schema_0_3.sql y schema_0_4.sql en orden.
-- Instantes en ISO 8601 UTC con milisegundos ("2026-10-31T18:04:00.000Z"); fechas civiles en America/Mexico_City ("2026-10-31").
CREATE TABLE IF NOT EXISTS sistemas (
  sistema TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  operador TEXT NOT NULL,
  url TEXT,
  estado TEXT NOT NULL DEFAULT 'declarada' CHECK (estado IN ('declarada', 'verificada')),
  adhesion_declarada TEXT NOT NULL,
  llave_hash TEXT,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS estados (
  sistema TEXT NOT NULL,
  desde TEXT NOT NULL,
  estado TEXT NOT NULL,
  PRIMARY KEY (sistema, desde)
);
CREATE TABLE IF NOT EXISTS datos (
  sistema TEXT NOT NULL,
  dato TEXT NOT NULL,
  nombre TEXT NOT NULL,
  fuente TEXT NOT NULL,
  reloj_fuente_ms INTEGER,
  fuente_tipo TEXT NOT NULL DEFAULT 'calendario' CHECK (fuente_tipo IN ('calendario', 'evento')),
  latencia_fuente_ms INTEGER,
  via TEXT NOT NULL DEFAULT 'consulta' CHECK (via IN ('consulta', 'entrega')),
  url_comprobacion TEXT,
  modo TEXT NOT NULL CHECK (modo IN ('servido', 'custodiado')),
  ultima_verificacion TEXT,
  clase TEXT NOT NULL DEFAULT 'sin-ventana',
  clase_desde TEXT,
  w_ms INTEGER,
  instante_evaluado TEXT,
  evaluado_en TEXT,
  declarado_en TEXT NOT NULL,
  PRIMARY KEY (sistema, dato)
);
CREATE TABLE IF NOT EXISTS datos_historial (
  sistema TEXT NOT NULL,
  dato TEXT NOT NULL,
  desde TEXT NOT NULL,
  nombre TEXT NOT NULL,
  fuente TEXT NOT NULL,
  reloj_fuente_ms INTEGER,
  fuente_tipo TEXT NOT NULL DEFAULT 'calendario',
  latencia_fuente_ms INTEGER,
  via TEXT NOT NULL DEFAULT 'consulta',
  url_comprobacion TEXT,
  modo TEXT NOT NULL,
  ultima_verificacion TEXT,
  nota TEXT,
  PRIMARY KEY (sistema, dato, desde)
);
CREATE TABLE IF NOT EXISTS resumenes (
  sistema TEXT NOT NULL,
  dato TEXT NOT NULL,
  minuto TEXT NOT NULL,
  refrescos INTEGER NOT NULL,
  primero TEXT NOT NULL,
  ultimo TEXT NOT NULL,
  intervalo_max_ms INTEGER NOT NULL,
  observaciones INTEGER NOT NULL,
  eventos INTEGER,
  latencia_fuente_max_ms INTEGER,
  entregas INTEGER,
  latencia_entrega_max_ms INTEGER,
  recibido TEXT NOT NULL,
  puntual INTEGER NOT NULL,
  PRIMARY KEY (sistema, dato, minuto)
);
CREATE INDEX IF NOT EXISTS resumenes_puntuales ON resumenes (sistema, dato, puntual, minuto);
CREATE INDEX IF NOT EXISTS resumenes_minuto ON resumenes (minuto);
CREATE TABLE IF NOT EXISTS ingestas (
  sistema TEXT NOT NULL,
  dato TEXT NOT NULL,
  inicio TEXT NOT NULL,
  fin TEXT NOT NULL,
  observaciones INTEGER NOT NULL,
  verificacion_metodo TEXT,
  verificacion_resultado TEXT,
  recibido TEXT NOT NULL,
  PRIMARY KEY (sistema, dato, inicio)
);
CREATE INDEX IF NOT EXISTS ingestas_fin ON ingestas (fin);
CREATE TABLE IF NOT EXISTS usuarios_dia (
  sistema TEXT NOT NULL,
  fecha TEXT NOT NULL,
  usuarios_distintos INTEGER NOT NULL,
  metodo TEXT NOT NULL,
  datos TEXT NOT NULL,
  recibido TEXT NOT NULL,
  PRIMARY KEY (sistema, fecha)
);
CREATE TABLE IF NOT EXISTS clases (
  sistema TEXT NOT NULL,
  dato TEXT NOT NULL,
  desde TEXT NOT NULL,
  clase TEXT NOT NULL,
  w_ms INTEGER,
  PRIMARY KEY (sistema, dato, desde)
);
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

-- Avisos oficiales del SMN (CAP 1.2, licencia CC BY 4.0), custodiados: el mensaje original con su huella y lo leído de él.
CREATE TABLE IF NOT EXISTS clima_avisos (
  url TEXT PRIMARY KEY,                  -- archivo CAP exacto, tal como lo lista el índice del SMN
  identificador TEXT NOT NULL,           -- <identifier> del mensaje
  tipo TEXT NOT NULL,                    -- lluvias | ciclontropical | frentefrio | otro (del nombre del archivo)
  mensaje TEXT NOT NULL,                 -- Alert | Update | Cancel
  enviado TEXT NOT NULL,                 -- <sent>, en UTC
  vigente_desde TEXT, vence TEXT,        -- <effective> y <expires>, en UTC
  evento TEXT, titulo TEXT, descripcion TEXT, instruccion TEXT,
  gravedad TEXT, urgencia TEXT, certeza TEXT,
  semaforo TEXT, categoria TEXT, trayectoria TEXT, -- solo los de ciclón
  zona TEXT,                             -- <areaDesc>: abreviaturas de los estados
  poligonos TEXT NOT NULL,               -- JSON: anillos [[lon, lat], …] (el CAP los da en «lat,lon»)
  referencias TEXT,                      -- <references>: avisos que este actualiza
  llegado_en TEXT NOT NULL, sha256 TEXT NOT NULL, xml TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS clima_avisos_vence ON clima_avisos (vence);

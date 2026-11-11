-- Candados cortos para tareas a demanda (el satélite rápido): una fila por tarea con hasta cuándo está tomada.
CREATE TABLE IF NOT EXISTS clima_bloqueos (clave TEXT PRIMARY KEY, hasta TEXT NOT NULL);

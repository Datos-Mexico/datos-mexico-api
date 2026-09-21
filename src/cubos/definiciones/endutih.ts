// ENDUTIH 2015-2025 (INEGI): personas de 6 años y más usuarias de internet y de computadora, por edición, entidad, sexo y
// grupo de edad, desde los microdatos (scripts/endutih_d1.py; D1 datosmexico-api-encuestas). El porcentaje nacional
// reproduce los indicadores 6206972693 y 6206972694 del Banco de Indicadores en cada edición (±0.01 puntos).
import type { Cubo } from "../tipos";

export const ENDUTIH_USUARIOS: Cubo = {
  clave: "endutih-usuarios", nombre: "Usuarios de internet y computadora (ENDUTIH)", tema: "tecnologia",
  fuente: "INEGI — Encuesta Nacional sobre Disponibilidad y Uso de Tecnologías de la Información en los Hogares (ENDUTIH), microdatos de usuarios", fuente_url: "https://www.inegi.org.mx/programas/dutih/", licencia: "Términos de libre uso INEGI",
  descripcion: "Personas de 6 años y más que usan internet y computadora, por edición (2015-2025), entidad, sexo y grupo de edad, expandidas con el factor de la persona seleccionada. El porcentaje nacional de usuarios de internet es el indicador «Personas usuarias de internet como proporción de la población de seis años y más» del INEGI.",
  binding: "DB_ENCUESTAS", desde: "endutih_usuarios d JOIN cat_entidad e ON e.clave = d.ent JOIN cat_sexo s ON s.clave = d.sexo JOIN cat_edad_grupo g ON g.clave = d.edad_grupo JOIN cat_si_no i ON i.clave = d.internet JOIN cat_si_no c ON c.clave = d.computadora",
  medidas: [
    { clave: "personas", titulo: "Personas de 6 años y más", sql: "SUM(d.personas)", unidad: "personas", sumable: true },
    { clave: "usuarios_internet", titulo: "Usuarias de internet", sql: "SUM(CASE WHEN d.internet = 1 THEN d.personas ELSE 0 END)", unidad: "personas", sumable: true },
    { clave: "usuarios_computadora", titulo: "Usuarias de computadora", sql: "SUM(CASE WHEN d.computadora = 1 THEN d.personas ELSE 0 END)", unidad: "personas", sumable: true },
    { clave: "pct_internet", titulo: "Porcentaje que usa internet", sql: "100.0 * SUM(CASE WHEN d.internet = 1 THEN d.personas ELSE 0 END) / SUM(d.personas)", unidad: "%", sumable: false, decimales: 2 },
    { clave: "pct_computadora", titulo: "Porcentaje que usa computadora", sql: "100.0 * SUM(CASE WHEN d.computadora = 1 THEN d.personas ELSE 0 END) / SUM(d.personas)", unidad: "%", sumable: false, decimales: 2 },
  ],
  dimensiones: [
    { clave: "edicion", titulo: "Edición", id: "d.edicion", tipo: "temporal", descripcion: "Año de la ENDUTIH (2015-2025). 2019 fue un levantamiento reducido sin entidad; 2015 no trae sexo ni edad en la tabla de usuarios." },
    { clave: "entidad", titulo: "Entidad", id: "substr('0' || d.ent, -2)", nombre: "e.nombre", tipo: "geografica", geo: "entidad", orden: "1", descripcion: "00 = sin entidad en la edición (2019)." },
    { clave: "sexo", titulo: "Sexo", id: "d.sexo", nombre: "s.nombre", tipo: "categorica", orden: "1" },
    { clave: "edad", titulo: "Grupo de edad", id: "d.edad_grupo", nombre: "g.nombre", tipo: "categorica", orden: "CASE d.edad_grupo WHEN '6-11' THEN 1 WHEN '12-17' THEN 2 WHEN '18-24' THEN 3 WHEN '25-34' THEN 4 WHEN '35-44' THEN 5 WHEN '45-54' THEN 6 WHEN '55+' THEN 7 ELSE 8 END" },
    { clave: "internet", titulo: "Usa internet", id: "d.internet", nombre: "i.nombre", tipo: "categorica", orden: "1" },
    { clave: "computadora", titulo: "Usa computadora", id: "d.computadora", nombre: "c.nombre", tipo: "categorica", orden: "1" },
  ],
  predeterminado: { medidas: ["pct_internet", "personas"], columnas: ["edicion"] },
  sql_corte: "SELECT MAX(edicion) AS corte FROM endutih_usuarios",
  notas: ["Los porcentajes no se suman entre entidades ni ediciones.", "Verificado: el porcentaje nacional de usuarios de internet y de computadora reproduce los indicadores del INEGI en las once ediciones.", "El uso de teléfono celular no se publica: ninguna variable de la tabla reproduce el porcentaje oficial."],
  api_dominio: "/api/v1/inegi/datos-abiertos/programas/endutih",
};

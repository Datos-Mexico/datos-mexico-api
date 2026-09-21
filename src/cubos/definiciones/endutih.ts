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

// ENADID 2023: mujeres de 15 a 49 años y condición de haber estado embarazada alguna vez (scripts/enadid_d1.py).
// Exacto contra el cuadro 2.1 de los tabulados oportunos del INEGI (total nacional y cada grupo de edad).
export const ENADID_MUJERES: Cubo = {
  clave: "enadid-mujeres", nombre: "Mujeres de 15 a 49 años y embarazo (ENADID 2023)", tema: "poblacion",
  fuente: "INEGI — Encuesta Nacional de la Dinámica Demográfica (ENADID) 2023, microdatos del módulo de la mujer", fuente_url: "https://www.inegi.org.mx/programas/enadid/2023/", licencia: "Términos de libre uso INEGI",
  descripcion: "Mujeres de 15 a 49 años expandidas con el factor del módulo, por entidad, grupo quinquenal de edad, tamaño de localidad y si han estado embarazadas alguna vez. Reproduce exactamente el cuadro 2.1 de los tabulados oportunos del INEGI (33,709,740 mujeres; 22,000,554 alguna vez embarazadas).",
  binding: "DB_ENCUESTAS", desde: "enadid_mujeres d JOIN cat_entidad e ON e.clave = d.ent JOIN cat_tam_loc tl ON tl.clave = d.tam_loc JOIN cat_si_no em ON em.clave = d.embarazada",
  medidas: [
    { clave: "mujeres", titulo: "Mujeres de 15 a 49 años", sql: "SUM(d.mujeres)", unidad: "mujeres", sumable: true },
    { clave: "embarazadas_alguna_vez", titulo: "Alguna vez embarazadas", sql: "SUM(CASE WHEN d.embarazada = 1 THEN d.mujeres ELSE 0 END)", unidad: "mujeres", sumable: true },
    { clave: "pct_embarazadas", titulo: "Porcentaje alguna vez embarazadas", sql: "100.0 * SUM(CASE WHEN d.embarazada = 1 THEN d.mujeres ELSE 0 END) / SUM(d.mujeres)", unidad: "%", sumable: false, decimales: 2 },
  ],
  dimensiones: [
    { clave: "edicion", titulo: "Edición", id: "d.edicion", tipo: "temporal" },
    { clave: "entidad", titulo: "Entidad", id: "substr('0' || d.ent, -2)", nombre: "e.nombre", tipo: "geografica", geo: "entidad", orden: "1" },
    { clave: "edad", titulo: "Grupo de edad", id: "d.edad_grupo", tipo: "categorica", orden: "1" },
    { clave: "tam_loc", titulo: "Tamaño de localidad", id: "d.tam_loc", nombre: "tl.nombre", tipo: "categorica", orden: "1" },
    { clave: "embarazada", titulo: "Alguna vez embarazada", id: "d.embarazada", nombre: "em.nombre", tipo: "categorica", orden: "1" },
  ],
  predeterminado: { medidas: ["mujeres", "pct_embarazadas"], columnas: ["edad"] },
  sql_corte: "SELECT MAX(edicion) AS corte FROM enadid_mujeres",
  notas: ["Los porcentajes no se suman entre grupos.", "Verificado contra el cuadro 2.1 de los tabulados oportunos de la ENADID 2023: total y siete grupos de edad exactos."],
  api_dominio: "/api/v1/inegi/datos-abiertos/programas/enadid",
};

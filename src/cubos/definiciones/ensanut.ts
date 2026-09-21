// ENSANUT 2018-19 (INSP/INEGI): índice de masa corporal en adultos de 20 años y más, por entidad, sexo y grupo de edad,
// calculado desde CN_ANTROPOMETRIA con las reglas del INSP (scripts/metodologias_inegi.py ensanut; D1 datosmexico-api-encuestas).
// Reproduce el cuadro I de Barquera y col. (Salud Pública de México, 2020) y el 39.1 % / 36.1 % de la presentación de
// resultados del INSP: n = 16 579 y 77.7 millones de adultos, por sexo y por grupo de edad.
import type { Cubo, Medida } from "../tipos";

const PCT = (col: string, titulo: string): Medida => ({ clave: `pct_${col}`, titulo, sql: `100.0 * SUM(d.${col}) / SUM(d.personas)`, unidad: "%", sumable: false, decimales: 2 });
export const ENSANUT_IMC: Cubo = {
  clave: "ensanut-imc", nombre: "Sobrepeso y obesidad en adultos (ENSANUT 2018-19)", tema: "salud",
  fuente: "INSP/INEGI — Encuesta Nacional de Salud y Nutrición (ENSANUT) 2018-19, microdatos CN_ANTROPOMETRIA (nueva versión)", fuente_url: "https://www.inegi.org.mx/programas/ensanut/2018/", licencia: "Términos de libre uso INEGI",
  descripcion: "Adultos de 20 años y más con peso y talla medidos, clasificados por índice de masa corporal (OMS: bajo peso < 18.5, normal 18.5-24.9, sobrepeso 25-29.9, obesidad ≥ 30 kg/m²), por entidad, sexo y grupo de edad. Depuración del INSP: talla de 1.3 a 2.0 m, IMC de 10 a 58, sin embarazadas, ponderador F_ANTROP_INSP.",
  binding: "DB_ENCUESTAS", desde: "ensanut_imc d JOIN cat_entidad e ON e.clave = d.ent",
  medidas: [
    { clave: "personas", titulo: "Adultos de 20 años y más", sql: "SUM(d.personas)", unidad: "personas", sumable: true, descripcion: "Población representada por los adultos con medición válida." },
    { clave: "n", titulo: "Adultos medidos (muestra)", sql: "SUM(d.n)", unidad: "personas", sumable: true },
    { clave: "sobrepeso", titulo: "Con sobrepeso", sql: "SUM(d.sobrepeso)", unidad: "personas", sumable: true }, PCT("sobrepeso", "% con sobrepeso"),
    { clave: "obesidad", titulo: "Con obesidad", sql: "SUM(d.obesidad)", unidad: "personas", sumable: true }, PCT("obesidad", "% con obesidad"),
    { clave: "pct_exceso", titulo: "% con sobrepeso u obesidad", sql: "100.0 * (SUM(d.sobrepeso) + SUM(d.obesidad)) / SUM(d.personas)", unidad: "%", sumable: false, decimales: 2 },
    PCT("normal", "% con peso normal"), PCT("bajo_peso", "% con bajo peso"),
  ],
  dimensiones: [
    { clave: "edicion", titulo: "Edición", id: "d.edicion", tipo: "temporal" },
    { clave: "entidad", titulo: "Entidad", id: "substr('0' || d.ent, -2)", nombre: "e.nombre", tipo: "geografica", geo: "entidad", orden: "1", descripcion: "Las estimaciones por entidad tienen muestras chicas (decenas de personas por celda): úselas con su n." },
    { clave: "sexo", titulo: "Sexo", id: "d.sexo", nombre: "CASE d.sexo WHEN 1 THEN 'Hombres' ELSE 'Mujeres' END", tipo: "categorica", orden: "1" },
    { clave: "edad", titulo: "Grupo de edad", id: "d.grupo_edad", tipo: "categorica", orden: "CASE d.grupo_edad WHEN '80+' THEN 9 ELSE CAST(substr(d.grupo_edad, 1, 2) AS INTEGER) END" },
  ],
  predeterminado: { medidas: ["pct_sobrepeso", "pct_obesidad", "personas", "n"], columnas: ["sexo"] },
  sql_corte: "SELECT MAX(edicion) AS corte FROM ensanut_imc",
  notas: ["Verificado contra el cuadro I de Barquera y col. (2020): n = 16 579, 77 708.1 mil adultos, 39.1 % sobrepeso y 36.1 % obesidad en el total, y las prevalencias por sexo y grupo de edad al decimal publicado.", "Peso y talla son el promedio de dos mediciones; en 60 años y más vienen de la sección de adultos mayores del cuestionario.", "Los porcentajes no se suman entre entidades ni grupos."],
  api_dominio: "/api/v1/inegi/datos-abiertos/programas/ensanut",
};

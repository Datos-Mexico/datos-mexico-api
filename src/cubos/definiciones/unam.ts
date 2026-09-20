// Cubo del Concurso de Selección a licenciatura de la UNAM (dataset del observatorio): encabezados oficiales por
// carrera-plantel y concurso (oferta, aspirantes, presentaron, seleccionados, aciertos mínimos).
import type { Cubo } from "../tipos";

export const UNAM_CONCURSO: Cubo = {
  clave: "unam-concurso", nombre: "Concurso de Selección de la UNAM", tema: "unam", fuente: "Observatorio Datos México — Concurso de Selección a licenciatura de la UNAM (encabezados oficiales de la DGAE)", fuente_url: "https://datosmexico.org/unam", licencia: "CC BY 4.0",
  descripcion: "Oferta, aspirantes, sustentantes, seleccionados y aciertos mínimos de cada carrera-plantel en cada concurso (2018 en adelante), por área, sistema, plantel y carrera.",
  binding: "DB_UNAM", desde: "encabezados",
  medidas: [
    { clave: "oferta", titulo: "Lugares ofertados", sql: "SUM(oferta)", unidad: "lugares", sumable: true },
    { clave: "aspirantes", titulo: "Aspirantes registrados", sql: "SUM(aspirantes)", unidad: "personas", sumable: true },
    { clave: "presentaron", titulo: "Presentaron el examen", sql: "SUM(presentaron)", unidad: "personas", sumable: true },
    { clave: "seleccionados", titulo: "Seleccionados", sql: "SUM(seleccionados)", unidad: "personas", sumable: true },
    { clave: "aciertos_minimos", titulo: "Aciertos mínimos (promedio)", sql: "AVG(aciertos_minimos)", unidad: "aciertos", sumable: false, decimales: 1 },
    { clave: "aciertos_minimos_max", titulo: "Aciertos mínimos (máximo)", sql: "MAX(aciertos_minimos)", unidad: "aciertos", sumable: false },
    { clave: "carreras_plantel", titulo: "Carreras-plantel", sql: "COUNT(*)", unidad: "carreras-plantel", sumable: true },
  ],
  dimensiones: [
    { clave: "anio", titulo: "Año", id: "anio", tipo: "temporal" },
    { clave: "concurso", titulo: "Concurso", id: "concurso", tipo: "categorica" },
    { clave: "sistema", titulo: "Sistema", id: "sistema", tipo: "categorica" },
    { clave: "area", titulo: "Área de conocimiento", id: "area", nombre: "CASE area WHEN 1 THEN 'Área 1: Ciencias Físico-Matemáticas y de las Ingenierías' WHEN 2 THEN 'Área 2: Ciencias Biológicas, Químicas y de la Salud' WHEN 3 THEN 'Área 3: Ciencias Sociales' WHEN 4 THEN 'Área 4: Humanidades y de las Artes' END", tipo: "categorica" },
    { clave: "plantel", titulo: "Plantel", id: "plantel", tipo: "categorica" },
    { clave: "carrera", titulo: "Carrera", id: "carrera", tipo: "categorica" },
    { clave: "carrera_plantel", titulo: "Carrera-plantel (código DGAE)", id: "carrera_codigo", nombre: "carrera || ' — ' || plantel", tipo: "categorica", padre: "carrera" },
  ],
  predeterminado: { medidas: ["presentaron", "seleccionados"], columnas: ["area", "anio"] },
  sql_corte: "SELECT MAX(anio) AS corte FROM encabezados",
  notas: ["Cifras de los encabezados oficiales que la DGAE publica con cada listado de resultados; la distribución de aciertos persona por persona está en /api/v1/unam/concurso/distribucion.", "Los aciertos mínimos son por carrera-plantel: al agrupar se promedian o se toma el máximo."],
  api_dominio: "/api/v1/unam",
};

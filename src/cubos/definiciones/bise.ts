// Cubo del Banco de Indicadores del INEGI: 31,039 indicadores con datos × geografías (nacional, 32 entidades, 2,478
// municipios) × periodos. La tabla de observaciones tiene 7.4 millones de filas: toda consulta exige un filtro por
// indicador y los miembros de esa dimensión salen del catálogo `indicadores`, no de la tabla de hechos.
import type { Cubo } from "../tipos";

export const BISE_INDICADORES: Cubo = {
  clave: "inegi-indicadores", nombre: "Banco de Indicadores del INEGI", tema: "inegi", fuente: "INEGI — Banco de Indicadores (API de indicadores)", fuente_url: "https://www.inegi.org.mx/servicios/api_indicadores.html", licencia: "Términos de libre uso INEGI",
  descripcion: "Cualquiera de los 31,039 indicadores con datos del Banco de Indicadores del INEGI, por geografía (país, entidad, municipio) y periodo. Elija primero el indicador (búsqueda por nombre) y luego la geografía o el periodo.",
  binding: "DB_BISE", desde: "observaciones o JOIN indicadores i ON i.id = o.indicador JOIN geografias g ON g.clave = o.geografia LEFT JOIN temas t ON t.clave = i.tema LEFT JOIN unidades u ON u.clave = i.unidad",
  medidas: [
    { clave: "valor", titulo: "Valor", sql: "SUM(o.valor)", unidad: "según el indicador", sumable: false, decimales: 4, descripcion: "El valor publicado; agrupe siempre por indicador, geografía y periodo para leerlo tal cual. La unidad del indicador viene en su nombre." },
    { clave: "observaciones", titulo: "Observaciones", sql: "COUNT(*)", unidad: "observaciones", sumable: true },
  ],
  dimensiones: [
    { clave: "indicador", titulo: "Indicador", id: "o.indicador", nombre: "i.descripcion || ' · ' || COALESCE(t.descripcion, '') || ' (' || COALESCE(u.descripcion, '') || ')'", tipo: "categorica", descripcion: "Búsqueda por nombre en /miembros?dimension=indicador&q=…", miembros: { desde: "indicadores i LEFT JOIN temas t ON t.clave = i.tema LEFT JOIN unidades u ON u.clave = i.unidad", id: "i.id", nombre: "i.descripcion || ' · ' || COALESCE(t.descripcion, '') || ' (' || COALESCE(u.descripcion, '') || ')'", donde: "i.con_datos = 1", orden: "i.n_observaciones DESC" } },
    { clave: "nivel", titulo: "Nivel geográfico", id: "g.nivel", tipo: "categorica", descripcion: "nacional, entidad o municipio." },
    { clave: "geografia", titulo: "Geografía", id: "o.geografia", nombre: "g.nombre", tipo: "geografica", geo: "entidad", orden: "1", descripcion: "00 = país; 2 dígitos = entidad; 5 dígitos = municipio.", miembros: { desde: "geografias g", id: "g.clave", nombre: "g.nombre", orden: "1" } },
    { clave: "periodo", titulo: "Periodo", id: "o.periodo", tipo: "temporal", descripcion: "Como lo publica el INEGI (año, año/trimestre, año/mes…)." },
  ],
  filtro_obligatorio: ["indicador"],
  predeterminado: { medidas: ["valor"], columnas: ["geografia", "periodo"], filtros: { indicador: ["1002000001"], nivel: ["entidad"] } },
  sql_corte: "SELECT MAX(ultima_actualizacion) AS corte FROM indicadores",
  notas: ["Toda consulta exige `f.indicador`; sin él la base no puede agrupar 7.4 millones de filas.", "El valor se guarda como lo publica el INEGI; las excepciones (cifras no disponibles) quedan como nulos."],
  api_dominio: "/api/v1/inegi",
};

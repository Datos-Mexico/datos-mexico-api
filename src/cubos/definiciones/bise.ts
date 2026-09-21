// Cubo del Banco de Indicadores del INEGI: 31,039 indicadores con datos × geografías (nacional, 32 entidades, 2,478
// municipios) × periodos. La tabla de observaciones tiene 7.4 millones de filas: toda consulta exige un filtro por
// indicador y los miembros de esa dimensión salen del catálogo `indicadores`, no de la tabla de hechos.
import type { Cubo } from "../tipos";

// Nombre legible del indicador: el INEGI publica nombres cortos ("Total nacional", "Mujeres") que 17,682 de los 31,039
// indicadores con datos comparten con otro; la ruta temática del Banco de Indicadores (scripts/bise_arbol.py) y la
// posición dentro del tema hoja son lo que los distingue en el sitio del INEGI. Ejemplo:
// "Población total — Demografía y Sociedad › Población › Población · n.º 1 (Personas)".
const NOMBRE_INDICADOR = "i.descripcion || ' — ' || COALESCE(i.ruta, t.descripcion, '') || COALESCE(' · n.º ' || i.orden_arbol, '') || ' (' || COALESCE(u.descripcion, '') || ')'";

export const BISE_INDICADORES: Cubo = {
  clave: "inegi-indicadores", nombre: "Banco de Indicadores del INEGI", tema: "inegi", fuente: "INEGI — Banco de Indicadores (API de indicadores)", fuente_url: "https://www.inegi.org.mx/servicios/api_indicadores.html", licencia: "Términos de libre uso INEGI",
  descripcion: "Cualquiera de los 31,039 indicadores con datos del Banco de Indicadores del INEGI, por geografía (país, entidad, municipio) y periodo. Elija primero el indicador (búsqueda por nombre) y luego la geografía o el periodo.",
  binding: "DB_BISE", desde: "observaciones o JOIN indicadores i ON i.id = o.indicador JOIN geografias g ON g.clave = o.geografia LEFT JOIN temas t ON t.clave = i.tema LEFT JOIN unidades u ON u.clave = i.unidad",
  medidas: [
    { clave: "valor", titulo: "Valor", sql: "SUM(o.valor)", unidad: "según el indicador", sumable: false, decimales: 4, descripcion: "El valor publicado; agrupe siempre por indicador, geografía y periodo para leerlo tal cual. La unidad del indicador viene en su nombre." },
    { clave: "observaciones", titulo: "Observaciones", sql: "COUNT(*)", unidad: "observaciones", sumable: true },
  ],
  dimensiones: [
    { clave: "indicador", titulo: "Indicador", id: "o.indicador", nombre: NOMBRE_INDICADOR, tipo: "categorica", descripcion: "Nombre del INEGI, ruta temática del Banco de Indicadores (tema › subtema › …), posición dentro del tema hoja y unidad. Búsqueda por cualquier parte del nombre en /miembros?dimension=indicador&q=…", miembros: { desde: "indicadores i LEFT JOIN temas t ON t.clave = i.tema LEFT JOIN unidades u ON u.clave = i.unidad", id: "i.id", nombre: NOMBRE_INDICADOR, donde: "i.con_datos = 1", orden: "i.n_observaciones DESC" } },
    { clave: "nivel", titulo: "Nivel geográfico", id: "g.nivel", tipo: "categorica", descripcion: "nacional, entidad o municipio. Los tres niveles contienen a la misma población: toda consulta filtra uno o agrupa por él (o por geografía).", particion: { implicita_en: ["geografia"] }, miembros: { desde: "(SELECT DISTINCT nivel FROM geografias) x", id: "x.nivel", nombre: "x.nivel", orden: "CASE x.nivel WHEN 'nacional' THEN 1 WHEN 'entidad' THEN 2 ELSE 3 END" } },
    { clave: "geografia", titulo: "Geografía", id: "o.geografia", nombre: "g.nombre", tipo: "geografica", geo: "entidad", orden: "1", descripcion: "00 = país; 2 dígitos = entidad; 5 dígitos = municipio.", miembros: { desde: "geografias g", id: "g.clave", nombre: "g.nombre", orden: "1" } },
    { clave: "periodo", titulo: "Periodo", id: "o.periodo", tipo: "temporal", descripcion: "Como lo publica el INEGI (año, año/trimestre, año/mes…). Sin filtro de indicador, la lista de miembros sale del catálogo `periodos` (todos los periodos con observaciones en la base).", miembros: { desde: "periodos p", id: "p.periodo", nombre: "p.periodo", orden: "1" } },
  ],
  filtro_obligatorio: ["indicador"],
  predeterminado: { medidas: ["valor"], columnas: ["geografia", "periodo"], filtros: { indicador: ["1002000001"], nivel: ["entidad"] } },
  sql_corte: "SELECT substr(MAX(ultima_actualizacion), 1, 10) AS corte FROM indicadores",
  notas: ["Toda consulta exige `f.indicador`; sin él la base no puede agrupar 7.4 millones de filas.", "Toda consulta filtra un nivel geográfico o agrupa por nivel o por geografía: país, entidades y municipios contienen a la misma población y sumarlos entre sí cuenta tres veces lo mismo (el motor rechaza esa consulta con 422).", "El valor se guarda como lo publica el INEGI; las excepciones (cifras no disponibles) quedan como nulos.", "El nombre de cada indicador lleva su ruta temática y su posición en el tema porque el INEGI repite el nombre corto en miles de series (por ejemplo, las 2,672 series del PIB por actividad económica se llaman «Total nacional», «43 Comercio al por mayor»… y solo se distinguen por su posición); el árbol completo está en /api/v1/inegi/arbol."],
  api_dominio: "/api/v1/inegi",
};

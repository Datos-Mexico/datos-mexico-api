// Cubo del Banco de Información Económica (BIE) del INEGI: 89 mil series económicas (INPC, PIB, IGAE, balanza
// comercial, coyuntura…) por área geográfica y periodo, en la D1 datosmexico-api-bie (scripts/bie_d1.py). Como en el
// Banco de Indicadores: toda consulta exige una serie, y el desglose geográfico es una partición (nacional, estatal,
// otras áreas) para que no se sumen universos que se contienen.
import type { Cubo } from "../tipos";

const NOMBRE_SERIE = "s.nombre || ' — ' || COALESCE(s.ruta, '') || ' (' || COALESCE(s.unidad, '') || ')'";

export const BIE_SERIES: Cubo = {
  clave: "bie-series", nombre: "Banco de Información Económica del INEGI (BIE)", tema: "inegi", fuente: "INEGI — Banco de Información Económica (BIE)", fuente_url: "https://www.inegi.org.mx/app/indicadores/?tm=3", licencia: "Términos de libre uso INEGI",
  descripcion: "Cualquiera de las series del Banco de Información Económica del INEGI (inflación, PIB trimestral, IGAE, balanza comercial, indicadores de coyuntura, cuentas nacionales, manufacturas, sector externo…) por área geográfica y periodo. Elija primero la serie (búsqueda por nombre con sinónimos) y luego el área o el periodo.",
  binding: "DB_BIE", desde: "observaciones o JOIN series s ON s.id = o.serie JOIN areas a ON a.clave = o.area",
  medidas: [
    { clave: "valor", titulo: "Valor", sql: "SUM(o.valor)", unidad: "según la serie", sumable: false, decimales: 4, descripcion: "El valor publicado; agrupe siempre por serie, área y periodo para leerlo tal cual. La unidad de la serie viene en su nombre." },
    { clave: "observaciones", titulo: "Observaciones", sql: "COUNT(*)", unidad: "observaciones", sumable: true },
  ],
  dimensiones: [
    { clave: "serie", titulo: "Serie", id: "o.serie", nombre: NOMBRE_SERIE, tipo: "categorica", descripcion: "Nombre del INEGI, ruta temática del BIE y unidad. Búsqueda con sinónimos en /miembros?dimension=serie&q=…", miembros: { desde: "series s", id: "s.id", nombre: NOMBRE_SERIE, orden: "s.n_observaciones DESC", buscar: "s.busqueda" } },
    { clave: "desglose", titulo: "Desglose geográfico", id: "a.desglose", tipo: "categorica", descripcion: "Nacional, Estatal u Otra área (zonas metropolitanas, ciudades, países). Los niveles contienen a la misma economía: toda consulta filtra uno o agrupa por él (o por área).", particion: { implicita_en: ["area"] }, miembros: { desde: "(SELECT DISTINCT desglose FROM areas) x", id: "x.desglose", nombre: "x.desglose", orden: "CASE x.desglose WHEN 'Nacional' THEN 1 WHEN 'Estatal' THEN 2 ELSE 3 END" } },
    { clave: "area", titulo: "Área geográfica", id: "o.area", nombre: "a.nombre", tipo: "geografica", geo: "entidad", orden: "1", descripcion: "00 = país; 01-32 = entidades; otras claves = zonas metropolitanas, ciudades o países del INEGI.", miembros: { desde: "areas a", id: "a.clave", nombre: "a.nombre", orden: "1" } },
    { clave: "periodo", titulo: "Periodo", id: "o.periodo", tipo: "temporal", descripcion: "Como lo publica el INEGI (año, año/mes, año/trimestre…).", miembros: { desde: "periodos p", id: "p.periodo", nombre: "p.periodo", orden: "1" } },
  ],
  filtro_obligatorio: ["serie"],
  predeterminado: { medidas: ["valor"], columnas: ["periodo"], filtros: { serie: ["334452"], desglose: ["Nacional"] } },
  sql_corte: "SELECT MAX(ultima_actualizacion) AS corte FROM series",
  notas: ["Toda consulta exige `f.serie`.", "Toda consulta filtra un desglose geográfico o agrupa por desglose o por área.", "El valor se guarda como lo publica el INEGI (decimal original en valor_texto de /api/v1/bie).", "Origen: API interna del sitio del INEGI (su API de desarrolladores no responde para el BIE); ver la bitácora."],
  api_dominio: "/api/v1/bie",
};

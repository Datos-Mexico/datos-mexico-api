// DENUE histórico: las 25 ediciones que el INEGI publica en la descarga masiva por entidad (2010 a 05/2026), agregadas por edición,
// entidad, municipio, clase de actividad y estrato de personal ocupado (scripts/denue_historico.py). Cada edición se
// verifica contra la cifra que el INEGI publicó en su comunicado o documento metodológico (tabla denue_ediciones); las
// ediciones cuya suma no coincide con esa cifra quedan fuera de los cubos (verificado = 0) y visibles en /api/v1/denue/ediciones.
import type { Cubo, Dimension } from "../tipos";

const SECTORES: [string, string][] = [
  ["11", "Agricultura, cría y explotación de animales, aprovechamiento forestal, pesca y caza"], ["21", "Minería"], ["22", "Generación, transmisión, distribución y comercialización de energía eléctrica, suministro de agua y de gas natural por ductos al consumidor final"], ["23", "Construcción"], ["31-33", "Industrias manufactureras"], ["43", "Comercio al por mayor"], ["46", "Comercio al por menor"], ["48-49", "Transportes, correos y almacenamiento"], ["51", "Información en medios masivos"], ["52", "Servicios financieros y de seguros"], ["53", "Servicios inmobiliarios y de alquiler de bienes muebles e intangibles"], ["54", "Servicios profesionales, científicos y técnicos"], ["55", "Corporativos"], ["56", "Servicios de apoyo a los negocios y manejo de residuos, y servicios de remediación"], ["61", "Servicios educativos"], ["62", "Servicios de salud y de asistencia social"], ["71", "Servicios de esparcimiento culturales y deportivos, y otros servicios recreativos"], ["72", "Servicios de alojamiento temporal y de preparación de alimentos y bebidas"], ["81", "Otros servicios excepto actividades gubernamentales"], ["93", "Actividades legislativas, gubernamentales, de impartición de justicia y de organismos internacionales y extraterritoriales"],
];
const SECTOR_ID = "CASE WHEN substr(h.codigo_act, 1, 2) IN ('31','32','33') THEN '31-33' WHEN substr(h.codigo_act, 1, 2) IN ('48','49') THEN '48-49' ELSE substr(h.codigo_act, 1, 2) END";
const SECTOR_NOMBRE = `CASE ${SECTOR_ID} ${SECTORES.map(([k, v]) => `WHEN '${k}' THEN '${v.replace(/'/g, "''")}'`).join(" ")} ELSE 'Sector ' || substr(h.codigo_act, 1, 2) END`;
const EDICION: Dimension = { clave: "edicion", titulo: "Edición del DENUE", id: "h.edicion", nombre: "e.periodo_inegi", tipo: "temporal", orden: "1", miembros: { desde: "denue_ediciones e", id: "e.edicion", nombre: "e.periodo_inegi", donde: "e.verificado IS NOT 0", orden: "e.orden" }, descripcion: "Edición de la descarga masiva del INEGI (mes/año); 2010, 2011 y 2012 son el DENUE de julio 2010, 03/2011 y 06/2012; 2015 es el DENUE Interactivo 01/2015." };
const ACTIVIDAD: Dimension[] = [
  { clave: "sector", titulo: "Sector (SCIAN)", id: SECTOR_ID, nombre: SECTOR_NOMBRE, tipo: "categorica", orden: "1" },
  { clave: "subsector", titulo: "Subsector (SCIAN, 3 dígitos)", id: "substr(h.codigo_act, 1, 3)", tipo: "categorica", padre: "sector", orden: "1" },
  { clave: "rama", titulo: "Rama (SCIAN, 4 dígitos)", id: "substr(h.codigo_act, 1, 4)", tipo: "categorica", padre: "subsector", orden: "1" },
  { clave: "actividad", titulo: "Clase de actividad (SCIAN, 6 dígitos)", id: "h.codigo_act", nombre: "MAX(a.nombre_act)", tipo: "categorica", padre: "rama", orden: "1", descripcion: "El DENUE de 2010 a 10/2013 codifica con el SCIAN 2007 (Censos Económicos 2009), de 2015 a 03/2018 con el SCIAN 2013 y de 11/2018 a 05/2026 con el SCIAN 2018 (diccionario de datos de cada edición) (tabla denue_ediciones.scian); el nombre es el de la edición más reciente en la consulta." },
  { clave: "personal", titulo: "Personal ocupado (estrato)", id: "s.nombre", tipo: "categorica", orden: "s.cod" },
];
const NOTAS = [
  "Fuente: archivos por entidad de la descarga masiva del INEGI (www.inegi.org.mx/app/descarga/?ti=6), 815 archivos CSV en 25 ediciones (2010 a 05/2026), archivados íntegros en R2 (inegi/fuentes/denue-historico-entidad/; los 484 archivos por sector de 2015-2026 en inegi/fuentes/denue-historico/) y como Parquet por edición (denue/historico/).",
  "Cada edición se coteja con la cifra publicada por el INEGI (comunicados de prensa y documentos metodológicos, archivados); las que no cuadran quedan fuera de este cubo y aparecen en /api/v1/denue/ediciones con su diferencia.",
  "Las ediciones no son una serie de tiempo homogénea: cada una refleja la actualización del directorio (Censos Económicos 2014, 2019 y 2024, registros administrativos), no la creación o cierre de negocios. El INEGI documenta cada corte en su documento metodológico.",
  "Las unidades sin estrato de personal ocupado se agrupan como «No especificado».",
];

export const DENUE_HISTORICO: Cubo = {
  clave: "denue-historico", nombre: "DENUE histórico por edición (2010-2026)", tema: "economia", fuente: "INEGI — DENUE, descarga masiva por entidad, 25 ediciones (2010 a 05/2026)", fuente_url: "https://www.inegi.org.mx/app/descarga/?ti=6", licencia: "Términos de libre uso INEGI",
  descripcion: "Unidades económicas de cada edición del DENUE por entidad, sector y clase de actividad (SCIAN) y estrato de personal ocupado; solo ediciones cuyo total coincide con la cifra publicada por el INEGI.",
  binding: "DB_DENUE", desde: "denue_hist_entidad h JOIN denue_ediciones e ON e.edicion = h.edicion LEFT JOIN denue_hist_ent_nombre en ON en.cve_ent = h.cve_ent LEFT JOIN denue_hist_act_nombre a ON a.codigo_act = h.codigo_act LEFT JOIN denue_hist_estratos s ON s.cod = h.per_ocu_cod",
  donde: "e.verificado IS NOT 0",
  medidas: [{ clave: "unidades", titulo: "Unidades económicas", sql: "SUM(h.n)", unidad: "unidades", sumable: true }, { clave: "clases", titulo: "Clases de actividad presentes", sql: "COUNT(DISTINCT h.codigo_act)", unidad: "clases", sumable: false }],
  dimensiones: [EDICION, { clave: "entidad", titulo: "Entidad", id: "h.cve_ent", nombre: "en.entidad", tipo: "geografica", geo: "entidad", orden: "1" }, ...ACTIVIDAD],
  predeterminado: { medidas: ["unidades"], columnas: ["edicion"] },
  sql_corte: "SELECT MAX(edicion) AS corte FROM denue_ediciones",
  notas: [...NOTAS, "Tabla preagregada por edición, entidad, clase y estrato (denue_hist_entidad); el detalle municipal está en el cubo denue-historico-municipal."],
  api_dominio: "/api/v1/denue",
};

export const DENUE_HISTORICO_MUNICIPAL: Cubo = {
  clave: "denue-historico-municipal", nombre: "DENUE histórico por municipio", tema: "economia", fuente: "INEGI — DENUE, descarga masiva por entidad, 25 ediciones (2010 a 05/2026)", fuente_url: "https://www.inegi.org.mx/app/descarga/?ti=6", licencia: "Términos de libre uso INEGI",
  descripcion: "Unidades económicas de una edición del DENUE por municipio, clase de actividad (SCIAN) y estrato de personal ocupado. Toda consulta filtra una edición.",
  binding: "DB_DENUE", desde: "denue_historico h JOIN denue_ediciones e ON e.edicion = h.edicion LEFT JOIN denue_hist_ent_nombre en ON en.cve_ent = h.cve_ent LEFT JOIN denue_hist_municipios m ON m.edicion = h.edicion AND m.cve_ent = h.cve_ent AND m.cve_mun = h.cve_mun LEFT JOIN denue_hist_act_nombre a ON a.codigo_act = h.codigo_act LEFT JOIN denue_hist_estratos s ON s.cod = h.per_ocu_cod",
  donde: "e.verificado IS NOT 0",
  medidas: [{ clave: "unidades", titulo: "Unidades económicas", sql: "SUM(h.n)", unidad: "unidades", sumable: true }, { clave: "clases", titulo: "Clases de actividad presentes", sql: "COUNT(DISTINCT h.codigo_act)", unidad: "clases", sumable: false }],
  dimensiones: [EDICION,
    { clave: "entidad", titulo: "Entidad", id: "h.cve_ent", nombre: "en.entidad", tipo: "geografica", geo: "entidad", orden: "1" },
    { clave: "municipio", titulo: "Municipio", id: "h.cve_ent || h.cve_mun", nombre: "m.municipio", tipo: "geografica", geo: "municipio", padre: "entidad", orden: "1", descripcion: "Nombre del municipio en la edición consultada (la edición es filtro obligatorio)." },
    ...ACTIVIDAD],
  predeterminado: { medidas: ["unidades"], columnas: ["entidad"], filtros: { edicion: ["2026-05"] } },
  sql_corte: "SELECT MAX(edicion) AS corte FROM denue_ediciones",
  notas: [...NOTAS, "Tabla por edición, municipio, clase y estrato (12 millones de filas): la edición es filtro obligatorio; la serie por edición está en denue-historico."],
  filtro_obligatorio: ["edicion"],
  api_dominio: "/api/v1/denue",
};

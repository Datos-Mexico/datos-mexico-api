// Cubo del DENUE sobre la tabla preagregada `denue_resumen` (scripts/denue_resumen_d1.py): unidades económicas por
// entidad, municipio, clase de actividad SCIAN 2018 y estrato de personal ocupado. La suma de `n` es igual al conteo de
// las 6,138,075 unidades (verificado al cargar).
import type { Cubo } from "../tipos";

// Sectores del SCIAN 2018 (títulos oficiales del INEGI); los sectores 31-33 y 48-49 abarcan varios códigos de dos dígitos.
const SECTORES: [string, string][] = [
  ["11", "Agricultura, cría y explotación de animales, aprovechamiento forestal, pesca y caza"], ["21", "Minería"], ["22", "Generación, transmisión, distribución y comercialización de energía eléctrica, suministro de agua y de gas natural por ductos al consumidor final"], ["23", "Construcción"], ["31-33", "Industrias manufactureras"], ["43", "Comercio al por mayor"], ["46", "Comercio al por menor"], ["48-49", "Transportes, correos y almacenamiento"], ["51", "Información en medios masivos"], ["52", "Servicios financieros y de seguros"], ["53", "Servicios inmobiliarios y de alquiler de bienes muebles e intangibles"], ["54", "Servicios profesionales, científicos y técnicos"], ["55", "Corporativos"], ["56", "Servicios de apoyo a los negocios y manejo de residuos, y servicios de remediación"], ["61", "Servicios educativos"], ["62", "Servicios de salud y de asistencia social"], ["71", "Servicios de esparcimiento culturales y deportivos, y otros servicios recreativos"], ["72", "Servicios de alojamiento temporal y de preparación de alimentos y bebidas"], ["81", "Otros servicios excepto actividades gubernamentales"], ["93", "Actividades legislativas, gubernamentales, de impartición de justicia y de organismos internacionales y extraterritoriales"],
];
const SECTOR_ID = "CASE WHEN substr(codigo_act, 1, 2) IN ('31','32','33') THEN '31-33' WHEN substr(codigo_act, 1, 2) IN ('48','49') THEN '48-49' ELSE substr(codigo_act, 1, 2) END";
const SECTOR_NOMBRE = `CASE ${SECTOR_ID} ${SECTORES.map(([k, v]) => `WHEN '${k}' THEN '${v.replace(/'/g, "''")}'`).join(" ")} ELSE 'Sector ' || substr(codigo_act, 1, 2) END`;
const PER_OCU_ORDEN = "MIN(CASE per_ocu WHEN '0 a 5 personas' THEN 1 WHEN '6 a 10 personas' THEN 2 WHEN '11 a 30 personas' THEN 3 WHEN '31 a 50 personas' THEN 4 WHEN '51 a 100 personas' THEN 5 WHEN '101 a 250 personas' THEN 6 WHEN '251 y más personas' THEN 7 ELSE 8 END)";

export const DENUE_UNIDADES: Cubo = {
  clave: "denue-unidades", nombre: "Unidades económicas (DENUE)", tema: "economia", fuente: "INEGI — Directorio Estadístico Nacional de Unidades Económicas (DENUE), edición 05/2026", fuente_url: "https://www.inegi.org.mx/app/mapa/denue/", licencia: "Términos de libre uso INEGI",
  descripcion: "Las 6,138,075 unidades económicas del país por entidad, municipio, sector y clase de actividad (SCIAN 2018) y estrato de personal ocupado.",
  binding: "DB_DENUE", desde: "denue_resumen",
  medidas: [{ clave: "unidades", titulo: "Unidades económicas", sql: "SUM(n)", unidad: "unidades", sumable: true }, { clave: "clases", titulo: "Clases de actividad presentes", sql: "COUNT(DISTINCT codigo_act)", unidad: "clases", sumable: false }],
  dimensiones: [
    { clave: "entidad", titulo: "Entidad", id: "cve_ent", nombre: "entidad", tipo: "geografica", geo: "entidad", orden: "1" },
    { clave: "municipio", titulo: "Municipio", id: "cve_ent || cve_mun", nombre: "municipio", tipo: "geografica", geo: "municipio", padre: "entidad", orden: "1" },
    { clave: "sector", titulo: "Sector (SCIAN)", id: SECTOR_ID, nombre: SECTOR_NOMBRE, tipo: "categorica", orden: "1" },
    { clave: "subsector", titulo: "Subsector (SCIAN, 3 dígitos)", id: "substr(codigo_act, 1, 3)", tipo: "categorica", padre: "sector", orden: "1" },
    { clave: "rama", titulo: "Rama (SCIAN, 4 dígitos)", id: "substr(codigo_act, 1, 4)", tipo: "categorica", padre: "subsector", orden: "1" },
    { clave: "actividad", titulo: "Clase de actividad (SCIAN, 6 dígitos)", id: "codigo_act", nombre: "nombre_act", tipo: "categorica", padre: "rama", orden: "1" },
    { clave: "personal", titulo: "Personal ocupado (estrato)", id: "per_ocu", tipo: "categorica", orden: PER_OCU_ORDEN },
  ],
  predeterminado: { medidas: ["unidades"], columnas: ["sector"] },
  sql_corte: "SELECT '2026-05' AS corte",
  notas: ["Tabla preagregada por entidad, municipio, clase y estrato (la fila por unidad está en /api/v1/denue/unidades).", "Subsector y rama no tienen nombre en el DENUE; el sector lleva el título oficial del SCIAN 2018."],
  api_dominio: "/api/v1/denue",
};

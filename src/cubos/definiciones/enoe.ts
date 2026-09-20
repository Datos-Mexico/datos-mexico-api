// Cubos de la ENOE (indicadores trimestrales por entidad y cortes de ocupados). Las 32 entidades suman exactamente el
// nacional (verificado 2025T1: 58,921,494 ocupados), así que los cubos por entidad contienen el país completo.
import { POSICION_NOMBRE, SECTOR_NOMBRE } from "../../enoe/constantes";
import type { Cubo, Dimension, Medida } from "../tipos";

const FUENTE = { fuente: "INEGI — Encuesta Nacional de Ocupación y Empleo (ENOE), población de 15 años y más", fuente_url: "https://www.inegi.org.mx/programas/enoe/15ymas/", licencia: "Términos de libre uso INEGI" };
const D_PERIODO: Dimension = { clave: "periodo", titulo: "Trimestre", id: "periodo", tipo: "temporal", descripcion: "Trimestre en formato AAAATn (2005T1 a 2025T1; 2020T2 no existe: ETOE telefónica)." };
const D_ENTIDAD = (col: string): Dimension => ({ clave: "entidad", titulo: "Entidad", id: col, nombre: "e.nombre", tipo: "geografica", geo: "entidad", orden: "1" });
const D_ETAPA: Dimension = { clave: "etapa", titulo: "Etapa metodológica", id: "etapa", tipo: "categorica", descripcion: "clasica (2005-2020T1) o enoe_n (2020T3 en adelante, marco del Censo 2020)." };

const INDICADORES: [string, string, string][] = [
  ["pob_15ymas", "Población de 15 años y más", "personas"], ["pea_total", "Población económicamente activa", "personas"], ["pnea_total", "Población no económicamente activa", "personas"],
  ["ocupados_total", "Ocupados", "personas"], ["desocupados_total", "Desocupados", "personas"], ["subocupados_total", "Subocupados", "personas"], ["informales_total", "Ocupados en la informalidad", "personas"], ["condcrit_total", "Ocupados en condiciones críticas", "personas"],
  ["tasa_participacion", "Tasa de participación", "porcentaje"], ["tasa_desocupacion", "Tasa de desocupación", "porcentaje"], ["tasa_subocupacion", "Tasa de subocupación", "porcentaje"], ["tasa_informalidad_til1", "Tasa de informalidad laboral (TIL1)", "porcentaje"], ["tasa_ocupacion_critica_tcco", "Tasa de condiciones críticas de ocupación (TCCO)", "porcentaje"],
];
const medidasIndicadores = (): Medida[] => INDICADORES.map(([k, t, u]) => ({ clave: k, titulo: t, sql: `SUM(CASE WHEN indicador = '${k}' THEN valor END)`, unidad: u, sumable: u === "personas", decimales: u === "porcentaje" ? 2 : 0, descripcion: u === "porcentaje" ? "Tasa: no se suma entre entidades ni entre trimestres." : undefined }));

export const ENOE_ENTIDAD: Cubo = {
  clave: "enoe-indicadores-entidad", nombre: "Indicadores laborales por entidad", tema: "trabajo", ...FUENTE,
  descripcion: "Los 13 indicadores laborales de la ENOE (población de 15 y más, PEA, ocupados, desocupados, subocupados, informales, condiciones críticas y sus tasas) por trimestre y entidad federativa, 2005T1 a 2025T1.",
  binding: "DB_ENOE", desde: "indicadores_entidad i LEFT JOIN cat_entidad e ON e.clave = i.entidad_clave",
  medidas: medidasIndicadores(), dimensiones: [D_PERIODO, D_ENTIDAD("i.entidad_clave"), D_ETAPA],
  predeterminado: { medidas: ["ocupados_total", "tasa_desocupacion"], columnas: ["entidad"], filtros: { periodo: ["2025T1"] } },
  sql_corte: "SELECT MAX(periodo) AS corte FROM indicadores_entidad",
  notas: ["Los conteos son personas con factor de expansión; las 32 entidades suman el nacional.", "Las tasas son porcentajes: sumarlas no tiene sentido; agrúpelas siempre con trimestre y entidad."],
  api_dominio: "/api/v1/enoe",
};
export const ENOE_NACIONAL: Cubo = {
  clave: "enoe-indicadores-nacional", nombre: "Indicadores laborales nacionales", tema: "trabajo", ...FUENTE,
  descripcion: "Los 13 indicadores laborales de la ENOE a nivel nacional, trimestre por trimestre desde 2005T1.",
  binding: "DB_ENOE", desde: "indicadores_nacionales", medidas: medidasIndicadores(), dimensiones: [D_PERIODO, D_ETAPA],
  predeterminado: { medidas: ["tasa_desocupacion", "tasa_informalidad_til1"], columnas: ["periodo"] },
  sql_corte: "SELECT MAX(periodo) AS corte FROM indicadores_nacionales", notas: ["Las tasas son porcentajes: no se suman entre trimestres."], api_dominio: "/api/v1/enoe",
};

const caso = (col: string, m: Map<string | number, string>) => `CASE ${col} ${[...m.entries()].map(([k, v]) => `WHEN ${typeof k === "number" ? k : `'${k}'`} THEN '${v.replace(/'/g, "''")}'`).join(" ")} END`;
export const ENOE_SECTOR: Cubo = {
  clave: "enoe-ocupados-sector", nombre: "Ocupados por sector de actividad", tema: "trabajo", ...FUENTE,
  descripcion: "Población ocupada por sector de actividad económica (12 sectores SCIAN agregados), trimestre y entidad federativa.",
  binding: "DB_ENOE", desde: "poblacion_ocupada_por_sector s LEFT JOIN cat_entidad e ON e.clave = s.geo_clave", donde: "s.nivel = 'entidad'",
  medidas: [{ clave: "ocupados", titulo: "Ocupados", sql: "SUM(total_personas)", unidad: "personas", sumable: true }, { clave: "participacion", titulo: "Participación en los ocupados de la entidad", sql: "AVG(pct_ocupados)", unidad: "porcentaje", sumable: false, decimales: 2 }],
  dimensiones: [D_PERIODO, D_ENTIDAD("s.geo_clave"), { clave: "sector", titulo: "Sector de actividad", id: "s.sector_clave", nombre: caso("s.sector_clave", SECTOR_NOMBRE as Map<string | number, string>), tipo: "categorica", orden: "CAST(s.sector_clave AS INTEGER)" }, { ...D_ETAPA, id: "s.etapa" }],
  predeterminado: { medidas: ["ocupados"], columnas: ["sector"], filtros: { periodo: ["2025T1"] } },
  sql_corte: "SELECT MAX(periodo) AS corte FROM poblacion_ocupada_por_sector", notas: ["Personas con factor de expansión (fac_tri); las 32 entidades suman el nacional.", "La participación es el % del sector en los ocupados de su entidad y trimestre; el promedio entre entidades no es la participación nacional."], api_dominio: "/api/v1/enoe",
};
export const ENOE_POSICION: Cubo = {
  clave: "enoe-ocupados-posicion", nombre: "Ocupados por posición en la ocupación", tema: "trabajo", ...FUENTE,
  descripcion: "Población ocupada por posición (subordinados y remunerados, empleadores, cuenta propia, no remunerados), trimestre y entidad federativa.",
  binding: "DB_ENOE", desde: "poblacion_ocupada_por_posicion s LEFT JOIN cat_entidad e ON e.clave = s.geo_clave", donde: "s.nivel = 'entidad'",
  medidas: [{ clave: "ocupados", titulo: "Ocupados", sql: "SUM(total_personas)", unidad: "personas", sumable: true }, { clave: "participacion", titulo: "Participación en los ocupados de la entidad", sql: "AVG(pct_ocupados)", unidad: "porcentaje", sumable: false, decimales: 2 }],
  dimensiones: [D_PERIODO, D_ENTIDAD("s.geo_clave"), { clave: "posicion", titulo: "Posición en la ocupación", id: "s.pos_clave", nombre: caso("s.pos_clave", POSICION_NOMBRE as Map<string | number, string>), tipo: "categorica", orden: "1" }, { ...D_ETAPA, id: "s.etapa" }],
  predeterminado: { medidas: ["ocupados"], columnas: ["posicion"], filtros: { periodo: ["2025T1"] } },
  sql_corte: "SELECT MAX(periodo) AS corte FROM poblacion_ocupada_por_posicion", notas: ["Personas con factor de expansión (fac_tri); las 32 entidades suman el nacional."], api_dominio: "/api/v1/enoe",
};

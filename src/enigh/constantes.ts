// Constantes del router ENIGH del legacy, verbatim.
export const ENIGH_EDITION = "ENIGH 2024 Nueva Serie";
export const ENIGH_REFERENCE_DATE = "2024 (levantamiento agosto-noviembre)";
export const ENIGH_PERIODICITY = "trimestral (expandido a nacional con factor)";
export const SCHEMA_VERSION = "007";

// (col, slug, nombre, valor_oficial_mensual, tol_rel)
export const BOUNDS_GASTOS_MENSUAL: [string, string, string, number, number][] = [
  ["gasto_mon", "gasto_monetario", "Gasto monetario total", 15891, 0.005],
  ["alimentos", "alimentos", "Alimentos, bebidas y tabaco", 5994, 0.002],
  ["transporte", "transporte", "Transporte y comunicaciones", 3106, 0.002],
  ["educa_espa", "educacion_esparcimiento", "Educación y esparcimiento", 1531, 0.002],
  ["vivienda", "vivienda", "Vivienda y servicios", 1449, 0.002],
  ["personales", "cuidados_personales", "Cuidados personales", 1236, 0.002],
  ["limpieza", "limpieza_hogar", "Enseres / limpieza del hogar", 1005, 0.002],
  ["vesti_calz", "vestido_calzado", "Vestido y calzado", 610, 0.005],
  ["salud", "salud", "Salud", 535, 0.005],
  ["transf_gas", "transferencias_gasto", "Transferencias y otros gastos", 425, 0.005],
];
// (scope, name, oficial, tol)
export const BOUNDS_INGRESO_TRIM: [string, string, number, number][] = [
  ["total", "Ingreso corriente promedio por hogar (total)", 77864, 0.01],
  ["d1", "Ingreso corriente promedio — decil I", 16795, 0.02],
  ["d10", "Ingreso corriente promedio — decil X", 236095, 0.03],
];
// (col, slug, nombre)
export const RUBROS: [string, string, string][] = [
  ["alimentos", "alimentos", "Alimentos, bebidas y tabaco"],
  ["transporte", "transporte", "Transporte y comunicaciones"],
  ["educa_espa", "educacion_esparcimiento", "Educación y esparcimiento"],
  ["vivienda", "vivienda", "Vivienda y servicios"],
  ["personales", "cuidados_personales", "Cuidados personales"],
  ["limpieza", "limpieza_hogar", "Enseres / limpieza del hogar"],
  ["vesti_calz", "vestido_calzado", "Vestido y calzado"],
  ["salud", "salud", "Salud"],
  ["transf_gas", "transferencias_gasto", "Transferencias y otros gastos"],
];
export const SOURCES = [
  { title: "Comunicado de Prensa 112/25 — ENIGH 2024", url: "https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2025/enigh/ENIGH2024.pdf", consulted_on: "2026-04-21" },
  { title: "Presentación de resultados ENIGH 2024 (JULIO 2025)", url: "https://www.inegi.org.mx/contenidos/programas/enigh/nc/2024/doc/enigh2024_ns_presentacion_resultados.pdf", consulted_on: "2026-04-22" },
  { title: "Catálogo ENIGH 2024 — Nueva Serie", url: "https://www.inegi.org.mx/programas/enigh/nc/2024/", consulted_on: "2026-04-21" },
];
export const METHODOLOGY_NOTES = [
  "Todas las cifras nacionales usan SUM(columna * factor) / SUM(factor); los agregados muestrales (simple promedio de filas) NO se exponen.",
  "Las publicaciones oficiales INEGI se reproducen desde concentradohogar (tabla summary), no desde gastoshogar (tabla ledger de eventos). Ver §1.quater del plan de schema: concentradohogar integra dedup/neteo aplicado por INEGI internamente.",
  "Las cifras publicadas por INEGI son MENSUALES; el microdato almacena TRIMESTRALES. Los endpoints devuelven ambas unidades cuando aplica.",
  "Cobertura 'hogares con actividad X' usa DISTINCT (folioviv, foliohog) sobre la tabla de la actividad porque agro/noagro son tablas persona-trabajo-tipoact, no hogar-raíz.",
  "cat_entidad.clave usa 2 dígitos (01-32); se deriva vía LEFT(ubica_geo, 2) o se toma directo de hogares.entidad según la tabla.",
];
export const NOTE_AGRO = "Agro = subsistencia rural (31.9% en decil 1, ratio d1/d10 = 12.8×). Ventas y gasto_negocio son trimestrales (agro.valrema/valproc, agrogasto.gas_nm_tri). Cobertura usa DISTINCT (folioviv, foliohog) porque agro es tabla persona-trabajo-tipoact.";
export const NOTE_NOAGRO = "Noagro = transversal al tejido socioeconómico (banda 8.4-10.5% por decil, ratio d1/d10 = 1.3×). Perfil geográfico urbano/metropolitano (Edo Mex, CDMX, Jalisco). Cobertura usa DISTINCT (folioviv, foliohog).";
export const NOTE_JCF = "Programa federal (2019+) que transfiere apoyo económico a jóvenes 18-29 en capacitación laboral. n=327 en la muestra nacional ENIGH 2024 NS implica cobertura relativamente baja; las cifras expandidas por entidad deben leerse con cautela estadística.";

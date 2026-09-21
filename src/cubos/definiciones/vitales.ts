// Registros vitales del INEGI: defunciones registradas (EDR, 1990-2024) y nacimientos registrados (ENR, 1985-2024),
// agregados por scripts/vitales_d1.py desde los microdatos oficiales (descarga masiva) en la D1 datosmexico-api-vitales.
// Todo por entidad y municipio de RESIDENCIA habitual: es la base con la que el INEGI publica «Defunciones registradas»
// y «Nacimientos registrados» en el Banco de Indicadores, y con la que cada año se verificó (nacional, entidad, municipio).
import type { Cubo, Dimension } from "../tipos";

const FUENTE_DEF = { fuente: "INEGI — Estadísticas de defunciones registradas (EDR), microdatos", fuente_url: "https://www.inegi.org.mx/programas/edr/", licencia: "Términos de libre uso INEGI" };
const FUENTE_NAC = { fuente: "INEGI — Estadísticas de nacimientos registrados (ENR), microdatos", fuente_url: "https://www.inegi.org.mx/programas/natalidad/", licencia: "Términos de libre uso INEGI" };
const CVE_ENT = (col: string) => `substr('0' || ${col}, -2)`;
const D_ANIO = (col: string, desde: number, hasta: number): Dimension => ({ clave: "anio", titulo: "Año de registro", id: col, tipo: "temporal", descripcion: `Año en que se registró el hecho (${desde}-${hasta}), como en las series «registradas» del INEGI.` });
const D_ENTIDAD = (col: string): Dimension => ({ clave: "entidad", titulo: "Entidad de residencia", id: CVE_ENT(col), nombre: "e.nombre", tipo: "geografica", geo: "entidad", orden: "1", descripcion: "Entidad de residencia habitual (33 = Estados Unidos de América, 34 = otros países de Latinoamérica, 35 = otros países, 99 = no especificada)." });
const D_MUNICIPIO = (ent: string, mun: string): Dimension => ({ clave: "municipio", titulo: "Municipio de residencia", id: `${CVE_ENT(ent)} || substr('00' || ${mun}, -3)`, nombre: "m.nombre", tipo: "geografica", geo: "municipio", padre: "entidad", orden: "1", descripcion: "Clave de 5 dígitos (entidad + municipio) de residencia habitual; los municipios no especificados terminan en 999." });
const D_SEXO: Dimension = { clave: "sexo", titulo: "Sexo", id: "d.sexo", nombre: "s.nombre", tipo: "categorica", orden: "1" };
const NOTA_BASE = "Por entidad y municipio de residencia habitual, que es la base de las series «registradas» del Banco de Indicadores del INEGI; por lugar de registro u ocurrencia las cifras no coinciden con las publicadas.";

export const DEF_MUNICIPIO: Cubo = {
  clave: "defunciones-municipio", nombre: "Defunciones registradas por municipio", tema: "poblacion", ...FUENTE_DEF,
  descripcion: "Defunciones registradas 1990-2024 por año de registro, entidad y municipio de residencia, sexo y seis grupos de edad. Reproduce exactamente el Banco de Indicadores del INEGI (nacional, entidad y municipio, cada año desde 1994).",
  binding: "DB_VITALES", desde: "defunciones_municipio d JOIN cat_entidad e ON e.clave = d.ent_resid LEFT JOIN cat_municipio m ON m.ent = d.ent_resid AND m.mun = d.mun_resid JOIN cat_sexo s ON s.clave = d.sexo JOIN cat_edad_grupo g ON g.clave = d.edad_grupo",
  medidas: [{ clave: "defunciones", titulo: "Defunciones", sql: "SUM(d.n)", unidad: "defunciones", sumable: true }],
  dimensiones: [D_ANIO("d.anio_regis", 1990, 2024), D_ENTIDAD("d.ent_resid"), D_MUNICIPIO("d.ent_resid", "d.mun_resid"), D_SEXO,
    { clave: "edad_grupo", titulo: "Grupo de edad", id: "d.edad_grupo", nombre: "g.nombre", tipo: "categorica", orden: "CASE d.edad_grupo WHEN '<1' THEN 1 WHEN '1-14' THEN 2 WHEN '15-29' THEN 3 WHEN '30-59' THEN 4 WHEN '60+' THEN 5 ELSE 6 END" }],
  predeterminado: { medidas: ["defunciones"], columnas: ["entidad"], filtros: { anio: ["2024"] } },
  sql_corte: "SELECT MAX(anio_regis) AS corte FROM defunciones_municipio",
  notas: [NOTA_BASE, "Verificado contra los indicadores 1002000030-1002000034 del INEGI (defunciones registradas, por sexo y de menores de un año): iguales en todos los años y geografías con dato.", "Los grupos de edad del INEGI a cinco años están en el cubo «Defunciones por causa»; aquí se usan seis grupos para que el detalle municipal quepa en la base."],
  api_dominio: "/api/v1/inegi/datos-abiertos/programas/edr",
};

export const DEF_CAUSA: Cubo = {
  clave: "defunciones-causa", nombre: "Defunciones registradas por causa y edad", tema: "poblacion", ...FUENTE_DEF,
  descripcion: "Defunciones registradas 1998-2024 por año, entidad de residencia, sexo, grupo de edad del INEGI (a cinco años), capítulo de la CIE-10 y grupo de la lista mexicana de enfermedades. Los archivos 1990-1997 usan la CIE-9 sin lista mexicana y no entran aquí.",
  binding: "DB_VITALES", desde: "defunciones_causa d JOIN cat_entidad e ON e.clave = d.ent_resid JOIN cat_sexo s ON s.clave = d.sexo JOIN cat_edad_agru a ON a.clave = d.edad_agru LEFT JOIN cat_capitulo c ON c.clave = d.capitulo LEFT JOIN cat_gr_lismex gl ON gl.clave = d.gr_lismex",
  medidas: [{ clave: "defunciones", titulo: "Defunciones", sql: "SUM(d.n)", unidad: "defunciones", sumable: true }],
  dimensiones: [D_ANIO("d.anio_regis", 1998, 2024), D_ENTIDAD("d.ent_resid"), D_SEXO,
    { clave: "edad", titulo: "Grupo de edad", id: "d.edad_agru", nombre: "a.nombre", tipo: "categorica", orden: "1", descripcion: "Grupos del INEGI (edad_agru): menores de 1 año, 1 a 4 por año, quinquenios de 5-9 a 120 y más, no especificada." },
    { clave: "capitulo", titulo: "Capítulo CIE-10", id: "d.capitulo", nombre: "c.nombre", tipo: "categorica", orden: "1", descripcion: "Capítulo de la Clasificación Internacional de Enfermedades, 10a revisión (0 = sin capítulo)." },
    { clave: "grupo", titulo: "Grupo de la lista mexicana", id: "d.gr_lismex", nombre: "gl.nombre", tipo: "categorica", orden: "1", descripcion: "Los 59 grupos de la lista mexicana de enfermedades (gpolimex)." }],
  predeterminado: { medidas: ["defunciones"], columnas: ["capitulo"], filtros: { anio: ["2024"] } },
  sql_corte: "SELECT MAX(anio_regis) AS corte FROM defunciones_causa",
  notas: [NOTA_BASE, "La suma de todas las causas de un año es igual al total de «Defunciones registradas por municipio» de ese año (verificado).", "El capítulo 22 (códigos U de la CIE-10: COVID-19) no viene en el catálogo capgpo del INEGI; se agrega con el título oficial de la CIE-10."],
  api_dominio: "/api/v1/inegi/datos-abiertos/programas/edr",
};

export const DEF_LISTA: Cubo = {
  clave: "defunciones-lista", nombre: "Defunciones registradas por causa detallada", tema: "poblacion", ...FUENTE_DEF,
  descripcion: "Defunciones registradas 1998-2024 por año, entidad de residencia, sexo y causa de la lista mexicana de enfermedades (422 causas en 59 grupos).",
  binding: "DB_VITALES", desde: "defunciones_lista d JOIN cat_entidad e ON e.clave = d.ent_resid JOIN cat_sexo s ON s.clave = d.sexo LEFT JOIN cat_lista_mex l ON l.clave = d.lista_mex LEFT JOIN cat_gr_lismex gl ON gl.clave = substr(d.lista_mex, 1, 2)",
  medidas: [{ clave: "defunciones", titulo: "Defunciones", sql: "SUM(d.n)", unidad: "defunciones", sumable: true }],
  dimensiones: [D_ANIO("d.anio_regis", 1998, 2024), D_ENTIDAD("d.ent_resid"), D_SEXO,
    { clave: "grupo", titulo: "Grupo de la lista mexicana", id: "substr(d.lista_mex, 1, 2)", nombre: "gl.nombre", tipo: "categorica", orden: "1" },
    { clave: "causa", titulo: "Causa (lista mexicana)", id: "d.lista_mex", nombre: "l.nombre", tipo: "categorica", padre: "grupo", orden: "1", descripcion: "Clave de la lista mexicana (dos dígitos de grupo + letra); NE = sin causa codificada." }],
  predeterminado: { medidas: ["defunciones"], columnas: ["causa"], filtros: { anio: ["2024"] } },
  sql_corte: "SELECT MAX(anio_regis) AS corte FROM defunciones_lista",
  notas: [NOTA_BASE, "Los nombres de las causas son los del catálogo listamex 2024 del INEGI (re-decodificado de CP437)."],
  api_dominio: "/api/v1/inegi/datos-abiertos/programas/edr",
};

export const NAC_MUNICIPIO: Cubo = {
  clave: "nacimientos-municipio", nombre: "Nacimientos registrados por municipio", tema: "poblacion", ...FUENTE_NAC,
  descripcion: "Nacimientos registrados 1985-2024 por año de registro, entidad y municipio de residencia de la madre, sexo y oportunidad del registro (nacidos el mismo año, el anterior o antes). Reproduce exactamente el Banco de Indicadores del INEGI (nacional, entidad y municipio, cada año desde 1994).",
  binding: "DB_VITALES", desde: "nacimientos_municipio d JOIN cat_entidad e ON e.clave = d.ent_resid LEFT JOIN cat_municipio m ON m.ent = d.ent_resid AND m.mun = d.mun_resid JOIN cat_sexo s ON s.clave = d.sexo JOIN cat_oportunidad o ON o.clave = d.oportunidad",
  medidas: [{ clave: "nacimientos", titulo: "Nacimientos", sql: "SUM(d.n)", unidad: "nacimientos", sumable: true }],
  dimensiones: [D_ANIO("d.ano_reg", 1985, 2024), D_ENTIDAD("d.ent_resid"), D_MUNICIPIO("d.ent_resid", "d.mun_resid"), D_SEXO,
    { clave: "oportunidad", titulo: "Oportunidad del registro", id: "d.oportunidad", nombre: "o.nombre", tipo: "categorica", orden: "CASE d.oportunidad WHEN 'mismo' THEN 1 WHEN 'anterior' THEN 2 WHEN 'antes' THEN 3 ELSE 4 END", descripcion: "Los nacimientos registrados de un año incluyen personas nacidas años antes; el INEGI los publica por año de registro." }],
  predeterminado: { medidas: ["nacimientos"], columnas: ["entidad"], filtros: { anio: ["2024"] } },
  sql_corte: "SELECT MAX(ano_reg) AS corte FROM nacimientos_municipio",
  notas: [NOTA_BASE.replace("residencia habitual", "residencia habitual de la madre"), "Verificado contra los indicadores 1002000026-1002000028 del INEGI (nacimientos registrados, por sexo): iguales en todos los años y geografías con dato."],
  api_dominio: "/api/v1/inegi/datos-abiertos/programas/enr",
};

export const NAC_MADRE: Cubo = {
  clave: "nacimientos-madre", nombre: "Nacimientos registrados por edad de la madre", tema: "poblacion", ...FUENTE_NAC,
  descripcion: "Nacimientos registrados 1985-2024 por año de registro, entidad de residencia de la madre, sexo, grupo de edad de la madre y orden del parto (primer hijo, segundo…).",
  binding: "DB_VITALES", desde: "nacimientos_madre d JOIN cat_entidad e ON e.clave = d.ent_resid JOIN cat_sexo s ON s.clave = d.sexo JOIN cat_edad_madre_grupo em ON em.clave = d.edad_madre_grupo JOIN cat_orden_parto op ON op.clave = d.orden_parto",
  medidas: [{ clave: "nacimientos", titulo: "Nacimientos", sql: "SUM(d.n)", unidad: "nacimientos", sumable: true }],
  dimensiones: [D_ANIO("d.ano_reg", 1985, 2024), D_ENTIDAD("d.ent_resid"), D_SEXO,
    { clave: "edad_madre", titulo: "Edad de la madre", id: "d.edad_madre_grupo", nombre: "em.nombre", tipo: "categorica", orden: "CASE d.edad_madre_grupo WHEN '<15' THEN 0 WHEN '50+' THEN 50 WHEN 'NE' THEN 99 ELSE CAST(substr(d.edad_madre_grupo, 1, 2) AS INTEGER) END" },
    { clave: "orden_parto", titulo: "Orden del parto", id: "d.orden_parto", nombre: "op.nombre", tipo: "categorica", orden: "CASE d.orden_parto WHEN 'NE' THEN 9 WHEN '6+' THEN 6 ELSE CAST(d.orden_parto AS INTEGER) END" }],
  predeterminado: { medidas: ["nacimientos"], columnas: ["edad_madre"], filtros: { anio: ["2024"] } },
  sql_corte: "SELECT MAX(ano_reg) AS corte FROM nacimientos_madre",
  notas: [NOTA_BASE.replace("residencia habitual", "residencia habitual de la madre"), "La suma por edad de la madre de un año es igual al total de «Nacimientos registrados por municipio» de ese año (verificado)."],
  api_dominio: "/api/v1/inegi/datos-abiertos/programas/enr",
};

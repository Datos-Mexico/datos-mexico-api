// Cubos del Anuario Estadístico de Educación Superior (ANUIES): la tabla `programas` (953,653 programas-ciclo) y sus
// desagregaciones por edad y procedencia. Títulos de las medidas = tabla `columnas` de la base (claves de ANUIES).
import { EDADES, PROCEDENCIA } from "../../anuies/consultas";
import type { Cubo, Dimension, Medida } from "../tipos";

const FUENTE = { fuente: "ANUIES — Anuario Estadístico de Educación Superior", fuente_url: "https://anuario.anuies.mx/", licencia: "© ANUIES, todos los derechos reservados (consulta pública del anuario)" };
export const ENTIDAD_CVE: Record<string, string> = { AGUASCALIENTES: "01", "BAJA CALIFORNIA": "02", "BAJA CALIFORNIA SUR": "03", CAMPECHE: "04", COAHUILA: "05", COLIMA: "06", CHIAPAS: "07", CHIHUAHUA: "08", "CIUDAD DE MÉXICO": "09", DURANGO: "10", GUANAJUATO: "11", GUERRERO: "12", HIDALGO: "13", JALISCO: "14", MÉXICO: "15", MICHOACÁN: "16", MORELOS: "17", NAYARIT: "18", "NUEVO LEÓN": "19", OAXACA: "20", PUEBLA: "21", QUERÉTARO: "22", "QUINTANA ROO": "23", "SAN LUIS POTOSÍ": "24", SINALOA: "25", SONORA: "26", TABASCO: "27", TAMAULIPAS: "28", TLAXCALA: "29", VERACRUZ: "30", YUCATÁN: "31", ZACATECAS: "32" };

const suma = (clave: string, titulo: string): Medida => ({ clave, titulo, sql: `SUM(${clave})`, unidad: "personas", sumable: true });
const M_MATRICULA: Medida[] = [
  suma("mat_total", "Matrícula total"), suma("m_m", "Matrícula mujeres"), suma("m_h", "Matrícula hombres"),
  suma("mat_d", "Matrícula con discapacidad"), suma("m_m_d", "Matrícula mujeres con discapacidad"), suma("m_h_d", "Matrícula hombres con discapacidad"),
  suma("m_i", "Matrícula hablante de lengua indígena"), suma("m_m_i", "Matrícula mujeres hablantes de lengua indígena"), suma("m_h_i", "Matrícula hombres hablantes de lengua indígena"), suma("m_i_d", "Matrícula con discapacidad hablante de lengua indígena"),
  { clave: "programas", titulo: "Programas", sql: "COUNT(*)", unidad: "programas", sumable: true, descripcion: "Programas (carrera en una escuela, nivel y modalidad) con fila en el anuario." },
  { clave: "escuelas", titulo: "Escuelas", sql: "COUNT(DISTINCT escuela)", unidad: "escuelas", sumable: false },
  { clave: "instituciones", titulo: "Instituciones", sql: "COUNT(DISTINCT institucion_clave)", unidad: "instituciones", sumable: false },
];
const M_TRAYECTORIA: Medida[] = [
  suma("ni", "Nuevo ingreso total"), suma("ni_m", "Nuevo ingreso mujeres"), suma("ni_h", "Nuevo ingreso hombres"), suma("ni_d", "Nuevo ingreso con discapacidad"), suma("ni_i", "Nuevo ingreso hablante de lengua indígena"),
  suma("e", "Egresados total"), suma("e_m", "Egresados mujeres"), suma("e_h", "Egresados hombres"), suma("e_d", "Egresados con discapacidad"), suma("e_i", "Egresados hablantes de lengua indígena"),
  suma("t", "Titulados total"), suma("t_m", "Titulados mujeres"), suma("t_h", "Titulados hombres"), suma("t_d", "Titulados con discapacidad"), suma("t_i", "Titulados hablantes de lengua indígena"),
  { ...suma("lo_real", "Lugares ofertados"), unidad: "lugares" },
  { ...suma("sni", "Solicitudes de nuevo ingreso total"), unidad: "solicitudes" }, { ...suma("sni_m", "Solicitudes de nuevo ingreso mujeres"), unidad: "solicitudes" }, { ...suma("sni_h", "Solicitudes de nuevo ingreso hombres"), unidad: "solicitudes" }, { ...suma("sni_d", "Solicitudes de nuevo ingreso con discapacidad"), unidad: "solicitudes" }, { ...suma("sni_i", "Solicitudes de nuevo ingreso hablantes de lengua indígena"), unidad: "solicitudes" },
  { clave: "programas", titulo: "Programas", sql: "COUNT(*)", unidad: "programas", sumable: true },
];

const D_BASE: Dimension[] = [
  { clave: "ciclo", titulo: "Ciclo escolar", id: "ciclo", tipo: "temporal", descripcion: "Ciclo escolar del anuario (2000-2001 a 2025-2026)." },
  { clave: "entidad", titulo: "Entidad", id: "entidad", tipo: "geografica", geo: "entidad", claves_geo: ENTIDAD_CVE, descripcion: "Entidad federativa de la escuela, como la escribe ANUIES." },
  { clave: "municipio", titulo: "Municipio", id: "municipio", tipo: "categorica", padre: "entidad" },
  { clave: "sostenimiento", titulo: "Sostenimiento", id: "sostenimiento", tipo: "categorica" },
  { clave: "clasificacion", titulo: "Clasificación de la institución", id: "clasificacion", tipo: "categorica" },
  { clave: "institucion", titulo: "Institución", id: "institucion_clave", nombre: "institucion", tipo: "categorica", orden: "2" },
  { clave: "escuela", titulo: "Escuela o campus", id: "escuela", tipo: "categorica", padre: "institucion" },
  { clave: "nivel", titulo: "Nivel", id: "nivel", tipo: "categorica" },
  { clave: "modalidad", titulo: "Modalidad", id: "modalidad", tipo: "categorica" },
  { clave: "campo_amplio", titulo: "Campo amplio de formación", id: "campo_amplio", tipo: "categorica" },
  { clave: "campo_especifico", titulo: "Campo específico", id: "campo_especifico", tipo: "categorica", padre: "campo_amplio" },
  { clave: "campo_detallado", titulo: "Campo detallado", id: "campo_detallado", tipo: "categorica", padre: "campo_especifico" },
  { clave: "campo_unitario", titulo: "Campo unitario", id: "campo_unitario", tipo: "categorica", padre: "campo_detallado" },
  { clave: "carrera", titulo: "Carrera o programa", id: "carrera", tipo: "categorica", padre: "campo_detallado" },
];
const NOTAS = [
  "Una fila del anuario es un programa (carrera) en una escuela de una institución, en un ciclo, con nivel y modalidad; las medidas suman esas filas.",
  "Los valores de las dimensiones son exactamente los que escribe ANUIES (mayúsculas; los campos de formación con mayúscula inicial).",
  "Cada ciclo está conciliado contra el agregado nacional que devuelve el propio servicio de ANUIES (ver /api/v1/anuies/ciclos).",
];

const D_CORTE = "SELECT MAX(ciclo) AS corte FROM programas";

export const ANUIES_MATRICULA: Cubo = {
  clave: "anuies-matricula", nombre: "Matrícula por institución y programa", tema: "educacion-superior", ...FUENTE,
  descripcion: "Matrícula total, por sexo, con discapacidad y hablante de lengua indígena de cada programa de educación superior del país, ciclo por ciclo (2000-2001 a 2025-2026), con su entidad, institución, escuela, nivel, modalidad y campo de formación.",
  binding: "DB_ANUIES", desde: "programas", medidas: M_MATRICULA, dimensiones: D_BASE,
  predeterminado: { medidas: ["mat_total"], columnas: ["entidad", "ciclo"], filtros: { ciclo: ["2021-2022", "2022-2023", "2023-2024", "2024-2025", "2025-2026"] } },
  sql_corte: D_CORTE, notas: NOTAS, api_dominio: "/api/v1/anuies",
};
export const ANUIES_TRAYECTORIA: Cubo = {
  clave: "anuies-trayectoria", nombre: "Nuevo ingreso, egreso y titulación", tema: "educacion-superior", ...FUENTE,
  descripcion: "Nuevo ingreso, egresados, titulados, lugares ofertados y solicitudes de nuevo ingreso de cada programa de educación superior, ciclo por ciclo, con las mismas dimensiones que la matrícula.",
  binding: "DB_ANUIES", desde: "programas", medidas: M_TRAYECTORIA, dimensiones: D_BASE,
  predeterminado: { medidas: ["ni", "e", "t"], columnas: ["nivel", "ciclo"], filtros: { ciclo: ["2021-2022", "2022-2023", "2023-2024", "2024-2025", "2025-2026"] } },
  sql_corte: D_CORTE, notas: [...NOTAS, "Egresados y titulados corresponden al ciclo anterior al reportado, como los publica ANUIES."], api_dominio: "/api/v1/anuies",
};

// Edad: la tabla ancha programas_edad (96 columnas) se despliega como dimensión virtual; solo hay fila cuando el ciclo trae edades.
const EDAD_COL: Record<string, string> = { "30_34": "30_a_34", "35_39": "35_a_39" };
const edadNombre = (e: string) => (e === "40" ? "40 años y más" : e.includes("_") ? e.replace("_", " a ") + " años" : e + " años");
const D_EDAD: Dimension = {
  clave: "edad", titulo: "Edad", id: "edad", tipo: "categorica", descripcion: "Grupo de edad (17 a 29 año por año, 30 a 34, 35 a 39, 40 y más), como lo publica ANUIES.",
  virtual: EDADES.map((e) => { const s = EDAD_COL[e] ?? e; return { id: e, nombre: edadNombre(e), sql: { mat_total: `SUM(x.tot_${e})`, m_m: `SUM(x.m_m_${s}_lic)`, m_h: `SUM(x.m_h_${s}_lic)`, ni: `SUM(x.ni_tot_${e})`, ni_m: `SUM(x.ni_m_${s}_lic)`, ni_h: `SUM(x.ni_h_${s}_lic)` } }; }),
};
const conPrefijo = (d: Dimension): Dimension => ({ ...d, id: `p.${d.id}`, nombre: d.nombre ? `p.${d.nombre}` : undefined });
export const ANUIES_EDADES: Cubo = {
  clave: "anuies-edades", nombre: "Matrícula y nuevo ingreso por edad", tema: "educacion-superior", ...FUENTE,
  descripcion: "Matrícula y nuevo ingreso por grupo de edad y sexo, por ciclo, entidad, institución, nivel y modalidad. La edad es una dimensión virtual: sus miembros son las columnas de edad del anuario.",
  binding: "DB_ANUIES", desde: "programas p LEFT JOIN programas_edad x ON x.id = p.id",
  medidas: [{ clave: "mat_total", titulo: "Matrícula total", sql: "SUM(p.mat_total)", unidad: "personas", sumable: true }, { clave: "m_m", titulo: "Matrícula mujeres", sql: "SUM(p.m_m)", unidad: "personas", sumable: true }, { clave: "m_h", titulo: "Matrícula hombres", sql: "SUM(p.m_h)", unidad: "personas", sumable: true }, { clave: "ni", titulo: "Nuevo ingreso total", sql: "SUM(p.ni)", unidad: "personas", sumable: true }, { clave: "ni_m", titulo: "Nuevo ingreso mujeres", sql: "SUM(p.ni_m)", unidad: "personas", sumable: true }, { clave: "ni_h", titulo: "Nuevo ingreso hombres", sql: "SUM(p.ni_h)", unidad: "personas", sumable: true }],
  dimensiones: [...D_BASE.filter((d) => ["ciclo", "entidad", "sostenimiento", "institucion", "nivel", "modalidad", "campo_amplio"].includes(d.clave)).map(conPrefijo), D_EDAD],
  predeterminado: { medidas: ["mat_total"], columnas: ["edad"], filtros: { ciclo: ["2025-2026"] } },
  sql_corte: "SELECT MAX(ciclo) AS corte FROM programas p WHERE EXISTS (SELECT 1 FROM programas_edad x WHERE x.id = p.id)",
  notas: [...NOTAS, "Sin la dimensión edad, las medidas son los totales del programa; con ella, la suma de los grupos de edad (que ANUIES reporta solo para licenciatura y TSU en las columnas por sexo)."], api_dominio: "/api/v1/anuies",
};

const D_PROCEDENCIA: Dimension = {
  clave: "procedencia", titulo: "Entidad o región de procedencia", id: "procedencia", tipo: "geografica", geo: "entidad", claves_geo: Object.fromEntries(PROCEDENCIA.filter((p) => p.entidad).map((p) => [p.codigo, p.entidad!])),
  descripcion: "De dónde viene el nuevo ingreso: las 32 entidades y 8 regiones del extranjero (columnas PNI_* del anuario).",
  virtual: PROCEDENCIA.map((p) => ({ id: p.codigo, nombre: p.nombre, sql: { ni: `SUM(x.${p.codigo.toLowerCase()})` } })),
};
export const ANUIES_PROCEDENCIA: Cubo = {
  clave: "anuies-procedencia", nombre: "Nuevo ingreso por entidad de procedencia", tema: "educacion-superior", ...FUENTE,
  descripcion: "De qué entidad (o región del extranjero) proviene el nuevo ingreso de cada institución, por ciclo, entidad de la escuela, nivel y modalidad. La procedencia es una dimensión virtual sobre las 40 columnas PNI_* del anuario.",
  binding: "DB_ANUIES", desde: "programas p LEFT JOIN programas_procedencia x ON x.id = p.id",
  medidas: [{ clave: "ni", titulo: "Nuevo ingreso", sql: "SUM(p.ni)", unidad: "personas", sumable: true }],
  dimensiones: [...D_BASE.filter((d) => ["ciclo", "entidad", "sostenimiento", "institucion", "nivel", "modalidad"].includes(d.clave)).map(conPrefijo), D_PROCEDENCIA],
  predeterminado: { medidas: ["ni"], columnas: ["procedencia"], filtros: { ciclo: ["2025-2026"] } },
  sql_corte: "SELECT MAX(ciclo) AS corte FROM programas p WHERE EXISTS (SELECT 1 FROM programas_procedencia x WHERE x.id = p.id)",
  notas: [...NOTAS, "Sin la dimensión procedencia, la medida es el nuevo ingreso total del programa; con ella, la suma de las columnas de procedencia (que no todos los programas reportan)."], api_dominio: "/api/v1/anuies",
};

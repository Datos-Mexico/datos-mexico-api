// Consultas compartidas sobre el Anuario ANUIES (D1 datosmexico-api-anuies): las usan los endpoints /api/v1/anuies/* y las
// vistas de la UNAM en /api/v1/unam/anuario/*. Todo es solo lectura y todos los parámetros van ligados (?), nunca interpolados.
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { ErrorHttp } from "../lib/errores";
import type { Detalle } from "../lib/validacion";

export const CICLO = "^[0-9]{4}-[0-9]{4}$";
export const CLAVE = "^[a-z0-9]+(-[a-z0-9]+)*$";
export const UNAM = "universidad-nacional-autonoma-de-mexico";
// dimensiones por las que se puede agrupar o filtrar (nombre público → columna)
export const DIMENSIONES = ["entidad", "municipio", "sostenimiento", "clasificacion", "institucion", "escuela", "nivel", "modalidad", "campo_amplio", "campo_especifico", "campo_detallado", "campo_unitario", "carrera"] as const;
export type Dimension = (typeof DIMENSIONES)[number];
export const FILTROS = ["entidad", "sostenimiento", "clasificacion", "escuela", "nivel", "modalidad", "campo_amplio", "campo_especifico", "campo_detallado", "carrera"] as const;
// cifras base: sufijo _m mujeres, _h hombres; _d con discapacidad; _i hablantes de lengua indígena (claves de ANUIES en minúsculas)
export const CIFRAS = ["m_m", "m_h", "mat_total", "ni_m", "ni_h", "ni", "e_m", "e_h", "e", "lo_real", "t_m", "t_h", "t", "sni_m", "sni_h", "sni", "m_m_i", "m_h_i", "m_i", "m_m_d", "m_h_d", "mat_d", "m_i_d", "ni_d", "ni_i", "e_d", "e_i", "t_d", "t_i", "sni_d", "sni_i"] as const;
export const SUMAS = CIFRAS.map((c) => `SUM(${c}) AS ${c}`).join(", ");
export const EDADES = ["17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30_34", "35_39", "40"] as const;
const EDAD_COL: Record<string, string> = { "30_34": "30_a_34", "35_39": "35_a_39" };
export const PROCEDENCIA: { codigo: string; nombre: string; entidad: string | null }[] = [
  ["PNI_EUA", "Estados Unidos", null], ["PNI_CAN", "Canadá", null], ["PNI_CAC", "Centroamérica y Caribe", null], ["PNI_SUD", "Sudamérica", null], ["PNI_AFR", "África", null], ["PNI_ASI", "Asia", null], ["PNI_EUR", "Europa", null], ["PNI_OCE", "Oceanía", null],
  ["PNI_AGU", "Aguascalientes", "01"], ["PNI_BC", "Baja California", "02"], ["PNI_BCS", "Baja California Sur", "03"], ["PNI_CAM", "Campeche", "04"], ["PNI_COA", "Coahuila", "05"], ["PNI_COL", "Colima", "06"], ["PNI_CHP", "Chiapas", "07"], ["PNI_CHH", "Chihuahua", "08"],
  ["PNI_CDMX", "Ciudad de México", "09"], ["PNI_DUR", "Durango", "10"], ["PNI_GUA", "Guanajuato", "11"], ["PNI_GUE", "Guerrero", "12"], ["PNI_HID", "Hidalgo", "13"], ["PNI_JAL", "Jalisco", "14"], ["PNI_MEX", "Estado de México", "15"], ["PNI_MIC", "Michoacán", "16"],
  ["PNI_MOR", "Morelos", "17"], ["PNI_NAY", "Nayarit", "18"], ["PNI_NL", "Nuevo León", "19"], ["PNI_OAX", "Oaxaca", "20"], ["PNI_PUE", "Puebla", "21"], ["PNI_QUE", "Querétaro", "22"], ["PNI_QR", "Quintana Roo", "23"], ["PNI_SLP", "San Luis Potosí", "24"],
  ["PNI_SIN", "Sinaloa", "25"], ["PNI_SON", "Sonora", "26"], ["PNI_TAB", "Tabasco", "27"], ["PNI_TAM", "Tamaulipas", "28"], ["PNI_TLA", "Tlaxcala", "29"], ["PNI_VER", "Veracruz", "30"], ["PNI_YUC", "Yucatán", "31"], ["PNI_ZAC", "Zacatecas", "32"],
].map(([codigo, nombre, entidad]) => ({ codigo: codigo as string, nombre: nombre as string, entidad: entidad as string | null }));

export const literalError = (nombre: string, v: unknown, permitidos: readonly string[]): Detalle => {
  const lista = permitidos.map((x) => `'${x}'`).join(", ").replace(/, ([^,]*)$/, " or $1");
  return { type: "literal_error", loc: ["query", nombre], msg: `Input should be ${lista}`, input: v, ctx: { expected: lista } };
};

/** Ciclo pedido o, si no viene, el último cargado. 404 si el ciclo no está en la base. */
export async function resolverCiclo(c: AppContext, v: string | undefined): Promise<string> {
  const db = c.env.DB_ANUIES;
  if (v === undefined) {
    const u = await fila<{ ciclo: string }>(db, "SELECT ciclo FROM ciclos ORDER BY ciclo DESC LIMIT 1");
    if (!u) throw new ErrorHttp(404, "no hay ciclos cargados");
    return u.ciclo;
  }
  if (!new RegExp(CICLO).test(v)) throw new ErrorHttp(422, [{ type: "string_pattern_mismatch", loc: ["query", "ciclo"], msg: `String should match pattern '${CICLO}'`, input: v, ctx: { pattern: CICLO } } satisfies Detalle]);
  const r = await fila<{ ciclo: string }>(db, "SELECT ciclo FROM ciclos WHERE ciclo = ?", [v]);
  if (!r) throw new ErrorHttp(404, `el ciclo '${v}' no está cargado; consulte /api/v1/anuies/ciclos`);
  return v;
}

/** WHERE a partir de los filtros de query (valores exactos, como los escribe ANUIES) más institución y ciclo. */
export function condiciones(q: Record<string, string | undefined>, institucion: string | null, ciclo: string | null): { where: string; params: unknown[] } {
  const partes: string[] = []; const params: unknown[] = [];
  if (ciclo) { partes.push("ciclo = ?"); params.push(ciclo); }
  if (institucion) { partes.push("institucion_clave = ?"); params.push(institucion); }
  for (const f of FILTROS) { const v = q[f]; if (v !== undefined) { partes.push(`${f} = ?`); params.push(v); } }
  if (q.q !== undefined) { partes.push("(carrera LIKE ? COLLATE NOCASE OR escuela LIKE ? COLLATE NOCASE)"); params.push(`%${q.q}%`, `%${q.q}%`); }
  return { where: partes.length ? " WHERE " + partes.join(" AND ") : "", params };
}

export async function institucionOr404(c: AppContext, clave: string) {
  const r = await fila<Record<string, unknown>>(c.env.DB_ANUIES, "SELECT * FROM instituciones WHERE clave = ?", [clave]);
  if (!r) throw new ErrorHttp(404, `la institución '${clave}' no existe; búsquela en /api/v1/anuies/instituciones?q=`);
  return r;
}

export async function serie(c: AppContext, institucion: string | null, q: Record<string, string | undefined>) {
  const { where, params } = condiciones(q, institucion, null);
  return filas<Record<string, unknown>>(c.env.DB_ANUIES, `SELECT ciclo, COUNT(*) AS programas, COUNT(DISTINCT escuela) AS escuelas, COUNT(DISTINCT institucion_clave) AS instituciones, ${SUMAS} FROM programas${where} GROUP BY ciclo ORDER BY ciclo`, params);
}

export async function agregado(c: AppContext, ciclo: string, por: Dimension, institucion: string | null, q: Record<string, string | undefined>) {
  const { where, params } = condiciones(q, institucion, ciclo);
  return filas<Record<string, unknown>>(c.env.DB_ANUIES, `SELECT ${por} AS valor, COUNT(*) AS programas, ${SUMAS} FROM programas${where} GROUP BY ${por} ORDER BY mat_total DESC, valor`, params);
}

export async function procedencia(c: AppContext, ciclo: string, institucion: string | null, q: Record<string, string | undefined>) {
  const { where, params } = condiciones(q, institucion, ciclo);
  const cols = PROCEDENCIA.map((p) => `SUM(x.${p.codigo.toLowerCase()}) AS ${p.codigo.toLowerCase()}`).join(", ");
  const r = await fila<Record<string, number | null>>(c.env.DB_ANUIES, `SELECT COUNT(x.id) AS programas_con_dato, SUM(p.ni) AS ni, ${cols} FROM programas p LEFT JOIN programas_procedencia x ON x.id = p.id${where}`, params);
  const items = PROCEDENCIA.map((p) => ({ codigo: p.codigo, nombre: p.nombre, entidad: p.entidad, ni: r?.[p.codigo.toLowerCase()] ?? null }));
  return { ciclo, ni_total: r?.ni ?? null, programas_con_dato: r?.programas_con_dato ?? 0, suma_procedencia: items.reduce((s, i) => s + (i.ni ?? 0), 0), items };
}

export async function edades(c: AppContext, ciclo: string, institucion: string | null, q: Record<string, string | undefined>) {
  const { where, params } = condiciones(q, institucion, ciclo);
  const cols = EDADES.flatMap((e) => { const s = EDAD_COL[e] ?? e; return [`SUM(x.m_m_${s}_lic) AS mm_${e}`, `SUM(x.m_h_${s}_lic) AS mh_${e}`, `SUM(x.tot_${e}) AS mt_${e}`, `SUM(x.ni_m_${s}_lic) AS nm_${e}`, `SUM(x.ni_h_${s}_lic) AS nh_${e}`, `SUM(x.ni_tot_${e}) AS nt_${e}`]; }).join(", ");
  const r = await fila<Record<string, number | null>>(c.env.DB_ANUIES, `SELECT COUNT(x.id) AS programas_con_dato, SUM(p.mat_total) AS mat_total, SUM(p.ni) AS ni, ${cols} FROM programas p LEFT JOIN programas_edad x ON x.id = p.id${where}`, params);
  const items = EDADES.map((e) => ({ grupo: e === "40" ? "40 y más" : e.replace("_", " a "), matricula_m: r?.[`mm_${e}`] ?? null, matricula_h: r?.[`mh_${e}`] ?? null, matricula: r?.[`mt_${e}`] ?? null, ni_m: r?.[`nm_${e}`] ?? null, ni_h: r?.[`nh_${e}`] ?? null, ni: r?.[`nt_${e}`] ?? null }));
  return { ciclo, mat_total: r?.mat_total ?? null, ni_total: r?.ni ?? null, programas_con_dato: r?.programas_con_dato ?? 0, suma_matricula_edades: items.reduce((s, i) => s + (i.matricula ?? 0), 0), suma_ni_edades: items.reduce((s, i) => s + (i.ni ?? 0), 0), items };
}

export function porParam(v: string | undefined): Dimension {
  if (v === undefined) return "nivel";
  if (!(DIMENSIONES as readonly string[]).includes(v)) throw new ErrorHttp(422, [literalError("por", v, DIMENSIONES)]);
  return v as Dimension;
}

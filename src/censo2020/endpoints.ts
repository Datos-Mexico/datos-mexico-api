// Censo de Población y Vivienda 2020 — Principales resultados por localidad (ITER, 4a edición, datos abiertos
// del INEGI): 195,662 filas × 286 columnas en la D1 datosmexico-api-censo2020, repartidas en tres tablas
// (iter, iter_2, iter_3) por el límite de 100 columnas de D1. Los valores especiales del INEGI se
// conservan: '*' (protegido por confidencialidad) y 'N/D' (no disponible); los demás son números.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import type { Detalle } from "../lib/validacion";
import { enteroOpcional, textoConPatron } from "../lib/validacion";

const TAG = ["censo2020"];
const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const RESP_404 = { "404": { description: "No existe.", ...contentJson(z.object({ detail: z.string() })) } };
const RESP_422 = { "422": { description: "Parámetro inválido.", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };
const Valor = z.union([z.number(), z.string(), z.null()]);
const NIVELES = ["nacional", "entidad", "municipio", "localidad", "resumen_1_2_viviendas"] as const;
// nivel según las claves del INEGI: MUN=000 → total estatal (00 = nacional); LOC=0000 → total municipal;
// LOC=9998/9999 → totales de localidades de una y dos viviendas; el resto, localidades.
const SQL_NIVEL = "CASE WHEN entidad='00' THEN 'nacional' WHEN mun='000' THEN 'entidad' WHEN loc='0000' THEN 'municipio' WHEN loc IN ('9998','9999') THEN 'resumen_1_2_viviendas' ELSE 'localidad' END";
const COND_NIVEL: Record<(typeof NIVELES)[number], string> = { nacional: "entidad='00'", entidad: "entidad<>'00' AND mun='000'", municipio: "mun<>'000' AND loc='0000'", resumen_1_2_viviendas: "loc IN ('9998','9999')", localidad: "mun<>'000' AND loc NOT IN ('0000','9998','9999')" };

const cacheCols = new Map<string, string[]>();
async function columnasDe(db: D1Database, tabla: string) {
  let c = cacheCols.get(tabla);
  if (!c) { c = (await filas<{ name: string }>(db, `PRAGMA table_info("${tabla}")`)).map((x) => x.name); cacheCols.set(tabla, c); }
  return c;
}
async function tablaDe(db: D1Database, columna: string): Promise<string | null> {
  for (const t of ["iter", "iter_2", "iter_3"]) if ((await columnasDe(db, t)).includes(columna)) return t;
  return null;
}
function nivelParam(v: string | undefined) {
  if (v === undefined) return null;
  if (!(NIVELES as readonly string[]).includes(v)) throw new ErrorHttp(422, [{ type: "literal_error", loc: ["query", "nivel"], msg: `Input should be ${NIVELES.map((x) => `'${x}'`).join(", ").replace(/, ([^,]*)$/, " or $1")}`, input: v, ctx: { expected: NIVELES.map((x) => `'${x}'`).join(", ").replace(/, ([^,]*)$/, " or $1") } } satisfies Detalle]);
  return v as (typeof NIVELES)[number];
}

// ---------------------------------------------------------------- resumen
export class CensoResumen extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "censo2020_resumen", summary: "Qué tenemos del Censo 2020 por localidad",
    description: "Resumen verificable del ITER 2020 cargado: edición, filas por nivel (nacional, entidades, municipios, localidades y resúmenes de localidades de una y dos viviendas), número de indicadores y población total nacional, estatal por suma y municipal por suma (deben coincidir con la cifra oficial del Censo: 126,014,024 habitantes).",
    responses: { ...ok("Resumen del ITER 2020.", z.object({ fuente: z.string(), fuente_url: z.string(), edicion: z.string().nullable(), indicadores: z.number().int(), filas: z.number().int(), por_nivel: z.record(z.string(), z.number().int()), poblacion_total_nacional: Valor, suma_entidades: z.number().nullable(), suma_municipios: z.number().nullable(), descargado_en: z.string().nullable() })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const db = c.env.DB_CENSO2020;
    const ed = Object.fromEntries((await filas<{ clave: string; valor: string }>(db, "SELECT clave, valor FROM edicion")).map((r) => [r.clave, r.valor]));
    const niveles = await filas<{ nivel: string; n: number }>(db, `SELECT ${SQL_NIVEL} AS nivel, COUNT(*) AS n FROM iter GROUP BY 1`);
    const nac = await fila<{ pobtot: number | string | null }>(db, "SELECT pobtot FROM iter WHERE entidad='00'");
    const se = await fila<{ s: number | null }>(db, `SELECT SUM(pobtot) AS s FROM iter WHERE ${COND_NIVEL.entidad}`);
    const sm = await fila<{ s: number | null }>(db, `SELECT SUM(pobtot) AS s FROM iter WHERE ${COND_NIVEL.municipio}`);
    const ind = (await fila<{ n: number }>(db, "SELECT COUNT(*) AS n FROM iter_diccionario"))!.n;
    return { fuente: "INEGI — Censo de Población y Vivienda 2020, ITER (datos abiertos)", fuente_url: ed.fuente_url ?? "https://www.inegi.org.mx/programas/ccpv/2020/#datos_abiertos", edicion: ed.titulo ?? null, indicadores: ind, filas: niveles.reduce((s, r) => s + r.n, 0), por_nivel: Object.fromEntries(niveles.map((r) => [r.nivel, r.n])), poblacion_total_nacional: nac?.pobtot ?? null, suma_entidades: se?.s ?? null, suma_municipios: sm?.s ?? null, descargado_en: ed.descargado_en ?? null };
  }
}

// ---------------------------------------------------------------- localidades (búsqueda)
const CAMPOS_BASE = "entidad, nom_ent, mun, nom_mun, loc, nom_loc, longitud, latitud, altitud, pobtot, pobfem, pobmas, tothog, vivtot, tvivhab";
const Localidad = z.object({ nivel: z.string(), entidad: z.string(), nom_ent: z.string().nullable(), mun: z.string(), nom_mun: z.string().nullable(), loc: z.string(), nom_loc: z.string().nullable(), longitud: z.string().nullable(), latitud: z.string().nullable(), altitud: z.string().nullable(), pobtot: Valor, pobfem: Valor, pobmas: Valor, tothog: Valor, vivtot: Valor, tvivhab: Valor });
export class CensoLocalidades extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "censo2020_localidades", summary: "Buscar localidades, municipios y entidades del Censo 2020",
    description: "Filas del ITER 2020 con sus campos principales (población total, femenina y masculina, hogares y viviendas). `q` busca en el nombre de la localidad (contiene, sin distinguir mayúsculas); `entidad` (2 dígitos) y `mun` (3 dígitos) filtran por clave; `nivel` elige el tipo de fila: nacional, entidad, municipio, localidad o resumen_1_2_viviendas (totales de localidades de una y dos viviendas, cuyos datos individuales el INEGI protege con '*'). Paginado con `limit` (1-1000) y `offset`; orden por clave geográfica.",
    request: { query: z.object({ q: z.string().optional(), entidad: z.string().regex(/^\d{2}$/).optional(), mun: z.string().regex(/^\d{3}$/).optional(), nivel: z.enum(NIVELES).optional(), limit: z.number().int().min(1).max(1000).default(100).optional(), offset: z.number().int().min(0).default(0).optional() }) },
    responses: { ...ok("Filas que cumplen los filtros.", z.object({ total: z.number().int(), limit: z.number().int(), offset: z.number().int(), items: z.array(Localidad) })), ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = c.req.query("q"); const ent = textoConPatron(c.req.query("entidad"), "entidad", "^\\d{2}$"); const mun = textoConPatron(c.req.query("mun"), "mun", "^\\d{3}$"); const nivel = nivelParam(c.req.query("nivel"));
    const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 1000) ?? 100; const offset = enteroOpcional(c.req.query("offset"), "offset", 0) ?? 0;
    const cond: string[] = []; const params: unknown[] = [];
    if (ent) { cond.push("entidad = ?"); params.push(ent); }
    if (mun) { cond.push("mun = ?"); params.push(mun); }
    if (nivel) cond.push(COND_NIVEL[nivel]);
    if (q) { cond.push("nom_loc LIKE ? COLLATE NOCASE"); params.push(`%${q}%`); }
    const where = cond.length ? " WHERE " + cond.join(" AND ") : "";
    const total = (await fila<{ n: number }>(c.env.DB_CENSO2020, `SELECT COUNT(*) AS n FROM iter${where}`, params))!.n;
    const items = await filas<Record<string, unknown>>(c.env.DB_CENSO2020, `SELECT ${SQL_NIVEL} AS nivel, ${CAMPOS_BASE} FROM iter${where} ORDER BY entidad, mun, loc LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { total, limit, offset, items };
  }
}

// ---------------------------------------------------------------- ficha completa (286 campos)
export class CensoLocalidad extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "censo2020_localidad", summary: "Los 286 indicadores de una localidad, municipio o entidad",
    description: "Fila completa del ITER 2020 para una clave geográfica: `entidad` (00 = nacional), `mun` (000 = total de la entidad) y `loc` (0000 = total del municipio). Devuelve las 286 columnas del INEGI con sus mnemónicos originales en minúsculas; '*' y 'N/D' se conservan como texto.",
    request: { params: z.object({ entidad: z.string(), mun: z.string(), loc: z.string() }) },
    responses: { ...ok("Fila completa.", z.object({ nivel: z.string() }).catchall(Valor)), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const ent = c.req.param("entidad") ?? ""; const mun = c.req.param("mun") ?? ""; const loc = c.req.param("loc") ?? "";
    for (const [n, v, p] of [["entidad", ent, /^\d{2}$/], ["mun", mun, /^\d{3}$/], ["loc", loc, /^\d{4}$/]] as const) if (!p.test(v)) throw new ErrorHttp(422, [{ type: "string_pattern_mismatch", loc: ["path", n], msg: `String should match pattern '${p.source}'`, input: v, ctx: { pattern: p.source } } satisfies Detalle]);
    const db = c.env.DB_CENSO2020;
    const a = await fila<Record<string, unknown>>(db, `SELECT ${SQL_NIVEL} AS nivel, * FROM iter WHERE entidad=? AND mun=? AND loc=?`, [ent, mun, loc]);
    if (!a) throw new ErrorHttp(404, `no existe la clave ${ent}/${mun}/${loc} en el ITER 2020`);
    const b = await fila<Record<string, unknown>>(db, "SELECT * FROM iter_2 WHERE entidad=? AND mun=? AND loc=?", [ent, mun, loc]);
    const d = await fila<Record<string, unknown>>(db, "SELECT * FROM iter_3 WHERE entidad=? AND mun=? AND loc=?", [ent, mun, loc]);
    return { ...a, ...b, ...d };
  }
}

// ---------------------------------------------------------------- indicadores (diccionario) y serie geográfica de un indicador
const Ind = z.object({ num: z.number().int(), indicador: z.string().nullable(), descripcion: z.string().nullable(), mnemonico: z.string().nullable(), columna: z.string().nullable(), rangos: z.string().nullable(), longitud: z.string().nullable() });
export class CensoIndicadores extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "censo2020_indicadores", summary: "Los 286 indicadores del ITER 2020 (diccionario del INEGI)",
    description: "Diccionario de datos del ITER 2020 tal como lo publica el INEGI: número, nombre, descripción, mnemónico, columna en esta API, rangos y longitud. `q` filtra por nombre o descripción (contiene, sin distinguir mayúsculas).",
    request: { query: z.object({ q: z.string().optional() }) },
    responses: { ...ok("Indicadores.", z.object({ n: z.number().int(), items: z.array(Ind) })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = c.req.query("q");
    const items = await filas<z.infer<typeof Ind>>(c.env.DB_CENSO2020, `SELECT num, indicador, descripcion, mnemonico, columna, rangos, longitud FROM iter_diccionario${q ? " WHERE indicador LIKE ? COLLATE NOCASE OR descripcion LIKE ? COLLATE NOCASE" : ""} ORDER BY num`, q ? [`%${q}%`, `%${q}%`] : []);
    return { n: items.length, items };
  }
}
export class CensoIndicador extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "censo2020_indicador", summary: "Un indicador del Censo 2020 para todas las geografías de un nivel",
    description: "Valor de un indicador (columna del ITER, p. ej. `pobtot`, `p_60ymas`, `vph_inter`) para todas las filas de un `nivel` (por defecto municipio), opcionalmente dentro de una `entidad`. Es la consulta para mapas y comparaciones. Paginado con `limit` (1-5000) y `offset`; orden por clave geográfica.",
    request: { params: z.object({ columna: z.string() }), query: z.object({ nivel: z.enum(NIVELES).optional(), entidad: z.string().regex(/^\d{2}$/).optional(), limit: z.number().int().min(1).max(5000).default(2500).optional(), offset: z.number().int().min(0).default(0).optional() }) },
    responses: { ...ok("Valores del indicador.", z.object({ columna: z.string(), indicador: z.string().nullable(), nivel: z.string(), total: z.number().int(), limit: z.number().int(), offset: z.number().int(), items: z.array(z.object({ entidad: z.string(), nom_ent: z.string().nullable(), mun: z.string(), nom_mun: z.string().nullable(), loc: z.string(), nom_loc: z.string().nullable(), valor: Valor })) })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const col = (c.req.param("columna") ?? "").toLowerCase();
    if (!/^[a-z0-9_]{1,40}$/.test(col)) throw new ErrorHttp(422, [{ type: "string_pattern_mismatch", loc: ["path", "columna"], msg: "String should match pattern '^[a-z0-9_]{1,40}$'", input: col, ctx: { pattern: "^[a-z0-9_]{1,40}$" } } satisfies Detalle]);
    const db = c.env.DB_CENSO2020;
    const dic = await fila<{ indicador: string | null }>(db, "SELECT indicador FROM iter_diccionario WHERE columna = ?", [col]);
    const tabla = await tablaDe(db, col);
    if (!dic || !tabla || ["entidad", "nom_ent", "mun", "nom_mun", "loc", "nom_loc"].includes(col)) throw new ErrorHttp(404, `'${col}' no es un indicador del ITER 2020; consulte /api/v1/censo2020/indicadores`);
    const nivel = nivelParam(c.req.query("nivel")) ?? "municipio"; const ent = textoConPatron(c.req.query("entidad"), "entidad", "^\\d{2}$");
    const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 5000) ?? 2500; const offset = enteroOpcional(c.req.query("offset"), "offset", 0) ?? 0;
    const cond = [COND_NIVEL[nivel].replace(/\b(entidad|mun|loc)\b/g, "i.$1")]; const params: unknown[] = [];
    if (ent) { cond.push("i.entidad = ?"); params.push(ent); }
    const where = " WHERE " + cond.join(" AND ");
    const total = (await fila<{ n: number }>(db, `SELECT COUNT(*) AS n FROM iter i${where}`, params))!.n;
    const sel = tabla === "iter" ? `i.${col}` : `t.${col}`; const join = tabla === "iter" ? "" : ` JOIN ${tabla} t ON t.entidad=i.entidad AND t.mun=i.mun AND t.loc=i.loc`;
    const items = await filas<Record<string, unknown>>(db, `SELECT i.entidad, i.nom_ent, i.mun, i.nom_mun, i.loc, i.nom_loc, ${sel} AS valor FROM iter i${join}${where} ORDER BY i.entidad, i.mun, i.loc LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { columna: col, indicador: dic.indicador, nivel, total, limit, offset, items };
  }
}

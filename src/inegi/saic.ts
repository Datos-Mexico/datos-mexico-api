// SAIC — Sistema Automatizado de Información Censal de los Censos Económicos 2004-2024 (scripts/saic_descarga.py y
// saic_cargar.py): resultados por año censal, área geográfica (nacional, entidad, municipio), actividad económica (total,
// sector, subsector, rama, subrama, clase del SCIAN) y estrato de personal ocupado, para 98 variables censales, obtenidos
// de la API interna del SAIC del INEGI. D1 datosmexico-api-censo2020, tablas saic_a / saic_b (dos anchas por el tope de
// 100 columnas de D1) y catálogos.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { memo } from "../cubos/motor";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import type { Detalle } from "../lib/validacion";
import { enteroOpcional, textoConPatron } from "../lib/validacion";

const TAG = ["inegi"];
const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const RESP_404 = { "404": { description: "No existe.", ...contentJson(z.object({ detail: z.string() })) } };
const RESP_422 = { "422": { description: "Parámetro inválido.", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };
type Variable = { clave: string; nombre: string; grupo: string; grupo_nombre: string; definicion: string | null; tabla: string; orden: number };
const variables = (c: AppContext) => memo("saic:variables", 60, () => filas<Variable>(c.env.DB_CENSO2020, "SELECT * FROM saic_variables ORDER BY orden"));

export class SaicResumen extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_saic_resumen", summary: "SAIC: Censos Económicos 2004-2024 por municipio, actividad y estrato — qué hay y cómo se verificó",
    description: "Años censales cargados (2003 = Censos Económicos 2004 … 2023 = Censos Económicos 2024) con filas y valores, si la descarga de ese año está completa, la descarga en Parquet, y los totales nacionales de unidades económicas y personal ocupado por año, que se cotejan contra el Banco de Indicadores del INEGI (fuente Censos Económicos). Las 98 variables están en /api/v1/inegi/saic/variables y el árbol de actividad en /api/v1/inegi/saic/actividades.",
    responses: { ...ok("Resumen.", z.object({ fuente: z.string(), fuente_url: z.string(), anios: z.array(z.object({ anio: z.string(), censo: z.string(), filas: z.number().int(), valores: z.number().int(), completo: z.boolean(), tareas: z.number().int(), parquet_url: z.string().nullable(), unidades_economicas: z.number().nullable(), personal_ocupado: z.number().nullable() })), variables: z.number().int(), actividades: z.number().int(), estratos: z.array(z.object({ cod: z.number().int(), nombre: z.string() })) })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const db = c.env.DB_CENSO2020; const base = new URL(c.req.url).origin;
    const anios = await filas<Record<string, unknown>>(db, "SELECT a.*, (SELECT UE FROM saic_a x WHERE x.anio = a.anio AND x.cve_ent = '00' AND x.nivel_act = 0 AND x.estrato = 0) AS ue, (SELECT H001A FROM saic_a x WHERE x.anio = a.anio AND x.cve_ent = '00' AND x.nivel_act = 0 AND x.estrato = 0) AS pot FROM saic_anios a ORDER BY anio");
    const nv = (await variables(c)).length; const na = (await fila<{ n: number }>(db, "SELECT COUNT(*) AS n FROM saic_actividades"))!.n;
    return { fuente: "INEGI — Censos Económicos, Sistema Automatizado de Información Censal (SAIC)", fuente_url: "https://www.inegi.org.mx/app/saic/", anios: anios.map((a) => ({ anio: a.anio, censo: a.censo, filas: a.filas, valores: a.valores, completo: a.completo === 1, tareas: a.tareas, parquet_url: a.clave_parquet ? `${base}/api/v1/inegi/saic/descarga/${a.anio}` : null, unidades_economicas: a.ue, personal_ocupado: a.pot })), variables: nv, actividades: na, estratos: await filas(db, "SELECT cod, nombre FROM saic_estratos ORDER BY cod") };
  }
}
export class SaicVariables extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "inegi_saic_variables", summary: "Las 98 variables censales del SAIC con su definición", responses: { ...ok("Variables.", z.object({ n: z.number().int(), items: z.array(z.object({ clave: z.string(), nombre: z.string(), grupo: z.string(), grupo_nombre: z.string(), definicion: z.string().nullable() })) })), ...RESP_429 } };
  async handle(c: AppContext) { const v = await variables(c); return { n: v.length, items: v.map(({ clave, nombre, grupo, grupo_nombre, definicion }) => ({ clave, nombre, grupo, grupo_nombre, definicion })) }; }
}
export class SaicActividades extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "inegi_saic_actividades", summary: "Árbol de actividad económica del SAIC (sector › subsector › rama › subrama › clase)", request: { query: z.object({ nivel: z.number().int().min(0).max(5).optional(), padre: z.string().optional() }) }, responses: { ...ok("Actividades.", z.object({ n: z.number().int(), items: z.array(z.object({ clave: z.string(), nombre: z.string(), nivel: z.number().int(), padre: z.string().nullable() })) })), ...RESP_422, ...RESP_429 } };
  async handle(c: AppContext) {
    const nivel = enteroOpcional(c.req.query("nivel"), "nivel", 0, 5); const padre = c.req.query("padre"); const cond: string[] = []; const params: unknown[] = [];
    if (nivel !== null && nivel !== undefined) { cond.push("nivel = ?"); params.push(nivel); }
    if (padre) { cond.push("padre = ?"); params.push(padre); }
    const r = await filas(c.env.DB_CENSO2020, `SELECT clave, nombre, nivel, padre FROM saic_actividades${cond.length ? " WHERE " + cond.join(" AND ") : ""} ORDER BY nivel, clave`, params); return { n: r.length, items: r };
  }
}
export class SaicDatos extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_saic_datos", summary: "Datos del SAIC: filas por año, geografía, actividad y estrato con las variables pedidas",
    description: "Filtros: `anio` (año censal: 2003, 2008, 2013, 2018, 2023; obligatorio), `nivel_act` (0 total, 1 sector … 5 clase; obligatorio), `cve_ent` (2 dígitos; '00' nacional; sin él, las 32 entidades), `cve_mun` (3 dígitos, requiere cve_ent; sin él, la fila de la entidad; 'todos' = todos los municipios de la entidad), `clave_act` (clave del nivel pedido o prefijo), `estrato` (0 suma de estratos, 1 = 0 a 10, 2 = 11 a 50, 3 = 51 a 250, 4 = 251 y más, 99 agrupados por confidencialidad; por omisión 0), `variables` (claves separadas por coma; por omisión UE, H001A, J000A, A111A, A131A, Q000A). Valores nulos = el INEGI no publica el dato (confidencialidad o no aplica). Paginado con `limit` (1-2000) y `offset`.",
    request: { query: z.object({ anio: z.string().regex(/^\d{4}$/), nivel_act: z.number().int().min(0).max(5), cve_ent: z.string().regex(/^\d{2}$/).optional(), cve_mun: z.string().optional(), clave_act: z.string().optional(), estrato: z.number().int().optional(), variables: z.string().optional(), limit: z.number().int().min(1).max(2000).default(500).optional(), offset: z.number().int().min(0).default(0).optional() }) },
    responses: { ...ok("Filas.", z.object({ anio: z.string(), variables: z.array(z.string()), total: z.number().int(), limit: z.number().int(), offset: z.number().int(), items: z.array(z.record(z.string(), z.unknown())) })), ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const anio = textoConPatron(c.req.query("anio"), "anio", "^\\d{4}$"); const nivel = enteroOpcional(c.req.query("nivel_act"), "nivel_act", 0, 5);
    if (!anio) throw new ErrorHttp(422, [{ type: "missing", loc: ["query", "anio"], msg: "Field required", input: null } satisfies Detalle]);
    if (nivel === null || nivel === undefined) throw new ErrorHttp(422, [{ type: "missing", loc: ["query", "nivel_act"], msg: "Field required", input: null } satisfies Detalle]);
    const ent = textoConPatron(c.req.query("cve_ent"), "cve_ent", "^\\d{2}$"); const munQ = c.req.query("cve_mun"); const act = c.req.query("clave_act"); const estrato = enteroOpcional(c.req.query("estrato"), "estrato", 0, 99) ?? 0;
    const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 2000) ?? 500; const offset = enteroOpcional(c.req.query("offset"), "offset", 0) ?? 0;
    if (munQ && !ent) throw new ErrorHttp(422, [{ type: "missing", loc: ["query", "cve_ent"], msg: "Field required", input: null } satisfies Detalle]);
    if (munQ && munQ !== "todos" && !/^\d{3}$/.test(munQ)) throw new ErrorHttp(422, [{ type: "string_pattern_mismatch", loc: ["query", "cve_mun"], msg: "String should match pattern '^\\d{3}$' or be 'todos'", input: munQ } satisfies Detalle]);
    const vs = await variables(c); const porClave = new Map(vs.map((v) => [v.clave, v]));
    const pedidas = (c.req.query("variables") ?? "UE,H001A,J000A,A111A,A131A,Q000A").split(",").map((s) => s.trim()).filter(Boolean);
    const malas = pedidas.filter((v) => !porClave.has(v));
    if (malas.length) throw new ErrorHttp(422, [{ type: "enum", loc: ["query", "variables"], msg: `variables desconocidas: ${malas.join(", ")}; ver /api/v1/inegi/saic/variables`, input: malas } satisfies Detalle]);
    const cond = ["a.anio = ?", "a.nivel_act = ?", "a.estrato = ?"]; const params: unknown[] = [anio, nivel, estrato];
    if (ent) { cond.push("a.cve_ent = ?"); params.push(ent); } else { cond.push("a.cve_mun = ''"); }
    if (munQ === "todos") cond.push("a.cve_mun <> ''"); else if (munQ) { cond.push("a.cve_mun = ?"); params.push(munQ); } else if (ent) cond.push("a.cve_mun = ''");
    if (act) { if (nivel > 0 && act.length < nivel + 1) { cond.push("a.clave_act LIKE ?"); params.push(`${act}%`); } else { cond.push("a.clave_act = ?"); params.push(act); } }
    const usaB = pedidas.some((v) => porClave.get(v)!.tabla === "b"); const where = " WHERE " + cond.join(" AND ");
    const from = usaB ? "saic_a a JOIN saic_b b ON b.anio = a.anio AND b.nivel_act = a.nivel_act AND b.cve_ent = a.cve_ent AND b.cve_mun = a.cve_mun AND b.clave_act = a.clave_act AND b.estrato = a.estrato" : "saic_a a";
    const db = c.env.DB_CENSO2020;
    const total = (await fila<{ n: number }>(db, `SELECT COUNT(*) AS n FROM saic_a a${where}`, params))!.n;
    const sel = ["a.anio", "a.cve_ent", "a.cve_mun", "a.nivel_act", "a.clave_act", "x.nombre AS actividad", "a.estrato", ...pedidas.map((v) => `${porClave.get(v)!.tabla}.${v}`)].join(", ");
    const items = await filas(db, `SELECT ${sel} FROM ${from} LEFT JOIN saic_actividades x ON x.clave = a.clave_act${where} ORDER BY a.cve_ent, a.cve_mun, a.clave_act LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { anio, variables: pedidas, total, limit, offset, items };
  }
}
export class SaicDescarga extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "inegi_saic_descarga", summary: "Descargar un año censal completo del SAIC en Parquet (todas las variables)", request: { params: z.object({ anio: z.string().regex(/^\d{4}$/) }) }, responses: { "200": { description: "Parquet." }, ...RESP_404, ...RESP_429 } };
  async handle(c: AppContext) {
    const anio = c.req.param("anio"); const r = await fila<{ clave_parquet: string | null; bytes_parquet: number | null }>(c.env.DB_CENSO2020, "SELECT clave_parquet, bytes_parquet FROM saic_anios WHERE anio = ?", [anio]);
    if (!r || !r.clave_parquet) throw new ErrorHttp(404, "no hay Parquet para ese año");
    const obj = await c.env.DATOS.get(r.clave_parquet); if (!obj) throw new ErrorHttp(404, "el archivo no está en el almacén");
    return new Response(obj.body, { headers: { "content-type": "application/vnd.apache.parquet", "content-length": String(obj.size), "content-disposition": `attachment; filename="saic_${anio}.parquet"`, "cache-control": "public, max-age=86400" } });
  }
}

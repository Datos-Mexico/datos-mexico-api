// DENUE — Directorio Estadístico Nacional de Unidades Económicas (INEGI), edición de descarga masiva
// 05/2026: todas las unidades económicas de los 32 estados con sus 42 campos originales, en la D1
// datosmexico-api-denue. Endpoints nuevos (no existen en el legacy); validación con el formato 422 de FastAPI.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { memo } from "../cubos/motor";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import type { Detalle } from "../lib/validacion";
import { enteroOpcional, textoConPatron } from "../lib/validacion";

const TAG = ["denue"];
const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const RESP_404 = { "404": { description: "No existe.", ...contentJson(z.object({ detail: z.string() })) } };
const RESP_422 = { "422": { description: "Parámetro inválido.", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };

const COLS = ["id", "clee", "nom_estab", "raz_social", "codigo_act", "nombre_act", "per_ocu", "tipo_vial", "nom_vial", "tipo_v_e_1", "nom_v_e_1", "tipo_v_e_2", "nom_v_e_2", "tipo_v_e_3", "nom_v_e_3", "numero_ext", "letra_ext", "edificio", "edificio_e", "numero_int", "letra_int", "tipo_asent", "nomb_asent", "tipo_cencom", "nom_cencom", "num_local", "cod_postal", "cve_ent", "entidad", "cve_mun", "municipio", "cve_loc", "localidad", "ageb", "manzana", "telefono", "correoelec", "www", "tipo_unieco", "latitud", "longitud", "fecha_alta"] as const;
const Unidad = z.object(Object.fromEntries(COLS.map((c) => [c, c === "id" ? z.number().int() : c === "latitud" || c === "longitud" ? z.number().nullable() : z.string().nullable()])) as Record<string, z.ZodTypeAny>);
type UnidadT = Record<string, unknown>;
const SEL = COLS.join(", ");

function decimal(valor: string | undefined, nombre: string, min: number, max: number): number | null {
  if (valor === undefined) return null;
  if (!/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(valor)) throw new ErrorHttp(422, [{ type: "float_parsing", loc: ["query", nombre], msg: "Input should be a valid number, unable to parse string as a number", input: valor } satisfies Detalle]);
  const n = Number(valor);
  if (n < min) throw new ErrorHttp(422, [{ type: "greater_than_equal", loc: ["query", nombre], msg: `Input should be greater than or equal to ${min}`, input: valor, ctx: { ge: min } } satisfies Detalle]);
  if (n > max) throw new ErrorHttp(422, [{ type: "less_than_equal", loc: ["query", nombre], msg: `Input should be less than or equal to ${max}`, input: valor, ctx: { le: max } } satisfies Detalle]);
  return n;
}
function faltante(nombre: string): never {
  throw new ErrorHttp(422, [{ type: "missing", loc: ["query", nombre], msg: "Field required", input: null } satisfies Detalle]);
}

// ---------------------------------------------------------------- resumen
const Resumen = z.object({ fuente: z.string(), fuente_url: z.string(), edicion: z.string().nullable(), fecha_diccionario: z.string().nullable(), unidades_economicas: z.number().int(), estados: z.number().int(), municipios: z.number().int(), actividades: z.number().int(), por_estrato: z.array(z.object({ per_ocu: z.string().nullable(), n: z.number().int() })), descargado_en: z.string().nullable() });
export class DenueResumen extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "denue_resumen", summary: "Cuántas unidades económicas del DENUE tenemos",
    description: "Resumen verificable del DENUE cargado: edición del INEGI, total de unidades económicas, estados, municipios y actividades SCIAN distintas, y distribución por estrato de personal ocupado. Es el directorio completo de descarga masiva del INEGI, sin recortes.",
    responses: { ...ok("Resumen del DENUE.", Resumen), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const db = c.env.DB_DENUE;
    const ed = Object.fromEntries((await filas<{ clave: string; valor: string }>(db, "SELECT clave, valor FROM edicion")).map((r) => [r.clave, r.valor]));
    // Los conteos salen de denue_resumen (preagregada por entidad, municipio, actividad y estrato; SUM(n) = COUNT(*) de
    // unidades_economicas, verificado al cargarla): contar las 6.1 millones de filas tardaba 18-33 s y a veces excedía el
    // tiempo de D1 (500). Se memoriza 30 minutos.
    const { t, act, estratos } = await memo("denue:resumen", 30, async () => ({
      t: (await fila<{ n: number; mun: number }>(db, "SELECT SUM(n) AS n, COUNT(DISTINCT cve_ent || cve_mun) AS mun FROM denue_resumen"))!,
      act: (await fila<{ n: number }>(db, "SELECT COUNT(*) AS n FROM actividades"))!.n,
      estratos: await filas<{ per_ocu: string | null; n: number }>(db, "SELECT per_ocu, SUM(n) AS n FROM denue_resumen GROUP BY per_ocu ORDER BY n DESC"),
    }));
    return { fuente: "INEGI — DENUE, descarga masiva por entidad", fuente_url: ed.fuente_url ?? "https://www.inegi.org.mx/app/descarga/?ti=6", edicion: ed.titulo ?? null, fecha_diccionario: ed.fecha_diccionario ?? null, unidades_economicas: t.n, estados: 32, municipios: t.mun, actividades: act, por_estrato: estratos, descargado_en: ed.descargado_en ?? null };
  }
}

// ---------------------------------------------------------------- búsqueda
const Pagina = z.object({ total: z.number().int(), limit: z.number().int(), offset: z.number().int(), items: z.array(Unidad) });
export class DenueUnidades extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "denue_unidades", summary: "Buscar unidades económicas",
    description: "Busca en el DENUE completo. `q` busca (contiene, sin distinguir mayúsculas) en el nombre del establecimiento y en la razón social. Filtros exactos: `cve_ent` (2 dígitos), `cve_mun` (3 dígitos, requiere cve_ent), `cod_postal` (5 dígitos), `per_ocu` (estrato textual del INEGI, p. ej. '0 a 5 personas'). `codigo_act` acepta el código SCIAN completo (6 dígitos) o un prefijo (2 a 5 dígitos: sector, subsector, rama, subrama). Paginado con `limit` (1-500) y `offset`; orden por id.",
    request: { query: z.object({ q: z.string().optional(), cve_ent: z.string().regex(/^\d{2}$/).optional(), cve_mun: z.string().regex(/^\d{3}$/).optional(), cod_postal: z.string().regex(/^\d{5}$/).optional(), codigo_act: z.string().regex(/^\d{2,6}$/).optional(), per_ocu: z.string().optional(), limit: z.number().int().min(1).max(500).default(50).optional(), offset: z.number().int().min(0).default(0).optional() }) },
    responses: { ...ok("Unidades que cumplen los filtros.", Pagina), ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = c.req.query("q"); const ent = textoConPatron(c.req.query("cve_ent"), "cve_ent", "^\\d{2}$"); const mun = textoConPatron(c.req.query("cve_mun"), "cve_mun", "^\\d{3}$");
    const cp = textoConPatron(c.req.query("cod_postal"), "cod_postal", "^\\d{5}$"); const act = textoConPatron(c.req.query("codigo_act"), "codigo_act", "^\\d{2,6}$"); const per = c.req.query("per_ocu");
    const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 500) ?? 50; const offset = enteroOpcional(c.req.query("offset"), "offset", 0) ?? 0;
    if (mun && !ent) throw new ErrorHttp(422, [{ type: "missing", loc: ["query", "cve_ent"], msg: "Field required", input: null } satisfies Detalle]);
    const cond: string[] = []; const params: unknown[] = [];
    if (ent) { cond.push("cve_ent = ?"); params.push(ent); }
    if (mun) { cond.push("cve_mun = ?"); params.push(mun); }
    if (cp) { cond.push("cod_postal = ?"); params.push(cp); }
    if (act) { if (act.length === 6) { cond.push("codigo_act = ?"); params.push(act); } else { cond.push("codigo_act LIKE ?"); params.push(`${act}%`); } }
    if (per) { cond.push("per_ocu = ?"); params.push(per); }
    if (q) { cond.push("(nom_estab LIKE ? COLLATE NOCASE OR raz_social LIKE ? COLLATE NOCASE)"); params.push(`%${q}%`, `%${q}%`); }
    const where = cond.length ? " WHERE " + cond.join(" AND ") : "";
    const total = (await fila<{ n: number }>(c.env.DB_DENUE, `SELECT COUNT(*) AS n FROM unidades_economicas${where}`, params))!.n;
    const items = await filas<UnidadT>(c.env.DB_DENUE, `SELECT ${SEL} FROM unidades_economicas${where} ORDER BY id LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { total, limit, offset, items };
  }
}

// ---------------------------------------------------------------- ficha
export class DenueUnidad extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "denue_unidad", summary: "Ficha de una unidad económica",
    description: "Los 42 campos del DENUE de una unidad económica, tal como los publica el INEGI, por su `id` numérico.",
    request: { params: z.object({ id: z.string() }) },
    responses: { ...ok("Unidad económica.", Unidad), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const id = c.req.param("id") ?? "";
    if (!/^\d+$/.test(id)) throw new ErrorHttp(422, [{ type: "int_parsing", loc: ["path", "id"], msg: "Input should be a valid integer, unable to parse string as an integer", input: id } satisfies Detalle]);
    const r = await fila<UnidadT>(c.env.DB_DENUE, `SELECT ${SEL} FROM unidades_economicas WHERE id = ?`, [Number(id)]);
    if (!r) throw new ErrorHttp(404, `unidad económica ${id} no existe en el DENUE`);
    return r;
  }
}

// ---------------------------------------------------------------- cerca de un punto
const Cercana = Unidad.extend({ distancia_m: z.number() });
export class DenueCerca extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "denue_cerca", summary: "Unidades económicas cerca de un punto",
    description: "Unidades económicas a menos de `radio` metros (1-5000, por defecto 500) de una coordenada (`latitud`, `longitud`), ordenadas por distancia (fórmula de haversine sobre las coordenadas del INEGI). Filtro opcional por `codigo_act` (código o prefijo SCIAN) y `q` (nombre o razón social). Devuelve hasta `limit` (1-500) resultados y el total dentro del radio.",
    request: { query: z.object({ latitud: z.number().min(14).max(33), longitud: z.number().min(-119).max(-86), radio: z.number().int().min(1).max(5000).default(500).optional(), codigo_act: z.string().regex(/^\d{2,6}$/).optional(), q: z.string().optional(), limit: z.number().int().min(1).max(500).default(50).optional() }) },
    responses: { ...ok("Unidades dentro del radio, por distancia.", z.object({ latitud: z.number(), longitud: z.number(), radio_m: z.number().int(), total: z.number().int(), limit: z.number().int(), items: z.array(Cercana) })), ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const lat = decimal(c.req.query("latitud"), "latitud", 14, 33) ?? faltante("latitud"); const lon = decimal(c.req.query("longitud"), "longitud", -119, -86) ?? faltante("longitud");
    const radio = enteroOpcional(c.req.query("radio"), "radio", 1, 5000) ?? 500; const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 500) ?? 50;
    const act = textoConPatron(c.req.query("codigo_act"), "codigo_act", "^\\d{2,6}$"); const q = c.req.query("q");
    const dLat = radio / 111_320; const dLon = radio / (111_320 * Math.cos((lat * Math.PI) / 180));
    const cond = ["latitud BETWEEN ? AND ?", "longitud BETWEEN ? AND ?"]; const params: unknown[] = [lat - dLat, lat + dLat, lon - dLon, lon + dLon];
    if (act) { if (act.length === 6) { cond.push("codigo_act = ?"); params.push(act); } else { cond.push("codigo_act LIKE ?"); params.push(`${act}%`); } }
    if (q) { cond.push("(nom_estab LIKE ? COLLATE NOCASE OR raz_social LIKE ? COLLATE NOCASE)"); params.push(`%${q}%`, `%${q}%`); }
    const caja = await filas<{ id: number; latitud: number; longitud: number } & Record<string, unknown>>(c.env.DB_DENUE, `SELECT ${SEL} FROM unidades_economicas WHERE ${cond.join(" AND ")} LIMIT 20000`, params);
    const R = 6_371_000; const rad = (x: number) => (x * Math.PI) / 180;
    const conDist = caja.map((u) => {
      const a = Math.sin(rad(u.latitud - lat) / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(u.latitud)) * Math.sin(rad(u.longitud - lon) / 2) ** 2;
      return { ...u, distancia_m: Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10 };
    }).filter((u) => u.distancia_m <= radio).sort((a, b) => a.distancia_m - b.distancia_m || a.id - b.id);
    return { latitud: lat, longitud: lon, radio_m: radio, total: conDist.length, limit, items: conDist.slice(0, limit) };
  }
}

// ---------------------------------------------------------------- actividades SCIAN
export class DenueActividades extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "denue_actividades", summary: "Actividades económicas (SCIAN 2018) presentes en el DENUE",
    description: "Catálogo de códigos de actividad SCIAN 2018 derivado del propio directorio, con el número de unidades económicas de cada uno. `q` filtra por nombre (contiene, sin distinguir mayúsculas) y `prefijo` por los primeros dígitos del código (sector, subsector, rama, subrama).",
    request: { query: z.object({ q: z.string().optional(), prefijo: z.string().regex(/^\d{1,6}$/).optional() }) },
    responses: { ...ok("Actividades.", z.object({ n: z.number().int(), items: z.array(z.object({ codigo_act: z.string(), nombre_act: z.string().nullable(), n_unidades: z.number().int() })) })), ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = c.req.query("q"); const pre = textoConPatron(c.req.query("prefijo"), "prefijo", "^\\d{1,6}$");
    const cond: string[] = []; const params: unknown[] = [];
    if (q) { cond.push("nombre_act LIKE ? COLLATE NOCASE"); params.push(`%${q}%`); }
    if (pre) { cond.push("codigo_act LIKE ?"); params.push(`${pre}%`); }
    const items = await filas<{ codigo_act: string; nombre_act: string | null; n_unidades: number }>(c.env.DB_DENUE, `SELECT codigo_act, nombre_act, n_unidades FROM actividades${cond.length ? " WHERE " + cond.join(" AND ") : ""} ORDER BY codigo_act`, params);
    return { n: items.length, items };
  }
}

// ---------------------------------------------------------------- histórico (20 ediciones, scripts/denue_historico.py)
const Edicion = z.object({ edicion: z.string(), periodo_inegi: z.string(), orden: z.number().int(), unidades: z.number().int(), publicado: z.number().int().nullable(), diferencia: z.number().int().nullable(), verificado: z.boolean().nullable(), grupos: z.number().int(), municipios: z.number().int(), clases: z.number().int(), archivos: z.number().int(), scian: z.string(), fuente_cifra: z.string().nullable(), parquet_url: z.string(), fuentes_prefijo: z.string() });
export class DenueEdiciones extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "denue_ediciones", summary: "Las 25 ediciones del DENUE (2010 a 05/2026) y su verificación",
    description: "Cada edición de la descarga masiva del INEGI (archivos por entidad) con el total de unidades de sus archivos, la cifra que el INEGI publicó para esa edición (comunicado o documento metodológico) y la diferencia. `verificado` es true cuando coinciden, false cuando no (esas ediciones no entran en los cubos) y null cuando el INEGI no publicó una cifra exacta. `parquet_url` descarga la edición completa (todas las columnas) en Parquet.",
    responses: { ...ok("Ediciones del DENUE.", z.object({ fuente: z.string(), fuente_url: z.string(), n: z.number().int(), items: z.array(Edicion) })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const items = await memo("denue:ediciones", 30, () => filas<Record<string, unknown>>(c.env.DB_DENUE, "SELECT * FROM denue_ediciones ORDER BY orden"));
    const base = new URL(c.req.url).origin;
    return { fuente: "INEGI — DENUE, descarga masiva por entidad, 25 ediciones (2010 a 05/2026)", fuente_url: "https://www.inegi.org.mx/app/descarga/?ti=6", n: items.length,
      items: items.map((r) => ({ edicion: r.edicion, periodo_inegi: r.periodo_inegi, orden: r.orden, unidades: r.unidades, publicado: r.publicado, diferencia: r.diferencia, verificado: r.verificado === null ? null : r.verificado === 1, grupos: r.grupos, municipios: r.municipios, clases: r.clases, archivos: r.archivos, scian: r.scian, fuente_cifra: r.fuente_cifra, parquet_url: `${base}/api/v1/denue/historico/descarga/${r.edicion}`, fuentes_prefijo: r.clave_fuentes })) };
  }
}

const Serie = z.object({ fuente: z.string(), filtros: z.object({ cve_ent: z.string().nullable(), codigo_act: z.string().nullable(), per_ocu_cod: z.number().int().nullable() }), n: z.number().int(), items: z.array(z.object({ edicion: z.string(), periodo_inegi: z.string(), verificado: z.boolean().nullable(), unidades: z.number().int() })) });
export class DenueHistorico extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "denue_historico", summary: "Unidades económicas por edición del DENUE (serie 2010-2026)",
    description: "Total de unidades económicas en cada edición del DENUE, con filtros opcionales: `cve_ent` (2 dígitos), `codigo_act` (código SCIAN completo o prefijo de 2 a 5 dígitos; el DENUE de 2010 a 10/2013 usa el SCIAN 2007, de 2015 a 03/2018 el SCIAN 2013 y de 11/2018 en adelante el SCIAN 2018) y `per_ocu_cod` (estrato 1 = 0 a 5 personas … 7 = 251 y más; 0 = no especificado). Incluye todas las ediciones y marca `verificado`.",
    request: { query: z.object({ cve_ent: z.string().regex(/^\d{2}$/).optional(), codigo_act: z.string().regex(/^\d{2,6}$/).optional(), per_ocu_cod: z.number().int().min(0).max(7).optional() }) },
    responses: { ...ok("Serie por edición.", Serie), ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const ent = textoConPatron(c.req.query("cve_ent"), "cve_ent", "^\\d{2}$"); const act = textoConPatron(c.req.query("codigo_act"), "codigo_act", "^\\d{2,6}$"); const per = enteroOpcional(c.req.query("per_ocu_cod"), "per_ocu_cod", 0, 7);
    const cond: string[] = []; const params: unknown[] = [];
    if (ent) { cond.push("h.cve_ent = ?"); params.push(ent); }
    if (act) { if (act.length === 6) { cond.push("h.codigo_act = ?"); params.push(act); } else { cond.push("h.codigo_act LIKE ?"); params.push(`${act}%`); } }
    if (per !== null && per !== undefined) { cond.push("h.per_ocu_cod = ?"); params.push(per); }
    const where = cond.length ? " WHERE " + cond.join(" AND ") : "";
    const r = await filas<{ edicion: string; periodo_inegi: string; verificado: number | null; unidades: number }>(c.env.DB_DENUE, `SELECT e.edicion, e.periodo_inegi, e.verificado, COALESCE(SUM(h.n), 0) AS unidades FROM denue_ediciones e LEFT JOIN denue_hist_entidad h ON h.edicion = e.edicion${where ? where.replace(" WHERE ", " AND ") : ""} GROUP BY e.edicion, e.periodo_inegi, e.verificado, e.orden ORDER BY e.orden`, params);
    return { fuente: "INEGI — DENUE, descarga masiva por entidad, 25 ediciones", filtros: { cve_ent: ent ?? null, codigo_act: act ?? null, per_ocu_cod: per ?? null }, n: r.length, items: r.map((x) => ({ ...x, verificado: x.verificado === null ? null : x.verificado === 1 })) };
  }
}

export class DenueHistoricoDescarga extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "denue_historico_descarga", summary: "Descargar una edición completa del DENUE en Parquet",
    description: "Devuelve el archivo Parquet de la edición (todas las unidades con sus columnas originales, tal como las publica el INEGI), desde el almacén del observatorio.",
    request: { params: z.object({ edicion: z.string().regex(/^\d{4}(-\d{2})?$/) }) },
    responses: { "200": { description: "Archivo Parquet." }, ...RESP_404, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const ed = c.req.param("edicion");
    const r = await fila<{ clave_parquet: string; bytes_parquet: number }>(c.env.DB_DENUE, "SELECT clave_parquet, bytes_parquet FROM denue_ediciones WHERE edicion = ?", [ed]);
    if (!r) throw new ErrorHttp(404, "No existe esa edición del DENUE");
    const obj = await c.env.DATOS.get(r.clave_parquet);
    if (!obj) throw new ErrorHttp(404, "El archivo no está en el almacén");
    return new Response(obj.body, { headers: { "content-type": "application/vnd.apache.parquet", "content-length": String(r.bytes_parquet), "content-disposition": `attachment; filename="denue_${ed}.parquet"`, "cache-control": "public, max-age=86400" } });
  }
}

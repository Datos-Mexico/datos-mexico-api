// Datos abiertos del INEGI ingeridos por el observatorio: microdatos de todos los programas de la descarga
// masiva del INEGI convertidos a Parquet (con el zip original guardado) y tabulados archivados íntegros, todo en R2
// con manifiesto verificable. El catálogo vive en la D1 datosmexico-api-bise (da_programas, da_microdatos,
// da_tabulados) y se reconstruye desde los manifiestos con scripts/inegi_catalogo_d1.py.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import type { Detalle } from "../lib/validacion";
import { enteroOpcional, textoConPatron } from "../lib/validacion";

const TAG = ["inegi-datos-abiertos"];
const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const RESP_404 = { "404": { description: "No existe.", ...contentJson(z.object({ detail: z.string() })) } };
const RESP_422 = { "422": { description: "Parámetro inválido.", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };
const SLUG = "^[a-z0-9\\-]{1,60}$";
// el esquema se guarda como JSON; las tablas de miles de columnas vienen gzip+base64 con prefijo gz: (límite de sentencia de D1)
async function leerEsquema(texto: string): Promise<[string, string][]> {
  if (!texto.startsWith("gz:")) return JSON.parse(texto);
  const bytes = Uint8Array.from(atob(texto.slice(3)), (ch) => ch.charCodeAt(0));
  const ds = new DecompressionStream("gzip"); const w = ds.writable.getWriter(); w.write(bytes); w.close();
  return JSON.parse(await new Response(ds.readable).text());
}

export class DatosAbiertosResumen extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_datos_abiertos_resumen", summary: "Cuánto del INEGI (descarga masiva) tenemos ya",
    description: "Avance medible contra el inventario de la descarga masiva del INEGI (recorrido programa por programa el 2026-09-20): programas y archivos de microdatos del universo frente a los ingeridos (con filas, tablas y bytes en Parquet), y tabulados del universo frente a los archivados. Todo lo ingerido conserva el archivo original del INEGI (SHA-256) junto al Parquet.",
    responses: { ...ok("Cobertura.", z.object({ fuente: z.string(), inventario: z.string(), microdatos: z.object({ programas_universo: z.number().int(), programas_con_algo: z.number().int(), programas_completos: z.number().int(), archivos_universo: z.number().int(), archivos_ingeridos: z.number().int(), tablas: z.number().int(), filas: z.number().int(), gb_parquet: z.number() }), tabulados: z.object({ programas_universo: z.number().int(), archivos_universo: z.number().int(), archivos_archivados: z.number().int(), gb: z.number() }), ultima_ingesta: z.string().nullable() })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const db = c.env.DB_BISE;
    const p = (await fila<Record<string, number>>(db, "SELECT COUNT(CASE WHEN microdatos_universo > 0 THEN 1 END) AS pu, COUNT(CASE WHEN microdatos_ingeridos > 0 THEN 1 END) AS pa, COUNT(CASE WHEN microdatos_universo > 0 AND microdatos_ingeridos >= microdatos_universo THEN 1 END) AS pc, SUM(microdatos_universo) AS au, SUM(microdatos_ingeridos) AS ai, COUNT(CASE WHEN tabulados_universo > 0 THEN 1 END) AS tpu, SUM(tabulados_universo) AS tu, SUM(tabulados_ingeridos) AS ti FROM da_programas"))!;
    const m = (await fila<{ t: number; f: number; b: number; u: string | null }>(db, "SELECT COUNT(*) AS t, COALESCE(SUM(filas), 0) AS f, COALESCE(SUM(bytes_parquet), 0) AS b, MAX(ingerido_en) AS u FROM da_microdatos"))!;
    const t = (await fila<{ b: number; u: string | null }>(db, "SELECT COALESCE(SUM(bytes), 0) AS b, MAX(ingerido_en) AS u FROM da_tabulados"))!;
    return { fuente: "INEGI — Descarga masiva (microdatos y tabulados de todos los programas)", inventario: "data/inegi-universo/archivos.csv, 2026-09-20", microdatos: { programas_universo: p.pu, programas_con_algo: p.pa, programas_completos: p.pc, archivos_universo: p.au, archivos_ingeridos: p.ai, tablas: m.t, filas: m.f, gb_parquet: Math.round(m.b / 1e7) / 100 }, tabulados: { programas_universo: p.tpu, archivos_universo: p.tu, archivos_archivados: p.ti, gb: Math.round(t.b / 1e7) / 100 }, ultima_ingesta: [m.u, t.u].filter(Boolean).sort().pop() ?? null };
  }
}

const Programa = z.object({ programa: z.string(), programa_slug: z.string(), microdatos_universo: z.number().int(), microdatos_ingeridos: z.number().int(), filas_microdatos: z.number().int(), tabulados_universo: z.number().int(), tabulados_ingeridos: z.number().int() });
export class DatosAbiertosProgramas extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_datos_abiertos_programas", summary: "Programas del INEGI: universo e ingerido",
    description: "Los programas de la descarga masiva del INEGI con cuántos archivos de microdatos y tabulados tiene cada uno en el universo y cuántos ya están en el observatorio. `q` filtra por nombre (contiene, sin distinguir mayúsculas).",
    request: { query: z.object({ q: z.string().optional() }) },
    responses: { ...ok("Programas.", z.object({ n: z.number().int(), items: z.array(Programa) })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = c.req.query("q");
    const items = await filas<z.infer<typeof Programa>>(c.env.DB_BISE, `SELECT * FROM da_programas${q ? " WHERE programa LIKE ? COLLATE NOCASE" : ""} ORDER BY programa`, q ? [`%${q}%`] : []);
    return { n: items.length, items };
  }
}

const Tabla = z.object({ edicion: z.string(), titulo: z.string().nullable(), archivo: z.string(), tabla: z.string(), origen: z.string().nullable(), formato: z.string().nullable(), filas: z.number().int(), columnas: z.number().int(), esquema: z.array(z.tuple([z.string(), z.string()])), bytes_parquet: z.number().int(), parquet_url: z.string(), fuente_url: z.string().nullable(), url_inegi: z.string().nullable(), sha256_zip: z.string().nullable(), ingerido_en: z.string().nullable() });
export class DatosAbiertosPrograma extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_datos_abiertos_programa", summary: "Un programa: ediciones, archivos, tablas y esquema",
    description: "Todo lo ingerido de un programa (por su `programa_slug`): cada tabla Parquet con edición, archivo de origen, filas, columnas y esquema (nombre y tipo por columna), su URL de descarga en el observatorio, la del zip original del INEGI que se conservó y la URL original del INEGI. Filtro opcional `edicion`.",
    request: { params: z.object({ programa_slug: z.string() }), query: z.object({ edicion: z.string().optional() }) },
    responses: { ...ok("Programa.", z.object({ programa: Programa, ediciones: z.array(z.string()), n_tablas: z.number().int(), tablas: z.array(Tabla), tabulados: z.number().int() })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const slug = textoConPatron(c.req.param("programa_slug"), "programa_slug", SLUG)!; const ed = c.req.query("edicion");
    const p = await fila<z.infer<typeof Programa>>(c.env.DB_BISE, "SELECT * FROM da_programas WHERE programa_slug = ?", [slug]);
    if (!p) throw new ErrorHttp(404, `programa '${slug}' no existe; consulte /api/v1/inegi/datos-abiertos/programas`);
    const params: unknown[] = [slug]; let where = " WHERE programa_slug = ?";
    if (ed) { where += " AND edicion = ?"; params.push(ed); }
    const rows = await filas<Record<string, unknown>>(c.env.DB_BISE, `SELECT edicion, titulo, archivo, tabla, origen, formato, filas, columnas, esquema, bytes_parquet, clave_r2, fuente_r2, url_inegi, sha256_zip, ingerido_en FROM da_microdatos${where} ORDER BY edicion, archivo, tabla`, params);
    const ediciones = (await filas<{ e: string }>(c.env.DB_BISE, "SELECT DISTINCT edicion AS e FROM da_microdatos WHERE programa_slug = ? ORDER BY e", [slug])).map((r) => r.e);
    const tabulados = (await fila<{ n: number }>(c.env.DB_BISE, "SELECT COUNT(*) AS n FROM da_tabulados WHERE programa_slug = ?", [slug]))!.n;
    const tablas = [];
    for (const r of rows) tablas.push({ edicion: r.edicion, titulo: r.titulo, archivo: r.archivo, tabla: r.tabla, origen: r.origen, formato: r.formato, filas: r.filas, columnas: r.columnas, esquema: await leerEsquema(r.esquema as string), bytes_parquet: r.bytes_parquet, parquet_url: `/api/v1/inegi/datos-abiertos/descarga/${r.clave_r2}`, fuente_url: r.fuente_r2 ? `/api/v1/inegi/datos-abiertos/descarga/${r.fuente_r2}` : null, url_inegi: r.url_inegi, sha256_zip: r.sha256_zip, ingerido_en: r.ingerido_en });
    return { programa: p, ediciones, n_tablas: tablas.length, tablas, tabulados };
  }
}

const Tabulado = z.object({ programa: z.string(), programa_slug: z.string(), edicion: z.string(), titulo: z.string().nullable(), formato: z.string().nullable(), bytes: z.number().int().nullable(), sha256: z.string().nullable(), url: z.string(), url_inegi: z.string().nullable() });
export class DatosAbiertosTabulados extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_datos_abiertos_tabulados", summary: "Tabulados archivados (cuadros Excel/HTML/PDF del INEGI)",
    description: "Índice de los tabulados de la descarga masiva del INEGI archivados íntegros, sin transformar (son cuadros de presentación): programa, edición, título, formato, tamaño, SHA-256 y URL de descarga. Filtros: `programa_slug`, `edicion`, `q` (título). Paginado con `limit` (1-500) y `offset`.",
    request: { query: z.object({ programa_slug: z.string().optional(), edicion: z.string().optional(), q: z.string().optional(), limit: z.number().int().min(1).max(500).default(50).optional(), offset: z.number().int().min(0).default(0).optional() }) },
    responses: { ...ok("Tabulados.", z.object({ total: z.number().int(), limit: z.number().int(), offset: z.number().int(), items: z.array(Tabulado) })), ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const slug = textoConPatron(c.req.query("programa_slug"), "programa_slug", SLUG); const ed = c.req.query("edicion"); const q = c.req.query("q");
    const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 500) ?? 50; const offset = enteroOpcional(c.req.query("offset"), "offset", 0) ?? 0;
    const cond: string[] = []; const params: unknown[] = [];
    if (slug) { cond.push("programa_slug = ?"); params.push(slug); }
    if (ed) { cond.push("edicion = ?"); params.push(ed); }
    if (q) { cond.push("titulo LIKE ? COLLATE NOCASE"); params.push(`%${q}%`); }
    const where = cond.length ? " WHERE " + cond.join(" AND ") : "";
    const total = (await fila<{ n: number }>(c.env.DB_BISE, `SELECT COUNT(*) AS n FROM da_tabulados${where}`, params))!.n;
    const rows = await filas<Record<string, unknown>>(c.env.DB_BISE, `SELECT programa, programa_slug, edicion, titulo, formato, bytes, sha256, clave_r2, url_inegi FROM da_tabulados${where} ORDER BY programa_slug, edicion, titulo LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { total, limit, offset, items: rows.map((r) => ({ programa: r.programa, programa_slug: r.programa_slug, edicion: r.edicion, titulo: r.titulo, formato: r.formato, bytes: r.bytes, sha256: r.sha256, url: `/api/v1/inegi/datos-abiertos/descarga/${r.clave_r2}`, url_inegi: r.url_inegi })) };
  }
}

export class DatosAbiertosDescarga extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_datos_abiertos_descarga", summary: "Descargar un Parquet, un zip original o un tabulado del almacén",
    description: "Entrega el archivo tal como está guardado en el almacén del observatorio (R2): Parquet de microdatos, zip original del INEGI o tabulado. La clave es la ruta que aparece en `parquet_url`, `fuente_url` o `url` de los otros endpoints (prefijos `inegi/microdatos/`, `inegi/fuentes/`, `inegi/tabulados/`, `enoe/microdatos/`, `censo2020/`). Respuesta binaria con `Content-Length` y ETag.",
    request: { params: z.object({ clave: z.string() }) },
    responses: { "200": { description: "El archivo." }, ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const clave = decodeURIComponent(c.req.path.replace(/^\/api\/v1\/inegi\/datos-abiertos\/descarga\//, ""));
    if (!/^(inegi\/(microdatos|fuentes|tabulados)|enoe\/microdatos|censo2020)\/[A-Za-z0-9_\-./%()]+$/.test(clave) || clave.includes("..")) throw new ErrorHttp(422, [{ type: "string_pattern_mismatch", loc: ["path", "clave"], msg: "clave fuera de los prefijos permitidos", input: clave } satisfies Detalle]);
    const obj = await c.env.DATOS.get(clave);
    if (!obj) throw new ErrorHttp(404, `no existe '${clave}' en el almacén`);
    const h = new Headers(); obj.writeHttpMetadata(h); h.set("etag", obj.httpEtag); h.set("content-length", String(obj.size)); h.set("content-disposition", `attachment; filename="${clave.split("/").pop()}"`); h.set("cache-control", "public, max-age=86400");
    return new Response(obj.body, { headers: h });
  }
}

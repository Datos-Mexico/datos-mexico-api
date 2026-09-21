// Tabulados del INEGI como tablas explorables (scripts/tabulados_explorables.py): los cuadros publicados en Excel (censos de
// población 2005, 2010, 2015 y 2020; cuentas por sectores institucionales anuales y trimestrales), leídos tal cual y guardados
// en formato largo (una fila por celda: valores de las dimensiones de la fila, encabezado de la columna, valor). D1
// datosmexico-api-tabulados: tab_familias, tab_cuadros, tab_datos. El archivo original queda en R2 y se sirve en /archivo.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import type { Detalle } from "../lib/validacion";
import { enteroOpcional } from "../lib/validacion";

const TAG = ["inegi"];
const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const RESP_404 = { "404": { description: "No existe.", ...contentJson(z.object({ detail: z.string() })) } };
const RESP_422 = { "422": { description: "Parámetro inválido.", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };
const CUADRO = z.object({ cuadro: z.string(), archivo: z.string(), hoja: z.string(), titulo: z.string(), dimensiones: z.array(z.string()), columnas: z.array(z.string()), celdas: z.number().int(), sha256: z.string(), archivo_url: z.string().nullable() });
type Cuadro = { familia: string; cuadro: string; archivo: string; hoja: string; titulo: string; dimensiones: string; columnas: string; celdas: number; sha256: string; clave_r2: string | null };
const cuadroJson = (r: Cuadro, base: string) => ({ cuadro: r.cuadro, archivo: r.archivo, hoja: r.hoja, titulo: r.titulo, dimensiones: JSON.parse(r.dimensiones) as string[], columnas: JSON.parse(r.columnas) as string[], celdas: r.celdas, sha256: r.sha256, archivo_url: r.clave_r2 ? `${base}/api/v1/inegi/tabulados/${r.familia}/${encodeURIComponent(r.cuadro)}/archivo` : null });
const familiaDe = (c: AppContext) => { const f = c.req.param("familia") ?? ""; if (!/^[a-z0-9-]{2,40}$/.test(f)) throw new ErrorHttp(404, "familia inexistente"); return f; };

export class TabuladosFamilias extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_tabulados_familias", summary: "Tabulados del INEGI explorables: familias de cuadros (censos de población, cuentas por sectores institucionales)",
    description: "Cada familia agrupa los cuadros publicados en Excel por el INEGI para un programa y edición, leídos tal cual (cada celda numérica con las categorías de su fila y el encabezado de su columna). Un cubo por familia en /api/v1/cubos (tabulados-*). Control de lectura: el número de celdas numéricas leídas de cada hoja es igual al de la hoja; el archivo original está en /archivo con su SHA-256.",
    responses: { ...ok("Familias.", z.object({ n: z.number().int(), items: z.array(z.object({ familia: z.string(), nombre: z.string(), programa: z.string(), edicion: z.string(), fuente_url: z.string(), archivos: z.number().int(), cuadros: z.number().int(), celdas: z.number().int(), corte: z.string().nullable(), cuadros_url: z.string(), cubo: z.string() })) })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const base = new URL(c.req.url).origin; const r = await filas<Record<string, unknown>>(c.env.DB_TABULADOS, "SELECT * FROM tab_familias ORDER BY familia");
    return { n: r.length, items: r.map((f) => ({ ...f, cuadros_url: `${base}/api/v1/inegi/tabulados/${f.familia}`, cubo: `tabulados-${f.familia}` })) };
  }
}
export class TabuladosCuadros extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "inegi_tabulados_cuadros", summary: "Cuadros de una familia de tabulados, con su título, dimensiones de fila y encabezados de columna", request: { params: z.object({ familia: z.string() }) }, responses: { ...ok("Cuadros.", z.object({ familia: z.string(), nombre: z.string(), n: z.number().int(), items: z.array(CUADRO) })), ...RESP_404, ...RESP_429 } };
  async handle(c: AppContext) {
    const familia = familiaDe(c); const base = new URL(c.req.url).origin; const f = await fila<{ nombre: string }>(c.env.DB_TABULADOS, "SELECT nombre FROM tab_familias WHERE familia = ?", [familia]);
    if (!f) throw new ErrorHttp(404, "familia inexistente");
    const r = await filas<Cuadro>(c.env.DB_TABULADOS, "SELECT * FROM tab_cuadros WHERE familia = ? ORDER BY cuadro", [familia]);
    return { familia, nombre: f.nombre, n: r.length, items: r.map((x) => cuadroJson(x, base)) };
  }
}
export class TabuladosCuadro extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_tabulados_cuadro", summary: "Un cuadro: ficha y sus celdas en formato largo (filtrables por dimensión y columna), en el orden del cuadro publicado",
    description: "Filtros: `d1`…`d5` (valor exacto de cada dimensión de fila, en el orden de `dimensiones`), `columna` (encabezado exacto), `limit` (≤ 5000), `offset`. Cada celda trae `valor` (número) o `texto` (símbolo publicado en vez de número) y `orden` (posición en el cuadro).",
    request: { params: z.object({ familia: z.string(), cuadro: z.string() }), query: z.object({ d1: z.string().optional(), d2: z.string().optional(), d3: z.string().optional(), d4: z.string().optional(), d5: z.string().optional(), columna: z.string().optional(), limit: z.number().int().min(1).max(5000).default(500).optional(), offset: z.number().int().min(0).default(0).optional() }) },
    responses: { ...ok("Cuadro.", z.object({ familia: z.string(), cuadro: CUADRO, total: z.number().int(), limit: z.number().int(), offset: z.number().int(), items: z.array(z.object({ d1: z.string(), d2: z.string(), d3: z.string(), d4: z.string(), d5: z.string(), columna: z.string(), valor: z.number().nullable(), texto: z.string().nullable(), orden: z.number().int() })) })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const familia = familiaDe(c); const cuadro = c.req.param("cuadro") ?? ""; const base = new URL(c.req.url).origin;
    const q = await fila<Cuadro>(c.env.DB_TABULADOS, "SELECT * FROM tab_cuadros WHERE familia = ? AND cuadro = ?", [familia, cuadro]);
    if (!q) throw new ErrorHttp(404, "cuadro inexistente");
    const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 5000) ?? 500; const offset = enteroOpcional(c.req.query("offset"), "offset", 0) ?? 0;
    const cond = ["familia = ?", "cuadro = ?"]; const params: unknown[] = [familia, cuadro];
    for (const k of ["d1", "d2", "d3", "d4", "d5", "columna"]) { const v = c.req.query(k); if (v !== undefined) { if (v.length > 300) throw new ErrorHttp(422, [{ type: "string_too_long", loc: ["query", k], msg: "≤ 300 caracteres", input: v } satisfies Detalle]); cond.push(`${k} = ?`); params.push(v); } }
    const where = " WHERE " + cond.join(" AND ");
    const total = (await fila<{ n: number }>(c.env.DB_TABULADOS, `SELECT COUNT(*) AS n FROM tab_datos${where}`, params))!.n;
    const items = await filas(c.env.DB_TABULADOS, `SELECT d1, d2, d3, d4, d5, columna, valor, texto, orden FROM tab_datos${where} ORDER BY orden LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { familia, cuadro: cuadroJson(q, base), total, limit, offset, items };
  }
}
export class TabuladosArchivo extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "inegi_tabulados_archivo", summary: "Descargar el archivo Excel original del cuadro (tal como lo publicó el INEGI)", request: { params: z.object({ familia: z.string(), cuadro: z.string() }) }, responses: { "200": { description: "Excel." }, ...RESP_404, ...RESP_429 } };
  async handle(c: AppContext) {
    const familia = familiaDe(c); const cuadro = c.req.param("cuadro") ?? "";
    const q = await fila<{ clave_r2: string | null; archivo: string }>(c.env.DB_TABULADOS, "SELECT clave_r2, archivo FROM tab_cuadros WHERE familia = ? AND cuadro = ?", [familia, cuadro]);
    if (!q || !q.clave_r2) throw new ErrorHttp(404, "cuadro inexistente o sin archivo");
    const obj = await c.env.DATOS.get(q.clave_r2); if (!obj) throw new ErrorHttp(404, "el archivo no está en el almacén");
    const tipo = q.archivo.toLowerCase().endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/vnd.ms-excel";
    return new Response(obj.body, { headers: { "content-type": tipo, "content-length": String(obj.size), "content-disposition": `attachment; filename="${q.archivo}"`, "cache-control": "public, max-age=86400" } });
  }
}

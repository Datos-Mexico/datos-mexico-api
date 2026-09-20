// Erratas y observaciones sobre datos oficiales. Principio: las tablas oficiales del observatorio son de solo
// lectura; un posible error se reporta aquí, con quién y cuándo, un administrador lo revisa y, si procede, se
// documenta y se aplica en la siguiente edición cargada. El dato publicado nunca se modifica por la API.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { ErrorHttp } from "../lib/errores";
import { RESP_401, RESP_403, SEGURIDAD, requiereAdmin, usuarioActual } from "../lib/auth";
import type { Detalle } from "../lib/validacion";
import { enteroOpcional, textoConPatron } from "../lib/validacion";
import { enteroRuta } from "../cdmx/comun";
import { DATASETS } from "../catalogo/datasets";
import { ahoraPg, isoZ } from "../demo/endpoints";

const TAG = ["erratas"];
const ESTADOS = ["pendiente", "aceptada", "rechazada"] as const;
const RESP_422 = { "422": { description: "Validation Error", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };
const E404 = { "404": { description: "Errata inexistente.", ...contentJson(z.object({ detail: z.string() })) } };
const RESP_429 = { "429": { description: "Rate limit excedido.", ...contentJson(z.object({ detail: z.string() })) } };
const COLS = "id, dataset, tabla, registro, campo, valor_observado, valor_propuesto, fuente, comentario, estado, nota_revision, reportado_por, revisado_por, creado_en, revisado_en";
type Fila = { id: number; dataset: string; tabla: string | null; registro: string | null; campo: string | null; valor_observado: string | null; valor_propuesto: string | null; fuente: string | null; comentario: string; estado: string; nota_revision: string | null; reportado_por: string; revisado_por: string | null; creado_en: string; revisado_en: string | null };
const Errata = z.object({ id: z.number().int(), dataset: z.string(), tabla: z.string().nullable(), registro: z.string().nullable(), campo: z.string().nullable(), valor_observado: z.string().nullable(), valor_propuesto: z.string().nullable(), fuente: z.string().nullable(), comentario: z.string(), estado: z.enum(ESTADOS), nota_revision: z.string().nullable(), reportado_por: z.string(), revisado_por: z.string().nullable(), creado_en: z.string(), revisado_en: z.string().nullable() });
const salida = (r: Fila) => ({ ...r, creado_en: isoZ(r.creado_en), revisado_en: r.revisado_en ? isoZ(r.revisado_en) : null });
function validar<T>(esquema: z.ZodType<T>, cuerpo: unknown): T {
  const r = esquema.safeParse(cuerpo);
  if (r.success) return r.data;
  throw new ErrorHttp(422, r.error.issues.map((i) => { const falta = i.code === "invalid_type" && i.message.includes("received undefined"); return { type: falta ? "missing" : i.code, loc: ["body", ...i.path.map(String)], msg: falta ? "Field required" : i.message, input: cuerpo } satisfies Detalle; }));
}
async function porId(c: AppContext, id: number): Promise<Fila> {
  const r = await fila<Fila>(c.env.DB_PLATAFORMA, `SELECT ${COLS} FROM erratas WHERE id = ?`, [id]);
  if (!r) throw new ErrorHttp(404, `errata ${id} no existe`);
  return r;
}

export class ErratasLista extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "erratas_lista", summary: "Erratas y observaciones reportadas sobre los datos oficiales",
    description: "Lista pública de reportes: qué base y registro se cuestiona, qué valor se observó y cuál se propone, quién lo reportó y en qué estado está (pendiente, aceptada, rechazada) con la nota de revisión. Las tablas oficiales nunca cambian por esta vía: una errata aceptada se documenta y se aplica en la siguiente edición cargada. Filtros: `dataset`, `estado`; paginado con `limit` (1-500) y `offset`.",
    request: { query: z.object({ dataset: z.string().optional(), estado: z.enum(ESTADOS).optional(), limit: z.number().int().min(1).max(500).default(50).optional(), offset: z.number().int().min(0).default(0).optional() }) },
    responses: { "200": { description: "Erratas.", ...contentJson(z.object({ total: z.number().int(), limit: z.number().int(), offset: z.number().int(), items: z.array(Errata) })) }, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const dataset = c.req.query("dataset"); const estado = c.req.query("estado");
    if (estado !== undefined && !(ESTADOS as readonly string[]).includes(estado)) throw new ErrorHttp(422, [{ type: "literal_error", loc: ["query", "estado"], msg: "Input should be 'pendiente', 'aceptada' or 'rechazada'", input: estado, ctx: { expected: "'pendiente', 'aceptada' or 'rechazada'" } } satisfies Detalle]);
    const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 500) ?? 50; const offset = enteroOpcional(c.req.query("offset"), "offset", 0) ?? 0;
    const cond: string[] = []; const params: unknown[] = [];
    if (dataset) { cond.push("dataset = ?"); params.push(dataset); }
    if (estado) { cond.push("estado = ?"); params.push(estado); }
    const where = cond.length ? " WHERE " + cond.join(" AND ") : "";
    const total = (await fila<{ n: number }>(c.env.DB_PLATAFORMA, `SELECT COUNT(*) AS n FROM erratas${where}`, params))!.n;
    const items = await filas<Fila>(c.env.DB_PLATAFORMA, `SELECT ${COLS} FROM erratas${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { total, limit, offset, items: items.map(salida) };
  }
}
export class ErrataDetalle extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "errata_detalle", summary: "Una errata por su id",
    request: { params: z.object({ id: z.number().int() }) },
    responses: { "200": { description: "Errata.", ...contentJson(Errata) }, ...E404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) { return salida(await porId(c, enteroRuta(c.req.param("id") ?? "", "id"))); }
}
const Reporte = z.object({ dataset: z.string().min(1).max(40), tabla: z.string().max(80).optional(), registro: z.string().max(200).optional(), campo: z.string().max(80).optional(), valor_observado: z.string().max(500).optional(), valor_propuesto: z.string().max(500).optional(), fuente: z.string().max(500).optional(), comentario: z.string().min(10).max(2000) });
export class ErrataReportar extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "errata_reportar", summary: "Reportar un posible error en un dato oficial (requiere login)", security: SEGURIDAD,
    description: "Crea un reporte en estado `pendiente`. `dataset` debe ser una clave del catálogo (`/api/v1/catalogo/datasets`); `tabla`, `registro` (llave o id) y `campo` ubican el dato; `valor_observado` y `valor_propuesto` documentan la discrepancia; `fuente` es la publicación oficial que la respalda. Se guarda con el usuario del JWT y la fecha. No modifica ningún dato publicado.",
    request: { body: contentJson(Reporte) },
    responses: { "201": { description: "Errata registrada.", ...contentJson(Errata) }, ...RESP_401, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const u = await usuarioActual(c);
    const b = validar(Reporte, await c.req.json().catch(() => ({})));
    if (!DATASETS.some((d) => d.clave === b.dataset)) throw new ErrorHttp(422, [{ type: "literal_error", loc: ["body", "dataset"], msg: `Input should be one of: ${DATASETS.map((d) => d.clave).join(", ")}`, input: b.dataset } satisfies Detalle]);
    const r = await c.env.DB_PLATAFORMA.prepare("INSERT INTO erratas (dataset, tabla, registro, campo, valor_observado, valor_propuesto, fuente, comentario, estado, reportado_por, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)")
      .bind(b.dataset, b.tabla ?? null, b.registro ?? null, b.campo ?? null, b.valor_observado ?? null, b.valor_propuesto ?? null, b.fuente ?? null, b.comentario, u.username, ahoraPg()).run();
    return c.json(salida(await porId(c, r.meta.last_row_id as number)), 201);
  }
}
const Revision = z.object({ estado: z.enum(["aceptada", "rechazada", "pendiente"]), nota_revision: z.string().min(5).max(2000) });
export class ErrataRevisar extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "errata_revisar", summary: "Revisar una errata: aceptarla o rechazarla (admin)", security: SEGURIDAD,
    description: "Cambia el estado y registra la nota de revisión, el revisor y la fecha. Aceptar una errata no altera el dato publicado: obliga a documentarla y a corregirla en la siguiente edición cargada, con su verificación. Requiere JWT admin.",
    request: { params: z.object({ id: z.number().int() }), body: contentJson(Revision) },
    responses: { "200": { description: "Errata revisada.", ...contentJson(Errata) }, ...RESP_401, ...RESP_403, ...E404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const u = await requiereAdmin(c); const id = enteroRuta(c.req.param("id") ?? "", "id"); await porId(c, id);
    const b = validar(Revision, await c.req.json().catch(() => ({})));
    await c.env.DB_PLATAFORMA.prepare("UPDATE erratas SET estado = ?, nota_revision = ?, revisado_por = ?, revisado_en = ? WHERE id = ?").bind(b.estado, b.nota_revision, u.username, ahoraPg(), id).run();
    return salida(await porId(c, id));
  }
}
export class ErrataBorrar extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "errata_borrar", summary: "Retirar un reporte (admin)", security: SEGURIDAD,
    description: "Elimina un reporte (por ejemplo, duplicado o sin contenido). Requiere JWT admin. Devuelve 204 sin cuerpo.",
    request: { params: z.object({ id: z.number().int() }) },
    responses: { "204": { description: "Errata eliminada (sin body)." }, ...RESP_401, ...RESP_403, ...E404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    await requiereAdmin(c); const id = enteroRuta(c.req.param("id") ?? "", "id"); await porId(c, id);
    await c.env.DB_PLATAFORMA.prepare("DELETE FROM erratas WHERE id = ?").bind(id).run();
    return new Response(null, { status: 204 });
  }
}

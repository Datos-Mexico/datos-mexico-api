// Personas y nombramientos: solo los GET públicos del legacy (los POST/PUT/DELETE administrativos no se migran).
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { ErrorHttp } from "../lib/errores";
import { enteroOpcional } from "../lib/validacion";
import { dec2, enteroConDefault, enteroRuta, paginado, paginas } from "./comun";

const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const r429 = (n: number) => ({ "429": { description: `Rate limit excedido (${n} req/min por IP).`, ...contentJson(z.object({ detail: z.string() })) } });
const E404 = z.object({ detail: z.string() });
const NOTA = "Requiere JWT admin. El SDK Python `datos-mexico` no expone este endpoint por ser operacional, no analítico.";

const PersonaResponse = z.object({ id: z.number().int(), nombre: z.string(), apellido_1: z.string(), apellido_2: z.string().nullable().default(null), sexo_id: z.number().int().nullable().default(null), edad: z.number().int().nullable().default(null) });
const COLS_P = "id, nombre, apellido_1, apellido_2, sexo_id, edad";
export class PersonasLista extends OpenAPIRoute {
  schema = {
    tags: ["personas"], operationId: "list_personas_api_v1_personas__get", summary: "Listar personas del padrón con paginación y búsqueda",
    description: `[Uso interno administrativo] Lista paginada de personas del padrón CDMX. Soporta filtros por \`nombre\` (ILIKE sobre nombre, apellido_1 y apellido_2 simultáneamente) y \`sexo_id\`. ${NOTA}`,
    request: { query: z.object({ page: z.number().int().min(1).default(1), per_page: z.number().int().min(1).max(200).default(50), nombre: z.string().optional(), sexo_id: z.number().int().optional() }) },
    responses: { ...ok("Página de personas.", paginado(PersonaResponse)), ...r429(30) },
  };
  async handle(c: AppContext) {
    const page = enteroConDefault(c.req.query("page"), "page", 1, 1), per_page = enteroConDefault(c.req.query("per_page"), "per_page", 50, 1, 200);
    const nombre = c.req.query("nombre"), sexo_id = enteroOpcional(c.req.query("sexo_id"), "sexo_id");
    const w: string[] = []; const params: unknown[] = [];
    if (nombre) { params.push(`%${nombre}%`); const i = params.length; w.push(`(lower(nombre) LIKE lower(?${i}) OR lower(apellido_1) LIKE lower(?${i}) OR lower(apellido_2) LIKE lower(?${i}))`); }
    if (sexo_id !== null) { params.push(sexo_id); w.push(`sexo_id = ?${params.length}`); }
    const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
    const total = (await fila<{ n: number }>(c.env.DB_CDMX, `SELECT count(id) AS n FROM personas ${where}`, params))!.n;
    const data = await filas(c.env.DB_CDMX, `SELECT ${COLS_P} FROM personas ${where} ORDER BY id LIMIT ${per_page} OFFSET ${(page - 1) * per_page}`, params);
    return { data, total, page, per_page, pages: paginas(total, per_page) };
  }
}
export class PersonaDetalle extends OpenAPIRoute {
  schema = {
    tags: ["personas"], operationId: "get_persona_api_v1_personas__persona_id__get", summary: "Detalle de una persona por ID",
    description: `[Uso interno administrativo] Detalle de una persona del padrón por su ID numérico. ${NOTA}`,
    request: { params: z.object({ persona_id: z.number().int() }) },
    responses: { ...ok("Detalle de persona.", PersonaResponse), "404": { description: "`persona_id` no existe.", ...contentJson(E404) }, ...r429(60) },
  };
  async handle(c: AppContext) {
    const r = await fila(c.env.DB_CDMX, `SELECT ${COLS_P} FROM personas WHERE id = ?1`, [enteroRuta(c.req.param("persona_id") ?? "", "persona_id")]);
    if (!r) throw new ErrorHttp(404, "Persona no encontrada");
    return r;
  }
}

const NombramientoResponse = z.object({ id: z.number().int(), persona_id: z.number().int(), puesto_id: z.number().int().nullable().default(null), sector_id: z.number().int().nullable().default(null), tipo_nomina_id: z.number().int().nullable().default(null), tipo_contratacion_id: z.number().int().nullable().default(null), tipo_personal_id: z.number().int().nullable().default(null), universo_id: z.number().int().nullable().default(null), nivel_salarial_id: z.number().int().nullable().default(null), fecha_ingreso: z.string().nullable().default(null), sueldo_bruto: z.string().nullable().default(null), sueldo_neto: z.string().nullable().default(null) });
const COLS_N = "id, persona_id, puesto_id, sector_id, tipo_nomina_id, tipo_contratacion_id, tipo_personal_id, universo_id, nivel_salarial_id, fecha_ingreso, sueldo_bruto, sueldo_neto";
const conDecimales = (r: Record<string, unknown>) => ({ ...r, sueldo_bruto: dec2(r.sueldo_bruto as number | null), sueldo_neto: dec2(r.sueldo_neto as number | null) });
export class NombramientosLista extends OpenAPIRoute {
  schema = {
    tags: ["nombramientos"], operationId: "list_nombramientos_api_v1_nombramientos__get", summary: "Listar nombramientos con paginación y filtros",
    description: `[Uso interno administrativo] Lista paginada de nombramientos. Soporta filtros por \`persona_id\` y \`sector_id\`. ${NOTA}`,
    request: { query: z.object({ page: z.number().int().min(1).default(1), per_page: z.number().int().min(1).max(200).default(50), persona_id: z.number().int().optional(), sector_id: z.number().int().optional() }) },
    responses: { ...ok("Página de nombramientos.", paginado(NombramientoResponse)), ...r429(30) },
  };
  async handle(c: AppContext) {
    const page = enteroConDefault(c.req.query("page"), "page", 1, 1), per_page = enteroConDefault(c.req.query("per_page"), "per_page", 50, 1, 200);
    const persona_id = enteroOpcional(c.req.query("persona_id"), "persona_id"), sector_id = enteroOpcional(c.req.query("sector_id"), "sector_id");
    const w: string[] = []; const params: unknown[] = [];
    if (persona_id !== null) { params.push(persona_id); w.push(`persona_id = ?${params.length}`); }
    if (sector_id !== null) { params.push(sector_id); w.push(`sector_id = ?${params.length}`); }
    const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
    const total = (await fila<{ n: number }>(c.env.DB_CDMX, `SELECT count(id) AS n FROM nombramientos ${where}`, params))!.n;
    const data = await filas<Record<string, unknown>>(c.env.DB_CDMX, `SELECT ${COLS_N} FROM nombramientos ${where} ORDER BY id LIMIT ${per_page} OFFSET ${(page - 1) * per_page}`, params);
    return { data: data.map(conDecimales), total, page, per_page, pages: paginas(total, per_page) };
  }
}
export class NombramientoDetalle extends OpenAPIRoute {
  schema = {
    tags: ["nombramientos"], operationId: "get_nombramiento_api_v1_nombramientos__nombramiento_id__get", summary: "Detalle de un nombramiento por ID",
    description: `[Uso interno administrativo] Detalle de un nombramiento por su ID numérico. ${NOTA}`,
    request: { params: z.object({ nombramiento_id: z.number().int() }) },
    responses: { ...ok("Detalle de nombramiento.", NombramientoResponse), "404": { description: "`nombramiento_id` no existe.", ...contentJson(E404) }, ...r429(60) },
  };
  async handle(c: AppContext) {
    const r = await fila<Record<string, unknown>>(c.env.DB_CDMX, `SELECT ${COLS_N} FROM nombramientos WHERE id = ?1`, [enteroRuta(c.req.param("nombramiento_id") ?? "", "nombramiento_id")]);
    if (!r) throw new ErrorHttp(404, "Nombramiento no encontrado");
    return conDecimales(r);
  }
}

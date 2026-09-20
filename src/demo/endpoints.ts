// Demo del curso Bases de Datos (ITAM, sección 001) — la misma tabla pedagógica del legacy (demo.curso_bd),
// ahora demo_curso_bd en la D1 datosmexico-api-plataforma. GET públicos; el toggle del bono pide login;
// las altas, ediciones, bajas y el reinicio piden admin. Aislado de las bases oficiales del observatorio.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { ErrorHttp } from "../lib/errores";
import { RESP_401, RESP_403, SEGURIDAD, requiereAdmin, usuarioActual } from "../lib/auth";
import type { Detalle } from "../lib/validacion";
import { enteroRuta } from "../cdmx/comun";

const PUBLICO = ["demo"]; const ADMIN = ["demo-admin"];
export const BONO_MXN = 50_000;
const r429 = (n: number) => ({ "429": { description: `Rate limit excedido (${n} req/min por IP).`, ...contentJson(z.object({ detail: z.string() })) } });
const E404 = { "404": { description: "Registro inexistente.", ...contentJson(z.object({ detail: z.string() })) } };
const RESP_422 = { "422": { description: "Validation Error", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };

// Postgres guardaba timestamptz ('2026-04-27 18:03:34.123123+00'); se responde como Pydantic: '2026-04-27T18:03:34.123123Z'.
export const isoZ = (t: string) => { const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?/.exec(t); return m ? `${m[1]}T${m[2]}${m[3] ? m[3].padEnd(7, "0").slice(0, 7) : ""}Z` : t; };
export const ahoraPg = () => new Date().toISOString().replace("T", " ").replace("Z", "000+00");
const dec2 = (v: number) => Number(v).toFixed(2);
const COLS = "id, nombre_completo, rol, tipo, seccion, sueldo_diario_mxn, reclamar_bono, fecha_creacion, fecha_actualizacion";
const ORDEN = "ORDER BY CASE tipo WHEN 'profesor' THEN 1 WHEN 'equipo' THEN 2 ELSE 3 END, sueldo_diario_mxn DESC, nombre_completo";
type Fila = { id: number; nombre_completo: string; rol: string; tipo: string; seccion: string; sueldo_diario_mxn: number; reclamar_bono: number; fecha_creacion: string; fecha_actualizacion: string };
const salida = (r: Fila) => ({ id: r.id, nombre_completo: r.nombre_completo, rol: r.rol, tipo: r.tipo, seccion: r.seccion, sueldo_diario_mxn: dec2(r.sueldo_diario_mxn), reclamar_bono: !!r.reclamar_bono, fecha_creacion: isoZ(r.fecha_creacion), fecha_actualizacion: isoZ(r.fecha_actualizacion) });
const EstudianteRow = z.object({ id: z.number().int(), nombre_completo: z.string(), rol: z.enum(["estudiante", "profesor"]), tipo: z.enum(["profesor", "equipo", "estudiante"]), seccion: z.string(), sueldo_diario_mxn: z.string(), reclamar_bono: z.boolean(), fecha_creacion: z.string(), fecha_actualizacion: z.string() });
const EJEMPLO = { id: 7, nombre_completo: "Alumna Apellido", rol: "Estudiante", tipo: "estudiante", seccion: "BASES DE DATOS - 001", sueldo_diario_mxn: "250.00", reclamar_bono: false, fecha_creacion: "2026-04-30T19:00:00Z", fecha_actualizacion: "2026-04-30T19:00:00Z" };

async function porId(c: AppContext, id: number): Promise<Fila> {
  const r = await fila<Fila>(c.env.DB_PLATAFORMA, `SELECT ${COLS} FROM demo_curso_bd WHERE id = ?`, [id]);
  if (!r) throw new ErrorHttp(404, `id=${id} no encontrado`);
  return r;
}

export class DemoEstudiantes extends OpenAPIRoute {
  schema = {
    tags: PUBLICO, operationId: "list_estudiantes_api_v1_demo_estudiantes_get", summary: "Lista del curso ITAM Bases de Datos sección 001",
    description: "Retorna las 12 personas del curso (1 profesor + 4 equipo + 7 estudiantes) con sueldo diario, tipo, y estado actual de `reclamar_bono`. Lectura pública sin auth. Orden: profesor → equipo (por sueldo desc) → estudiantes (por sueldo desc).",
    responses: { "200": { description: "Lista completa con los 12 registros.", ...contentJson(z.object({ count: z.number().int(), estudiantes: z.array(EstudianteRow), seccion: z.string(), fuente: z.string() })) }, ...r429(60) },
  };
  async handle(c: AppContext) {
    const rows = await filas<Fila>(c.env.DB_PLATAFORMA, `SELECT ${COLS} FROM demo_curso_bd ${ORDEN}`);
    if (!rows.length) throw new ErrorHttp(500, "demo_curso_bd vacía");
    return { count: rows.length, estudiantes: rows.map(salida), seccion: rows[0].seccion, fuente: "demo_curso_bd (D1 datosmexico-api-plataforma)" };
  }
}
export class DemoEstudiante extends OpenAPIRoute {
  schema = {
    tags: PUBLICO, operationId: "get_estudiante_api_v1_demo_estudiantes__id__get", summary: "Detalle de una persona del curso",
    description: "Un registro de la tabla del curso por su `id`. Lectura pública sin auth.",
    request: { params: z.object({ id: z.number().int() }) },
    responses: { "200": { description: "Detalle del registro.", ...contentJson(EstudianteRow) }, ...E404, ...RESP_422, ...r429(120) },
  };
  async handle(c: AppContext) { return salida(await porId(c, enteroRuta(c.req.param("id") ?? "", "id"))); }
}
const Resumen = z.object({ total_empleados: z.number().int(), bonos_reclamados: z.number().int(), bono_unitario_mxn: z.number().int(), monto_distribuido_mxn: z.number().int(), monto_disponible_mxn: z.number().int(), monto_total_posible_mxn: z.number().int(), nomina_diaria_total_mxn: z.string(), fecha: z.string() });
export class DemoResumen extends OpenAPIRoute {
  schema = {
    tags: PUBLICO, operationId: "get_resumen_api_v1_demo_resumen_get", summary: "Agregados para la KPI bar del dashboard /demo",
    description: "Total de empleados, bonos reclamados (bono flat de $50,000 MXN por reclamación), montos distribuido, disponible y total posible, y nómina diaria total. Lectura pública sin auth.",
    responses: { "200": { description: "Agregados del curso.", ...contentJson(Resumen) }, ...r429(60) },
  };
  async handle(c: AppContext) {
    const r = (await fila<{ total: number; bonos: number; nomina: number }>(c.env.DB_PLATAFORMA, "SELECT COUNT(*) AS total, SUM(CASE WHEN reclamar_bono THEN 1 ELSE 0 END) AS bonos, COALESCE(SUM(sueldo_diario_mxn), 0) AS nomina FROM demo_curso_bd"))!;
    return { total_empleados: r.total, bonos_reclamados: r.bonos, bono_unitario_mxn: BONO_MXN, monto_distribuido_mxn: r.bonos * BONO_MXN, monto_disponible_mxn: (r.total - r.bonos) * BONO_MXN, monto_total_posible_mxn: r.total * BONO_MXN, nomina_diaria_total_mxn: dec2(r.nomina), fecha: new Date().toISOString().replace("Z", "") };
  }
}
export class DemoToggleBono extends OpenAPIRoute {
  schema = {
    tags: PUBLICO, operationId: "toggle_bono_api_v1_demo_estudiantes__id__toggle_bono_put", summary: "Toggle del campo reclamar_bono (requiere login)", security: SEGURIDAD,
    description: "Invierte `reclamar_bono` del registro y actualiza `fecha_actualizacion`. Requiere JWT de cualquier usuario activo (no hace falta admin): durante el checkpoint en vivo la cuenta `DemoAbril` se comparte entre estudiantes y profesor. Devuelve `actor_username` con el usuario del JWT.",
    request: { params: z.object({ id: z.number().int() }) },
    responses: { "200": { description: "Registro actualizado.", ...contentJson(z.object({ id: z.number().int(), nombre_completo: z.string(), reclamar_bono: z.boolean(), fecha_actualizacion: z.string(), actor_username: z.string() })) }, ...RESP_401, ...E404, ...RESP_422, ...r429(30) },
  };
  async handle(c: AppContext) {
    const u = await usuarioActual(c); const id = enteroRuta(c.req.param("id") ?? "", "id");
    const antes = await porId(c, id); const ahora = ahoraPg();
    await c.env.DB_PLATAFORMA.prepare("UPDATE demo_curso_bd SET reclamar_bono = NOT reclamar_bono, fecha_actualizacion = ? WHERE id = ?").bind(ahora, id).run();
    return { id, nombre_completo: antes.nombre_completo, reclamar_bono: !antes.reclamar_bono, fecha_actualizacion: isoZ(ahora), actor_username: u.username };
  }
}

// ---------------------------------------------------------------- admin
const Crear = z.object({ nombre_completo: z.string().min(2).max(120), rol: z.enum(["estudiante", "profesor"]).default("estudiante"), tipo: z.enum(["profesor", "equipo", "estudiante"]).default("estudiante"), seccion: z.string().max(40).nullable().optional(), sueldo_diario_mxn: z.number().min(0).default(0) });
const Editar = z.object({ nombre_completo: z.string().min(2).max(120).optional(), rol: z.enum(["estudiante", "profesor"]).optional(), tipo: z.enum(["profesor", "equipo", "estudiante"]).optional(), seccion: z.string().max(40).optional(), sueldo_diario_mxn: z.number().min(0).optional(), reclamar_bono: z.boolean().optional() });
function validar<T>(esquema: z.ZodType<T>, cuerpo: unknown): T {
  const r = esquema.safeParse(cuerpo);
  if (r.success) return r.data;
  throw new ErrorHttp(422, r.error.issues.map((i) => ({ type: i.code === "invalid_type" && i.message.includes("received undefined") ? "missing" : i.code, loc: ["body", ...i.path.map(String)], msg: i.code === "invalid_type" && i.message.includes("received undefined") ? "Field required" : i.message, input: cuerpo } satisfies Detalle)));
}
export class DemoCrear extends OpenAPIRoute {
  schema = {
    tags: ADMIN, operationId: "crear_estudiante_api_v1_admin_demo_estudiantes_post", summary: "Crear un nuevo registro en demo.curso_bd (admin)", security: SEGURIDAD,
    description: "Inserta una persona en la tabla del curso. `seccion` hereda 'BASES DE DATOS - 001' si se omite; `sueldo_diario_mxn` ≥ 0 con dos decimales. Requiere JWT admin.",
    request: { body: contentJson(Crear) },
    responses: { "201": { description: "Registro creado.", ...contentJson(EstudianteRow) }, ...RESP_401, ...RESP_403, "409": { description: "Ya existe un registro con ese nombre completo.", ...contentJson(z.object({ detail: z.string() })) }, ...RESP_422, ...r429(20) },
  };
  async handle(c: AppContext) {
    await requiereAdmin(c);
    const b = validar(Crear, await c.req.json().catch(() => ({})));
    const dup = await fila<{ n: number }>(c.env.DB_PLATAFORMA, "SELECT COUNT(*) AS n FROM demo_curso_bd WHERE nombre_completo = ?", [b.nombre_completo]);
    if (dup && dup.n > 0) throw new ErrorHttp(409, `nombre_completo '${b.nombre_completo}' ya existe`);
    const ahora = ahoraPg();
    const r = await c.env.DB_PLATAFORMA.prepare("INSERT INTO demo_curso_bd (nombre_completo, rol, tipo, seccion, sueldo_diario_mxn, reclamar_bono, fecha_creacion, fecha_actualizacion) VALUES (?, ?, ?, COALESCE(?, 'BASES DE DATOS - 001'), ?, 0, ?, ?)").bind(b.nombre_completo, b.rol, b.tipo, b.seccion ?? null, b.sueldo_diario_mxn, ahora, ahora).run();
    return c.json(salida(await porId(c, r.meta.last_row_id as number)), 201);
  }
}
export class DemoEditar extends OpenAPIRoute {
  schema = {
    tags: ADMIN, operationId: "editar_estudiante_api_v1_admin_demo_estudiantes__id__put", summary: "Editar campos de un registro (admin)", security: SEGURIDAD,
    description: "Actualiza solo los campos enviados (nombre, rol, tipo, sección, sueldo, reclamar_bono) y `fecha_actualizacion`. Requiere JWT admin.",
    request: { params: z.object({ id: z.number().int() }), body: contentJson(Editar) },
    responses: { "200": { description: "Registro actualizado.", ...contentJson(EstudianteRow) }, ...RESP_401, ...RESP_403, ...E404, ...RESP_422, ...r429(20) },
  };
  async handle(c: AppContext) {
    await requiereAdmin(c); const id = enteroRuta(c.req.param("id") ?? "", "id"); await porId(c, id);
    const b = validar(Editar, await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const campos = Object.keys(b).filter((k) => b[k] !== undefined);
    if (campos.length) {
      const set = campos.map((k) => `${k} = ?`).join(", ");
      await c.env.DB_PLATAFORMA.prepare(`UPDATE demo_curso_bd SET ${set}, fecha_actualizacion = ? WHERE id = ?`).bind(...campos.map((k) => (typeof b[k] === "boolean" ? (b[k] ? 1 : 0) : b[k])), ahoraPg(), id).run();
    }
    return salida(await porId(c, id));
  }
}
export class DemoBorrar extends OpenAPIRoute {
  schema = {
    tags: ADMIN, operationId: "borrar_estudiante_api_v1_admin_demo_estudiantes__id__delete", summary: "Borrar un registro (admin)", security: SEGURIDAD,
    description: "Elimina un registro de la tabla del curso. Requiere JWT admin.",
    request: { params: z.object({ id: z.number().int() }) },
    responses: { "200": { description: "Registro eliminado.", ...contentJson(z.object({ id: z.number().int(), deleted: z.boolean() })) }, ...RESP_401, ...RESP_403, ...E404, ...RESP_422, ...r429(20) },
  };
  async handle(c: AppContext) {
    await requiereAdmin(c); const id = enteroRuta(c.req.param("id") ?? "", "id"); await porId(c, id);
    await c.env.DB_PLATAFORMA.prepare("DELETE FROM demo_curso_bd WHERE id = ?").bind(id).run();
    return { id, deleted: true };
  }
}
export class DemoReset extends OpenAPIRoute {
  schema = {
    tags: ADMIN, operationId: "reset_bonos_api_v1_admin_demo_reset_post", summary: "Resetear todos los reclamar_bono a FALSE (admin)", security: SEGURIDAD,
    description: "Pone `reclamar_bono` en falso en todos los registros que lo tenían en verdadero y devuelve cuántos cambió. Requiere JWT admin.",
    responses: { "200": { description: "Reinicio hecho.", ...contentJson(z.object({ filas_reseteadas: z.number().int(), fecha: z.string() })) }, ...RESP_401, ...RESP_403, ...r429(20) },
  };
  async handle(c: AppContext) {
    await requiereAdmin(c);
    const r = await c.env.DB_PLATAFORMA.prepare("UPDATE demo_curso_bd SET reclamar_bono = 0, fecha_actualizacion = ? WHERE reclamar_bono = 1").bind(ahoraPg()).run();
    return { filas_reseteadas: r.meta.changes ?? 0, fecha: new Date().toISOString().replace("Z", "") };
  }
}

// Banco de Indicadores del INEGI (BISE): todos los indicadores del catálogo CL_INDICATOR con sus
// observaciones a nivel nacional y por entidad federativa, descargados de la API del INEGI y
// guardados tal cual (valor original como texto) en la D1 datosmexico-api-bise.
// Endpoints nuevos (no existen en el legacy); la validación de parámetros sigue el formato 422 de FastAPI
// que usa el resto de la API.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import type { Detalle } from "../lib/validacion";
import { enteroOpcional, textoConPatron } from "../lib/validacion";

const TAG = ["inegi"];
const ok = (descripcion: string, esquema: z.ZodTypeAny) => ({ "200": { description: descripcion, ...contentJson(esquema) } });
const RESP_404 = { "404": { description: "No existe.", ...contentJson(z.object({ detail: z.string() })) } };
const RESP_422 = { "422": { description: "Parámetro inválido.", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };

const CATALOGOS = ["unidades", "frecuencias", "temas", "fuentes", "notas", "multiplicadores", "geografias"] as const;
type Catalogo = (typeof CATALOGOS)[number];

// ---------------------------------------------------------------- resumen
const Resumen = z.object({
  fuente: z.string(), fuente_url: z.string(),
  indicadores_catalogo: z.number().int(), indicadores_con_datos: z.number().int(), indicadores_sin_datos: z.number().int(),
  observaciones: z.number().int(), geografias: z.number().int(), cobertura_geografica: z.string(),
  primer_periodo: z.string().nullable(), ultimo_periodo: z.string().nullable(),
  ultima_actualizacion_inegi: z.string().nullable(), descargado_en: z.string().nullable(),
  catalogos: z.record(z.string(), z.number().int()),
});
export class InegiResumen extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_resumen", summary: "Cuántos indicadores del INEGI tenemos y hasta cuándo",
    description: "Resumen verificable del Banco de Indicadores del INEGI en el observatorio: indicadores del catálogo oficial, cuántos tienen observaciones a nivel nacional o estatal, total de observaciones, periodos extremos, fecha de la última actualización publicada por el INEGI y fecha de descarga. Los indicadores 'sin datos' existen en el catálogo del INEGI pero no tienen observaciones nacionales ni estatales (por ejemplo, series solo municipales).",
    responses: { ...ok("Resumen del Banco de Indicadores.", Resumen), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const db = c.env.DB_BISE;
    const ind = (await fila<{ n: number; con: number; obs: number; p1: string | null; p2: string | null; act: string | null; desc: string | null }>(db,
      "SELECT COUNT(*) AS n, SUM(con_datos) AS con, SUM(n_observaciones) AS obs, MIN(primer_periodo) AS p1, MAX(ultimo_periodo) AS p2, MAX(ultima_actualizacion) AS act, MAX(descargado_en) AS desc FROM indicadores"))!;
    const catalogos: Record<string, number> = {};
    for (const t of CATALOGOS) catalogos[t] = (await fila<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${t}`))!.n;
    return {
      fuente: "INEGI — Banco de Indicadores (API de indicadores, BISE 2.0)", fuente_url: "https://www.inegi.org.mx/servicios/api_indicadores.html",
      indicadores_catalogo: ind.n, indicadores_con_datos: ind.con, indicadores_sin_datos: ind.n - ind.con,
      observaciones: ind.obs, geografias: catalogos.geografias, cobertura_geografica: "nacional (00) y 32 entidades federativas (01-32)",
      primer_periodo: ind.p1, ultimo_periodo: ind.p2, ultima_actualizacion_inegi: ind.act, descargado_en: ind.desc, catalogos,
    };
  }
}

// ---------------------------------------------------------------- catálogos
const ItemCatalogo = z.object({ clave: z.string(), descripcion: z.string().nullable(), nivel: z.string().optional() });
export class InegiCatalogo extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_catalogo", summary: "Catálogo del INEGI (unidades, frecuencias, temas, fuentes, notas, multiplicadores, geografías)",
    description: "Contenido de un catálogo del Banco de Indicadores tal como lo publica el INEGI (CL_UNIT, CL_FREQ, CL_TOPIC, CL_SOURCE, CL_NOTE, CL_UNIT_MULT). El catálogo 'geografias' es el marco de esta fase: 00 nacional y 01-32 entidades. Filtro opcional `q` (contiene, sin distinguir mayúsculas).",
    request: { params: z.object({ catalogo: z.enum(CATALOGOS) }), query: z.object({ q: z.string().optional() }) },
    responses: { ...ok("Catálogo.", z.object({ catalogo: z.string(), n: z.number().int(), items: z.array(ItemCatalogo) })), ...RESP_404, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const cat = c.req.param("catalogo") ?? "";
    if (!(CATALOGOS as readonly string[]).includes(cat)) throw new ErrorHttp(404, `catálogo '${cat}' no existe. Válidos: ${CATALOGOS.join(", ")}`);
    const q = c.req.query("q");
    const t = cat as Catalogo;
    const desc = t === "geografias" ? "nombre" : "descripcion";
    const where = q ? ` WHERE ${desc} LIKE ? COLLATE NOCASE` : "";
    const sql = t === "geografias"
      ? `SELECT clave, nombre AS descripcion, nivel FROM geografias${where} ORDER BY clave`
      : `SELECT clave, descripcion FROM ${t}${where} ORDER BY CAST(clave AS INTEGER), clave`;
    const items = await filas<{ clave: string; descripcion: string | null; nivel?: string }>(c.env.DB_BISE, sql, q ? [`%${q}%`] : []);
    return { catalogo: t, n: items.length, items };
  }
}

// ---------------------------------------------------------------- indicadores (búsqueda)
const IndicadorResumen = z.object({
  id: z.string(), descripcion: z.string().nullable(), tema: z.string().nullable(), tema_descripcion: z.string().nullable(),
  frecuencia: z.string().nullable(), frecuencia_descripcion: z.string().nullable(), unidad: z.string().nullable(), unidad_descripcion: z.string().nullable(),
  con_datos: z.boolean(), n_observaciones: z.number().int(), n_geografias: z.number().int(), primer_periodo: z.string().nullable(), ultimo_periodo: z.string().nullable(), ultima_actualizacion: z.string().nullable(),
});
const SQL_IND = `SELECT i.id, i.descripcion, i.tema, t.descripcion AS tema_descripcion, i.frecuencia, f.descripcion AS frecuencia_descripcion, i.unidad, u.descripcion AS unidad_descripcion,
  i.con_datos, i.n_observaciones, i.n_geografias, i.primer_periodo, i.ultimo_periodo, i.ultima_actualizacion
  FROM indicadores i LEFT JOIN temas t ON t.clave = i.tema LEFT JOIN frecuencias f ON f.clave = i.frecuencia LEFT JOIN unidades u ON u.clave = i.unidad`;
type FilaInd = { id: string; descripcion: string | null; tema: string | null; tema_descripcion: string | null; frecuencia: string | null; frecuencia_descripcion: string | null; unidad: string | null; unidad_descripcion: string | null; con_datos: number; n_observaciones: number; n_geografias: number; primer_periodo: string | null; ultimo_periodo: string | null; ultima_actualizacion: string | null };
const aResumen = (r: FilaInd) => ({ ...r, con_datos: r.con_datos === 1 });

function bandera(valor: string | undefined, nombre: string): boolean | null {
  if (valor === undefined) return null;
  const v = valor.toLowerCase();
  if (["true", "1", "yes", "on", "t", "y"].includes(v)) return true;
  if (["false", "0", "no", "off", "f", "n"].includes(v)) return false;
  throw new ErrorHttp(422, [{ type: "bool_parsing", loc: ["query", nombre], msg: "Input should be a valid boolean, unable to interpret input", input: valor } satisfies Detalle]);
}

export class InegiIndicadores extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_indicadores", summary: "Buscar indicadores del INEGI",
    description: "Busca en los 31,817 indicadores del catálogo del Banco de Indicadores. `q` busca (contiene, sin distinguir mayúsculas) en la descripción del indicador y en la de su tema; el INEGI publica nombres cortos ('Total', 'Mujeres'), por lo que el tema es la forma de ubicarlos. Filtros exactos por `tema`, `frecuencia` y `unidad` (claves de los catálogos) y `con_datos`. Paginado con `limit` (1-500) y `offset`.",
    request: { query: z.object({ q: z.string().optional(), tema: z.string().optional(), frecuencia: z.string().optional(), unidad: z.string().optional(), con_datos: z.boolean().optional(), limit: z.number().int().min(1).max(500).default(50).optional(), offset: z.number().int().min(0).default(0).optional() }) },
    responses: { ...ok("Indicadores que cumplen los filtros.", z.object({ total: z.number().int(), limit: z.number().int(), offset: z.number().int(), items: z.array(IndicadorResumen) })), ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = c.req.query("q"); const tema = textoConPatron(c.req.query("tema"), "tema", "^\\d+$"); const frecuencia = textoConPatron(c.req.query("frecuencia"), "frecuencia", "^\\d+$"); const unidad = textoConPatron(c.req.query("unidad"), "unidad", "^\\d+$");
    const conDatos = bandera(c.req.query("con_datos"), "con_datos");
    const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 500) ?? 50; const offset = enteroOpcional(c.req.query("offset"), "offset", 0) ?? 0;
    const cond: string[] = []; const params: unknown[] = [];
    if (q) { cond.push("(i.descripcion LIKE ? COLLATE NOCASE OR t.descripcion LIKE ? COLLATE NOCASE)"); params.push(`%${q}%`, `%${q}%`); }
    if (tema) { cond.push("i.tema = ?"); params.push(tema); }
    if (frecuencia) { cond.push("i.frecuencia = ?"); params.push(frecuencia); }
    if (unidad) { cond.push("i.unidad = ?"); params.push(unidad); }
    if (conDatos !== null) { cond.push("i.con_datos = ?"); params.push(conDatos ? 1 : 0); }
    const where = cond.length ? " WHERE " + cond.join(" AND ") : "";
    const total = (await fila<{ n: number }>(c.env.DB_BISE, `SELECT COUNT(*) AS n FROM indicadores i LEFT JOIN temas t ON t.clave = i.tema${where}`, params))!.n;
    const items = await filas<FilaInd>(c.env.DB_BISE, `${SQL_IND}${where} ORDER BY CAST(i.id AS INTEGER), i.id LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { total, limit, offset, items: items.map(aResumen) };
  }
}

// ---------------------------------------------------------------- indicador (ficha)
const Ficha = IndicadorResumen.extend({
  multiplicador: z.string().nullable(), multiplicador_descripcion: z.string().nullable(), nota: z.string().nullable(), nota_descripcion: z.string().nullable(),
  fuentes: z.array(z.object({ clave: z.string(), descripcion: z.string().nullable() })), estatus: z.string().nullable(), ultima_actualizacion_texto: z.string().nullable(), descargado_en: z.string().nullable(),
  geografias: z.array(z.object({ clave: z.string(), nombre: z.string(), n_observaciones: z.number().int() })), observaciones_url: z.string(),
});
async function indicadorOr404(c: AppContext, id: string) {
  const r = await fila<FilaInd & { multiplicador: string | null; nota: string | null; fuentes: string | null; estatus: string | null; ultima_actualizacion_texto: string | null; descargado_en: string | null }>(c.env.DB_BISE,
    `${SQL_IND.replace("i.ultima_actualizacion", "i.ultima_actualizacion, i.multiplicador, i.nota, i.fuentes, i.estatus, i.ultima_actualizacion_texto, i.descargado_en")} WHERE i.id = ?`, [id]);
  if (!r) throw new ErrorHttp(404, `indicador '${id}' no existe en el catálogo del INEGI`);
  return r;
}
export class InegiIndicador extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_indicador", summary: "Ficha de un indicador del INEGI",
    description: "Metadatos completos de un indicador: descripción, tema, frecuencia, unidad, multiplicador, nota metodológica, fuentes, estatus y última actualización publicada por el INEGI, más las geografías para las que hay observaciones y el enlace a la serie.",
    request: { params: z.object({ id: z.string() }) },
    responses: { ...ok("Ficha del indicador.", Ficha), ...RESP_404, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const id = c.req.param("id") ?? "";
    const r = await indicadorOr404(c, id);
    const db = c.env.DB_BISE;
    const claves = (r.fuentes ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const fuentes = [];
    for (const k of claves) fuentes.push({ clave: k, descripcion: (await fila<{ d: string | null }>(db, "SELECT descripcion AS d FROM fuentes WHERE clave = ?", [k]))?.d ?? null });
    const mult = r.multiplicador ? (await fila<{ d: string | null }>(db, "SELECT descripcion AS d FROM multiplicadores WHERE clave = ?", [r.multiplicador]))?.d ?? null : null;
    const nota = r.nota ? (await fila<{ d: string | null }>(db, "SELECT descripcion AS d FROM notas WHERE clave = ?", [r.nota]))?.d ?? null : null;
    const geografias = await filas<{ clave: string; nombre: string; n_observaciones: number }>(db, "SELECT o.geografia AS clave, g.nombre, COUNT(*) AS n_observaciones FROM observaciones o JOIN geografias g ON g.clave = o.geografia WHERE o.indicador = ? GROUP BY o.geografia ORDER BY o.geografia", [id]);
    const { multiplicador, nota: _n, fuentes: _f, estatus, ultima_actualizacion_texto, descargado_en, ...base } = r;
    return { ...aResumen(base), multiplicador, multiplicador_descripcion: mult, nota: r.nota, nota_descripcion: nota, fuentes, estatus, ultima_actualizacion_texto, descargado_en, geografias, observaciones_url: `/api/v1/inegi/indicadores/${id}/observaciones` };
  }
}

// ---------------------------------------------------------------- observaciones (serie)
const Observacion = z.object({ geografia: z.string(), periodo: z.string(), valor: z.number().nullable(), valor_texto: z.string().nullable(), excepcion: z.string().nullable(), estatus: z.string().nullable(), fuente: z.string().nullable(), nota: z.string().nullable() });
export class InegiObservaciones extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_observaciones", summary: "Serie de un indicador del INEGI",
    description: "Observaciones de un indicador tal como las publica el INEGI: `valor` es el número y `valor_texto` el decimal original exacto (sin ceros a la derecha). `geografia` filtra por clave (00 nacional, 01-32 entidades); sin ella se devuelven todas las geografías. `desde` y `hasta` acotan el periodo por comparación de texto en el formato del INEGI ('2020', '2020/01', '2020/02'...). Orden: geografía y periodo ascendentes. Paginado con `limit` (1-5000) y `offset`.",
    request: { params: z.object({ id: z.string() }), query: z.object({ geografia: z.string().regex(/^\d{2}$/).optional(), desde: z.string().optional(), hasta: z.string().optional(), limit: z.number().int().min(1).max(5000).default(1000).optional(), offset: z.number().int().min(0).default(0).optional() }) },
    responses: { ...ok("Observaciones del indicador.", z.object({ indicador: z.string(), descripcion: z.string().nullable(), frecuencia: z.string().nullable(), unidad: z.string().nullable(), total: z.number().int(), limit: z.number().int(), offset: z.number().int(), observaciones: z.array(Observacion) })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const id = c.req.param("id") ?? "";
    const geografia = textoConPatron(c.req.query("geografia"), "geografia", "^\\d{2}$");
    const desde = c.req.query("desde") ?? null; const hasta = c.req.query("hasta") ?? null;
    const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 5000) ?? 1000; const offset = enteroOpcional(c.req.query("offset"), "offset", 0) ?? 0;
    const r = await indicadorOr404(c, id);
    const cond = ["indicador = ?"]; const params: unknown[] = [id];
    if (geografia) { cond.push("geografia = ?"); params.push(geografia); }
    if (desde) { cond.push("periodo >= ?"); params.push(desde); }
    if (hasta) { cond.push("periodo <= ?"); params.push(hasta); }
    const where = " WHERE " + cond.join(" AND ");
    const total = (await fila<{ n: number }>(c.env.DB_BISE, `SELECT COUNT(*) AS n FROM observaciones${where}`, params))!.n;
    const observaciones = await filas<z.infer<typeof Observacion>>(c.env.DB_BISE, `SELECT geografia, periodo, valor, valor_texto, excepcion, estatus, fuente, nota FROM observaciones${where} ORDER BY geografia, periodo LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { indicador: id, descripcion: r.descripcion, frecuencia: r.frecuencia_descripcion, unidad: r.unidad_descripcion, total, limit, offset, observaciones };
  }
}

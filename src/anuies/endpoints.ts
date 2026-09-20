// Anuario Estadístico de Educación Superior (ANUIES): todas las instituciones, 2000-2001 a 2025-2026, programa por programa.
// Fuente: https://anuario.anuies.mx/ (consulta interactiva del anuario; descarga íntegra por ciclo, conciliada contra el
// agregado nacional que el mismo servicio devuelve). D1 datosmexico-api-anuies; Parquet por ciclo en R2 (anuies/anuario/).
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import type { Detalle } from "../lib/validacion";
import { enteroOpcional, textoConPatron } from "../lib/validacion";
import { CICLO, CIFRAS, CLAVE, DIMENSIONES, FILTROS, agregado, condiciones, edades, institucionOr404, literalError, porParam, procedencia, resolverCiclo, serie } from "./consultas";

const TAG = ["anuies"];
const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const RESP_404 = { "404": { description: "No existe.", ...contentJson(z.object({ detail: z.string() })) } };
const RESP_422 = { "422": { description: "Parámetro inválido.", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };
const N = z.number().int().nullable();
const Cifras = Object.fromEntries(CIFRAS.map((k) => [k, N])) as Record<(typeof CIFRAS)[number], typeof N>;
const Ciclo = z.object({ ciclo: z.string(), filas: z.number().int(), paginas: z.number().int(), descargado_en: z.string(), conciliacion: z.string(), mat_total: N, ni: N, e: N, lo_real: N, t: N, sni: N, edad_filas: z.number().int(), procedencia_filas: z.number().int(), instituciones: z.number().int(), sha256: z.string(), bytes: z.number().int(), parquet_clave: z.string().nullable(), parquet_bytes: N, parquet_url: z.string().nullable() });
const Institucion = z.object({ clave: z.string(), nombre: z.string(), sostenimiento: z.string().nullable(), clasificacion: z.string().nullable(), primer_ciclo: z.string(), ultimo_ciclo: z.string(), ciclos: z.number().int(), entidades: z.number().int(), escuelas: z.number().int(), programas: z.number().int(), mat_total: z.number().int(), ni: z.number().int(), e: z.number().int(), t: z.number().int() });
const Serie = z.object({ ciclo: z.string(), programas: z.number().int(), escuelas: z.number().int(), instituciones: z.number().int(), ...Cifras });
const Grupo = z.object({ valor: z.string().nullable(), programas: z.number().int(), ...Cifras });
const FiltrosQuery = { ciclo: z.string().optional(), entidad: z.string().optional(), sostenimiento: z.string().optional(), clasificacion: z.string().optional(), escuela: z.string().optional(), nivel: z.string().optional(), modalidad: z.string().optional(), campo_amplio: z.string().optional(), campo_especifico: z.string().optional(), campo_detallado: z.string().optional(), carrera: z.string().optional(), q: z.string().optional() };
const NOTA_FILTROS = "Los filtros (`entidad`, `sostenimiento`, `clasificacion`, `escuela`, `nivel`, `modalidad`, `campo_amplio`, `campo_especifico`, `campo_detallado`, `carrera`) son valores exactos tal como los escribe ANUIES (en mayúsculas; los campos de formación con mayúscula inicial); `q` busca por contenido en carrera y escuela. Los valores válidos de cada dimensión están en `/api/v1/anuies/valores`.";
const parquetUrl = (k: string | null) => (k ? `/api/v1/anuies/descarga/${k}` : null);
const conUrl = (r: Record<string, unknown>): Record<string, unknown> => ({ ...r, parquet_url: parquetUrl(r.parquet_clave as string | null) });

export class AnuiesResumen extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "anuies_resumen", summary: "Qué tenemos del Anuario ANUIES",
    description: "Resumen verificable: ciclos cargados con sus filas, instituciones y totales nacionales (matrícula, nuevo ingreso, egresados, lugares ofertados, titulados y solicitudes), la conciliación de cada ciclo contra el agregado nacional del propio servicio de ANUIES, y las 167 cifras disponibles por programa. Fuente: anuario.anuies.mx.",
    responses: { ...ok("Resumen.", z.object({ fuente: z.string(), fuente_url: z.string(), ciclos: z.number().int(), primer_ciclo: z.string().nullable(), ultimo_ciclo: z.string().nullable(), filas: z.number().int(), instituciones: z.number().int(), cifras_por_programa: z.number().int(), dimensiones: z.array(z.string()), por_ciclo: z.array(Ciclo) })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const db = c.env.DB_ANUIES;
    const por_ciclo = (await filas<Record<string, unknown>>(db, "SELECT * FROM ciclos ORDER BY ciclo")).map(conUrl);
    const inst = (await fila<{ n: number }>(db, "SELECT COUNT(*) AS n FROM instituciones"))!.n;
    const cols = (await fila<{ n: number }>(db, "SELECT COUNT(*) AS n FROM columnas"))!.n;
    return { fuente: "ANUIES — Anuario Estadístico de Educación Superior", fuente_url: "https://anuario.anuies.mx/", ciclos: por_ciclo.length, primer_ciclo: (por_ciclo[0]?.ciclo as string) ?? null, ultimo_ciclo: (por_ciclo.at(-1)?.ciclo as string) ?? null, filas: por_ciclo.reduce((s, r) => s + (r.filas as number), 0), instituciones: inst, cifras_por_programa: cols, dimensiones: [...DIMENSIONES], por_ciclo };
  }
}

export class AnuiesCiclos extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "anuies_ciclos", summary: "Ciclos cargados", description: "Un registro por ciclo escolar con filas, totales nacionales, conciliación, huella del origen y el Parquet descargable.", responses: { ...ok("Ciclos.", z.object({ n: z.number().int(), items: z.array(Ciclo) })), ...RESP_429 } };
  async handle(c: AppContext) { const items = (await filas<Record<string, unknown>>(c.env.DB_ANUIES, "SELECT * FROM ciclos ORDER BY ciclo")).map(conUrl); return { n: items.length, items }; }
}

export class AnuiesColumnas extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "anuies_columnas", summary: "Las 167 cifras por programa y qué significan", description: "Clave (la de ANUIES en minúsculas), título, grupo (total, sexo, edad, disc, hli, procedencia) y en qué tabla vive (programas, programas_edad, programas_procedencia).", responses: { ...ok("Columnas.", z.object({ n: z.number().int(), items: z.array(z.object({ clave: z.string(), titulo: z.string(), grupo: z.string(), tabla: z.string() })) })), ...RESP_429 } };
  async handle(c: AppContext) { const items = await filas(c.env.DB_ANUIES, "SELECT clave, titulo, grupo, tabla FROM columnas ORDER BY rowid"); return { n: items.length, items }; }
}

export class AnuiesValores extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "anuies_valores", summary: "Valores distintos de una dimensión", description: "Los valores que toma una dimensión en un ciclo (el último si no se indica), con cuántos programas y cuánta matrícula tiene cada uno. Sirve para armar filtros exactos.",
    request: { query: z.object({ dimension: z.enum(DIMENSIONES), ciclo: z.string().optional(), institucion: z.string().optional() }) },
    responses: { ...ok("Valores.", z.object({ ciclo: z.string(), dimension: z.string(), n: z.number().int(), items: z.array(z.object({ valor: z.string().nullable(), programas: z.number().int(), mat_total: N })) })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const dim = porParam(c.req.query("dimension")); const ciclo = await resolverCiclo(c, c.req.query("ciclo"));
    const inst = textoConPatron(c.req.query("institucion"), "institucion", CLAVE);
    const params: unknown[] = [ciclo]; let where = " WHERE ciclo = ?"; if (inst) { where += " AND institucion_clave = ?"; params.push(inst); }
    const items = await filas(c.env.DB_ANUIES, `SELECT ${dim} AS valor, COUNT(*) AS programas, SUM(mat_total) AS mat_total FROM programas${where} GROUP BY ${dim} ORDER BY valor`, params);
    return { ciclo, dimension: dim, n: items.length, items };
  }
}

export class AnuiesInstituciones extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "anuies_instituciones", summary: "Buscar instituciones", description: "Las instituciones del anuario con su clave estable (nombre sin acentos, en minúsculas y con guiones), nombre, sostenimiento y clasificación (del último ciclo en que aparecen), en qué ciclos están y sus cifras del último ciclo. `q` busca por contenido (sin acentos ni mayúsculas). Orden: matrícula descendente.",
    request: { query: z.object({ q: z.string().optional(), sostenimiento: z.string().optional(), clasificacion: z.string().optional(), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional() }) },
    responses: { ...ok("Instituciones.", z.object({ total: z.number().int(), n: z.number().int(), items: z.array(Institucion) })), ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = c.req.query("q"); const sos = c.req.query("sostenimiento"); const clas = c.req.query("clasificacion");
    const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 500) ?? 100; const offset = enteroOpcional(c.req.query("offset"), "offset", 0) ?? 0;
    const partes: string[] = []; const params: unknown[] = [];
    if (q) { const k = q.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); partes.push("clave LIKE ?"); params.push(`%${k}%`); }
    if (sos) { partes.push("sostenimiento = ?"); params.push(sos); }
    if (clas) { partes.push("clasificacion = ?"); params.push(clas); }
    const where = partes.length ? " WHERE " + partes.join(" AND ") : "";
    const total = (await fila<{ n: number }>(c.env.DB_ANUIES, `SELECT COUNT(*) AS n FROM instituciones${where}`, params))!.n;
    const items = await filas(c.env.DB_ANUIES, `SELECT * FROM instituciones${where} ORDER BY mat_total DESC, clave LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { total, n: items.length, items };
  }
}

export class AnuiesInstitucion extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "anuies_institucion", summary: "Una institución y su serie completa", description: "La ficha de la institución y su serie ciclo por ciclo (programas, escuelas y las 31 cifras base sumadas). " + NOTA_FILTROS,
    request: { params: z.object({ clave: z.string() }), query: z.object(Object.fromEntries(Object.entries(FiltrosQuery).filter(([k]) => k !== "ciclo"))) },
    responses: { ...ok("Institución.", z.object({ institucion: Institucion, serie: z.array(Serie) })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const clave = textoConPatron(c.req.param("clave"), "clave", CLAVE)!; const inst = await institucionOr404(c, clave);
    return { institucion: inst, serie: await serie(c, clave, c.req.query()) };
  }
}

export class AnuiesSerie extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "anuies_serie", summary: "Serie nacional (o filtrada) ciclo por ciclo", description: "Suma de las cifras base por ciclo para todo el país o para el subconjunto que definan los filtros (por ejemplo `nivel=DOCTORADO` o `entidad=JALISCO`); `institucion` acepta la clave de una institución. " + NOTA_FILTROS,
    request: { query: z.object({ institucion: z.string().optional(), ...Object.fromEntries(Object.entries(FiltrosQuery).filter(([k]) => k !== "ciclo")) }) },
    responses: { ...ok("Serie.", z.object({ n: z.number().int(), items: z.array(Serie) })), ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) { const inst = textoConPatron(c.req.query("institucion"), "institucion", CLAVE); const items = await serie(c, inst, c.req.query()); return { n: items.length, items }; }
}

export class AnuiesAgregado extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "anuies_agregado", summary: "Agregar un ciclo por una dimensión", description: "Para un ciclo (el último si no se indica), suma las cifras base agrupando por la dimensión `por` (nivel por defecto): entidad, municipio, sostenimiento, clasificacion, institucion, escuela, nivel, modalidad, campo_amplio, campo_especifico, campo_detallado, campo_unitario o carrera. Con `institucion` se limita a una institución (así salen sus planteles, sus carreras o sus campos de formación). Orden: matrícula descendente. " + NOTA_FILTROS,
    request: { query: z.object({ por: z.enum(DIMENSIONES).optional(), institucion: z.string().optional(), ...FiltrosQuery }) },
    responses: { ...ok("Agregado.", z.object({ ciclo: z.string(), por: z.string(), n: z.number().int(), items: z.array(Grupo) })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const por = porParam(c.req.query("por")); const ciclo = await resolverCiclo(c, c.req.query("ciclo")); const inst = textoConPatron(c.req.query("institucion"), "institucion", CLAVE);
    const items = await agregado(c, ciclo, por, inst, c.req.query()); return { ciclo, por, n: items.length, items };
  }
}

export class AnuiesProcedencia extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "anuies_procedencia", summary: "Procedencia del nuevo ingreso por entidad y región", description: "De dónde vienen las personas de nuevo ingreso de un ciclo: las 32 entidades (con su clave INEGI) y 8 regiones del extranjero, sumadas sobre los programas que cumplen los filtros. `suma_procedencia` puede diferir de `ni_total` cuando la institución no reporta procedencia para todos sus programas. " + NOTA_FILTROS,
    request: { query: z.object({ institucion: z.string().optional(), ...FiltrosQuery }) },
    responses: { ...ok("Procedencia.", z.object({ ciclo: z.string(), ni_total: N, programas_con_dato: z.number().int(), suma_procedencia: z.number().int(), items: z.array(z.object({ codigo: z.string(), nombre: z.string(), entidad: z.string().nullable(), ni: N })) })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) { const ciclo = await resolverCiclo(c, c.req.query("ciclo")); const inst = textoConPatron(c.req.query("institucion"), "institucion", CLAVE); return procedencia(c, ciclo, inst, c.req.query()); }
}

export class AnuiesEdades extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "anuies_edades", summary: "Matrícula y nuevo ingreso por edad y sexo", description: "Los 16 grupos de edad de ANUIES (17 a 29 año por año, 30 a 34, 35 a 39, 40 y más) con matrícula y nuevo ingreso por sexo, sumados sobre los programas que cumplen los filtros de un ciclo. Las sumas por edad pueden quedar por debajo del total cuando no todos los programas reportan edad. " + NOTA_FILTROS,
    request: { query: z.object({ institucion: z.string().optional(), ...FiltrosQuery }) },
    responses: { ...ok("Edades.", z.object({ ciclo: z.string(), mat_total: N, ni_total: N, programas_con_dato: z.number().int(), suma_matricula_edades: z.number().int(), suma_ni_edades: z.number().int(), items: z.array(z.object({ grupo: z.string(), matricula_m: N, matricula_h: N, matricula: N, ni_m: N, ni_h: N, ni: N })) })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) { const ciclo = await resolverCiclo(c, c.req.query("ciclo")); const inst = textoConPatron(c.req.query("institucion"), "institucion", CLAVE); return edades(c, ciclo, inst, c.req.query()); }
}

const Programa = z.object({ id: z.number().int(), ciclo: z.string(), entidad: z.string(), municipio: z.string().nullable(), sostenimiento: z.string().nullable(), anuies: N, clasificacion: z.string().nullable(), institucion: z.string(), institucion_clave: z.string(), escuela: z.string().nullable(), nivel: z.string().nullable(), modalidad: z.string().nullable(), campo_amplio: z.string().nullable(), campo_especifico: z.string().nullable(), campo_detallado: z.string().nullable(), campo_unitario: z.string().nullable(), carrera: z.string().nullable(), ...Cifras });
export class AnuiesProgramas extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "anuies_programas", summary: "Programas fila por fila", description: "Las filas del anuario tal cual (un programa en una escuela, ciclo, nivel y modalidad) con sus 31 cifras base. Paginación por llave: `limit` (hasta 1000) y `after` (el `id` de la última fila recibida; la respuesta trae `next_after`). Sin filtros recorre todo el anuario ordenado por id (ciclo, luego orden de ANUIES). " + NOTA_FILTROS,
    request: { query: z.object({ institucion: z.string().optional(), ...FiltrosQuery, limit: z.number().int().min(1).max(1000).optional(), after: z.number().int().min(0).optional() }) },
    responses: { ...ok("Programas.", z.object({ total: z.number().int(), n: z.number().int(), next_after: z.number().int().nullable(), items: z.array(Programa) })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = c.req.query(); const limit = enteroOpcional(q.limit, "limit", 1, 1000) ?? 100; const after = enteroOpcional(q.after, "after", 0) ?? 0;
    const ciclo = q.ciclo !== undefined ? await resolverCiclo(c, q.ciclo) : null; const inst = textoConPatron(q.institucion, "institucion", CLAVE);
    const { where, params } = condiciones(q, inst, ciclo);
    const total = (await fila<{ n: number }>(c.env.DB_ANUIES, `SELECT COUNT(*) AS n FROM programas${where}`, params))!.n;
    const items = await filas<z.infer<typeof Programa>>(c.env.DB_ANUIES, `SELECT * FROM programas${where ? where + " AND" : " WHERE"} id > ? ORDER BY id LIMIT ?`, [...params, after, limit + 1]);
    const hay = items.length > limit; if (hay) items.pop();
    return { total, n: items.length, next_after: hay ? items[items.length - 1].id : null, items };
  }
}

export class AnuiesPrograma extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "anuies_programa", summary: "Un programa con todas sus cifras", description: "La fila completa: cifras base, desagregación por edad (96 columnas) y procedencia del nuevo ingreso (40), o `null` en las tablas donde ANUIES no reporta nada para ese programa.",
    request: { params: z.object({ id: z.string() }) },
    responses: { ...ok("Programa.", z.object({ programa: Programa, edad: z.record(z.string(), N).nullable(), procedencia: z.record(z.string(), N).nullable() })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const idTxt = c.req.param("id") ?? "";
    if (!/^\d+$/.test(idTxt)) throw new ErrorHttp(422, [{ type: "int_parsing", loc: ["path", "id"], msg: "Input should be a valid integer, unable to parse string as an integer", input: idTxt } satisfies Detalle]);
    const id = Number(idTxt); const p = await fila<z.infer<typeof Programa>>(c.env.DB_ANUIES, "SELECT * FROM programas WHERE id = ?", [id]);
    if (!p) throw new ErrorHttp(404, `no existe el programa ${id}`);
    const quitarId = (r: Record<string, unknown> | null) => { if (!r) return null; const { id: _omit, ...resto } = r; return resto as Record<string, number | null>; };
    return { programa: p, edad: quitarId(await fila(c.env.DB_ANUIES, "SELECT * FROM programas_edad WHERE id = ?", [id])), procedencia: quitarId(await fila(c.env.DB_ANUIES, "SELECT * FROM programas_procedencia WHERE id = ?", [id])) };
  }
}

export class AnuiesDescarga extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "anuies_descarga", summary: "Descargar el Parquet de un ciclo", description: "Entrega el archivo tal como está en el almacén (R2): un Parquet por ciclo con las 14 dimensiones, el ciclo y las 167 cifras (enteros; nulo donde ANUIES no da la columna). Las claves están en `parquet_clave` de /api/v1/anuies/ciclos (prefijo `anuies/`).",
    request: { params: z.object({ clave: z.string() }) },
    responses: { "200": { description: "El archivo." }, ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) { return descargarDeR2(c, c.req.path.replace(/^\/api\/v1\/anuies\/descarga\//, ""), /^anuies\/[A-Za-z0-9_\-./]+$/); }
}

/** Descarga directa de un objeto del almacén, limitada a un prefijo. */
export async function descargarDeR2(c: AppContext, claveCruda: string, patron: RegExp) {
  const clave = decodeURIComponent(claveCruda);
  if (!patron.test(clave) || clave.includes("..")) throw new ErrorHttp(422, [{ type: "string_pattern_mismatch", loc: ["path", "clave"], msg: "clave fuera de los prefijos permitidos", input: clave } satisfies Detalle]);
  const obj = await c.env.DATOS.get(clave);
  if (!obj) throw new ErrorHttp(404, `no existe '${clave}' en el almacén`);
  const h = new Headers(); obj.writeHttpMetadata(h); h.set("etag", obj.httpEtag); h.set("content-length", String(obj.size)); h.set("content-disposition", `attachment; filename="${clave.split("/").pop()}"`); h.set("cache-control", "public, max-age=86400");
  return new Response(obj.body, { headers: h });
}
export { CICLO, FILTROS };

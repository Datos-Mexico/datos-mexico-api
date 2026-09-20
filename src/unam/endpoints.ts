// UNAM — todo lo que el observatorio tiene de la Universidad Nacional Autónoma de México:
//  · /unam/concurso/*  el dataset del Concurso de Selección a licenciatura (distribución de aciertos por carrera-plantel,
//    encabezados oficiales de la DGAE, universo, cobertura, proceso, cronología), reconstruido de fuente primaria por el
//    observatorio (repositorio datos-mexico-unam, CC BY 4.0). D1 datosmexico-api-unam; CSV en R2 (unam/concurso/).
//  · /unam/anuario/*   la UNAM en el Anuario ANUIES 2000-2001 a 2025-2026 (vistas sobre /api/v1/anuies/* con la
//    institución fija): serie, planteles, carreras, campos de formación, procedencia y edades.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import type { Detalle } from "../lib/validacion";
import { enteroOpcional, textoConPatron } from "../lib/validacion";
import { CIFRAS, DIMENSIONES, UNAM, agregado, edades, institucionOr404, literalError, porParam, procedencia, resolverCiclo, serie } from "../anuies/consultas";
import { descargarDeR2 } from "../anuies/endpoints";

const TAG = ["unam"];
const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const RESP_404 = { "404": { description: "No existe.", ...contentJson(z.object({ detail: z.string() })) } };
const RESP_422 = { "422": { description: "Parámetro inválido.", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };
const N = z.number().int().nullable();
const Valor = z.union([z.number(), z.string(), z.null()]);
const Fila = z.record(z.string(), Valor);
const Cifras = Object.fromEntries(CIFRAS.map((k) => [k, N])) as Record<(typeof CIFRAS)[number], typeof N>;
const CONCURSOS = ["febrero", "junio", "noviembre", "licenciatura"] as const;
const SISTEMAS = ["escolarizado", "abierta", "a distancia"] as const;
const TABLAS = ["encabezados", "distribucion", "universo", "cobertura", "proceso", "demanda_licenciatura", "identidad_doble", "cola_baja", "sesgo_cobertura", "sesgo_demanda", "paginas", "intentos_acceso", "cronologia_2026", "cronologia_terceros", "carreras_identidad", "avisos", "proceso_2026"] as const;
const FiltrosAnuario = { ciclo: z.string().optional(), entidad: z.string().optional(), escuela: z.string().optional(), nivel: z.string().optional(), modalidad: z.string().optional(), campo_amplio: z.string().optional(), campo_especifico: z.string().optional(), campo_detallado: z.string().optional(), carrera: z.string().optional(), q: z.string().optional() };
const NOTA = "Filtros exactos como los escribe ANUIES (`nivel`, `modalidad`, `escuela`, `campo_amplio`, `campo_especifico`, `campo_detallado`, `carrera`, `entidad`); `q` busca por contenido en carrera y escuela; valores válidos en /api/v1/anuies/valores?institucion=" + UNAM + ".";
const literal = (nombre: string, v: string | undefined, permitidos: readonly string[]) => { if (v !== undefined && !permitidos.includes(v)) throw new ErrorHttp(422, [literalError(nombre, v, permitidos)]); return v ?? null; };

function filtrosConcurso(q: Record<string, string | undefined>, conArea = true) {
  const partes: string[] = []; const params: unknown[] = [];
  const anio = enteroOpcional(q.anio, "anio", 2000, 2100); if (anio !== null) { partes.push("anio = ?"); params.push(anio); }
  const concurso = literal("concurso", q.concurso, CONCURSOS); if (concurso) { partes.push("concurso = ?"); params.push(concurso); }
  const sistema = literal("sistema", q.sistema, SISTEMAS); if (sistema) { partes.push("sistema = ?"); params.push(sistema); }
  if (conArea) { const area = enteroOpcional(q.area, "area", 1, 4); if (area !== null) { partes.push("area = ?"); params.push(area); } }
  if (q.carrera_codigo !== undefined) { partes.push("carrera_codigo = ?"); params.push(q.carrera_codigo); }
  if (q.plantel !== undefined) { partes.push("plantel = ?"); params.push(q.plantel); }
  if (q.q !== undefined) { partes.push("(carrera LIKE ? COLLATE NOCASE OR plantel LIKE ? COLLATE NOCASE)"); params.push(`%${q.q}%`, `%${q.q}%`); }
  return { where: partes.length ? " WHERE " + partes.join(" AND ") : "", params };
}
const archivoUrl = (k: string) => `/api/v1/unam/descarga/${k}`;

export class UnamResumen extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "unam_resumen", summary: "Qué tenemos de la UNAM",
    description: "Las dos fuentes: el Concurso de Selección (años, concursos, carrera-plantel con encabezado y con distribución completa, personas con calificación recuperada, cobertura frente al universo oficial) y la UNAM en el Anuario ANUIES (ciclos, planteles, programas y cifras del último ciclo).",
    responses: { ...ok("Resumen.", z.object({ concurso: z.object({ fuente: z.string(), licencia: z.string(), anios: z.array(z.number().int()), concursos: z.array(z.string()), carrera_plantel_con_encabezado: z.number().int(), carrera_plantel_con_distribucion: z.number().int(), personas_con_calificacion: N, universo_carrera_plantel: z.number().int(), archivos: z.number().int() }), anuario: z.object({ fuente: z.string(), fuente_url: z.string(), institucion: Fila.nullable(), ultimo_ciclo: z.string().nullable(), matricula_ultimo_ciclo: N }) })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const u = c.env.DB_UNAM;
    const anios = (await filas<{ anio: number }>(u, "SELECT DISTINCT anio FROM encabezados ORDER BY anio")).map((r) => r.anio);
    const concursos = (await filas<{ c: string }>(u, "SELECT DISTINCT concurso AS c FROM encabezados ORDER BY c")).map((r) => r.c);
    const enc = (await fila<{ n: number }>(u, "SELECT COUNT(*) AS n FROM encabezados"))!.n;
    const dist = (await fila<{ n: number; p: number | null }>(u, "SELECT COUNT(*) AS n, SUM(n) AS p FROM (SELECT anio, concurso, sistema, carrera_codigo, SUM(n) AS n FROM distribucion GROUP BY anio, concurso, sistema, carrera_codigo)"))!;
    const uni = (await fila<{ n: number }>(u, "SELECT COUNT(*) AS n FROM universo"))!.n;
    const arch = (await fila<{ n: number }>(u, "SELECT COUNT(*) AS n FROM archivos"))!.n;
    const inst = await fila<Record<string, unknown>>(c.env.DB_ANUIES, "SELECT * FROM instituciones WHERE clave = ?", [UNAM]);
    return { concurso: { fuente: "DGAE-UNAM (listados de resultados publicados), reconstruido por el observatorio", licencia: "CC BY 4.0", anios, concursos, carrera_plantel_con_encabezado: enc, carrera_plantel_con_distribucion: dist.n, personas_con_calificacion: dist.p, universo_carrera_plantel: uni, archivos: arch }, anuario: { fuente: "ANUIES — Anuario Estadístico de Educación Superior", fuente_url: "https://anuario.anuies.mx/", institucion: inst, ultimo_ciclo: (inst?.ultimo_ciclo as string) ?? null, matricula_ultimo_ciclo: (inst?.mat_total as number) ?? null } };
  }
}

export class UnamConcursoEncabezados extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "unam_concurso_encabezados", summary: "Encabezados oficiales por carrera-plantel-concurso", description: "Una fila por carrera-plantel-concurso con lo que la DGAE publica encima de cada listado: oferta, aspirantes, personas que presentaron, aciertos mínimos (el corte) y seleccionadas; más fuente, cobertura de la página y huella del original. `area` 1-4 (I Físico-Matemáticas e Ingenierías · II Biológicas, Químicas y de la Salud · III Sociales · IV Humanidades y Artes). El código de carrera cambió de ancho en 2019: para series largas use carrera + plantel.",
    request: { query: z.object({ anio: z.string().optional(), concurso: z.enum(CONCURSOS).optional(), sistema: z.enum(SISTEMAS).optional(), area: z.string().optional(), carrera_codigo: z.string().optional(), plantel: z.string().optional(), q: z.string().optional(), limit: z.number().int().min(1).max(2000).optional(), offset: z.number().int().min(0).optional() }) },
    responses: { ...ok("Encabezados.", z.object({ total: z.number().int(), n: z.number().int(), items: z.array(Fila) })), ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = c.req.query(); const { where, params } = filtrosConcurso(q); const limit = enteroOpcional(q.limit, "limit", 1, 2000) ?? 200; const offset = enteroOpcional(q.offset, "offset", 0) ?? 0;
    const total = (await fila<{ n: number }>(c.env.DB_UNAM, `SELECT COUNT(*) AS n FROM encabezados${where}`, params))!.n;
    const items = await filas(c.env.DB_UNAM, `SELECT * FROM encabezados${where} ORDER BY anio, concurso, sistema, area, carrera, plantel LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { total, n: items.length, items };
  }
}

export class UnamConcursoDistribucion extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "unam_concurso_distribucion", summary: "Histograma de aciertos de una carrera-plantel-concurso", description: "Cuántas personas obtuvieron cada número de aciertos (0-120) en un concurso, sistema y código de carrera-plantel, con el encabezado oficial al lado para cotejar (la suma del histograma debe coincidir con las personas que presentaron cuando la página está completa).",
    request: { params: z.object({ anio: z.string(), concurso: z.enum(CONCURSOS), carrera_codigo: z.string() }), query: z.object({ sistema: z.enum(SISTEMAS).optional() }) },
    responses: { ...ok("Distribución.", z.object({ anio: z.number().int(), concurso: z.string(), carrera_codigo: z.string(), encabezados: z.array(Fila), personas: N, items: z.array(z.object({ sistema: z.string(), aciertos: z.number().int(), n: z.number().int(), fuente: z.string().nullable() })) })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const anioTxt = c.req.param("anio") ?? ""; if (!/^\d{4}$/.test(anioTxt)) throw new ErrorHttp(422, [{ type: "int_parsing", loc: ["path", "anio"], msg: "Input should be a valid integer, unable to parse string as an integer", input: anioTxt } satisfies Detalle]);
    const anio = Number(anioTxt); const concurso = literal("concurso", c.req.param("concurso"), CONCURSOS)!; const codigo = textoConPatron(c.req.param("carrera_codigo"), "carrera_codigo", "^[0-9]{7,8}$")!; const sistema = literal("sistema", c.req.query("sistema"), SISTEMAS);
    const params: unknown[] = [anio, concurso, codigo]; let extra = ""; if (sistema) { extra = " AND sistema = ?"; params.push(sistema); }
    const enc = await filas(c.env.DB_UNAM, `SELECT * FROM encabezados WHERE anio = ? AND concurso = ? AND carrera_codigo = ?${extra} ORDER BY sistema`, params);
    const items = await filas<{ sistema: string; aciertos: number; n: number; fuente: string | null }>(c.env.DB_UNAM, `SELECT sistema, aciertos, n, fuente FROM distribucion WHERE anio = ? AND concurso = ? AND carrera_codigo = ?${extra} ORDER BY sistema, aciertos`, params);
    if (!enc.length && !items.length) throw new ErrorHttp(404, `no hay encabezado ni distribución para ${anio}/${concurso}/${codigo}; consulte /api/v1/unam/concurso/encabezados`);
    return { anio, concurso, carrera_codigo: codigo, encabezados: enc, personas: items.length ? items.reduce((s, r) => s + r.n, 0) : null, items };
  }
}

export class UnamConcursoUniverso extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "unam_concurso_universo", summary: "El universo oficial de carrera-plantel por concurso", description: "Qué carrera-plantel existieron en cada concurso según los índices por área de la DGAE: el denominador de la cobertura.",
    request: { query: z.object({ anio: z.string().optional(), concurso: z.enum(CONCURSOS).optional(), sistema: z.enum(SISTEMAS).optional(), area: z.string().optional(), q: z.string().optional(), limit: z.number().int().min(1).max(3000).optional(), offset: z.number().int().min(0).optional() }) },
    responses: { ...ok("Universo.", z.object({ total: z.number().int(), n: z.number().int(), items: z.array(Fila) })), ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = c.req.query(); const { where, params } = filtrosConcurso(q); const limit = enteroOpcional(q.limit, "limit", 1, 3000) ?? 500; const offset = enteroOpcional(q.offset, "offset", 0) ?? 0;
    const total = (await fila<{ n: number }>(c.env.DB_UNAM, `SELECT COUNT(*) AS n FROM universo${where}`, params))!.n;
    const items = await filas(c.env.DB_UNAM, `SELECT * FROM universo${where} ORDER BY anio, concurso, sistema, area, carrera, plantel LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { total, n: items.length, items };
  }
}

export class UnamConcursoTabla extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "unam_concurso_tabla", summary: "Cualquier tabla del dataset del concurso", description: "Lectura directa de una de las tablas del dataset (cobertura, proceso, demanda_licenciatura, identidad_doble, cola_baja, sesgo_cobertura, sesgo_demanda, paginas, intentos_acceso, cronologia_2026, cronologia_terceros, carreras_identidad, avisos, proceso_2026, además de encabezados, distribucion y universo) con filtros opcionales por `anio`, `concurso` y `sistema` cuando la tabla tiene esas columnas. El significado de cada columna está en el diccionario (/api/v1/unam/concurso/archivos).",
    request: { params: z.object({ tabla: z.enum(TABLAS) }), query: z.object({ anio: z.string().optional(), concurso: z.enum(CONCURSOS).optional(), sistema: z.enum(SISTEMAS).optional(), limit: z.number().int().min(1).max(5000).optional(), offset: z.number().int().min(0).optional() }) },
    responses: { ...ok("Filas.", z.object({ tabla: z.string(), columnas: z.array(z.string()), total: z.number().int(), n: z.number().int(), items: z.array(Fila) })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const tabla = c.req.param("tabla") ?? ""; if (!(TABLAS as readonly string[]).includes(tabla)) throw new ErrorHttp(422, [{ ...literalError("tabla", tabla, TABLAS), loc: ["path", "tabla"] }]);
    const q = c.req.query(); const limit = enteroOpcional(q.limit, "limit", 1, 5000) ?? 500; const offset = enteroOpcional(q.offset, "offset", 0) ?? 0;
    const columnas = (await filas<{ name: string }>(c.env.DB_UNAM, `PRAGMA table_info("${tabla}")`)).map((r) => r.name);
    const partes: string[] = []; const params: unknown[] = [];
    const anio = enteroOpcional(q.anio, "anio", 2000, 2100); if (anio !== null && columnas.includes("anio")) { partes.push("anio = ?"); params.push(anio); }
    const concurso = literal("concurso", q.concurso, CONCURSOS); if (concurso && columnas.includes("concurso")) { partes.push("concurso = ?"); params.push(concurso); }
    const sistema = literal("sistema", q.sistema, SISTEMAS); if (sistema && columnas.includes("sistema")) { partes.push("sistema = ?"); params.push(sistema); }
    const where = partes.length ? " WHERE " + partes.join(" AND ") : "";
    const total = (await fila<{ n: number }>(c.env.DB_UNAM, `SELECT COUNT(*) AS n FROM ${tabla}${where}`, params))!.n;
    const items = await filas(c.env.DB_UNAM, `SELECT * FROM ${tabla}${where} ORDER BY rowid LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { tabla, columnas, total, n: items.length, items };
  }
}

export class UnamConcursoArchivos extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "unam_concurso_archivos", summary: "Los archivos del dataset, con huella y descarga", description: "CSV del dataset, diccionario de datos y licencia (CC BY 4.0) tal como se publican, con filas, bytes, SHA-256 y URL de descarga en el observatorio.", responses: { ...ok("Archivos.", z.object({ n: z.number().int(), items: z.array(z.object({ archivo: z.string(), tabla: z.string().nullable(), filas: N, bytes: z.number().int(), sha256: z.string(), clave_r2: z.string(), url: z.string(), cargado_en: z.string() })) })), ...RESP_429 } };
  async handle(c: AppContext) { const items = (await filas<Record<string, unknown>>(c.env.DB_UNAM, "SELECT archivo, tabla, filas, bytes, sha256, clave_r2, cargado_en FROM archivos ORDER BY tabla IS NULL, archivo")).map((r) => ({ ...r, url: archivoUrl(r.clave_r2 as string) })); return { n: items.length, items }; }
}

export class UnamDescarga extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "unam_descarga", summary: "Descargar un archivo del dataset del concurso", description: "Entrega el archivo tal como está en el almacén (prefijo `unam/`); las claves están en /api/v1/unam/concurso/archivos.", request: { params: z.object({ clave: z.string() }) }, responses: { "200": { description: "El archivo." }, ...RESP_404, ...RESP_422, ...RESP_429 } };
  async handle(c: AppContext) { return descargarDeR2(c, c.req.path.replace(/^\/api\/v1\/unam\/descarga\//, ""), /^unam\/[A-Za-z0-9_\-./]+$/); }
}

// ------------------------------------------------------------------ la UNAM en el Anuario ANUIES
const Serie = z.object({ ciclo: z.string(), programas: z.number().int(), escuelas: z.number().int(), instituciones: z.number().int(), ...Cifras });
const Grupo = z.object({ valor: z.string().nullable(), programas: z.number().int(), ...Cifras });
const sinCiclo = Object.fromEntries(Object.entries(FiltrosAnuario).filter(([k]) => k !== "ciclo"));

export class UnamAnuarioSerie extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "unam_anuario_serie", summary: "La UNAM ciclo por ciclo (2000-2001 en adelante)", description: "Matrícula, nuevo ingreso, egresados, lugares ofertados, titulados y solicitudes por sexo, sumados por ciclo sobre los programas de la UNAM que cumplan los filtros (por ejemplo `nivel=LICENCIATURA UNIVERSITARIA Y TECNOLÓGICA`). " + NOTA, request: { query: z.object(sinCiclo) }, responses: { ...ok("Serie.", z.object({ institucion: Fila, n: z.number().int(), items: z.array(Serie) })), ...RESP_404, ...RESP_422, ...RESP_429 } };
  async handle(c: AppContext) { const inst = await institucionOr404(c, UNAM); const items = await serie(c, UNAM, c.req.query()); return { institucion: inst, n: items.length, items }; }
}

function vistaAgregado(op: string, resumen: string, descripcion: string, por: (typeof DIMENSIONES)[number] | null) {
  return class extends OpenAPIRoute {
    schema = { tags: TAG, operationId: op, summary: resumen, description: descripcion + " " + NOTA, request: { query: z.object(por ? FiltrosAnuario : { por: z.enum(DIMENSIONES).optional(), ...FiltrosAnuario }) }, responses: { ...ok("Agregado.", z.object({ ciclo: z.string(), por: z.string(), n: z.number().int(), items: z.array(Grupo) })), ...RESP_404, ...RESP_422, ...RESP_429 } };
    async handle(c: AppContext) { const ciclo = await resolverCiclo(c, c.req.query("ciclo")); const dim = por ?? porParam(c.req.query("por")); const items = await agregado(c, ciclo, dim, UNAM, c.req.query()); return { ciclo, por: dim, n: items.length, items }; }
  };
}
export const UnamAnuarioPlanteles = vistaAgregado("unam_anuario_planteles", "Planteles de la UNAM en un ciclo", "Cada escuela, facultad, campus o instituto de la UNAM con sus cifras del ciclo (el último si no se indica), en orden de matrícula.", "escuela");
export const UnamAnuarioCarreras = vistaAgregado("unam_anuario_carreras", "Carreras y posgrados de la UNAM en un ciclo", "Cada programa (licenciatura, especialidad, maestría o doctorado) sumado sobre todos los planteles donde se imparte, en orden de matrícula.", "carrera");
export const UnamAnuarioCampos = vistaAgregado("unam_anuario_campos", "Campos de formación de la UNAM en un ciclo", "Las cifras por campo amplio de formación (clasificación mexicana de programas de estudio), para comparar matrícula y egreso por área y sexo.", "campo_amplio");
export const UnamAnuarioNiveles = vistaAgregado("unam_anuario_niveles", "Niveles de la UNAM en un ciclo", "Técnico superior, licenciatura, especialidad, maestría y doctorado con sus cifras del ciclo.", "nivel");
export const UnamAnuarioAgregado = vistaAgregado("unam_anuario_agregado", "La UNAM agregada por cualquier dimensión", "Agrupa las cifras de la UNAM en un ciclo por la dimensión `por` (entidad, municipio, escuela, nivel, modalidad, campo_amplio, campo_especifico, campo_detallado, campo_unitario o carrera).", null);

export class UnamAnuarioProcedencia extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "unam_anuario_procedencia", summary: "De dónde viene el nuevo ingreso de la UNAM", description: "Personas de nuevo ingreso por entidad de procedencia (32, con clave INEGI) y región del extranjero (8) en un ciclo. " + NOTA, request: { query: z.object(FiltrosAnuario) }, responses: { ...ok("Procedencia.", z.object({ ciclo: z.string(), ni_total: N, programas_con_dato: z.number().int(), suma_procedencia: z.number().int(), items: z.array(z.object({ codigo: z.string(), nombre: z.string(), entidad: z.string().nullable(), ni: N })) })), ...RESP_404, ...RESP_422, ...RESP_429 } };
  async handle(c: AppContext) { const ciclo = await resolverCiclo(c, c.req.query("ciclo")); return procedencia(c, ciclo, UNAM, c.req.query()); }
}

export class UnamAnuarioEdades extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "unam_anuario_edades", summary: "Edades de la matrícula y del nuevo ingreso de la UNAM", description: "Los 16 grupos de edad de ANUIES con matrícula y nuevo ingreso por sexo en un ciclo. " + NOTA, request: { query: z.object(FiltrosAnuario) }, responses: { ...ok("Edades.", z.object({ ciclo: z.string(), mat_total: N, ni_total: N, programas_con_dato: z.number().int(), suma_matricula_edades: z.number().int(), suma_ni_edades: z.number().int(), items: z.array(z.object({ grupo: z.string(), matricula_m: N, matricula_h: N, matricula: N, ni_m: N, ni_h: N, ni: N })) })), ...RESP_404, ...RESP_422, ...RESP_429 } };
  async handle(c: AppContext) { const ciclo = await resolverCiclo(c, c.req.query("ciclo")); return edades(c, ciclo, UNAM, c.req.query()); }
}

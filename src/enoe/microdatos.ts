// ENOE microdatos (endpoints 15-17 del legacy), servidos desde R2 sin base de datos externa.
// Origen: enoe/particiones/<tabla>/<periodo>/<ent>.parquet — una partición por trimestre y entidad, ordenada por la
// llave primaria y escrita en grupos de 2,000 filas (scripts/enoe_particiones_r2.py; filas verificadas contra los
// Parquet por trimestre, que a su vez se verificaron contra Neon). El índice de particiones y el esquema viven en D1
// (microdatos_particiones, microdatos_columnas). La paginación es por cursor (llave de la última fila devuelta), no
// por número de página: es la práctica correcta para 101.5 millones de filas y no depende de un motor externo.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import { parquetMetadata, parquetReadObjects } from "hyparquet";
import type { AsyncBuffer, FileMetaData } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import type { AppContext } from "../index";
import { RESP_429 } from "../lib/comun";
import { filas, fila } from "../lib/db";
import { ErrorHttp } from "../lib/errores";
import { redondear } from "../lib/numeros";
import { repr } from "../lib/texto";
import { enteroOpcional } from "../lib/validacion";
import type { Detalle } from "../lib/validacion";
import { CAVEAT_DOMINIO_15PLUS, CAVEAT_ETAPA_CAMBIO_MARCO, CAVEAT_GAP_2020T2, SOURCE_ENOE } from "./constantes";
import type { Caveat } from "./constantes";

const TAG = ["enoe"];
const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const CaveatZ = z.object({ slug: z.string(), titulo: z.string(), descripcion: z.string(), periodo_aplicable: z.string(), referencia: z.string() });
const TABLAS = ["viv", "hog", "sdem", "coe1", "coe2"] as const;
type Tabla = (typeof TABLAS)[number];
const META: Record<Tabla, { real: string; pk: string[] }> = {
  viv: { real: "microdatos_viv", pk: ["periodo", "cd_a", "ent", "con", "v_sel"] },
  hog: { real: "microdatos_hog", pk: ["periodo", "cd_a", "ent", "con", "v_sel", "n_hog"] },
  sdem: { real: "microdatos_sdem", pk: ["periodo", "cd_a", "ent", "con", "v_sel", "n_hog", "n_ren"] },
  coe1: { real: "microdatos_coe1", pk: ["periodo", "cd_a", "ent", "con", "v_sel", "n_hog", "n_ren"] },
  coe2: { real: "microdatos_coe2", pk: ["periodo", "cd_a", "ent", "con", "v_sel", "n_hog", "n_ren"] },
};
const LLAVE_ENTERA = new Set(["n_hog", "n_ren"]);
// Orden de las filas dentro del trimestre: la entidad primero (es el nivel de partición) y luego el resto de la PK.
// El legacy ordenaba por la PK tal cual (cd_a antes que ent): con filtro de entidad ambos órdenes coinciden.
// Las particiones hechas desde los CSV oficiales traen TODAS las filas: desde 2020T3 la llave del legado no es única (el mismo
// hogar aparece con dos cuestionarios) y el índice marca `llave_extra` con los componentes finales de la llave, separados
// por coma: 'tipo' (2021T3 en adelante) o 'tipo,d_sem' (ENOE-N mensual 2020T3-2021T2, una visita por mes); vacío en
// 2005T1-2020T1, donde la llave del legado ya es única.
function orden(tabla: Tabla, extra: string | null = null): string[] { return ["ent", ...META[tabla].pk.slice(1).filter((k) => k !== "ent"), ...(extra ? extra.split(",").filter((k) => k) : [])]; }
// Columnas numeric(p,s) en Postgres que el Parquet guarda como double: se devuelven como texto con su escala, igual que el legacy.
const DECIMALES: Record<string, number> = { ing_x_hrs: 5 };
const CORE_SDEM = ["periodo", "cd_a", "ent", "con", "v_sel", "n_hog", "n_ren", "sex", "eda", "clase1", "clase2", "pos_ocu", "rama_est2", "fac_tri", "etapa"];
const DESCRIPCIONES: Record<string, string> = {
  periodo: "Trimestre 'YYYYTQ'. PK y primer nivel de partición.", cd_a: "Cuestionario A. PK.", ent: "Entidad federativa, clave INEGI '01'..'32'. PK y segundo nivel de partición.", con: "Control. PK.", v_sel: "Vivienda seleccionada. PK.",
  n_hog: "Número de hogar dentro de la vivienda. PK en hog/sdem/coe1/coe2.", n_ren: "Número de renglón (persona) dentro del hogar. PK en sdem/coe1/coe2.", sex: "Sexo: 1=hombre, 2=mujer.",
  eda: "Edad en años, 0-98 (98=98+).", clase1: "Clasificación principal: 1=PEA, 2=PNEA.", clase2: "Clasificación de ocupados/desocupados: 1=ocupado, 2=desocupado.",
  pos_ocu: "Posición en la ocupación (1=subordinados, 2=empleadores, 3=cuenta propia, 4=no remunerados).", rama_est2: "Sector económico SCIAN agregado 0..11.", fac_tri: "Factor de expansión trimestral.",
  extras_jsonb: "Columnas no tipadas (resto del DBF original), como objeto JSON.", etapa: "Etapa metodológica: clasica | etoe_telefonica | enoe_n.",
};
const PATRON_PERIODO = "^20\\d{2}T[1-4]$", PATRON_ENT = "^(0[1-9]|[12][0-9]|3[0-2])$";
const NOTA_PAGINACION = "Paginación por cursor: cada respuesta trae `pagination.next_cursor`; para la página siguiente se repite la misma consulta añadiendo `cursor=<ese valor>`. El cursor es la llave de la última fila devuelta, por lo que las páginas son estables y completas aunque la consulta se repita. No hay salto directo a la página N (el legacy lo permitía con `page`; aquí `page` se rechaza con 422).";

// ---------------------------------------------------------------- validación (mensajes de FastAPI)
function validarTabla(t: string): Tabla {
  if (!(TABLAS as readonly string[]).includes(t)) throw new ErrorHttp(422, [{ type: "literal_error", loc: ["path", "tabla"], msg: "Input should be 'viv', 'hog', 'sdem', 'coe1' or 'coe2'", input: t, ctx: { expected: "'viv', 'hog', 'sdem', 'coe1' or 'coe2'" } } satisfies Detalle]);
  return t as Tabla;
}
function patron(v: string | undefined, nombre: string, p: string): string | null {
  if (v === undefined) return null;
  if (!new RegExp(p).test(v)) throw new ErrorHttp(422, [{ type: "string_pattern_mismatch", loc: ["query", nombre], msg: `String should match pattern '${p}'`, input: v, ctx: { pattern: p } } satisfies Detalle]);
  return v;
}
type Filtros = { periodo: string; entidad_clave: string | null; sex: number | null; eda_min: number | null; eda_max: number | null };
function leerFiltros(c: AppContext, tabla: string): Filtros {
  const q = (k: string) => c.req.query(k);
  if (q("periodo") === undefined) throw new ErrorHttp(422, [{ type: "missing", loc: ["query", "periodo"], msg: "Field required", input: null } satisfies Detalle]);
  const periodo = patron(q("periodo"), "periodo", PATRON_PERIODO)!;
  const entidad_clave = patron(q("entidad_clave"), "entidad_clave", PATRON_ENT), entidad = patron(q("entidad"), "entidad", PATRON_ENT);
  const sex = enteroOpcional(q("sex"), "sex", 1, 2), eda_min = enteroOpcional(q("eda_min"), "eda_min", 0, 98), eda_max = enteroOpcional(q("eda_max"), "eda_max", 0, 98);
  if (tabla !== "sdem" && (sex !== null || eda_min !== null || eda_max !== null)) throw new ErrorHttp(422, `Los filtros 'sex', 'eda_min' y 'eda_max' solo aplican a tabla='sdem' (microdatos sociodemográficos). Tabla recibida: ${repr(tabla)}. Quita esos filtros o cambia tabla a sdem.`);
  if (eda_min !== null && eda_max !== null && eda_min > eda_max) throw new ErrorHttp(422, `'eda_min' (${eda_min}) debe ser <= 'eda_max' (${eda_max}).`);
  let eff: string | null = null;
  if (entidad_clave !== null && entidad !== null) { if (entidad_clave !== entidad) throw new ErrorHttp(422, `Parámetros 'entidad_clave' y 'entidad' enviados con valores distintos (${repr(entidad_clave)} vs ${repr(entidad)}). Usar solo 'entidad_clave' (canónico); 'entidad' está deprecated.`); eff = entidad_clave; }
  else eff = entidad_clave ?? entidad;
  return { periodo, entidad_clave: eff, sex, eda_min, eda_max };
}
function eco(f: Filtros): Record<string, unknown> {
  const out: Record<string, unknown> = { periodo: f.periodo };
  if (f.entidad_clave !== null) out.entidad_clave = f.entidad_clave;
  if (f.sex !== null) out.sex = f.sex; if (f.eda_min !== null) out.eda_min = f.eda_min; if (f.eda_max !== null) out.eda_max = f.eda_max;
  return out;
}
function conFiltroFila(tabla: Tabla, f: Filtros) { return tabla === "sdem" && (f.sex !== null || f.eda_min !== null || f.eda_max !== null); }
function coincide(r: Record<string, unknown>, f: Filtros): boolean {
  if (f.sex !== null && Number(r.sex) !== f.sex) return false;
  if (f.eda_min !== null && Number(r.eda) < f.eda_min) return false;
  if (f.eda_max !== null && Number(r.eda) > f.eda_max) return false;
  return true;
}
function caveatsMicro(periodo: string): Caveat[] {
  if (periodo === "2020T2") return [CAVEAT_GAP_2020T2];
  if ("2020T3" <= periodo && periodo <= "2021T4") return [CAVEAT_ETAPA_CAMBIO_MARCO];
  if ("2005T1" <= periodo && periodo <= "2020T1") return [CAVEAT_DOMINIO_15PLUS];
  return [];
}

// ---------------------------------------------------------------- llaves y cursor
type Llave = (string | number)[]; // valores de la llave de orden (ent, cd_a, con, v_sel[, n_hog[, n_ren]])
function llaveDe(tabla: Tabla, r: Record<string, unknown>, extra: string | null): Llave { return orden(tabla, extra).map((k) => (LLAVE_ENTERA.has(k) ? Number(r[k]) : String(r[k]))); }
function comparar(a: Llave, b: Llave): number {
  for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; }
  return 0;
}
function codificarCursor(k: Llave): string { return btoa(JSON.stringify(k)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function leerCursor(s: string | undefined, tabla: Tabla, f: Filtros, extra: string | null): Llave | null {
  if (s === undefined) return null;
  const invalido = (msg: string) => new ErrorHttp(422, [{ type: "value_error", loc: ["query", "cursor"], msg, input: s } satisfies Detalle]);
  const campos = orden(tabla, extra);
  let k: unknown;
  try { k = JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/"))); } catch { throw invalido("'cursor' inválido: debe ser el next_cursor devuelto por una respuesta anterior de esta misma tabla."); }
  if (!Array.isArray(k) || k.length !== campos.length) throw invalido(`'cursor' no corresponde a la tabla ${repr(tabla)} (se esperaba una llave de ${campos.length} componentes).`);
  campos.forEach((campo, i) => {
    const v = (k as unknown[])[i];
    if (LLAVE_ENTERA.has(campo) ? !Number.isInteger(v) : typeof v !== "string") throw invalido(`'cursor' inválido: componente ${repr(campo)} con tipo incorrecto.`);
  });
  const ent = (k as Llave)[0] as string;
  if (!new RegExp(PATRON_ENT).test(ent)) throw invalido("'cursor' inválido: entidad fuera de '01'..'32'.");
  if (f.entidad_clave !== null && ent !== f.entidad_clave) throw invalido(`'cursor' pertenece a la entidad ${repr(ent)} y la consulta filtra entidad_clave=${repr(f.entidad_clave)}; usa el cursor de esta misma consulta.`);
  return k as Llave;
}

// ---------------------------------------------------------------- particiones en R2
type Particion = { ent: string; filas: number; bytes: number; clave: string; llave_extra: string | null };
type Archivo = { file: AsyncBuffer; metadata: FileMetaData };
async function particiones(c: AppContext, tabla: Tabla, periodo: string, ent: string | null): Promise<Particion[]> {
  return filas<Particion>(c.env.DB_ENOE, `SELECT ent, filas, bytes, clave, llave_extra FROM microdatos_particiones WHERE tabla = ? AND periodo = ?${ent !== null ? " AND ent = ?" : ""} ORDER BY ent`, ent !== null ? [tabla, periodo, ent] : [tabla, periodo]);
}
async function abrir(c: AppContext, p: Particion): Promise<Archivo> {
  const obj = await c.env.DATOS.get(p.clave);
  if (!obj) throw new ErrorHttp(502, `La partición ${p.clave} no está disponible en el almacén.`);
  const ab = await obj.arrayBuffer();
  if (ab.byteLength !== p.bytes) throw new ErrorHttp(502, `La partición ${p.clave} tiene un tamaño distinto al registrado (${ab.byteLength} vs ${p.bytes} bytes).`);
  return { file: { byteLength: ab.byteLength, slice: (a: number, b?: number) => ab.slice(a, b) }, metadata: parquetMetadata(ab) };
}
function leer(a: Archivo, columns: string[] | undefined, rowStart?: number, rowEnd?: number) {
  return parquetReadObjects({ file: a.file, metadata: a.metadata, columns, rowStart, rowEnd, compressors });
}
function normalizar(r: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === "periodo" && typeof v === "string") o[k] = v.trim();
    else if (k === "extras_jsonb" && typeof v === "string") { try { o[k] = JSON.parse(v); } catch { o[k] = v; } }
    else if (typeof v === "bigint") o[k] = Number(v);
    else if (k in DECIMALES && typeof v === "number") o[k] = v.toFixed(DECIMALES[k]);
    else o[k] = v === undefined ? null : v;
  }
  return o;
}
/** Filas de una partición por índice (ordenados), leyendo solo los grupos de filas necesarios. */
async function filasPorIndice(a: Archivo, indices: number[], columns: string[] | undefined): Promise<Record<string, unknown>[]> {
  const grupos: { inicio: number; fin: number }[] = []; let acc = 0;
  for (const g of a.metadata.row_groups) { const n = Number(g.num_rows); grupos.push({ inicio: acc, fin: acc + n }); acc += n; }
  const salida: Record<string, unknown>[] = []; let i = 0;
  for (const g of grupos) {
    if (i >= indices.length) break;
    if (indices[i] >= g.fin) continue;
    const primero = indices[i]; let ultimo = primero;
    while (i < indices.length && indices[i] < g.fin) { ultimo = indices[i]; i++; }
    const bloque = await leer(a, columns, primero, ultimo + 1);
    for (let j = 0; j < bloque.length; j++) { if (indices.includes(primero + j)) salida.push(normalizar(bloque[j])); }
  }
  return salida;
}
/** Conteo exacto con filtros de fila (sdem): lee solo las columnas filtradas de cada partición. */
async function contarConFiltros(c: AppContext, parts: Particion[], f: Filtros): Promise<number> {
  const conteos = await Promise.all(parts.map(async (p) => { const a = await abrir(c, p); const cols = await leer(a, ["sex", "eda"]); let n = 0; for (const r of cols) if (coincide(r, f)) n++; return n; }));
  return conteos.reduce((s, n) => s + n, 0);
}

const paramsComunes = {
  periodo: z.string().regex(/^20\d{2}T[1-4]$/).describe("Trimestre YYYYTQ (ej. 2025T1). OBLIGATORIO."),
  entidad_clave: z.string().regex(/^(0[1-9]|[12][0-9]|3[0-2])$/).optional().describe("Clave INEGI '01'..'32' (ej. '09' = CDMX). Opcional; acota la lectura a una sola partición."),
  entidad: z.string().regex(/^(0[1-9]|[12][0-9]|3[0-2])$/).optional().describe("DEPRECATED: usar `entidad_clave`. Alias retenido por compatibilidad."),
  sex: z.number().int().min(1).max(2).optional().describe("Solo sdem. 1=hombre, 2=mujer."),
  eda_min: z.number().int().min(0).max(98).optional().describe("Solo sdem. Edad mínima (años)."),
  eda_max: z.number().int().min(0).max(98).optional().describe("Solo sdem. Edad máxima (años)."),
};
const TablaParam = z.object({ tabla: z.enum(TABLAS).describe("Una de: viv | hog | sdem | coe1 | coe2") });

// ---------------------------------------------------------------- 15. list
const Pagination = z.object({ total: z.number().int().describe("Total EXACTO de filas que cumplen los filtros."), per_page: z.number().int(), returned: z.number().int().describe("Filas en esta respuesta."), has_next: z.boolean(), next_cursor: z.string().nullable().describe("Cursor para la página siguiente (null si no hay más). Se pasa tal cual en `cursor`.") });
const MicrodatosRow = z.object({ periodo: z.string(), etapa: z.string() }).passthrough();
const ListResponse = z.object({ tabla: z.string(), filtros: z.record(z.string(), z.unknown()), pagination: Pagination, data: z.array(MicrodatosRow), caveats: z.array(CaveatZ), source: z.string(), tiempo_query_ms: z.number().nullable().default(null).describe("Tiempo de lectura de índice y particiones (sin serialización).") });
export class MicrodatosList extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_microdatos_list_api_v1_enoe_microdatos__tabla__list_get", summary: "Lista de microdatos individuales (paginación por cursor)",
    description: `Acceso a filas individuales de las 5 tablas de microdatos del ENOE (viv, hog, sdem, coe1, coe2; 101.5 millones de filas). Origen: particiones Parquet por trimestre y entidad ordenadas por la llave primaria, con conteos verificados contra la carga original.\n\n**Filtros obligatorios:**\n- \`periodo\`: trimestre YYYYTQ (ej. \`2025T1\`).\n\n**Filtros opcionales:**\n- \`entidad_clave\`: clave INEGI 2 dígitos \`01\`..\`32\` (ej. \`09\` = CDMX). El alias \`entidad\` se acepta por compatibilidad pero está deprecated.\n- \`sex\`, \`eda_min\`, \`eda_max\`: SOLO aplicables a \`tabla=sdem\`. Otras tablas rechazan estos filtros con HTTP 422.\n- \`include_extras\`: incluir la columna \`extras_jsonb\` (default \`true\`). Con \`false\` en sdem se devuelven solo las columnas núcleo.\n\n**Paginación:** ${NOTA_PAGINACION}\n- \`per_page\`: máximo 1000, default 100. \`total\` es exacto.\n\n**Orden:** dentro del trimestre, entidad federativa primero y después el resto de la llave primaria (ent, cd_a, con, v_sel[, n_hog[, n_ren]]). Con \`entidad_clave\` el orden coincide con el del legacy; sin él, el legacy ordenaba cd_a antes que ent.\n\n**Tipos:** \`ing_x_hrs\` (sdem) se devuelve como texto con 5 decimales, como en el legacy (numeric(17,5)).\n\n**Rate limit:** 10/min por IP.\n\n**Caveats:** inyectados según el periodo. Periodos \`2020T3-2021T4\` tienen subestimación 6-7% en fac_tri (cambio de marco CPV 2020). Periodo \`2020T2\` no tiene microdatos (gap ETOE).`,
    request: { params: TablaParam, query: z.object({ ...paramsComunes, include_extras: z.boolean().default(true).describe("Incluir columna extras_jsonb (default true)."), per_page: z.number().int().min(1).max(1000).default(100).describe("Filas por página, máximo 1000."), cursor: z.string().optional().describe("`next_cursor` de la respuesta anterior (misma tabla y filtros). Omitir para la primera página.") }) },
    responses: { ...ok("Página de microdatos.", ListResponse), "422": { description: "Filtro `sex`/`eda_*` en una tabla distinta de sdem, `tabla` inválida, `cursor` inválido o parámetro `page` (la paginación es por cursor).", ...contentJson(z.object({ detail: z.unknown() })) }, "429": { description: "Rate limit excedido (10 req/min por IP).", ...contentJson(z.object({ detail: z.string() })) } },
  };
  async handle(c: AppContext) {
    const tabla = validarTabla(c.req.param("tabla") ?? ""); const meta = META[tabla];
    const f = leerFiltros(c, tabla);
    if (c.req.query("page") !== undefined) throw new ErrorHttp(422, [{ type: "value_error", loc: ["query", "page"], msg: `El parámetro 'page' no existe en esta API: ${NOTA_PAGINACION}`, input: c.req.query("page") } satisfies Detalle]);
    const ie = c.req.query("include_extras"); const include_extras = ie === undefined ? true : ["true", "1", "yes", "on"].includes(ie.toLowerCase()) ? true : ["false", "0", "no", "off"].includes(ie.toLowerCase()) ? false : (() => { throw new ErrorHttp(422, [{ type: "bool_parsing", loc: ["query", "include_extras"], msg: "Input should be a valid boolean, unable to interpret input", input: ie } satisfies Detalle]); })();
    const per_page = enteroOpcional(c.req.query("per_page"), "per_page", 1, 1000) ?? 100;
    const columnas = include_extras || tabla !== "sdem" ? undefined : CORE_SDEM;
    const filtroFila = conFiltroFila(tabla, f);
    const t0 = Date.now();
    const parts = await particiones(c, tabla, f.periodo, f.entidad_clave);
    const extra = parts[0]?.llave_extra ?? null;
    const cursor = leerCursor(c.req.query("cursor"), tabla, f, extra);
    const total = parts.length === 0 ? 0 : filtroFila ? await contarConFiltros(c, parts, f) : parts.reduce((s, p) => s + p.filas, 0);
    // Recorre las particiones desde la del cursor; junta hasta per_page+1 coincidencias para saber si hay más.
    const data: Record<string, unknown>[] = []; let siguiente: Llave | null = null; let hayMas = false;
    for (const p of parts) {
      if (cursor !== null && p.ent < (cursor[0] as string)) continue;
      if (data.length === per_page) { if (!filtroFila) { hayMas = p.filas > 0; if (hayMas) break; continue; } }
      const a = await abrir(c, p);
      const llaves = await leer(a, [...orden(tabla, extra), ...(filtroFila ? ["sex", "eda"] : [])]);
      let i = 0;
      if (cursor !== null && p.ent === cursor[0]) { let lo = 0, hi = llaves.length; while (lo < hi) { const m = (lo + hi) >> 1; if (comparar(llaveDe(tabla, llaves[m], extra), cursor) <= 0) lo = m + 1; else hi = m; } i = lo; }
      const indices: number[] = [];
      for (; i < llaves.length && data.length + indices.length <= per_page; i++) if (!filtroFila || coincide(llaves[i], f)) indices.push(i);
      const sobra = data.length + indices.length > per_page; if (sobra) { indices.pop(); hayMas = true; }
      if (indices.length) { data.push(...(await filasPorIndice(a, indices, columnas))); siguiente = llaveDe(tabla, llaves[indices[indices.length - 1]], extra); }
      if (hayMas) break;
    }
    return { tabla: meta.real, filtros: { ...eco(f), include_extras }, pagination: { total, per_page, returned: data.length, has_next: hayMas, next_cursor: hayMas && siguiente ? codificarCursor(siguiente) : null }, data, caveats: caveatsMicro(f.periodo), source: SOURCE_ENOE, tiempo_query_ms: redondear(Date.now() - t0, 2) };
  }
}

// ---------------------------------------------------------------- 16. count
export class MicrodatosCount extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_microdatos_count_api_v1_enoe_microdatos__tabla__count_get", summary: "Conteo exacto de microdatos con filtros",
    description: "Conteo EXACTO de filas de microdatos que coinciden con los filtros. Mismos filtros que `/microdatos/{tabla}/list`. Sin filtros de fila el conteo sale del índice de particiones; con `sex`/`eda_*` se leen solo esas columnas de las particiones del trimestre.\n\n**Uso típico:** saber cuántas filas existen antes de paginar.",
    request: { params: TablaParam, query: z.object({ ...paramsComunes }) },
    responses: { ...ok("Conteo exacto + eco de filtros + caveat opcional.", z.object({ tabla: z.string(), filtros: z.record(z.string(), z.unknown()), total: z.number().int(), caveat_metodologico: z.string().nullable().default(null), source: z.string() })), "422": { description: "Filtro `sex`/`eda_*` enviado a una tabla distinta de sdem." }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const tabla = validarTabla(c.req.param("tabla") ?? ""); const meta = META[tabla];
    const f = leerFiltros(c, tabla);
    const parts = await particiones(c, tabla, f.periodo, f.entidad_clave);
    const total = parts.length === 0 ? 0 : conFiltroFila(tabla, f) ? await contarConFiltros(c, parts, f) : parts.reduce((s, p) => s + p.filas, 0);
    return { tabla: meta.real, filtros: eco(f), total, caveat_metodologico: f.periodo === "2020T2" ? "Periodo 2020T2 no tiene microdatos descargables (ETOE telefónica sustituyó al ENOE presencial por COVID-19; INEGI solo publicó agregados). Esperar total=0." : null, source: SOURCE_ENOE };
  }
}

// ---------------------------------------------------------------- 17. schema
const ColumnaSchema = z.object({ nombre: z.string(), tipo: z.string(), nullable: z.boolean(), descripcion: z.string().nullable().default(null) });
export class MicrodatosSchema extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_microdatos_schema_api_v1_enoe_microdatos__tabla__schema_get", summary: "Schema de una tabla de microdatos",
    description: "Lista las columnas y tipos (Arrow/Parquet) de una tabla de microdatos, su llave primaria, el total EXACTO de filas y la cobertura temporal, más cómo está almacenada (particiones por trimestre y entidad).\n\n**Uso:** inspeccionar columnas disponibles antes de construir consultas vía `/list`. Las columnas núcleo traen descripción; las demás siguen los identificadores del INEGI (Reconstrucción de variables 2023).",
    request: { params: TablaParam },
    responses: { ...ok("Metadata estructural de la tabla de microdatos.", z.object({ tabla: z.string(), total_columnas: z.number().int(), total_filas: z.number().int(), cobertura_temporal: z.string().nullable(), columnas: z.array(ColumnaSchema), pk: z.array(z.string()), indexes: z.array(z.string()), llave_desde_2025T2: z.array(z.string()), almacenamiento: z.object({ formato: z.string(), particiones: z.number().int(), bytes: z.number().int(), orden: z.string() }), caveat_metodologico: z.string().nullable().default(null) })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const tabla = validarTabla(c.req.param("tabla") ?? ""); const meta = META[tabla];
    const cols = await filas<{ columna: string; tipo: string; nullable: number }>(c.env.DB_ENOE, "SELECT columna, tipo, nullable FROM microdatos_columnas WHERE tabla = ? ORDER BY orden", [tabla]);
    const st = await fila<{ n: number; filas: number; bytes: number; desde: string; hasta: string }>(c.env.DB_ENOE, "SELECT count(*) AS n, sum(filas) AS filas, sum(bytes) AS bytes, min(periodo) AS desde, max(periodo) AS hasta FROM microdatos_particiones WHERE tabla = ?", [tabla]);
    return {
      tabla: meta.real, total_columnas: cols.length, total_filas: Number(st?.filas ?? 0), cobertura_temporal: st?.desde ? `${st.desde}-${st.hasta}` : null,
      columnas: cols.map((r) => ({ nombre: r.columna, tipo: r.tipo, nullable: r.nullable === 1, descripcion: DESCRIPCIONES[r.columna] ?? null })),
      pk: meta.pk, indexes: [], llave_desde_2025T2: [...meta.pk, "tipo"],
      almacenamiento: { formato: "Parquet (zstd) en almacenamiento de objetos, una partición por trimestre y entidad federativa, grupos de 2,000 filas; desde 2025T2 las particiones nacen de los CSV oficiales del INEGI con todas las filas y la llave incluye `tipo` (cuestionario)", particiones: Number(st?.n ?? 0), bytes: Number(st?.bytes ?? 0), orden: `periodo, ${orden(tabla).join(", ")}` },
      caveat_metodologico: "Las columnas no listadas con descripción siguen los identificadores INEGI documentados en Reconstrucción de variables 2023 (https://www.inegi.org.mx/contenidos/programas/enoe/15ymas/doc/recons_var_15ymas.pdf). extras_jsonb contiene las columnas DBF que no se promovieron a tipadas.",
    };
  }
}

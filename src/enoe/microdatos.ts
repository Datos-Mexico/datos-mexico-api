// ENOE microdatos (endpoints 15-17 del legacy). Puente temporal: las filas viven en Neon (Postgres) y se
// consultan vía Hyperdrive; los archivos Parquet por trimestre se publican en R2 (datosmexico-datos/enoe/microdatos/).
// Cuando el legacy se apague, este módulo cambia de origen (R2 SQL o D1 por trimestres) sin cambiar el contrato.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import postgres from "postgres";
import type { AppContext } from "../index";
import { RESP_429 } from "../lib/comun";
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
const META: Record<string, { real: string; pk: string[] }> = {
  viv: { real: "microdatos_viv", pk: ["periodo", "cd_a", "ent", "con", "v_sel"] },
  hog: { real: "microdatos_hog", pk: ["periodo", "cd_a", "ent", "con", "v_sel", "n_hog"] },
  sdem: { real: "microdatos_sdem", pk: ["periodo", "cd_a", "ent", "con", "v_sel", "n_hog", "n_ren"] },
  coe1: { real: "microdatos_coe1", pk: ["periodo", "cd_a", "ent", "con", "v_sel", "n_hog", "n_ren"] },
  coe2: { real: "microdatos_coe2", pk: ["periodo", "cd_a", "ent", "con", "v_sel", "n_hog", "n_ren"] },
};
const CORE_SDEM = ["periodo", "cd_a", "ent", "con", "v_sel", "n_hog", "n_ren", "sex", "eda", "clase1", "clase2", "pos_ocu", "rama_est2", "fac_tri", "etapa"];
const DESCRIPCIONES: Record<string, string> = {
  periodo: "Trimestre 'YYYYTQ' (CHAR(6)). PK.", cd_a: "Cuestionario A. PK.", ent: "Entidad federativa, clave INEGI '01'..'32'. PK.", con: "Control. PK.", v_sel: "Vivienda seleccionada. PK.",
  n_hog: "Número de hogar dentro de la vivienda. PK en hog/sdem/coe1/coe2.", n_ren: "Número de renglón (persona) dentro del hogar. PK en sdem/coe1/coe2.", sex: "Sexo: 1=hombre, 2=mujer. NOT NULL en sdem.",
  eda: "Edad en años, 0-98 (98=98+).", clase1: "Clasificación principal: 1=PEA, 2=PNEA.", clase2: "Clasificación de ocupados/desocupados: 1=ocupado, 2=desocupado.",
  pos_ocu: "Posición en la ocupación (1=subordinados, 2=empleadores, 3=cuenta propia, 4=no remunerados).", rama_est2: "Sector económico SCIAN agregado 0..11.", fac_tri: "Factor de expansión trimestral. NOT NULL.",
  extras_jsonb: "Columnas no-typed (resto del DBF), serializadas como JSON.", etapa: "Etapa metodológica ENUM: clasica | etoe_telefonica | enoe_n.",
};
const PATRON_PERIODO = "^20\\d{2}T[1-4]$", PATRON_ENT = "^(0[1-9]|[12][0-9]|3[0-2])$";

function sql(c: AppContext) { return postgres(c.env.HYPERDRIVE.connectionString, { max: 1, prepare: false, fetch_types: false }); }
function validarTabla(t: string): string {
  if (!(TABLAS as readonly string[]).includes(t)) throw new ErrorHttp(422, [{ type: "enum", loc: ["path", "tabla"], msg: "Input should be 'viv', 'hog', 'sdem', 'coe1' or 'coe2'", input: t, ctx: { expected: "'viv', 'hog', 'sdem', 'coe1' or 'coe2'" } } satisfies Detalle]);
  return t;
}
function patron(v: string | undefined, nombre: string, p: string): string | null {
  if (v === undefined) return null;
  if (!new RegExp(p).test(v)) throw new ErrorHttp(422, [{ type: "string_pattern_mismatch", loc: ["query", nombre], msg: `String should match pattern '${p}'`, input: v, ctx: { pattern: p } } satisfies Detalle]);
  return v;
}
type Filtros = { periodo: string; entidad_clave: string | null; sex: number | null; eda_min: number | null; eda_max: number | null };
function leerFiltros(c: AppContext, tabla: string): Filtros {
  const q = (k: string) => c.req.query(k);
  // Validación de FastAPI (forma lista) en el orden de declaración de los parámetros
  const errores: Detalle[] = [];
  if (q("periodo") === undefined) errores.push({ type: "missing", loc: ["query", "periodo"], msg: "Field required", input: null });
  if (errores.length) throw new ErrorHttp(422, errores);
  const periodo = patron(q("periodo"), "periodo", PATRON_PERIODO)!;
  const entidad_clave = patron(q("entidad_clave"), "entidad_clave", PATRON_ENT), entidad = patron(q("entidad"), "entidad", PATRON_ENT);
  const sex = enteroOpcional(q("sex"), "sex", 1, 2), eda_min = enteroOpcional(q("eda_min"), "eda_min", 0, 98), eda_max = enteroOpcional(q("eda_max"), "eda_max", 0, 98);
  // Validaciones del router (forma cadena)
  if (tabla !== "sdem" && (sex !== null || eda_min !== null || eda_max !== null)) throw new ErrorHttp(422, `Los filtros 'sex', 'eda_min' y 'eda_max' solo aplican a tabla='sdem' (microdatos sociodemográficos). Tabla recibida: ${repr(tabla)}. Quita esos filtros o cambia tabla a sdem.`);
  if (eda_min !== null && eda_max !== null && eda_min > eda_max) throw new ErrorHttp(422, `'eda_min' (${eda_min}) debe ser <= 'eda_max' (${eda_max}).`);
  let eff: string | null = null;
  if (entidad_clave !== null && entidad !== null) { if (entidad_clave !== entidad) throw new ErrorHttp(422, `Parámetros 'entidad_clave' y 'entidad' enviados con valores distintos (${repr(entidad_clave)} vs ${repr(entidad)}). Usar solo 'entidad_clave' (canónico); 'entidad' está deprecated.`); eff = entidad_clave; }
  else eff = entidad_clave ?? entidad;
  return { periodo, entidad_clave: eff, sex, eda_min, eda_max };
}
function where(tabla: string, f: Filtros): { texto: string; params: unknown[] } {
  const cl = ["periodo = $1"]; const p: unknown[] = [f.periodo];
  if (f.entidad_clave !== null) { p.push(f.entidad_clave); cl.push(`ent = $${p.length}`); }
  if (tabla === "sdem") {
    if (f.sex !== null) { p.push(f.sex); cl.push(`sex = $${p.length}`); }
    if (f.eda_min !== null) { p.push(f.eda_min); cl.push(`eda >= $${p.length}`); }
    if (f.eda_max !== null) { p.push(f.eda_max); cl.push(`eda <= $${p.length}`); }
  }
  return { texto: cl.join(" AND "), params: p };
}
function eco(f: Filtros): Record<string, unknown> {
  const out: Record<string, unknown> = { periodo: f.periodo };
  if (f.entidad_clave !== null) out.entidad_clave = f.entidad_clave;
  if (f.sex !== null) out.sex = f.sex; if (f.eda_min !== null) out.eda_min = f.eda_min; if (f.eda_max !== null) out.eda_max = f.eda_max;
  return out;
}
function caveatsMicro(periodo: string): Caveat[] {
  if (periodo === "2020T2") return [CAVEAT_GAP_2020T2];
  if ("2020T3" <= periodo && periodo <= "2021T4") return [CAVEAT_ETAPA_CAMBIO_MARCO];
  if ("2005T1" <= periodo && periodo <= "2020T1") return [CAVEAT_DOMINIO_15PLUS];
  return [];
}
const paramsComunes = {
  periodo: z.string().regex(/^20\d{2}T[1-4]$/).describe("Trimestre YYYYTQ (ej. 2025T1). OBLIGATORIO."),
  entidad_clave: z.string().regex(/^(0[1-9]|[12][0-9]|3[0-2])$/).optional().describe("Clave INEGI '01'..'32' (ej. '09' = CDMX). Opcional pero recomendado para SLA."),
  entidad: z.string().regex(/^(0[1-9]|[12][0-9]|3[0-2])$/).optional().describe("DEPRECATED: usar `entidad_clave`. Alias retenido por backward compat; será removido en una versión futura."),
  sex: z.number().int().min(1).max(2).optional().describe("Solo sdem. 1=hombre, 2=mujer."),
  eda_min: z.number().int().min(0).max(98).optional().describe("Solo sdem. Edad mínima (años)."),
  eda_max: z.number().int().min(0).max(98).optional().describe("Solo sdem. Edad máxima (años)."),
};
const TablaParam = z.object({ tabla: z.enum(TABLAS).describe("Una de: viv | hog | sdem | coe1 | coe2") });

// ---------------------------------------------------------------- 15. list
const Pagination = z.object({ total: z.number().int().describe("Total de filas que matchean los filtros (EXACTO)."), page: z.number().int().describe("Página actual, 1-indexed."), per_page: z.number().int(), total_pages: z.number().int(), has_next: z.boolean(), has_previous: z.boolean() });
const MicrodatosRow = z.object({ periodo: z.string(), etapa: z.string() }).passthrough();
const ListResponse = z.object({ tabla: z.string(), filtros: z.record(z.string(), z.unknown()), pagination: Pagination, data: z.array(MicrodatosRow), caveats: z.array(CaveatZ), source: z.string(), tiempo_query_ms: z.number().nullable().default(null).describe("Tiempo total de las queries SQL (no incluye serialización ni overhead FastAPI). Útil para validar SLA <500ms.") });
export class MicrodatosList extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_microdatos_list_api_v1_enoe_microdatos__tabla__list_get", summary: "Lista paginada de microdatos individuales",
    description: "Acceso a filas individuales de las 5 tablas de microdatos del ENOE (viv, hog, sdem, coe1, coe2, 101.5M filas combinadas).\n\n**Filtros obligatorios:**\n- `periodo`: trimestre YYYYTQ (ej. `2025T1`). Sin este filtro la   query barrería toda la tabla.\n\n**Filtros opcionales:**\n- `entidad_clave`: clave INEGI 2 dígitos `01`..`32` (ej. `09` = CDMX). Activa el index `idx_enoe_<tabla>_periodo_ent` (SLA <500ms). El alias `entidad` se acepta por backward compat pero está deprecated.\n- `sex`, `eda_min`, `eda_max`: SOLO aplicables a `tabla=sdem` (microdatos sociodemográficos). Otras tablas rechazan estos filtros con HTTP 422 explícito.\n- `include_extras`: incluir columna `extras_jsonb` (default `true`). Pasar `false` reduce el payload — útil para listados rápidos.\n\n**Paginación:**\n- `page`: 1-indexed, default 1.\n- `per_page`: máximo 1000, default 100. El `total` es **exacto** (count(*) con el mismo WHERE), no una aproximación.\n\n**Rate limit:** 10/min por IP (más estricto que los demás endpoints ENOE — protege de descargas masivas a través del API público).\n\n**SLA:** <500ms wall-clock con filtro `periodo` + `entidad_clave` y `per_page` ≤ 100 (con indexes migration 032).\n\n**Caveats:** inyectados según el periodo. Periodos `2020T3-2021T4` tienen subestimación 6-7% en fac_tri (cambio de marco CPV 2020). Periodo `2020T2` no tiene microdatos (gap ETOE).",
    request: { params: TablaParam, query: z.object({ ...paramsComunes, include_extras: z.boolean().default(true).describe("Incluir columna extras_jsonb (default true)."), page: z.number().int().min(1).default(1).describe("Página, 1-indexed."), per_page: z.number().int().min(1).max(1000).default(100).describe("Filas por página, máximo 1000.") }) },
    responses: { ...ok("Página de microdatos.", ListResponse), "422": { description: "Filtro `sex`/`eda_*` enviado a una tabla distinta de sdem, o `tabla` inválida." }, "429": { description: "Rate limit excedido (10 req/min por IP).", ...contentJson(z.object({ detail: z.string() })) } },
  };
  async handle(c: AppContext) {
    const tabla = validarTabla(c.req.param("tabla") ?? ""); const meta = META[tabla];
    const f = leerFiltros(c, tabla);
    const ie = c.req.query("include_extras"); const include_extras = ie === undefined ? true : ["true", "1", "yes", "on"].includes(ie.toLowerCase()) ? true : ["false", "0", "no", "off"].includes(ie.toLowerCase()) ? false : (() => { throw new ErrorHttp(422, [{ type: "bool_parsing", loc: ["query", "include_extras"], msg: "Input should be a valid boolean, unable to interpret input", input: ie } satisfies Detalle]); })();
    const page = enteroOpcional(c.req.query("page"), "page", 1) ?? 1, per_page = enteroOpcional(c.req.query("per_page"), "per_page", 1, 1000) ?? 100;
    const w = where(tabla, f);
    const cols = include_extras ? "*" : tabla === "sdem" ? CORE_SDEM.join(", ") : "*";
    const db = sql(c); const t0 = Date.now();
    try {
      const total = Number((await db.unsafe(`SELECT count(*) AS total FROM enoe.${meta.real} WHERE ${w.texto}`, w.params as never[]))[0].total);
      const rows = await db.unsafe(`SELECT ${cols} FROM enoe.${meta.real} WHERE ${w.texto} ORDER BY ${meta.pk.join(", ")} LIMIT $${w.params.length + 1} OFFSET $${w.params.length + 2}`, [...w.params, per_page, (page - 1) * per_page] as never[]);
      const ms = redondear(Date.now() - t0, 2);
      const total_pages = total > 0 ? Math.floor((total + per_page - 1) / per_page) : 0;
      const data = rows.map((r) => { const o = { ...r } as Record<string, unknown>; if (typeof o.periodo === "string") o.periodo = o.periodo.trim(); return o; });
      return { tabla: meta.real, filtros: { ...eco(f), include_extras }, pagination: { total, page, per_page, total_pages, has_next: page < total_pages, has_previous: page > 1 }, data, caveats: caveatsMicro(f.periodo), source: SOURCE_ENOE, tiempo_query_ms: ms };
    } finally { c.executionCtx.waitUntil(db.end({ timeout: 5 })); }
  }
}

// ---------------------------------------------------------------- 16. count
export class MicrodatosCount extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_microdatos_count_api_v1_enoe_microdatos__tabla__count_get", summary: "Conteo exacto de microdatos con filtros",
    description: "Conteo EXACTO (count(*)) de filas de microdatos que coinciden con los filtros. Mismos filtros que `/microdatos/{tabla}/list`.\n\n**SLA:** <200ms con filtro `periodo` + `entidad_clave`.\n\n**Uso típico:** prelookup antes de paginar — saber cuántas filas existen sin descargar las filas.",
    request: { params: TablaParam, query: z.object({ ...paramsComunes, entidad_clave: paramsComunes.entidad_clave.describe("Clave INEGI '01'..'32'. Opcional pero recomendado para SLA."), sex: paramsComunes.sex.describe("Solo sdem."), eda_min: paramsComunes.eda_min.describe("Solo sdem."), eda_max: paramsComunes.eda_max.describe("Solo sdem.") }) },
    responses: { ...ok("Conteo exacto + eco de filtros + caveat opcional.", z.object({ tabla: z.string(), filtros: z.record(z.string(), z.unknown()), total: z.number().int(), caveat_metodologico: z.string().nullable().default(null), source: z.string() })), "422": { description: "Filtro `sex`/`eda_*` enviado a una tabla distinta de sdem." }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const tabla = validarTabla(c.req.param("tabla") ?? ""); const meta = META[tabla];
    const f = leerFiltros(c, tabla); const w = where(tabla, f);
    const db = sql(c);
    try {
      const total = Number((await db.unsafe(`SELECT count(*) AS total FROM enoe.${meta.real} WHERE ${w.texto}`, w.params as never[]))[0].total);
      return { tabla: meta.real, filtros: eco(f), total, caveat_metodologico: f.periodo === "2020T2" ? "Periodo 2020T2 no tiene microdatos descargables (ETOE telefónica sustituyó al ENOE presencial por COVID-19; INEGI solo publicó agregados). Esperar total=0." : null, source: SOURCE_ENOE };
    } finally { c.executionCtx.waitUntil(db.end({ timeout: 5 })); }
  }
}

// ---------------------------------------------------------------- 17. schema
const ColumnaSchema = z.object({ nombre: z.string(), tipo: z.string(), nullable: z.boolean(), descripcion: z.string().nullable().default(null) });
export class MicrodatosSchema extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_microdatos_schema_api_v1_enoe_microdatos__tabla__schema_get", summary: "Schema de una tabla de microdatos",
    description: "Lista las columnas, tipos, PK e indexes de una tabla de microdatos. Se incluye total de filas (EXACTO desde enoe.estadisticas_globales).\n\n**Uso:** inspeccionar columnas disponibles antes de construir queries vía `/list`. Las columnas core (PK, fac_tri, etapa) traen descripción; las demás se documentan en INEGI Reconstrucción de variables 2023.\n\n**SLA:** <100ms (lectura de catálogos del sistema).",
    request: { params: TablaParam },
    responses: { ...ok("Metadata estructural de la tabla de microdatos.", z.object({ tabla: z.string(), total_columnas: z.number().int(), total_filas: z.number().int(), cobertura_temporal: z.string().nullable(), columnas: z.array(ColumnaSchema), pk: z.array(z.string()), indexes: z.array(z.string()), caveat_metodologico: z.string().nullable().default(null) })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const tabla = validarTabla(c.req.param("tabla") ?? ""); const meta = META[tabla];
    const db = sql(c);
    try {
      const cols = await db.unsafe("SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_schema = 'enoe' AND table_name = $1 ORDER BY ordinal_position", [meta.real] as never[]);
      const idx = await db.unsafe("SELECT i.relname AS index_name FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_class t ON t.oid = ix.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'enoe' AND t.relname = $1 AND NOT ix.indisprimary ORDER BY i.relname", [meta.real] as never[]);
      const st = await db.unsafe("SELECT total_filas, cobertura_temporal FROM enoe.estadisticas_globales WHERE tabla = $1", [meta.real] as never[]);
      const tipo = (dt: string, len: number | null) => (dt === "character" || dt === "character varying") && len ? `character ${dt === "character varying" ? "varying" : ""}(${len})`.replace("  ", " ").trim() : dt;
      return {
        tabla: meta.real, total_columnas: cols.length, total_filas: st.length ? Number(st[0].total_filas) : 0, cobertura_temporal: st.length ? (st[0].cobertura_temporal as string | null) : null,
        columnas: cols.map((r) => ({ nombre: r.column_name as string, tipo: tipo(r.data_type as string, r.character_maximum_length as number | null), nullable: r.is_nullable === "YES", descripcion: DESCRIPCIONES[r.column_name as string] ?? null })),
        pk: meta.pk, indexes: idx.map((r) => r.index_name as string),
        caveat_metodologico: "Las columnas no listadas con descripción siguen los identificadores INEGI documentados en Reconstrucción de variables 2023 (https://www.inegi.org.mx/contenidos/programas/enoe/15ymas/doc/recons_var_15ymas.pdf). extras_jsonb contiene las columnas DBF que no se promovieron a typed.",
      };
    } finally { c.executionCtx.waitUntil(db.end({ timeout: 5 })); }
  }
}

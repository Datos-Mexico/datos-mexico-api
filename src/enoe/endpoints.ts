// ENOE — endpoints 1 a 14 del legacy (catálogos, metadata, indicadores agregados y distribuciones).
// Los 3 endpoints de microdatos (/microdatos/{tabla}/list|count|schema) dependen de las tablas de 54 GB,
// fuera del límite de D1; se resolverán en la fase R2.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import { redondear } from "../lib/numeros";
import { repr } from "../lib/texto";
import { enteroOpcional } from "../lib/validacion";
import type { Detalle } from "../lib/validacion";
import { CAVEATS_BY_SLUG, CAVEATS_GLOBALES, CAVEAT_DOMINIO_15PLUS, CAVEAT_ETAPA_CAMBIO_MARCO, CAVEAT_GAP_2020T2, CAVEAT_TCCO_REDEFINICION, CAVEAT_TIL1_INFORMALIDAD, ETAPAS_DEFS, INDICADORES_CONTEO, INDICADORES_DEFS, INDICADORES_SENSIBLES_DOMINIO, INDICADOR_BY_SLUG, POSICION_NOMBRE, SCHEMA_READY, SECTOR_NOMBRE, SOURCE_ENOE, SOURCE_RECONS_VARIABLES, TABLA_DESCRIPCIONES, URL_ENOE } from "./constantes";
import type { Caveat } from "./constantes";

const TAG = ["enoe"];
const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const E404 = (d: string) => ({ "404": { description: d, ...contentJson(z.object({ detail: z.string() })) } });
const CaveatZ = z.object({ slug: z.string(), titulo: z.string(), descripcion: z.string(), periodo_aplicable: z.string(), referencia: z.string() });
const CoberturaSerie = z.object({ desde: z.string().nullable(), hasta: z.string().nullable(), n_observaciones: z.number().int() });

// ---- helpers de validación (mismos mensajes que el legacy)
const PERIODO_RE = /^(20\d{2})T([1-4])$/;
function requerido(get: (k: string) => string | undefined, ...nombres: string[]) {
  const faltan: Detalle[] = nombres.filter((n) => get(n) === undefined).map((n) => ({ type: "missing", loc: ["query", n], msg: "Field required", input: null }));
  if (faltan.length) throw new ErrorHttp(422, faltan);
}
function validarPeriodo(p: string | undefined, nombre: string): string | null {
  if (p === undefined) return null;
  if (!PERIODO_RE.test(p)) throw new ErrorHttp(422, `'${nombre}' debe ser 'YYYYTQ' (ej. '2025T1'); recibido: ${repr(p)}`);
  return p;
}
function validarEtapa(e: string | undefined): string | null {
  if (e === undefined) return null;
  if (!["clasica", "etoe_telefonica", "enoe_n"].includes(e)) throw new ErrorHttp(422, `'etapa' debe ser una de: clasica, etoe_telefonica, enoe_n; recibido: ${repr(e)}`);
  return e;
}
function validarIndicador(slug: string) {
  const d = INDICADOR_BY_SLUG.get(slug);
  if (!d) throw new ErrorHttp(404, `indicador ${repr(slug)} no existe. Slugs válidos: ${[...INDICADOR_BY_SLUG.keys()].sort().join(", ")}. Consultar GET /api/v1/enoe/catalogos/indicadores.`);
  return d;
}
function validarDesdeHasta(desde: string | null, hasta: string | null) {
  if (desde !== null && hasta !== null && desde > hasta) throw new ErrorHttp(422, `'desde' (${desde}) debe ser <= 'hasta' (${hasta})`);
}
function intersecta(desde: string | null, hasta: string | null, pMin: string, pMax: string) {
  const d = desde ?? "0000T1", h = hasta ?? "9999T4";
  return !(h < pMin || d > pMax);
}
function caveatsIndicador(slug: string, desde: string | null = null, hasta: string | null = null): Caveat[] {
  const out: Caveat[] = [];
  if (["informales_total", "tasa_informalidad_til1"].includes(slug)) out.push(CAVEAT_TIL1_INFORMALIDAD);
  if (["condcrit_total", "tasa_ocupacion_critica_tcco"].includes(slug)) out.push(CAVEAT_TCCO_REDEFINICION);
  if (INDICADORES_SENSIBLES_DOMINIO.has(slug) && intersecta(desde, hasta, "2005T1", "2020T1")) out.push(CAVEAT_DOMINIO_15PLUS);
  if (INDICADORES_CONTEO.has(slug) && intersecta(desde, hasta, "2020T3", "2021T4")) out.push(CAVEAT_ETAPA_CAMBIO_MARCO);
  if (intersecta(desde, hasta, "2020T2", "2020T2")) out.push(CAVEAT_GAP_2020T2);
  return out;
}
function caveatsDistribucion(desde: string | null = null, hasta: string | null = null): Caveat[] {
  const out: Caveat[] = [];
  if (intersecta(desde, hasta, "2005T1", "2020T1")) out.push(CAVEAT_DOMINIO_15PLUS);
  if (intersecta(desde, hasta, "2020T3", "2021T4")) out.push(CAVEAT_ETAPA_CAMBIO_MARCO);
  if (intersecta(desde, hasta, "2020T2", "2020T2")) out.push(CAVEAT_GAP_2020T2);
  return out;
}
function validarNivel(n: string) { if (!["nacional", "entidad"].includes(n)) throw new ErrorHttp(422, `'nivel' debe ser 'nacional' o 'entidad'; recibido: ${repr(n)}`); }
function resolverGeo(nivel: string, geo: string | undefined): string {
  if (nivel === "nacional") return "00";
  if (geo === undefined) throw new ErrorHttp(422, "'geo_clave' es obligatorio cuando nivel='entidad' (claves '01'..'32').");
  if (!/^[0-3][0-9]$/.test(geo) || !("01" <= geo && geo <= "32")) throw new ErrorHttp(422, `'geo_clave' debe ser '01'..'32'; recibido: ${repr(geo)}`);
  return geo;
}
/** Timestamp de Postgres ('2026-05-09 23:06:32.924288+00') → isoformat de Python con Z. */
function isoZ(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?/.exec(v);
  if (!m) return v;
  let frac = m[3] ? m[3].slice(1).padEnd(6, "0").slice(0, 6) : "";
  if (/^0+$/.test(frac)) frac = "";
  return `${m[1]}T${m[2]}${frac ? "." + frac : ""}Z`;
}
const SQL_ENTIDAD_META = "SELECT clave, nombre, abreviatura FROM cat_entidad WHERE clave = ?1";
type Ent = { clave: string; nombre: string; abreviatura: string | null };

// ---------------------------------------------------------------- 1. health
const EnoeHealth = z.object({ status: z.string(), ultimo_periodo: z.string().nullable(), ultima_carga: z.string().nullable(), total_microdatos: z.number().int(), total_indicadores_agregados: z.number().int(), cobertura_temporal: z.string().nullable() });
export class EnoeHealthEndpoint extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_enoe_health_api_v1_enoe_health_get", summary: "Status operacional del dataset ENOE",
    description: "Verifica conectividad a la base de datos, último periodo cargado, timestamp de la última carga exitosa y totales de microdatos + indicadores agregados. Si la base no es alcanzable retorna HTTP 503. Los counts provienen de la tabla pre-computada `enoe.estadisticas_globales` (refrescada al final de cada script ETL — migration 033).",
    responses: { ...ok("Servicio ENOE operativo.", EnoeHealth), ...RESP_429, "503": { description: "Base de datos no alcanzable." } },
  };
  async handle(c: AppContext) {
    let r: Record<string, unknown> | null;
    try {
      r = await fila(c.env.DB_ENOE, `
SELECT (SELECT max(finalizado_en) FROM cargas WHERE status = 'success') AS ultima_carga, eg.total_microdatos, eg.total_agregados, eg.primer_periodo, eg.ultimo_periodo
FROM (SELECT COALESCE(SUM(CASE WHEN es_microdatos THEN total_filas END), 0) AS total_microdatos, COALESCE(SUM(CASE WHEN NOT es_microdatos THEN total_filas END), 0) AS total_agregados,
             MIN(CASE WHEN es_microdatos THEN primer_periodo END) AS primer_periodo, MAX(CASE WHEN es_microdatos THEN ultimo_periodo END) AS ultimo_periodo FROM estadisticas_globales) eg`);
    } catch (e) { throw new ErrorHttp(503, `ENOE health check failed: ${(e as Error).message}`); }
    const primer = r!.primer_periodo as string | null, ultimo = r!.ultimo_periodo as string | null;
    return { status: "ok", ultimo_periodo: ultimo, ultima_carga: isoZ(r!.ultima_carga as string | null), total_microdatos: Number(r!.total_microdatos), total_indicadores_agregados: Number(r!.total_agregados), cobertura_temporal: primer && ultimo ? `${primer}-${ultimo}` : null };
  }
}

// ---------------------------------------------------------------- 2. metadata
const TablaDisponible = z.object({ nombre: z.string(), descripcion: z.string(), n_filas: z.number().int(), has_data: z.boolean(), status: z.enum(["available", "schema-ready", "deprecated"]).default("available") });
const EnoeMetadata = z.object({ nombre: z.string(), acronimo: z.string(), fuente: z.string(), fuente_url: z.string(), periodicidad: z.string(), cobertura_temporal: z.string(), cobertura_geografica: z.string(), n_trimestres_disponibles: z.number().int(), n_indicadores: z.number().int(), n_entidades: z.number().int(), etapas_metodologicas: z.array(z.string()), tablas_disponibles: z.array(TablaDisponible), total_microdatos: z.number().int(), total_agregados: z.number().int(), caveats: z.array(CaveatZ), sources: z.array(z.string()), last_updated: z.string().nullable() });
export class EnoeMetadataEndpoint extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_enoe_metadata_api_v1_enoe_metadata_get", summary: "Metadata completa del dataset ENOE",
    description: "Información sobre fuente, periodicidad, cobertura temporal y geográfica, tablas disponibles con conteo de filas y `status` de disponibilidad, etapas metodológicas y caveats interpretativos. Los counts provienen de la tabla pre-computada `enoe.estadisticas_globales` (migration 033).\n\n**Sobre `tablas_disponibles[].status`**: el campo señaliza la disponibilidad efectiva de cada tabla del schema:\n- `available` — tabla con datos ingestados.\n- `schema-ready` — tabla creada pero aún sin datos (roadmap futuro). Las tablas `indicadores_area_metropolitana` e `indicadores_anuales_ampliado` están en este estado: schema completo, ingesta posterior pendiente. Cualquier endpoint que intente consumirlas regresará respuestas vacías hasta entonces.\n- `deprecated` — reservado para uso futuro.\n\nEl booleano `has_data` se mantiene por compatibilidad con consumidores existentes; es derivable de `status` (`status == 'available'` ⇔ `has_data is True`).",
    responses: { ...ok("Metadata completa del dataset ENOE.", EnoeMetadata), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const meta = (await fila<Record<string, unknown>>(c.env.DB_ENOE, `
SELECT (SELECT min(periodo) FROM indicadores_nacionales) AS primer_periodo, (SELECT max(periodo) FROM indicadores_nacionales) AS ultimo_periodo,
       (SELECT count(DISTINCT periodo) FROM indicadores_nacionales) AS n_trimestres, (SELECT count(*) FROM cat_entidad) AS n_entidades,
       (SELECT max(finalizado_en) FROM cargas WHERE status = 'success') AS ultima_carga`))!;
    const tablas = await filas<{ tabla: string; total_filas: number; es_microdatos: number }>(c.env.DB_ENOE, "SELECT tabla, total_filas, es_microdatos FROM estadisticas_globales");
    const conteos = new Map(tablas.map((t) => [t.tabla, Number(t.total_filas)]));
    return {
      nombre: "Encuesta Nacional de Ocupación y Empleo", acronimo: "ENOE", fuente: "INEGI", fuente_url: URL_ENOE, periodicidad: "Trimestral",
      cobertura_temporal: `${meta.primer_periodo}-${meta.ultimo_periodo} (${Number(meta.n_trimestres)} trimestres con datos; gap documental en 2020T2)`,
      cobertura_geografica: "Nacional + 32 entidades federativas", n_trimestres_disponibles: Number(meta.n_trimestres), n_indicadores: INDICADORES_DEFS.length, n_entidades: Number(meta.n_entidades),
      etapas_metodologicas: ETAPAS_DEFS.map((e) => e.slug),
      tablas_disponibles: TABLA_DESCRIPCIONES.map(([t, d]) => ({ nombre: t, descripcion: d, n_filas: conteos.get(t) ?? 0, has_data: (conteos.get(t) ?? 0) > 0, status: SCHEMA_READY.has(t) ? "schema-ready" : "available" })),
      total_microdatos: tablas.filter((t) => t.es_microdatos).reduce((s, t) => s + Number(t.total_filas), 0),
      total_agregados: tablas.filter((t) => !t.es_microdatos).reduce((s, t) => s + Number(t.total_filas), 0),
      caveats: CAVEATS_GLOBALES, sources: [SOURCE_ENOE, SOURCE_RECONS_VARIABLES], last_updated: isoZ(meta.ultima_carga as string | null),
    };
  }
}

// ---------------------------------------------------------------- 3-5. catálogos
const IndicadorCatalogo = z.object({ slug: z.string(), nombre: z.string(), descripcion: z.string(), unidad: z.string(), categoria: z.string(), formula: z.string(), fuente_metodologica: z.string(), n_observaciones_nacional: z.number().int(), n_observaciones_entidad: z.number().int(), cobertura_temporal: z.string(), caveat_metodologico: z.string().nullable().default(null) });
export class CatalogoIndicadores extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_catalogo_indicadores_api_v1_enoe_catalogos_indicadores_get", summary: "Catálogo de los 13 indicadores disponibles",
    description: "Lista los 13 indicadores del observatorio (8 conteos poblacionales + 5 tasas) con su fórmula INEGI (Reconstrucción de variables 2023), cobertura temporal observada y caveat metodológico aplicable. Reutilizable como fuente para dropdowns en el frontend.",
    responses: { ...ok("Catálogo de 13 indicadores con cobertura.", z.object({ count: z.number().int(), indicadores: z.array(IndicadorCatalogo), source: z.string() })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const nac = new Map((await filas<{ indicador: string; n: number; periodo_min: string; periodo_max: string }>(c.env.DB_ENOE, "SELECT indicador, COUNT(*) AS n, MIN(periodo) AS periodo_min, MAX(periodo) AS periodo_max FROM indicadores_nacionales GROUP BY indicador")).map((r) => [r.indicador, r]));
    const ent = new Map((await filas<{ indicador: string; n: number }>(c.env.DB_ENOE, "SELECT indicador, COUNT(*) AS n FROM indicadores_entidad GROUP BY indicador")).map((r) => [r.indicador, Number(r.n)]));
    const indicadores = INDICADORES_DEFS.map((d) => {
      const n = nac.get(d.slug); const cv = d.caveat_slug ? CAVEATS_BY_SLUG.get(d.caveat_slug) : undefined;
      return { slug: d.slug, nombre: d.nombre, descripcion: d.descripcion, unidad: d.unidad, categoria: d.categoria, formula: d.formula, fuente_metodologica: SOURCE_RECONS_VARIABLES, n_observaciones_nacional: n ? Number(n.n) : 0, n_observaciones_entidad: ent.get(d.slug) ?? 0, cobertura_temporal: n ? `${n.periodo_min}-${n.periodo_max}` : "sin observaciones", caveat_metodologico: cv ? `${cv.titulo} (${cv.slug}): ${cv.descripcion}` : null };
    });
    return { count: indicadores.length, indicadores, source: SOURCE_ENOE };
  }
}
const EntidadCatalogo = z.object({ clave: z.string(), nombre: z.string(), abreviatura: z.string().nullable().default(null) });
export class CatalogoEntidades extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_catalogo_entidades_api_v1_enoe_catalogos_entidades_get", summary: "Catálogo de las 32 entidades federativas",
    description: "Lista las 32 entidades federativas de México con clave AGEE INEGI 2020 (CHAR(2) '01'..'32'), nombre oficial y abreviatura usada en boletines INEGI. Replica el catálogo de enigh.cat_entidad.",
    responses: { ...ok("32 entidades federativas.", z.object({ count: z.number().int(), entidades: z.array(EntidadCatalogo), source: z.string() })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const entidades = await filas<Ent>(c.env.DB_ENOE, "SELECT clave, nombre, abreviatura FROM cat_entidad ORDER BY clave");
    return { count: entidades.length, entidades, source: SOURCE_ENOE };
  }
}
const EtapaZ = z.object({ slug: z.string(), nombre: z.string(), descripcion: z.string(), periodo_inicio: z.string(), periodo_fin: z.string().nullable().default(null), dominio_edad: z.string(), n_trimestres: z.number().int(), tiene_microdatos: z.boolean(), caveat_aplicable: z.string().nullable().default(null) });
export class CatalogoEtapas extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_catalogo_etapas_api_v1_enoe_catalogos_etapas_metodologicas_get", summary: "Catálogo de las 3 etapas metodológicas del ENOE",
    description: "Las 3 etapas metodológicas que conviven en la serie histórica: clasica (2005T1-2020T1, marco pre-Censo 2020), etoe_telefonica (solo 2020T2, sin microdatos), y enoe_n (2020T3-presente, marco post-Censo 2020). Coherente con el ENUM enoe.etapa_metodologica (migration 031).",
    responses: { ...ok("3 etapas metodológicas con su rango.", z.object({ count: z.number().int(), etapas: z.array(EtapaZ), source: z.string() })), ...RESP_429 },
  };
  async handle() { return { count: ETAPAS_DEFS.length, etapas: ETAPAS_DEFS, source: SOURCE_ENOE }; }
}

// ---------------------------------------------------------------- 6-7. nacional
const PuntoNacional = z.object({ periodo: z.string(), valor: z.number(), etapa: z.string() });
const SerieNacionalResponse = z.object({ indicador: z.string(), nombre: z.string(), unidad: z.string(), categoria: z.string(), cobertura: CoberturaSerie, datos: z.array(PuntoNacional), caveats: z.array(CaveatZ), source: z.string(), source_url: z.string() });
const cobertura = (datos: { periodo: string }[]) => ({ desde: datos.length ? datos[0].periodo : null, hasta: datos.length ? datos[datos.length - 1].periodo : null, n_observaciones: datos.length });
export class NacionalSerie extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_indicador_nacional_serie_api_v1_enoe_indicadores_nacional_serie_get", summary: "Serie temporal nacional de un indicador",
    description: "Retorna la serie temporal nacional de un indicador, opcionalmente filtrada por rango de periodos (`desde`/`hasta` en formato YYYYTQ) o etapa metodológica. Caveats inyectados dinámicamente según el indicador y el rango (gap 2020T2, dominio 15+, cambio de marco 2020T3, redefinición TIL1/TCCO).",
    request: { query: z.object({ indicador: z.string().describe("Slug del indicador (ej. tasa_desocupacion)"), desde: z.string().optional().describe("Periodo inicial YYYYTQ (default: primer punto)"), hasta: z.string().optional().describe("Periodo final YYYYTQ (default: último punto)"), etapa: z.string().optional().describe("Filtro: clasica | etoe_telefonica | enoe_n") }) },
    responses: { ...ok("Serie temporal nacional con caveats inyectados.", SerieNacionalResponse), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = (k: string) => c.req.query(k); requerido(q, "indicador");
    const defn = validarIndicador(q("indicador")!); const desde = validarPeriodo(q("desde"), "desde"), hasta = validarPeriodo(q("hasta"), "hasta"), etapa = validarEtapa(q("etapa")); validarDesdeHasta(desde, hasta);
    const rows = await filas<{ periodo: string; valor: number; etapa: string }>(c.env.DB_ENOE, "SELECT periodo, valor, etapa FROM indicadores_nacionales WHERE indicador = ?1 AND (?2 IS NULL OR periodo >= ?2) AND (?3 IS NULL OR periodo <= ?3) AND (?4 IS NULL OR etapa = ?4) ORDER BY periodo", [defn.slug, desde, hasta, etapa]);
    const datos = rows.map((r) => ({ periodo: r.periodo, valor: redondear(Number(r.valor), 6), etapa: r.etapa }));
    return { indicador: defn.slug, nombre: defn.nombre, unidad: defn.unidad, categoria: defn.categoria, cobertura: cobertura(datos), datos, caveats: caveatsIndicador(defn.slug, desde, hasta), source: SOURCE_ENOE, source_url: URL_ENOE };
  }
}
const IndicadorSnapshot = z.object({ indicador: z.string(), nombre: z.string(), unidad: z.string(), valor: z.number() });
export class NacionalSnapshot extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_indicador_nacional_snapshot_api_v1_enoe_indicadores_nacional_snapshot_get", summary: "Todos los indicadores nacionales en un periodo",
    description: "Retorna los 13 indicadores nacionales calculados para el periodo indicado (YYYYTQ). HTTP 404 si el periodo no tiene datos (típicamente 2020T2 — sin microdatos por ETOE — o periodos futuros).",
    request: { query: z.object({ periodo: z.string().describe("Periodo YYYYTQ (ej. 2025T1)") }) },
    responses: { ...ok("Snapshot de los 13 indicadores en un periodo.", z.object({ periodo: z.string(), etapa: z.string(), n_indicadores: z.number().int(), indicadores: z.array(IndicadorSnapshot), caveats: z.array(CaveatZ), source: z.string() })), ...E404("Sin datos para ese periodo (2020T2 gap o periodo futuro)."), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = (k: string) => c.req.query(k); requerido(q, "periodo");
    const periodo = validarPeriodo(q("periodo"), "periodo")!;
    const rows = await filas<{ indicador: string; valor: number; unidad: string; etapa: string }>(c.env.DB_ENOE, "SELECT indicador, valor, unidad, etapa FROM indicadores_nacionales WHERE periodo = ?1 ORDER BY indicador", [periodo]);
    if (!rows.length) throw new ErrorHttp(404, `No hay datos para periodo=${repr(periodo)} (cobertura: 2005T1-2026T2, gap 2020T2). Consultar GET /api/v1/enoe/health para últimos valores.`);
    const cv = new Map<string, Caveat>();
    for (const r of rows) for (const cvt of caveatsIndicador(r.indicador, periodo, periodo)) if (!cv.has(cvt.slug)) cv.set(cvt.slug, cvt);
    return { periodo, etapa: rows[0].etapa, n_indicadores: rows.length, indicadores: rows.map((r) => ({ indicador: r.indicador, nombre: INDICADOR_BY_SLUG.get(r.indicador)?.nombre ?? r.indicador, unidad: r.unidad, valor: redondear(Number(r.valor), 6) })), caveats: [...cv.values()], source: SOURCE_ENOE };
  }
}

// ---------------------------------------------------------------- 8-10. entidad
const PuntoEntidad = z.object({ periodo: z.string(), valor: z.number(), etapa: z.string() });
const SerieEntidadResponse = z.object({ indicador: z.string(), nombre: z.string(), unidad: z.string(), categoria: z.string(), entidad_clave: z.string(), entidad_nombre: z.string(), entidad_abreviatura: z.string().nullable().default(null), cobertura: CoberturaSerie, datos: z.array(PuntoEntidad), caveats: z.array(CaveatZ), source: z.string() });
export class EntidadSerie extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_indicador_entidad_serie_api_v1_enoe_indicadores_entidad_serie_get", summary: "Serie temporal de un indicador para una entidad federativa",
    description: "Retorna la serie temporal de un indicador para la entidad indicada (`entidad_clave` de 2 dígitos, ej. '09' para CDMX). Filtros opcionales `desde`/`hasta` (YYYYTQ) y `etapa`. HTTP 404 si la entidad no existe.",
    request: { query: z.object({ indicador: z.string().describe("Slug del indicador"), entidad_clave: z.string().describe("Clave INEGI 2 dígitos (ej. '09' = CDMX)"), desde: z.string().optional().describe("Periodo inicial YYYYTQ"), hasta: z.string().optional().describe("Periodo final YYYYTQ"), etapa: z.string().optional().describe("Filtro: clasica | etoe_telefonica | enoe_n") }) },
    responses: { ...ok("Serie temporal por entidad federativa.", SerieEntidadResponse), ...E404("`entidad_clave` no existe en el catálogo."), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = (k: string) => c.req.query(k); requerido(q, "indicador", "entidad_clave");
    const defn = validarIndicador(q("indicador")!); const desde = validarPeriodo(q("desde"), "desde"), hasta = validarPeriodo(q("hasta"), "hasta"), etapa = validarEtapa(q("etapa")); validarDesdeHasta(desde, hasta);
    const clave = q("entidad_clave")!;
    const ent = await fila<Ent>(c.env.DB_ENOE, SQL_ENTIDAD_META, [clave]);
    if (!ent) throw new ErrorHttp(404, `entidad_clave ${repr(clave)} no existe. Las claves válidas son '01'..'32' (AGEE INEGI). Consultar GET /api/v1/enoe/catalogos/entidades.`);
    const rows = await filas<{ periodo: string; valor: number; etapa: string }>(c.env.DB_ENOE, "SELECT periodo, valor, etapa FROM indicadores_entidad WHERE indicador = ?1 AND entidad_clave = ?2 AND (?3 IS NULL OR periodo >= ?3) AND (?4 IS NULL OR periodo <= ?4) AND (?5 IS NULL OR etapa = ?5) ORDER BY periodo", [defn.slug, clave, desde, hasta, etapa]);
    const datos = rows.map((r) => ({ periodo: r.periodo, valor: redondear(Number(r.valor), 6), etapa: r.etapa }));
    return { indicador: defn.slug, nombre: defn.nombre, unidad: defn.unidad, categoria: defn.categoria, entidad_clave: ent.clave, entidad_nombre: ent.nombre, entidad_abreviatura: ent.abreviatura, cobertura: cobertura(datos), datos, caveats: caveatsIndicador(defn.slug, desde, hasta), source: SOURCE_ENOE };
  }
}
const PuntoSnapshotEntidad = z.object({ entidad_clave: z.string(), entidad_nombre: z.string(), entidad_abreviatura: z.string().nullable().default(null), valor: z.number() });
export class EntidadSnapshot extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_indicador_entidad_snapshot_api_v1_enoe_indicadores_entidad_snapshot_get", summary: "Un indicador en un periodo para las 32 entidades federativas",
    description: "Retorna el valor del indicador para cada una de las 32 entidades en el periodo dado, ordenado por clave AGEE. HTTP 404 si periodo o indicador no tienen datos.",
    request: { query: z.object({ periodo: z.string().describe("Periodo YYYYTQ"), indicador: z.string().describe("Slug del indicador") }) },
    responses: { ...ok("Snapshot por entidad de un indicador.", z.object({ periodo: z.string(), etapa: z.string(), indicador: z.string(), nombre: z.string(), unidad: z.string(), categoria: z.string(), n_entidades: z.number().int(), datos: z.array(PuntoSnapshotEntidad), caveats: z.array(CaveatZ), source: z.string() })), ...E404("Sin datos para ese periodo/indicador."), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = (k: string) => c.req.query(k); requerido(q, "periodo", "indicador");
    const periodo = validarPeriodo(q("periodo"), "periodo")!; const defn = validarIndicador(q("indicador")!);
    const rows = await filas<{ entidad_clave: string; entidad_nombre: string; entidad_abreviatura: string | null; valor: number; etapa: string }>(c.env.DB_ENOE, "SELECT ie.entidad_clave, ce.nombre AS entidad_nombre, ce.abreviatura AS entidad_abreviatura, ie.valor AS valor, ie.etapa AS etapa FROM indicadores_entidad ie JOIN cat_entidad ce ON ce.clave = ie.entidad_clave WHERE ie.periodo = ?1 AND ie.indicador = ?2 ORDER BY ie.entidad_clave", [periodo, defn.slug]);
    if (!rows.length) throw new ErrorHttp(404, `No hay datos para periodo=${repr(periodo)} indicador=${repr(defn.slug)} (cobertura: 2005T1-2026T2, gap 2020T2).`);
    return { periodo, etapa: rows[0].etapa, indicador: defn.slug, nombre: defn.nombre, unidad: defn.unidad, categoria: defn.categoria, n_entidades: rows.length, datos: rows.map((r) => ({ entidad_clave: r.entidad_clave, entidad_nombre: r.entidad_nombre, entidad_abreviatura: r.entidad_abreviatura, valor: redondear(Number(r.valor), 6) })), caveats: caveatsIndicador(defn.slug, periodo, periodo), source: SOURCE_ENOE };
  }
}
const PuntoRanking = z.object({ rank: z.number().int(), entidad_clave: z.string(), entidad_nombre: z.string(), entidad_abreviatura: z.string().nullable().default(null), valor: z.number() });
export class EntidadRanking extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_indicador_entidad_ranking_api_v1_enoe_indicadores_entidad_ranking_get", summary: "Ranking de entidades por indicador en un periodo",
    description: "Top N entidades ordenadas por el valor del indicador. `orden=desc` (default) lista de mayor a menor valor (típico para tasa_desocupacion 'peor'); `orden=asc` lista de menor a mayor. `limit` ∈ [1, 32].",
    request: { query: z.object({ periodo: z.string().describe("Periodo YYYYTQ"), indicador: z.string().describe("Slug del indicador"), orden: z.string().default("desc").describe("'desc' (mayor primero) o 'asc' (menor primero)"), limit: z.number().int().min(1).max(32).default(5).describe("Tamaño del ranking, entre 1 y 32") }) },
    responses: { ...ok("Ranking de entidades por valor del indicador.", z.object({ periodo: z.string(), etapa: z.string(), indicador: z.string(), nombre: z.string(), unidad: z.string(), orden: z.string(), limit: z.number().int(), total_resultados: z.number().int(), ranking: z.array(PuntoRanking), caveats: z.array(CaveatZ), source: z.string() })), ...E404("Sin datos para ese periodo/indicador."), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = (k: string) => c.req.query(k); requerido(q, "periodo", "indicador");
    const limit = enteroOpcional(q("limit"), "limit", 1, 32) ?? 5;
    const periodo = validarPeriodo(q("periodo"), "periodo")!; const defn = validarIndicador(q("indicador")!); const orden = q("orden") ?? "desc";
    if (!["asc", "desc"].includes(orden)) throw new ErrorHttp(422, `'orden' debe ser 'asc' o 'desc'; recibido: ${repr(orden)}`);
    const rows = await filas<{ entidad_clave: string; entidad_nombre: string; entidad_abreviatura: string | null; valor: number; etapa: string }>(c.env.DB_ENOE, `SELECT ie.entidad_clave, ce.nombre AS entidad_nombre, ce.abreviatura AS entidad_abreviatura, ie.valor AS valor, ie.etapa AS etapa FROM indicadores_entidad ie JOIN cat_entidad ce ON ce.clave = ie.entidad_clave WHERE ie.periodo = ?1 AND ie.indicador = ?2 ORDER BY ie.valor ${orden === "desc" ? "DESC" : "ASC"}, ie.entidad_clave LIMIT ?3`, [periodo, defn.slug, limit]);
    if (!rows.length) throw new ErrorHttp(404, `No hay datos para periodo=${repr(periodo)} indicador=${repr(defn.slug)} (cobertura: 2005T1-2026T2, gap 2020T2).`);
    return { periodo, etapa: rows[0].etapa, indicador: defn.slug, nombre: defn.nombre, unidad: defn.unidad, orden, limit, total_resultados: rows.length, ranking: rows.map((r, i) => ({ rank: i + 1, entidad_clave: r.entidad_clave, entidad_nombre: r.entidad_nombre, entidad_abreviatura: r.entidad_abreviatura, valor: redondear(Number(r.valor), 6) })), caveats: caveatsIndicador(defn.slug, periodo, periodo), source: SOURCE_ENOE };
  }
}

// ---------------------------------------------------------------- 11-14. distribuciones
const PuntoSector = z.object({ periodo: z.string().nullable().default(null), sector_clave: z.string(), sector_nombre: z.string(), total_ocupados: z.number().int().describe("Personas ocupadas (factor expandido fac_tri)"), participacion_porcentaje: z.number().describe("% del total ocupados del nivel"), etapa: z.string().nullable().default(null) });
const PuntoPosicion = z.object({ periodo: z.string().nullable().default(null), pos_clave: z.number().int(), pos_nombre: z.string(), total_ocupados: z.number().int().describe("Personas ocupadas (factor expandido fac_tri)"), participacion_porcentaje: z.number().describe("% del total ocupados del nivel"), etapa: z.string().nullable().default(null) });
const Nivel = z.enum(["nacional", "entidad"]);
async function geoContexto(c: AppContext, nivel: string, geo: string | undefined, msg404: (g: string) => string) {
  const g = resolverGeo(nivel, geo); let nombre: string | null = null;
  if (nivel === "entidad") { const e = await fila<Ent>(c.env.DB_ENOE, SQL_ENTIDAD_META, [g]); if (!e) throw new ErrorHttp(404, msg404(g)); nombre = e.nombre; }
  return { g, geo_clave: nivel === "entidad" ? g : null, geo_nombre: nombre };
}
const m404corto = (g: string) => `entidad_clave ${repr(g)} no existe. Consultar GET /api/v1/enoe/catalogos/entidades.`;
export class SectorSnapshot extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_ocupados_por_sector_snapshot_api_v1_enoe_ocupados_por_sector_snapshot_get", summary: "Distribución sectorial de ocupados en un periodo",
    description: "Composición sectorial de la población ocupada en el periodo dado, a nivel nacional o para una entidad federativa. Cada sector incluye clave SCIAN agregada, nombre, conteo expandido (fac_tri) y % de participación sobre el total ocupado del nivel. Caveats inyectados según el periodo (CPV 2020, dominio 15+, gap 2020T2).",
    request: { query: z.object({ periodo: z.string().describe("Periodo YYYYTQ (ej. 2025T1)"), nivel: z.string().default("nacional").describe("'nacional' o 'entidad'"), geo_clave: z.string().optional().describe("Clave AGEE 2 dígitos (ej. '09'); obligatorio si nivel='entidad'") }) },
    responses: { ...ok("Composición sectorial nacional o por entidad.", z.object({ periodo: z.string(), etapa: z.string(), nivel: Nivel, geo_clave: z.string().nullable().default(null), geo_nombre: z.string().nullable().default(null), total_ocupados_nivel: z.number().int(), n_sectores: z.number().int(), distribucion: z.array(PuntoSector), caveats: z.array(CaveatZ), source: z.string(), source_url: z.string() })), ...E404("Sin datos o `geo_clave` inexistente."), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = (k: string) => c.req.query(k); requerido(q, "periodo");
    const periodo = validarPeriodo(q("periodo"), "periodo")!; const nivel = q("nivel") ?? "nacional"; validarNivel(nivel);
    const ctx = await geoContexto(c, nivel, q("geo_clave"), (g) => `entidad_clave ${repr(g)} no existe. Las claves válidas son '01'..'32'. Consultar GET /api/v1/enoe/catalogos/entidades.`);
    const rows = await filas<{ sector_clave: string; total_personas: number; pct_ocupados: number; etapa: string }>(c.env.DB_ENOE, "SELECT sector_clave, total_personas, pct_ocupados, etapa FROM poblacion_ocupada_por_sector WHERE periodo = ?1 AND nivel = ?2 AND geo_clave = ?3 ORDER BY sector_clave", [periodo, nivel, ctx.g]);
    if (!rows.length) throw new ErrorHttp(404, `No hay datos para periodo=${repr(periodo)} nivel=${repr(nivel)} geo_clave=${repr(ctx.g)} (cobertura: 2005T1-2026T2, gap 2020T2).`);
    const distribucion = rows.map((r) => ({ periodo: null, sector_clave: r.sector_clave, sector_nombre: SECTOR_NOMBRE.get(r.sector_clave) ?? `(sector ${r.sector_clave})`, total_ocupados: Number(r.total_personas), participacion_porcentaje: redondear(Number(r.pct_ocupados), 4), etapa: null }));
    return { periodo, etapa: rows[0].etapa, nivel, geo_clave: ctx.geo_clave, geo_nombre: ctx.geo_nombre, total_ocupados_nivel: rows.reduce((s, r) => s + Number(r.total_personas), 0), n_sectores: distribucion.length, distribucion, caveats: caveatsDistribucion(periodo, periodo), source: SOURCE_ENOE, source_url: URL_ENOE };
  }
}
export class SectorSerie extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_ocupados_por_sector_serie_api_v1_enoe_ocupados_por_sector_serie_get", summary: "Serie temporal de ocupación en un sector económico",
    description: "Trayectoria temporal de ocupados en un sector específico (clave SCIAN agregada '0'..'11'), nacional o para una entidad. Cada punto incluye conteo expandido y % de participación pre-calculado en DB. Caveats inyectados según el rango (cambio de marco 2020T3, dominio 15+, gap 2020T2).",
    request: { query: z.object({ sector_clave: z.string().describe("Clave SCIAN agregada '0'..'11'"), nivel: z.string().default("nacional").describe("'nacional' o 'entidad'"), geo_clave: z.string().optional().describe("Obligatorio si nivel='entidad'"), desde: z.string().optional().describe("Periodo inicial YYYYTQ"), hasta: z.string().optional().describe("Periodo final YYYYTQ") }) },
    responses: { ...ok("Serie temporal de ocupados en un sector.", z.object({ sector_clave: z.string(), sector_nombre: z.string(), nivel: Nivel, geo_clave: z.string().nullable().default(null), geo_nombre: z.string().nullable().default(null), cobertura: CoberturaSerie, datos: z.array(PuntoSector), caveats: z.array(CaveatZ), source: z.string() })), ...E404("`sector_clave` o `geo_clave` no existe."), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = (k: string) => c.req.query(k); requerido(q, "sector_clave");
    const sector = q("sector_clave")!;
    if (!SECTOR_NOMBRE.has(sector)) throw new ErrorHttp(404, `sector_clave ${repr(sector)} no existe. Válidas: ${[...SECTOR_NOMBRE.keys()].sort((a, b) => Number(a) - Number(b)).join(", ")}`);
    const nivel = q("nivel") ?? "nacional"; validarNivel(nivel); const g = resolverGeo(nivel, q("geo_clave"));
    const desde = validarPeriodo(q("desde"), "desde"), hasta = validarPeriodo(q("hasta"), "hasta"); validarDesdeHasta(desde, hasta);
    let geo_nombre: string | null = null;
    if (nivel === "entidad") { const e = await fila<Ent>(c.env.DB_ENOE, SQL_ENTIDAD_META, [g]); if (!e) throw new ErrorHttp(404, m404corto(g)); geo_nombre = e.nombre; }
    const rows = await filas<{ periodo: string; total_personas: number; pct_ocupados: number; etapa: string }>(c.env.DB_ENOE, "SELECT periodo, total_personas, pct_ocupados, etapa FROM poblacion_ocupada_por_sector WHERE sector_clave = ?1 AND nivel = ?2 AND geo_clave = ?3 AND (?4 IS NULL OR periodo >= ?4) AND (?5 IS NULL OR periodo <= ?5) ORDER BY periodo", [sector, nivel, g, desde, hasta]);
    const nombre = SECTOR_NOMBRE.get(sector)!;
    const datos = rows.map((r) => ({ periodo: r.periodo, sector_clave: sector, sector_nombre: nombre, total_ocupados: Number(r.total_personas), participacion_porcentaje: redondear(Number(r.pct_ocupados), 4), etapa: r.etapa }));
    return { sector_clave: sector, sector_nombre: nombre, nivel, geo_clave: nivel === "entidad" ? g : null, geo_nombre, cobertura: cobertura(datos), datos, caveats: caveatsDistribucion(desde, hasta), source: SOURCE_ENOE };
  }
}
export class PosicionSnapshot extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_ocupados_por_posicion_snapshot_api_v1_enoe_ocupados_por_posicion_snapshot_get", summary: "Distribución por posición laboral en un periodo",
    description: "Composición de la población ocupada por posición laboral (asalariados, empleadores, cuenta propia, no remunerados) en el periodo dado, a nivel nacional o por entidad. % participación pre-calculado en DB.",
    request: { query: z.object({ periodo: z.string().describe("Periodo YYYYTQ"), nivel: z.string().default("nacional").describe("'nacional' o 'entidad'"), geo_clave: z.string().optional().describe("Obligatorio si nivel='entidad'") }) },
    responses: { ...ok("Composición por posición laboral.", z.object({ periodo: z.string(), etapa: z.string(), nivel: Nivel, geo_clave: z.string().nullable().default(null), geo_nombre: z.string().nullable().default(null), total_ocupados_nivel: z.number().int(), n_posiciones: z.number().int(), distribucion: z.array(PuntoPosicion), caveats: z.array(CaveatZ), source: z.string(), source_url: z.string() })), ...E404("Sin datos o `geo_clave` inexistente."), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = (k: string) => c.req.query(k); requerido(q, "periodo");
    const periodo = validarPeriodo(q("periodo"), "periodo")!; const nivel = q("nivel") ?? "nacional"; validarNivel(nivel);
    const ctx = await geoContexto(c, nivel, q("geo_clave"), m404corto);
    const rows = await filas<{ pos_clave: number; total_personas: number; pct_ocupados: number; etapa: string }>(c.env.DB_ENOE, "SELECT pos_clave, total_personas, pct_ocupados, etapa FROM poblacion_ocupada_por_posicion WHERE periodo = ?1 AND nivel = ?2 AND geo_clave = ?3 ORDER BY pos_clave", [periodo, nivel, ctx.g]);
    if (!rows.length) throw new ErrorHttp(404, `No hay datos para periodo=${repr(periodo)} nivel=${repr(nivel)} geo_clave=${repr(ctx.g)} (cobertura: 2005T1-2026T2, gap 2020T2).`);
    const distribucion = rows.map((r) => ({ periodo: null, pos_clave: Number(r.pos_clave), pos_nombre: POSICION_NOMBRE.get(Number(r.pos_clave)) ?? `(posicion ${r.pos_clave})`, total_ocupados: Number(r.total_personas), participacion_porcentaje: redondear(Number(r.pct_ocupados), 4), etapa: null }));
    return { periodo, etapa: rows[0].etapa, nivel, geo_clave: ctx.geo_clave, geo_nombre: ctx.geo_nombre, total_ocupados_nivel: rows.reduce((s, r) => s + Number(r.total_personas), 0), n_posiciones: distribucion.length, distribucion, caveats: caveatsDistribucion(periodo, periodo), source: SOURCE_ENOE, source_url: URL_ENOE };
  }
}
export class PosicionSerie extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_ocupados_por_posicion_serie_api_v1_enoe_ocupados_por_posicion_serie_get", summary: "Serie temporal de ocupación en una posición laboral",
    description: "Trayectoria temporal de ocupados en una posición específica (1=subordinados, 2=empleadores, 3=cuenta propia, 4=no remunerados), nacional o por entidad.",
    request: { query: z.object({ pos_clave: z.number().int().min(1).max(4).describe("Clave posición 1..4"), nivel: z.string().default("nacional").describe("'nacional' o 'entidad'"), geo_clave: z.string().optional().describe("Obligatorio si nivel='entidad'"), desde: z.string().optional().describe("Periodo inicial YYYYTQ"), hasta: z.string().optional().describe("Periodo final YYYYTQ") }) },
    responses: { ...ok("Serie temporal por posición laboral.", z.object({ pos_clave: z.number().int(), pos_nombre: z.string(), nivel: Nivel, geo_clave: z.string().nullable().default(null), geo_nombre: z.string().nullable().default(null), cobertura: CoberturaSerie, datos: z.array(PuntoPosicion), caveats: z.array(CaveatZ), source: z.string() })), ...E404("`pos_clave` o `geo_clave` no existe."), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = (k: string) => c.req.query(k); requerido(q, "pos_clave");
    const pos = enteroOpcional(q("pos_clave"), "pos_clave", 1, 4)!;
    if (!POSICION_NOMBRE.has(pos)) throw new ErrorHttp(404, `pos_clave ${pos} no existe. Válidas: 1, 2, 3, 4`);
    const nivel = q("nivel") ?? "nacional"; validarNivel(nivel); const g = resolverGeo(nivel, q("geo_clave"));
    const desde = validarPeriodo(q("desde"), "desde"), hasta = validarPeriodo(q("hasta"), "hasta"); validarDesdeHasta(desde, hasta);
    let geo_nombre: string | null = null;
    if (nivel === "entidad") { const e = await fila<Ent>(c.env.DB_ENOE, SQL_ENTIDAD_META, [g]); if (!e) throw new ErrorHttp(404, m404corto(g)); geo_nombre = e.nombre; }
    const rows = await filas<{ periodo: string; total_personas: number; pct_ocupados: number; etapa: string }>(c.env.DB_ENOE, "SELECT periodo, total_personas, pct_ocupados, etapa FROM poblacion_ocupada_por_posicion WHERE pos_clave = ?1 AND nivel = ?2 AND geo_clave = ?3 AND (?4 IS NULL OR periodo >= ?4) AND (?5 IS NULL OR periodo <= ?5) ORDER BY periodo", [pos, nivel, g, desde, hasta]);
    const nombre = POSICION_NOMBRE.get(pos)!;
    const datos = rows.map((r) => ({ periodo: r.periodo, pos_clave: pos, pos_nombre: nombre, total_ocupados: Number(r.total_personas), participacion_porcentaje: redondear(Number(r.pct_ocupados), 4), etapa: r.etapa }));
    return { pos_clave: pos, pos_nombre: nombre, nivel, geo_clave: nivel === "entidad" ? g : null, geo_nombre, cobertura: cobertura(datos), datos, caveats: caveatsDistribucion(desde, hasta), source: SOURCE_ENOE };
  }
}

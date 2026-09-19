// Activo neto y rendimientos (endpoints 16 a 21 del legacy).
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429, bool } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import { parseFecha } from "../lib/fechas";
import { redondear } from "../lib/numeros";
import { repr } from "../lib/texto";
import {
  CAVEAT_ACTIVO_NETO_AGG_ADICIONALES, CAVEAT_ACTIVO_NETO_DECOMPOSITION, CAVEAT_ACTIVO_NETO_NULLS, CAVEAT_ACTIVO_NETO_UNIDAD,
  CAVEAT_RENDIMIENTO_DECOMPOSITION, CAVEAT_RENDIMIENTO_HISTORICO, CAVEAT_RENDIMIENTO_SIS, CAVEAT_RENDIMIENTO_UNIDAD, PLAZOS_VALIDOS,
} from "./constantes";

const AforeRef = z.object({ codigo: z.string(), nombre_corto: z.string(), tipo_pension: z.string() });
const SieforeRef = z.object({ slug: z.string(), nombre: z.string(), categoria: z.string() });
const SerieRango = z.object({ desde: z.string(), hasta: z.string() });
const MappingMeta = z.object({ is_subvariant_decomposed: z.boolean(), mapping_validated: z.boolean().nullable(), validated_via: z.string().nullable() });
const UNIT_MM = "millones de pesos MXN corrientes";
const UNIT_REND = "porcentaje anualizado neto";
const PLAZO_DESC = "12_meses | 24_meses | 36_meses | 5_anios | historico";

type Meta = { afore_codigo: string; afore_nombre_corto: string; afore_tipo_pension: string; siefore_slug: string; siefore_nombre: string; siefore_categoria: string; asa_validated: number | null; asa_validated_via: string | null };
const sqlMeta = (fuente: string) => `
SELECT af.codigo AS afore_codigo, af.nombre_corto AS afore_nombre_corto,
       af.tipo_pension AS afore_tipo_pension,
       cs.slug AS siefore_slug, cs.nombre AS siefore_nombre, cs.categoria AS siefore_categoria,
       (SELECT mapping_validated FROM afore_siefore_alias asa
         WHERE asa.afore_id = af.id AND asa.siefore_id = cs.id AND asa.fuente_csv = '${fuente}'
         LIMIT 1) AS asa_validated,
       (SELECT validated_via FROM afore_siefore_alias asa
         WHERE asa.afore_id = af.id AND asa.siefore_id = cs.id AND asa.fuente_csv = '${fuente}'
         LIMIT 1) AS asa_validated_via
FROM afores af, cat_siefore cs
WHERE af.codigo = ?1 AND cs.slug = ?2`;
const SQL_META_07 = sqlMeta("#07");
const SQL_META_10 = sqlMeta("#10");

function armar(meta: Meta) {
  const asa = meta.asa_validated;
  return {
    afore: { codigo: meta.afore_codigo, nombre_corto: meta.afore_nombre_corto, tipo_pension: meta.afore_tipo_pension },
    siefore: { slug: meta.siefore_slug, nombre: meta.siefore_nombre, categoria: meta.siefore_categoria },
    mapping_meta: { is_subvariant_decomposed: asa !== null, mapping_validated: asa !== null ? bool(asa) : null, validated_via: meta.asa_validated_via },
  };
}
function validarPlazo(plazo: string) {
  if (!(PLAZOS_VALIDOS as readonly string[]).includes(plazo)) throw new ErrorHttp(422, `plazo inválido: ${repr(plazo)}. Válidos: [${PLAZOS_VALIDOS.map(repr).join(", ")}]`);
}

// ---------------------------------------------------------------- 16. activo-neto/serie
const ActivoNetoPunto = z.object({ fecha: z.string(), monto_mxn_mm: z.number().nullable() });
const ActivoNetoSerieResponse = z.object({ afore: AforeRef, siefore: SieforeRef, unit: z.string(), n_puntos: z.number().int(), rango: SerieRango, serie: z.array(ActivoNetoPunto), mapping_meta: MappingMeta, caveats: z.array(z.string()) });
const SQL_ACTIVO_NETO_SERIE = `
SELECT an.fecha, an.monto_mxn_mm AS monto_mxn_mm
FROM activo_neto an
JOIN afores af ON af.id = an.afore_id
JOIN cat_siefore cs ON cs.id = an.siefore_id
WHERE af.codigo = ?1 AND cs.slug = ?2
ORDER BY an.fecha`;

export class ActivoNetoSerie extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_activo_neto_serie_api_v1_consar_activo_neto_serie_get",
    summary: "Serie temporal: activo neto atómico por (AFORE × SIEFORE)",
    description: "Retorna serie mensual de activo neto en MXN millones para una tupla (afore, siefore). Si la tupla proviene de un sub-variant concat decompuesto, expone mapping_validated y validated_via para transparencia. Cobertura 2019-12 → 2025-06.",
    request: { query: z.object({
      afore_codigo: z.string().describe("codigo en consar.afores (e.g. xxi_banorte, profuturo)"),
      siefore_slug: z.string().describe("slug en consar.cat_siefore (e.g. sb 55-59, sps1)"),
    }) },
    responses: { "200": { description: "Successful Response", ...contentJson(ActivoNetoSerieResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const meta = await fila<Meta>(c.env.DB_CONSAR, SQL_META_07, [query.afore_codigo, query.siefore_slug]);
    if (!meta) throw new ErrorHttp(404, `afore_codigo=${repr(query.afore_codigo)} o siefore_slug=${repr(query.siefore_slug)} no existe`);
    const serie = await filas<{ fecha: string; monto_mxn_mm: number | null }>(c.env.DB_CONSAR, SQL_ACTIVO_NETO_SERIE, [query.afore_codigo, query.siefore_slug]);
    if (serie.length === 0) throw new ErrorHttp(404, `sin datos para (${query.afore_codigo}, ${query.siefore_slug}) en consar.activo_neto`);
    const m = armar(meta);
    return { afore: m.afore, siefore: m.siefore, unit: UNIT_MM, n_puntos: serie.length, rango: { desde: serie[0].fecha, hasta: serie[serie.length - 1].fecha }, serie, mapping_meta: m.mapping_meta, caveats: [CAVEAT_ACTIVO_NETO_UNIDAD, CAVEAT_ACTIVO_NETO_NULLS, CAVEAT_ACTIVO_NETO_DECOMPOSITION] };
  }
}

// ---------------------------------------------------------------- 17. activo-neto/snapshot
const ActivoNetoSnapshotRow = z.object({ afore_codigo: z.string(), afore_nombre_corto: z.string(), siefore_slug: z.string(), siefore_nombre: z.string(), siefore_categoria: z.string(), monto_mxn_mm: z.number().nullable() });
const ActivoNetoSnapshotResponse = z.object({ fecha: z.string(), unit: z.string(), n_filas: z.number().int(), monto_total_mm: z.number(), n_filas_null: z.number().int(), filas: z.array(ActivoNetoSnapshotRow), caveats: z.array(z.string()) });
const SQL_ACTIVO_NETO_SNAPSHOT = `
SELECT af.codigo AS afore_codigo, af.nombre_corto AS afore_nombre_corto,
       cs.slug AS siefore_slug, cs.nombre AS siefore_nombre, cs.categoria AS siefore_categoria,
       an.monto_mxn_mm AS monto_mxn_mm
FROM activo_neto an
JOIN afores af ON af.id = an.afore_id
JOIN cat_siefore cs ON cs.id = an.siefore_id
WHERE an.fecha = ?1
ORDER BY af.orden_display, cs.orden_display`;

export class ActivoNetoSnapshot extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_activo_neto_snapshot_api_v1_consar_activo_neto_snapshot_get",
    summary: "Snapshot mensual: matriz (AFORE × SIEFORE) de activo neto",
    description: "Retorna para una fecha mensual todas las tuplas (afore, siefore) con sus montos. Útil para dashboards de composición por afore. Cobertura 2019-12 → 2025-06.",
    request: { query: z.object({ fecha: z.string().describe("YYYY-MM o YYYY-MM-01") }) },
    responses: { "200": { description: "Successful Response", ...contentJson(ActivoNetoSnapshotResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const d = parseFecha(query.fecha);
    const rows = await filas<z.infer<typeof ActivoNetoSnapshotRow>>(c.env.DB_CONSAR, SQL_ACTIVO_NETO_SNAPSHOT, [d]);
    if (rows.length === 0) throw new ErrorHttp(404, `sin datos para fecha=${d} (cobertura: 2019-12 → 2025-06)`);
    const n_null = rows.filter((f) => f.monto_mxn_mm === null).length;
    const total = rows.reduce((s, f) => s + (f.monto_mxn_mm || 0.0), 0.0);
    return { fecha: d, unit: UNIT_MM, n_filas: rows.length, monto_total_mm: redondear(total, 4), n_filas_null: n_null, filas: rows, caveats: [CAVEAT_ACTIVO_NETO_UNIDAD, CAVEAT_ACTIVO_NETO_NULLS, CAVEAT_ACTIVO_NETO_DECOMPOSITION] };
  }
}

// ---------------------------------------------------------------- 18. activo-neto/agregado
const CATEGORIAS_AGG = ["act_neto_total_siefores", "act_neto_total_basicas", "act_neto_total_adicionales"];
const ActivoNetoAggPunto = z.object({ fecha: z.string(), monto_mxn_mm: z.number().nullable() });
const ActivoNetoAggregadoResponse = z.object({ afore: AforeRef, categoria: z.string(), unit: z.string(), n_puntos: z.number().int(), rango: SerieRango, serie: z.array(ActivoNetoAggPunto), caveats: z.array(z.string()) });
const SQL_AGG_AFORE_META = `SELECT codigo, nombre_corto, tipo_pension FROM afores WHERE codigo = ?1`;
const SQL_ACTIVO_NETO_AGG = `
SELECT ana.fecha, ana.monto_mxn_mm AS monto_mxn_mm
FROM activo_neto_agg ana
JOIN afores af ON af.id = ana.afore_id
WHERE af.codigo = ?1 AND ana.categoria = ?2
ORDER BY ana.fecha`;

export class ActivoNetoAgregado extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_activo_neto_agregado_api_v1_consar_activo_neto_agregado_get",
    summary: "Serie temporal: agregado de activo neto por categoría (totales por afore)",
    description: "Retorna serie mensual de un agregado total reportado en CSV por afore. Categorías: act_neto_total_siefores, act_neto_total_basicas, act_neto_total_adicionales (esta última con 0 rows post-S16 — schema preparado, ver caveats). Cobertura 2019-12 → 2025-06.",
    request: { query: z.object({
      afore_codigo: z.string().describe("codigo en consar.afores"),
      categoria: z.string().describe("act_neto_total_siefores | act_neto_total_basicas | act_neto_total_adicionales"),
    }) },
    responses: { "200": { description: "Successful Response", ...contentJson(ActivoNetoAggregadoResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const { afore_codigo, categoria } = query;
    if (!CATEGORIAS_AGG.includes(categoria)) throw new ErrorHttp(422, `categoria inválida: ${repr(categoria)}`);
    const afore = await fila<z.infer<typeof AforeRef>>(c.env.DB_CONSAR, SQL_AGG_AFORE_META, [afore_codigo]);
    if (!afore) throw new ErrorHttp(404, `afore_codigo=${repr(afore_codigo)} no existe`);
    const serie = await filas<{ fecha: string; monto_mxn_mm: number | null }>(c.env.DB_CONSAR, SQL_ACTIVO_NETO_AGG, [afore_codigo, categoria]);
    if (serie.length === 0) {
      const base = `sin datos para (${afore_codigo}, ${categoria}). `;
      throw new ErrorHttp(404, base + (categoria === "act_neto_total_adicionales" ? "Categoría con 0 rows en CSV oficial — ver caveats." : "Esta afore puede no reportar este agregado (e.g. xxi_banorte reporta vía alias xxi-banorte)."));
    }
    const caveats = [CAVEAT_ACTIVO_NETO_UNIDAD];
    if (categoria === "act_neto_total_adicionales") caveats.push(CAVEAT_ACTIVO_NETO_AGG_ADICIONALES);
    return { afore, categoria, unit: UNIT_MM, n_puntos: serie.length, rango: { desde: serie[0].fecha, hasta: serie[serie.length - 1].fecha }, serie, caveats };
  }
}

// ---------------------------------------------------------------- 19. rendimientos/serie
const RendimientoPunto = z.object({ fecha: z.string(), rendimiento_pct: z.number() });
const RendimientoSerieResponse = z.object({ afore: AforeRef, siefore: SieforeRef, plazo: z.string(), unit: z.string(), n_puntos: z.number().int(), rango: SerieRango, serie: z.array(RendimientoPunto), mapping_meta: MappingMeta, caveats: z.array(z.string()) });
const SQL_RENDIMIENTO_SERIE = `
SELECT r.fecha, r.rendimiento_pct AS rendimiento_pct
FROM rendimiento r
JOIN afores af ON af.id = r.afore_id
JOIN cat_siefore cs ON cs.id = r.siefore_id
WHERE af.codigo = ?1 AND cs.slug = ?2 AND r.plazo = ?3
ORDER BY r.fecha`;
function caveatsRend(plazo: string, segundo: string) {
  const caveats = [CAVEAT_RENDIMIENTO_UNIDAD, segundo];
  if (plazo === "historico") caveats.splice(1, 0, CAVEAT_RENDIMIENTO_HISTORICO);
  return caveats;
}

export class RendimientosSerie extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_rendimiento_serie_api_v1_consar_rendimientos_serie_get",
    summary: "Serie temporal: rendimiento atómico por (AFORE × SIEFORE × PLAZO)",
    description: "Retorna serie mensual de rendimiento (% anualizado neto) para una tupla (afore, siefore, plazo). Si la tupla proviene de un sub-variant concat decompuesto, expone mapping_validated y validated_via. Cobertura 2019-12 → 2025-06.",
    request: { query: z.object({
      afore_codigo: z.string().describe("codigo en consar.afores (e.g. xxi_banorte, profuturo)"),
      siefore_slug: z.string().describe("slug en consar.cat_siefore (e.g. sb 60-64, sps3)"),
      plazo: z.string().describe(PLAZO_DESC),
    }) },
    responses: { "200": { description: "Successful Response", ...contentJson(RendimientoSerieResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const { afore_codigo, siefore_slug, plazo } = query;
    validarPlazo(plazo);
    const meta = await fila<Meta>(c.env.DB_CONSAR, SQL_META_10, [afore_codigo, siefore_slug]);
    if (!meta) throw new ErrorHttp(404, `afore_codigo=${repr(afore_codigo)} o siefore_slug=${repr(siefore_slug)} no existe`);
    const serie = await filas<{ fecha: string; rendimiento_pct: number }>(c.env.DB_CONSAR, SQL_RENDIMIENTO_SERIE, [afore_codigo, siefore_slug, plazo]);
    if (serie.length === 0) throw new ErrorHttp(404, `sin datos para (${afore_codigo}, ${siefore_slug}, ${plazo}). plazo='historico' sólo aplica a sb 60-64.`);
    const m = armar(meta);
    return { afore: m.afore, siefore: m.siefore, plazo, unit: UNIT_REND, n_puntos: serie.length, rango: { desde: serie[0].fecha, hasta: serie[serie.length - 1].fecha }, serie, mapping_meta: m.mapping_meta, caveats: caveatsRend(plazo, CAVEAT_RENDIMIENTO_DECOMPOSITION) };
  }
}

// ---------------------------------------------------------------- 20. rendimientos/snapshot
const RendimientoSnapshotRow = z.object({ afore_codigo: z.string(), afore_nombre_corto: z.string(), siefore_slug: z.string(), siefore_nombre: z.string(), siefore_categoria: z.string(), rendimiento_pct: z.number() });
const RendimientoSnapshotResponse = z.object({ fecha: z.string(), plazo: z.string(), unit: z.string(), n_filas: z.number().int(), rendimiento_min: z.number(), rendimiento_max: z.number(), filas: z.array(RendimientoSnapshotRow), caveats: z.array(z.string()) });
const SQL_RENDIMIENTO_SNAPSHOT = `
SELECT af.codigo AS afore_codigo, af.nombre_corto AS afore_nombre_corto,
       cs.slug AS siefore_slug, cs.nombre AS siefore_nombre, cs.categoria AS siefore_categoria,
       r.rendimiento_pct AS rendimiento_pct
FROM rendimiento r
JOIN afores af ON af.id = r.afore_id
JOIN cat_siefore cs ON cs.id = r.siefore_id
WHERE r.fecha = ?1 AND r.plazo = ?2
ORDER BY af.orden_display, cs.orden_display`;

export class RendimientosSnapshot extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_rendimiento_snapshot_api_v1_consar_rendimientos_snapshot_get",
    summary: "Snapshot mensual: matriz (AFORE × SIEFORE) de rendimiento para un plazo",
    description: "Retorna para una fecha y plazo todas las tuplas (afore, siefore) con sus rendimientos. Útil para dashboards comparativos de desempeño. Cobertura 2019-12 → 2025-06.",
    request: { query: z.object({ fecha: z.string().describe("YYYY-MM o YYYY-MM-01"), plazo: z.string().describe(PLAZO_DESC) }) },
    responses: { "200": { description: "Successful Response", ...contentJson(RendimientoSnapshotResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    validarPlazo(query.plazo);
    const d = parseFecha(query.fecha);
    const filas_ = await filas<z.infer<typeof RendimientoSnapshotRow>>(c.env.DB_CONSAR, SQL_RENDIMIENTO_SNAPSHOT, [d, query.plazo]);
    if (filas_.length === 0) throw new ErrorHttp(404, `sin datos para fecha=${d} plazo=${query.plazo} (cobertura 2019-12 → 2025-06; historico solo sb 60-64)`);
    const vals = filas_.map((f) => f.rendimiento_pct);
    return { fecha: d, plazo: query.plazo, unit: UNIT_REND, n_filas: filas_.length, rendimiento_min: Math.min(...vals), rendimiento_max: Math.max(...vals), filas: filas_, caveats: caveatsRend(query.plazo, CAVEAT_RENDIMIENTO_DECOMPOSITION) };
  }
}

// ---------------------------------------------------------------- 21. rendimientos/sistema
const RendimientoSistemaPunto = z.object({ fecha: z.string(), rendimiento_pct: z.number() });
const RendimientoSistemaResponse = z.object({ siefore: SieforeRef, plazo: z.string(), unit: z.string(), n_puntos: z.number().int(), rango: SerieRango, serie: z.array(RendimientoSistemaPunto), caveats: z.array(z.string()) });
const SQL_RENDIMIENTO_SIS_META = `SELECT slug, nombre, categoria FROM cat_siefore WHERE slug = ?1`;
const SQL_RENDIMIENTO_SIS = `
SELECT r.fecha, r.rendimiento_pct AS rendimiento_pct
FROM rendimiento_sis r
JOIN cat_siefore cs ON cs.id = r.siefore_id
WHERE cs.slug = ?1 AND r.plazo = ?2
ORDER BY r.fecha`;

export class RendimientosSistema extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_rendimiento_sistema_api_v1_consar_rendimientos_sistema_get",
    summary: "Serie temporal: rendimiento agregado del sistema (INTER-afore) por SIEFORE × PLAZO",
    description: "Retorna serie mensual del rendimiento agregado CONSAR del sistema (promedio ponderado sobre todas las afores) para una siefore y plazo. Distinto de activo_neto_agg que es agregado INTRA-afore. Para 'adicionales' usar siefore_slug='agregado_adicionales'. Cobertura 2019-12 → 2025-06.",
    request: { query: z.object({ siefore_slug: z.string().describe("slug en consar.cat_siefore (e.g. sb 60-64, agregado_adicionales)"), plazo: z.string().describe(PLAZO_DESC) }) },
    responses: { "200": { description: "Successful Response", ...contentJson(RendimientoSistemaResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const { siefore_slug, plazo } = query;
    validarPlazo(plazo);
    const siefore = await fila<z.infer<typeof SieforeRef>>(c.env.DB_CONSAR, SQL_RENDIMIENTO_SIS_META, [siefore_slug]);
    if (!siefore) throw new ErrorHttp(404, `siefore_slug=${repr(siefore_slug)} no existe`);
    const serie = await filas<{ fecha: string; rendimiento_pct: number }>(c.env.DB_CONSAR, SQL_RENDIMIENTO_SIS, [siefore_slug, plazo]);
    if (serie.length === 0) throw new ErrorHttp(404, `sin datos para (${siefore_slug}, ${plazo}). plazo='historico' sólo aplica a sb 60-64.`);
    return { siefore, plazo, unit: UNIT_REND, n_puntos: serie.length, rango: { desde: serie[0].fecha, hasta: serie[serie.length - 1].fecha }, serie, caveats: caveatsRend(plazo, CAVEAT_RENDIMIENTO_SIS) };
  }
}

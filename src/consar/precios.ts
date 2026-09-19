// Precios NAV (bolsa) y precios de gestión interna (endpoints 29 a 34 del legacy).
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import { parseFechaDia } from "../lib/fechas";
import { repr } from "../lib/texto";
import {
  CAVEAT_GESTION_BANAMEX_MERGE, CAVEAT_GESTION_COBERTURA, CAVEAT_GESTION_NO_PENSIONISSSTE, CAVEAT_GESTION_PRECIO, CAVEAT_GESTION_XXI_LEGACY,
  CAVEAT_PRECIO_BANAMEX_MERGE, CAVEAT_PRECIO_COBERTURA, CAVEAT_PRECIO_NAV,
} from "./constantes";

const AforeRef = z.object({ codigo: z.string(), nombre_corto: z.string(), tipo_pension: z.string() });
const SieforeRef = z.object({ slug: z.string(), nombre: z.string(), categoria: z.string() });
const SerieRango = z.object({ desde: z.string(), hasta: z.string() });
const PrecioPunto = z.object({ fecha: z.string(), precio: z.number() });
const PrecioSerieResponse = z.object({ afore: AforeRef, siefore: SieforeRef, n_puntos: z.number().int(), rango: SerieRango, precio_min: z.number(), precio_max: z.number(), serie: z.array(PrecioPunto), caveats: z.array(z.string()) });
const PrecioSnapshotRow = z.object({ afore_codigo: z.string(), afore_nombre_corto: z.string(), siefore_slug: z.string(), siefore_nombre: z.string(), siefore_categoria: z.string(), precio: z.number() });
const PrecioSnapshotResponse = z.object({ fecha: z.string(), n_filas: z.number().int(), precio_min: z.number(), precio_max: z.number(), filas: z.array(PrecioSnapshotRow), caveats: z.array(z.string()) });
const PrecioComparativoSerieAfore = z.object({ afore_codigo: z.string(), afore_nombre_corto: z.string(), n_puntos: z.number().int(), serie: z.array(PrecioPunto) });
const PrecioComparativoResponse = z.object({ siefore: SieforeRef, rango: SerieRango, n_afores: z.number().int(), series: z.array(PrecioComparativoSerieAfore), caveats: z.array(z.string()) });

const CAVEATS_BOLSA = [CAVEAT_PRECIO_NAV, CAVEAT_PRECIO_COBERTURA, CAVEAT_PRECIO_BANAMEX_MERGE];
const CAVEATS_GESTION = [CAVEAT_GESTION_PRECIO, CAVEAT_GESTION_COBERTURA, CAVEAT_GESTION_BANAMEX_MERGE, CAVEAT_GESTION_XXI_LEGACY, CAVEAT_GESTION_NO_PENSIONISSSTE];

type MetaPar = { afore_codigo: string; afore_nombre_corto: string; afore_tipo_pension: string; siefore_slug: string; siefore_nombre: string; siefore_categoria: string };
const SQL_PAR_META = `
SELECT
    a.codigo            AS afore_codigo,
    a.nombre_corto      AS afore_nombre_corto,
    a.tipo_pension      AS afore_tipo_pension,
    s.slug              AS siefore_slug,
    s.nombre            AS siefore_nombre,
    s.categoria         AS siefore_categoria
FROM afores a, cat_siefore s
WHERE a.codigo = ?1
  AND s.slug   = ?2`;
const SQL_SIEFORE_META = `SELECT slug, nombre, categoria FROM cat_siefore WHERE slug = ?1`;
const sqlSerie = (tabla: string) => `
SELECT p.fecha, p.precio
FROM ${tabla} p
JOIN afores a       ON a.id = p.afore_id
JOIN cat_siefore s  ON s.id = p.siefore_id
WHERE a.codigo = ?1
  AND s.slug   = ?2
  AND (?3 IS NULL OR p.fecha >= ?3)
  AND (?4 IS NULL OR p.fecha <= ?4)
ORDER BY p.fecha`;
const sqlSnapshot = (tabla: string) => `
SELECT a.codigo            AS afore_codigo,
       a.nombre_corto      AS afore_nombre_corto,
       s.slug              AS siefore_slug,
       s.nombre            AS siefore_nombre,
       s.categoria         AS siefore_categoria,
       p.precio
FROM ${tabla} p
JOIN afores a       ON a.id = p.afore_id
JOIN cat_siefore s  ON s.id = p.siefore_id
WHERE p.fecha = ?1
ORDER BY s.orden_display, a.codigo`;
const sqlComparativo = (tabla: string) => `
SELECT a.codigo            AS afore_codigo,
       a.nombre_corto      AS afore_nombre_corto,
       p.fecha,
       p.precio
FROM ${tabla} p
JOIN afores a       ON a.id = p.afore_id
JOIN cat_siefore s  ON s.id = p.siefore_id
WHERE s.slug   = ?1
  AND p.fecha >= ?2
  AND p.fecha <= ?3
ORDER BY a.codigo, p.fecha`;

const pyNone = (v: string | undefined) => (v === undefined ? "None" : v);

async function serieGenerica(c: AppContext, q: { afore_codigo: string; siefore_slug: string; desde?: string; hasta?: string }, tabla: string, sufijo404: string, caveats: string[]) {
  const desde_d = q.desde !== undefined ? parseFechaDia(q.desde) : null;
  const hasta_d = q.hasta !== undefined ? parseFechaDia(q.hasta) : null;
  const meta = await fila<MetaPar>(c.env.DB_CONSAR, SQL_PAR_META, [q.afore_codigo, q.siefore_slug]);
  if (!meta) throw new ErrorHttp(404, `afore_codigo=${repr(q.afore_codigo)} o siefore_slug=${repr(q.siefore_slug)} no existe`);
  const serie = await filas<{ fecha: string; precio: number }>(c.env.DB_CONSAR, sqlSerie(tabla), [q.afore_codigo, q.siefore_slug, desde_d, hasta_d]);
  if (serie.length === 0) {
    const ventana = q.desde !== undefined || q.hasta !== undefined ? ` en ventana [${pyNone(q.desde)}, ${pyNone(q.hasta)}]` : "";
    throw new ErrorHttp(404, `sin datos para (${q.afore_codigo}, ${q.siefore_slug})${ventana}${sufijo404}`);
  }
  const precios = serie.map((p) => p.precio);
  return {
    afore: { codigo: meta.afore_codigo, nombre_corto: meta.afore_nombre_corto, tipo_pension: meta.afore_tipo_pension },
    siefore: { slug: meta.siefore_slug, nombre: meta.siefore_nombre, categoria: meta.siefore_categoria },
    n_puntos: serie.length, rango: { desde: serie[0].fecha, hasta: serie[serie.length - 1].fecha },
    precio_min: Math.min(...precios), precio_max: Math.max(...precios), serie, caveats,
  };
}
async function snapshotGenerico(c: AppContext, fecha: string, tabla: string, cobertura: string, caveats: string[]) {
  const d = parseFechaDia(fecha);
  const filas_ = await filas<z.infer<typeof PrecioSnapshotRow>>(c.env.DB_CONSAR, sqlSnapshot(tabla), [d]);
  if (filas_.length === 0) throw new ErrorHttp(404, `sin datos para fecha=${d}. Probable día no-hábil de mercado. Cobertura: ${cobertura} (M-V principalmente).`);
  const precios = filas_.map((f) => f.precio);
  return { fecha: d, n_filas: filas_.length, precio_min: Math.min(...precios), precio_max: Math.max(...precios), filas: filas_, caveats };
}
async function comparativoGenerico(c: AppContext, q: { siefore_slug: string; desde: string; hasta: string }, tabla: string, caveats: string[]) {
  const desde_d = parseFechaDia(q.desde);
  const hasta_d = parseFechaDia(q.hasta);
  if (hasta_d < desde_d) throw new ErrorHttp(422, "hasta < desde");
  const siefore = await fila<z.infer<typeof SieforeRef>>(c.env.DB_CONSAR, SQL_SIEFORE_META, [q.siefore_slug]);
  if (!siefore) throw new ErrorHttp(404, `siefore_slug=${repr(q.siefore_slug)} no existe`);
  const rows = await filas<{ afore_codigo: string; afore_nombre_corto: string; fecha: string; precio: number }>(c.env.DB_CONSAR, sqlComparativo(tabla), [q.siefore_slug, desde_d, hasta_d]);
  if (rows.length === 0) throw new ErrorHttp(404, `sin datos para siefore_slug=${repr(q.siefore_slug)} en ventana [${q.desde}, ${q.hasta}]`);
  const porAfore = new Map<string, { afore_codigo: string; afore_nombre_corto: string; puntos: { fecha: string; precio: number }[] }>();
  for (const r of rows) {
    let g = porAfore.get(r.afore_codigo);
    if (!g) { g = { afore_codigo: r.afore_codigo, afore_nombre_corto: r.afore_nombre_corto, puntos: [] }; porAfore.set(r.afore_codigo, g); }
    g.puntos.push({ fecha: r.fecha, precio: r.precio });
  }
  const series = [...porAfore.values()].map((g) => ({ afore_codigo: g.afore_codigo, afore_nombre_corto: g.afore_nombre_corto, n_puntos: g.puntos.length, serie: g.puntos }));
  return { siefore, rango: { desde: desde_d, hasta: hasta_d }, n_afores: series.length, series, caveats };
}

// ---------------------------------------------------------------- 29. precios/serie
export class PreciosSerie extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_precio_serie_api_v1_consar_precios_serie_get",
    summary: "Serie diaria NAV: precio por (AFORE × SIEFORE)",
    description: "Retorna serie diaria de precios NAV (Net Asset Value) en MXN para una tupla (afore, siefore). Cobertura más profunda del proyecto: 1997-01-08 → 2025-12-06 (28 años). Ventana opcional desde/hasta para reducir payload.",
    request: { query: z.object({
      afore_codigo: z.string().describe("codigo en consar.afores (e.g. xxi_banorte, profuturo)"),
      siefore_slug: z.string().describe("slug en consar.cat_siefore (e.g. sb 60-64, sps3, siav)"),
      desde: z.string().optional().describe("YYYY-MM-DD opcional"),
      hasta: z.string().optional().describe("YYYY-MM-DD opcional"),
    }) },
    responses: { "200": { description: "Successful Response", ...contentJson(PrecioSerieResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    return serieGenerica(c, query, "precio_bolsa", ". Verificar disponibilidad histórica de la combinación.", CAVEATS_BOLSA);
  }
}

// ---------------------------------------------------------------- 30. precios/snapshot
export class PreciosSnapshot extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_precio_snapshot_api_v1_consar_precios_snapshot_get",
    summary: "Snapshot diario: matriz (AFORE × SIEFORE) en una fecha",
    description: "Retorna para una fecha de mercado todos los pares (afore commercial × siefore) con su precio NAV. Útil para dashboards comparativos diarios. Si fecha no es hábil → 404 (verificar disponibilidad).",
    request: { query: z.object({ fecha: z.string().describe("YYYY-MM-DD (fecha hábil de mercado)") }) },
    responses: { "200": { description: "Successful Response", ...contentJson(PrecioSnapshotResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    return snapshotGenerico(c, query.fecha, "precio_bolsa", "1997-01-08 → 2025-12-06", CAVEATS_BOLSA);
  }
}

// ---------------------------------------------------------------- 31. precios/comparativo
export class PreciosComparativo extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_precio_comparativo_api_v1_consar_precios_comparativo_get",
    summary: "Comparativo: misma SIEFORE entre N afores en ventana temporal",
    description: "Retorna serie diaria de precio NAV de la misma siefore para todas las afores que la reportan, dentro de una ventana temporal OBLIGATORIA. Caso de uso: comparar performance NAV entre afores. La ventana es obligatoria para protección del server (payload sin ventana podría ser 7K×11=77K puntos).",
    request: { query: z.object({ siefore_slug: z.string().describe("slug en consar.cat_siefore"), desde: z.string().describe("YYYY-MM-DD (obligatorio)"), hasta: z.string().describe("YYYY-MM-DD (obligatorio)") }) },
    responses: { "200": { description: "Successful Response", ...contentJson(PrecioComparativoResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    return comparativoGenerico(c, query, "precio_bolsa", CAVEATS_BOLSA);
  }
}

// ---------------------------------------------------------------- 32. precios-gestion/serie
export class PreciosGestionSerie extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_precio_gestion_serie_api_v1_consar_precios_gestion_serie_get",
    summary: "Serie diaria gestión: precio interno por (AFORE × SIEFORE)",
    description: "Retorna serie diaria de precios de gestión interna en MXN para una tupla (afore, siefore). Cobertura 1997-01-07 → 2025-12-06 (28+ años, 7,060 fechas). Range NAV +30% vs precio_bolsa: distinta base/comisión. NO incluye PensionISSSTE.",
    request: { query: z.object({
      afore_codigo: z.string().describe("codigo en consar.afores (NO incluye pensionissste en #11)"),
      siefore_slug: z.string().describe("slug en consar.cat_siefore (incluye sb5 legacy XXI)"),
      desde: z.string().optional().describe("YYYY-MM-DD opcional"),
      hasta: z.string().optional().describe("YYYY-MM-DD opcional"),
    }) },
    responses: { "200": { description: "Successful Response", ...contentJson(PrecioSerieResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    return serieGenerica(c, query, "precio_gestion", ". Verificar disponibilidad histórica de la combinación. PensionISSSTE NO aparece en gestión interna.", CAVEATS_GESTION);
  }
}

// ---------------------------------------------------------------- 33. precios-gestion/snapshot
export class PreciosGestionSnapshot extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_precio_gestion_snapshot_api_v1_consar_precios_gestion_snapshot_get",
    summary: "Snapshot gestión: matriz (AFORE × SIEFORE) en una fecha",
    description: "Retorna para una fecha de mercado todos los pares (afore × siefore) con su precio de gestión interna. Útil para dashboards comparativos diarios. Si fecha no es hábil → 404. NO incluye PensionISSSTE.",
    request: { query: z.object({ fecha: z.string().describe("YYYY-MM-DD (fecha hábil de mercado)") }) },
    responses: { "200": { description: "Successful Response", ...contentJson(PrecioSnapshotResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    return snapshotGenerico(c, query.fecha, "precio_gestion", "1997-01-07 → 2025-12-06", CAVEATS_GESTION);
  }
}

// ---------------------------------------------------------------- 34. precios-gestion/comparativo
export class PreciosGestionComparativo extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_precio_gestion_comparativo_api_v1_consar_precios_gestion_comparativo_get",
    summary: "Comparativo gestión: misma SIEFORE entre N afores en ventana",
    description: "Retorna serie diaria de precio gestión interna de la misma siefore para todas las afores que la reportan, dentro de una ventana temporal OBLIGATORIA. Caso de uso: comparar performance gestión interna entre afores. La ventana es obligatoria para protección del server (payload sin ventana podría ser 7K×10=70K puntos).",
    request: { query: z.object({ siefore_slug: z.string().describe("slug en consar.cat_siefore"), desde: z.string().describe("YYYY-MM-DD (obligatorio)"), hasta: z.string().describe("YYYY-MM-DD (obligatorio)") }) },
    responses: { "200": { description: "Successful Response", ...contentJson(PrecioComparativoResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    return comparativoGenerico(c, query, "precio_gestion", CAVEATS_GESTION);
  }
}

// ENIGH 2024 Nueva Serie — los 10 endpoints del legacy, con paridad de datos y de documentación.
// La validación de parámetros se hace a mano (no con getValidatedData) para reproducir los mensajes 422 de FastAPI.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import { redondear } from "../lib/numeros";
import { enteroOpcional, textoConPatron } from "../lib/validacion";
import { BOUNDS_GASTOS_MENSUAL, BOUNDS_INGRESO_TRIM, ENIGH_EDITION, ENIGH_PERIODICITY, ENIGH_REFERENCE_DATE, METHODOLOGY_NOTES, NOTE_AGRO, NOTE_JCF, NOTE_NOAGRO, RUBROS, SCHEMA_VERSION, SOURCES } from "./constantes";

const TAG = ["enigh"];
const ok = (descripcion: string, esquema: z.ZodTypeAny) => ({ "200": { description: descripcion, ...contentJson(esquema) } });

// ---------------------------------------------------------------- 1. metadata
const SourceRef = z.object({ title: z.string(), url: z.string(), consulted_on: z.string() });
const EnighMetadata = z.object({
  edition: z.string(), periodicity: z.string(), reference_date: z.string(), schema_version: z.string(), last_updated: z.string(),
  total_hogares_muestra: z.number().int(), total_hogares_expandido: z.number().int(), total_tablas_ingestadas: z.number().int(), total_catalogos: z.number().int(),
  sources: z.array(SourceRef), methodology_notes: z.array(z.string()),
});
export class EnighMetadataEndpoint extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "enigh_metadata_api_v1_enigh_metadata_get", summary: "Enigh Metadata",
    description: "Metadata del dataset ENIGH 2024 NS: edición, fuentes, schema, totales.",
    responses: { ...ok("Metadata completa del dataset ENIGH 2024 NS.", EnighMetadata), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const r = await fila<{ n_muestra: number; n_expandido: number }>(c.env.DB_ENIGH, "SELECT COUNT(*) AS n_muestra, SUM(factor) AS n_expandido FROM concentradohogar");
    return {
      edition: ENIGH_EDITION, periodicity: ENIGH_PERIODICITY, reference_date: ENIGH_REFERENCE_DATE, schema_version: SCHEMA_VERSION, last_updated: "2026-04-22",
      total_hogares_muestra: r!.n_muestra, total_hogares_expandido: r!.n_expandido, total_tablas_ingestadas: 17, total_catalogos: 111,
      sources: SOURCES, methodology_notes: METHODOLOGY_NOTES,
    };
  }
}

// ---------------------------------------------------------------- SQL compartido
const SQL_HOGARES_SUMMARY = `
SELECT
    COUNT(*) AS n_muestra,
    SUM(factor) AS n_expandido,
    (SUM(ing_cor * factor) / SUM(factor)) AS mean_ing_cor_trim,
    (SUM(gasto_mon * factor) / SUM(factor)) AS mean_gasto_mon_trim
FROM concentradohogar`;
const SQL_HOGARES_BY_DECIL = `
SELECT
    decil AS decil,
    COUNT(*) AS n_muestra,
    SUM(factor) AS n_expandido,
    (SUM(ing_cor * factor) / SUM(factor)) AS mean_ing_cor_trim,
    (SUM(gasto_mon * factor) / SUM(factor)) AS mean_gasto_mon_trim,
    (100.0 * SUM(factor) / (SELECT SUM(factor) FROM concentradohogar)) AS share_factor_pct
FROM concentradohogar
WHERE decil IS NOT NULL
GROUP BY decil
ORDER BY decil`;
type Resumen = { n_muestra: number; n_expandido: number; mean_ing_cor_trim: number; mean_gasto_mon_trim: number };
type FilaDecil = Resumen & { decil: number; share_factor_pct: number };

// ---------------------------------------------------------------- 2. validaciones
const ValidacionRow = z.object({ id: z.string(), scope: z.string(), metric: z.string(), column: z.string(), unit: z.string(), calculado: z.number(), oficial: z.number(), delta_pct: z.number(), tolerance_pct: z.number(), passing: z.boolean(), source: z.string() });
const ValidacionesResponse = z.object({ count: z.number().int(), passing: z.number().int(), failing: z.number().int(), bounds: z.array(ValidacionRow) });
const SQL_GASTOS_BOUNDS = "SELECT " + BOUNDS_GASTOS_MENSUAL.map(([col]) => `(SUM(${col} * factor) / SUM(factor)) AS ${col}_trim`).join(", ") + " FROM concentradohogar";
const FUENTE_112 = "INEGI Comunicado 112/25 p.5/6 cuadro 2";
export class EnighValidaciones extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "enigh_validaciones_api_v1_enigh_validaciones_get", summary: "Enigh Validaciones",
    description: "Los 13 bounds HIGH vs INEGI oficial (Comunicado 112/25).\n\n- 3 bounds ingreso (total, decil 1, decil 10) — trimestrales\n- 10 bounds gasto (gasto_mon + 9 rubros) — mensuales\n\nTodos reproducen al peso al 2026-04-22 (ver proyect memory S3, S5).",
    responses: { ...ok("13 bounds HIGH vs INEGI Comunicado 112/25 (3 ingreso trimestrales + 10 gasto mensuales).", ValidacionesResponse), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const total = (await fila<Resumen>(c.env.DB_ENIGH, SQL_HOGARES_SUMMARY))!;
    const deciles = await filas<FilaDecil>(c.env.DB_ENIGH, SQL_HOGARES_BY_DECIL);
    const d1 = deciles.find((r) => r.decil === 1)!, d10 = deciles.find((r) => r.decil === 10)!;
    const gastos = (await fila<Record<string, number>>(c.env.DB_ENIGH, SQL_GASTOS_BOUNDS))!;
    const bounds: z.infer<typeof ValidacionRow>[] = [];
    for (const [scope, name, oficial, tol] of BOUNDS_INGRESO_TRIM) {
      const calc = scope === "total" ? total.mean_ing_cor_trim : scope === "d1" ? d1.mean_ing_cor_trim : d10.mean_ing_cor_trim;
      const delta = (calc - oficial) / oficial;
      bounds.push({ id: `ingreso_${scope}`, scope, metric: name, column: "ing_cor", unit: "pesos trimestrales por hogar", calculado: redondear(calc, 2), oficial, delta_pct: redondear(delta * 100, 4), tolerance_pct: redondear(tol * 100, 2), passing: Math.abs(delta) <= tol, source: FUENTE_112 });
    }
    for (const [col, slug, name, oficial, tol] of BOUNDS_GASTOS_MENSUAL) {
      const calc_mensual = gastos[`${col}_trim`] / 3.0;
      const delta = (calc_mensual - oficial) / oficial;
      bounds.push({ id: `gasto_${slug}`, scope: "mensual", metric: name, column: col, unit: "pesos mensuales por hogar", calculado: redondear(calc_mensual, 2), oficial, delta_pct: redondear(delta * 100, 4), tolerance_pct: redondear(tol * 100, 2), passing: Math.abs(delta) <= tol, source: FUENTE_112 });
    }
    const passing = bounds.filter((b) => b.passing).length;
    return { count: bounds.length, passing, failing: bounds.length - passing, bounds };
  }
}

// ---------------------------------------------------------------- 3. hogares/summary
const HogaresSummary = z.object({ n_hogares_muestra: z.number().int(), n_hogares_expandido: z.number().int(), mean_ing_cor_trim: z.number(), mean_ing_cor_mensual: z.number(), mean_gasto_mon_trim: z.number(), mean_gasto_mon_mensual: z.number(), edition: z.string(), source: z.string() });
export class HogaresSummaryEndpoint extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "hogares_summary_api_v1_enigh_hogares_summary_get", summary: "Hogares Summary",
    description: "Agregado nacional ponderado: hogares muestra + expandido, mean ing_cor, mean gasto_mon.",
    responses: { ...ok("Agregado nacional ponderado de hogares ENIGH 2024 NS.", HogaresSummary), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const r = (await fila<Resumen>(c.env.DB_ENIGH, SQL_HOGARES_SUMMARY))!;
    return {
      n_hogares_muestra: r.n_muestra, n_hogares_expandido: r.n_expandido,
      mean_ing_cor_trim: redondear(r.mean_ing_cor_trim, 2), mean_ing_cor_mensual: redondear(r.mean_ing_cor_trim / 3.0, 2),
      mean_gasto_mon_trim: redondear(r.mean_gasto_mon_trim, 2), mean_gasto_mon_mensual: redondear(r.mean_gasto_mon_trim / 3.0, 2),
      edition: ENIGH_EDITION, source: "INEGI ENIGH 2024 NS — concentradohogar (tabla summary oficial)",
    };
  }
}

// ---------------------------------------------------------------- 4. hogares/by-decil
const DecilRow = z.object({ decil: z.number().int(), n_hogares_muestra: z.number().int(), n_hogares_expandido: z.number().int(), mean_ing_cor_trim: z.number(), mean_ing_cor_mensual: z.number(), mean_gasto_mon_trim: z.number(), share_factor_pct: z.number() });
export class HogaresByDecil extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "hogares_by_decil_api_v1_enigh_hogares_by_decil_get", summary: "Hogares By Decil",
    description: "Distribución de ingreso/gasto por decil nacional (factor-weighted cumulative, INEGI-standard).",
    responses: { ...ok("10 deciles nacionales por factor-weighted cumulative sum (INEGI-standard).", z.array(DecilRow)), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const rows = await filas<FilaDecil>(c.env.DB_ENIGH, SQL_HOGARES_BY_DECIL);
    return rows.map((r) => ({ decil: r.decil, n_hogares_muestra: r.n_muestra, n_hogares_expandido: r.n_expandido, mean_ing_cor_trim: redondear(r.mean_ing_cor_trim, 2), mean_ing_cor_mensual: redondear(r.mean_ing_cor_trim / 3.0, 2), mean_gasto_mon_trim: redondear(r.mean_gasto_mon_trim, 2), share_factor_pct: redondear(r.share_factor_pct, 2) }));
  }
}

// ---------------------------------------------------------------- 5. hogares/by-entidad
const EntidadRow = z.object({ clave: z.string(), nombre: z.string(), n_hogares_muestra: z.number().int(), n_hogares_expandido: z.number().int(), mean_ing_cor_trim: z.number(), mean_ing_cor_mensual: z.number(), mean_gasto_mon_trim: z.number() });
const SQL_HOGARES_BY_ENTIDAD = `
SELECT
    substr(c.ubica_geo, 1, 2) AS clave,
    e.descripcion AS nombre,
    COUNT(*) AS n_muestra,
    SUM(c.factor) AS n_expandido,
    (SUM(c.ing_cor * c.factor) / SUM(c.factor)) AS mean_ing_cor_trim,
    (SUM(c.gasto_mon * c.factor) / SUM(c.factor)) AS mean_gasto_mon_trim
FROM concentradohogar c
JOIN cat_entidad e ON substr(c.ubica_geo, 1, 2) = e.clave
WHERE (?1 IS NULL OR substr(c.ubica_geo, 1, 2) = ?1)
GROUP BY substr(c.ubica_geo, 1, 2), e.descripcion
ORDER BY mean_ing_cor_trim DESC`;
const PATRON_ENTIDAD = "^\\d{2}$";
export class HogaresByEntidad extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "hogares_by_entidad_api_v1_enigh_hogares_by_entidad_get", summary: "Hogares By Entidad",
    description: "Hogares agregados por entidad. Orden descendente por mean ing_cor.",
    request: { query: z.object({ entidad: z.string().regex(/^\d{2}$/).optional().describe("Clave entidad 2 dígitos (01-32). Si omite, devuelve las 32.") }) },
    responses: { ...ok("Hogares agregados por entidad federativa (32 filas o filtrado por `entidad`).", z.array(EntidadRow)), "404": { description: "`entidad` no encontrada en el filtro." }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const entidad = textoConPatron(c.req.query("entidad"), "entidad", PATRON_ENTIDAD);
    const rows = await filas<FilaDecil & { clave: string; nombre: string }>(c.env.DB_ENIGH, SQL_HOGARES_BY_ENTIDAD, [entidad]);
    if (entidad && rows.length === 0) throw new ErrorHttp(404, `Entidad '${entidad}' no encontrada`);
    return rows.map((r) => ({ clave: r.clave, nombre: r.nombre, n_hogares_muestra: r.n_muestra, n_hogares_expandido: r.n_expandido, mean_ing_cor_trim: redondear(r.mean_ing_cor_trim, 2), mean_ing_cor_mensual: redondear(r.mean_ing_cor_trim / 3.0, 2), mean_gasto_mon_trim: redondear(r.mean_gasto_mon_trim, 2) }));
  }
}

// ---------------------------------------------------------------- 6. poblacion/demographics
const SexoCount = z.object({ sexo: z.string(), n_expandido: z.number().int(), pct: z.number() });
const EdadBucket = z.object({ bucket: z.string(), n_expandido: z.number().int(), pct: z.number() });
const DemographicsResponse = z.object({ scope: z.string(), n_personas_muestra: z.number().int(), n_personas_expandido: z.number().int(), sexo: z.array(SexoCount), edad: z.array(EdadBucket) });
const SQL_POBLACION_DEMOGRAPHICS = `
SELECT
    COUNT(*) AS muestra,
    SUM(p.factor) AS expandido,
    SUM(CASE WHEN p.sexo='1' THEN p.factor ELSE 0 END) AS hombres_exp,
    SUM(CASE WHEN p.sexo='2' THEN p.factor ELSE 0 END) AS mujeres_exp,
    SUM(CASE WHEN p.edad < 15 THEN p.factor ELSE 0 END) AS edad_0_14,
    SUM(CASE WHEN p.edad BETWEEN 15 AND 29 THEN p.factor ELSE 0 END) AS edad_15_29,
    SUM(CASE WHEN p.edad BETWEEN 30 AND 44 THEN p.factor ELSE 0 END) AS edad_30_44,
    SUM(CASE WHEN p.edad BETWEEN 45 AND 64 THEN p.factor ELSE 0 END) AS edad_45_64,
    SUM(CASE WHEN p.edad >= 65 THEN p.factor ELSE 0 END) AS edad_65_plus
FROM poblacion p
LEFT JOIN hogares h USING (folioviv, foliohog)
WHERE (?1 IS NULL OR h.entidad = ?1)`;
export class PoblacionDemographics extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "poblacion_demographics_api_v1_enigh_poblacion_demographics_get", summary: "Poblacion Demographics",
    description: "Pirámide demográfica ponderada: sexo + 5 cohortes etarios. Opcional por entidad.",
    request: { query: z.object({ entidad: z.string().regex(/^\d{2}$/).optional() }) },
    responses: { ...ok("Pirámide demográfica ponderada (sexo + 5 cohortes etarios).", DemographicsResponse), "404": { description: "`entidad` no encontrada." }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const entidad = textoConPatron(c.req.query("entidad"), "entidad", PATRON_ENTIDAD);
    const r = (await fila<Record<string, number | null>>(c.env.DB_ENIGH, SQL_POBLACION_DEMOGRAPHICS, [entidad]))!;
    if (entidad && (r.expandido || 0) === 0) throw new ErrorHttp(404, `Entidad '${entidad}' no encontrada`);
    const exp = r.expandido as number;
    const pct = (v: number) => redondear((100 * v) / exp, 2);
    return {
      scope: entidad ? `entidad ${entidad}` : "nacional", n_personas_muestra: r.muestra as number, n_personas_expandido: exp,
      sexo: [{ sexo: "hombres", n_expandido: r.hombres_exp as number, pct: pct(r.hombres_exp as number) }, { sexo: "mujeres", n_expandido: r.mujeres_exp as number, pct: pct(r.mujeres_exp as number) }],
      edad: ([["0-14", "edad_0_14"], ["15-29", "edad_15_29"], ["30-44", "edad_30_44"], ["45-64", "edad_45_64"], ["65+", "edad_65_plus"]] as const).map(([label, col]) => ({ bucket: label, n_expandido: r[col] as number, pct: pct(r[col] as number) })),
    };
  }
}

// ---------------------------------------------------------------- 7. gastos/by-rubro
const RubroRow = z.object({ slug: z.string(), nombre: z.string(), mean_gasto_trim: z.number(), mean_gasto_mensual: z.number(), pct_del_monetario: z.number(), oficial_mensual: z.number().nullable(), bound_delta_pct: z.number().nullable() });
const RubrosResponse = z.object({ decil: z.number().int().nullable(), mean_gasto_mon_trim: z.number(), rubros: z.array(RubroRow) });
const SQL_RUBROS = `
SELECT
    (SUM(gasto_mon * factor) / SUM(factor)) AS gasto_mon_trim,
    ${RUBROS.map(([col]) => `(SUM(${col} * factor) / SUM(factor)) AS ${col}_trim`).join(", ")}
FROM concentradohogar
WHERE (?1 IS NULL OR decil = ?1)`;
export class GastosByRubro extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "gastos_by_rubro_api_v1_enigh_gastos_by_rubro_get", summary: "Gastos By Rubro",
    description: "Los 9 rubros INEGI desde concentradohogar (summary oficial).\n\nCuando `decil` se especifica, la query se filtra a ese decil y `pct_del_monetario`\nse calcula respecto al gasto_mon de ese decil. Los valores `oficial_mensual` solo\naplican al total nacional (no a deciles específicos).",
    request: { query: z.object({ decil: z.number().int().min(1).max(10).optional() }) },
    responses: { ...ok("9 rubros INEGI con cifra mensual y trimestral por hogar.", RubrosResponse), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const decil = enteroOpcional(c.req.query("decil"), "decil", 1, 10);
    const r = (await fila<Record<string, number | null>>(c.env.DB_ENIGH, SQL_RUBROS, [decil]))!;
    const gasto_mon = r.gasto_mon_trim || 0;
    if (gasto_mon === 0) throw new ErrorHttp(404, `Decil ${decil === null ? "None" : decil} sin datos`);
    const oficiales = new Map(BOUNDS_GASTOS_MENSUAL.map(([col, , , of]) => [col, of]));
    const rubros = RUBROS.map(([col, slug, nombre]) => {
      const trim = r[`${col}_trim`] as number;
      const mensual = trim / 3.0;
      const of = oficiales.get(col);
      const aplica = !!of && decil === null;
      const delta = aplica ? ((mensual - of!) / of!) * 100 : null;
      return { slug, nombre, mean_gasto_trim: redondear(trim, 2), mean_gasto_mensual: redondear(mensual, 2), pct_del_monetario: redondear((100 * trim) / gasto_mon, 2), oficial_mensual: aplica ? of! : null, bound_delta_pct: delta !== null ? redondear(delta, 4) : null };
    });
    return { decil, mean_gasto_mon_trim: redondear(gasto_mon, 2), rubros };
  }
}

// ---------------------------------------------------------------- 8-9. actividad agro / noagro
const ActividadDecilRow = z.object({ decil: z.number().int(), n_hogares_muestra: z.number().int(), n_hogares_expandido: z.number().int(), pct_share_actividad: z.number() });
const ActividadEntidadRow = z.object({ clave: z.string(), nombre: z.string(), n_hogares_expandido: z.number().int() });
const sqlCobertura = (tabla: string) => `
WITH hog AS (SELECT DISTINCT folioviv, foliohog FROM ${tabla})
SELECT COUNT(*) AS n_muestra, SUM(h.factor) AS n_expandido, (SELECT SUM(factor) FROM hogares) AS n_universo
FROM hog JOIN hogares h USING (folioviv, foliohog)`;
const sqlPorDecil = (tabla: string) => `
WITH hog AS (SELECT DISTINCT folioviv, foliohog FROM ${tabla}),
x_decil AS (
    SELECT c.decil AS decil, COUNT(*) AS n_muestra, SUM(c.factor) AS n_expandido
    FROM hog JOIN concentradohogar c USING (folioviv, foliohog)
    WHERE c.decil IS NOT NULL
    GROUP BY c.decil
),
total AS (SELECT SUM(n_expandido) AS t FROM x_decil)
SELECT a.decil, a.n_muestra, a.n_expandido, (100.0 * a.n_expandido / (SELECT t FROM total)) AS pct_share_actividad
FROM x_decil a ORDER BY a.decil`;
const sqlTopEntidades = (tabla: string) => `
WITH hog AS (SELECT DISTINCT folioviv, foliohog FROM ${tabla})
SELECT h.entidad AS clave, e.descripcion AS nombre, SUM(h.factor) AS n_expandido
FROM hog JOIN hogares h USING (folioviv, foliohog)
JOIN cat_entidad e ON h.entidad = e.clave
GROUP BY h.entidad, e.descripcion
ORDER BY n_expandido DESC
LIMIT 5`;
type Cob = { n_muestra: number | null; n_expandido: number | null; n_universo: number | null };
type Dec = { decil: number; n_muestra: number; n_expandido: number; pct_share_actividad: number };
type Ent = { clave: string; nombre: string; n_expandido: number };
async function actividadComun(c: AppContext, tabla: string) {
  const cob = (await fila<Cob>(c.env.DB_ENIGH, sqlCobertura(tabla)))!;
  const dec = await filas<Dec>(c.env.DB_ENIGH, sqlPorDecil(tabla));
  const ent = await filas<Ent>(c.env.DB_ENIGH, sqlTopEntidades(tabla));
  const n_muestra = cob.n_muestra || 0, n_exp = cob.n_expandido || 0, n_univ = cob.n_universo || 1;
  return {
    n_muestra, n_exp, pct_del_universo: redondear((100 * n_exp) / n_univ, 2),
    por_decil: dec.map((r) => ({ decil: r.decil, n_hogares_muestra: r.n_muestra, n_hogares_expandido: r.n_expandido, pct_share_actividad: redondear(r.pct_share_actividad, 2) })),
    top_entidades: ent.map((r) => ({ clave: r.clave, nombre: r.nombre, n_hogares_expandido: r.n_expandido })),
  };
}
const ActividadAgroResponse = z.object({ n_hogares_muestra: z.number().int(), n_hogares_expandido: z.number().int(), pct_del_universo: z.number(), sum_ventas_trim: z.number().int(), sum_gasto_negocio_trim: z.number().int(), mean_ventas_por_hogar: z.number(), por_decil: z.array(ActividadDecilRow), top_entidades: z.array(ActividadEntidadRow), note: z.string() });
export class ActividadAgro extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "actividad_agro_api_v1_enigh_actividad_agro_get", summary: "Actividad Agro",
    description: "Hogares con actividad agropecuaria. Cobertura, distribución por decil, top entidades, ventas.",
    responses: { ...ok("Hogares con actividad agropecuaria por decil nacional (DISTINCT folioviv/foliohog).", ActividadAgroResponse), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const comun = await actividadComun(c, "agro");
    const ventas = (await fila<{ sum_ventas: number; sum_procesado: number }>(c.env.DB_ENIGH, "SELECT CAST(COALESCE(SUM(valrema), 0) AS INTEGER) AS sum_ventas, CAST(COALESCE(SUM(valproc), 0) AS INTEGER) AS sum_procesado FROM agro"))!;
    const gas = (await fila<{ sum_gasto_negocio: number }>(c.env.DB_ENIGH, "SELECT CAST(COALESCE(SUM(gasto), 0) AS INTEGER) AS sum_gasto_negocio FROM agrogasto"))!;
    const mean_ventas = comun.n_muestra > 0 ? ventas.sum_ventas / comun.n_muestra : 0.0;
    return { n_hogares_muestra: comun.n_muestra, n_hogares_expandido: comun.n_exp, pct_del_universo: comun.pct_del_universo, sum_ventas_trim: ventas.sum_ventas, sum_gasto_negocio_trim: gas.sum_gasto_negocio, mean_ventas_por_hogar: redondear(mean_ventas, 2), por_decil: comun.por_decil, top_entidades: comun.top_entidades, note: NOTE_AGRO };
  }
}
const ActividadNoagroResponse = z.object({ n_hogares_muestra: z.number().int(), n_hogares_expandido: z.number().int(), pct_del_universo: z.number(), sum_ventas_trim: z.number().int(), sum_ingreso_trim: z.number().int(), mean_ventas_por_hogar: z.number(), por_decil: z.array(ActividadDecilRow), top_entidades: z.array(ActividadEntidadRow), note: z.string() });
export class ActividadNoagro extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "actividad_noagro_api_v1_enigh_actividad_noagro_get", summary: "Actividad Noagro",
    description: "Hogares con actividad NO agropecuaria (comercio, servicios, manufactura).",
    responses: { ...ok("Hogares con actividad no agropecuaria por decil nacional.", ActividadNoagroResponse), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const comun = await actividadComun(c, "noagro");
    // ::bigint en Postgres trunca hacia cero la suma de numeric(15,2)
    const tri = (await fila<{ sum_ventas_trim: number; sum_ingreso_trim: number }>(c.env.DB_ENIGH, "SELECT CAST(COALESCE(SUM(ventas_tri), 0) AS INTEGER) AS sum_ventas_trim, CAST(COALESCE(SUM(ing_tri), 0) AS INTEGER) AS sum_ingreso_trim FROM noagro"))!;
    const mean_ventas = comun.n_muestra > 0 ? tri.sum_ventas_trim / comun.n_muestra : 0.0;
    return { n_hogares_muestra: comun.n_muestra, n_hogares_expandido: comun.n_exp, pct_del_universo: comun.pct_del_universo, sum_ventas_trim: tri.sum_ventas_trim, sum_ingreso_trim: tri.sum_ingreso_trim, mean_ventas_por_hogar: redondear(mean_ventas, 2), por_decil: comun.por_decil, top_entidades: comun.top_entidades, note: NOTE_NOAGRO };
  }
}

// ---------------------------------------------------------------- 10. actividad/jcf
const JcfEntidadRow = z.object({ clave: z.string(), nombre: z.string(), beneficiarios_muestra: z.number().int(), beneficiarios_expandido: z.number().int() });
const ActividadJcfResponse = z.object({ n_beneficiarios_muestra: z.number().int(), n_beneficiarios_expandido: z.number().int(), sum_ingreso_trim: z.number().int(), mean_ingreso_trim_por_beneficiario: z.number(), por_entidad: z.array(JcfEntidadRow), note: z.string() });
export class ActividadJcf extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "actividad_jcf_api_v1_enigh_actividad_jcf_get", summary: "Actividad Jcf",
    description: "Beneficiarios del Programa Jóvenes Construyendo el Futuro (JCF).\n\nDataset pequeño (n=327 muestra). Distribución por entidad + promedio ingreso trimestral.\nExpandido usa poblacion.factor (factor de persona, no hogar) porque\nbeneficiarios son individuos.",
    responses: { ...ok("Hogares con ingresos por Jóvenes Construyendo el Futuro (327 hogares muestra).", ActividadJcfResponse), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const sm = (await fila<{ n_muestra: number; sum_ing_tri: number | null }>(c.env.DB_ENIGH, "SELECT COUNT(DISTINCT folioviv || '|' || foliohog || '|' || numren) AS n_muestra, CAST(SUM(ing_tri) AS INTEGER) AS sum_ing_tri FROM ingresos_jcf"))!;
    const ex = (await fila<{ n_expandido: number }>(c.env.DB_ENIGH, "SELECT COALESCE(SUM(p.factor), 0) AS n_expandido FROM (SELECT DISTINCT folioviv, foliohog, numren FROM ingresos_jcf) j JOIN poblacion p USING (folioviv, foliohog, numren)"))!;
    const ent = await filas<{ clave: string; nombre: string; benef_muestra: number; benef_expandido: number }>(c.env.DB_ENIGH, `
SELECT h.entidad AS clave, e.descripcion AS nombre,
       COUNT(DISTINCT j.folioviv || '|' || j.foliohog || '|' || j.numren) AS benef_muestra,
       SUM(p.factor) AS benef_expandido
FROM ingresos_jcf j
JOIN hogares h USING (folioviv, foliohog)
JOIN poblacion p USING (folioviv, foliohog, numren)
JOIN cat_entidad e ON h.entidad = e.clave
GROUP BY h.entidad, e.descripcion
ORDER BY benef_expandido DESC`);
    const n_mu = sm.n_muestra || 0, sum_ing = sm.sum_ing_tri || 0;
    return { n_beneficiarios_muestra: n_mu, n_beneficiarios_expandido: ex.n_expandido, sum_ingreso_trim: sum_ing, mean_ingreso_trim_por_beneficiario: redondear(n_mu > 0 ? sum_ing / n_mu : 0.0, 2), por_entidad: ent.map((r) => ({ clave: r.clave, nombre: r.nombre, beneficiarios_muestra: r.benef_muestra, beneficiarios_expandido: r.benef_expandido })), note: NOTE_JCF };
  }
}

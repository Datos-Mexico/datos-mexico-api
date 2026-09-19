// Dashboard (snapshot desde las vistas materializadas copiadas) y analytics con funciones de ventana.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { redondear } from "../lib/numeros";
import { enteroConDefault } from "./comun";

const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const r429 = (n: number) => ({ "429": { description: `Rate limit excedido (${n} req/min por IP).`, ...contentJson(z.object({ detail: z.string() })) } });

// ---------------------------------------------------------------- 4.1 dashboard/stats
const LabelCount = z.object({ label: z.string(), count: z.number().int() });
const LabelAvg = z.object({ label: z.string(), avg: z.number() });
const SectorStats = z.object({ name: z.string(), count: z.number().int(), avgSalary: z.number(), avgMale: z.number(), avgFemale: z.number() });
const GenderGapSector = z.object({ name: z.string(), avgMale: z.number(), avgFemale: z.number(), gap: z.number() });
const TopPosition = z.object({ name: z.string(), count: z.number().int(), avgSalary: z.number() });
const SeniorityWithSalary = z.object({ label: z.string(), avg: z.number(), count: z.number().int() });
const BrutoNetoRange = z.object({ label: z.string(), avgBruto: z.number(), avgNeto: z.number(), count: z.number().int() });
const DashboardStats = z.object({
  totalServidores: z.number().int(), totalSectors: z.number().int(), avgSalary: z.number(), medianSalary: z.number(), minSalary: z.number(), maxSalary: z.number(),
  p25: z.number(), p50: z.number(), p75: z.number(), p90: z.number(), genderGapPercent: z.number(), hombres: z.number().int(), mujeres: z.number().int(), avgSalaryMale: z.number(), avgSalaryFemale: z.number(),
  salaryDistribution: z.array(LabelCount), ageDistribution: z.array(LabelCount), contractTypes: z.array(LabelCount), personalTypes: z.array(LabelCount), salaryByAge: z.array(LabelAvg),
  top15Sectors: z.array(SectorStats), allSectors: z.array(SectorStats), genderGapBySector: z.array(GenderGapSector), topPositions: z.array(TopPosition),
  seniorityDistribution: z.array(LabelCount), salaryBySeniority: z.array(SeniorityWithSalary), avgSeniority: z.number(), avgNetSalary: z.number(), avgDeduction: z.number(), avgDeductionPercent: z.number(), brutoNetoByRange: z.array(BrutoNetoRange),
});
export class DashboardStatsEndpoint extends OpenAPIRoute {
  schema = {
    tags: ["dashboard"], operationId: "dashboard_stats_api_v1_dashboard_stats_get", summary: "Snapshot agregado del padrón CDMX",
    description: "Devuelve un snapshot completo del dataset de servidores públicos de la CDMX (246K nombramientos): totales, percentiles salariales (p25/p50/p75/p90), distribuciones por sueldo / edad / contratación / tipo de personal, top 15 sectores, brecha de género por sector (top 10 por magnitud absoluta), posiciones más frecuentes, distribución de antigüedad, y desglose bruto vs neto por rango. Las cifras provienen mayoritariamente de las cinco materialized views `cdmx.mv_dashboard_*` (refresco vía `POST /api/v1/admin/refresh-materialized-views`). Cache HTTP `public, max-age=3600`.",
    responses: { ...ok("Snapshot completo del padrón CDMX.", DashboardStats), ...r429(10) },
  };
  async handle(c: AppContext) {
    const db = c.env.DB_CDMX;
    const ov = (await fila<Record<string, number | null>>(db, "SELECT * FROM mv_dashboard_overview WHERE key = 1"))!;
    const salary_dist = await filas<{ label: string; count: number }>(db, `
SELECT label, count FROM (
    SELECT 'Menos de $5K' AS label, COUNT(*) AS count, 1 AS ord FROM nombramientos WHERE sueldo_bruto < 5000 AND sueldo_bruto IS NOT NULL
    UNION ALL SELECT '$5K - $10K', COUNT(*), 2 FROM nombramientos WHERE sueldo_bruto >= 5000 AND sueldo_bruto < 10000
    UNION ALL SELECT '$10K - $20K', COUNT(*), 3 FROM nombramientos WHERE sueldo_bruto >= 10000 AND sueldo_bruto < 20000
    UNION ALL SELECT '$20K - $40K', COUNT(*), 4 FROM nombramientos WHERE sueldo_bruto >= 20000 AND sueldo_bruto < 40000
    UNION ALL SELECT 'Más de $40K', COUNT(*), 5 FROM nombramientos WHERE sueldo_bruto >= 40000
) sub ORDER BY ord`);
    const age_dist = await filas<{ label: string; count: number }>(db, `
SELECT label, count FROM (
    SELECT '18-25' AS label, COUNT(*) AS count, 1 AS ord FROM personas WHERE edad BETWEEN 18 AND 25
    UNION ALL SELECT '26-35', COUNT(*), 2 FROM personas WHERE edad BETWEEN 26 AND 35
    UNION ALL SELECT '36-45', COUNT(*), 3 FROM personas WHERE edad BETWEEN 36 AND 45
    UNION ALL SELECT '46-55', COUNT(*), 4 FROM personas WHERE edad BETWEEN 46 AND 55
    UNION ALL SELECT '56+', COUNT(*), 5 FROM personas WHERE edad > 55
) sub ORDER BY ord`);
    const contract = await filas<{ label: string; count: number }>(db, "SELECT ct.nombre AS label, COUNT(*) AS count FROM nombramientos n JOIN cat_tipos_contratacion ct ON n.tipo_contratacion_id = ct.id GROUP BY ct.nombre ORDER BY count DESC");
    const personal = await filas<{ label: string; count: number }>(db, "SELECT tp.nombre AS label, COUNT(*) AS count FROM nombramientos n JOIN cat_tipos_personal tp ON n.tipo_personal_id = tp.id GROUP BY tp.nombre ORDER BY count DESC");
    const salary_age = await filas<{ label: string; avg: number }>(db, "SELECT label, avg FROM mv_dashboard_salary_by_age ORDER BY ord");
    const sectors = await filas<{ name: string; count: number; avg_salary: number; avg_male: number; avg_female: number }>(db, "SELECT name, count, avg_salary, avg_male, avg_female FROM mv_dashboard_sectors ORDER BY count DESC, rowid");
    const positions = await filas<{ name: string; count: number; avg_salary: number }>(db, "SELECT name, count, avg_salary FROM mv_dashboard_top_positions ORDER BY avg_salary DESC, rowid");
    const seniority = await filas<{ label: string; count_all: number; count_with_salary: number; avg_salary: number }>(db, "SELECT label, count_all, count_with_salary, avg_salary FROM mv_dashboard_seniority ORDER BY ord");
    const bruto_neto = await filas<{ label: string; avg_bruto: number; avg_neto: number; count: number }>(db, `
SELECT label, avg_bruto, avg_neto, count FROM (
    SELECT 'Menos de $5K' AS label, AVG(sueldo_bruto) AS avg_bruto, AVG(sueldo_neto) AS avg_neto, COUNT(*) AS count, 1 AS ord FROM nombramientos WHERE sueldo_bruto < 5000 AND sueldo_bruto IS NOT NULL AND sueldo_neto IS NOT NULL
    UNION ALL SELECT '$5K - $10K', AVG(sueldo_bruto), AVG(sueldo_neto), COUNT(*), 2 FROM nombramientos WHERE sueldo_bruto >= 5000 AND sueldo_bruto < 10000 AND sueldo_neto IS NOT NULL
    UNION ALL SELECT '$10K - $20K', AVG(sueldo_bruto), AVG(sueldo_neto), COUNT(*), 3 FROM nombramientos WHERE sueldo_bruto >= 10000 AND sueldo_bruto < 20000 AND sueldo_neto IS NOT NULL
    UNION ALL SELECT '$20K - $40K', AVG(sueldo_bruto), AVG(sueldo_neto), COUNT(*), 4 FROM nombramientos WHERE sueldo_bruto >= 20000 AND sueldo_bruto < 40000 AND sueldo_neto IS NOT NULL
    UNION ALL SELECT 'Más de $40K', AVG(sueldo_bruto), AVG(sueldo_neto), COUNT(*), 5 FROM nombramientos WHERE sueldo_bruto >= 40000 AND sueldo_neto IS NOT NULL
) sub ORDER BY ord`);
    const all_sectors = sectors.map((r) => ({ name: r.name, count: r.count, avgSalary: redondear(r.avg_salary, 2), avgMale: redondear(r.avg_male, 2), avgFemale: redondear(r.avg_female, 2) }));
    const gaps = all_sectors.filter((s) => s.avgMale > 0 && s.avgFemale > 0).map((s) => ({ name: s.name, avgMale: s.avgMale, avgFemale: s.avgFemale, gap: redondear(((s.avgMale - s.avgFemale) / s.avgFemale) * 100, 2) }));
    gaps.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)); // sort estable, como Python
    const avg_male = ov.avg_male || 0, avg_female = ov.avg_female || 0;
    const r2 = (v: number | null | undefined) => redondear(v || 0, 2);
    return {
      totalServidores: ov.total as number, totalSectors: ov.total_sectors as number, avgSalary: r2(ov.avg_salary), medianSalary: r2(ov.median_salary), minSalary: r2(ov.min_salary), maxSalary: r2(ov.max_salary),
      p25: r2(ov.p25), p50: r2(ov.p50), p75: r2(ov.p75), p90: r2(ov.p90), genderGapPercent: avg_female > 0 ? redondear(((avg_male - avg_female) / avg_female) * 100, 2) : 0,
      hombres: ov.hombres as number, mujeres: ov.mujeres as number, avgSalaryMale: redondear(avg_male, 2), avgSalaryFemale: redondear(avg_female, 2),
      salaryDistribution: salary_dist, ageDistribution: age_dist, contractTypes: contract, personalTypes: personal,
      salaryByAge: salary_age.map((r) => ({ label: r.label, avg: redondear(r.avg, 2) })),
      top15Sectors: all_sectors.slice(0, 15), allSectors: all_sectors, genderGapBySector: gaps.slice(0, 10),
      topPositions: positions.map((r) => ({ name: r.name, count: r.count, avgSalary: redondear(r.avg_salary, 2) })),
      seniorityDistribution: seniority.map((r) => ({ label: r.label, count: r.count_all })),
      salaryBySeniority: seniority.map((r) => ({ label: r.label, avg: redondear(r.avg_salary, 2), count: r.count_with_salary })),
      avgSeniority: r2(ov.avg_seniority), avgNetSalary: r2(ov.avg_net), avgDeduction: r2(ov.avg_deduction), avgDeductionPercent: r2(ov.avg_deduction_pct),
      brutoNetoByRange: bruto_neto.map((r) => ({ label: r.label, avgBruto: redondear(r.avg_bruto, 2), avgNeto: redondear(r.avg_neto, 2), count: r.count })),
    };
  }
}

// ---------------------------------------------------------------- 5.1 analytics/puestos/ranking
const PuestoRanking = z.object({ puesto_id: z.number().int(), nombre: z.string(), avg_sueldo: z.number(), count: z.number().int(), rank: z.number().int(), percent_rank: z.number(), gap_vs_next: z.number().nullable() });
export class PuestosRanking extends OpenAPIRoute {
  schema = {
    tags: ["analytics"], operationId: "puestos_ranking_api_v1_analytics_puestos_ranking_get", summary: "Top puestos por sueldo promedio (RANK + PERCENT_RANK + LAG)",
    description: "Top puestos del padrón CDMX ordenados por sueldo bruto promedio descendente. Cada fila incluye `rank` (RANK), `percent_rank` (PERCENT_RANK normalizado 0..1) y `gap_vs_next` (diferencia absoluta vs el sueldo del puesto anterior — útil para detectar saltos discontinuos en la curva). Filtro implícito: sólo puestos con `COUNT(*) >= 5` para evitar outliers de un solo nombramiento. Cache HTTP `public, max-age=900`.",
    request: { query: z.object({ limit: z.number().int().min(1).max(100).default(20) }) },
    responses: { ...ok("Lista rankeada de puestos.", z.array(PuestoRanking)), ...r429(20) },
  };
  async handle(c: AppContext) {
    const limit = enteroConDefault(c.req.query("limit"), "limit", 20, 1, 100);
    const rows = await filas<{ puesto_id: number; nombre: string; avg_sueldo: number; count: number; rank: number; percent_rank: number; prev_avg: number | null }>(c.env.DB_CDMX, `
WITH agg AS (
    SELECT cp.id AS puesto_id, cp.nombre AS nombre, AVG(n.sueldo_bruto) AS avg_sueldo, COUNT(*) AS cnt
    FROM nombramientos n JOIN cat_puestos cp ON n.puesto_id = cp.id WHERE n.sueldo_bruto IS NOT NULL GROUP BY cp.id, cp.nombre HAVING COUNT(*) >= 5
)
SELECT puesto_id, nombre, avg_sueldo, cnt AS count, RANK() OVER (ORDER BY avg_sueldo DESC) AS rank, PERCENT_RANK() OVER (ORDER BY avg_sueldo) AS percent_rank, LAG(avg_sueldo) OVER (ORDER BY avg_sueldo DESC) AS prev_avg
FROM agg ORDER BY avg_sueldo DESC, puesto_id LIMIT ?1`, [limit]);
    return rows.map((r) => ({ puesto_id: r.puesto_id, nombre: r.nombre, avg_sueldo: redondear(r.avg_sueldo, 2), count: r.count, rank: r.rank, percent_rank: redondear(r.percent_rank, 4), gap_vs_next: r.prev_avg !== null ? redondear(r.avg_sueldo - r.prev_avg, 2) : null }));
  }
}

// ---------------------------------------------------------------- 5.2 analytics/sectores/ranking
const SectorRanking = z.object({ sector_id: z.number().int(), nombre: z.string(), avg_sueldo: z.number(), count: z.number().int(), rank: z.number().int(), percent_rank: z.number(), avg_vs_global_pct: z.number() });
export class SectoresRanking extends OpenAPIRoute {
  schema = {
    tags: ["analytics"], operationId: "sectores_ranking_api_v1_analytics_sectores_ranking_get", summary: "Sectores rankeados por sueldo promedio (con desviación vs media global)",
    description: "Los 73 sectores del padrón CDMX rankeados por sueldo bruto promedio descendente. Cada fila incluye `avg_vs_global_pct` (desviación porcentual del sector respecto al promedio global computado con `AVG() OVER ()`), útil para identificar sectores atípicos por encima o debajo de la media institucional. Cache HTTP `public, max-age=900`.",
    responses: { ...ok("Lista rankeada de los 73 sectores.", z.array(SectorRanking)), ...r429(20) },
  };
  async handle(c: AppContext) {
    const rows = await filas<{ sector_id: number; nombre: string; avg_sueldo: number; count: number; rank: number; percent_rank: number; avg_global: number | null }>(c.env.DB_CDMX, `
WITH agg AS (
    SELECT cs.id AS sector_id, cs.nombre AS nombre, AVG(n.sueldo_bruto) AS avg_sueldo, COUNT(*) AS cnt
    FROM nombramientos n JOIN cat_sectores cs ON n.sector_id = cs.id WHERE n.sueldo_bruto IS NOT NULL GROUP BY cs.id, cs.nombre
)
SELECT sector_id, nombre, avg_sueldo, cnt AS count, RANK() OVER (ORDER BY avg_sueldo DESC) AS rank, PERCENT_RANK() OVER (ORDER BY avg_sueldo) AS percent_rank, AVG(avg_sueldo) OVER () AS avg_global
FROM agg ORDER BY rank, sector_id`);
    return rows.map((r) => ({ sector_id: r.sector_id, nombre: r.nombre, avg_sueldo: redondear(r.avg_sueldo, 2), count: r.count, rank: r.rank, percent_rank: redondear(r.percent_rank, 4), avg_vs_global_pct: r.avg_global ? redondear(((r.avg_sueldo - r.avg_global) / r.avg_global) * 100, 2) : 0.0 }));
  }
}

// ---------------------------------------------------------------- 5.3 analytics/brecha-edad
const BrechaEdadRow = z.object({ bucket_edad: z.string(), avg_male: z.number().nullable(), avg_female: z.number().nullable(), count_male: z.number().int(), count_female: z.number().int(), gap_pct: z.number().nullable(), running_avg_global: z.number() });
export class BrechaEdad extends OpenAPIRoute {
  schema = {
    tags: ["analytics"], operationId: "brecha_edad_api_v1_analytics_brecha_edad_get", summary: "Brecha salarial por grupo etario (con referencia global)",
    description: "Brecha salarial hombre/mujer (`gap_pct = (avg_male - avg_female) / avg_female * 100`) por bucket de edad: `18-25`, `26-35`, `36-45`, `46-55`, `56+`. Devuelve también `running_avg_global` (promedio del padrón completo replicado en cada fila, vía `AVG() OVER ()`) para que el consumidor compare cada bucket con el promedio global sin emitir un request adicional. Cache HTTP `public, max-age=900`.",
    responses: { ...ok("Brecha por grupo etario (5 buckets).", z.array(BrechaEdadRow)), ...r429(20) },
  };
  async handle(c: AppContext) {
    const rows = await filas<{ bucket_edad: string; avg_male: number | null; avg_female: number | null; count_male: number; count_female: number; gap_pct: number | null; running_avg_global: number }>(c.env.DB_CDMX, `
WITH buckets AS (
    SELECT CASE WHEN p.edad BETWEEN 18 AND 25 THEN '18-25' WHEN p.edad BETWEEN 26 AND 35 THEN '26-35' WHEN p.edad BETWEEN 36 AND 45 THEN '36-45' WHEN p.edad BETWEEN 46 AND 55 THEN '46-55' WHEN p.edad > 55 THEN '56+' ELSE NULL END AS bucket_edad,
           CASE WHEN p.edad BETWEEN 18 AND 25 THEN 1 WHEN p.edad BETWEEN 26 AND 35 THEN 2 WHEN p.edad BETWEEN 36 AND 45 THEN 3 WHEN p.edad BETWEEN 46 AND 55 THEN 4 WHEN p.edad > 55 THEN 5 END AS ord,
           n.sueldo_bruto, csex.nombre AS sexo
    FROM nombramientos n JOIN personas p ON n.persona_id = p.id LEFT JOIN cat_sexos csex ON p.sexo_id = csex.id
    WHERE n.sueldo_bruto IS NOT NULL AND p.edad IS NOT NULL
),
agg AS (
    SELECT bucket_edad, ord, AVG(CASE WHEN sexo = 'MASCULINO' THEN sueldo_bruto END) AS avg_male, AVG(CASE WHEN sexo = 'FEMENINO' THEN sueldo_bruto END) AS avg_female,
           COUNT(CASE WHEN sexo = 'MASCULINO' THEN 1 END) AS count_male, COUNT(CASE WHEN sexo = 'FEMENINO' THEN 1 END) AS count_female, AVG(sueldo_bruto) AS avg_bucket
    FROM buckets WHERE bucket_edad IS NOT NULL GROUP BY bucket_edad, ord
)
SELECT bucket_edad, avg_male, avg_female, count_male, count_female,
       CASE WHEN avg_male IS NOT NULL AND avg_female IS NOT NULL AND avg_female > 0 THEN ((avg_male - avg_female) / avg_female * 100) ELSE NULL END AS gap_pct,
       AVG(avg_bucket) OVER () AS running_avg_global
FROM agg ORDER BY ord`);
    return rows.map((r) => ({ bucket_edad: r.bucket_edad, avg_male: r.avg_male !== null ? redondear(r.avg_male, 2) : null, avg_female: r.avg_female !== null ? redondear(r.avg_female, 2) : null, count_male: r.count_male, count_female: r.count_female, gap_pct: r.gap_pct !== null ? redondear(r.gap_pct, 2) : null, running_avg_global: redondear(r.running_avg_global, 2) }));
  }
}

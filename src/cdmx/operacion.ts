// Operación: recalcula las cinco tablas del tablero (mv_dashboard_*) a partir de las tablas oficiales del padrón
// CDMX, con las mismas definiciones que las vistas materializadas del legacy (migración 004). No modifica ningún
// dato publicado: solo las tablas derivadas. Requiere JWT admin; cupo 5/min.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { percentilCont } from "../lib/estadistica";
import { RESP_401, RESP_403, SEGURIDAD, requiereAdmin } from "../lib/auth";

const VISTAS = ["cdmx.mv_dashboard_overview", "cdmx.mv_dashboard_sectors", "cdmx.mv_dashboard_top_positions", "cdmx.mv_dashboard_salary_by_age", "cdmx.mv_dashboard_seniority"];
// EXTRACT(YEAR FROM AGE(CURRENT_DATE, fecha_ingreso)) de Postgres = años cumplidos a la fecha de hoy.
const ANIOS = "(CAST(strftime('%Y','now') AS INTEGER) - CAST(strftime('%Y', fecha_ingreso) AS INTEGER) - CASE WHEN strftime('%m-%d','now') < strftime('%m-%d', fecha_ingreso) THEN 1 ELSE 0 END)";
const AVG = (col: string) => `AVG(${col})`;

export class AdminRefrescarTablero extends OpenAPIRoute {
  schema = {
    tags: ["admin"], operationId: "refresh_materialized_views_api_v1_admin_refresh_materialized_views_post", summary: "[Operacional] Recalcular las 5 tablas derivadas del tablero (mv_dashboard_*)", security: SEGURIDAD,
    description: "**Operacional — no debe consumirse desde producción de forma programática.** Recalcula las cinco tablas derivadas del tablero de servidores públicos de la CDMX (`mv_dashboard_overview`, `mv_dashboard_sectors`, `mv_dashboard_top_positions`, `mv_dashboard_salary_by_age`, `mv_dashboard_seniority`) a partir de las tablas oficiales `personas`, `nombramientos` y catálogos, con las mismas definiciones que las vistas materializadas del legacy. No modifica ningún dato publicado. Diseñado para invocación manual tras cargar una nueva edición del padrón. Rate limit estricto (5/min/IP). Requiere JWT admin.",
    responses: { "200": { description: "Refresco completado.", ...contentJson(z.object({ refreshed: z.array(z.string()), duration_ms: z.number().int() })) }, ...RESP_401, ...RESP_403, "429": { description: "Rate limit excedido (5 req/min por IP).", ...contentJson(z.object({ detail: z.string() })) } },
  };
  async handle(c: AppContext) {
    await requiereAdmin(c);
    const t0 = Date.now(); const db = c.env.DB_CDMX;
    const base = "FROM nombramientos n JOIN personas p ON n.persona_id = p.id LEFT JOIN cat_sexos csex ON p.sexo_id = csex.id WHERE n.sueldo_bruto IS NOT NULL";
    const ov = (await fila<Record<string, number | null>>(db, `SELECT COUNT(*) AS total, COUNT(DISTINCT n.sector_id) AS total_sectors, ${AVG("n.sueldo_bruto")} AS avg_salary, MIN(n.sueldo_bruto) AS min_salary, MAX(n.sueldo_bruto) AS max_salary,
      SUM(CASE WHEN csex.nombre = 'MASCULINO' THEN 1 ELSE 0 END) AS hombres, SUM(CASE WHEN csex.nombre = 'FEMENINO' THEN 1 ELSE 0 END) AS mujeres,
      AVG(CASE WHEN csex.nombre = 'MASCULINO' THEN n.sueldo_bruto END) AS avg_male, AVG(CASE WHEN csex.nombre = 'FEMENINO' THEN n.sueldo_bruto END) AS avg_female,
      ${AVG("n.sueldo_neto")} AS avg_net, ${AVG("n.sueldo_bruto - n.sueldo_neto")} AS avg_deduction, AVG(${ANIOS.replace(/fecha_ingreso/g, "n.fecha_ingreso")}) AS avg_seniority ${base}`))!;
    const [p25, p50, p75, p90] = await percentilCont(db, "nombramientos", "sueldo_bruto", "sueldo_bruto IS NOT NULL", [0.25, 0.5, 0.75, 0.9]);
    const pct = ov.avg_salary && ov.avg_salary > 0 ? ((ov.avg_deduction ?? 0) / ov.avg_salary) * 100 : 0;
    const sectores = await filas<Record<string, unknown>>(db, `SELECT cs.id AS sector_id, cs.nombre AS name, COUNT(n.id) AS count, AVG(n.sueldo_bruto) AS avg_salary, COALESCE(AVG(CASE WHEN csex.nombre = 'MASCULINO' THEN n.sueldo_bruto END), 0) AS avg_male, COALESCE(AVG(CASE WHEN csex.nombre = 'FEMENINO' THEN n.sueldo_bruto END), 0) AS avg_female
      FROM cat_sectores cs JOIN nombramientos n ON n.sector_id = cs.id JOIN personas p ON n.persona_id = p.id LEFT JOIN cat_sexos csex ON p.sexo_id = csex.id WHERE n.sueldo_bruto IS NOT NULL GROUP BY cs.id, cs.nombre ORDER BY count DESC`);
    const top = await filas<Record<string, unknown>>(db, "SELECT cp.id AS puesto_id, cp.nombre AS name, COUNT(*) AS count, AVG(n.sueldo_bruto) AS avg_salary FROM nombramientos n JOIN cat_puestos cp ON n.puesto_id = cp.id WHERE n.sueldo_bruto IS NOT NULL GROUP BY cp.id, cp.nombre ORDER BY avg_salary DESC, count DESC, cp.nombre LIMIT 10");  // desempate determinista (el legacy no lo fija)
    const edad = await filas<Record<string, unknown>>(db, `SELECT label, avg, ord FROM (
      SELECT '18-25' AS label, AVG(n.sueldo_bruto) AS avg, 1 AS ord FROM nombramientos n JOIN personas p ON n.persona_id = p.id WHERE p.edad BETWEEN 18 AND 25 AND n.sueldo_bruto IS NOT NULL
      UNION ALL SELECT '26-35', AVG(n.sueldo_bruto), 2 FROM nombramientos n JOIN personas p ON n.persona_id = p.id WHERE p.edad BETWEEN 26 AND 35 AND n.sueldo_bruto IS NOT NULL
      UNION ALL SELECT '36-45', AVG(n.sueldo_bruto), 3 FROM nombramientos n JOIN personas p ON n.persona_id = p.id WHERE p.edad BETWEEN 36 AND 45 AND n.sueldo_bruto IS NOT NULL
      UNION ALL SELECT '46-55', AVG(n.sueldo_bruto), 4 FROM nombramientos n JOIN personas p ON n.persona_id = p.id WHERE p.edad BETWEEN 46 AND 55 AND n.sueldo_bruto IS NOT NULL
      UNION ALL SELECT '56+', AVG(n.sueldo_bruto), 5 FROM nombramientos n JOIN personas p ON n.persona_id = p.id WHERE p.edad > 55 AND n.sueldo_bruto IS NOT NULL)`);
    const rangos: [string, number, string][] = [["0-2 años", 1, `${ANIOS} BETWEEN 0 AND 2`], ["3-5 años", 2, `${ANIOS} BETWEEN 3 AND 5`], ["6-10 años", 3, `${ANIOS} BETWEEN 6 AND 10`], ["11-20 años", 4, `${ANIOS} BETWEEN 11 AND 20`], ["21-30 años", 5, `${ANIOS} BETWEEN 21 AND 30`], ["30+ años", 6, `${ANIOS} > 30`]];
    const antig = [];
    for (const [label, ord, cond] of rangos) {
      const r = (await fila<{ a: number; b: number; s: number | null }>(db, `SELECT (SELECT COUNT(*) FROM nombramientos WHERE fecha_ingreso IS NOT NULL AND ${cond}) AS a, (SELECT COUNT(*) FROM nombramientos WHERE fecha_ingreso IS NOT NULL AND sueldo_bruto IS NOT NULL AND ${cond}) AS b, (SELECT AVG(sueldo_bruto) FROM nombramientos WHERE fecha_ingreso IS NOT NULL AND sueldo_bruto IS NOT NULL AND ${cond}) AS s`))!;
      antig.push({ label, ord, count_all: r.a, count_with_salary: r.b, avg_salary: r.s });
    }
    const sentencias = [
      db.prepare("DELETE FROM mv_dashboard_overview"),
      db.prepare("INSERT INTO mv_dashboard_overview (key, total, total_sectors, avg_salary, median_salary, min_salary, max_salary, p25, p50, p75, p90, hombres, mujeres, avg_male, avg_female, avg_net, avg_deduction, avg_deduction_pct, avg_seniority) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(ov.total, ov.total_sectors, ov.avg_salary, p50, ov.min_salary, ov.max_salary, p25, p50, p75, p90, ov.hombres, ov.mujeres, ov.avg_male, ov.avg_female, ov.avg_net, ov.avg_deduction, pct, ov.avg_seniority),
      db.prepare("DELETE FROM mv_dashboard_sectors"),
      ...sectores.map((s) => db.prepare("INSERT INTO mv_dashboard_sectors (sector_id, name, count, avg_salary, avg_male, avg_female) VALUES (?, ?, ?, ?, ?, ?)").bind(s.sector_id, s.name, s.count, s.avg_salary, s.avg_male, s.avg_female)),
      db.prepare("DELETE FROM mv_dashboard_top_positions"),
      ...top.map((t) => db.prepare("INSERT INTO mv_dashboard_top_positions (puesto_id, name, count, avg_salary) VALUES (?, ?, ?, ?)").bind(t.puesto_id, t.name, t.count, t.avg_salary)),
      db.prepare("DELETE FROM mv_dashboard_salary_by_age"),
      ...edad.map((e) => db.prepare("INSERT INTO mv_dashboard_salary_by_age (label, avg, ord) VALUES (?, ?, ?)").bind(e.label, e.avg, e.ord)),
      db.prepare("DELETE FROM mv_dashboard_seniority"),
      ...antig.map((a) => db.prepare("INSERT INTO mv_dashboard_seniority (label, ord, count_all, count_with_salary, avg_salary) VALUES (?, ?, ?, ?, ?)").bind(a.label, a.ord, a.count_all, a.count_with_salary, a.avg_salary)),
    ];
    await db.batch(sentencias);
    return { refreshed: VISTAS, duration_ms: Date.now() - t0 };
  }
}

// Servidores públicos CDMX: lista, stats y detalle; export CSV.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import { percentilCont } from "../lib/estadistica";
import { FiltrosQuery, dec2, enteroRuta, leerFiltros, ordenSql, paginado, paginas, predicados } from "./comun";

const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const SELECT_LISTA = `
SELECT p.id, p.nombre, p.apellido_1, p.apellido_2, csex.nombre AS sexo, p.edad, n.sueldo_bruto, n.sueldo_neto, cs.nombre AS sector, cp.nombre AS puesto
FROM personas p JOIN nombramientos n ON n.persona_id = p.id LEFT OUTER JOIN cat_sexos csex ON p.sexo_id = csex.id LEFT OUTER JOIN cat_sectores cs ON n.sector_id = cs.id LEFT OUTER JOIN cat_puestos cp ON n.puesto_id = cp.id`;
const COUNT_LISTA = `SELECT count(p.id) AS n FROM personas p JOIN nombramientos n ON n.persona_id = p.id LEFT OUTER JOIN cat_sexos csex ON p.sexo_id = csex.id LEFT OUTER JOIN cat_puestos cp ON n.puesto_id = cp.id`;

// ---------------------------------------------------------------- 1.1 lista
const ServidorListItem = z.object({ id: z.number().int(), nombre: z.string(), apellido_1: z.string(), apellido_2: z.string().nullable(), sexo: z.string(), edad: z.number().int().nullable(), sueldo_bruto: z.string().nullable(), sueldo_neto: z.string().nullable(), sector: z.string().nullable(), puesto: z.string().nullable() });
export class ServidoresLista extends OpenAPIRoute {
  schema = {
    tags: ["servidores"], operationId: "list_servidores_api_v1_servidores__get", summary: "Listar servidores con filtros y paginación",
    description: "Lista paginada de servidores del padrón CDMX (246K registros). Soporta filtros por `sector_id`, `sexo`, rango de edad, rango de sueldo, `tipo_contratacion_id`, `tipo_personal_id`, `universo_id`, y `puesto_search` (búsqueda ILIKE sobre el nombre del puesto). Cache HTTP `public, max-age=300`.",
    request: { query: FiltrosQuery },
    responses: { ...ok("Página de servidores.", paginado(ServidorListItem)), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const f = leerFiltros((k) => c.req.query(k));
    const { where, params } = predicados(f);
    const total = (await fila<{ n: number }>(c.env.DB_CDMX, `${COUNT_LISTA} WHERE ${where}`, params))!.n;
    const rows = await filas<Record<string, unknown>>(c.env.DB_CDMX, `${SELECT_LISTA} WHERE ${where} ${ordenSql(f)} LIMIT ${f.per_page} OFFSET ${(f.page - 1) * f.per_page}`, params);
    return { data: rows.map((r) => ({ ...r, sueldo_bruto: dec2(r.sueldo_bruto as number | null), sueldo_neto: dec2(r.sueldo_neto as number | null) })), total, page: f.page, per_page: f.per_page, pages: paginas(total, f.per_page) };
  }
}

// ---------------------------------------------------------------- 1.2 stats
const SueldoDistribucion = z.object({ rango: z.string(), count: z.number().int() });
const ServidorStats = z.object({ total: z.number().int(), sueldo_bruto_avg: z.number().nullable(), sueldo_bruto_median: z.number().nullable(), sueldo_bruto_p25: z.number().nullable(), sueldo_bruto_p75: z.number().nullable(), sueldo_bruto_min: z.number().nullable(), sueldo_bruto_max: z.number().nullable(), sueldo_neto_avg: z.number().nullable(), edad_avg: z.number().nullable(), count_hombres: z.number().int(), count_mujeres: z.number().int(), brecha_genero_pct: z.number().nullable(), distribucion_sueldo: z.array(SueldoDistribucion) });
export class ServidoresStats extends OpenAPIRoute {
  schema = {
    tags: ["servidores"], operationId: "servidor_stats_api_v1_servidores_stats_get", summary: "Estadísticas agregadas con filtros (panel reactivo)",
    description: "Estadísticas sobre el subconjunto del padrón que matchea los filtros recibidos: total, promedio, mediana, percentiles (p25/p75), min/max de sueldo bruto, promedio de neto y edad, desglose por género con brecha %, y distribución por rangos de sueldo (`0-5K`, `5K-10K`, ..., `120K+`). Es el endpoint que alimenta el panel de filtros reactivo del laboratorio público. Cache HTTP `public, max-age=300`.",
    request: { query: FiltrosQuery },
    responses: { ...ok("Stats agregadas del subconjunto filtrado.", ServidorStats), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const f = leerFiltros((k) => c.req.query(k));
    const { where, params } = predicados(f);
    const FROM = `FROM nombramientos n JOIN personas p ON n.persona_id = p.id LEFT JOIN cat_sexos csex ON p.sexo_id = csex.id LEFT JOIN cat_puestos cp ON n.puesto_id = cp.id`;
    const r = (await fila<Record<string, number | null>>(c.env.DB_CDMX, `
SELECT COUNT(*) AS total, AVG(n.sueldo_bruto) AS sueldo_bruto_avg, MIN(n.sueldo_bruto) AS sueldo_bruto_min, MAX(n.sueldo_bruto) AS sueldo_bruto_max,
       AVG(n.sueldo_neto) AS sueldo_neto_avg, AVG(p.edad) AS edad_avg,
       COUNT(CASE WHEN csex.nombre = 'MASCULINO' THEN 1 END) AS count_hombres, COUNT(CASE WHEN csex.nombre = 'FEMENINO' THEN 1 END) AS count_mujeres,
       AVG(CASE WHEN csex.nombre = 'MASCULINO' THEN n.sueldo_bruto END) AS avg_m, AVG(CASE WHEN csex.nombre = 'FEMENINO' THEN n.sueldo_bruto END) AS avg_f
${FROM} WHERE ${where}`, params))!;
    // percentiles con la misma semántica que PERCENTILE_CONT (sobre sueldo_bruto no nulo del subconjunto)
    const sub = `(SELECT n.sueldo_bruto AS v ${FROM} WHERE ${where} AND n.sueldo_bruto IS NOT NULL)`;
    const [p50, p25, p75] = await percentilesSub(c, sub, params, [0.5, 0.25, 0.75]);
    const dist = await filas<{ rango: string; count: number }>(c.env.DB_CDMX, `
SELECT CASE WHEN n.sueldo_bruto < 5000 THEN '0-5K' WHEN n.sueldo_bruto < 10000 THEN '5K-10K' WHEN n.sueldo_bruto < 20000 THEN '10K-20K' WHEN n.sueldo_bruto < 30000 THEN '20K-30K'
            WHEN n.sueldo_bruto < 50000 THEN '30K-50K' WHEN n.sueldo_bruto < 80000 THEN '50K-80K' WHEN n.sueldo_bruto < 120000 THEN '80K-120K' ELSE '120K+' END AS rango, COUNT(*) AS count
${FROM} WHERE ${where} AND n.sueldo_bruto IS NOT NULL GROUP BY rango ORDER BY MIN(n.sueldo_bruto)`, params);
    const brecha = r.avg_f !== null && (r.avg_f as number) > 0 ? (((r.avg_m as number) - (r.avg_f as number)) / (r.avg_f as number)) * 100 : null;
    return {
      total: r.total as number, sueldo_bruto_avg: r.sueldo_bruto_avg, sueldo_bruto_median: p50, sueldo_bruto_p25: p25, sueldo_bruto_p75: p75,
      sueldo_bruto_min: r.sueldo_bruto_min, sueldo_bruto_max: r.sueldo_bruto_max, sueldo_neto_avg: r.sueldo_neto_avg, edad_avg: r.edad_avg,
      count_hombres: r.count_hombres as number, count_mujeres: r.count_mujeres as number, brecha_genero_pct: brecha, distribucion_sueldo: dist,
    };
  }
}
async function percentilesSub(c: AppContext, sub: string, params: unknown[], ps: number[]): Promise<(number | null)[]> {
  const n = (await fila<{ n: number }>(c.env.DB_CDMX, `SELECT COUNT(*) AS n FROM ${sub}`, params))!.n;
  if (n === 0) return ps.map(() => null);
  const out: (number | null)[] = [];
  for (const p of ps) {
    const pos = (n - 1) * p, lo = Math.floor(pos);
    const v = (await filas<{ v: number }>(c.env.DB_CDMX, `SELECT v FROM ${sub} ORDER BY v LIMIT 2 OFFSET ${lo}`, params)).map((x) => Number(x.v));
    out.push(v.length === 1 || pos === lo ? v[0] : v[0] + (v[1] - v[0]) * (pos - lo));
  }
  return out;
}
export { percentilCont };

// ---------------------------------------------------------------- 1.3 detalle
const ServidorDetail = z.object({ id: z.number().int(), nombre: z.string(), apellido_1: z.string(), apellido_2: z.string().nullable(), sexo: z.string(), edad: z.number().int().nullable(), sueldo_bruto: z.string().nullable(), sueldo_neto: z.string().nullable(), fecha_ingreso: z.string().nullable(), id_nivel_salarial: z.number().int().nullable(), sector: z.string().nullable(), puesto: z.string().nullable(), tipo_contratacion: z.string().nullable(), tipo_personal: z.string().nullable(), tipo_nomina: z.string().nullable(), universo: z.string().nullable() });
export const SELECT_DETALLE = `
SELECT p.id, p.nombre, p.apellido_1, p.apellido_2, csex.nombre AS sexo, p.edad, n.sueldo_bruto, n.sueldo_neto, n.fecha_ingreso, cns.clave AS id_nivel_salarial, cs.nombre AS sector, cp.nombre AS puesto, ctc.nombre AS tipo_contratacion, ctp.nombre AS tipo_personal, CAST(ctn.clave AS TEXT) AS tipo_nomina, cu.nombre AS universo
FROM personas p JOIN nombramientos n ON n.persona_id = p.id LEFT OUTER JOIN cat_sexos csex ON p.sexo_id = csex.id LEFT OUTER JOIN cat_sectores cs ON n.sector_id = cs.id LEFT OUTER JOIN cat_puestos cp ON n.puesto_id = cp.id LEFT OUTER JOIN cat_tipos_contratacion ctc ON n.tipo_contratacion_id = ctc.id LEFT OUTER JOIN cat_tipos_personal ctp ON n.tipo_personal_id = ctp.id LEFT OUTER JOIN cat_tipos_nomina ctn ON n.tipo_nomina_id = ctn.id LEFT OUTER JOIN cat_universos cu ON n.universo_id = cu.id LEFT OUTER JOIN cat_niveles_salariales cns ON n.nivel_salarial_id = cns.id`;
export class ServidorDetalle extends OpenAPIRoute {
  schema = {
    tags: ["servidores"], operationId: "get_servidor_api_v1_servidores__servidor_id__get", summary: "Detalle de un servidor por ID",
    description: "Detalle completo de un servidor (persona) por su ID numérico: datos personales, sueldo bruto/neto, fecha de ingreso, nivel salarial, sector, puesto, tipos de contratación/personal/nómina y universo. Cache HTTP `public, max-age=300`.",
    request: { params: z.object({ servidor_id: z.number().int() }) },
    responses: { ...ok("Detalle del servidor.", ServidorDetail), "404": { description: "`servidor_id` no existe en `cdmx.personas`.", ...contentJson(z.object({ detail: z.string() })) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const id = enteroRuta(c.req.param("servidor_id") ?? "", "servidor_id");
    const rows = await filas<Record<string, unknown>>(c.env.DB_CDMX, `${SELECT_DETALLE} WHERE p.id = ?1`, [id]);
    if (rows.length === 0) throw new ErrorHttp(404, "Servidor no encontrado");
    if (rows.length > 1) throw new ErrorHttp(500, "Internal Server Error");
    const r = rows[0];
    return { ...r, sueldo_bruto: dec2(r.sueldo_bruto as number | null), sueldo_neto: dec2(r.sueldo_neto as number | null) };
  }
}

// ---------------------------------------------------------------- 8.1 export CSV
const COLUMNAS_CSV = ["id", "nombre", "apellido_1", "apellido_2", "sexo", "edad", "sueldo_bruto", "sueldo_neto", "fecha_ingreso", "sector", "puesto", "tipo_contratacion", "tipo_personal", "tipo_nomina", "universo"];
function campoCsv(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export class ExportCsv extends OpenAPIRoute {
  schema = {
    tags: ["export"], operationId: "export_csv_api_v1_export_csv_get", summary: "Exportar nombramientos CDMX en CSV (≤ 50 000 filas)",
    description: "Exporta hasta 50 000 filas del padrón CDMX en formato CSV (`text/csv`, `Content-Disposition: attachment`) con los mismos filtros que `GET /api/v1/servidores/`. Columnas: `id`, `nombre`, `apellido_1`, `apellido_2`, `sexo`, `edad`, `sueldo_bruto`, `sueldo_neto`, `fecha_ingreso`, `sector`, `puesto`, `tipo_contratacion`, `tipo_personal`, `tipo_nomina`, `universo`. Para exports más grandes consumir paginado vía `/api/v1/servidores/`. Rate limit estricto (5/min/IP) — endpoint diseñado para descarga puntual, no para bulk extraction continua.",
    request: { query: FiltrosQuery },
    responses: { "200": { description: "Stream CSV con headers de descarga.", content: { "text/csv": { schema: z.string() } } }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const f = leerFiltros((k) => c.req.query(k));
    const { where, params } = predicados(f);
    const rows = await filas<Record<string, unknown>>(c.env.DB_CDMX, `${SELECT_DETALLE} WHERE ${where} ${ordenSql(f)} LIMIT 50000`, params);
    let cuerpo = COLUMNAS_CSV.join(",") + "\r\n";
    for (const r of rows) {
      const fila_ = { ...r, sueldo_bruto: dec2(r.sueldo_bruto as number | null), sueldo_neto: dec2(r.sueldo_neto as number | null) } as Record<string, unknown>;
      cuerpo += COLUMNAS_CSV.map((col) => campoCsv(fila_[col])).join(",") + "\r\n";
    }
    return new Response(cuerpo, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=remuneraciones_cdmx.csv" } });
  }
}

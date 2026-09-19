// Sectores (lista, comparación, detalle) y los ocho catálogos con conteo.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { ErrorHttp } from "../lib/errores";
import { enteroOpcional } from "../lib/validacion";
import type { Detalle } from "../lib/validacion";
import { enteroConDefault, enteroRuta, paginado, paginas } from "./comun";

const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const r429 = (n: number) => ({ "429": { description: `Rate limit excedido (${n} req/min por IP).`, ...contentJson(z.object({ detail: z.string() })) } });
const E404 = z.object({ detail: z.string() });

// ---------------------------------------------------------------- 2.1 sectores lista
const SectorWithStats = z.object({ id: z.number().int(), nombre: z.string(), total_servidores: z.number().int(), sueldo_bruto_avg: z.number().nullable(), count_hombres: z.number().int(), count_mujeres: z.number().int() });
export class SectoresLista extends OpenAPIRoute {
  schema = {
    tags: ["sectores"], operationId: "list_sectores_api_v1_sectores__get", summary: "Listar los 73 sectores del padrón CDMX con estadísticas",
    description: "Devuelve los 73 sectores con conteo de nombramientos, sueldo bruto promedio, y desglose hombres/mujeres por sector. Ordenado alfabéticamente. Cache HTTP `public, max-age=3600`.",
    responses: { ...ok("Lista de sectores con stats agregadas.", z.array(SectorWithStats)), ...r429(30) },
  };
  async handle(c: AppContext) {
    return filas(c.env.DB_CDMX, `
SELECT cs.id, cs.nombre, COUNT(n.id) AS total_servidores, AVG(n.sueldo_bruto) AS sueldo_bruto_avg,
       COUNT(CASE WHEN csex.nombre = 'MASCULINO' THEN 1 END) AS count_hombres, COUNT(CASE WHEN csex.nombre = 'FEMENINO' THEN 1 END) AS count_mujeres
FROM cat_sectores cs LEFT JOIN nombramientos n ON n.sector_id = cs.id LEFT JOIN personas p ON n.persona_id = p.id LEFT JOIN cat_sexos csex ON p.sexo_id = csex.id
GROUP BY cs.id, cs.nombre ORDER BY cs.nombre`);
  }
}

// ---------------------------------------------------------------- 2.2 helper detalle
const TopPuesto = z.object({ puesto: z.string(), count: z.number().int(), sueldo_avg: z.number().nullable() });
const SectorDetailStats = z.object({ id: z.number().int(), nombre: z.string(), total_servidores: z.number().int(), sueldo_bruto_avg: z.number().nullable(), sueldo_bruto_median: z.number().nullable(), sueldo_neto_avg: z.number().nullable(), edad_avg: z.number().nullable(), count_hombres: z.number().int(), count_mujeres: z.number().int(), brecha_genero_pct: z.number().nullable(), top_puestos: z.array(TopPuesto) });
async function detalleSector(c: AppContext, sector_id: number) {
  const r = await fila<Record<string, number | string | null>>(c.env.DB_CDMX, `
SELECT cs.id, cs.nombre, COUNT(n.id) AS total_servidores, AVG(n.sueldo_bruto) AS sueldo_bruto_avg, AVG(n.sueldo_neto) AS sueldo_neto_avg, AVG(p.edad) AS edad_avg,
       COUNT(CASE WHEN csex.nombre = 'MASCULINO' THEN 1 END) AS count_hombres, COUNT(CASE WHEN csex.nombre = 'FEMENINO' THEN 1 END) AS count_mujeres,
       AVG(CASE WHEN csex.nombre = 'MASCULINO' THEN n.sueldo_bruto END) AS avg_m, AVG(CASE WHEN csex.nombre = 'FEMENINO' THEN n.sueldo_bruto END) AS avg_f
FROM cat_sectores cs LEFT JOIN nombramientos n ON n.sector_id = cs.id LEFT JOIN personas p ON n.persona_id = p.id LEFT JOIN cat_sexos csex ON p.sexo_id = csex.id
WHERE cs.id = ?1 GROUP BY cs.id, cs.nombre`, [sector_id]);
  if (!r) throw new ErrorHttp(404, "Sector no encontrado");
  const nv = (await fila<{ n: number }>(c.env.DB_CDMX, "SELECT COUNT(*) AS n FROM nombramientos WHERE sector_id = ?1 AND sueldo_bruto IS NOT NULL", [sector_id]))!.n;
  let median: number | null = null;
  if (nv > 0) {
    const pos = (nv - 1) * 0.5, lo = Math.floor(pos);
    const v = (await filas<{ v: number }>(c.env.DB_CDMX, `SELECT sueldo_bruto AS v FROM nombramientos WHERE sector_id = ?1 AND sueldo_bruto IS NOT NULL ORDER BY sueldo_bruto LIMIT 2 OFFSET ${lo}`, [sector_id])).map((x) => Number(x.v));
    median = v.length === 1 || pos === lo ? v[0] : v[0] + (v[1] - v[0]) * (pos - lo);
  }
  const top = await filas<z.infer<typeof TopPuesto>>(c.env.DB_CDMX, `SELECT cp.nombre AS puesto, COUNT(*) AS count, AVG(n.sueldo_bruto) AS sueldo_avg FROM nombramientos n JOIN cat_puestos cp ON n.puesto_id = cp.id WHERE n.sector_id = ?1 GROUP BY cp.nombre ORDER BY count DESC, cp.nombre LIMIT 10`, [sector_id]);
  const avg_f = r.avg_f as number | null, avg_m = r.avg_m as number | null;
  return {
    id: r.id, nombre: r.nombre, total_servidores: r.total_servidores, sueldo_bruto_avg: r.sueldo_bruto_avg, sueldo_bruto_median: median, sueldo_neto_avg: r.sueldo_neto_avg, edad_avg: r.edad_avg,
    count_hombres: r.count_hombres, count_mujeres: r.count_mujeres, brecha_genero_pct: avg_f !== null && avg_f > 0 ? (((avg_m as number) - avg_f) / avg_f) * 100 : null, top_puestos: top,
  };
}

// ---------------------------------------------------------------- 2.3 compare
export class SectoresCompare extends OpenAPIRoute {
  schema = {
    tags: ["sectores"], operationId: "compare_sectores_api_v1_sectores_compare_get", summary: "Comparar dos sectores lado a lado",
    description: "Devuelve el detalle estadístico completo (sueldo promedio, mediana, percentiles, top 10 puestos, brecha de género) para dos sectores identificados por su `id`. Útil para visualizaciones comparativas. Si cualquiera de los dos sectores no existe, devuelve `404` (el primer raise gana — `a` antes que `b`). Cache HTTP `public, max-age=3600`.",
    request: { query: z.object({ a: z.number().int().describe("ID del sector A"), b: z.number().int().describe("ID del sector B") }) },
    responses: { ...ok("Comparación lado a lado de dos sectores.", z.object({ sector_a: SectorDetailStats, sector_b: SectorDetailStats })), "404": { description: "Uno o ambos `sector_id` no existen en `cdmx.cat_sectores`.", ...contentJson(E404) }, ...r429(15) },
  };
  async handle(c: AppContext) {
    const faltan: Detalle[] = [];
    for (const k of ["a", "b"]) if (c.req.query(k) === undefined) faltan.push({ type: "missing", loc: ["query", k], msg: "Field required", input: null });
    if (faltan.length) throw new ErrorHttp(422, faltan);
    const a = enteroOpcional(c.req.query("a"), "a")!, b = enteroOpcional(c.req.query("b"), "b")!;
    return { sector_a: await detalleSector(c, a), sector_b: await detalleSector(c, b) };
  }
}

// ---------------------------------------------------------------- 2.4 stats
export class SectorStats extends OpenAPIRoute {
  schema = {
    tags: ["sectores"], operationId: "sector_stats_api_v1_sectores__sector_id__stats_get", summary: "Detalle estadístico de un sector",
    description: "Detalle completo de un sector identificado por `sector_id`: totales, promedio y mediana de sueldo bruto, percentiles, promedio de edad, desglose por género (con brecha %), y top 10 puestos del sector con su sueldo promedio. Cache HTTP `public, max-age=3600`.",
    request: { params: z.object({ sector_id: z.number().int() }) },
    responses: { ...ok("Detalle completo del sector.", SectorDetailStats), "404": { description: "`sector_id` no existe en `cdmx.cat_sectores`.", ...contentJson(E404) }, ...r429(30) },
  };
  async handle(c: AppContext) {
    return detalleSector(c, enteroRuta(c.req.param("sector_id") ?? "", "sector_id"));
  }
}

// ---------------------------------------------------------------- 3. catálogos
const CatalogItemWithCount = z.object({ id: z.number().int(), nombre: z.string(), count: z.number().int() });
const RESP_CAT = { ...ok("Lista del catálogo con conteo de uso.", z.array(CatalogItemWithCount)), ...r429(60) };
function catalogo(nombreClase: string, operationId: string, summary: string, description: string, sql: string) {
  return class extends OpenAPIRoute {
    schema = { tags: ["catalogos"], operationId, summary, description, responses: RESP_CAT };
    async handle(c: AppContext) { return filas(c.env.DB_CDMX, sql); }
    static nombre = nombreClase;
  };
}
const catNombre = (t: string, fk: string) => `SELECT ${t}.id, ${t}.nombre, count(nombramientos.id) AS count FROM ${t} LEFT OUTER JOIN nombramientos ON nombramientos.${fk} = ${t}.id GROUP BY ${t}.id, ${t}.nombre ORDER BY ${t}.nombre`;
const catClave = (t: string, fk: string) => `SELECT ${t}.id, CAST(${t}.clave AS TEXT) AS nombre, count(nombramientos.id) AS count FROM ${t} LEFT OUTER JOIN nombramientos ON nombramientos.${fk} = ${t}.id GROUP BY ${t}.id, ${t}.clave ORDER BY ${t}.clave`;
export const CatTiposContratacion = catalogo("CatTiposContratacion", "tipos_contratacion_api_v1_catalogos_tipos_contratacion_get", "Catálogo de tipos de contratación con conteo de uso", "Devuelve los tipos de contratación del padrón CDMX (Base, Honorarios, Eventual, etc.) con el conteo de nombramientos que referencian cada uno. Cache HTTP `public, max-age=3600`.", catNombre("cat_tipos_contratacion", "tipo_contratacion_id"));
export const CatTiposPersonal = catalogo("CatTiposPersonal", "tipos_personal_api_v1_catalogos_tipos_personal_get", "Catálogo de tipos de personal con conteo de uso", "Devuelve los tipos de personal (Operativo, Mando, etc.) con conteo de nombramientos por tipo. Cache HTTP `public, max-age=3600`.", catNombre("cat_tipos_personal", "tipo_personal_id"));
export const CatTiposNomina = catalogo("CatTiposNomina", "tipos_nomina_api_v1_catalogos_tipos_nomina_get", "Catálogo de tipos de nómina con conteo de uso", "Devuelve los tipos de nómina identificados por la columna `clave` (integer, NO `nombre` como los otros catálogos) con conteo de uso. Cache HTTP `public, max-age=3600`.", catClave("cat_tipos_nomina", "tipo_nomina_id"));
export const CatUniversos = catalogo("CatUniversos", "universos_api_v1_catalogos_universos_get", "Catálogo de universos con conteo de uso", "Devuelve los universos del padrón CDMX (agrupaciones administrativas) con conteo de nombramientos por universo. Cache HTTP `public, max-age=3600`.", catNombre("cat_universos", "universo_id"));
export const CatSectores = catalogo("CatSectores", "sectores_api_v1_catalogos_sectores_get", "Catálogo de los 73 sectores con conteo de uso", "Devuelve los 73 sectores del padrón CDMX con conteo de nombramientos por sector, ordenados alfabéticamente. Cache HTTP `public, max-age=3600`.", catNombre("cat_sectores", "sector_id"));
export const CatSexos = catalogo("CatSexos", "sexos_api_v1_catalogos_sexos_get", "Catálogo de sexos con conteo de uso", "Devuelve el catálogo `cat_sexos` (MASCULINO, FEMENINO, no especificado) con conteo de personas por valor. Cache HTTP `public, max-age=3600`.", `SELECT cat_sexos.id, cat_sexos.nombre, count(personas.id) AS count FROM cat_sexos LEFT OUTER JOIN personas ON personas.sexo_id = cat_sexos.id GROUP BY cat_sexos.id, cat_sexos.nombre ORDER BY cat_sexos.nombre`);
export const CatNivelesSalariales = catalogo("CatNivelesSalariales", "niveles_salariales_api_v1_catalogos_niveles_salariales_get", "Catálogo de niveles salariales con conteo de uso", "Devuelve los niveles salariales identificados por `clave` con conteo de nombramientos por nivel. Cache HTTP `public, max-age=3600`.", catClave("cat_niveles_salariales", "nivel_salarial_id"));

const PuestoWithCount = z.object({ id: z.number().int(), nombre: z.string(), count: z.number().int() });
export class CatPuestos extends OpenAPIRoute {
  schema = {
    tags: ["catalogos"], operationId: "puestos_api_v1_catalogos_puestos_get", summary: "Catálogo paginado de puestos con búsqueda",
    description: "Devuelve los 1 772 puestos del padrón CDMX paginados, con conteo de nombramientos por puesto. Soporta búsqueda ILIKE vía `search`. Ordenado por conteo descendente. Cache HTTP `public, max-age=3600`.",
    request: { query: z.object({ search: z.string().optional(), page: z.number().int().min(1).default(1), per_page: z.number().int().min(1).max(200).default(50) }) },
    responses: { ...ok("Página del catálogo de puestos.", paginado(PuestoWithCount)), ...r429(60) },
  };
  async handle(c: AppContext) {
    const search = c.req.query("search");
    const page = enteroConDefault(c.req.query("page"), "page", 1, 1), per_page = enteroConDefault(c.req.query("per_page"), "per_page", 50, 1, 200);
    const where = search ? "WHERE lower(cat_puestos.nombre) LIKE lower(?1)" : "";
    const params = search ? [`%${search}%`] : [];
    const total = (await fila<{ n: number }>(c.env.DB_CDMX, `SELECT count(*) AS n FROM (SELECT cat_puestos.id AS id FROM cat_puestos ${where}) AS anon_1`, params))!.n;
    const data = await filas(c.env.DB_CDMX, `SELECT cat_puestos.id, cat_puestos.nombre, count(nombramientos.id) AS count FROM cat_puestos LEFT OUTER JOIN nombramientos ON nombramientos.puesto_id = cat_puestos.id ${where} GROUP BY cat_puestos.id, cat_puestos.nombre ORDER BY count(nombramientos.id) DESC, cat_puestos.id LIMIT ${per_page} OFFSET ${(page - 1) * per_page}`, params);
    return { data, total, page, per_page, pages: Math.floor((total + per_page - 1) / per_page) };
  }
}

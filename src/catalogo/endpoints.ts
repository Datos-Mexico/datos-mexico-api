import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { ErrorHttp } from "../lib/errores";
import { RESP_429 } from "../lib/comun";
import { DATASETS } from "./datasets";
import type { DatasetDef } from "./datasets";

const TAG = ["catalogo"];
const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
type TablaInfo = { nombre: string; filas: number; columnas: number };
type Columna = { nombre: string; tipo: string; nulo: boolean; llave_primaria: boolean };

// Conteos por base, cacheados 10 minutos por isolate (COUNT(*) sobre millones de filas cuesta).
const cache = new Map<string, { hasta: number; valor: unknown }>();
async function memo<T>(clave: string, f: () => Promise<T>): Promise<T> {
  const c = cache.get(clave); const ahora = Date.now();
  if (c && c.hasta > ahora) return c.valor as T;
  const v = await f(); cache.set(clave, { hasta: ahora + 10 * 60 * 1000, valor: v }); return v;
}
async function tablasDe(env: AppContext["env"], d: DatasetDef): Promise<TablaInfo[]> {
  const db = env[d.binding] as D1Database;
  return memo(`tablas:${d.clave}`, async () => {
    const nombres = (await filas<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_cf%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((r) => r.name).filter((n) => !d.tablas_excluidas || !d.tablas_excluidas.test(n));
    const out: TablaInfo[] = [];
    for (const n of nombres) {
      const cnt = (await fila<{ n: number }>(db, `SELECT count(*) AS n FROM "${n}"`))!.n;
      const cols = await filas<{ name: string }>(db, `PRAGMA table_info("${n}")`);
      out.push({ nombre: n, filas: cnt, columnas: cols.length });
    }
    return out;
  });
}
async function corteDe(env: AppContext["env"], d: DatasetDef): Promise<string | null> {
  if (!d.sql_corte) return null;
  const r = await fila<{ corte: string | null }>(env[d.binding] as D1Database, d.sql_corte);
  return r?.corte ?? null;
}

const Tabla = z.object({ nombre: z.string(), filas: z.number().int(), columnas: z.number().int() });
const Dataset = z.object({ clave: z.string(), nombre: z.string(), fuente: z.string(), fuente_url: z.string(), licencia: z.string(), descripcion: z.string(), periodicidad: z.string(), corte: z.string().nullable(), unidad_corte: z.string(), prefijo_api: z.string(), n_tablas: z.number().int(), n_filas: z.number().int(), tablas: z.array(Tabla), notas: z.array(z.string()), esquema_url: z.string() });

export class CatalogoDatasets extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "catalogo_datasets", summary: "Qué datos tenemos y hasta cuándo",
    description: "Catálogo vivo de las bases de datos del observatorio: fuente, licencia, periodicidad, corte más reciente contenido, tablas con su número de filas y columnas, y el prefijo de la API donde se consultan. Las cifras se leen de las bases en el momento (con caché de 10 minutos). Lo que no aparece aquí, no lo tenemos.",
    responses: { ...ok("Catálogo de bases de datos.", z.object({ generado: z.string(), n_datasets: z.number().int(), datasets: z.array(Dataset) })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const datasets = [];
    for (const d of DATASETS) {
      const tablas = await tablasDe(c.env, d);
      datasets.push({ clave: d.clave, nombre: d.nombre, fuente: d.fuente, fuente_url: d.fuente_url, licencia: d.licencia, descripcion: d.descripcion, periodicidad: d.periodicidad, corte: await corteDe(c.env, d), unidad_corte: d.unidad_corte, prefijo_api: d.prefijo_api, n_tablas: tablas.length, n_filas: tablas.reduce((s, t) => s + t.filas, 0), tablas, notas: d.notas, esquema_url: `/api/v1/catalogo/datasets/${d.clave}/esquema` });
    }
    return { generado: new Date().toISOString(), n_datasets: datasets.length, datasets };
  }
}

const ColumnaZ = z.object({ nombre: z.string(), tipo: z.string(), nulo: z.boolean(), llave_primaria: z.boolean() });
const Relacion = z.object({ desde_tabla: z.string(), desde_columna: z.string(), hacia_tabla: z.string(), hacia_columna: z.string() });
const TablaEsquema = z.object({ nombre: z.string(), filas: z.number().int(), columnas: z.array(ColumnaZ), llave_primaria: z.array(z.string()) });
export class CatalogoEsquema extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "catalogo_esquema", summary: "Esquema de una base: tablas, columnas y relaciones",
    description: "Esquema legible por máquina de una base del observatorio: cada tabla con sus columnas (tipo, nulabilidad, llave primaria) y las relaciones (llaves foráneas) entre tablas. Es la fuente para dibujar el diagrama de relaciones.",
    request: { params: z.object({ dataset: z.string() }) },
    responses: { ...ok("Esquema de la base.", z.object({ clave: z.string(), nombre: z.string(), n_tablas: z.number().int(), tablas: z.array(TablaEsquema), relaciones: z.array(Relacion) })), "404": { description: "Base inexistente.", ...contentJson(z.object({ detail: z.string() })) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const clave = c.req.param("dataset") ?? "";
    const d = DATASETS.find((x) => x.clave === clave);
    if (!d) throw new ErrorHttp(404, `dataset '${clave}' no existe. Válidos: ${DATASETS.map((x) => x.clave).join(", ")}`);
    const db = c.env[d.binding] as D1Database;
    const tablas = await tablasDe(c.env, d);
    const out = []; const relaciones = [];
    for (const t of tablas) {
      const cols = await filas<{ name: string; type: string; notnull: number; pk: number }>(db, `PRAGMA table_info("${t.nombre}")`);
      const fks = await filas<{ table: string; from: string; to: string }>(db, `PRAGMA foreign_key_list("${t.nombre}")`);
      out.push({ nombre: t.nombre, filas: t.filas, columnas: cols.map((x) => ({ nombre: x.name, tipo: x.type, nulo: !x.notnull, llave_primaria: x.pk > 0 })), llave_primaria: cols.filter((x) => x.pk > 0).sort((a, b) => a.pk - b.pk).map((x) => x.name) });
      for (const f of fks) relaciones.push({ desde_tabla: t.nombre, desde_columna: f.from, hacia_tabla: f.table, hacia_columna: f.to });
    }
    return { clave: d.clave, nombre: d.nombre, n_tablas: out.length, tablas: out, relaciones };
  }
}

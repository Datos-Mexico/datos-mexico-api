// Marco Geoestadístico 2025 íntegro (scripts/mg_2025.py): las 16 capas SHAPE de las 32 entidades convertidas a un Parquet
// nacional por capa (atributos + geometría WKB, CRS original), los zips originales del INEGI y sus catálogos, en R2; el
// catálogo de capas con conteos por entidad en D1, verificado contra los totales nacionales que el INEGI declara en el producto.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { memo } from "../cubos/motor";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";

const TAG = ["inegi"];
const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const RESP_404 = { "404": { description: "No existe.", ...contentJson(z.object({ detail: z.string() })) } };
const Capa = z.object({ edicion: z.string(), capa: z.string(), nombre: z.string(), descripcion: z.string(), geometria: z.string(), crs: z.string(), campos: z.array(z.string()), entidades: z.number().int(), objetos: z.number().int(), publicado: z.number().int().nullable(), bytes_parquet: z.number().int(), parquet_url: z.string() });
const Resumen = z.object({ fuente: z.string(), fuente_url: z.string(), edicion: z.string(), titulo: z.string(), corte: z.string(), zip_nacional_url: z.string(), bytes_zip: z.number().int(), verificacion: z.record(z.string(), z.object({ obtenido: z.number().int(), publicado: z.number().int() })), capas: z.array(Capa), estados_url: z.string() });

function capas(c: AppContext, ed: string) {
  const base = new URL(c.req.url).origin;
  type Fila = { edicion: string; capa: string; nombre: string; descripcion: string; geometria: string; crs: string; campos: string; entidades: number; objetos: number; publicado: number | null; clave_parquet: string; bytes_parquet: number };
  return memo(`mg:capas:${ed}`, 60, async () => (await filas<Fila>(c.env.DB_CENSO2020, "SELECT * FROM mg_capas WHERE edicion = ? ORDER BY capa", [ed])).map((r) => ({ ...r, campos: JSON.parse(r.campos) as string[], parquet_url: `${base}/api/v1/inegi/mg/descarga/${r.capa}` })));
}
export class MgResumen extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_mg_resumen", summary: "Marco Geoestadístico 2025 completo: capas, conteos y verificación",
    description: "El Marco Geoestadístico 2025 del INEGI (versión por área geoestadística estatal, corte julio 2025) íntegro: entidades, municipios, localidades amanzanadas y rurales puntuales, AGEB urbanas y rurales, manzanas, caserío disperso, territorio insular, polígonos externos, ejes de vialidad, frentes de manzana y servicios (área, línea, punto). Cada capa se descarga como Parquet nacional (atributos + geometría WKB en el CRS original, ITRF2008 / Cónica Conforme de Lambert) y cada estado como el zip original del INEGI. `verificacion` compara los objetos obtenidos con los totales nacionales que el INEGI declara en el producto (contenido.txt).",
    responses: { ...ok("Resumen.", Resumen), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const ed = (await fila<Record<string, unknown>>(c.env.DB_CENSO2020, "SELECT * FROM mg_ediciones ORDER BY edicion DESC LIMIT 1"))!; const base = new URL(c.req.url).origin;
    return { fuente: "INEGI — Marco Geoestadístico 2025", fuente_url: ed.fuente_url, edicion: ed.edicion, titulo: ed.titulo, corte: ed.corte, zip_nacional_url: `${base}/api/v1/inegi/mg/descarga/nacional`, bytes_zip: ed.bytes_zip, verificacion: JSON.parse(String(ed.verificacion)), capas: await capas(c, String(ed.edicion)), estados_url: `${base}/api/v1/inegi/mg/estados` };
  }
}
export class MgCapa extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "inegi_mg_capa", summary: "Una capa del Marco Geoestadístico con sus objetos por entidad",
    request: { params: z.object({ capa: z.string() }) },
    responses: { ...ok("Capa.", Capa.extend({ por_entidad: z.array(z.object({ cve_ent: z.string(), objetos: z.number().int() })) })), ...RESP_404, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const capa = c.req.param("capa") ?? ""; const x = (await capas(c, "2025")).find((k) => k.capa === capa);
    if (!x) throw new ErrorHttp(404, `capa '${capa}' no existe; ver /api/v1/inegi/mg`);
    return { ...x, por_entidad: await filas(c.env.DB_CENSO2020, "SELECT cve_ent, objetos FROM mg_conteos WHERE edicion = '2025' AND capa = ? ORDER BY cve_ent", [capa]) };
  }
}
export class MgEstados extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "inegi_mg_estados", summary: "Los 32 zips estatales originales del Marco Geoestadístico 2025", responses: { ...ok("Estados.", z.object({ n: z.number().int(), items: z.array(z.object({ cve_ent: z.string(), archivo: z.string(), bytes: z.number().int(), url: z.string() })) })), ...RESP_429 } };
  async handle(c: AppContext) {
    const base = new URL(c.req.url).origin;
    const objs = await memo("mg:estados", 60, async () => (await c.env.DATOS.list({ prefix: "inegi/fuentes/marco-geoestadistico/2025/estados/" })).objects.map((o) => ({ cve_ent: o.key.split("/").pop()!.slice(0, 2), archivo: o.key.split("/").pop()!, bytes: o.size })));
    return { n: objs.length, items: objs.map((o) => ({ ...o, url: `${base}/api/v1/inegi/mg/descarga/estado/${o.cve_ent}` })) };
  }
}
async function servir(c: AppContext, clave: string, nombre: string, tipo: string) {
  const obj = await c.env.DATOS.get(clave);
  if (!obj) throw new ErrorHttp(404, "el archivo no está en el almacén");
  return new Response(obj.body, { headers: { "content-type": tipo, "content-length": String(obj.size), "content-disposition": `attachment; filename="${nombre}"`, "cache-control": "public, max-age=86400" } });
}
export class MgDescargaCapa extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "inegi_mg_descarga_capa", summary: "Descargar una capa nacional del Marco Geoestadístico en Parquet (geometría WKB)", request: { params: z.object({ capa: z.string() }) }, responses: { "200": { description: "Parquet." }, ...RESP_404, ...RESP_429 } };
  async handle(c: AppContext) {
    const capa = c.req.param("capa") ?? ""; const x = await fila<{ clave_parquet: string }>(c.env.DB_CENSO2020, "SELECT clave_parquet FROM mg_capas WHERE edicion = '2025' AND capa = ?", [capa]);
    if (!x) throw new ErrorHttp(404, `capa '${capa}' no existe`);
    return servir(c, x.clave_parquet, `mg_2025_${capa}.parquet`, "application/vnd.apache.parquet");
  }
}
export class MgDescargaEstado extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "inegi_mg_descarga_estado", summary: "Descargar el zip original del INEGI de una entidad (16 capas SHAPE, catálogos y metadatos)", request: { params: z.object({ cve_ent: z.string().regex(/^\d{2}$/) }) }, responses: { "200": { description: "Zip." }, ...RESP_404, ...RESP_429 } };
  async handle(c: AppContext) {
    const ent = c.req.param("cve_ent") ?? ""; const l = await c.env.DATOS.list({ prefix: `inegi/fuentes/marco-geoestadistico/2025/estados/${ent}_` });
    if (!l.objects.length) throw new ErrorHttp(404, `entidad '${ent}' no existe`);
    return servir(c, l.objects[0].key, l.objects[0].key.split("/").pop()!, "application/zip");
  }
}
export class MgDescargaNacional extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "inegi_mg_descarga_nacional", summary: "Descargar el zip nacional íntegro del Marco Geoestadístico 2025 (2.9 GB, tal como lo publica el INEGI)", responses: { "200": { description: "Zip." }, ...RESP_404, ...RESP_429 } };
  async handle(c: AppContext) { return servir(c, "inegi/fuentes/marco-geoestadistico/2025/794551163061_s.zip", "794551163061_s.zip", "application/zip"); }
}

import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { filas } from "../lib/db";
import { RESP_429, bool } from "../lib/comun";
import { SOURCE_CONSAR } from "./constantes";

const AforeRow = z.object({
  id: z.number().int(),
  codigo: z.string(),
  nombre_corto: z.string(),
  nombre_csv: z.string(),
  tipo_pension: z.string(),
  fecha_alta_serie: z.string(),
  activa: z.boolean(),
  orden_display: z.number().int(),
});
const AforesResponse = z.object({ count: z.number().int(), afores: z.array(AforeRow), source: z.string() });

export const SQL_AFORES = `
SELECT id, codigo, nombre_corto, nombre_csv, tipo_pension,
       fecha_alta_serie, activa, orden_display
FROM afores
ORDER BY orden_display
`;

export class Afores extends OpenAPIRoute {
  schema = {
    tags: ["consar"],
    operationId: "get_afores_api_v1_consar_afores_get",
    summary: "Catálogo de las 11 AFOREs",
    description:
      "Lista todas las AFOREs del sistema mexicano de ahorro para el retiro, " +
      "ordenadas por tamaño (recursos registrados en SAR a 2025-06-01). " +
      "Incluye fecha_alta_serie (primer mes con datos no-nulos en el CSV oficial).",
    responses: { "200": { description: "Successful Response", ...contentJson(AforesResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const rows = await filas(c.env.DB_CONSAR, SQL_AFORES);
    const afores = rows.map((r) => ({ ...r, activa: bool(r.activa) }));
    return { count: afores.length, afores, source: SOURCE_CONSAR };
  }
}

const TipoRecursoRow = z.object({
  id: z.number().int(),
  codigo: z.string(),
  columna_csv: z.string(),
  nombre_corto: z.string(),
  nombre_oficial: z.string(),
  descripcion: z.string().nullable(),
  categoria: z.string(),
  es_total_sar: z.boolean(),
  orden_display: z.number().int(),
});
const TiposRecursoResponse = z.object({ count: z.number().int(), tipos_recurso: z.array(TipoRecursoRow) });

export const SQL_TIPOS_RECURSO = `
SELECT id, codigo, columna_csv, nombre_corto, nombre_oficial,
       descripcion, categoria, es_total_sar, orden_display
FROM tipos_recurso
ORDER BY orden_display
`;

export class TiposRecurso extends OpenAPIRoute {
  schema = {
    tags: ["consar"],
    operationId: "get_tipos_recurso_api_v1_consar_tipos_recurso_get",
    summary: "Catálogo de los 15 conceptos de recurso",
    description:
      "Lista los 15 tipos de recurso reportados mensualmente por CONSAR. " +
      "Categoría: component (atómico), aggregate (suma de components), " +
      "total (agregado AFORE/sistema), operativo (capital propio de la AFORE).",
    responses: { "200": { description: "Successful Response", ...contentJson(TiposRecursoResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const rows = await filas(c.env.DB_CONSAR, SQL_TIPOS_RECURSO);
    const tipos_recurso = rows.map((r) => ({ ...r, es_total_sar: bool(r.es_total_sar) }));
    return { count: tipos_recurso.length, tipos_recurso };
  }
}

// Comisiones, flujos, traspasos y PEA vs cotizantes (endpoints 9 a 15 del legacy).
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import { parseFecha } from "../lib/fechas";
import { redondear } from "../lib/numeros";
import {
  CAVEAT_COMISION_BIENESTAR, CAVEAT_COMISION_REFORMA, CAVEAT_FLUJO_BIENESTAR, CAVEAT_FLUJO_COBERTURA,
  CAVEAT_PEA_COBERTURA_INTERPRETACION, CAVEAT_PEA_FUENTES, CAVEAT_TRASPASO_BIENESTAR, CAVEAT_TRASPASO_IDENTIDAD, CAVEAT_TRASPASO_NULLS,
} from "./constantes";

const AforeRef = z.object({ codigo: z.string(), nombre_corto: z.string(), tipo_pension: z.string() });
const SerieRango = z.object({ desde: z.string(), hasta: z.string() });
const SQL_AFORE_META = `SELECT codigo, nombre_corto, tipo_pension FROM afores WHERE codigo = ?1`;
const UNIT_MM = "millones de pesos MXN corrientes";
const UNIT_COMISION = "porcentaje anual sobre saldo administrado";

type Ventana = { afore_codigo: string | null; d_desde: string; d_hasta: string; afore: z.infer<typeof AforeRef> | null };
async function ventana(c: AppContext, q: { afore_codigo?: string; desde?: string; hasta?: string }, desdeDefault: string): Promise<Ventana> {
  const afore_codigo = q.afore_codigo ?? null;
  const d_desde = q.desde !== undefined ? parseFecha(q.desde) : desdeDefault;
  const d_hasta = q.hasta !== undefined ? parseFecha(q.hasta) : "2025-06-01";
  if (d_desde > d_hasta) throw new ErrorHttp(422, "'desde' debe ser <= 'hasta'");
  let afore: z.infer<typeof AforeRef> | null = null;
  if (afore_codigo !== null) {
    afore = await fila<z.infer<typeof AforeRef>>(c.env.DB_CONSAR, SQL_AFORE_META, [afore_codigo]);
    if (!afore) throw new ErrorHttp(404, `afore '${afore_codigo}' no existe`);
  }
  return { afore_codigo, d_desde, d_hasta, afore };
}

// ---------------------------------------------------------------- 9. comisiones/serie
const ComisionPunto = z.object({ fecha: z.string(), comision_pct: z.number() });
const ComisionSerieResponse = z.object({ afore: AforeRef.nullable(), unit: z.string(), n_puntos: z.number().int(), rango: SerieRango, serie: z.array(ComisionPunto), caveats: z.array(z.string()) });
const SQL_COMISION_SERIE = `
SELECT c.fecha,
       c.comision AS comision_pct
FROM comisiones c
JOIN afores a ON a.id = c.afore_id
WHERE (?1 IS NULL OR a.codigo = ?1)
  AND c.fecha >= ?2
  AND c.fecha <= ?3
ORDER BY c.fecha, a.orden_display`;

export class ComisionesSerie extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_comisiones_serie_api_v1_consar_comisiones_serie_get",
    summary: "Serie temporal: comisión cobrada por AFORE (% anual sobre saldo)",
    description: "Retorna la serie mensual de comisiones cobradas por una AFORE específica (o todas si se omite `afore_codigo`). Comisión expresada como porcentaje anual sobre saldo administrado (e.g. 1.96 = 1.96%). Cobertura 2008-03-01 → 2025-06-01.",
    request: { query: z.object({
      afore_codigo: z.string().optional().describe("Código AFORE opcional (e.g. 'profuturo')"),
      desde: z.string().optional().describe("YYYY-MM o YYYY-MM-01 (default 2008-03)"),
      hasta: z.string().optional().describe("YYYY-MM o YYYY-MM-01 (default 2025-06)"),
    }) },
    responses: { "200": { description: "Successful Response", ...contentJson(ComisionSerieResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const v = await ventana(c, query, "2008-03-01");
    const rows = await filas<{ fecha: string; comision_pct: number }>(c.env.DB_CONSAR, SQL_COMISION_SERIE, [v.afore_codigo, v.d_desde, v.d_hasta]);
    return {
      afore: v.afore, unit: UNIT_COMISION, n_puntos: rows.length, rango: { desde: v.d_desde, hasta: v.d_hasta },
      serie: rows.map((r) => ({ fecha: r.fecha, comision_pct: redondear(r.comision_pct, 4) })),
      caveats: [CAVEAT_COMISION_REFORMA, CAVEAT_COMISION_BIENESTAR],
    };
  }
}

// ---------------------------------------------------------------- 10. comisiones/snapshot
const ComisionSnapshotRow = z.object({ afore_codigo: z.string(), afore_nombre_corto: z.string(), tipo_pension: z.string(), comision_pct: z.number().nullable() });
const ComisionSnapshotResponse = z.object({
  fecha: z.string(), unit: z.string(), n_afores_reportando: z.number().int(), promedio_simple_pct: z.number(), minima_pct: z.number(), maxima_pct: z.number(),
  afores: z.array(ComisionSnapshotRow), caveats: z.array(z.string()),
});
const SQL_COMISION_SNAPSHOT = `
SELECT a.codigo AS afore_codigo,
       a.nombre_corto AS afore_nombre_corto,
       a.tipo_pension,
       a.orden_display,
       c.comision AS comision_pct
FROM afores a
LEFT JOIN comisiones c
       ON c.afore_id = a.id AND c.fecha = ?1
WHERE a.codigo <> 'pension_bienestar'
ORDER BY a.orden_display`;

export class ComisionesSnapshot extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_comisiones_snapshot_api_v1_consar_comisiones_snapshot_get",
    summary: "Snapshot mensual: comisión cobrada por cada AFORE en una fecha específica",
    description: "Retorna para la fecha indicada (YYYY-MM o YYYY-MM-01) la comisión cobrada por cada una de las 10 AFOREs reportantes. Incluye promedio simple, mínima y máxima del sistema. Pensión Bienestar excluida (régimen sin comisión sobre saldo).",
    request: { query: z.object({ fecha: z.string().describe("YYYY-MM o YYYY-MM-01 (cobertura 2008-03 a 2025-06)") }) },
    responses: { "200": { description: "Successful Response", ...contentJson(ComisionSnapshotResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const d = parseFecha(query.fecha);
    const rows = await filas<{ afore_codigo: string; afore_nombre_corto: string; tipo_pension: string; comision_pct: number | null }>(c.env.DB_CONSAR, SQL_COMISION_SNAPSHOT, [d]);
    const reporting = rows.filter((r) => r.comision_pct !== null);
    if (reporting.length === 0) throw new ErrorHttp(404, `No hay datos para fecha=${d} (cobertura: 2008-03 a 2025-06)`);
    const valores = reporting.map((r) => r.comision_pct as number);
    const promedio = valores.reduce((s, x) => s + x, 0) / valores.length;
    return {
      fecha: d, unit: UNIT_COMISION, n_afores_reportando: reporting.length, promedio_simple_pct: redondear(promedio, 4),
      minima_pct: redondear(Math.min(...valores), 4), maxima_pct: redondear(Math.max(...valores), 4),
      afores: rows.map((r) => ({ afore_codigo: r.afore_codigo, afore_nombre_corto: r.afore_nombre_corto, tipo_pension: r.tipo_pension, comision_pct: r.comision_pct !== null ? redondear(r.comision_pct, 4) : null })),
      caveats: [CAVEAT_COMISION_REFORMA, CAVEAT_COMISION_BIENESTAR],
    };
  }
}

// ---------------------------------------------------------------- 11. flujos/serie
const FlujoPunto = z.object({ fecha: z.string(), montos_entradas: z.number(), montos_salidas: z.number(), flujo_neto: z.number() });
const FlujoSerieResponse = z.object({ afore: AforeRef.nullable(), unit: z.string(), n_puntos: z.number().int(), rango: SerieRango, serie: z.array(FlujoPunto), caveats: z.array(z.string()) });
const SQL_FLUJO_SERIE = `
SELECT f.fecha,
       SUM(f.montos_entradas) AS montos_entradas,
       SUM(f.montos_salidas)  AS montos_salidas
FROM flujo_recurso f
JOIN afores a ON a.id = f.afore_id
WHERE (?1 IS NULL OR a.codigo = ?1)
  AND f.fecha >= ?2
  AND f.fecha <= ?3
GROUP BY f.fecha
ORDER BY f.fecha`;

export class FlujosSerie extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_flujos_serie_api_v1_consar_flujos_serie_get",
    summary: "Serie temporal: entradas/salidas mensuales por AFORE (o sistema)",
    description: "Retorna serie mensual de aportaciones brutas (`montos_entradas`) y retiros (`montos_salidas`) en mm MXN corrientes. Si `afore_codigo` se omite, suma sobre todas las AFOREs reportantes (sistema). Cobertura 2009-01-01 → 2025-06-01. `flujo_neto = montos_entradas - montos_salidas` (positivo = AFORE captando neto).",
    request: { query: z.object({
      afore_codigo: z.string().optional().describe("Código AFORE opcional (e.g. 'xxi_banorte')"),
      desde: z.string().optional().describe("YYYY-MM o YYYY-MM-01 (default 2009-01)"),
      hasta: z.string().optional().describe("YYYY-MM o YYYY-MM-01 (default 2025-06)"),
    }) },
    responses: { "200": { description: "Successful Response", ...contentJson(FlujoSerieResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const v = await ventana(c, query, "2009-01-01");
    const rows = await filas<{ fecha: string; montos_entradas: number; montos_salidas: number }>(c.env.DB_CONSAR, SQL_FLUJO_SERIE, [v.afore_codigo, v.d_desde, v.d_hasta]);
    return {
      afore: v.afore, unit: UNIT_MM, n_puntos: rows.length, rango: { desde: v.d_desde, hasta: v.d_hasta },
      serie: rows.map((r) => ({ fecha: r.fecha, montos_entradas: redondear(r.montos_entradas, 4), montos_salidas: redondear(r.montos_salidas, 4), flujo_neto: redondear(r.montos_entradas - r.montos_salidas, 4) })),
      caveats: [CAVEAT_FLUJO_COBERTURA, CAVEAT_FLUJO_BIENESTAR],
    };
  }
}

// ---------------------------------------------------------------- 12. flujos/snapshot
const FlujoSnapshotRow = z.object({ afore_codigo: z.string(), afore_nombre_corto: z.string(), tipo_pension: z.string(), montos_entradas: z.number(), montos_salidas: z.number(), flujo_neto: z.number() });
const FlujoSnapshotResponse = z.object({
  fecha: z.string(), unit: z.string(), n_afores_reportando: z.number().int(), sistema_entradas_mm: z.number(), sistema_salidas_mm: z.number(), sistema_flujo_neto_mm: z.number(),
  afores: z.array(FlujoSnapshotRow), caveats: z.array(z.string()),
});
const SQL_FLUJO_SNAPSHOT = `
SELECT a.codigo AS afore_codigo,
       a.nombre_corto AS afore_nombre_corto,
       a.tipo_pension,
       a.orden_display,
       COALESCE(f.montos_entradas, 0) AS montos_entradas,
       COALESCE(f.montos_salidas,  0) AS montos_salidas
FROM afores a
LEFT JOIN flujo_recurso f
       ON f.afore_id = a.id AND f.fecha = ?1
WHERE a.codigo <> 'pension_bienestar'
ORDER BY a.orden_display`;

export class FlujosSnapshot extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_flujos_snapshot_api_v1_consar_flujos_snapshot_get",
    summary: "Snapshot mensual: entradas/salidas por AFORE en una fecha",
    description: "Retorna para la fecha indicada (YYYY-MM o YYYY-MM-01) los flujos por cada AFORE reportante + totales del sistema. Cobertura 2009-01 → 2025-06.",
    request: { query: z.object({ fecha: z.string().describe("YYYY-MM o YYYY-MM-01") }) },
    responses: { "200": { description: "Successful Response", ...contentJson(FlujoSnapshotResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const d = parseFecha(query.fecha);
    const rows = await filas<{ afore_codigo: string; afore_nombre_corto: string; tipo_pension: string; montos_entradas: number; montos_salidas: number }>(c.env.DB_CONSAR, SQL_FLUJO_SNAPSHOT, [d]);
    const reporting = rows.filter((r) => (r.montos_entradas || 0) > 0 || (r.montos_salidas || 0) > 0);
    if (reporting.length === 0) throw new ErrorHttp(404, `No hay datos para fecha=${d} (cobertura: 2009-01 a 2025-06)`);
    const sis_ent = reporting.reduce((s, r) => s + r.montos_entradas, 0);
    const sis_sal = reporting.reduce((s, r) => s + r.montos_salidas, 0);
    return {
      fecha: d, unit: UNIT_MM, n_afores_reportando: reporting.length,
      sistema_entradas_mm: redondear(sis_ent, 4), sistema_salidas_mm: redondear(sis_sal, 4), sistema_flujo_neto_mm: redondear(sis_ent - sis_sal, 4),
      afores: rows.map((r) => ({ afore_codigo: r.afore_codigo, afore_nombre_corto: r.afore_nombre_corto, tipo_pension: r.tipo_pension, montos_entradas: redondear(r.montos_entradas, 4), montos_salidas: redondear(r.montos_salidas, 4), flujo_neto: redondear(r.montos_entradas - r.montos_salidas, 4) })),
      caveats: [CAVEAT_FLUJO_COBERTURA, CAVEAT_FLUJO_BIENESTAR],
    };
  }
}

// ---------------------------------------------------------------- 13. traspasos/serie
const TraspasoPunto = z.object({ fecha: z.string(), num_tras_cedido: z.number().int().nullable(), num_tras_recibido: z.number().int().nullable(), traspaso_neto: z.number().int().nullable() });
const TraspasoSerieResponse = z.object({ afore: AforeRef.nullable(), n_puntos: z.number().int(), rango: SerieRango, serie: z.array(TraspasoPunto), caveats: z.array(z.string()) });
const SQL_TRASPASO_SERIE = `
SELECT t.fecha,
       SUM(t.num_tras_cedido)   AS sum_ced,
       SUM(t.num_tras_recibido) AS sum_rec
FROM traspaso t
JOIN afores a ON a.id = t.afore_id
WHERE (?1 IS NULL OR a.codigo = ?1)
  AND t.fecha >= ?2
  AND t.fecha <= ?3
GROUP BY t.fecha
ORDER BY t.fecha`;

export class TraspasosSerie extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_traspasos_serie_api_v1_consar_traspasos_serie_get",
    summary: "Serie temporal: cuentas cedidas/recibidas en traspasos por AFORE (o sistema)",
    description: "Retorna serie mensual de cuentas cedidas (perdidas) y recibidas (ganadas) en traspasos AFORE-AFORE. Si `afore_codigo` se omite, suma sobre todas las AFOREs. Cobertura 1998-11-01 → 2025-06-01. `traspaso_neto = recibido - cedido` (positivo = AFORE ganando cuentas neto).",
    request: { query: z.object({ afore_codigo: z.string().optional(), desde: z.string().optional(), hasta: z.string().optional() }) },
    responses: { "200": { description: "Successful Response", ...contentJson(TraspasoSerieResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const v = await ventana(c, query, "1998-11-01");
    const rows = await filas<{ fecha: string; sum_ced: number | null; sum_rec: number | null }>(c.env.DB_CONSAR, SQL_TRASPASO_SERIE, [v.afore_codigo, v.d_desde, v.d_hasta]);
    return {
      afore: v.afore, n_puntos: rows.length, rango: { desde: v.d_desde, hasta: v.d_hasta },
      serie: rows.map((r) => {
        const ced = r.sum_ced, rec = r.sum_rec;
        const neto = ced !== null && rec !== null ? rec - ced : null;
        return { fecha: r.fecha, num_tras_cedido: ced !== null ? Math.trunc(ced) : null, num_tras_recibido: rec !== null ? Math.trunc(rec) : null, traspaso_neto: neto !== null ? Math.trunc(neto) : null };
      }),
      caveats: [CAVEAT_TRASPASO_BIENESTAR, CAVEAT_TRASPASO_IDENTIDAD],
    };
  }
}

// ---------------------------------------------------------------- 14. traspasos/snapshot
const TraspasoIdentidad = z.object({ sistema_total_cedido: z.number().int(), sistema_total_recibido: z.number().int(), delta: z.number().int(), cierre_al_unidad: z.boolean() });
const TraspasoSnapshotRow = z.object({ afore_codigo: z.string(), afore_nombre_corto: z.string(), tipo_pension: z.string(), num_tras_cedido: z.number().int().nullable(), num_tras_recibido: z.number().int().nullable(), traspaso_neto: z.number().int().nullable() });
const TraspasoSnapshotResponse = z.object({ fecha: z.string(), n_afores_reportando: z.number().int(), identidad: TraspasoIdentidad, afores: z.array(TraspasoSnapshotRow), caveats: z.array(z.string()) });
const SQL_TRASPASO_SNAPSHOT = `
SELECT a.codigo AS afore_codigo,
       a.nombre_corto AS afore_nombre_corto,
       a.tipo_pension,
       a.orden_display,
       t.num_tras_cedido,
       t.num_tras_recibido
FROM afores a
LEFT JOIN traspaso t
       ON t.afore_id = a.id AND t.fecha = ?1
WHERE a.codigo <> 'pension_bienestar'
ORDER BY a.orden_display`;

export class TraspasosSnapshot extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_traspasos_snapshot_api_v1_consar_traspasos_snapshot_get",
    summary: "Snapshot mensual: traspasos por AFORE + identidad Σced=Σrec",
    description: "Retorna para la fecha indicada los traspasos cedidos/recibidos por cada AFORE reportante. Incluye verificación de la identidad implícita Σ cedidos = Σ recibidos (cada traspaso es 1+1).",
    request: { query: z.object({ fecha: z.string().describe("YYYY-MM o YYYY-MM-01") }) },
    responses: { "200": { description: "Successful Response", ...contentJson(TraspasoSnapshotResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const d = parseFecha(query.fecha);
    const rows = await filas<{ afore_codigo: string; afore_nombre_corto: string; tipo_pension: string; num_tras_cedido: number | null; num_tras_recibido: number | null }>(c.env.DB_CONSAR, SQL_TRASPASO_SNAPSHOT, [d]);
    const reporting = rows.filter((r) => r.num_tras_cedido !== null || r.num_tras_recibido !== null);
    if (reporting.length === 0) throw new ErrorHttp(404, `No hay datos para fecha=${d} (cobertura: 1998-11 a 2025-06)`);
    const sis_ced = reporting.reduce((s, r) => s + (r.num_tras_cedido || 0), 0);
    const sis_rec = reporting.reduce((s, r) => s + (r.num_tras_recibido || 0), 0);
    const delta = sis_ced - sis_rec;
    return {
      fecha: d, n_afores_reportando: reporting.length,
      identidad: { sistema_total_cedido: sis_ced, sistema_total_recibido: sis_rec, delta, cierre_al_unidad: delta === 0 },
      afores: rows.map((r) => ({
        afore_codigo: r.afore_codigo, afore_nombre_corto: r.afore_nombre_corto, tipo_pension: r.tipo_pension,
        num_tras_cedido: r.num_tras_cedido, num_tras_recibido: r.num_tras_recibido,
        traspaso_neto: r.num_tras_cedido !== null && r.num_tras_recibido !== null ? r.num_tras_recibido - r.num_tras_cedido : null,
      })),
      caveats: [CAVEAT_TRASPASO_BIENESTAR, CAVEAT_TRASPASO_NULLS, CAVEAT_TRASPASO_IDENTIDAD],
    };
  }
}

// ---------------------------------------------------------------- 15. pea-cotizantes/serie
const PeaCotizantesPunto = z.object({ anio: z.number().int(), cotizantes: z.number().int(), pea: z.number().int(), porcentaje_pea_afore: z.number(), brecha_no_cubierta_pct: z.number() });
const PeaCotizantesResponse = z.object({
  n_puntos: z.number().int(), anio_min: z.number().int(), anio_max: z.number().int(), serie: z.array(PeaCotizantesPunto),
  cobertura_min_pct: z.number(), cobertura_min_anio: z.number().int(), cobertura_max_pct: z.number(), cobertura_max_anio: z.number().int(), caveats: z.array(z.string()),
});
const SQL_PEA = `SELECT anio, cotizantes, pea, porcentaje_pea_afore FROM pea_cotizantes ORDER BY anio`;

export class PeaCotizantesSerie extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_pea_cotizantes_api_v1_consar_pea_cotizantes_serie_get",
    summary: "Serie anual: cobertura SAR sobre PEA mexicana (2010-2024)",
    description: "Retorna la serie anual nacional de la cobertura del SAR (cotizantes formales) sobre la PEA (Población Económicamente Activa) total. Incluye `brecha_no_cubierta_pct` (=100 - porcentaje) que integra informalidad, desempleo y elegibles no registrados. Cobertura 2010 → 2024 (15 puntos).",
    responses: { "200": { description: "Successful Response", ...contentJson(PeaCotizantesResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const rows = await filas<{ anio: number; cotizantes: number; pea: number; porcentaje_pea_afore: number }>(c.env.DB_CONSAR, SQL_PEA);
    if (rows.length === 0) throw new ErrorHttp(500, "no hay datos en consar.pea_cotizantes");
    const serie = rows.map((r) => ({ anio: r.anio, cotizantes: r.cotizantes, pea: r.pea, porcentaje_pea_afore: redondear(r.porcentaje_pea_afore, 2), brecha_no_cubierta_pct: redondear(100.0 - r.porcentaje_pea_afore, 2) }));
    let cmin = serie[0], cmax = serie[0];
    for (const p of serie) { if (p.porcentaje_pea_afore < cmin.porcentaje_pea_afore) cmin = p; if (p.porcentaje_pea_afore > cmax.porcentaje_pea_afore) cmax = p; }
    return {
      n_puntos: serie.length, anio_min: serie[0].anio, anio_max: serie[serie.length - 1].anio, serie,
      cobertura_min_pct: cmin.porcentaje_pea_afore, cobertura_min_anio: cmin.anio, cobertura_max_pct: cmax.porcentaje_pea_afore, cobertura_max_anio: cmax.anio,
      caveats: [CAVEAT_PEA_FUENTES, CAVEAT_PEA_COBERTURA_INTERPRETACION],
    };
  }
}

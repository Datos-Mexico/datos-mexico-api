import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import { parseFecha } from "../lib/fechas";
import { redondear } from "../lib/numeros";
import {
  CAVEAT_AHORRO_PRE_DESAGREGACION, CAVEAT_BANXICO, CAVEAT_BONO_ISSSTE, CAVEAT_FONDOS_PREV,
  CAVEAT_PENSION_BIENESTAR, CAVEAT_UNIDAD, SOURCE_CONSAR,
} from "./constantes";

const UNIT = "millones de pesos MXN corrientes";
const COBERTURA = "(cobertura: 1998-05 a 2025-06)";
const SerieRango = z.object({ desde: z.string(), hasta: z.string() });

// ---------------------------------------------------------------- 3. totales
const TotalSarPunto = z.object({ fecha: z.string(), monto_mxn_mm: z.number(), n_afores: z.number().int() });
const TotalesSarResponse = z.object({
  unit: z.string(), n_puntos: z.number().int(), fecha_min: z.string(), fecha_max: z.string(),
  serie: z.array(TotalSarPunto), caveats: z.array(z.string()), source: z.string(),
});
const SQL_TOTALES = `
SELECT
    rm.fecha,
    SUM(rm.monto_mxn_mm) AS monto_mxn_mm,
    COUNT(DISTINCT rm.afore_id) AS n_afores
FROM recursos_mensuales rm
JOIN tipos_recurso tr ON tr.id = rm.tipo_recurso_id
WHERE tr.codigo = 'sar_total'
GROUP BY rm.fecha
ORDER BY rm.fecha`;

export class RecursosTotales extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_totales_api_v1_consar_recursos_totales_get",
    summary: "Serie temporal: recursos totales registrados en el SAR (nacional)",
    description: "Retorna los 326 puntos mensuales de la serie de recursos totales registrados en el SAR a nivel sistema (suma sobre todas las AFOREs). Cobertura 1998-05-01 a 2025-06-01.",
    responses: { "200": { description: "Successful Response", ...contentJson(TotalesSarResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const rows = await filas<{ fecha: string; monto_mxn_mm: number; n_afores: number }>(c.env.DB_CONSAR, SQL_TOTALES);
    if (rows.length === 0) throw new ErrorHttp(500, "no hay datos en consar.recursos_mensuales");
    return {
      unit: UNIT, n_puntos: rows.length, fecha_min: rows[0].fecha, fecha_max: rows[rows.length - 1].fecha,
      serie: rows, caveats: [CAVEAT_UNIDAD, CAVEAT_PENSION_BIENESTAR], source: SOURCE_CONSAR,
    };
  }
}

// ---------------------------------------------------------------- 4. por-afore
const AforeSnapshotRow = z.object({
  afore_codigo: z.string(), afore_nombre_corto: z.string(), sar_total_mm: z.number().nullable(),
  recursos_trabajadores_mm: z.number().nullable(), recursos_administrados_mm: z.number().nullable(), pct_sistema: z.number().nullable(),
});
const PorAforeResponse = z.object({
  fecha: z.string(), unit: z.string(), total_sistema_mm: z.number(), n_afores_reportando: z.number().int(),
  afores: z.array(AforeSnapshotRow), caveats: z.array(z.string()),
});
const SQL_POR_AFORE = `
WITH snapshot AS (
    SELECT
        a.codigo AS afore_codigo,
        a.nombre_corto AS afore_nombre_corto,
        a.orden_display,
        MAX(CASE WHEN tr.codigo = 'sar_total'              THEN rm.monto_mxn_mm END) AS sar_total_mm,
        MAX(CASE WHEN tr.codigo = 'recursos_trabajadores'  THEN rm.monto_mxn_mm END) AS recursos_trabajadores_mm,
        MAX(CASE WHEN tr.codigo = 'recursos_administrados' THEN rm.monto_mxn_mm END) AS recursos_administrados_mm
    FROM afores a
    LEFT JOIN recursos_mensuales rm ON rm.afore_id = a.id AND rm.fecha = ?1
    LEFT JOIN tipos_recurso tr      ON tr.id = rm.tipo_recurso_id
    GROUP BY a.codigo, a.nombre_corto, a.orden_display
)
SELECT * FROM snapshot ORDER BY orden_display`;

export class RecursosPorAfore extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_por_afore_api_v1_consar_recursos_por_afore_get",
    summary: "Snapshot mensual: recursos por AFORE en una fecha específica",
    description: "Retorna para la fecha indicada (YYYY-MM o YYYY-MM-01) los recursos totales SAR, recursos de los trabajadores y recursos administrados por cada una de las 11 AFOREs. Incluye % del sistema.",
    request: { query: z.object({ fecha: z.string().describe("YYYY-MM o YYYY-MM-01 (ej. 2025-06 o 2025-06-01)") }) },
    responses: { "200": { description: "Successful Response", ...contentJson(PorAforeResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const d = parseFecha(query.fecha);
    const rows = await filas<{ afore_codigo: string; afore_nombre_corto: string; sar_total_mm: number | null; recursos_trabajadores_mm: number | null; recursos_administrados_mm: number | null }>(c.env.DB_CONSAR, SQL_POR_AFORE, [d]);
    const total_sistema = rows.reduce((s, r) => s + (r.sar_total_mm || 0.0), 0.0);
    if (total_sistema === 0) throw new ErrorHttp(404, `No hay datos para fecha=${d} ${COBERTURA}`);
    let n_reportando = 0;
    const afores = rows.map((r) => {
      const sar = r.sar_total_mm;
      const pct = sar && total_sistema ? (100.0 * sar) / total_sistema : null;
      if (sar !== null && sar > 0) n_reportando += 1;
      return {
        afore_codigo: r.afore_codigo, afore_nombre_corto: r.afore_nombre_corto, sar_total_mm: sar,
        recursos_trabajadores_mm: r.recursos_trabajadores_mm, recursos_administrados_mm: r.recursos_administrados_mm,
        pct_sistema: pct !== null ? redondear(pct, 3) : null,
      };
    });
    return { fecha: d, unit: UNIT, total_sistema_mm: redondear(total_sistema, 2), n_afores_reportando: n_reportando, afores, caveats: [CAVEAT_UNIDAD, CAVEAT_PENSION_BIENESTAR] };
  }
}

// ---------------------------------------------------------------- 5. por-componente
const ComponenteSnapshotRow = z.object({ tipo_codigo: z.string(), tipo_nombre_corto: z.string(), categoria: z.string(), monto_mxn_mm: z.number(), pct_del_sar_total: z.number().nullable() });
const PorComponenteResponse = z.object({ fecha: z.string(), unit: z.string(), sar_total_mm: z.number(), n_componentes: z.number().int(), componentes: z.array(ComponenteSnapshotRow), caveats: z.array(z.string()) });
const SQL_POR_COMPONENTE = `
SELECT
    tr.codigo AS tipo_codigo,
    tr.nombre_corto AS tipo_nombre_corto,
    tr.categoria,
    tr.orden_display,
    SUM(rm.monto_mxn_mm) AS monto_mxn_mm
FROM tipos_recurso tr
LEFT JOIN recursos_mensuales rm ON rm.tipo_recurso_id = tr.id AND rm.fecha = ?1
GROUP BY tr.codigo, tr.nombre_corto, tr.categoria, tr.orden_display
ORDER BY tr.orden_display`;

export class RecursosPorComponente extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_por_componente_api_v1_consar_recursos_por_componente_get",
    summary: "Snapshot mensual: desglose por tipo de recurso (nacional)",
    description: "Retorna para la fecha indicada (YYYY-MM) el monto agregado a nivel sistema para cada uno de los 15 tipos de recurso. Incluye % respecto al sar_total donde sea informativo (components y aggregates).",
    request: { query: z.object({ fecha: z.string().describe("YYYY-MM o YYYY-MM-01") }) },
    responses: { "200": { description: "Successful Response", ...contentJson(PorComponenteResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const d = parseFecha(query.fecha);
    const rows = await filas<{ tipo_codigo: string; tipo_nombre_corto: string; categoria: string; monto_mxn_mm: number | null }>(c.env.DB_CONSAR, SQL_POR_COMPONENTE, [d]);
    const sarRow = rows.find((r) => r.tipo_codigo === "sar_total");
    const sar_total = (sarRow ? sarRow.monto_mxn_mm : null) || 0.0;
    if (sar_total === 0) throw new ErrorHttp(404, `No hay datos para fecha=${d} ${COBERTURA}`);
    const componentes: z.infer<typeof ComponenteSnapshotRow>[] = [];
    for (const r of rows) {
      const monto = r.monto_mxn_mm;
      if (monto === null) continue;
      let pct: number | null = null;
      if ((r.categoria === "component" || r.categoria === "aggregate") && sar_total > 0) pct = redondear((100.0 * monto) / sar_total, 3);
      componentes.push({ tipo_codigo: r.tipo_codigo, tipo_nombre_corto: r.tipo_nombre_corto, categoria: r.categoria, monto_mxn_mm: redondear(monto, 2), pct_del_sar_total: pct });
    }
    return { fecha: d, unit: UNIT, sar_total_mm: redondear(sar_total, 2), n_componentes: componentes.length, componentes, caveats: [CAVEAT_UNIDAD, CAVEAT_FONDOS_PREV, CAVEAT_BANXICO, CAVEAT_BONO_ISSSTE] };
  }
}

// ---------------------------------------------------------------- 6. imss-vs-issste
const ImssVsIsssteePunto = z.object({ fecha: z.string(), rcv_imss_mm: z.number().nullable(), rcv_issste_mm: z.number().nullable(), ratio_issste_sobre_imss: z.number().nullable() });
const ImssVsIsssteeResponse = z.object({ unit: z.string(), n_puntos: z.number().int(), serie: z.array(ImssVsIsssteePunto), caveats: z.array(z.string()) });
const SQL_IMSS_VS_ISSSTE = `
SELECT
    rm.fecha,
    SUM(CASE WHEN tr.codigo = 'rcv_imss'   THEN rm.monto_mxn_mm ELSE 0 END) AS rcv_imss_mm,
    SUM(CASE WHEN tr.codigo = 'rcv_issste' THEN rm.monto_mxn_mm ELSE 0 END) AS rcv_issste_mm
FROM recursos_mensuales rm
JOIN tipos_recurso tr ON tr.id = rm.tipo_recurso_id
WHERE tr.codigo IN ('rcv_imss', 'rcv_issste')
GROUP BY rm.fecha
ORDER BY rm.fecha`;

export class RecursosImssVsIssste extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_imss_vs_issste_api_v1_consar_recursos_imss_vs_issste_get",
    summary: "Serie temporal: RCV-IMSS vs RCV-ISSSTE (privado vs público)",
    description: "Retorna la serie mensual agregada a nivel sistema de RCV-IMSS (trabajadores del sector privado afiliados al IMSS) y RCV-ISSSTE (trabajadores del sector público). RCV-ISSSTE reportado desde ~2008 con la reforma ISSSTE.",
    responses: { "200": { description: "Successful Response", ...contentJson(ImssVsIsssteeResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const rows = await filas<{ fecha: string; rcv_imss_mm: number; rcv_issste_mm: number }>(c.env.DB_CONSAR, SQL_IMSS_VS_ISSSTE);
    const serie = rows.map((r) => {
      const imss = r.rcv_imss_mm || null;
      const issste = r.rcv_issste_mm || null;
      let ratio: number | null = null;
      if (imss && issste && imss > 0) ratio = redondear(issste / imss, 4);
      return { fecha: r.fecha, rcv_imss_mm: imss ? redondear(imss, 2) : null, rcv_issste_mm: issste ? redondear(issste, 2) : null, ratio_issste_sobre_imss: ratio };
    });
    return {
      unit: UNIT, n_puntos: serie.length, serie,
      caveats: [
        CAVEAT_UNIDAD,
        "RCV-ISSSTE reportado de forma consistente desde 2008-12 con la reforma ISSSTE; puntos anteriores pueden mostrar cero.",
        "RCV-IMSS cubre trabajadores privados afiliados al IMSS; RCV-ISSSTE cubre trabajadores públicos. PensionISSSTE es la AFORE pública pero todas las AFOREs manejan ambos tipos de cuenta.",
      ],
    };
  }
}

// ---------------------------------------------------------------- 7. composicion
const COMPONENTES_IDENTIDAD = ["rcv_imss", "rcv_issste", "bono_pension_issste", "vivienda", "ahorro_voluntario_y_solidario", "capital_afores", "banxico", "fondos_prevision_social"];
const ComposicionItem = z.object({ tipo_codigo: z.string(), tipo_nombre_corto: z.string(), monto_mxn_mm: z.number(), pct_del_sar: z.number() });
const ComposicionResponse = z.object({
  fecha: z.string(), unit: z.string(), sar_total_reportado_mm: z.number(), suma_8_componentes_mm: z.number(), delta_abs_mm: z.number(),
  delta_pct: z.number(), cierre_al_peso: z.boolean(), componentes: z.array(ComposicionItem), caveats: z.array(z.string()), identidad_caveat: z.string(),
});
const SQL_COMPOSICION = `
SELECT
    tr.codigo AS tipo_codigo,
    tr.nombre_corto AS tipo_nombre_corto,
    tr.orden_display,
    SUM(rm.monto_mxn_mm) AS monto_mxn_mm
FROM tipos_recurso tr
LEFT JOIN recursos_mensuales rm ON rm.tipo_recurso_id = tr.id AND rm.fecha = ?1
WHERE tr.codigo IN (${COMPONENTES_IDENTIDAD.map(() => "?").join(", ")})
GROUP BY tr.codigo, tr.nombre_corto, tr.orden_display
ORDER BY tr.orden_display`;
const SQL_SAR_TOTAL_AT = `
SELECT SUM(rm.monto_mxn_mm) AS sar_total
FROM recursos_mensuales rm
JOIN tipos_recurso tr ON tr.id = rm.tipo_recurso_id
WHERE tr.codigo = 'sar_total' AND rm.fecha = ?1`;

export class RecursosComposicion extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_composicion_api_v1_consar_recursos_composicion_get",
    summary: "Desglose contable del SAR: 8 componentes vs total reportado",
    description: "Para la fecha indicada, retorna los 8 componentes de la identidad sar_total (verificada empíricamente al peso en 98.83% de filas y 100% de filas 2020+). Incluye delta vs total reportado para transparencia sobre el residuo histórico.",
    request: { query: z.object({ fecha: z.string().describe("YYYY-MM o YYYY-MM-01") }) },
    responses: { "200": { description: "Successful Response", ...contentJson(ComposicionResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const d = parseFecha(query.fecha);
    const rows = await filas<{ tipo_codigo: string; tipo_nombre_corto: string; monto_mxn_mm: number | null }>(c.env.DB_CONSAR, SQL_COMPOSICION, [d, ...COMPONENTES_IDENTIDAD]);
    const sarRow = await fila<{ sar_total: number | null }>(c.env.DB_CONSAR, SQL_SAR_TOTAL_AT, [d]);
    const sar_total = sarRow ? sarRow.sar_total : null;
    if (sar_total === null || sar_total === 0) throw new ErrorHttp(404, `No hay datos para fecha=${d} ${COBERTURA}`);
    let suma = 0.0;
    const componentes = rows.map((r) => {
      const monto = r.monto_mxn_mm || 0.0;
      suma += monto;
      return { tipo_codigo: r.tipo_codigo, tipo_nombre_corto: r.tipo_nombre_corto, monto_mxn_mm: redondear(monto, 2), pct_del_sar: sar_total > 0 ? redondear((100.0 * monto) / sar_total, 3) : 0.0 };
    });
    const delta_abs = sar_total - suma;
    const delta_pct = sar_total > 0 ? (100.0 * delta_abs) / sar_total : 0.0;
    return {
      fecha: d, unit: UNIT, sar_total_reportado_mm: redondear(sar_total, 2), suma_8_componentes_mm: redondear(suma, 2),
      delta_abs_mm: redondear(delta_abs, 2), delta_pct: redondear(delta_pct, 4), cierre_al_peso: Math.abs(delta_abs) <= 0.05, componentes,
      caveats: [CAVEAT_UNIDAD, CAVEAT_FONDOS_PREV, CAVEAT_BANXICO, CAVEAT_BONO_ISSSTE, CAVEAT_AHORRO_PRE_DESAGREGACION],
      identidad_caveat: CAVEAT_IDENTIDAD_SAR,
    };
  }
}
import { CAVEAT_IDENTIDAD_SAR } from "./constantes";

// ---------------------------------------------------------------- 8. serie
const SerieTipoRecursoRef = z.object({ codigo: z.string(), nombre_corto: z.string(), nombre_oficial: z.string(), categoria: z.string() });
const SerieAforeRef = z.object({ codigo: z.string(), nombre_corto: z.string(), tipo_pension: z.string() });
const SeriePunto = z.object({ fecha: z.string(), monto_mxn_mm: z.number() });
const SerieResponse = z.object({
  tipo_recurso: SerieTipoRecursoRef, afore: SerieAforeRef.nullable(), unit: z.string(), n_puntos: z.number().int(),
  rango: SerieRango, serie: z.array(SeriePunto), caveats: z.array(z.string()),
});
const SQL_TIPO_META = `SELECT codigo, nombre_corto, nombre_oficial, categoria FROM tipos_recurso WHERE codigo = ?1`;
const SQL_AFORE_META = `SELECT codigo, nombre_corto, tipo_pension FROM afores WHERE codigo = ?1`;
const SQL_SERIE = `
SELECT rm.fecha,
       SUM(rm.monto_mxn_mm) AS monto_mxn_mm
FROM recursos_mensuales rm
JOIN tipos_recurso tr ON tr.id = rm.tipo_recurso_id
JOIN afores a         ON a.id = rm.afore_id
WHERE tr.codigo = ?1
  AND (?2 IS NULL OR a.codigo = ?2)
  AND rm.fecha >= ?3
  AND rm.fecha <= ?4
GROUP BY rm.fecha
ORDER BY rm.fecha`;

export class RecursosSerie extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_serie_api_v1_consar_recursos_serie_get",
    summary: "Serie temporal por tipo de recurso (opcionalmente filtrada por AFORE)",
    description: "Retorna la serie mensual agregada del tipo de recurso indicado. Si `afore_codigo` se omite, suma todas las AFOREs (nacional). Parámetros `desde`/`hasta` aceptan YYYY-MM o YYYY-MM-01; default a la cobertura completa 1998-05 / 2025-06.",
    request: {
      query: z.object({
        codigo: z.string().describe("Código del tipo_recurso (p. ej. 'vivienda', 'rcv_imss', 'sar_total')"),
        afore_codigo: z.string().optional().describe("Código AFORE opcional (p. ej. 'pension_bienestar'); si se omite, suma nacional"),
        desde: z.string().optional().describe("YYYY-MM o YYYY-MM-01 (default 1998-05)"),
        hasta: z.string().optional().describe("YYYY-MM o YYYY-MM-01 (default 2025-06)"),
      }),
    },
    responses: { "200": { description: "Successful Response", ...contentJson(SerieResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const codigo = query.codigo;
    const afore_codigo = query.afore_codigo ?? null;
    const d_desde = query.desde !== undefined ? parseFecha(query.desde) : "1998-05-01";
    const d_hasta = query.hasta !== undefined ? parseFecha(query.hasta) : "2025-06-01";
    if (d_desde > d_hasta) throw new ErrorHttp(422, "'desde' debe ser <= 'hasta'");
    const tipo = await fila<z.infer<typeof SerieTipoRecursoRef>>(c.env.DB_CONSAR, SQL_TIPO_META, [codigo]);
    if (!tipo) throw new ErrorHttp(404, `tipo_recurso '${codigo}' no existe`);
    let afore: z.infer<typeof SerieAforeRef> | null = null;
    if (afore_codigo !== null) {
      afore = await fila<z.infer<typeof SerieAforeRef>>(c.env.DB_CONSAR, SQL_AFORE_META, [afore_codigo]);
      if (!afore) throw new ErrorHttp(404, `afore '${afore_codigo}' no existe`);
    }
    const rows = await filas<{ fecha: string; monto_mxn_mm: number }>(c.env.DB_CONSAR, SQL_SERIE, [codigo, afore_codigo, d_desde, d_hasta]);
    const caveats = [CAVEAT_UNIDAD];
    if (afore_codigo === "pension_bienestar") caveats.push(CAVEAT_PENSION_BIENESTAR);
    if (codigo === "fondos_prevision_social") caveats.push(CAVEAT_FONDOS_PREV);
    if (codigo === "banxico") caveats.push(CAVEAT_BANXICO);
    if (codigo === "bono_pension_issste") caveats.push(CAVEAT_BONO_ISSSTE);
    if (codigo === "rcv_issste") caveats.push("RCV-ISSSTE reportado de forma consistente desde 2008-12 con la reforma ISSSTE.");
    if (["ahorro_voluntario", "ahorro_solidario", "ahorro_voluntario_y_solidario"].includes(codigo)) caveats.push(CAVEAT_AHORRO_PRE_DESAGREGACION);
    return {
      tipo_recurso: tipo, afore, unit: UNIT, n_puntos: rows.length, rango: { desde: d_desde, hasta: d_hasta },
      serie: rows.map((r) => ({ fecha: r.fecha, monto_mxn_mm: redondear(r.monto_mxn_mm, 2) })), caveats,
    };
  }
}

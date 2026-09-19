// Métricas de sensibilidad, medidas regulatorias y cuentas administradas (endpoints 22 a 28 del legacy).
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429, bool } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import { parseFecha } from "../lib/fechas";
import { repr } from "../lib/texto";
import {
  CAVEAT_CUENTA_BIGINT, CAVEAT_CUENTA_DESDE_FECHA, CAVEAT_CUENTA_IDENTIDAD_SAR, CAVEAT_CUENTA_NO_COMMERCIAL,
  CAVEAT_MEDIDA_DECOMPOSITION, CAVEAT_MEDIDA_ESCENARIOS_SPARSITY, CAVEAT_MEDIDA_PID_CORRECCION, CAVEAT_MEDIDA_PIVOT, CAVEAT_MEDIDA_SUBVARIANT_METRICAS,
} from "./constantes";

const AforeRef = z.object({ codigo: z.string(), nombre_corto: z.string(), tipo_pension: z.string() });
const SieforeRef = z.object({ slug: z.string(), nombre: z.string(), categoria: z.string() });
const SerieRango = z.object({ desde: z.string(), hasta: z.string() });
const MappingMeta = z.object({ is_subvariant_decomposed: z.boolean(), mapping_validated: z.boolean().nullable(), validated_via: z.string().nullable() });

// ---------------------------------------------------------------- 22. metricas-sensibilidad
const MetricaSensibilidadRow = z.object({ id: z.number().int(), slug: z.string(), columna_csv: z.string(), descripcion: z.string(), unidad: z.string(), orden_display: z.number().int() });
const MetricasSensibilidadResponse = z.object({ n: z.number().int(), metricas: z.array(MetricaSensibilidadRow), caveats: z.array(z.string()) });
const SQL_METRICAS_CATALOGO = `SELECT id, slug, columna_csv, descripcion, unidad, orden_display FROM cat_metrica_sensibilidad ORDER BY orden_display`;

export class MetricasSensibilidad extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_metricas_sensibilidad_api_v1_consar_metricas_sensibilidad_get",
    summary: "Catálogo descubrible: 7 métricas de sensibilidad regulatoria",
    description: "Retorna las 7 métricas de sensibilidad regulatoria reportadas en dataset #03 (coef_liquidez, dcvar, tracking_error, escenarios_var, ppp, pid, var) con su unidad y descripción. Útil para clientes que necesitan descubrir slugs válidos antes de consultar /medidas/serie o /medidas/snapshot.",
    responses: { "200": { description: "Successful Response", ...contentJson(MetricasSensibilidadResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const metricas = await filas<z.infer<typeof MetricaSensibilidadRow>>(c.env.DB_CONSAR, SQL_METRICAS_CATALOGO);
    return { n: metricas.length, metricas, caveats: [CAVEAT_MEDIDA_PID_CORRECCION, CAVEAT_MEDIDA_SUBVARIANT_METRICAS, CAVEAT_MEDIDA_ESCENARIOS_SPARSITY] };
  }
}

// ---------------------------------------------------------------- 23. medidas/serie
const MedidaMetricaRef = z.object({ slug: z.string(), descripcion: z.string(), unidad: z.string() });
const MedidaPunto = z.object({ fecha: z.string(), valor: z.number() });
const MedidaSerieResponse = z.object({ afore: AforeRef, siefore: SieforeRef, metrica: MedidaMetricaRef, n_puntos: z.number().int(), rango: SerieRango, serie: z.array(MedidaPunto), mapping_meta: MappingMeta, caveats: z.array(z.string()) });
type MetaMedida = { afore_codigo: string; afore_nombre_corto: string; afore_tipo_pension: string; siefore_slug: string; siefore_nombre: string; siefore_categoria: string; metrica_slug: string; metrica_descripcion: string; metrica_unidad: string; asa_validated: number | null; asa_validated_via: string | null };
const SQL_MEDIDA_SERIE_META = `
SELECT af.codigo AS afore_codigo, af.nombre_corto AS afore_nombre_corto,
       af.tipo_pension AS afore_tipo_pension,
       cs.slug AS siefore_slug, cs.nombre AS siefore_nombre, cs.categoria AS siefore_categoria,
       cm.slug AS metrica_slug, cm.descripcion AS metrica_descripcion, cm.unidad AS metrica_unidad,
       (SELECT mapping_validated FROM afore_siefore_alias asa
         WHERE asa.afore_id = af.id AND asa.siefore_id = cs.id AND asa.fuente_csv = '#10'
         LIMIT 1) AS asa_validated,
       (SELECT validated_via FROM afore_siefore_alias asa
         WHERE asa.afore_id = af.id AND asa.siefore_id = cs.id AND asa.fuente_csv = '#10'
         LIMIT 1) AS asa_validated_via
FROM afores af, cat_siefore cs, cat_metrica_sensibilidad cm
WHERE af.codigo = ?1 AND cs.slug = ?2 AND cm.slug = ?3`;
const SQL_MEDIDA_SERIE = `
SELECT ms.fecha, ms.valor AS valor
FROM medida_sensibilidad ms
JOIN afores af ON af.id = ms.afore_id
JOIN cat_siefore cs ON cs.id = ms.siefore_id
JOIN cat_metrica_sensibilidad cm ON cm.id = ms.metrica_id
WHERE af.codigo = ?1 AND cs.slug = ?2 AND cm.slug = ?3
ORDER BY ms.fecha`;
function caveatsMedida(metrica: string) {
  const caveats = [CAVEAT_MEDIDA_PIVOT, CAVEAT_MEDIDA_DECOMPOSITION];
  if (metrica === "pid") caveats.push(CAVEAT_MEDIDA_PID_CORRECCION);
  if (metrica === "escenarios_var") caveats.push(CAVEAT_MEDIDA_ESCENARIOS_SPARSITY);
  return caveats;
}

export class MedidasSerie extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_medida_serie_api_v1_consar_medidas_serie_get",
    summary: "Serie temporal: medida regulatoria por (AFORE × SIEFORE × MÉTRICA)",
    description: "Retorna serie mensual de una métrica de sensibilidad regulatoria para una tupla (afore, siefore, métrica). Si la tupla proviene de un sub-variant decompuesto, expone mapping_validated y validated_via. Cobertura 2019-12 → 2025-06.",
    request: { query: z.object({
      afore_codigo: z.string().describe("codigo en consar.afores (e.g. xxi_banorte, profuturo)"),
      siefore_slug: z.string().describe("slug en consar.cat_siefore (e.g. sb 60-64, sps3)"),
      metrica: z.string().describe("slug en consar.cat_metrica_sensibilidad (e.g. var, ppp, pid)"),
    }) },
    responses: { "200": { description: "Successful Response", ...contentJson(MedidaSerieResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const { afore_codigo, siefore_slug, metrica } = query;
    const meta = await fila<MetaMedida>(c.env.DB_CONSAR, SQL_MEDIDA_SERIE_META, [afore_codigo, siefore_slug, metrica]);
    if (!meta) throw new ErrorHttp(404, `afore_codigo=${repr(afore_codigo)}, siefore_slug=${repr(siefore_slug)} o metrica=${repr(metrica)} no existe`);
    const serie = await filas<{ fecha: string; valor: number }>(c.env.DB_CONSAR, SQL_MEDIDA_SERIE, [afore_codigo, siefore_slug, metrica]);
    if (serie.length === 0) throw new ErrorHttp(404, `sin datos para (${afore_codigo}, ${siefore_slug}, ${metrica}). Sub-variants no reportan tracking_error/escenarios_var/pid. escenarios_var es esporádica (76% sparsity incluso en canonical).`);
    const asa = meta.asa_validated;
    return {
      afore: { codigo: meta.afore_codigo, nombre_corto: meta.afore_nombre_corto, tipo_pension: meta.afore_tipo_pension },
      siefore: { slug: meta.siefore_slug, nombre: meta.siefore_nombre, categoria: meta.siefore_categoria },
      metrica: { slug: meta.metrica_slug, descripcion: meta.metrica_descripcion, unidad: meta.metrica_unidad },
      n_puntos: serie.length, rango: { desde: serie[0].fecha, hasta: serie[serie.length - 1].fecha }, serie,
      mapping_meta: { is_subvariant_decomposed: asa !== null, mapping_validated: asa !== null ? bool(asa) : null, validated_via: meta.asa_validated_via },
      caveats: caveatsMedida(metrica),
    };
  }
}

// ---------------------------------------------------------------- 24. medidas/snapshot
const MedidaSnapshotRow = z.object({ afore_codigo: z.string(), afore_nombre_corto: z.string(), siefore_slug: z.string(), siefore_nombre: z.string(), siefore_categoria: z.string(), valor: z.number() });
const MedidaSnapshotResponse = z.object({ fecha: z.string(), metrica: MedidaMetricaRef, n_filas: z.number().int(), valor_min: z.number(), valor_max: z.number(), filas: z.array(MedidaSnapshotRow), caveats: z.array(z.string()) });
const SQL_MEDIDA_SNAPSHOT_META = `SELECT slug, descripcion, unidad FROM cat_metrica_sensibilidad WHERE slug = ?1`;
const SQL_MEDIDA_SNAPSHOT = `
SELECT af.codigo AS afore_codigo, af.nombre_corto AS afore_nombre_corto,
       cs.slug AS siefore_slug, cs.nombre AS siefore_nombre, cs.categoria AS siefore_categoria,
       ms.valor AS valor
FROM medida_sensibilidad ms
JOIN afores af ON af.id = ms.afore_id
JOIN cat_siefore cs ON cs.id = ms.siefore_id
JOIN cat_metrica_sensibilidad cm ON cm.id = ms.metrica_id
WHERE ms.fecha = ?1 AND cm.slug = ?2
ORDER BY af.orden_display, cs.orden_display`;

export class MedidasSnapshot extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_medida_snapshot_api_v1_consar_medidas_snapshot_get",
    summary: "Snapshot mensual: matriz (AFORE × SIEFORE) de una métrica para una fecha",
    description: "Retorna para una fecha y métrica todas las tuplas (afore, siefore) con su valor. Útil para dashboards comparativos de exposición regulatoria. Cobertura 2019-12 → 2025-06.",
    request: { query: z.object({ fecha: z.string().describe("YYYY-MM o YYYY-MM-01"), metrica: z.string().describe("slug en consar.cat_metrica_sensibilidad") }) },
    responses: { "200": { description: "Successful Response", ...contentJson(MedidaSnapshotResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const d = parseFecha(query.fecha);
    const meta = await fila<z.infer<typeof MedidaMetricaRef>>(c.env.DB_CONSAR, SQL_MEDIDA_SNAPSHOT_META, [query.metrica]);
    if (!meta) throw new ErrorHttp(404, `metrica=${repr(query.metrica)} no existe (consultar /metricas-sensibilidad)`);
    const filas_ = await filas<z.infer<typeof MedidaSnapshotRow>>(c.env.DB_CONSAR, SQL_MEDIDA_SNAPSHOT, [d, query.metrica]);
    if (filas_.length === 0) throw new ErrorHttp(404, `sin datos para fecha=${d} metrica=${query.metrica} (cobertura 2019-12 → 2025-06)`);
    const vals = filas_.map((f) => f.valor);
    return { fecha: d, metrica: meta, n_filas: filas_.length, valor_min: Math.min(...vals), valor_max: Math.max(...vals), filas: filas_, caveats: caveatsMedida(query.metrica) };
  }
}

// ---------------------------------------------------------------- 25. metricas-cuenta
const MetricaCuentaRow = z.object({ id: z.number().int(), slug: z.string(), columna_csv: z.string(), descripcion: z.string(), unidad: z.string(), desde_fecha: z.string(), orden_display: z.number().int(), notas: z.string().nullable() });
const MetricasCuentaResponse = z.object({ n: z.number().int(), metricas: z.array(MetricaCuentaRow), caveats: z.array(z.string()) });
const SQL_METRICAS_CUENTA = `SELECT id, slug, columna_csv, descripcion, unidad, desde_fecha, orden_display, notas FROM cat_metrica_cuenta ORDER BY orden_display`;

export class MetricasCuenta extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_metricas_cuenta_api_v1_consar_metricas_cuenta_get",
    summary: "Catálogo descubrible: 11 métricas operacionales de cuentas administradas",
    description: "Retorna las 11 métricas operacionales reportadas en dataset #05 (cuentas_inhabilitadas, total_cuentas_afores, trabajadores_imss/issste/registrados/asignados/independientes, etc.) con su unidad (count BIGINT) y desde_fecha (primera fecha empírica). Útil para clientes que descubren slugs antes de consultar /cuentas/serie, /cuentas/snapshot o /cuentas/sistema.",
    responses: { "200": { description: "Successful Response", ...contentJson(MetricasCuentaResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const metricas = await filas<z.infer<typeof MetricaCuentaRow>>(c.env.DB_CONSAR, SQL_METRICAS_CUENTA);
    return { n: metricas.length, metricas, caveats: [CAVEAT_CUENTA_BIGINT, CAVEAT_CUENTA_DESDE_FECHA, CAVEAT_CUENTA_NO_COMMERCIAL] };
  }
}

// ---------------------------------------------------------------- 26. cuentas/serie
const CuentaMetricaRef = z.object({ slug: z.string(), descripcion: z.string(), unidad: z.string(), desde_fecha: z.string() });
const CuentaPunto = z.object({ fecha: z.string(), valor: z.number().int() });
const CuentaSerieResponse = z.object({ afore: AforeRef, metrica: CuentaMetricaRef, n_puntos: z.number().int(), rango: SerieRango, serie: z.array(CuentaPunto), caveats: z.array(z.string()) });
type MetaCuenta = { afore_codigo: string; afore_nombre_corto: string; afore_tipo_pension: string; metrica_slug: string; metrica_descripcion: string; metrica_unidad: string; metrica_desde_fecha: string };
const SQL_CUENTA_SERIE_META = `
SELECT
    a.codigo            AS afore_codigo,
    a.nombre_corto      AS afore_nombre_corto,
    a.tipo_pension      AS afore_tipo_pension,
    m.slug              AS metrica_slug,
    m.descripcion       AS metrica_descripcion,
    m.unidad            AS metrica_unidad,
    m.desde_fecha       AS metrica_desde_fecha
FROM afores a, cat_metrica_cuenta m
WHERE a.codigo = ?1
  AND m.slug   = ?2`;
const SQL_CUENTA_SERIE = `
SELECT c.fecha, c.valor
FROM cuenta_administrada c
JOIN afores a              ON a.id = c.afore_id
JOIN cat_metrica_cuenta m  ON m.id = c.metrica_id
WHERE a.codigo = ?1
  AND m.slug   = ?2
ORDER BY c.fecha`;

export class CuentasSerie extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_cuenta_serie_api_v1_consar_cuentas_serie_get",
    summary: "Serie temporal: métrica de cuenta por (AFORE × MÉTRICA)",
    description: "Retorna serie mensual de una métrica operacional para una afore commercial. Cobertura por métrica (desde_fecha): 1997-12+ (core), 2001-06+ (asignados), 2012-01+ (subdivisiones bm/siefores), 2005-08+ (independientes/issste), 2024-09+ (cuentas_inhabilitadas reforma 2024). Para etiquetas no-commercial (total_sar, bienestar_010, prestadora_de_servicios) usar /cuentas/sistema.",
    request: { query: z.object({
      afore_codigo: z.string().describe("codigo en consar.afores (e.g. xxi_banorte, profuturo)"),
      metrica: z.string().describe("slug en consar.cat_metrica_cuenta (e.g. trabajadores_imss, total_cuentas_afores)"),
    }) },
    responses: { "200": { description: "Successful Response", ...contentJson(CuentaSerieResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const { afore_codigo, metrica } = query;
    const meta = await fila<MetaCuenta>(c.env.DB_CONSAR, SQL_CUENTA_SERIE_META, [afore_codigo, metrica]);
    if (!meta) throw new ErrorHttp(404, `afore_codigo=${repr(afore_codigo)} o metrica=${repr(metrica)} no existe (consultar /metricas-cuenta)`);
    const serie = await filas<{ fecha: string; valor: number }>(c.env.DB_CONSAR, SQL_CUENTA_SERIE, [afore_codigo, metrica]);
    if (serie.length === 0) throw new ErrorHttp(404, `sin datos para (${afore_codigo}, ${metrica}). Cobertura desde ${meta.metrica_desde_fecha} (ver desde_fecha en /metricas-cuenta). Algunas afores comerciales no operaron desde 1997 (e.g. azteca, coppel, invercap).`);
    const caveats = [CAVEAT_CUENTA_BIGINT, CAVEAT_CUENTA_DESDE_FECHA];
    if (metrica === "cuentas_inhabilitadas") caveats.push(CAVEAT_CUENTA_IDENTIDAD_SAR);
    return {
      afore: { codigo: meta.afore_codigo, nombre_corto: meta.afore_nombre_corto, tipo_pension: meta.afore_tipo_pension },
      metrica: { slug: meta.metrica_slug, descripcion: meta.metrica_descripcion, unidad: meta.metrica_unidad, desde_fecha: meta.metrica_desde_fecha },
      n_puntos: serie.length, rango: { desde: serie[0].fecha, hasta: serie[serie.length - 1].fecha }, serie, caveats,
    };
  }
}

// ---------------------------------------------------------------- 27. cuentas/snapshot
const CuentaSnapshotRow = z.object({ afore_codigo: z.string(), afore_nombre_corto: z.string(), metrica_slug: z.string(), metrica_descripcion: z.string(), valor: z.number().int() });
const CuentaSnapshotResponse = z.object({ fecha: z.string(), n_filas: z.number().int(), filas: z.array(CuentaSnapshotRow), caveats: z.array(z.string()) });
const SQL_CUENTA_SNAPSHOT = `
SELECT a.codigo            AS afore_codigo,
       a.nombre_corto      AS afore_nombre_corto,
       m.slug              AS metrica_slug,
       m.descripcion       AS metrica_descripcion,
       c.valor             AS valor
FROM cuenta_administrada c
JOIN afores a              ON a.id = c.afore_id
JOIN cat_metrica_cuenta m  ON m.id = c.metrica_id
WHERE c.fecha = ?1
ORDER BY m.orden_display, a.codigo`;

export class CuentasSnapshot extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_cuenta_snapshot_api_v1_consar_cuentas_snapshot_get",
    summary: "Snapshot mensual: matriz (AFORE × MÉTRICA) en una fecha",
    description: "Retorna para una fecha todas las tuplas (afore commercial, métrica) con su valor. Útil para dashboards comparativos de operación administrativa. Cobertura 1997-12 → 2025-06 (algunas afores no operaron desde 1997).",
    request: { query: z.object({ fecha: z.string().describe("YYYY-MM o YYYY-MM-01") }) },
    responses: { "200": { description: "Successful Response", ...contentJson(CuentaSnapshotResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const d = parseFecha(query.fecha);
    const filas_ = await filas<z.infer<typeof CuentaSnapshotRow>>(c.env.DB_CONSAR, SQL_CUENTA_SNAPSHOT, [d]);
    if (filas_.length === 0) throw new ErrorHttp(404, `sin datos para fecha=${d} (cobertura 1997-12 → 2025-06)`);
    return { fecha: d, n_filas: filas_.length, filas: filas_, caveats: [CAVEAT_CUENTA_BIGINT, CAVEAT_CUENTA_DESDE_FECHA, CAVEAT_CUENTA_NO_COMMERCIAL] };
  }
}

// ---------------------------------------------------------------- 28. cuentas/sistema
const CuentaSistemaEtiquetaRef = z.object({ slug: z.string(), nombre_display: z.string(), categoria: z.string() });
const CuentaSistemaPunto = z.object({ fecha: z.string(), etiqueta_slug: z.string(), etiqueta_categoria: z.string(), metrica_slug: z.string(), valor: z.number().int() });
const CuentaSistemaResponse = z.object({ n_puntos: z.number().int(), etiquetas: z.array(CuentaSistemaEtiquetaRef), metricas: z.array(CuentaMetricaRef), serie: z.array(CuentaSistemaPunto), caveats: z.array(z.string()) });
const SQL_CUENTA_SISTEMA_META = `SELECT slug, descripcion, unidad, desde_fecha FROM cat_metrica_cuenta WHERE slug = ?1`;
const SQL_CUENTA_SISTEMA_ETIQUETAS = `SELECT slug, nombre_display, categoria FROM cat_cuenta_etiqueta_agg ORDER BY id`;
const SQL_CUENTA_SISTEMA_SERIE = `
SELECT g.fecha,
       e.slug      AS etiqueta_slug,
       e.categoria AS etiqueta_categoria,
       m.slug      AS metrica_slug,
       g.valor
FROM cuenta_administrada_agg g
JOIN cat_cuenta_etiqueta_agg e ON e.id = g.etiqueta_id
JOIN cat_metrica_cuenta m      ON m.id = g.metrica_id
WHERE m.slug = ?1
ORDER BY g.fecha, e.id`;

export class CuentasSistema extends OpenAPIRoute {
  schema = {
    tags: ["consar"], operationId: "get_cuenta_sistema_api_v1_consar_cuentas_sistema_get",
    summary: "Serie sistema: 3 etiquetas no-commercial (total SAR + bienestar + prestadora)",
    description: "Retorna serie temporal de las 3 etiquetas no-commercial agrupadas: total_cuentas_sar (sistema_total), cuentas_bienestar_010 (sistema_categoria_especial), prestadora_de_servicios (administrativa_especial). Permite componer la identidad SAR triple-capa en frontend. Cada etiqueta reporta UNA métrica específica: total_cuentas_sar reporta total_cuentas_sar; cuentas_bienestar_010 reporta cuentas_bienestar_010; prestadora_de_servicios reporta cuentas_inhabilitadas.",
    request: { query: z.object({ metrica: z.string().describe("slug en consar.cat_metrica_cuenta (e.g. total_cuentas_sar, cuentas_bienestar_010, cuentas_inhabilitadas)") }) },
    responses: { "200": { description: "Successful Response", ...contentJson(CuentaSistemaResponse) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    const meta = await fila<z.infer<typeof CuentaMetricaRef>>(c.env.DB_CONSAR, SQL_CUENTA_SISTEMA_META, [query.metrica]);
    if (!meta) throw new ErrorHttp(404, `metrica=${repr(query.metrica)} no existe (consultar /metricas-cuenta)`);
    const etiquetas = await filas<z.infer<typeof CuentaSistemaEtiquetaRef>>(c.env.DB_CONSAR, SQL_CUENTA_SISTEMA_ETIQUETAS);
    const serie = await filas<z.infer<typeof CuentaSistemaPunto>>(c.env.DB_CONSAR, SQL_CUENTA_SISTEMA_SERIE, [query.metrica]);
    if (serie.length === 0) throw new ErrorHttp(404, `sin datos no-commercial para metrica=${query.metrica}. Solo 3 métricas tienen datos en /cuentas/sistema: total_cuentas_sar (sentinel SAR), cuentas_bienestar_010 (reforma 2024), cuentas_inhabilitadas (sólo prestadora reporta esta como agg).`);
    return { n_puntos: serie.length, etiquetas, metricas: [meta], serie, caveats: [CAVEAT_CUENTA_BIGINT, CAVEAT_CUENTA_NO_COMMERCIAL, CAVEAT_CUENTA_IDENTIDAD_SAR] };
  }
}

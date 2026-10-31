import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { SSN_FUENTE, SSN_RSS } from "./sonda";

const TAG = ["sismos"];
const Sismo = z.object({ origen_utc: z.string(), visto_en: z.string(), latencia_s: z.number().int(), magnitud: z.number().nullable(), lat: z.number().nullable(), lon: z.number().nullable(), profundidad_km: z.number().nullable(), lugar: z.string(), enlace: z.string().nullable() });

export class SismosRecientes extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "sismos_recientes", summary: "Sismos recientes del SSN con la latencia medida de su publicación",
    description: "Los sismos que el observatorio ha visto en el canal RSS de últimos sismos del SSN (UNAM), leído una vez por minuto, cada uno con el instante de origen según el SSN, el primer instante en que el observatorio lo vio y la latencia entre ambos. Es la sonda del Protocolo DPM para responder, con medida y no con suposición, si México tiene un dato público que llegue en segundos. `limit` 1-500; `desde` ISO opcional.",
    request: { query: z.object({ limit: z.number().int().min(1).max(500).default(100).optional(), desde: z.string().optional() }) },
    responses: { "200": { description: "Sismos y resumen de latencias.", ...contentJson(z.object({ fuente: z.string(), fuente_url: z.string(), lecturas: z.object({ cada_ms: z.number().int(), ultima: z.string().nullable(), ultima_correcta: z.string().nullable() }), latencia: z.object({ n: z.number().int(), mediana_s: z.number().nullable(), p90_s: z.number().nullable(), maxima_s: z.number().nullable(), desde: z.string().nullable() }), dpm: z.object({ sistema: z.string(), dato: z.string(), ficha: z.string() }), sismos: z.array(Sismo) })) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? 100) || 100)); const desde = c.req.query("desde") ?? "0000";
    const sismos = await filas<z.infer<typeof Sismo>>(c.env.DB_PLATAFORMA, "SELECT origen_utc, visto_en, latencia_s, magnitud, lat, lon, profundidad_km, lugar, enlace FROM sismos_ssn WHERE origen_utc >= ? ORDER BY origen_utc DESC LIMIT ?", [desde, limit]);
    const lat = (await filas<{ l: number }>(c.env.DB_PLATAFORMA, "SELECT latencia_s AS l FROM sismos_ssn ORDER BY latencia_s")).map((r) => r.l);
    // Solo cuentan los sismos vistos DESPUÉS de la primera lectura: los que ya estaban en el canal al arrancar la sonda traen latencia inflada.
    const primera = (await fila<{ t: string | null }>(c.env.DB_PLATAFORMA, "SELECT MIN(leido_en) AS t FROM sismos_lecturas WHERE ok = 1"))?.t ?? null;
    const medibles = primera ? (await filas<{ l: number }>(c.env.DB_PLATAFORMA, "SELECT latencia_s AS l FROM sismos_ssn WHERE origen_utc > ? ORDER BY latencia_s", [primera])).map((r) => r.l) : [];
    const q = (p: number) => (medibles.length ? medibles[Math.min(medibles.length - 1, Math.floor(p * (medibles.length - 1)))] : null);
    const ultima = (await fila<{ t: string | null }>(c.env.DB_PLATAFORMA, "SELECT MAX(leido_en) AS t FROM sismos_lecturas"))?.t ?? null;
    const ultimaOk = (await fila<{ t: string | null }>(c.env.DB_PLATAFORMA, "SELECT MAX(leido_en) AS t FROM sismos_lecturas WHERE ok = 1"))?.t ?? null;
    void lat;
    return { fuente: SSN_FUENTE, fuente_url: SSN_RSS, lecturas: { cada_ms: 60_000, ultima, ultima_correcta: ultimaOk }, latencia: { n: medibles.length, mediana_s: q(0.5), p90_s: q(0.9), maxima_s: medibles.length ? medibles[medibles.length - 1] : null, desde: primera }, dpm: { sistema: "datos-mexico", dato: "sismos-ssn", ficha: "https://api.datosmexico.org/dpm/v1/datos/datos-mexico/sismos-ssn" }, sismos };
  }
}
export class SismosComprobacion extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "sismos_comprobacion", summary: "Comprobación de cara pública de la sonda de sismos para el pulso DPM", responses: { "200": { description: "Última lectura y lecturas de la última hora.", ...contentJson(z.object({ ultimo_refresco: z.string().nullable(), refrescos_ultima_hora: z.number().int() })) }, ...RESP_429 } };
  async handle(c: AppContext) {
    const hace1h = new Date(Date.now() - 60 * 60_000).toISOString();
    const u = (await fila<{ t: string | null }>(c.env.DB_PLATAFORMA, "SELECT MAX(leido_en) AS t FROM sismos_lecturas"))?.t ?? null;
    const n = (await fila<{ n: number }>(c.env.DB_PLATAFORMA, "SELECT COUNT(*) AS n FROM sismos_lecturas WHERE leido_en >= ?", [hace1h]))?.n ?? 0;
    return { ultimo_refresco: u, refrescos_ultima_hora: n };
  }
}

import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { CLIMA_CADA_MIN, CLIMA_FUENTE, CLIMA_FUENTE_URL } from "./refresco";

const TAG = ["clima"];
type Fila = { clave: string; estado: string; capital: string; lat: number; lon: number; temperatura_c: number | null; humedad_pct: number | null; viento_kmh: number | null; codigo_tiempo: number | null; tiempo_fuente: string; intervalo_fuente_s: number | null; obtenido_en: string; verificado_en: string | null };
const Capital = z.object({ clave: z.string(), estado: z.string(), capital: z.string(), lat: z.number(), lon: z.number(), temperatura_c: z.number().nullable(), humedad_pct: z.number().nullable(), viento_kmh: z.number().nullable(), codigo_tiempo: z.number().int().nullable(), tiempo_fuente: z.string(), verificado_en: z.string().nullable() });

export class ClimaActual extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_actual", summary: "Clima actual de las 32 capitales estatales, custodiado por el observatorio",
    description: "Temperatura, humedad, viento y código de tiempo de cada capital, con el instante de la observación según la fuente. Fuente: Open-Meteo, que publica el estado actual cada 15 minutos; el observatorio lo refresca cada 5 minutos en un solo pedido y verifica cada respuesta (32 de 32, observación fechada en la última hora, coordenadas que coinciden). Es el dato `datos-mexico/clima-capitales` del Protocolo DPM: cada refresco se reporta al pulso y su clase la fija el reloj (con una fuente de 15 minutos queda fuera de clase, y así se publica).",
    responses: { "200": { description: "Clima actual.", ...contentJson(z.object({ fuente: z.string(), fuente_url: z.string(), relojes: z.object({ fuente_ms: z.number().int(), refresco_ms: z.number().int(), ultimo_refresco: z.string().nullable(), ultima_verificacion: z.string().nullable() }), dpm: z.object({ sistema: z.string(), dato: z.string(), ficha: z.string() }), capitales: z.array(Capital) })) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const capitales = await filas<Fila>(c.env.DB_PLATAFORMA, "SELECT * FROM clima_actual ORDER BY estado");
    const ultimo = (await fila<{ t: string | null }>(c.env.DB_PLATAFORMA, "SELECT MAX(obtenido_en) AS t FROM clima_actual"))?.t ?? null;
    const verif = (await fila<{ t: string | null }>(c.env.DB_PLATAFORMA, "SELECT MAX(verificado_en) AS t FROM clima_actual"))?.t ?? null;
    return {
      fuente: CLIMA_FUENTE, fuente_url: CLIMA_FUENTE_URL,
      relojes: { fuente_ms: 900_000, refresco_ms: CLIMA_CADA_MIN * 60_000, ultimo_refresco: ultimo, ultima_verificacion: verif },
      dpm: { sistema: "datos-mexico", dato: "clima-capitales", ficha: "https://api.datosmexico.org/dpm/v1/datos/datos-mexico/clima-capitales" },
      capitales: capitales.map(({ lat, lon, intervalo_fuente_s: _i, obtenido_en: _o, ...r }) => ({ ...r, lat, lon })),
    };
  }
}

/** Dirección pública de comprobación del dato datos-mexico/clima-capitales (protocolo 0.4 §8 bis). */
export class ClimaComprobacion extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "clima_comprobacion", summary: "Comprobación de cara pública del clima para el pulso DPM", description: "Responde cuándo fue el último refresco del clima y cuántos hubo en la última hora, leído de la bitácora de refrescos. Es la dirección que el pulso consulta por su cuenta cada diez minutos para cotejar lo reportado.", responses: { ...{ "200": { description: "Último refresco y refrescos de la última hora.", ...contentJson(z.object({ ultimo_refresco: z.string().nullable(), refrescos_ultima_hora: z.number().int() })) } }, ...RESP_429 } };
  async handle(c: AppContext) {
    const hace1h = new Date(Date.now() - 60 * 60_000).toISOString();
    const u = (await fila<{ t: string | null }>(c.env.DB_PLATAFORMA, "SELECT MAX(obtenido_en) AS t FROM clima_refrescos"))?.t ?? null;
    const n = (await fila<{ n: number }>(c.env.DB_PLATAFORMA, "SELECT COUNT(*) AS n FROM clima_refrescos WHERE obtenido_en >= ?", [hace1h]))?.n ?? 0;
    return { ultimo_refresco: u, refrescos_ultima_hora: n };
  }
}

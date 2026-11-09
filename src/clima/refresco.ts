// Pronóstico de modelo para las 32 capitales, custodiado por el observatorio y reportado al pulso del Protocolo DPM como el dato
// `datos-mexico/clima-capitales`. Fuente: Open-Meteo (https://open-meteo.com), un agregador de modelos numéricos que publica
// su estado actual cada 15 minutos (lo declara en cada respuesta: current.interval = 900). Es un MODELO, no una medición: desde
// noviembre de 2026 se llama pronóstico y se compara contra la medición oficial del SMN (sinoptica.ts); de ahí sale el
// indicador propio «error del modelo». Se pide en el punto exacto de cada observatorio, para que la comparación sea justa.
// Se refresca cada 5 minutos en un solo pedido; además de la hora en curso guarda el valor que da para la hora siguiente, que
// se congela al pasar la hora (clima_pronostico_hora). Con una fuente de 15 minutos el dato queda fuera de clase, y así se publica.
import type { Env } from "../index";
import { fila, filas } from "../lib/db";
import { ESTACIONES as CAPITALES } from "./estaciones";
import { difundir } from "./envivo";

export const CLIMA_CADA_MIN = 5;
export const CLIMA_FUENTE = "Open-Meteo";
export const CLIMA_FUENTE_URL = "https://open-meteo.com/";
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const DATO = "clima-capitales";
const SISTEMA = "datos-mexico";
const PULSO = "https://api.datosmexico.org/dpm/v1";

type Actual = { time: string; interval: number; temperature_2m: number | null; relative_humidity_2m: number | null; wind_speed_10m: number | null; weather_code: number | null; pressure_msl: number | null };
type Horaria = { time: string[]; temperature_2m: (number | null)[]; relative_humidity_2m: (number | null)[]; wind_speed_10m: (number | null)[]; pressure_msl: (number | null)[] };
type Respuesta = { latitude: number; longitude: number; current: Actual; hourly?: Horaria };
export type ResultadoClima = { refrescado: boolean; observaciones_nuevas: number; verificado: boolean; detalle: string; pulso?: string };

const iso = (d: Date | number) => new Date(d).toISOString();
const minutoIso = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000).toISOString();

/** Un refresco: un pedido para las 32 capitales, verificación, guardado y reporte al pulso. Nunca lanza. */
export async function refrescarClima(env: Env, ahora: Date, fetchImpl: typeof fetch = fetch): Promise<ResultadoClima> {
  const ahoraIso = iso(ahora);
  let detalle = "";
  try {
    const url = `${OPEN_METEO}?latitude=${CAPITALES.map((c) => c.lat).join(",")}&longitude=${CAPITALES.map((c) => c.lon).join(",")}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,pressure_msl&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,pressure_msl&forecast_hours=2&timezone=UTC`;
    const r = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`Open-Meteo respondió ${r.status}`);
    const cuerpo = (await r.json()) as Respuesta | Respuesta[];
    const lista = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
    // Verificación (al peso): 32 respuestas, cada una con observación fechada por la fuente dentro de los últimos 60 minutos,
    // y coordenadas que coinciden con lo pedido (Open-Meteo redondea a su malla; tolerancia de 0.2°).
    const problemas: string[] = [];
    if (lista.length !== CAPITALES.length) problemas.push(`${lista.length} respuestas de ${CAPITALES.length}`);
    lista.forEach((x, i) => {
      const c = CAPITALES[i]; if (!c) return;
      if (Math.abs(x.latitude - c.lat) > 0.2 || Math.abs(x.longitude - c.lon) > 0.2) problemas.push(`${c.capital}: coordenadas ${x.latitude},${x.longitude}`);
      const t = Date.parse(`${x.current?.time}Z`);
      if (!Number.isFinite(t) || ahora.getTime() - t > 60 * 60_000 || t - ahora.getTime() > 5 * 60_000) problemas.push(`${c.capital}: tiempo de la fuente ${x.current?.time}`);
      if (x.current?.interval !== 900) problemas.push(`${c.capital}: intervalo ${x.current?.interval}`);
    });
    const verificado = problemas.length === 0;
    detalle = verificado ? `32/32 observaciones de la fuente para ${lista[0]?.current?.time}Z` : problemas.slice(0, 3).join("; ");
    // Observaciones nuevas: capitales cuyo tiempo de la fuente cambió desde el refresco anterior.
    const previas = new Map((await filas<{ clave: string; tiempo_fuente: string }>(env.DB_PLATAFORMA, "SELECT clave, tiempo_fuente FROM clima_actual")).map((p) => [p.clave, p.tiempo_fuente]));
    let nuevas = 0;
    const stmts: D1PreparedStatement[] = [];
    lista.forEach((x, i) => {
      const c = CAPITALES[i]; if (!c || !x.current) return;
      const tf = `${x.current.time}:00.000Z`; // Open-Meteo entrega "AAAA-MM-DDTHH:MM" en UTC
      if (previas.get(c.clave) !== tf) nuevas++;
      stmts.push(env.DB_PLATAFORMA.prepare("INSERT INTO clima_actual (clave, estado, capital, lat, lon, temperatura_c, humedad_pct, viento_kmh, codigo_tiempo, tiempo_fuente, intervalo_fuente_s, obtenido_en, verificado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (clave) DO UPDATE SET temperatura_c = excluded.temperatura_c, humedad_pct = excluded.humedad_pct, viento_kmh = excluded.viento_kmh, codigo_tiempo = excluded.codigo_tiempo, tiempo_fuente = excluded.tiempo_fuente, intervalo_fuente_s = excluded.intervalo_fuente_s, obtenido_en = excluded.obtenido_en, verificado_en = COALESCE(excluded.verificado_en, clima_actual.verificado_en)")
        .bind(c.clave, c.estado, c.capital, c.lat, c.lon, x.current.temperature_2m, x.current.relative_humidity_2m, x.current.wind_speed_10m, x.current.weather_code, tf, x.current.interval ?? null, ahoraIso, verificado ? ahoraIso : null));
    });
    // Pronóstico para la hora siguiente (en punto), en m/s para compararlo con el SMN; se congela al pasar la hora.
    const siguiente = new Date(Math.floor(ahora.getTime() / 3600_000) * 3600_000 + 3600_000).toISOString().slice(0, 13) + ":00";
    lista.forEach((x, i) => {
      const c = CAPITALES[i]; const h = x.hourly; if (!c || !h) return;
      const k = h.time.indexOf(siguiente); if (k < 0) return;
      const v = h.wind_speed_10m[k];
      stmts.push(env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO clima_pronostico_hora (clave, hora, temperatura_c, humedad_pct, viento_ms, presion_mar_hpa, consultado_en) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(c.clave, `${siguiente}:00.000Z`, h.temperature_2m[k], h.relative_humidity_2m[k], v === null ? null : Math.round((v / 3.6) * 100) / 100, h.pressure_msl[k], ahoraIso));
    });
    stmts.push(env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO clima_refrescos (obtenido_en, observaciones_nuevas, verificado, detalle) VALUES (?, ?, ?, ?)").bind(ahoraIso, nuevas, verificado ? 1 : 0, detalle));
    stmts.push(env.DB_PLATAFORMA.prepare("DELETE FROM clima_refrescos WHERE obtenido_en < ?").bind(iso(ahora.getTime() - 30 * 86400_000)));
    const guardado = Date.now(); // el evento de la entrega: la lectura entra al observatorio
    await env.DB_PLATAFORMA.batch(stmts);
    // Entrega en vivo: solo cuando el modelo publicó un intervalo nuevo (cada 15 minutos), no en cada refresco.
    if (nuevas > 0) {
      const datos = lista.map((x, i) => ({ clave: CAPITALES[i]?.clave, tiempo_fuente: `${x.current.time}:00.000Z`, temperatura_c: x.current.temperature_2m, humedad_pct: x.current.relative_humidity_2m, viento_kmh: x.current.wind_speed_10m, codigo_tiempo: x.current.weather_code, presion_mar_hpa: x.current.pressure_msl, obtenido_en: ahoraIso })).filter((d): d is typeof d & { clave: string } => !!d.clave);
      await difundir(env, { tipo: "pronostico", evento_ms: guardado, datos });
    }
    const pulso = await reportarAlPulso(env, ahora, nuevas, verificado, fetchImpl);
    return { refrescado: true, observaciones_nuevas: nuevas, verificado, detalle, pulso };
  } catch (e) {
    const msg = String(e).slice(0, 200);
    try { await env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO clima_refrescos (obtenido_en, observaciones_nuevas, verificado, detalle) VALUES (?, 0, 0, ?)").bind(ahoraIso, `error: ${msg}`).run(); } catch { /* sin tabla aún */ }
    return { refrescado: false, observaciones_nuevas: 0, verificado: false, detalle: msg };
  }
}

/** El observatorio reporta su propio dato al pulso como cualquier otro sistema: con llave, por HTTP, sin atajos. */
async function reportarAlPulso(env: Env, ahora: Date, observaciones: number, verificado: boolean, fetchImpl: typeof fetch): Promise<string> {
  if (!env.DPM_LLAVE_DATOS_MEXICO) return "sin llave: no se reporta";
  const base = env.DPM_PULSO_URL ?? PULSO;
  const cab = { "content-type": "application/json", authorization: `Bearer ${env.DPM_LLAVE_DATOS_MEXICO}` };
  // Catálogo una vez por hora (idempotente): fuente por calendario de 15 minutos, custodiado, con el reloj de la verificación.
  if (ahora.getUTCMinutes() < CLIMA_CADA_MIN) await declararCatalogo(env, base, cab, fetchImpl);
  const cuerpo = JSON.stringify({ sistema: SISTEMA, resumenes: [{ dato: DATO, minuto: minutoIso(ahora), refrescos: 1, primero: iso(ahora), ultimo: iso(ahora), intervalo_max_ms: 0, observaciones: verificado ? observaciones : 0 }] });
  let r = await fetchImpl(`${base}/resumenes`, { method: "POST", headers: cab, body: cuerpo });
  if (r.status === 404) { await declararCatalogo(env, base, cab, fetchImpl); r = await fetchImpl(`${base}/resumenes`, { method: "POST", headers: cab, body: cuerpo }); }
  return `${r.status}`;
}
async function declararCatalogo(env: Env, base: string, cab: Record<string, string>, fetchImpl: typeof fetch): Promise<void> {
  const ultimaVerificacion = (await fila<{ t: string | null }>(env.DB_PLATAFORMA, "SELECT MAX(verificado_en) AS t FROM clima_actual"))?.t ?? null;
  await fetchImpl(`${base}/datos/${SISTEMA}/${DATO}`, { method: "PUT", headers: cab, body: JSON.stringify({ nombre: "Pronóstico de modelo para las 32 capitales (no es medición)", fuente: `${CLIMA_FUENTE} (agregador de modelos numéricos)`, fuente_tipo: "calendario", reloj_fuente_ms: 900_000, via: "consulta", url_comprobacion: "https://api.datosmexico.org/api/v1/clima/comprobacion", modo: "custodiado", ultima_verificacion: ultimaVerificacion }) }).catch(() => null);
}

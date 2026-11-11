// Pronóstico de modelo a 10 días para la ficha de cada capital (Open-Meteo, CC BY 4.0): días, horas con índice UV y código de
// tiempo. Es MODELO y así se publica; el pronóstico oficial del SMN (4 días) va aparte y manda en los días que cubre.
//
// Presupuesto: la versión gratuita de Open-Meteo admite 10,000 llamadas al día y el refresco de las 32 capitales cada 5 minutos
// ya usa ~9,216 (288 vueltas × 32 puntos). Por eso esta pieza no se refresca sola: se pide solo cuando alguien abre la ficha de
// una capital, se guarda y se sirve guardada durante una hora (si es más vieja, se sirve igual y se renueva detrás), con un
// tope de 400 llamadas ponderadas al día (Open-Meteo cuenta 1.4 por pedido de 14 variables). Con el tope agotado se sirve la
// última guardada y se dice su antigüedad: nunca se inventa.
import type { Env } from "../index";
import { fila } from "../lib/db";
import { ESTACIONES } from "./estaciones";
import { CAPITALES } from "./capitales";
import { ZONA } from "./normales";

export const MODELO_FICHA_FUENTE = "Open-Meteo (agregador de modelos numéricos, CC BY 4.0)";
const URL = "https://api.open-meteo.com/v1/forecast";
const HORARIAS = ["temperature_2m", "precipitation_probability", "weather_code", "uv_index", "wind_speed_10m", "wind_direction_10m"];
const DIARIAS = ["weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_probability_max", "precipitation_sum", "uv_index_max", "wind_speed_10m_max", "wind_direction_10m_dominant"];
export const MODELO_FICHA_PESO = (HORARIAS.length + DIARIAS.length) / 10; // regla de Open-Meteo: más de 10 variables cuentan fracción
export const MODELO_FICHA_TOPE_DIA = 400;
export const MODELO_FICHA_VIGENCIA_MS = 3600_000;

type Cuerpo = { latitude: number; longitude: number; timezone: string; utc_offset_seconds: number; hourly: Record<string, (number | string | null)[]>; daily: Record<string, (number | string | null)[]> };

async function pedir(env: Env, clave: string, ahora: number, fetchImpl: typeof fetch): Promise<"ok" | string> {
  const c = CAPITALES.find((x) => x.clave === clave)!;
  const fecha = new Date(ahora).toISOString().slice(0, 10);
  // Presupuesto y candado en un paso cada uno: si no hay saldo o alguien ya está pidiendo esta capital, no se pide.
  const saldo = await fila<{ llamadas: number }>(env.DB_PLATAFORMA, "SELECT llamadas FROM clima_presupuesto WHERE fecha = ? AND fuente = 'open-meteo-ficha'", [fecha]);
  if ((saldo?.llamadas ?? 0) + MODELO_FICHA_PESO > MODELO_FICHA_TOPE_DIA) return "tope diario agotado";
  const toma = await env.DB_PLATAFORMA.prepare("INSERT INTO clima_bloqueos (clave, hasta) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET hasta = excluded.hasta WHERE clima_bloqueos.hasta < ?").bind(`modelo-ficha-${clave}`, new Date(ahora + 60_000).toISOString(), new Date(ahora).toISOString()).run();
  if (!toma.meta.changes) return "otro pedido en curso";
  await env.DB_PLATAFORMA.prepare("INSERT INTO clima_presupuesto (fecha, fuente, llamadas) VALUES (?, 'open-meteo-ficha', ?) ON CONFLICT(fecha, fuente) DO UPDATE SET llamadas = llamadas + excluded.llamadas").bind(fecha, MODELO_FICHA_PESO).run();
  const url = `${URL}?latitude=${c.lat}&longitude=${c.lon}&hourly=${HORARIAS.join(",")}&daily=${DIARIAS.join(",")}&timezone=${encodeURIComponent(ZONA[clave])}&forecast_days=10&timeformat=unixtime`;
  const r = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!r.ok) return `Open-Meteo respondió ${r.status}`;
  const x = (await r.json()) as Cuerpo;
  // Verificación: el punto devuelto cae a 0.2° o menos del pedido, y vienen 10 días y 240 horas.
  if (Math.abs(x.latitude - c.lat) > 0.2 || Math.abs(x.longitude - c.lon) > 0.2) return `coordenadas ${x.latitude},${x.longitude}`;
  if ((x.daily?.time?.length ?? 0) !== 10 || (x.hourly?.time?.length ?? 0) !== 240) return `forma inesperada (${x.daily?.time?.length} días, ${x.hourly?.time?.length} horas)`;
  await env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO clima_modelo_ficha (clave, consultado_en, cuerpo) VALUES (?, ?, ?)").bind(clave, new Date(ahora).toISOString(), JSON.stringify(x)).run();
  return "ok";
}

/**
 * El modelo a 10 días de una capital. Sirve lo guardado; si no hay nada, pide y espera; si lo guardado tiene más de una hora,
 * lo sirve y renueva detrás (`renovar`, para ctx.waitUntil).
 */
export async function modeloFichaDe(env: Env, clave: string, ahora: number, fetchImpl: typeof fetch = fetch): Promise<{ datos: ReturnType<typeof forma> | null; estado: string; renovar: Promise<unknown> | null }> {
  if (!ESTACIONES.some((e) => e.clave === clave)) return { datos: null, estado: "sin capital", renovar: null };
  let g = await fila<{ consultado_en: string; cuerpo: string }>(env.DB_PLATAFORMA, "SELECT consultado_en, cuerpo FROM clima_modelo_ficha WHERE clave = ?", [clave]);
  let estado = "guardado";
  if (!g) {
    estado = await pedir(env, clave, ahora, fetchImpl).catch((e) => `error: ${String(e).slice(0, 120)}`);
    g = await fila<{ consultado_en: string; cuerpo: string }>(env.DB_PLATAFORMA, "SELECT consultado_en, cuerpo FROM clima_modelo_ficha WHERE clave = ?", [clave]);
    if (!g) return { datos: null, estado, renovar: null };
    return { datos: forma(JSON.parse(g.cuerpo) as Cuerpo, g.consultado_en, ahora), estado: estado === "ok" ? "recién pedido" : estado, renovar: null };
  }
  const viejo = ahora - Date.parse(g.consultado_en) > MODELO_FICHA_VIGENCIA_MS;
  return { datos: forma(JSON.parse(g.cuerpo) as Cuerpo, g.consultado_en, ahora), estado: viejo ? "guardado, renovándose" : estado, renovar: viejo ? pedir(env, clave, ahora, fetchImpl).catch(() => null) : null };
}

const r1 = (v: unknown) => (typeof v === "number" ? Math.round(v * 10) / 10 : null);
/** Respuesta compacta: los 10 días y, de las horas, las 48 desde la hora en curso (UV y código de tiempo para la ficha). */
function forma(x: Cuerpo, consultado: string, ahora: number) {
  const h = x.hourly, d = x.daily;
  const t0 = Math.floor(ahora / 3600_000) * 3600;
  const horas: Record<string, unknown>[] = [];
  (h.time as number[]).forEach((t, i) => {
    if (t < t0 || horas.length >= 48) return;
    horas.push({ hora: new Date(t * 1000).toISOString(), temperatura_c: r1(h.temperature_2m[i]), prob_lluvia_pct: h.precipitation_probability[i], codigo_tiempo: h.weather_code[i], uv: r1(h.uv_index[i]), viento_kmh: r1(h.wind_speed_10m[i]), viento_dir_grados: h.wind_direction_10m[i] });
  });
  const dias = (d.time as number[]).map((t, i) => ({
    // Open-Meteo agrega por día local (timezone de la capital); la fecha sale de su medianoche local.
    fecha: new Date((t + x.utc_offset_seconds) * 1000).toISOString().slice(0, 10),
    codigo_tiempo: d.weather_code[i], tmax_c: r1(d.temperature_2m_max[i]), tmin_c: r1(d.temperature_2m_min[i]),
    prob_lluvia_pct: d.precipitation_probability_max[i], lluvia_mm: r1(d.precipitation_sum[i]), uv_max: r1(d.uv_index_max[i]),
    viento_max_kmh: r1(d.wind_speed_10m_max[i]), viento_dir_grados: d.wind_direction_10m_dominant[i],
  }));
  return { fuente: MODELO_FICHA_FUENTE, papel: "pronostico_modelo", consultado_en: consultado, antiguedad_min: Math.round((ahora - Date.parse(consultado)) / 60_000), punto: { lat: x.latitude, lon: x.longitude }, zona: x.timezone, dias, horas,
    nota: "Modelo numérico, no medición ni pronóstico oficial. Códigos de tiempo WMO 4677 (los de Open-Meteo). Índice UV del modelo con nubes (escala de la OMS: 0–2 bajo, 3–5 moderado, 6–7 alto, 8–10 muy alto, 11+ extremo)." };
}

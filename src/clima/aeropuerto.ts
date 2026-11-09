// Testigo independiente: el METAR del aeropuerto de cada capital, que emite SENEAM (otra institución, otra red, otros
// instrumentos). Se lee de aviationweather.gov (NOAA, Aviation Weather Center) cada 5 minutos, en un solo pedido para todos
// los aeropuertos; en México el METAR es horario (minuto 40) más los especiales (SPECI). NOAA lo tiene unos 16 minutos
// después de la observación (mediana medida el 2026-11-09). Sirve para cotejar la medición oficial, no para sustituirla.
import type { Env } from "../index";
import { ESTACIONES } from "./estaciones";
import { difundir } from "./envivo";

export const AEROPUERTO_FUENTE = "METAR de SENEAM, vía aviationweather.gov (NOAA)";
const URL_AWC = "https://aviationweather.gov/api/data/metar";
const NUDO_MS = 0.514444, MILLA_M = 1609.344;
const iso = (d: Date | number) => new Date(d).toISOString();

type Metar = { icaoId: string; obsTime: number; metarType?: string; temp?: number | null; dewp?: number | null; altim?: number | null; wdir?: number | string | null; wspd?: number | null; wgst?: number | null; visib?: number | string | null; rawOb: string; receiptTime?: string };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function custodiarAeropuertos(env: Env, ahora: Date, fetchImpl: typeof fetch = fetch): Promise<{ nuevas: number; detalle: string }> {
  const icaos = [...new Set(ESTACIONES.map((e) => e.icao).filter((x): x is string => !!x))];
  try {
    // Al arrancar (sin historia de las últimas 20 h) se piden 26 horas, para que el repaso de la medición tenga testigo.
    const masVieja = (await env.DB_PLATAFORMA.prepare("SELECT MIN(instante) AS t FROM clima_aeropuerto").first<{ t: string | null }>())?.t ?? null;
    const horas = masVieja && Date.parse(masVieja) < ahora.getTime() - 20 * 3600_000 ? 3 : 26;
    const r = await fetchImpl(`${URL_AWC}?ids=${icaos.join(",")}&format=json&hours=${horas}`, { headers: { accept: "application/json", "user-agent": "datosmexico.org (observatorio; clima oficial)" } });
    if (!r.ok) throw new Error(`aviationweather.gov respondió ${r.status}`);
    const lista = (await r.json()) as Metar[];
    const llegado = new Date(); const llegadoIso = iso(llegado);
    const st = lista.filter((m) => icaos.includes(m.icaoId) && Number.isFinite(m.obsTime)).map((m) => {
      const visib = typeof m.visib === "number" ? Math.round(m.visib * MILLA_M) : null; // «6+» (sin cota superior) queda nulo
      return env.DB_PLATAFORMA.prepare("INSERT OR IGNORE INTO clima_aeropuerto (icao, instante, tipo, temperatura_c, rocio_c, qnh_hpa, viento_dir_grados, viento_ms, rafaga_ms, visibilidad_m, crudo, recibido_noaa, llegado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(m.icaoId, iso(m.obsTime * 1000), m.metarType === "SPECI" ? "SPECI" : "METAR", num(m.temp), num(m.dewp), num(m.altim), num(m.wdir), num(m.wspd) === null ? null : Math.round((m.wspd as number) * NUDO_MS * 10) / 10, num(m.wgst) === null ? null : Math.round((m.wgst as number) * NUDO_MS * 10) / 10, visib, m.rawOb, m.receiptTime ? iso(Date.parse(m.receiptTime)) : null, llegadoIso);
    });
    const res = st.length ? await env.DB_PLATAFORMA.batch(st) : [];
    const nuevasIdx = res.map((x, i) => (x.meta.changes > 0 ? i : -1)).filter((i) => i >= 0);
    const nuevas = lista.filter((m) => icaos.includes(m.icaoId) && Number.isFinite(m.obsTime)).filter((_, i) => nuevasIdx.includes(i));
    const detalle = `${nuevas.length} METAR nuevos de ${lista.length} recibidos`;
    await env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO clima_consultas (instante, fuente, pedidos, nuevas, detalle) VALUES (?, 'aeropuerto', 1, ?, ?)").bind(iso(Math.floor(ahora.getTime() / 60_000) * 60_000), nuevas.length, detalle).run();
    if (nuevas.length) {
      // A cada capital le toca el METAR más reciente de su aeropuerto (Puebla y Tlaxcala comparten el de Puebla).
      const ultimo = new Map<string, Metar>();
      for (const m of nuevas) { const u = ultimo.get(m.icaoId); if (!u || m.obsTime > u.obsTime) ultimo.set(m.icaoId, m); }
      const datos = ESTACIONES.filter((e) => e.icao && ultimo.has(e.icao)).map((e) => { const m = ultimo.get(e.icao as string) as Metar; return { clave: e.clave, icao: m.icaoId, instante: iso(m.obsTime * 1000), tipo: m.metarType === "SPECI" ? "SPECI" : "METAR", temperatura_c: num(m.temp), rocio_c: num(m.dewp), qnh_hpa: num(m.altim), viento_ms: num(m.wspd) === null ? null : Math.round((m.wspd as number) * NUDO_MS * 10) / 10, crudo: m.rawOb, llegado_en: llegadoIso }; });
      if (datos.length) await difundir(env, { tipo: "aeropuerto", evento_ms: llegado.getTime(), datos });
    }
    return { nuevas: nuevas.length, detalle };
  } catch (e) {
    const msg = String(e).slice(0, 200);
    try { await env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO clima_consultas (instante, fuente, pedidos, nuevas, detalle) VALUES (?, 'aeropuerto', 1, 0, ?)").bind(iso(Math.floor(ahora.getTime() / 60_000) * 60_000), `error: ${msg}`).run(); } catch { /* sin tabla */ }
    return { nuevas: 0, detalle: `error: ${msg}` };
  }
}

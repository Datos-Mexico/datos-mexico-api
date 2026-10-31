// Sonda de sismos del SSN (UNAM) para el Protocolo DPM: ¿existe un dato público mexicano que llegue en segundos?
// Cada minuto el observatorio lee el canal RSS de últimos sismos (http://www.ssn.unam.mx/rss/ultimos-sismos.xml), guarda cada
// sismo nuevo con el instante en que lo vio y mide la latencia de publicación (visto − origen). La respuesta la dará la medida,
// no la suposición: mientras no haya una semana de latencias, el dato `datos-mexico/sismos-ssn` se declara fuente por evento con
// latencia desconocida (null) y queda fuera de clase. Fuente: SSN, Instituto de Geofísica, UNAM. Un pedido por minuto.
import type { Env } from "../index";
import { fila, filas } from "../lib/db";

export const SSN_RSS = "http://www.ssn.unam.mx/rss/ultimos-sismos.xml";
export const SSN_FUENTE = "Servicio Sismológico Nacional (SSN), Instituto de Geofísica, UNAM";
const DATO = "sismos-ssn"; const SISTEMA = "datos-mexico"; const PULSO = "https://api.datosmexico.org/dpm/v1";
const OFFSET_MX_MS = 6 * 3600_000; // el SSN publica en hora de México (UTC-6 todo el año desde 2022)
const iso = (d: Date | number) => new Date(d).toISOString();
const minutoIso = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000).toISOString();

export type Sismo = { clave: string; origen_utc: string; magnitud: number | null; lat: number | null; lon: number | null; profundidad_km: number | null; lugar: string; enlace: string | null };
const num = (s: string | undefined) => { const n = Number(s); return s !== undefined && s !== "" && Number.isFinite(n) ? n : null; };
const limpiar = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&eacute;/g, "é").replace(/&aacute;/g, "á").replace(/&iacute;/g, "í").replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&ntilde;/g, "ñ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Lee los <item> del canal: título «M, lugar», descripción con Fecha (hora de México), Lat/Lon y Profundidad. Sin librerías. */
export function parsearRss(xml: string): Sismo[] {
  const out: Sismo[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const titulo = limpiar(/<title>([\s\S]*?)<\/title>/.exec(it)?.[1] ?? "");
    const desc = limpiar(/<description>([\s\S]*?)<\/description>/.exec(it)?.[1] ?? "");
    const enlace = limpiar(/<link>([\s\S]*?)<\/link>/.exec(it)?.[1] ?? "") || null;
    const f = /Fecha:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/.exec(desc);
    if (!f) continue;
    const origen = new Date(Date.parse(`${f[1]}T${f[2]}.000Z`) + OFFSET_MX_MS);
    const ll = /Lat\/Lon:\s*(-?[\d.]+)\s*\/\s*(-?[\d.]+)/.exec(desc);
    const lat = num(ll?.[1]) ?? num(/<geo:lat>([^<]*)<\/geo:lat>/.exec(it)?.[1]);
    const lon = num(ll?.[2]) ?? num(/<geo:long>([^<]*)<\/geo:long>/.exec(it)?.[1]);
    const prof = num(/Profundidad:\s*(-?[\d.]+)/.exec(desc)?.[1]);
    const t = /^([\d.]+),\s*(.+)$/.exec(titulo);
    const magnitud = num(t?.[1]); const lugar = (t?.[2] ?? titulo).trim();
    if (!Number.isFinite(origen.getTime())) continue;
    out.push({ clave: `${iso(origen)}|${lat ?? "?"}|${lon ?? "?"}`, origen_utc: iso(origen), magnitud, lat, lon, profundidad_km: prof, lugar, enlace });
  }
  return out;
}

export type ResultadoSonda = { ok: boolean; items: number; nuevos: number; detalle: string; pulso?: string };

/** Una lectura: canal → sismos nuevos con su latencia → reporte al pulso como refresco del minuto (eventos = nuevos). Nunca lanza. */
export async function leerSismos(env: Env, ahora: Date, fetchImpl: typeof fetch = fetch): Promise<ResultadoSonda> {
  const ahoraIso = iso(ahora);
  try {
    const r = await fetchImpl(SSN_RSS, { headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": "observatorio datosmexico.org (sonda DPM; un pedido por minuto)" } });
    if (!r.ok) throw new Error(`SSN respondió ${r.status}`);
    const sismos = parsearRss(await r.text());
    if (sismos.length === 0) throw new Error("canal sin sismos legibles");
    const claves = sismos.map((s) => s.clave);
    const existentes = new Set((await filas<{ clave: string }>(env.DB_PLATAFORMA, `SELECT clave FROM sismos_ssn WHERE clave IN (${claves.map(() => "?").join(",")})`, claves)).map((x) => x.clave));
    const nuevos = sismos.filter((s) => !existentes.has(s.clave));
    const stmts: D1PreparedStatement[] = nuevos.map((s) => env.DB_PLATAFORMA.prepare("INSERT OR IGNORE INTO sismos_ssn (clave, origen_utc, visto_en, latencia_s, magnitud, lat, lon, profundidad_km, lugar, enlace) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(s.clave, s.origen_utc, ahoraIso, Math.max(0, Math.round((ahora.getTime() - Date.parse(s.origen_utc)) / 1000)), s.magnitud, s.lat, s.lon, s.profundidad_km, s.lugar, s.enlace));
    const detalle = `${sismos.length} en el canal, ${nuevos.length} nuevos`;
    stmts.push(env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO sismos_lecturas (leido_en, items, nuevos, ok, detalle) VALUES (?, ?, ?, 1, ?)").bind(ahoraIso, sismos.length, nuevos.length, detalle));
    stmts.push(env.DB_PLATAFORMA.prepare("DELETE FROM sismos_lecturas WHERE leido_en < ?").bind(iso(ahora.getTime() - 30 * 86400_000)));
    await env.DB_PLATAFORMA.batch(stmts);
    const latMax = nuevos.length ? Math.max(...nuevos.map((s) => ahora.getTime() - Date.parse(s.origen_utc))) : null;
    const pulso = await reportar(env, ahora, nuevos.length, latMax, fetchImpl);
    return { ok: true, items: sismos.length, nuevos: nuevos.length, detalle, pulso };
  } catch (e) {
    const msg = String(e).slice(0, 200);
    try { await env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO sismos_lecturas (leido_en, items, nuevos, ok, detalle) VALUES (?, 0, 0, 0, ?)").bind(ahoraIso, `error: ${msg}`).run(); } catch { /* sin tabla aún */ }
    return { ok: false, items: 0, nuevos: 0, detalle: msg };
  }
}

async function reportar(env: Env, ahora: Date, eventos: number, latenciaMaxMs: number | null, fetchImpl: typeof fetch): Promise<string> {
  if (!env.DPM_LLAVE_DATOS_MEXICO) return "sin llave";
  const base = env.DPM_PULSO_URL ?? PULSO; const cab = { "content-type": "application/json", authorization: `Bearer ${env.DPM_LLAVE_DATOS_MEXICO}` };
  const resumen = { dato: DATO, minuto: minutoIso(ahora), refrescos: 1, primero: iso(ahora), ultimo: iso(ahora), intervalo_max_ms: 0, observaciones: eventos, ...(eventos > 0 && latenciaMaxMs !== null ? { eventos, latencia_fuente_max_ms: Math.max(0, Math.round(latenciaMaxMs)) } : {}) };
  const cuerpo = JSON.stringify({ sistema: SISTEMA, resumenes: [resumen] });
  let r = await fetchImpl(`${base}/resumenes`, { method: "POST", headers: cab, body: cuerpo });
  if (r.status === 404 || ahora.getUTCMinutes() === 7) { await declarar(env, base, cab, fetchImpl); if (r.status === 404) r = await fetchImpl(`${base}/resumenes`, { method: "POST", headers: cab, body: cuerpo }); }
  return `${r.status}`;
}
async function declarar(env: Env, base: string, cab: Record<string, string>, fetchImpl: typeof fetch): Promise<void> {
  const ultimaOk = (await fila<{ t: string | null }>(env.DB_PLATAFORMA, "SELECT MAX(leido_en) AS t FROM sismos_lecturas WHERE ok = 1"))?.t ?? null;
  await fetchImpl(`${base}/datos/${SISTEMA}/${DATO}`, { method: "PUT", headers: cab, body: JSON.stringify({ nombre: "Sismos recientes del Servicio Sismológico Nacional", fuente: SSN_FUENTE, fuente_tipo: "evento", latencia_fuente_ms: null, via: "consulta", url_comprobacion: "https://api.datosmexico.org/api/v1/sismos/comprobacion", modo: "custodiado", ultima_verificacion: ultimaOk }) }).catch(() => null);
}

// Medición oficial: la observación sinóptica horaria del observatorio del SMN de cada capital. El SMN la publica en WIS2, el
// sistema de información de la OMM en dos lotes, a H+11 y a H+27 (medido el 2026-11-09 con el Last-Modified de 24 h del caché:
// mediana 11.2 min, segundo lote 27.1-27.2 min; Monterrey y Mexicali suelen ir en el segundo); los cachés globales de la OMM
// la sirven por HTTP en una dirección determinista durante 24 horas. Desde el minuto 8 de cada hora el observatorio pregunta
// por la hora en curso hasta tener las 32; lo que llega se decodifica (BUFR), se verifica, se guarda con su archivo original
// y se empuja a las páginas abiertas. Lo que no llega se dice: el lote de cada hora registra cuáles faltan.
// Por qué no las estaciones automáticas (EMAs) de 10 minutos: el portal de CONAGUA no publica datos de ninguna (730 de 730 en
// error al 2026-11-09). Una sonda diaria lo vigila (emas.ts); si vuelve, la medición migra.
import type { Env } from "../index";
import { fila, filas } from "../lib/db";
import { decodificarBufr } from "./bufr";
import { ESTACIONES, type EstacionCapital } from "./estaciones";
import { extraerSinoptica, type ObsSinoptica } from "./sinoptica-extraer";
import { cotejarTestigo, diferenciaTestigo, verificarMedicion, TESTIGO_VENTANA_MS, type Marca, type Previa } from "./verificacion";
import { difundir } from "./envivo";

export const SINOPTICA_FUENTE = "Servicio Meteorológico Nacional (CONAGUA), red sinóptica de observatorios, publicada en WIS2 de la OMM";
export const SINOPTICA_RELOJ_MS = 3_600_000;
/** Cachés globales de WIS2, en orden: el de NOAA (AWS) y, si falla la red, el de DWD (Alemania). */
const CACHES = [
  (archivo: string) => `https://wis2globalcache.s3.amazonaws.com/data/mx-smn/data/core/weather/surface-based-observations/synop/${archivo}`,
  (archivo: string) => `https://wis2.dwd.de/gc_v2/mx-smn/${archivo}`,
];
const PRIMER_MINUTO = 8;
const REPASOS = [20, 28, 45];
/** Repaso de historia: al minuto 50, las horas de H−23 a H−3 que falten (los cachés guardan 24 h), con tope por vuelta. */
const MINUTO_REPASO = 50, REPASO_TOPE = 96, REPASO_MAX = 2;

const iso = (d: Date | number) => new Date(d).toISOString();
const horaDe = (ms: number) => Math.floor(ms / 3600_000) * 3600_000;
const archivoDe = (wmo: string, horaMs: number) => `WIGOS_0-20000-0-${wmo}_${iso(horaMs).slice(0, 13).replace(/-/g, "")}0000.bufr4`;

export type ResultadoSinoptica = { consultas: number; nuevas: number; marcadas: number; horas: string[]; detalle: string };

async function sha256(b: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function base64(b: Uint8Array): string { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); }

/** Qué preguntar en este minuto: la hora en curso desde el minuto 8, y repasos de las dos horas anteriores. */
export function planDeConsultas(ahora: Date, faltantes: (horaMs: number) => EstacionCapital[], recibidas: (horaMs: number) => number): { horaMs: number; estaciones: EstacionCapital[]; centinela: boolean }[] {
  const m = ahora.getUTCMinutes(), h = horaDe(ahora.getTime());
  const plan: { horaMs: number; estaciones: EstacionCapital[]; centinela: boolean }[] = [];
  if (m >= PRIMER_MINUTO) {
    const f = faltantes(h);
    if (f.length) {
      // Sin nada de la hora todavía: una estación por minuto como centinela (rotando, para que una ausente no bloquee).
      // Repasos: 20 (rezagos del primer lote), 28 (segundo lote del SMN, a H+27) y 45.
      if (recibidas(h) === 0 && !REPASOS.includes(m)) plan.push({ horaMs: h, estaciones: [f[m % f.length]], centinela: true });
      else if (recibidas(h) === 0 || REPASOS.includes(m)) plan.push({ horaMs: h, estaciones: f, centinela: false });
    }
  }
  if (m === 5 || m === 20) { const f = faltantes(h - 3600_000); if (f.length) plan.push({ horaMs: h - 3600_000, estaciones: f, centinela: false }); }
  if (m === 35) { const f = faltantes(h - 2 * 3600_000); if (f.length) plan.push({ horaMs: h - 2 * 3600_000, estaciones: f, centinela: false }); }
  return plan;
}

type Bajada = { estado: "ok"; bytes: Uint8Array; url: string; publicado: string | null } | { estado: "aun-no" } | { estado: "error"; detalle: string };
async function bajar(archivo: string, fetchImpl: typeof fetch): Promise<Bajada> {
  let ultimo = "", ausente = 0;
  for (const cache of CACHES) {
    const url = cache(archivo);
    try {
      const r = await fetchImpl(url, { headers: { "user-agent": "datosmexico.org (observatorio; clima oficial)" } });
      if (r.status === 404 || r.status === 403) { ausente++; continue; } // S3 responde 403 a lo que no existe; se pregunta al otro caché
      if (!r.ok) { ultimo = `${url}: HTTP ${r.status}`; continue; }
      const lm = r.headers.get("last-modified");
      return { estado: "ok", bytes: new Uint8Array(await r.arrayBuffer()), url, publicado: lm && Number.isFinite(Date.parse(lm)) ? iso(Date.parse(lm)) : null };
    } catch (e) { ultimo = `${url}: ${String(e).slice(0, 120)}`; }
  }
  return ausente ? { estado: "aun-no" } : { estado: "error", detalle: ultimo };
}

type Lectura = { e: EstacionCapital; o: ObsSinoptica; marcas: Marca[]; bytes: Uint8Array; url: string; publicado: string | null; testigo: { icao: string; instante: string; dif: number; tipica: number } | null };

/** Un ciclo de custodia de la medición oficial. Nunca lanza. */
export async function custodiarSinoptica(env: Env, ahora: Date, fetchImpl: typeof fetch = fetch): Promise<ResultadoSinoptica> {
  try {
    const repaso = ahora.getUTCMinutes() === MINUTO_REPASO;
    const h0 = horaDe(ahora.getTime());
    const desde = iso(h0 - (repaso ? 23 : 2) * 3600_000);
    const tenidas = await filas<{ clave: string; instante: string }>(env.DB_PLATAFORMA, "SELECT clave, instante FROM clima_medicion WHERE instante >= ?", [desde]);
    const tiene = new Set(tenidas.map((t) => `${t.clave}|${t.instante}`));
    const faltantes = (h: number) => ESTACIONES.filter((e) => !tiene.has(`${e.clave}|${iso(h)}`));
    const recibidas = (h: number) => ESTACIONES.length - faltantes(h).length;
    const plan = planDeConsultas(ahora, faltantes, recibidas);
    const repasadas = new Set<string>();
    if (repaso) {
      const lotes = new Map((await filas<{ hora: string; recibidas: number; repasos: number }>(env.DB_PLATAFORMA, "SELECT hora, recibidas, repasos FROM clima_lotes WHERE hora >= ?", [desde])).map((l) => [l.hora, l]));
      let tope = REPASO_TOPE;
      for (let k = 23; k >= 3 && tope > 0; k--) {
        const h = h0 - k * 3600_000, l = lotes.get(iso(h));
        if (l && (l.recibidas >= ESTACIONES.length || l.repasos >= REPASO_MAX)) continue;
        const f = faltantes(h).slice(0, tope);
        if (!f.length) continue;
        plan.push({ horaMs: h, estaciones: f, centinela: false }); repasadas.add(iso(h)); tope -= f.length;
      }
    }
    if (!plan.length) return { consultas: 0, nuevas: 0, marcadas: 0, horas: [], detalle: "nada que consultar en este minuto" };
    let consultas = 0; const errores: string[] = []; const lecturas: Lectura[] = [];
    plan.sort((a, b) => a.horaMs - b.horaMs);
    for (const p of plan) {
      let lista = p.estaciones;
      for (let vuelta = 0; vuelta < 2 && lista.length; vuelta++) {
        const res = await Promise.all(lista.map(async (e) => ({ e, b: await bajar(archivoDe(e.wmo, p.horaMs), fetchImpl) })));
        consultas += lista.length;
        let llego = false;
        for (const { e, b } of res) {
          if (b.estado === "error") { errores.push(`${e.wmo}: ${b.detalle}`); continue; }
          if (b.estado === "aun-no") continue;
          llego = true;
          try {
            const o = extraerSinoptica(decodificarBufr(b.bytes));
            // Identidad: el archivo debe ser de la estación y la hora pedidas.
            if (o.wmo !== e.wmo || o.instante !== iso(p.horaMs)) { errores.push(`${archivoDe(e.wmo, p.horaMs)} trae ${o.wmo} ${o.instante}`); continue; }
            lecturas.push({ e, o, marcas: [], bytes: b.bytes, url: b.url, publicado: b.publicado, testigo: null });
          } catch (x) { errores.push(`${e.wmo}: ${String(x).slice(0, 160)}`); }
        }
        // El centinela llegó: el lote ya está publicado, se piden de una vez las demás.
        lista = p.centinela && llego ? faltantes(p.horaMs).filter((e) => !lecturas.some((l) => l.e.clave === e.clave && l.o.instante === iso(p.horaMs))) : [];
      }
    }
    // Verificación: rangos, lectura anterior y testigo.
    lecturas.sort((a, b) => a.o.instante.localeCompare(b.o.instante));
    for (const l of lecturas) {
      // La lectura anterior puede estar en la base o haber llegado en esta misma vuelta (repasos de varias horas).
      const enBase = await fila<Previa>(env.DB_PLATAFORMA, "SELECT instante, temperatura_c, rocio_c, humedad_pct, presion_mar_hpa FROM clima_medicion WHERE clave = ? AND instante < ? ORDER BY instante DESC LIMIT 1", [l.e.clave, l.o.instante]);
      const enVuelta = lecturas.filter((x) => x.e.clave === l.e.clave && x.o.instante < l.o.instante).at(-1)?.o ?? null;
      const previa = enVuelta && (!enBase || enVuelta.instante > enBase.instante) ? enVuelta : enBase;
      l.marcas = verificarMedicion(l.o, l.e, previa);
      if (l.e.icao) {
        const t = Date.parse(l.o.instante);
        const metar = await fila<{ icao: string; instante: string; temperatura_c: number | null }>(env.DB_PLATAFORMA, "SELECT icao, instante, temperatura_c FROM clima_aeropuerto WHERE icao = ? AND instante BETWEEN ? AND ? AND temperatura_c IS NOT NULL ORDER BY ABS(julianday(instante) - julianday(?)) LIMIT 1", [l.e.icao, iso(t - TESTIGO_VENTANA_MS), iso(t + TESTIGO_VENTANA_MS), l.o.instante]);
        const dif = metar ? diferenciaTestigo(l.o, l.e, metar) : null;
        if (metar && dif !== null) {
          const hist = (await filas<{ d: number }>(env.DB_PLATAFORMA, "SELECT testigo_dif_c AS d FROM clima_medicion WHERE clave = ? AND testigo_dif_c IS NOT NULL AND instante >= ? AND instante < ?", [l.e.clave, iso(t - 30 * 86400_000), l.o.instante])).map((x) => x.d);
          const { cotejo, marca } = cotejarTestigo(dif, hist, metar.icao, metar.instante);
          if (marca) l.marcas.push(marca);
          l.testigo = { icao: cotejo.icao, instante: cotejo.instante, dif: cotejo.dif_c, tipica: cotejo.tipica_c };
        }
      }
    }
    const llegado = new Date(); const llegadoIso = iso(llegado);
    const st: D1PreparedStatement[] = [];
    for (const l of lecturas) {
      const o = l.o;
      st.push(env.DB_PLATAFORMA.prepare("INSERT OR IGNORE INTO clima_medicion (clave, instante, wmo, temperatura_c, rocio_c, humedad_pct, presion_estacion_hpa, presion_mar_hpa, viento_dir_grados, viento_ms, viento_periodo_min, rafaga_ms, lluvia_1h_mm, lluvia_24h_mm, visibilidad_m, nubosidad_pct, publicado_en, llegado_en, fuente_url, sha256, bufr_b64, marcas, testigo_icao, testigo_instante, testigo_dif_c, testigo_tipica_c) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(l.e.clave, o.instante, o.wmo, o.temperatura_c, o.rocio_c, o.humedad_pct, o.presion_estacion_hpa, o.presion_mar_hpa, o.viento_dir_grados, o.viento_ms, o.viento_periodo_min, o.rafaga_ms, o.lluvia_1h_mm, o.lluvia_24h_mm, o.visibilidad_m, o.nubosidad_pct, l.publicado, llegadoIso, l.url, await sha256(l.bytes), base64(l.bytes), JSON.stringify(l.marcas), l.testigo?.icao ?? null, l.testigo?.instante ?? null, l.testigo?.dif ?? null, l.testigo?.tipica ?? null));
      // Error del modelo: el pronóstico congelado para esa hora contra lo medido.
      st.push(env.DB_PLATAFORMA.prepare("INSERT OR IGNORE INTO clima_error_modelo (clave, hora, temperatura_medida_c, temperatura_modelo_c, error_temperatura_c, humedad_medida_pct, humedad_modelo_pct, error_humedad_pct, viento_medido_ms, viento_modelo_ms, error_viento_ms) SELECT ?, hora, ?, temperatura_c, ROUND(temperatura_c - ?, 2), ?, humedad_pct, humedad_pct - ?, ?, viento_ms, ROUND(viento_ms - ?, 2) FROM clima_pronostico_hora WHERE clave = ? AND hora = ?")
        .bind(l.e.clave, o.temperatura_c, o.temperatura_c, o.humedad_pct, o.humedad_pct, o.viento_ms, o.viento_ms, l.e.clave, o.instante));
    }
    const horas = [...new Set(plan.map((p) => iso(p.horaMs)))];
    for (const h of horas) {
      const hMs = Date.parse(h);
      const nuevasH = lecturas.filter((l) => l.o.instante === h);
      const falt = faltantes(hMs).filter((e) => !nuevasH.some((l) => l.e.clave === e.clave)).map((e) => e.clave);
      const rep = repasadas.has(h) ? 1 : 0;
      st.push(env.DB_PLATAFORMA.prepare("INSERT INTO clima_lotes (hora, recibidas, marcadas, faltan, primera_llegada, ultima_llegada, consultas, actualizado_en, repasos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (hora) DO UPDATE SET recibidas = excluded.recibidas, marcadas = clima_lotes.marcadas + ?, faltan = excluded.faltan, primera_llegada = COALESCE(clima_lotes.primera_llegada, excluded.primera_llegada), ultima_llegada = COALESCE(excluded.ultima_llegada, clima_lotes.ultima_llegada), consultas = clima_lotes.consultas + excluded.consultas, actualizado_en = excluded.actualizado_en, repasos = clima_lotes.repasos + ?")
        .bind(h, ESTACIONES.length - falt.length, nuevasH.filter((l) => l.marcas.length).length, JSON.stringify(falt), nuevasH.length ? llegadoIso : null, nuevasH.length ? llegadoIso : null, plan.filter((p) => iso(p.horaMs) === h).reduce((a, p) => a + p.estaciones.length, 0), llegadoIso, rep, nuevasH.filter((l) => l.marcas.length).length, rep));
    }
    const marcadas = lecturas.filter((l) => l.marcas.length).length;
    const detalle = `${lecturas.length} nuevas (${marcadas} marcadas) de ${consultas} consultas${errores.length ? `; errores: ${errores.slice(0, 3).join("; ")}` : ""}`;
    st.push(env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO clima_consultas (instante, fuente, pedidos, nuevas, detalle) VALUES (?, 'sinoptica', ?, ?, ?)").bind(iso(Math.floor(ahora.getTime() / 60_000) * 60_000), consultas, lecturas.length, detalle));
    await env.DB_PLATAFORMA.batch(st);
    if (lecturas.length) {
      const datos = lecturas.map((l) => ({ clave: l.e.clave, instante: l.o.instante, temperatura_c: l.o.temperatura_c, humedad_pct: l.o.humedad_pct, rocio_c: l.o.rocio_c, presion_mar_hpa: l.o.presion_mar_hpa, viento_ms: l.o.viento_ms, viento_dir_grados: l.o.viento_dir_grados, rafaga_ms: l.o.rafaga_ms, lluvia_1h_mm: l.o.lluvia_1h_mm, nubosidad_pct: l.o.nubosidad_pct, publicado_en: l.publicado, llegado_en: llegadoIso, marcas: l.marcas }));
      await difundir(env, { tipo: "medicion", evento_ms: llegado.getTime(), datos });
    }
    return { consultas, nuevas: lecturas.length, marcadas, horas, detalle };
  } catch (e) {
    return { consultas: 0, nuevas: 0, marcadas: 0, horas: [], detalle: `error: ${String(e).slice(0, 200)}` };
  }
}

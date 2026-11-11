// Pronóstico oficial del SMN por municipio para las 32 capitales: el que el SMN publica en su servicio web
// (smn.conagua.gob.mx/tools/GUI/webservices/: method=1, diario a 4 días; method=3, horario a ~116 horas), JSON comprimido con
// gzip para los ~2,460 municipios. Se guarda cada emisión completa de las 32 capitales, sin reemplazar ninguna: así, además
// de mostrar el pronóstico vigente, se podrá medir qué tanto acierta el SMN a cada anticipación contra su propia medición.
//
// Medido el 11 de noviembre de 2026 (y declarado):
// - El archivo cambia una vez al día: la emisión del 10-nov tiene cabecera gzip de las 12:30 UTC y su primera hora es la de las
//   00 UTC (corrida de las 00 UTC, publicada ~12.5 h después). El sitio del SMN dice «actualizada cada hora 15 minutos»: se
//   revisa cada hora, y solo se descarga cuando cambia el tamaño o pasan 26 h.
// - `hloc` NO es la hora local de cada municipio: es la hora del centro (UTC−6) para todos (Mexicali, Chetumal y la Ciudad de
//   México empiezan en el mismo 20261109T18). El campo `dh` está desfasado en varias entidades (Chihuahua y Mexicali dicen 7).
//   Por eso: hora UTC = hloc + 6 h, para todos.
// - Unidades (documentación del servicio): temperatura °C, viento y rachas km/h, precipitación l/m² (= mm), nubes %.
import type { Env } from "../index";
import { fila, filas } from "../lib/db";
import { MUNICIPIOS_SMN } from "./municipios-smn";

export const SMN_PRONOSTICO_FUENTE = "Servicio Meteorológico Nacional (CONAGUA), Pronóstico por municipios (servicio web)";
const URL = (metodo: number) => `https://smn.conagua.gob.mx/tools/GUI/webservices/?method=${metodo}`;
const AGENTE = { "user-agent": "Mozilla/5.0 (compatible; datosmexico.org observatorio)" };
const POR_MUN = new Map(MUNICIPIOS_SMN.map((m) => [`${m.ides}|${m.idmun}`, m.clave]));
const HORA_CENTRO_UTC = 6;

const num = (v: unknown): number | null => { const x = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN; return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; };
const lit = (v: number | string | null): string => (v === null ? "NULL" : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "NULL") : `'${v.replace(/'/g, "''").slice(0, 60)}'`);
const horaUtc = (hloc: string) => { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})$/.exec(hloc); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + HORA_CENTRO_UTC)).toISOString() : null; };
const fechaDia = (dloc: string) => { const m = /^(\d{4})(\d{2})(\d{2})T/.exec(dloc); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

/** Hora de emisión del archivo: la marca de tiempo de la cabecera gzip (bytes 4–7, segundos Unix, little endian). */
export function emisionGzip(b: Uint8Array): string | null {
  if (b.length < 10 || b[0] !== 0x1f || b[1] !== 0x8b) return null;
  const s = (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0;
  return s > 1.6e9 ? new Date(s * 1000).toISOString() : null;
}

/** Recorre el JSON (arreglo de objetos planos) sin cargarlo entero: el horario pesa ~104 MB descomprimido. */
async function recorrer(gz: Uint8Array, cada: (obj: string) => void): Promise<number> {
  const lector = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip")).pipeThrough(new TextDecoderStream()).getReader();
  let resto = "", n = 0;
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    let buf = resto + value, i = buf.indexOf("{");
    while (i >= 0) {
      const j = buf.indexOf("}", i);
      if (j < 0) break;
      cada(buf.slice(i, j + 1)); n++;
      i = buf.indexOf("{", j);
    }
    resto = i >= 0 ? buf.slice(i) : "";
    buf = "";
  }
  return n;
}
const RE_IDES = /"ides":\s*"(\d+)"/, RE_IDMUN = /"idmun":\s*"(\d+)"/;
const claveDe = (o: string) => { const a = RE_IDES.exec(o), b = RE_IDMUN.exec(o); return a && b ? POR_MUN.get(`${+a[1]}|${+b[1]}`) ?? null : null; };

type Resultado = { tipo: "dia" | "hora"; estado: string; emision?: string; registros?: number; capitales?: number };

async function sha256(b: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function bajarSiCambio(env: Env, tipo: "dia" | "hora", metodo: number, ahora: Date, fetchImpl: typeof fetch): Promise<{ gz: Uint8Array; emision: string } | string> {
  const ultima = await fila<{ emision: string; bytes: number; descargado_en: string }>(env.DB_PLATAFORMA, "SELECT emision, bytes, descargado_en FROM clima_smn_emision WHERE tipo = ? ORDER BY emision DESC LIMIT 1", [tipo]);
  if (ultima) {
    const h = await fetchImpl(URL(metodo), { method: "HEAD", headers: AGENTE });
    const largo = Number(h.headers.get("content-length"));
    const vieja = ahora.getTime() - Date.parse(ultima.emision) > 26 * 3600_000;
    if (h.ok && largo === ultima.bytes && !vieja) return "sin cambio";
  }
  const r = await fetchImpl(URL(metodo), { headers: AGENTE });
  if (!r.ok) return `el SMN respondió ${r.status}`;
  const gz = new Uint8Array(await r.arrayBuffer());
  const emision = emisionGzip(gz);
  if (!emision) return "el archivo no es gzip o no trae fecha";
  if (ultima && ultima.emision === emision) {
    await env.DB_PLATAFORMA.prepare("UPDATE clima_smn_emision SET bytes = ? WHERE tipo = ? AND emision = ?").bind(gz.length, tipo, emision).run();
    return "misma emisión";
  }
  return { gz, emision };
}

/** Una vuelta: revisa las dos series y guarda lo nuevo. Nunca lanza. */
export async function actualizarPronosticoSmn(env: Env, ahora: Date, fetchImpl: typeof fetch = fetch): Promise<Resultado[]> {
  const out: Resultado[] = [];
  for (const [tipo, metodo] of [["dia", 1], ["hora", 3]] as const) {
    try {
      const b = await bajarSiCambio(env, tipo, metodo, ahora, fetchImpl);
      if (typeof b === "string") { out.push({ tipo, estado: b }); continue; }
      const filasSql: string[] = [];
      const vistas = new Set<string>();
      let inicio: string | null = null, fin: string | null = null;
      const total = await recorrer(b.gz, (o) => {
        const clave = claveDe(o); if (!clave) return;
        const x = JSON.parse(o) as Record<string, string>;
        vistas.add(clave);
        if (tipo === "dia") {
          const f = fechaDia(x.dloc); if (!f) return;
          if (!inicio || f < inicio) inicio = f; if (!fin || f > fin) fin = f;
          filasSql.push(`(${lit(clave)}, ${lit(f)}, ${lit(b.emision)}, ${lit(num(x.tmax))}, ${lit(num(x.tmin))}, ${lit(num(x.probprec))}, ${lit(num(x.prec))}, ${lit(num(x.velvien))}, ${lit(num(x.raf))}, ${lit(num(x.dirvieng))}, ${lit(num(x.cc))}, ${lit(x.desciel ?? null)})`);
        } else {
          const h = horaUtc(x.hloc); if (!h) return;
          if (!inicio || h < inicio) inicio = h; if (!fin || h > fin) fin = h;
          filasSql.push(`(${lit(clave)}, ${lit(h)}, ${lit(b.emision)}, ${lit(num(x.temp))}, ${lit(num(x.dpt))}, ${lit(num(x.hr))}, ${lit(num(x.probprec))}, ${lit(num(x.prec))}, ${lit(num(x.velvien))}, ${lit(num(x.raf))}, ${lit(num(x.dirvieng))}, ${lit(x.desciel ?? null)})`);
        }
      });
      const cols = tipo === "dia" ? "clave, fecha, emision, tmax_c, tmin_c, prob_lluvia_pct, lluvia_mm, viento_kmh, rafaga_kmh, viento_dir_grados, nubes_pct, cielo"
        : "clave, hora, emision, temperatura_c, rocio_c, humedad_pct, prob_lluvia_pct, lluvia_mm, viento_kmh, rafaga_kmh, viento_dir_grados, cielo";
      const tabla = tipo === "dia" ? "clima_smn_dia" : "clima_smn_hora";
      const st: D1PreparedStatement[] = [];
      for (let i = 0; i < filasSql.length; i += 200) st.push(env.DB_PLATAFORMA.prepare(`INSERT OR IGNORE INTO ${tabla} (${cols}) VALUES ${filasSql.slice(i, i + 200).join(", ")}`));
      const faltan = MUNICIPIOS_SMN.filter((m) => !vistas.has(m.clave)).map((m) => m.clave);
      st.push(env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO clima_smn_emision (tipo, emision, sha256, bytes, descargado_en, registros, municipios, inicio, fin, detalle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(tipo, b.emision, await sha256(b.gz), b.gz.length, ahora.toISOString(), total, vistas.size, inicio, fin, faltan.length ? `faltan: ${faltan.join(",")}` : null));
      await env.DB_PLATAFORMA.batch(st);
      out.push({ tipo, estado: "nueva", emision: b.emision, registros: filasSql.length, capitales: vistas.size });
    } catch (e) {
      out.push({ tipo, estado: `error: ${String(e).slice(0, 160)}` });
    }
  }
  return out;
}

/** El pronóstico vigente del SMN para una capital: las horas desde la hora en curso y los días desde hoy (hora del centro). */
export async function pronosticoSmnDe(db: D1Database, clave: string, ahoraMs: number) {
  const [eh, ed] = await Promise.all([
    fila<{ emision: string; inicio: string | null; fin: string | null; descargado_en: string; sha256: string }>(db, "SELECT emision, inicio, fin, descargado_en, sha256 FROM clima_smn_emision WHERE tipo = 'hora' ORDER BY emision DESC LIMIT 1"),
    fila<{ emision: string; inicio: string | null; fin: string | null; descargado_en: string; sha256: string }>(db, "SELECT emision, inicio, fin, descargado_en, sha256 FROM clima_smn_emision WHERE tipo = 'dia' ORDER BY emision DESC LIMIT 1"),
  ]);
  const desdeHora = new Date(Math.floor(ahoraMs / 3600_000) * 3600_000).toISOString();
  const hoyCentro = new Date(ahoraMs - HORA_CENTRO_UTC * 3600_000).toISOString().slice(0, 10);
  const [horas, dias] = await Promise.all([
    eh ? filas(db, "SELECT hora, temperatura_c, rocio_c, humedad_pct, prob_lluvia_pct, lluvia_mm, viento_kmh, rafaga_kmh, viento_dir_grados, cielo FROM clima_smn_hora WHERE clave = ? AND emision = ? AND hora >= ? ORDER BY hora LIMIT 48", [clave, eh.emision, desdeHora]) : Promise.resolve([]),
    ed ? filas(db, "SELECT fecha, tmax_c, tmin_c, prob_lluvia_pct, lluvia_mm, viento_kmh, rafaga_kmh, viento_dir_grados, nubes_pct, cielo FROM clima_smn_dia WHERE clave = ? AND emision = ? AND fecha >= ? ORDER BY fecha", [clave, ed.emision, hoyCentro]) : Promise.resolve([]),
  ]);
  const m = MUNICIPIOS_SMN.find((x) => x.clave === clave);
  return {
    fuente: SMN_PRONOSTICO_FUENTE, papel: "pronostico_oficial",
    municipio: m ? { nombre: m.municipio, ides: m.ides, idmun: m.idmun, km_capital: m.km_capital } : null,
    horas: { emision: eh?.emision ?? null, descargado_en: eh?.descargado_en ?? null, sha256: eh?.sha256 ?? null, filas: horas },
    dias: { emision: ed?.emision ?? null, descargado_en: ed?.descargado_en ?? null, sha256: ed?.sha256 ?? null, filas: dias },
    nota: "Pronóstico oficial del SMN para el municipio de la capital (no es medición). El SMN fecha sus horas y sus días en hora del centro (UTC−6) para todo el país; aquí las horas van en UTC. Viento y rachas en km/h; lluvia en mm.",
  };
}

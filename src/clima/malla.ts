// Mallas de pronóstico para el mapa animado del clima: lluvia, temperatura, viento y nubes del modelo global GFS de la NOAA.
// Es PRONÓSTICO de modelo, no medición, y así se presenta. Dos mallas, con el mismo proceso:
// - «mexico»: 0.25° (unos 28 km), hora por hora de la 1 a la 54, recortada a México, Centroamérica y los mares vecinos
//   (4° a 36° N, 122° a 82° O: 161 × 129 puntos). Es la que da detalle al acercarse.
// - «mundo»: 1°, cada 3 horas de la 3 a la 54, el planeta entero (360 × 181 puntos). Es la que llena el mapa al alejarse.
// La NOAA publica cuatro corridas al día (00, 06, 12 y 18 UTC) unas 4 horas después de su hora. Cuando aparece una nueva, el
// observatorio pide al filtro de NOMADS unas horas por minuto, las lee con su propio lector GRIB (validado contra ecCodes), las
// compacta a un byte por punto y, al tenerlas todas, arma un archivo por variable comprimido en R2 con un manifiesto que dice cómo
// leerlo. Costo: 288 pedidos al día a la NOAA y unos 25 MB en R2.
import type { Env } from "../index";
import { fila } from "../lib/db";
import { leerGrib, type CampoGrib } from "./grib";

type Malla = { ni: number; nj: number; norte: number; sur: number; oeste: number; este: number; paso: number };
type Config = { clave: "mexico" | "mundo"; filtro: string; producto: string; horas: number[]; porVuelta: number; malla: Malla; lonGrib: [number, number]; recorte: string; nota: string };
const rango = (a: number, b: number, p: number) => Array.from({ length: Math.floor((b - a) / p) + 1 }, (_, i) => a + i * p);
export const MALLAS: Record<"mexico" | "mundo", Config> = {
  mexico: {
    clave: "mexico", filtro: "filter_gfs_0p25_1hr.pl", producto: "pgrb2.0p25", horas: rango(1, 54, 1), porVuelta: 6,
    malla: { ni: 161, nj: 129, norte: 36, sur: 4, oeste: -122, este: -82, paso: 0.25 }, lonGrib: [238, 278],
    recorte: "&subregion=&toplat=36&leftlon=238&rightlon=278&bottomlat=4",
    nota: "filas de norte a sur, columnas de oeste a este; la fila 0 es 36° N y la columna 0 es 122° O",
  },
  mundo: {
    clave: "mundo", filtro: "filter_gfs_1p00.pl", producto: "pgrb2.1p00", horas: rango(3, 54, 3), porVuelta: 3,
    malla: { ni: 360, nj: 181, norte: 90, sur: -90, oeste: 0, este: 359, paso: 1 }, lonGrib: [0, 359],
    // Recortar al planeta entero obliga al filtro a reempaquetar en simple, que es lo que lee el lector.
    recorte: "&subregion=&toplat=90&leftlon=0&rightlon=359&bottomlat=-90",
    nota: "filas de norte a sur, columnas hacia el este desde el meridiano de Greenwich; la fila 0 es 90° N, la columna 0 es 0° y la 359 es 1° O (la longitud da la vuelta)",
  },
};
const FALLAS_MAX = 30;
const NOMADS = "https://nomads.ncep.noaa.gov";
export const PREFIJO_MALLA = "clima/malla";
const AGENTE = { "user-agent": "datosmexico.org (observatorio; mapa del clima; equipo@datosmexico.org)" };
export const VARIABLES = {
  lluvia: { capas: 1, codificacion: "mm/h = (c / 32)²; 0 = sin lluvia (menos de 0.05 mm/h)" },
  temperatura: { capas: 1, codificacion: "°C a 2 m = c / 2.2 − 60 (de −60 a +55.9; la Antártida baja de −50)" },
  viento: { capas: 2, codificacion: "por paso, primero los N valores de u (hacia el este) y luego los N de v (hacia el norte), a 10 m; m/s = (c − 128) / 2" },
  nubes: { capas: 1, codificacion: "% de cielo cubierto = c / 2.55" },
} as const;

const iso = (d: number) => new Date(d).toISOString();
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const corridaDe = (ms: number) => iso(ms).slice(0, 13).replace(/[-T]/g, ""); // AAAAMMDDHH
const msDe = (c: string) => Date.UTC(+c.slice(0, 4), +c.slice(4, 6) - 1, +c.slice(6, 8), +c.slice(8, 10));
const dirDe = (c: string) => `/gfs.${c.slice(0, 8)}/${c.slice(8, 10)}/atmos`;
const archivoDe = (cfg: Config, c: string, h: number) => `gfs.t${c.slice(8, 10)}z.${cfg.producto}.f${pad(h, 3)}`;
const clamp = (x: number) => (x < 0 ? 0 : x > 255 ? 255 : Math.round(x));

/** Los cinco campos instantáneos de un paso → 5 capas de un byte por punto (lluvia, temperatura, u, v, nubes). */
export function codificarHora(cfg: Config, campos: CampoGrib[], hora: number): Uint8Array {
  const { ni, nj, norte, sur } = cfg.malla; const N = ni * nj;
  const busca = (cat: number, par: number, sup: number, nivel: number | null) => {
    const c = campos.find((x) => x.disciplina === 0 && x.categoria === cat && x.parametro === par && x.superficie === sup && (nivel === null || x.nivel === nivel) && x.plantillaProducto === 0);
    if (!c) throw new Error(`falta el campo ${cat}.${par} en la superficie ${sup}`);
    if (c.ni !== ni || c.nj !== nj || c.lat1 !== norte || c.lat2 !== sur || c.lon1 !== cfg.lonGrib[0] || c.lon2 !== cfg.lonGrib[1]) throw new Error(`malla inesperada ${c.ni}×${c.nj} ${c.lat1}…${c.lat2} ${c.lon1}…${c.lon2}`);
    if (c.horaPronostico !== hora) throw new Error(`campo de la hora ${c.horaPronostico}, se pidió la ${hora}`);
    return c.valores;
  };
  const lluvia = busca(1, 7, 1, null), t2 = busca(0, 0, 103, 2), u10 = busca(2, 2, 103, 10), v10 = busca(2, 3, 103, 10), nubes = busca(6, 1, 10, null);
  const out = new Uint8Array(5 * N);
  for (let k = 0; k < N; k++) {
    const mmh = lluvia[k] * 3600; // kg/m²/s → mm/h
    out[k] = mmh < 0.05 ? 0 : Math.max(1, clamp(Math.sqrt(mmh) * 32));
    out[N + k] = clamp((t2[k] - 273.15 + 60) * 2.2);
    out[2 * N + k] = clamp(u10[k] * 2 + 128);
    out[3 * N + k] = clamp(v10[k] * 2 + 128);
    out[4 * N + k] = clamp(nubes[k] * 2.55);
  }
  return out;
}

async function gzip(datos: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([datos]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

type Estado = { corrida: string; horas_listas: number; estado: string; fallas: number };

/** Una vuelta del proceso para las dos mallas (cada minuto desde el cron). Nunca lanza. */
export async function actualizarMallas(env: Env, ahora: Date, fetchImpl: typeof fetch = fetch): Promise<string> {
  const r: string[] = [];
  for (const cfg of Object.values(MALLAS)) { const x = await actualizarMalla(env, cfg, ahora, fetchImpl); if (x !== "nada") r.push(`${cfg.clave} ${x}`); }
  return r.length ? r.join(" · ") : "nada";
}

async function actualizarMalla(env: Env, cfg: Config, ahora: Date, fetchImpl: typeof fetch): Promise<string> {
  try {
    let e = await fila<Estado>(env.DB_PLATAFORMA, "SELECT corrida, horas_listas, estado, fallas FROM clima_malla WHERE malla = ? AND estado = 'bajando' ORDER BY corrida DESC LIMIT 1", [cfg.clave]);
    const ultimaHora = cfg.horas[cfg.horas.length - 1];
    if (!e) {
      // Sin corrida en curso: cada 10 minutos se busca una corrida nueva más reciente que la última completa.
      if (ahora.getUTCMinutes() % 10 !== 4) return "nada";
      const ultima = (await fila<{ c: string | null }>(env.DB_PLATAFORMA, "SELECT MAX(corrida) AS c FROM clima_malla WHERE malla = ? AND estado = 'completa'", [cfg.clave]))?.c ?? "0";
      const base = Math.floor(ahora.getTime() / 21_600_000) * 21_600_000;
      for (const ms of [base, base - 21_600_000]) {
        const c = corridaDe(ms);
        if (c <= ultima) break;
        const idx = await fetchImpl(`${NOMADS}/pub/data/nccf/com/gfs/prod${dirDe(c)}/${archivoDe(cfg, c, ultimaHora)}.idx`, { method: "HEAD", headers: AGENTE });
        if (!idx.ok) continue;
        await env.DB_PLATAFORMA.prepare("INSERT OR IGNORE INTO clima_malla (malla, corrida, horas_listas, estado, fallas, iniciada_en) VALUES (?, ?, 0, 'bajando', 0, ?)").bind(cfg.clave, c, iso(ahora.getTime())).run();
        e = { corrida: c, horas_listas: 0, estado: "bajando", fallas: 0 };
        break;
      }
      if (!e) return "sin corrida nueva";
    }
    // Candado: si otra vuelta (del minuto anterior) sigue trabajando esta corrida, esta no hace nada.
    const ahoraIso = iso(ahora.getTime());
    const toma = await env.DB_PLATAFORMA.prepare("UPDATE clima_malla SET bloqueo_hasta = ? WHERE malla = ? AND corrida = ? AND estado = 'bajando' AND (bloqueo_hasta IS NULL OR bloqueo_hasta < ?)").bind(iso(ahora.getTime() + 180_000), cfg.clave, e.corrida, ahoraIso).run();
    if (!toma.meta.changes) return "nada";
    e = (await fila<Estado>(env.DB_PLATAFORMA, "SELECT corrida, horas_listas, estado, fallas FROM clima_malla WHERE malla = ? AND corrida = ?", [cfg.clave, e.corrida])) ?? e;
    // horas_listas = cuántos pasos de la lista de horas ya están en R2.
    let listas = e.horas_listas; let detalle = "";
    // El tope se fija antes del ciclo: `listas` avanza dentro y, si el tope se recalculara, bajaría todo de una vez.
    const hasta = Math.min(listas + cfg.porVuelta, cfg.horas.length);
    for (let i = listas; i < hasta; i++) {
      const h = cfg.horas[i];
      const url = `${NOMADS}/cgi-bin/${cfg.filtro}?dir=${encodeURIComponent(dirDe(e.corrida))}&file=${archivoDe(cfg, e.corrida, h)}&var_PRATE=on&var_TMP=on&var_UGRD=on&var_VGRD=on&var_TCDC=on&lev_surface=on&lev_2_m_above_ground=on&lev_10_m_above_ground=on&lev_entire_atmosphere=on${cfg.recorte}`;
      try {
        const resp = await fetchImpl(url, { headers: AGENTE });
        if (!resp.ok) throw new Error(`NOMADS respondió ${resp.status}`);
        const capa = codificarHora(cfg, leerGrib(new Uint8Array(await resp.arrayBuffer())), h);
        await env.DATOS.put(`${PREFIJO_MALLA}/${cfg.clave}/${e.corrida}/h/${pad(h, 3)}.bin`, capa);
        listas = i + 1;
      } catch (x) { detalle = `hora ${h}: ${String(x).slice(0, 160)}`; break; }
    }
    const fallas = detalle ? e.fallas + 1 : e.fallas;
    const completa = listas === cfg.horas.length;
    await env.DB_PLATAFORMA.prepare("UPDATE clima_malla SET horas_listas = ?, fallas = ?, estado = ?, detalle = ?, bloqueo_hasta = ? WHERE malla = ? AND corrida = ?").bind(listas, fallas, !completa && fallas >= FALLAS_MAX ? "fallida" : "bajando", detalle || null, completa ? iso(ahora.getTime() + 180_000) : null, cfg.clave, e.corrida).run();
    if (!completa) return `${e.corrida}: ${listas}/${cfg.horas.length}${detalle ? ` (${detalle})` : ""}`;
    try { return await armar(env, cfg, e.corrida, ahora); }
    finally { await env.DB_PLATAFORMA.prepare("UPDATE clima_malla SET bloqueo_hasta = NULL WHERE malla = ? AND corrida = ?").bind(cfg.clave, e.corrida).run(); }
  } catch (x) {
    return `error: ${String(x).slice(0, 200)}`;
  }
}

/** Con todos los pasos: un archivo comprimido por variable, el manifiesto y la limpieza de corridas viejas. */
async function armar(env: Env, cfg: Config, corrida: string, ahora: Date): Promise<string> {
  const N = cfg.malla.ni * cfg.malla.nj; const P = cfg.horas.length;
  const pref = `${PREFIJO_MALLA}/${cfg.clave}`;
  const horas: Uint8Array[] = [];
  for (const h of cfg.horas) {
    const o = await env.DATOS.get(`${pref}/${corrida}/h/${pad(h, 3)}.bin`);
    if (!o) throw new Error(`falta la hora ${h} en R2`);
    const b = new Uint8Array(await o.arrayBuffer());
    if (b.length !== 5 * N) throw new Error(`hora ${h} con ${b.length} bytes`);
    horas.push(b);
  }
  const capas: Record<keyof typeof VARIABLES, number[]> = { lluvia: [0], temperatura: [1], viento: [2, 3], nubes: [4] };
  const variables: Record<string, { url: string; bytes: number; capas: number; codificacion: string }> = {};
  for (const [v, cs] of Object.entries(capas) as [keyof typeof VARIABLES, number[]][]) {
    const crudo = new Uint8Array(P * cs.length * N);
    horas.forEach((b, i) => cs.forEach((c, j) => crudo.set(b.subarray(c * N, (c + 1) * N), (i * cs.length + j) * N)));
    const z = await gzip(crudo);
    await env.DATOS.put(`${pref}/${corrida}/${v}.bin.gz`, z, { httpMetadata: { contentType: "application/octet-stream", contentEncoding: "gzip" } });
    variables[v] = { url: `https://api.datosmexico.org/api/v1/clima/malla/${cfg.clave}/${corrida}/${v}`, bytes: z.length, capas: cs.length, codificacion: VARIABLES[v].codificacion };
  }
  const t0 = msDe(corrida);
  const paso = cfg.horas[1] - cfg.horas[0];
  const manifiesto = {
    malla_clave: cfg.clave, corrida, modelo: `GFS ${cfg.malla.paso}° (NOAA/NCEP), pronóstico numérico global`, fuente_url: "https://nomads.ncep.noaa.gov/",
    es: "pronóstico de modelo, no medición",
    primera_hora: iso(t0 + cfg.horas[0] * 3_600_000), horas: P, paso_horas: paso,
    malla: { ...cfg.malla, orden: cfg.nota },
    variables, generado_en: iso(ahora.getTime()),
  };
  await env.DATOS.put(`${pref}/actual.json`, JSON.stringify(manifiesto), { httpMetadata: { contentType: "application/json" } });
  await env.DB_PLATAFORMA.prepare("UPDATE clima_malla SET estado = 'completa', completa_en = ?, detalle = NULL WHERE malla = ? AND corrida = ?").bind(iso(ahora.getTime()), cfg.clave, corrida).run();
  // Limpieza: los pasos sueltos de esta corrida y todo lo de corridas anteriores a la previa completa.
  const borrar: string[] = cfg.horas.map((h) => `${pref}/${corrida}/h/${pad(h, 3)}.bin`);
  const previa = (await fila<{ c: string | null }>(env.DB_PLATAFORMA, "SELECT MAX(corrida) AS c FROM clima_malla WHERE malla = ? AND estado = 'completa' AND corrida < ?", [cfg.clave, corrida]))?.c ?? null;
  const lista = await env.DATOS.list({ prefix: `${pref}/` });
  for (const o of lista.objects) {
    const c = o.key.split("/")[3];
    if (/^\d{10}$/.test(c) && c !== corrida && c !== previa) borrar.push(o.key);
  }
  for (let i = 0; i < borrar.length; i += 1000) await env.DATOS.delete(borrar.slice(i, i + 1000));
  return `${corrida}: completa (${Object.entries(variables).map(([k, v]) => `${k} ${Math.round(v.bytes / 1024)} KB`).join(", ")})`;
}

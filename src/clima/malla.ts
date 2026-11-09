// Malla de pronóstico para el mapa animado del clima: lluvia, temperatura, viento y nubes, hora por hora, de la hora 1 a la 54
// de cada corrida del modelo global GFS de la NOAA (0.25°, unos 28 km), recortada a México, Centroamérica y los mares vecinos
// (4° a 36° N, 122° a 82° O: 161 × 129 puntos). Es PRONÓSTICO de modelo, no medición, y así se presenta.
// La NOAA publica cuatro corridas al día (00, 06, 12 y 18 UTC) unas 4 horas después de su hora. Cuando aparece una nueva, el
// observatorio pide al filtro de NOMADS seis horas por minuto (54 pedidos por corrida), las lee con su propio lector GRIB
// (validado contra ecCodes), las compacta a un byte por punto y, al tener las 54, arma un archivo por variable comprimido en
// R2, con un manifiesto que dice cómo leerlo. Costo: 216 pedidos al día a la NOAA y unos 10 MB en R2.
import type { Env } from "../index";
import { fila } from "../lib/db";
import { leerGrib, type CampoGrib } from "./grib";

export const MALLA = { ni: 161, nj: 129, norte: 36, sur: 4, oeste: -122, este: -82, paso: 0.25 } as const;
export const HORAS_MALLA = 54;
const N = MALLA.ni * MALLA.nj;
const POR_VUELTA = 6, FALLAS_MAX = 30;
const NOMADS = "https://nomads.ncep.noaa.gov";
export const PREFIJO_MALLA = "clima/malla";
const AGENTE = { "user-agent": "datosmexico.org (observatorio; mapa del clima; equipo@datosmexico.org)" };
export const VARIABLES = {
  lluvia: { capas: 1, codificacion: "mm/h = (c / 32)²; 0 = sin lluvia (menos de 0.05 mm/h)" },
  temperatura: { capas: 1, codificacion: "°C a 2 m = c / 3 − 40" },
  viento: { capas: 2, codificacion: "por hora, primero los N valores de u (hacia el este) y luego los N de v (hacia el norte), a 10 m; m/s = (c − 128) / 2" },
  nubes: { capas: 1, codificacion: "% de cielo cubierto = c / 2.55" },
} as const;

const iso = (d: number) => new Date(d).toISOString();
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const corridaDe = (ms: number) => iso(ms).slice(0, 13).replace(/[-T]/g, ""); // AAAAMMDDHH
const msDe = (c: string) => Date.UTC(+c.slice(0, 4), +c.slice(4, 6) - 1, +c.slice(6, 8), +c.slice(8, 10));
const rutaNomads = (c: string) => ({ dir: `/gfs.${c.slice(0, 8)}/${c.slice(8, 10)}/atmos`, archivo: (h: number) => `gfs.t${c.slice(8, 10)}z.pgrb2.0p25.f${pad(h, 3)}` });
const clamp = (x: number) => (x < 0 ? 0 : x > 255 ? 255 : Math.round(x));

/** Los cinco campos instantáneos de una hora → 5 capas de un byte por punto (lluvia, temperatura, u, v, nubes). */
export function codificarHora(campos: CampoGrib[], hora: number): Uint8Array {
  const busca = (cat: number, par: number, sup: number, nivel: number | null) => {
    const c = campos.find((x) => x.disciplina === 0 && x.categoria === cat && x.parametro === par && x.superficie === sup && (nivel === null || x.nivel === nivel) && x.plantillaProducto === 0);
    if (!c) throw new Error(`falta el campo ${cat}.${par} en la superficie ${sup}`);
    if (c.ni !== MALLA.ni || c.nj !== MALLA.nj || c.lat1 !== MALLA.norte || c.lat2 !== MALLA.sur || c.lon1 - 360 !== MALLA.oeste || c.lon2 - 360 !== MALLA.este) throw new Error(`malla inesperada ${c.ni}×${c.nj} ${c.lat1}…${c.lat2} ${c.lon1}…${c.lon2}`);
    if (c.horaPronostico !== hora) throw new Error(`campo de la hora ${c.horaPronostico}, se pidió la ${hora}`);
    return c.valores;
  };
  const lluvia = busca(1, 7, 1, null), t2 = busca(0, 0, 103, 2), u10 = busca(2, 2, 103, 10), v10 = busca(2, 3, 103, 10), nubes = busca(6, 1, 10, null);
  const out = new Uint8Array(5 * N);
  for (let k = 0; k < N; k++) {
    const mmh = lluvia[k] * 3600; // kg/m²/s → mm/h
    out[k] = mmh < 0.05 ? 0 : Math.max(1, clamp(Math.sqrt(mmh) * 32));
    out[N + k] = clamp((t2[k] - 273.15 + 40) * 3);
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

/** Una vuelta del proceso (cada minuto desde el cron). Nunca lanza. */
export async function actualizarMalla(env: Env, ahora: Date, fetchImpl: typeof fetch = fetch): Promise<string> {
  try {
    let e = await fila<Estado>(env.DB_PLATAFORMA, "SELECT corrida, horas_listas, estado, fallas FROM clima_malla WHERE estado = 'bajando' ORDER BY corrida DESC LIMIT 1");
    if (!e) {
      // Sin corrida en curso: cada 10 minutos se busca una corrida nueva más reciente que la última completa.
      if (ahora.getUTCMinutes() % 10 !== 4) return "nada";
      const ultima = (await fila<{ c: string | null }>(env.DB_PLATAFORMA, "SELECT MAX(corrida) AS c FROM clima_malla WHERE estado = 'completa'"))?.c ?? "0";
      const base = Math.floor(ahora.getTime() / 21_600_000) * 21_600_000;
      for (const ms of [base, base - 21_600_000]) {
        const c = corridaDe(ms);
        if (c <= ultima) break;
        const r = rutaNomads(c);
        const idx = await fetchImpl(`${NOMADS}/pub/data/nccf/com/gfs/prod${r.dir}/${r.archivo(HORAS_MALLA)}.idx`, { method: "HEAD", headers: AGENTE });
        if (!idx.ok) continue;
        await env.DB_PLATAFORMA.prepare("INSERT OR IGNORE INTO clima_malla (corrida, horas_listas, estado, fallas, iniciada_en) VALUES (?, 0, 'bajando', 0, ?)").bind(c, iso(ahora.getTime())).run();
        e = { corrida: c, horas_listas: 0, estado: "bajando", fallas: 0 };
        break;
      }
      if (!e) return "sin corrida nueva";
    }
    const r = rutaNomads(e.corrida);
    let listas = e.horas_listas; let detalle = "";
    for (let h = listas + 1; h <= Math.min(listas + POR_VUELTA, HORAS_MALLA); h++) {
      const url = `${NOMADS}/cgi-bin/filter_gfs_0p25_1hr.pl?dir=${encodeURIComponent(r.dir)}&file=${r.archivo(h)}&var_PRATE=on&var_TMP=on&var_UGRD=on&var_VGRD=on&var_TCDC=on&lev_surface=on&lev_2_m_above_ground=on&lev_10_m_above_ground=on&lev_entire_atmosphere=on&subregion=&toplat=${MALLA.norte}&leftlon=${MALLA.oeste + 360}&rightlon=${MALLA.este + 360}&bottomlat=${MALLA.sur}`;
      try {
        const resp = await fetchImpl(url, { headers: AGENTE });
        if (!resp.ok) throw new Error(`NOMADS respondió ${resp.status}`);
        const capa = codificarHora(leerGrib(new Uint8Array(await resp.arrayBuffer())), h);
        await env.DATOS.put(`${PREFIJO_MALLA}/${e.corrida}/h/${pad(h, 3)}.bin`, capa);
        listas = h;
      } catch (x) { detalle = `hora ${h}: ${String(x).slice(0, 160)}`; break; }
    }
    const fallas = detalle ? e.fallas + 1 : e.fallas;
    const estado = listas === HORAS_MALLA ? "armando" : fallas >= FALLAS_MAX ? "fallida" : "bajando";
    await env.DB_PLATAFORMA.prepare("UPDATE clima_malla SET horas_listas = ?, fallas = ?, estado = ?, detalle = ? WHERE corrida = ?").bind(listas, fallas, estado === "armando" ? "bajando" : estado, detalle || null, e.corrida).run();
    if (estado !== "armando") return `${e.corrida}: ${listas}/${HORAS_MALLA}${detalle ? ` (${detalle})` : ""}`;
    return await armar(env, e.corrida, ahora);
  } catch (x) {
    return `error: ${String(x).slice(0, 200)}`;
  }
}

/** Con las 54 horas: un archivo comprimido por variable, el manifiesto y la limpieza de corridas viejas. */
async function armar(env: Env, corrida: string, ahora: Date): Promise<string> {
  const horas: Uint8Array[] = [];
  for (let h = 1; h <= HORAS_MALLA; h++) {
    const o = await env.DATOS.get(`${PREFIJO_MALLA}/${corrida}/h/${pad(h, 3)}.bin`);
    if (!o) throw new Error(`falta la hora ${h} en R2`);
    const b = new Uint8Array(await o.arrayBuffer());
    if (b.length !== 5 * N) throw new Error(`hora ${h} con ${b.length} bytes`);
    horas.push(b);
  }
  const capas: Record<keyof typeof VARIABLES, number[]> = { lluvia: [0], temperatura: [1], viento: [2, 3], nubes: [4] };
  const variables: Record<string, { url: string; bytes: number; capas: number; codificacion: string }> = {};
  for (const [v, cs] of Object.entries(capas) as [keyof typeof VARIABLES, number[]][]) {
    const crudo = new Uint8Array(HORAS_MALLA * cs.length * N);
    horas.forEach((b, i) => cs.forEach((c, j) => crudo.set(b.subarray(c * N, (c + 1) * N), (i * cs.length + j) * N)));
    const z = await gzip(crudo);
    await env.DATOS.put(`${PREFIJO_MALLA}/${corrida}/${v}.bin.gz`, z, { httpMetadata: { contentType: "application/octet-stream", contentEncoding: "gzip" } });
    variables[v] = { url: `https://api.datosmexico.org/api/v1/clima/malla/${corrida}/${v}`, bytes: z.length, capas: cs.length, codificacion: VARIABLES[v].codificacion };
  }
  const t0 = msDe(corrida);
  const manifiesto = {
    corrida, modelo: "GFS 0.25° (NOAA/NCEP), pronóstico numérico global", fuente_url: "https://nomads.ncep.noaa.gov/",
    es: "pronóstico de modelo, no medición",
    primera_hora: iso(t0 + 3600_000), horas: HORAS_MALLA, paso_horas: 1,
    malla: { ...MALLA, orden: "filas de norte a sur, columnas de oeste a este; la fila 0 es 36° N y la columna 0 es 122° O" },
    variables, generado_en: iso(ahora.getTime()),
  };
  await env.DATOS.put(`${PREFIJO_MALLA}/actual.json`, JSON.stringify(manifiesto), { httpMetadata: { contentType: "application/json" } });
  await env.DB_PLATAFORMA.prepare("UPDATE clima_malla SET estado = 'completa', completa_en = ?, detalle = NULL WHERE corrida = ?").bind(iso(ahora.getTime()), corrida).run();
  // Limpieza: las horas sueltas de esta corrida y todo lo de corridas anteriores a la previa completa.
  const borrar: string[] = [];
  for (let h = 1; h <= HORAS_MALLA; h++) borrar.push(`${PREFIJO_MALLA}/${corrida}/h/${pad(h, 3)}.bin`);
  const previa = (await fila<{ c: string | null }>(env.DB_PLATAFORMA, "SELECT MAX(corrida) AS c FROM clima_malla WHERE estado = 'completa' AND corrida < ?", [corrida]))?.c ?? null;
  const lista = await env.DATOS.list({ prefix: `${PREFIJO_MALLA}/` });
  for (const o of lista.objects) {
    const c = o.key.split("/")[2];
    if (/^\d{10}$/.test(c) && c !== corrida && c !== previa) borrar.push(o.key);
  }
  for (let i = 0; i < borrar.length; i += 1000) await env.DATOS.delete(borrar.slice(i, i + 1000));
  return `${corrida}: completa (${Object.entries(variables).map(([k, v]) => `${k} ${Math.round(v.bytes / 1024)} KB`).join(", ")})`;
}

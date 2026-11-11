// Cuadros del satélite para el mapa animado del clima: GOES-Oeste y GOES-Este en color (GeoColor). Es IMAGEN REAL del pasado
// reciente, no pronóstico. Fuente principal (desde el 10 de noviembre de 2026): el servicio de imágenes de la NOAA (NESDIS,
// MERGEDGC_Last_24hr), que ya trae los dos satélites combinados y publica cada cuadro unos 20 minutos después de la toma; se pide
// cada cuadro exacto por su número en el catálogo. Respaldo: NASA GIBS, que tarda de 45 a 75 minutos, para las horas que la NOAA
// no tenga o cuando su servicio no responda. Lo que sigue describe el respaldo. Por cada hora que GIBS publica (cada 10 minutos, con huecos) se le pide una
// sola imagen JPEG por región con los dos satélites juntos (el del este encima) y se guarda en R2: el navegador baja una imagen por cuadro (unos 0.4 MB) desde el
// observatorio, con caché permanente, en vez de cientos de mosaicos PNG (unos 25 MB en las tres horas) a un servidor que tarda de
// 3 a 5 segundos en armar cada imagen y no la guarda. Dos regiones:
// - «mexico»: 125° a 75° O, del ecuador a 37° N, 1280 píxeles de ancho (unos 4 km por píxel). La que se ve al abrir el mapa.
// - «america»: 180° a 0°, de 75° S a 75° N, 1280 de ancho (unos 16 km por píxel). Lo que cubren los dos satélites, para la vista
//   del mundo.
// El mapa toma uno de cada dos (uno cada 20 minutos); guardar todos deja que tome el vecino cuando GIBS tiene un hueco.
// Costo: unas 288 consultas cortas al día al catálogo de la NOAA, 288 imágenes al día (dos regiones por cuadro) y unos 90 MB
// en R2 (se guardan 26 horas); GIBS solo cuando hace falta el respaldo.
import { decode } from "jpeg-js";
import type { Env } from "../index";

export const PREFIJO_SATELITE = "clima/satelite";
const AGENTE = { "user-agent": "datosmexico.org (observatorio; mapa del clima; equipo@datosmexico.org)" };
const WMS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi";
const NOAA = "https://satellitemaps.nesdis.noaa.gov/arcgis/rest/services/MERGEDGC_Last_24hr/ImageServer";
const DOMINIOS = (capa: string, a: string, b: string) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/${capa}/default/GoogleMapsCompatible_Level7/all/${a}--${b}.xml`;
// El orden importa: en la imagen, cada capa se pinta encima de la anterior.
export const SATELITES = [
  { id: "oeste", capa: "GOES-West_ABI_GeoColor", nombre: "GOES-Oeste" },
  { id: "este", capa: "GOES-East_ABI_GeoColor", nombre: "GOES-Este" },
] as const;
type Region = { oeste: number; este: number; sur: number; norte: number; ancho: number };
export const REGIONES: Record<"mexico" | "america", Region> = {
  mexico: { oeste: -125, este: -75, sur: 0, norte: 37, ancho: 1280 },
  america: { oeste: -180, este: 0, sur: -75, norte: 75, ancho: 1280 },
};
const PASO_MS = 10 * 60_000; // GIBS publica un cuadro cada 10 minutos
const VENTANA_MS = 3 * 3_600_000; // el mapa muestra las últimas tres horas
const GUARDAR_MS = 26 * 3_600_000;
const POR_VUELTA = 4; // cuadros nuevos por vuelta, como máximo (al arrancar hay que llenar unos dieciocho)
const PUBLICA_TRAS_MS = 15 * 60_000; // la NOAA publica cada cuadro unos 20 minutos después de la toma
const PUBLICA_GIBS_MS = 40 * 60_000; // GIBS, de 45 a 75: antes de 40 minutos ni se le pregunta
const ESPERA_OESTE_MS = 45 * 60_000; // si el del oeste no llega en ese tiempo, el cuadro sale solo con el del este
const MINIMO_BYTES = 40_000; // una imagen sin datos pesa unos 8 KB; una real, de noche, más de 150 KB

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + "Z"; // GIBS rechaza los milisegundos
const claveTiempo = (ms: number) => iso(ms).slice(0, 16).replace(/[-T:]/g, ""); // AAAAMMDDHHMM
const msDeClave = (c: string) => Date.UTC(+c.slice(0, 4), +c.slice(4, 6) - 1, +c.slice(6, 8), +c.slice(8, 10), +c.slice(10, 12));
const R = 6378137;
const mercX = (lon: number) => (R * lon * Math.PI) / 180;
const mercY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
export const altoDe = (g: Region) => Math.round((g.ancho * (mercY(g.norte) - mercY(g.sur))) / (mercX(g.este) - mercX(g.oeste)));

/** Horas que GIBS ya publicó de una capa (cada 10 minutos, con huecos). */
async function publicadas(capa: string, desde: number, hasta: number, fetchImpl: typeof fetch): Promise<Set<number>> {
  const r = await fetchImpl(DOMINIOS(capa, iso(desde), iso(hasta)), { headers: AGENTE });
  if (!r.ok) throw new Error(`GIBS respondió ${r.status} al pedir las horas de ${capa}`);
  const dom = /<Domain>([^<]+)<\/Domain>/.exec(await r.text())?.[1] ?? "";
  const s = new Set<number>();
  for (const tramo of dom.split(",")) {
    const [a, b] = tramo.split("/"); const ta = Date.parse(a), tb = Date.parse(b);
    for (let t = ta; Number.isFinite(t) && t <= tb; t += 600_000) s.add(t);
  }
  return s;
}

async function bajarImagen(g: Region, capas: string[], t: number, fetchImpl: typeof fetch): Promise<Uint8Array> {
  const bbox = [mercX(g.oeste), mercY(g.sur), mercX(g.este), mercY(g.norte)].map((x) => Math.round(x)).join(",");
  const url = `${WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${capas.join(",")}&STYLES=&CRS=EPSG:3857&BBOX=${bbox}&WIDTH=${g.ancho}&HEIGHT=${altoDe(g)}&FORMAT=image/jpeg&TIME=${iso(t)}`;
  const r = await fetchImpl(url, { headers: AGENTE });
  const b = validarJpeg(r, new Uint8Array(await r.arrayBuffer()), "GIBS");
  if (esTablero(b)) throw new Error("GIBS entregó un tablero en lugar de la imagen");
  return b;
}

/** Catálogo de la NOAA: número de cada cuadro por su hora de toma (los más recientes). */
async function catalogoNoaa(fetchImpl: typeof fetch): Promise<Map<number, number>> {
  const r = await fetchImpl(`${NOAA}/query?where=1%3D1&outFields=objectid,start_time&returnGeometry=false&orderByFields=start_time+DESC&resultRecordCount=30&f=json`, { headers: AGENTE });
  if (!r.ok) throw new Error(`la NOAA respondió ${r.status} al catálogo`);
  const j = (await r.json()) as { features?: { attributes: { objectid: number; start_time: number } }[]; error?: { message?: string } };
  if (j.error || !j.features) throw new Error(`catálogo de la NOAA: ${j.error?.message ?? "sin cuadros"}`);
  return new Map(j.features.map((f) => [f.attributes.start_time, f.attributes.objectid]));
}
async function bajarNoaa(g: Region, id: number, fetchImpl: typeof fetch): Promise<Uint8Array> {
  const bbox = [mercX(g.oeste), mercY(g.sur), mercX(g.este), mercY(g.norte)].map((x) => Math.round(x)).join(",");
  const mosaico = encodeURIComponent(JSON.stringify({ mosaicMethod: "esriMosaicLockRaster", lockRasterIds: [id] }));
  const r = await fetchImpl(`${NOAA}/exportImage?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${g.ancho},${altoDe(g)}&format=jpg&mosaicRule=${mosaico}&f=image`, { headers: AGENTE });
  const b = validarJpeg(r, new Uint8Array(await r.arrayBuffer()), "la NOAA");
  if (esTablero(b)) throw new Error("la NOAA entregó un tablero en lugar de la imagen (aún no la tiene lista)");
  return b;
}
/**
 * La NOAA a veces responde, para una toma que lista pero aún no tiene lista, un tablero de cuadros blancos y negros (10 de
 * noviembre de 2026: la toma de 23:50 UTC llegó así al mapa). Se decodifica y se mira una muestra de píxeles: en el tablero, casi
 * la mitad son blanco puro y casi la mitad negro puro. Una imagen de noche es mayormente negra pero casi nunca blanca pura.
 */
export function esTablero(jpeg: Uint8Array): boolean {
  const img = decode(jpeg, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 4 });
  let blancos = 0, negros = 0, n = 0;
  for (let y = 1; y < img.height; y += 7) for (let x = 3; x < img.width; x += 7) {
    const o = (y * img.width + x) * 4, l = (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 3;
    if (l > 240) blancos++; else if (l < 15) negros++;
    n++;
  }
  return blancos / n > 0.3 && negros / n > 0.3;
}
function validarJpeg(r: Response, b: Uint8Array, quien: string): Uint8Array {
  // A veces responden 200 con un error en texto: se exige un JPEG completo (FFD8 … FFD9) y con datos. La NOAA agrega unos
  // 200 bytes después del cierre (los navegadores los ignoran): se acepta un sobrante de hasta 1 KB y se guarda tal cual.
  let cierre = -1;
  for (let i = b.length - 2; i >= Math.max(0, b.length - 1024); i--) if (b[i] === 0xff && b[i + 1] === 0xd9) { cierre = i; break; }
  const jpeg = b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && cierre > 0;
  if (!r.ok || !jpeg) throw new Error(`${quien} no entregó la imagen (${r.status}, ${b.length} bytes)`);
  if (b.length < MINIMO_BYTES) throw new Error(`imagen sin datos (${b.length} bytes)`);
  return b;
}

type CuadroGuardado = { t: string; satelites: string[]; fuente: string; bytes: number; sha256: string };
export type Manifiesto = {
  fuente: string; nota: string; generado_en: string; paso_min: number;
  regiones: Record<string, { esquinas: [number, number][]; ancho: number; alto: number }>;
  cuadros: { t: string; satelites: string[]; fuente: string; regiones: Record<string, { ruta: string; bytes: number; sha256: string }> }[];
};

/** Una vuelta: pide los cuadros que faltan de las últimas tres horas (a la NOAA; a GIBS lo que la NOAA no tenga) y rehace el manifiesto. */
export async function actualizarSatelite(env: Env, ahora: Date, fetchImpl: typeof fetch = fetch): Promise<string> {
  const ms = ahora.getTime();
  const fin = Math.floor(ms / PASO_MS) * PASO_MS;
  const actual = await env.DATOS.get(`${PREFIJO_SATELITE}/actual.json`);
  const tenidos = new Set(actual ? (JSON.parse(await actual.text()) as Manifiesto).cuadros.map((c) => Date.parse(c.t)) : []);
  // Solo se pregunta por cuadros que ya pudieron publicarse; los más nuevos primero, para que el mapa llegue al presente.
  const faltan: number[] = [];
  for (let t = fin; t >= fin - VENTANA_MS; t -= PASO_MS) if (!tenidos.has(t) && ms - t >= PUBLICA_TRAS_MS) faltan.push(t);
  if (!faltan.length) return "nada";
  const hechos: string[] = [], fallas: string[] = [];
  let noaa: Map<number, number> | null = null;
  try { noaa = await catalogoNoaa(fetchImpl); } catch (e) { fallas.push(e instanceof Error ? e.message : String(e)); }
  // Las horas de GIBS solo se piden si hace falta el respaldo.
  let gibs: [Set<number>, Set<number>] | null = null;
  const horasGibs = async () => (gibs ??= await Promise.all(SATELITES.map((s) => publicadas(s.capa, Math.min(...faltan) - 600_000, ms, fetchImpl))) as [Set<number>, Set<number>]);
  const guardar = async (t: number, imgs: Uint8Array[], satelites: string[], fuente: string) => {
    const claves = Object.keys(REGIONES);
    for (let i = 0; i < claves.length; i++) {
      const huella = [...new Uint8Array(await crypto.subtle.digest("SHA-256", imgs[i]))].map((x) => x.toString(16).padStart(2, "0")).join("");
      await env.DATOS.put(`${PREFIJO_SATELITE}/${claves[i]}/${claveTiempo(t)}.jpg`, imgs[i], { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { satelites: satelites.join(","), fuente, sha256: huella } });
    }
  };
  // Si la NOAA entrega un tablero (o falla) en una vuelta, el resto de la vuelta ya no se le pide: suele ser todo el archivo a la
  // vez (11 de noviembre de 2026: todas sus tomas desde las 00:30 UTC), y pedirle cada hora solo la satura sin dar nada.
  let noaaSirve = !!noaa;
  for (const t of faltan) {
    if (hechos.length >= POR_VUELTA) break;
    const id = noaaSirve ? noaa?.get(t) : undefined;
    if (id !== undefined) {
      try {
        const imgs = await Promise.all(Object.values(REGIONES).map((g) => bajarNoaa(g, id, fetchImpl)));
        await guardar(t, imgs, SATELITES.map((s) => s.nombre), "noaa");
        hechos.push(`${iso(t).slice(11, 16)} (NOAA, ${imgs.map((b) => Math.round(b.length / 1024)).join("/")} KB)`);
        continue;
      } catch (e) {
        fallas.push(`${iso(t).slice(11, 16)} NOAA: ${e instanceof Error ? e.message : String(e)}`);
        noaaSirve = false; // y para esta misma hora, el respaldo
      }
    }
    // Respaldo: GIBS, cuando la NOAA no tiene esa hora, no respondió o entregó un tablero, y ya pudo publicarla GIBS.
    if (ms - t < PUBLICA_GIBS_MS) continue;
    try {
      const [oeste, este] = await horasGibs();
      if (!este.has(t)) continue; // el del este es la base: sin él no hay cuadro
      if (!oeste.has(t) && ms - t < ESPERA_OESTE_MS) continue;
      const sats = SATELITES.filter((s) => (s.id === "este" ? este : oeste).has(t));
      const imgs = await Promise.all(Object.values(REGIONES).map((g) => bajarImagen(g, sats.map((s) => s.capa), t, fetchImpl)));
      await guardar(t, imgs, sats.map((s) => s.nombre), "gibs");
      hechos.push(`${iso(t).slice(11, 16)} (GIBS ${sats.map((s) => s.id).join("+")}, ${imgs.map((b) => Math.round(b.length / 1024)).join("/")} KB)`);
    } catch (e) { fallas.push(`${iso(t).slice(11, 16)} GIBS: ${e instanceof Error ? e.message : String(e)}`); }
  }
  if (hechos.length) await rehacerManifiesto(env, ms);
  if (!hechos.length && !fallas.length) return "nada";
  return [hechos.length ? `cuadros ${hechos.join(", ")}` : "", fallas.length ? `fallas ${fallas.join("; ")}` : ""].filter(Boolean).join(" · ");
}

/**
 * Dirección pública de un cuadro: la hora y, como parámetro, el inicio de su huella. Los cuadros se sirven con caché permanente
 * (Cloudflare y navegador); si una hora se vuelve a guardar con otra imagen (por ejemplo, el tablero de la NOAA reemplazado por la
 * imagen buena), su dirección cambia y nadie recibe la versión vieja de una caché.
 */
export const rutaCuadro = (region: string, clave: string, sha256: string) => `/api/v1/clima/satelite/${region}/${clave}${sha256 ? `?h=${sha256.slice(0, 12)}` : ""}`;

/** El manifiesto sale de lo que hay en R2 (no de la memoria de una vuelta): dos vueltas a la vez no pueden perder un cuadro. */
async function rehacerManifiesto(env: Env, ms: number): Promise<void> {
  const porTiempo = new Map<number, Record<string, CuadroGuardado>>();
  for (const clave of Object.keys(REGIONES)) {
    const lista = await env.DATOS.list({ prefix: `${PREFIJO_SATELITE}/${clave}/`, include: ["customMetadata"] });
    for (const o of lista.objects) {
      const c = /(\d{12})\.jpg$/.exec(o.key)?.[1]; if (!c) continue;
      const t = msDeClave(c);
      if (ms - t > GUARDAR_MS) { await env.DATOS.delete(o.key); continue; }
      const x = porTiempo.get(t) ?? {};
      x[clave] = { t: iso(t), satelites: (o.customMetadata?.satelites ?? "").split(",").filter(Boolean), fuente: o.customMetadata?.fuente ?? "gibs", bytes: o.size, sha256: o.customMetadata?.sha256 ?? "" };
      porTiempo.set(t, x);
    }
  }
  const fin = Math.floor(ms / PASO_MS) * PASO_MS;
  const cuadros = [...porTiempo.entries()]
    .filter(([t, x]) => t >= fin - VENTANA_MS && Object.keys(REGIONES).every((k) => x[k]))
    .sort((a, b) => a[0] - b[0])
    .map(([t, x]) => ({ t: iso(t), satelites: x.mexico.satelites, fuente: x.mexico.fuente === "noaa" ? "NOAA NESDIS" : "NASA GIBS", regiones: Object.fromEntries(Object.keys(REGIONES).map((k) => [k, { ruta: rutaCuadro(k, claveTiempo(t), x[k].sha256), bytes: x[k].bytes, sha256: x[k].sha256 }])) }));
  const manifiesto: Manifiesto = {
    fuente: "NOAA GOES-Oeste y GOES-Este, producto GeoColor (CIRA); servido por NOAA NESDIS (MERGEDGC, unos 20 min tras la toma) y, de respaldo, por NASA GIBS (WMS); imágenes guardadas por Datos México",
    nota: "Imagen real del satélite, no pronóstico. De día, color natural; de noche, el satélite ve con infrarrojo y las nubes salen en gris sobre un fondo fijo con las luces de las ciudades. Proyección Web Mercator (EPSG:3857); las esquinas van en grados, empezando arriba a la izquierda y en el sentido del reloj.",
    generado_en: iso(ms), paso_min: PASO_MS / 60_000,
    regiones: Object.fromEntries(Object.entries(REGIONES).map(([k, g]) => [k, { esquinas: [[g.oeste, g.norte], [g.este, g.norte], [g.este, g.sur], [g.oeste, g.sur]], ancho: g.ancho, alto: altoDe(g) }])),
    cuadros,
  };
  await env.DATOS.put(`${PREFIJO_SATELITE}/actual.json`, JSON.stringify(manifiesto), { httpMetadata: { contentType: "application/json" } });
}

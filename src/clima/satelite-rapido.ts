// Satélite «rápido»: la imagen GeoColor de GOES-Este para Estados Unidos y México que la NOAA (STAR) publica cada 5 minutos,
// unos 5 minutos después de la toma. Viene en un GeoTIFF grande (BigTIFF, 11000 × 4660 píxeles a 0.009°, en grados, una fila
// por bloque comprimido) que se reescribe con cada toma. Para México hacen falta unas 790 de esas filas: se piden juntas en
// unas pocas peticiones de rangos sueltos (≈ 4 MB, no los 25 MB del archivo), se descomprimen, se remuestrean a la misma
// ventana Web Mercator de los cuadros de México (125°–75° O, 0°–37° N, 1280 × 1021) y se guardan como JPEG.
// A DEMANDA: solo se hace cuando alguien abre el mapa y el último cuadro rápido ya tiene más de 5 minutos. Sin nadie mirando no
// se descarga ni se procesa nada. Cubre México hasta el norte de Chiapas (14.6° N aprox.); fuera de esa zona, el mapa sigue
// mostrando el cuadro normal más reciente (NOAA NESDIS o NASA GIBS).
import { encode } from "jpeg-js";
import type { Env } from "../index";
import { PREFIJO_SATELITE, REGIONES, altoDe, rehacerManifiesto } from "./satelite";

export const STAR_TIFF = "https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/GOES19-ABI-CONUS-GEOCOLOR-5000x3000.tif";
export const PREFIJO_RAPIDO = `${PREFIJO_SATELITE}/rapido`;
const AGENTE = { "user-agent": "datosmexico.org (observatorio; mapa del clima; equipo@datosmexico.org)" };
const RANGOS_POR_PEDIDO = 200; // ~3 KB de cabecera Range; la NOAA responde multipart/byteranges
const CALIDAD = 82;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + "Z";
const claveTiempo = (ms: number) => iso(ms).slice(0, 16).replace(/[-T:]/g, ""); // AAAAMMDDHHMM

/** Hora de la toma, del nombre que trae el archivo .sha256 vecino: «20263150006_GOES19-…» = año 2026, día 315, 00:06 UTC. */
export function tomaDeNombre(nombre: string): number | null {
  const m = /(\d{4})(\d{3})(\d{2})(\d{2})_GOES19-ABI-CONUS-GEOCOLOR/.exec(nombre);
  if (!m) return null;
  const [anio, dia, hh, mm] = [+m[1], +m[2], +m[3], +m[4]];
  return Date.UTC(anio, 0, 1, hh, mm) + (dia - 1) * 86400_000;
}

type Tiff = { ancho: number; alto: number; offsets: number[]; bytes: number[]; oeste: number; norte: number; paso: number };
/** Lee lo necesario de la cabecera BigTIFF (orden II, magia 43) que está en los primeros bytes. */
function leerCabecera(b: Uint8Array): Tiff {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] !== 0x49 || b[1] !== 0x49 || v.getUint16(2, true) !== 43) throw new Error("no es un BigTIFF II");
  const u64 = (o: number) => Number(v.getBigUint64(o, true));
  const ifd = u64(8), n = u64(ifd);
  const tags = new Map<number, { tipo: number; n: number; pos: number }>();
  for (let i = 0; i < n; i++) {
    const e = ifd + 8 + 20 * i;
    const tipo = v.getUint16(e + 2, true), cuenta = u64(e + 4);
    const tam = ({ 3: 2, 4: 4, 12: 8, 16: 8 } as Record<number, number>)[tipo] ?? 1;
    tags.set(v.getUint16(e, true), { tipo, n: cuenta, pos: tam * cuenta <= 8 ? e + 12 : u64(e + 12) });
  }
  const leer = (tag: number): number[] => {
    const t = tags.get(tag); if (!t) throw new Error(`falta la etiqueta ${tag}`);
    if (t.pos + t.n * 8 > b.length && t.tipo !== 3) throw new Error(`la etiqueta ${tag} queda fuera de la cabecera leída`);
    const out: number[] = [];
    for (let i = 0; i < t.n; i++) {
      if (t.tipo === 3) out.push(v.getUint16(t.pos + 2 * i, true));
      else if (t.tipo === 4) out.push(v.getUint32(t.pos + 4 * i, true));
      else if (t.tipo === 16) out.push(u64(t.pos + 8 * i));
      else if (t.tipo === 12) out.push(v.getFloat64(t.pos + 8 * i, true));
      else throw new Error(`tipo ${t.tipo} no previsto en la etiqueta ${tag}`);
    }
    return out;
  };
  // Lo que este lector sabe leer: RGBA de 8 bits, una fila por bloque, deflate sin predictor.
  const [ancho] = leer(256), [alto] = leer(257), [muestras] = leer(277), [filas] = leer(278), [comp] = leer(259), [pred] = leer(317);
  if (muestras !== 4 || filas !== 1 || comp !== 8 || pred !== 1) throw new Error(`formato inesperado (muestras ${muestras}, filas ${filas}, compresión ${comp}, predictor ${pred})`);
  const escala = leer(33550), amarre = leer(33922);
  return { ancho, alto, offsets: leer(273), bytes: leer(279), oeste: amarre[3], norte: amarre[4], paso: escala[0] };
}

/** Separa una respuesta multipart/byteranges en sus pedazos, por posición de inicio en el archivo. */
function partes(cuerpo: Uint8Array, frontera: string, total: number): Map<number, Uint8Array> {
  const out = new Map<number, Uint8Array>();
  const sep = new TextEncoder().encode(`--${frontera}`);
  const txt = new TextDecoder("latin1");
  let i = 0;
  while (i < cuerpo.length) {
    // Busca la siguiente frontera y lee sus cabeceras hasta la línea vacía.
    let j = i;
    for (; j <= cuerpo.length - sep.length; j++) { let ok = true; for (let k = 0; k < sep.length; k++) if (cuerpo[j + k] !== sep[k]) { ok = false; break; } if (ok) break; }
    if (j > cuerpo.length - sep.length) break;
    const finCab = (() => { for (let k = j; k < cuerpo.length - 3; k++) if (cuerpo[k] === 13 && cuerpo[k + 1] === 10 && cuerpo[k + 2] === 13 && cuerpo[k + 3] === 10) return k; return -1; })();
    if (finCab < 0) break;
    const cab = txt.decode(cuerpo.subarray(j, finCab));
    const m = /Content-Range:\s*bytes\s+(\d+)-(\d+)\/(\d+)/i.exec(cab);
    if (!m) { i = finCab + 4; continue; }
    if (Number.isFinite(total) && Number(m[3]) !== total) throw new Error("el archivo cambió a media lectura");
    const ini = Number(m[1]), largo = Number(m[2]) - ini + 1;
    out.set(ini, cuerpo.subarray(finCab + 4, finCab + 4 + largo));
    i = finCab + 4 + largo;
  }
  return out;
}

async function inflar(z: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([z]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export type CuadroRapido = { t: number; jpeg: Uint8Array; descargado: number; filas: number; cubiertos: number };

/** Arma el cuadro rápido de la toma más reciente. Devuelve null si ya se tiene esa toma. */
export async function armarCuadroRapido(yaTengo: (t: number) => Promise<boolean>, fetchImpl: typeof fetch = fetch, opciones: { soloTramos?: boolean } = {}): Promise<CuadroRapido | null> {
  const s = await fetchImpl(`${STAR_TIFF}.sha256`, { headers: AGENTE, cache: "no-store" });
  if (!s.ok) throw new Error(`la NOAA respondió ${s.status} a la huella`);
  const t = tomaDeNombre(await s.text());
  if (t === null) throw new Error("no se pudo leer la hora de la toma");
  if (await yaTengo(t)) return null;
  const c = await fetchImpl(STAR_TIFF, { headers: { ...AGENTE, range: "bytes=0-65535" }, cache: "no-store" });
  if (c.status !== 206) throw new Error(`la NOAA no dio el rango de la cabecera (${c.status})`);
  // Tamaño total del archivo de esta toma (de «bytes 0-65535/TOTAL»): cada respuesta posterior debe ser del mismo archivo.
  const total = Number(/\/(\d+)$/.exec(c.headers.get("content-range") ?? "")?.[1] ?? NaN);
  const tiff = leerCabecera(new Uint8Array(await c.arrayBuffer()));
  let descargado = 65536;

  // Fila de origen para cada fila de salida (Web Mercator → grados) y columna de origen para cada columna.
  const g = REGIONES.mexico, W = g.ancho, H = altoDe(g);
  const yN = Math.log(Math.tan(Math.PI / 4 + (g.norte * Math.PI) / 360)), yS = Math.log(Math.tan(Math.PI / 4 + (g.sur * Math.PI) / 360));
  const filaDe: number[] = [];
  for (let r = 0; r < H; r++) {
    const y = yN - ((r + 0.5) / H) * (yN - yS);
    const lat = (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI);
    const f = Math.floor((tiff.norte - lat) / tiff.paso);
    filaDe.push(f >= 0 && f < tiff.alto ? f : -1);
  }
  const colDe = Array.from({ length: W }, (_, c) => Math.floor((g.oeste + ((c + 0.5) / W) * (g.este - g.oeste) - tiff.oeste) / tiff.paso));
  // Las filas enteramente fuera de la toma vienen vacías (posición y tamaño 0): no se piden y quedan sin dato.
  for (let r = 0; r < H; r++) if (filaDe[r] >= 0 && !tiff.bytes[filaDe[r]]) filaDe[r] = -1;
  const necesarias = [...new Set(filaDe.filter((f) => f >= 0))].sort((a, b) => a - b);

  // Pide las filas. Primero, en pocos pedidos de rangos sueltos (~3 MB). Desde la red de Cloudflare la NOAA responde esos pedidos
  // con el archivo completo (200, 25 MB): en cuanto pasa, se corta la descarga y se piden pocos tramos continuos con un solo rango
  // cada uno (~14 MB, sí funciona). Si el archivo cambia a media lectura (otra toma, otro tamaño), se aborta.
  const crudas = new Map<number, Uint8Array>();
  const mismoArchivo = (r: Response) => { const t = Number(/\/(\d+)$/.exec(r.headers.get("content-range") ?? "")?.[1] ?? NaN); return !Number.isFinite(total) || t === total; };
  let sueltos = !opciones.soloTramos;
  for (let i = 0; sueltos && i < necesarias.length; i += RANGOS_POR_PEDIDO) {
    const lote = necesarias.slice(i, i + RANGOS_POR_PEDIDO);
    const rango = lote.map((f) => `${tiff.offsets[f]}-${tiff.offsets[f] + tiff.bytes[f] - 1}`).join(",");
    const r = await fetchImpl(STAR_TIFF, { headers: { ...AGENTE, range: `bytes=${rango}` }, cache: "no-store" });
    if (r.status !== 206) { await r.body?.cancel(); sueltos = false; break; }
    const tipo = r.headers.get("content-type") ?? "";
    const frontera = /boundary=([^;]+)/i.exec(tipo)?.[1];
    if (!frontera && !mismoArchivo(r)) { await r.body?.cancel(); throw new Error("el archivo cambió a media lectura"); }
    const cuerpo = new Uint8Array(await r.arrayBuffer()); descargado += cuerpo.length;
    if (!frontera) crudas.set(tiff.offsets[lote[0]], cuerpo);
    else for (const [ini, pedazo] of partes(cuerpo, frontera.trim(), total)) crudas.set(ini, pedazo);
  }
  if (!sueltos) {
    crudas.clear();
    const TRAMOS = 4;
    const tam = Math.ceil(necesarias.length / TRAMOS);
    const tramos = Array.from({ length: TRAMOS }, (_, k) => necesarias.slice(k * tam, (k + 1) * tam)).filter((x) => x.length);
    await Promise.all(tramos.map(async (filasTramo) => {
      const ini = tiff.offsets[filasTramo[0]], fin = tiff.offsets[filasTramo[filasTramo.length - 1]] + tiff.bytes[filasTramo[filasTramo.length - 1]] - 1;
      const r = await fetchImpl(STAR_TIFF, { headers: { ...AGENTE, range: `bytes=${ini}-${fin}` }, cache: "no-store" });
      if (r.status !== 206 || !mismoArchivo(r)) { await r.body?.cancel(); throw new Error(`el archivo cambió a media lectura o no dio el tramo (${r.status})`); }
      const cuerpo = new Uint8Array(await r.arrayBuffer()); descargado += cuerpo.length;
      for (const f of filasTramo) crudas.set(tiff.offsets[f], cuerpo.subarray(tiff.offsets[f] - ini, tiff.offsets[f] - ini + tiff.bytes[f]));
    }));
  }

  // Descomprime cada fila y toma las columnas de la ventana. Fuera de la toma (alfa 0) queda negro: el mapa lo vuelve transparente.
  const px = new Uint8Array(W * H * 4);
  const filas = new Map<number, Uint8Array>();
  for (const f of necesarias) {
    const z = crudas.get(tiff.offsets[f]);
    if (!z) throw new Error(`faltó la fila ${f}`);
    filas.set(f, await inflar(z));
  }
  let cubiertos = 0;
  for (let r = 0; r < H; r++) {
    const fila = filaDe[r] >= 0 ? filas.get(filaDe[r]) : undefined;
    for (let c = 0; c < W; c++) {
      const o = (r * W + c) * 4, sc = colDe[c];
      px[o + 3] = 255;
      if (!fila || sc < 0 || sc >= tiff.ancho) continue;
      const q = sc * 4;
      if (fila[q + 3] === 0) continue;
      px[o] = fila[q]; px[o + 1] = fila[q + 1]; px[o + 2] = fila[q + 2]; cubiertos++;
    }
  }
  const jpeg = new Uint8Array(encode({ width: W, height: H, data: px }, CALIDAD).data);
  return { t, jpeg, descargado, filas: necesarias.length, cubiertos };
}

/** A demanda: si el último cuadro rápido es viejo y nadie más lo está haciendo, arma el de la toma más reciente y lo guarda. */
export async function actualizarRapido(env: Env, ahora: number, fetchImpl: typeof fetch = fetch): Promise<string> {
  // Candado de un minuto (dos visitantes a la vez no lo hacen dos veces); se alarga a tres mientras se procesa.
  const toma = await env.DB_PLATAFORMA.prepare("INSERT INTO clima_bloqueos (clave, hasta) VALUES ('satelite-rapido', ?) ON CONFLICT(clave) DO UPDATE SET hasta = excluded.hasta WHERE clima_bloqueos.hasta < ?").bind(iso(ahora + 180_000), iso(ahora)).run();
  if (!toma.meta.changes) return "otro ya lo revisa";
  try {
    const c = await armarCuadroRapido(async (t) => !!(await env.DATOS.head(`${PREFIJO_RAPIDO}/${claveTiempo(t)}.jpg`)), fetchImpl);
    if (!c) return "nada";
    const huella = [...new Uint8Array(await crypto.subtle.digest("SHA-256", c.jpeg))].map((x) => x.toString(16).padStart(2, "0")).join("");
    await env.DATOS.put(`${PREFIJO_RAPIDO}/${claveTiempo(c.t)}.jpg`, c.jpeg, { httpMetadata: { contentType: "image/jpeg" }, customMetadata: { fuente: "noaa-star", sha256: huella } });
    await rehacerManifiesto(env, Date.now());
    return `${iso(c.t).slice(11, 16)} (${Math.round(c.jpeg.length / 1024)} KB; ${c.filas} filas, ${(c.descargado / 1048576).toFixed(1)} MB bajados)`;
  } finally {
    // Al terminar se suelta a un minuto: la próxima revisión de la huella puede ser dentro de un minuto, no antes.
    await env.DB_PLATAFORMA.prepare("UPDATE clima_bloqueos SET hasta = ? WHERE clave = 'satelite-rapido'").bind(iso(Date.now() + 60_000)).run();
  }
}

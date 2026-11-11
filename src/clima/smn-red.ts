// Pedidos al servidor del SMN (smn.conagua.gob.mx) que dejan constancia de cada falla.
//
// Medido el 11 de noviembre de 2026: desde la red de Cloudflare el servidor del SMN falla a ratos. El pronóstico por municipios
// respondió HTTP 530 a las 07:19 y a las 08:19 UTC y volvió a las 10:19; en el mismo lapso faltan vueltas del índice de avisos
// (05:28, 05:48, 06:38, 07:23, 08:18, 08:38, 09:03, 10:23). Desde fuera de Cloudflare el mismo servicio respondía 200. El código
// solo no dice quién falla: por eso cada falla se guarda con su código, sus cabeceras (un `cf-ray` con cuerpo «error code: 1xxx»
// es del borde de Cloudflare; una página de Apache es del SMN) y los primeros 400 bytes del cuerpo.
import type { Env } from "../index";

export type Intento = { metodo: string; estado: number | null; ms: number; error?: string; cabeceras?: Record<string, string>; cuerpo?: string };

/** Los primeros `n` bytes del cuerpo, sin bajar el resto. */
async function primeros(r: Response, n: number): Promise<string> {
  if (!r.body) return "";
  const lector = r.body.getReader();
  const partes: Uint8Array[] = [];
  let largo = 0;
  try {
    while (largo < n) {
      const { value, done } = await lector.read();
      if (done) break;
      partes.push(value);
      largo += value.length;
    }
  } finally {
    lector.cancel().catch(() => {});
  }
  const b = new Uint8Array(Math.min(largo, n));
  let o = 0;
  for (const p of partes) {
    const t = p.subarray(0, Math.min(p.length, b.length - o));
    b.set(t, o);
    o += t.length;
    if (o >= b.length) break;
  }
  return new TextDecoder().decode(b);
}

/**
 * Pide una URL del SMN y anota cada intento en `intentos`. Ante una falla de red o una respuesta 5xx espera `esperaMs` y vuelve a
 * pedir, hasta `reintentos` veces. Devuelve la respuesta buena, la respuesta 4xx tal cual (no se reintenta), o null.
 */
export async function pedirSmn(
  url: string, init: RequestInit, intentos: Intento[],
  op: { fetchImpl?: typeof fetch; reintentos?: number; esperaMs?: number } = {},
): Promise<Response | null> {
  const f = op.fetchImpl ?? fetch, veces = 1 + (op.reintentos ?? 1), metodo = init.method ?? "GET";
  for (let k = 0; k < veces; k++) {
    if (k > 0) await new Promise((listo) => setTimeout(listo, op.esperaMs ?? 15_000));
    const t0 = Date.now();
    try {
      const r = await f(url, init);
      if (r.ok) {
        intentos.push({ metodo, estado: r.status, ms: Date.now() - t0 });
        return r;
      }
      const cabeceras = Object.fromEntries([...r.headers].map(([c, v]) => [c, v.slice(0, 160)]));
      const cuerpo = metodo === "HEAD" ? undefined : await primeros(r, 400).catch((e) => `(no se pudo leer: ${String(e).slice(0, 80)})`);
      intentos.push({ metodo, estado: r.status, ms: Date.now() - t0, cabeceras, cuerpo });
      if (r.status < 500) return r;
    } catch (e) {
      intentos.push({ metodo, estado: null, ms: Date.now() - t0, error: String(e).slice(0, 200) });
    }
  }
  return null;
}

export const fallo = (i: Intento) => i.estado === null || i.estado >= 400;

/** «el SMN respondió 530 (2 intentos)»: lo que se reporta cuando no hubo respuesta buena. */
export function motivo(intentos: Intento[]): string {
  const ultimo = intentos[intentos.length - 1];
  const veces = intentos.filter((i) => i.metodo !== "HEAD").length;
  const que = !ultimo ? "no hubo pedido" : ultimo.estado === null ? `falló la conexión con el SMN (${ultimo.error ?? "sin detalle"})` : `el SMN respondió ${ultimo.estado}`;
  return veces > 1 ? `${que} (${veces} intentos)` : que;
}

/** Guarda las fallas de una vuelta en clima_consultas (fuente `<pieza>_falla`). Nunca lanza. */
export async function anotarFallas(env: Env, instante: string, pieza: string, intentos: Intento[]): Promise<void> {
  const malos = intentos.filter(fallo);
  if (!malos.length) return;
  try {
    await env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO clima_consultas (instante, fuente, pedidos, nuevas, detalle) VALUES (?, ?, ?, 0, ?)")
      .bind(instante, `${pieza}_falla`, intentos.length, JSON.stringify({ intentos }).slice(0, 8000)).run();
  } catch { /* sin tabla o sin base: la falla ya quedó en el registro del Worker */ }
}

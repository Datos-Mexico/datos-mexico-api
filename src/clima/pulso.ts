// Reporte al pulso del Protocolo DPM de los dos datos del clima oficial, como cualquier otro sistema: con llave, por HTTP.
// - `clima-estaciones`: la medición oficial. Fuente por calendario de una hora (la red sinóptica del SMN): queda fuera de clase
//   por la fuente, siempre, y así se publica. Se reporta un refresco en cada minuto en que el observatorio consultó la fuente.
// - `clima-entrega`: la entrega en vivo. Vía de entrega; el evento es la llegada de cada lectura al observatorio (latencia de
//   la fuente cero por definición), y la clase la fija la peor latencia medida hasta la confirmación del navegador.
// Las dos se muestran separadas y en ese orden; ninguna frase las junta.
import type { Env } from "../index";
import { fila } from "../lib/db";
import { marcarEntregasReportadas, pendientesEntregas } from "./envivo";
import { SINOPTICA_FUENTE, SINOPTICA_RELOJ_MS, type ResultadoSinoptica } from "./sinoptica";

const SISTEMA = "datos-mexico";
const PULSO = "https://api.datosmexico.org/dpm/v1";
const API = "https://api.datosmexico.org/api/v1/clima";
const iso = (d: Date | number) => new Date(d).toISOString();
const minutoIso = (d: Date) => iso(Math.floor(d.getTime() / 60_000) * 60_000);

export async function reportarClimaOficial(env: Env, ahora: Date, sin: ResultadoSinoptica, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!env.DPM_LLAVE_DATOS_MEXICO) return "sin llave: no se reporta";
  const base = env.DPM_PULSO_URL ?? PULSO;
  const cab = { "content-type": "application/json", authorization: `Bearer ${env.DPM_LLAVE_DATOS_MEXICO}` };
  const resumenes: Record<string, unknown>[] = [];
  if (sin.consultas > 0) resumenes.push({ dato: "clima-estaciones", minuto: minutoIso(ahora), refrescos: 1, primero: iso(ahora), ultimo: iso(ahora), intervalo_max_ms: 0, observaciones: sin.nuevas - sin.marcadas });
  let minutos: string[] = [];
  try {
    const pend = await pendientesEntregas(env, minutoIso(ahora));
    minutos = pend.map((p) => p.minuto);
    for (const p of pend) resumenes.push({ dato: "clima-entrega", minuto: p.minuto, refrescos: 0, primero: iso(p.primero_ms), ultimo: iso(p.ultimo_ms), intervalo_max_ms: 0, observaciones: 0, entregas: p.entregas, latencia_entrega_max_ms: p.latencia_max_ms });
  } catch (e) { console.error("clima en vivo: pendientes", e); }
  if (ahora.getUTCMinutes() === 9) await declarar(env, base, cab, fetchImpl);
  if (!resumenes.length) return "nada que reportar";
  const cuerpo = JSON.stringify({ sistema: SISTEMA, resumenes });
  let r = await fetchImpl(`${base}/resumenes`, { method: "POST", headers: cab, body: cuerpo });
  if (r.status === 404) { await declarar(env, base, cab, fetchImpl); r = await fetchImpl(`${base}/resumenes`, { method: "POST", headers: cab, body: cuerpo }); }
  if (r.ok && minutos.length) await marcarEntregasReportadas(env, minutos);
  return `${r.status} (${resumenes.length} resúmenes)`;
}

async function declarar(env: Env, base: string, cab: Record<string, string>, fetchImpl: typeof fetch): Promise<void> {
  const ultima = (await fila<{ t: string | null }>(env.DB_PLATAFORMA, "SELECT MAX(llegado_en) AS t FROM clima_medicion"))?.t ?? null;
  await fetchImpl(`${base}/datos/${SISTEMA}/clima-estaciones`, { method: "PUT", headers: cab, body: JSON.stringify({ nombre: "Medición oficial del clima en las 32 capitales (SMN, cada hora)", fuente: SINOPTICA_FUENTE, fuente_tipo: "calendario", reloj_fuente_ms: SINOPTICA_RELOJ_MS, via: "consulta", url_comprobacion: `${API}/comprobacion/estaciones`, modo: "custodiado", ultima_verificacion: ultima }) }).catch(() => null);
  await fetchImpl(`${base}/datos/${SISTEMA}/clima-entrega`, { method: "PUT", headers: cab, body: JSON.stringify({ nombre: "Entrega en vivo del clima de las 32 capitales (no es la antigüedad de la medición)", fuente: "Datos México: el evento es la llegada de cada lectura (medición oficial, aeropuerto o pronóstico) al observatorio", fuente_tipo: "evento", latencia_fuente_ms: 0, via: "entrega", url_comprobacion: `${API}/comprobacion/entrega`, modo: "custodiado", ultima_verificacion: ultima }) }).catch(() => null);
}

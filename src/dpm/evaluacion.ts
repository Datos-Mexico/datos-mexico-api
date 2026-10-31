// Pulso del Protocolo DPM: cálculo de la clase de cada dato (PULSO.md §7) y del estado de adhesión (§8).
// Corre una vez por minuto desde el disparador programado del worker y a demanda desde /dpm/v1/admin/evaluar.
import type { Env } from "../index";
import { fila, filas } from "../lib/db";
import { type Clase, DIAS_PARA_VERIFICADA, GRACIA_MS, VENTANA_MS, clasePorIntervalo, fechaMx, iso, menosFina, pisoMinuto, rangoUtcDeFechaMx, sumarDias } from "./comun";

type DatoFila = { sistema: string; dato: string; reloj_fuente_ms: number | null; clase: Clase };
type Resumen = { primero: string; ultimo: string; intervalo_max_ms: number };

/**
 * Evalúa la clase de todos los datos al cierre del minuto T = piso(ahora) − 5 min.
 * El desfase de cinco minutos es la gracia de puntualidad del §4: al evaluar T ya llegó todo lo que puede contar como puntual
 * para los minutos anteriores a T, y lo que llegue después es tardío y no reescribe la clase (§1.3).
 */
export async function evaluarClases(env: Env, ahora: Date): Promise<{ instante_evaluado: string; evaluados: number; cambios: number }> {
  const T = new Date(pisoMinuto(ahora).getTime() - GRACIA_MS);
  const S = new Date(T.getTime() - VENTANA_MS);
  const tIso = iso(T), sIso = iso(S), ahoraIso = iso(ahora);
  const datos = await filas<DatoFila>(env.DB_DPM, "SELECT sistema, dato, reloj_fuente_ms, clase FROM datos ORDER BY sistema, dato");
  const sentencias: D1PreparedStatement[] = [];
  let cambios = 0;
  for (const d of datos) {
    // §7.2 cobertura: hace falta un resumen puntual anterior al inicio de la ventana.
    const anterior = await fila<Resumen>(env.DB_DPM, "SELECT primero, ultimo, intervalo_max_ms FROM resumenes WHERE sistema = ? AND dato = ? AND puntual = 1 AND minuto < ? ORDER BY minuto DESC LIMIT 1", [d.sistema, d.dato, sIso]);
    let nueva: Clase; let w: number | null = null;
    if (!anterior) {
      nueva = "sin-ventana";
    } else {
      const cubetas = await filas<Resumen>(env.DB_DPM, "SELECT primero, ultimo, intervalo_max_ms FROM resumenes WHERE sistema = ? AND dato = ? AND puntual = 1 AND minuto >= ? AND minuto < ? ORDER BY minuto", [d.sistema, d.dato, sIso, tIso]);
      // §7.3 peor intervalo: dentro de cada cubeta, entre cubetas consecutivas (incluida la anterior a la ventana) y hasta T.
      let prev = Date.parse(anterior.ultimo); let W = 0;
      for (const b of cubetas) {
        W = Math.max(W, Date.parse(b.primero) - prev, b.intervalo_max_ms);
        prev = Date.parse(b.ultimo);
      }
      W = Math.max(W, T.getTime() - prev);
      w = W;
      nueva = menosFina(clasePorIntervalo(W), clasePorIntervalo(d.reloj_fuente_ms)); // §7.4 y §7.5
    }
    if (nueva !== d.clase) {
      cambios++;
      sentencias.push(env.DB_DPM.prepare("INSERT OR REPLACE INTO clases (sistema, dato, desde, clase, w_ms) VALUES (?, ?, ?, ?, ?)").bind(d.sistema, d.dato, tIso, nueva, w));
      sentencias.push(env.DB_DPM.prepare("UPDATE datos SET clase = ?, clase_desde = ?, w_ms = ?, instante_evaluado = ?, evaluado_en = ? WHERE sistema = ? AND dato = ?").bind(nueva, tIso, w, tIso, ahoraIso, d.sistema, d.dato));
    } else {
      sentencias.push(env.DB_DPM.prepare("UPDATE datos SET w_ms = ?, instante_evaluado = ?, evaluado_en = ? WHERE sistema = ? AND dato = ?").bind(w, tIso, ahoraIso, d.sistema, d.dato));
    }
  }
  if (sentencias.length) await env.DB_DPM.batch(sentencias);
  return { instante_evaluado: tIso, evaluados: datos.length, cambios };
}

/**
 * §8 estado de adhesión: pasa a verificada con al menos un resumen puntual en cada uno de los últimos siete días civiles
 * completos (America/Mexico_City); vuelve a declarada tras siete días completos sin ninguno. Entre ambos extremos no cambia.
 */
export async function evaluarEstados(env: Env, ahora: Date): Promise<{ sistemas: number; cambios: number }> {
  const hoy = fechaMx(ahora);
  const desde = rangoUtcDeFechaMx(sumarDias(hoy, -DIAS_PARA_VERIFICADA)).inicio;
  const hasta = rangoUtcDeFechaMx(sumarDias(hoy, -1)).fin;
  const sistemas = await filas<{ sistema: string; estado: "declarada" | "verificada" }>(env.DB_DPM, "SELECT sistema, estado FROM sistemas");
  const sentencias: D1PreparedStatement[] = []; let cambios = 0;
  for (const s of sistemas) {
    const horas = await filas<{ h: string }>(env.DB_DPM, "SELECT DISTINCT substr(minuto, 1, 13) AS h FROM resumenes WHERE sistema = ? AND puntual = 1 AND minuto >= ? AND minuto < ?", [s.sistema, iso(desde), iso(hasta)]);
    const dias = new Set(horas.map((r) => fechaMx(Date.parse(r.h + ":00:00.000Z")))).size;
    let nuevo: "declarada" | "verificada" | null = null;
    if (s.estado === "declarada" && dias >= DIAS_PARA_VERIFICADA) nuevo = "verificada";
    if (s.estado === "verificada" && dias === 0) nuevo = "declarada";
    if (nuevo) {
      cambios++;
      sentencias.push(env.DB_DPM.prepare("UPDATE sistemas SET estado = ? WHERE sistema = ?").bind(nuevo, s.sistema));
      sentencias.push(env.DB_DPM.prepare("INSERT OR REPLACE INTO estados (sistema, desde, estado) VALUES (?, ?, ?)").bind(s.sistema, iso(ahora), nuevo));
    }
  }
  if (sentencias.length) await env.DB_DPM.batch(sentencias);
  return { sistemas: sistemas.length, cambios };
}

/** Ciclo del disparador programado: clases cada minuto; estados una vez por hora (minuto 5). */
export async function cicloPulso(env: Env, ahora: Date) {
  const clases = await evaluarClases(env, ahora);
  const estados = ahora.getUTCMinutes() === 5 ? await evaluarEstados(env, ahora) : null;
  return { clases, estados };
}

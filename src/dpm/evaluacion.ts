// Pulso del Protocolo DPM: cálculo de la clase de cada dato (PULSO.md §7) y del estado de adhesión (§8).
// Corre una vez por minuto desde el disparador programado del worker y a demanda desde /dpm/v1/admin/evaluar.
import type { Env } from "../index";
import { fila, filas } from "../lib/db";
import { type Clase, COMPROBACION_CADA_MIN, COMPROBACION_FALLAS, COMPROBACION_PLAZO_MS, COMPROBACION_TOLERANCIA_MS, DIAS_PARA_VERIFICADA, GRACIA_MS, VENTANA_MS, clasePorIntervalo, fechaMx, iso, menosFina, pisoMinuto, rangoUtcDeFechaMx, sumarDias } from "./comun";

type DatoFila = { sistema: string; dato: string; reloj_fuente_ms: number | null; fuente_tipo: "calendario" | "evento"; latencia_fuente_ms: number | null; via: "consulta" | "entrega"; url_comprobacion: string | null; nombre: string; fuente: string; modo: string; ultima_verificacion: string | null; clase: Clase };
type Resumen = { primero: string; ultimo: string; intervalo_max_ms: number; eventos: number | null; latencia_fuente_max_ms: number | null; entregas: number | null; latencia_entrega_max_ms: number | null };

/**
 * Evalúa la clase de todos los datos al cierre del minuto T = piso(ahora) − 5 min.
 * El desfase de cinco minutos es la gracia de puntualidad del §4: al evaluar T ya llegó todo lo que puede contar como puntual
 * para los minutos anteriores a T, y lo que llegue después es tardío y no reescribe la clase (§1.3).
 */
export async function evaluarClases(env: Env, ahora: Date): Promise<{ instante_evaluado: string; evaluados: number; cambios: number }> {
  const T = new Date(pisoMinuto(ahora).getTime() - GRACIA_MS);
  const S = new Date(T.getTime() - VENTANA_MS);
  const tIso = iso(T), sIso = iso(S), ahoraIso = iso(ahora);
  const datos = await filas<DatoFila>(env.DB_DPM, "SELECT sistema, dato, reloj_fuente_ms, fuente_tipo, latencia_fuente_ms, via, url_comprobacion, nombre, fuente, modo, ultima_verificacion, clase FROM datos ORDER BY sistema, dato");
  const sentencias: D1PreparedStatement[] = [];
  let cambios = 0;
  const COLS = "primero, ultimo, intervalo_max_ms, eventos, latencia_fuente_max_ms, entregas, latencia_entrega_max_ms";
  for (const d of datos) {
    const cubetas = await filas<Resumen>(env.DB_DPM, `SELECT ${COLS} FROM resumenes WHERE sistema = ? AND dato = ? AND puntual = 1 AND minuto >= ? AND minuto < ? ORDER BY minuto`, [d.sistema, d.dato, sIso, tIso]);
    let nueva: Clase; let w: number | null = null;
    // §7.4 clase por reloj, según la vía.
    if (d.via === "entrega") {
      // Vía de entrega: W es la peor latencia de extremo a extremo de las entregas de la ventana; sin entregas, sin ventana.
      const conEntregas = cubetas.filter((b) => (b.entregas ?? 0) > 0 && b.latencia_entrega_max_ms !== null);
      if (conEntregas.length === 0) nueva = "sin-ventana";
      else { w = Math.max(...conEntregas.map((b) => b.latencia_entrega_max_ms as number)); nueva = clasePorIntervalo(w); }
    } else {
      // §7.2 cobertura: hace falta un resumen puntual anterior al inicio de la ventana.
      const anterior = await fila<Resumen>(env.DB_DPM, `SELECT ${COLS} FROM resumenes WHERE sistema = ? AND dato = ? AND puntual = 1 AND minuto < ? ORDER BY minuto DESC LIMIT 1`, [d.sistema, d.dato, sIso]);
      if (!anterior) nueva = "sin-ventana";
      else {
        // §7.3 peor intervalo: dentro de cada cubeta, entre cubetas consecutivas (incluida la anterior a la ventana) y hasta T.
        let prev = Date.parse(anterior.ultimo); let W = 0;
        for (const b of cubetas) {
          W = Math.max(W, Date.parse(b.primero) - prev, b.intervalo_max_ms);
          prev = Date.parse(b.ultimo);
        }
        W = Math.max(W, T.getTime() - prev);
        w = W; nueva = clasePorIntervalo(W);
      }
    }
    // §7.5 cota de la fuente, según el tipo de fuente.
    if (nueva !== "sin-ventana") {
      if (d.fuente_tipo === "evento") {
        const observada = cubetas.filter((b) => (b.eventos ?? 0) > 0 && b.latencia_fuente_max_ms !== null).map((b) => b.latencia_fuente_max_ms as number);
        const peorObservada = observada.length ? Math.max(...observada) : null;
        if (d.latencia_fuente_ms === null) nueva = "fuera-de-clase";
        else {
          if (peorObservada !== null && peorObservada > d.latencia_fuente_ms) {
            // La realidad supera lo declarado: el pulso eleva la latencia declarada y lo deja en el historial del catálogo.
            sentencias.push(env.DB_DPM.prepare("UPDATE datos SET latencia_fuente_ms = ? WHERE sistema = ? AND dato = ?").bind(peorObservada, d.sistema, d.dato));
            sentencias.push(env.DB_DPM.prepare("INSERT OR REPLACE INTO datos_historial (sistema, dato, desde, nombre, fuente, reloj_fuente_ms, fuente_tipo, latencia_fuente_ms, via, modo, ultima_verificacion, nota) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(d.sistema, d.dato, tIso, d.nombre, d.fuente, d.reloj_fuente_ms, d.fuente_tipo, peorObservada, d.via, d.modo, d.ultima_verificacion, `latencia de la fuente elevada por el pulso de ${d.latencia_fuente_ms} a ${peorObservada} ms (observada en la ventana)`));
            d.latencia_fuente_ms = peorObservada;
          }
          nueva = menosFina(nueva, clasePorIntervalo(peorObservada ?? d.latencia_fuente_ms));
        }
      } else {
        nueva = menosFina(nueva, clasePorIntervalo(d.reloj_fuente_ms));
      }
    }
    // §7 bis (0.4): sin dirección de comprobación no hay clase; tres comprobaciones seguidas fallidas tampoco.
    if (nueva !== "sin-ventana" && nueva !== "fuera-de-clase") {
      if (!d.url_comprobacion) nueva = "fuera-de-clase";
      else {
        const ultimas = await filas<{ resultado: string }>(env.DB_DPM, "SELECT resultado FROM comprobaciones WHERE sistema = ? AND dato = ? ORDER BY instante DESC LIMIT ?", [d.sistema, d.dato, COMPROBACION_FALLAS]);
        if (ultimas.length >= COMPROBACION_FALLAS && ultimas.every((u) => u.resultado !== "coincide")) nueva = "fuera-de-clase";
      }
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

type Vista = { ultimo_refresco?: unknown; refrescos_ultima_hora?: unknown };
/**
 * §7 bis comprobación de cara pública: cada diez minutos el pulso consulta por su cuenta la dirección pública de cada dato,
 * guarda lo que vio y lo compara con lo reportado (último refresco a ±5 min; refrescos de la última hora a ±20 %, con margen
 * absoluto de dos). Vía de entrega: última entrega y entregas de la hora.
 */
export async function comprobarCaraPublica(env: Env, ahora: Date, fetchImpl: typeof fetch = fetch): Promise<{ comprobados: number; coinciden: number }> {
  const datos = await filas<{ sistema: string; dato: string; via: "consulta" | "entrega"; url_comprobacion: string }>(env.DB_DPM, "SELECT sistema, dato, via, url_comprobacion FROM datos WHERE url_comprobacion IS NOT NULL");
  const hace1h = iso(ahora.getTime() - 60 * 60_000); const ahoraIso = iso(ahora);
  const sentencias: D1PreparedStatement[] = []; let coinciden = 0;
  for (const d of datos) {
    const col = d.via === "entrega" ? "entregas" : "refrescos";
    const rep = await fila<{ ultimo: string | null; n: number | null }>(env.DB_DPM, `SELECT MAX(ultimo) AS ultimo, SUM(COALESCE(${col}, 0)) AS n FROM resumenes WHERE sistema = ? AND dato = ? AND minuto >= ?`, [d.sistema, d.dato, hace1h]);
    const ultimoRep = (await fila<{ u: string | null }>(env.DB_DPM, "SELECT MAX(ultimo) AS u FROM resumenes WHERE sistema = ? AND dato = ?", [d.sistema, d.dato]))?.u ?? null;
    const nRep = rep?.n ?? 0;
    let resultado: "coincide" | "no-coincide" | "sin-respuesta" = "sin-respuesta"; let detalle = ""; let visto: string | null = null; let nVisto: number | null = null;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), COMPROBACION_PLAZO_MS);
      const r = await fetchImpl(d.url_comprobacion, { signal: ctl.signal, headers: { accept: "application/json", "user-agent": "pulso-dpm/0.4 (+https://datosmexico.org/dpm)" } }).finally(() => clearTimeout(t));
      if (!r.ok) detalle = `HTTP ${r.status}`;
      else {
        const j = (await r.json()) as Vista;
        const u = typeof j.ultimo_refresco === "string" && Number.isFinite(Date.parse(j.ultimo_refresco)) ? j.ultimo_refresco : null;
        const n = typeof j.refrescos_ultima_hora === "number" && Number.isFinite(j.refrescos_ultima_hora) ? Math.round(j.refrescos_ultima_hora) : null;
        const sinRefrescosPublicados = j.ultimo_refresco === null && n === 0;
        if (n === null || (u === null && !sinRefrescosPublicados)) detalle = "respuesta sin ultimo_refresco o refrescos_ultima_hora válidos";
        else if (u === null) {
          // La cara pública dice que nunca ha habido refrescos: coincide si el sistema tampoco reportó ninguno.
          nVisto = 0;
          if (ultimoRep === null && nRep === 0) { resultado = "coincide"; detalle = "sin refrescos en la cara pública ni en lo reportado"; }
          else { resultado = "no-coincide"; detalle = `la cara pública no registra refrescos pero el sistema reportó ${nRep} en la última hora (último ${ultimoRep})`; }
        } else {
          visto = iso(Date.parse(u)); nVisto = n;
          if (ultimoRep === null) { resultado = "no-coincide"; detalle = "el sistema no ha reportado ningún refresco"; }
          else {
            const dMs = Math.abs(Date.parse(visto) - Date.parse(ultimoRep));
            const margen = Math.max(2, Math.ceil(0.2 * Math.max(nVisto, nRep)));
            const okUltimo = dMs <= COMPROBACION_TOLERANCIA_MS, okN = Math.abs(nVisto - nRep) <= margen;
            resultado = okUltimo && okN ? "coincide" : "no-coincide";
            detalle = `último: visto ${visto} vs reportado ${ultimoRep} (${Math.round(dMs / 1000)} s); última hora: vistos ${nVisto} vs reportados ${nRep} (margen ${margen})`;
          }
        }
      }
    } catch (e) { detalle = String(e).slice(0, 160); }
    if (resultado === "coincide") coinciden++;
    sentencias.push(env.DB_DPM.prepare("INSERT OR REPLACE INTO comprobaciones (sistema, dato, instante, resultado, ultimo_refresco_visto, refrescos_hora_vistos, ultimo_reportado, refrescos_hora_reportados, detalle) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(d.sistema, d.dato, ahoraIso, resultado, visto, nVisto, ultimoRep, nRep, detalle));
  }
  // Historial acotado: 90 días.
  sentencias.push(env.DB_DPM.prepare("DELETE FROM comprobaciones WHERE instante < ?").bind(iso(ahora.getTime() - 90 * 86400_000)));
  if (sentencias.length) await env.DB_DPM.batch(sentencias);
  return { comprobados: datos.length, coinciden };
}

/** Ciclo del disparador programado: comprobación cada diez minutos (antes de las clases), clases cada minuto, estados una vez por hora (minuto 5). */
export async function cicloPulso(env: Env, ahora: Date) {
  const comprobacion = ahora.getUTCMinutes() % COMPROBACION_CADA_MIN === 0 ? await comprobarCaraPublica(env, ahora).catch((e) => ({ error: String(e).slice(0, 160) })) : null;
  const clases = await evaluarClases(env, ahora);
  const estados = ahora.getUTCMinutes() === 5 ? await evaluarEstados(env, ahora) : null;
  return { comprobacion, clases, estados };
}

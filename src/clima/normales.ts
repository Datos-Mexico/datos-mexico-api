// «Hoy frente a lo normal» de cada capital. Dos piezas del SMN, sin mezclarlas:
// - Lo de hoy: la máxima y la mínima del día según los termómetros de máxima y de mínima del observatorio, que el SMN manda en
//   la sinóptica (BUFR 012111 y 012112): la mínima de la noche en el mensaje de las 12 UTC (00–12 UTC) y la máxima del día en el
//   de las 00 UTC siguiente (12–00 UTC). Verificado en los mensajes de las 32 capitales el 10–11 de noviembre de 2026: es la
//   misma convención en todas. Mientras llega la máxima, se dice «hasta ahora» con la mayor lectura horaria (que nunca supera
//   al termómetro de máxima).
// - Lo normal: la normal climatológica oficial del observatorio (por mes) y la distribución de ese día del año en el registro
//   diario del mismo observatorio (scripts/clima/generar_normales.py), con la que se dice qué tan raro es el día.
import { fila, filas } from "../lib/db";
import { decodificarBufr } from "./bufr";
import { extraerExtremos } from "./sinoptica-extraer";
import { ESTACIONES } from "./estaciones";

/** Zona horaria de cada capital (la hora local de su día). */
export const ZONA: Record<string, string> = Object.fromEntries(ESTACIONES.map((e) => [e.clave,
  e.clave === "02" ? "America/Tijuana" : e.clave === "26" ? "America/Hermosillo" : ["03", "18", "25"].includes(e.clave) ? "America/Mazatlan" : e.clave === "23" ? "America/Cancun" : "America/Mexico_City"]));

/** Fecha local (AAAA-MM-DD) de un instante en la zona de la capital. */
export function fechaLocal(clave: string, ms: number): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA[clave] ?? "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
/** Desfase de la zona en horas (UTC − local) en un instante: 6 para la Ciudad de México. */
export function desfaseHoras(clave: string, ms: number): number {
  const d = new Date(ms);
  const loc = new Date(d.toLocaleString("en-US", { timeZone: ZONA[clave] ?? "America/Mexico_City" }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((utc.getTime() - loc.getTime()) / 3600_000);
}

const PCTS = Array.from({ length: 21 }, (_, i) => i * 5);
/** Rango percentil (0–100) de un valor en una distribución dada por sus percentiles 0, 5, …, 100 (interpolación lineal). */
export function rangoPercentil(pct: number[], v: number): number {
  if (v <= pct[0]) return 0;
  if (v >= pct[20]) return 100;
  for (let i = 0; i < 20; i++) {
    const a = pct[i], b = pct[i + 1];
    if (v >= a && v <= b) return b === a ? (PCTS[i] + PCTS[i + 1]) / 2 : PCTS[i] + ((v - a) / (b - a)) * 5;
  }
  return 50;
}

type FilaDia = { dia: string; n_tmax: number; anios_tmax: number; media_tmax: number | null; pct_tmax: string | null; n_tmin: number; anios_tmin: number; media_tmin: number | null; pct_tmin: string | null; n_lluvia: number; frac_lluvia: number | null };
type FilaFuente = { distribucion_nivel: string; distribucion_periodo: string; distribucion_anios: number; normal_periodo: string | null; normal_url: string | null; normal_sha256: string | null; normal_emision: string | null; diario_url: string; diario_sha256: string; diario_emision: string | null; diario_hasta: string | null; generado_en: string };

/** Lo normal de una capital para una fecha (AAAA-MM-DD): normal oficial del mes y distribución del día. */
export async function normalDe(db: D1Database, clave: string, fecha: string) {
  const mes = Number(fecha.slice(5, 7)), dia = fecha.slice(5);
  const [mensual, d, f] = await Promise.all([
    filas<{ variable: string; mes: number; normal: number | null; anios: number | null; periodo: string | null }>(db, "SELECT variable, mes, normal, anios, periodo FROM clima_normal_mes WHERE clave = ? AND mes IN (?, 13)", [clave, mes]),
    fila<FilaDia>(db, "SELECT * FROM clima_normal_dia WHERE clave = ? AND dia = ?", [clave, dia]),
    fila<FilaFuente>(db, "SELECT distribucion_nivel, distribucion_periodo, distribucion_anios, normal_periodo, normal_url, normal_sha256, normal_emision, diario_url, diario_sha256, diario_emision, diario_hasta, generado_en FROM clima_normal_fuente WHERE clave = ?", [clave]),
  ]);
  if (!f) return null;
  const delMes = (v: string) => mensual.find((x) => x.variable === v && x.mes === mes) ?? null;
  const anual = (v: string) => mensual.find((x) => x.variable === v && x.mes === 13)?.normal ?? null;
  const [a0, a1] = f.distribucion_periodo.split("-").map(Number);
  const md = (dd: number) => { const t = new Date(Date.UTC(2001, mes - 1, Number(dia.slice(3)) + dd)); return `${t.getUTCDate()} de ${MESES[t.getUTCMonth()]}`; };
  return {
    oficial: f.normal_periodo ? {
      periodo: f.normal_periodo, mes,
      tmax_c: delMes("tmax")?.normal ?? null, tmin_c: delMes("tmin")?.normal ?? null, tmed_c: delMes("tmed")?.normal ?? null,
      lluvia_mm: delMes("lluvia_mm")?.normal ?? null, dias_lluvia: delMes("dias_lluvia")?.normal ?? null, lluvia_anual_mm: anual("lluvia_mm"),
      anios_con_datos: delMes("tmax")?.anios ?? null,
      fuente: { url: f.normal_url, sha256: f.normal_sha256, emision: f.normal_emision },
    } : null,
    sin_normal_oficial: f.normal_periodo ? null : "El SMN no publica normal climatológica 1991-2020 ni 1981-2010 para este observatorio (catálogo de la Base de Datos Climatológica Nacional, verificado el 11 de noviembre de 2026).",
    dia: d && (d.pct_tmax || d.pct_tmin) ? {
      fecha: dia, nivel: f.distribucion_nivel, periodo: f.distribucion_periodo, anios_periodo: f.distribucion_anios,
      ventana: `del ${md(-7)} al ${md(7)}, de ${a0} a ${a1}`,
      tmax: d.pct_tmax ? { n: d.n_tmax, anios: d.anios_tmax, media_c: d.media_tmax, percentiles: JSON.parse(d.pct_tmax) as number[] } : null,
      tmin: d.pct_tmin ? { n: d.n_tmin, anios: d.anios_tmin, media_c: d.media_tmin, percentiles: JSON.parse(d.pct_tmin) as number[] } : null,
      dias_con_lluvia_pct: d.frac_lluvia === null ? null : Math.round(d.frac_lluvia * 1000) / 10,
      fuente: { url: f.diario_url, sha256: f.diario_sha256, emision: f.diario_emision, datos_hasta: f.diario_hasta },
    } : null,
    sin_distribucion: d && (d.pct_tmax || d.pct_tmin) ? null : f.distribucion_nivel === "insuficiente"
      ? `El registro diario del SMN para este observatorio tiene ${f.distribucion_anios} años con dato entre 1991 y 2020: no alcanza para decir qué es normal.`
      : "Para esta fecha el registro diario del observatorio no tiene años suficientes.",
    nivel_explicado: f.distribucion_nivel === "normal" ? `Normal: ${f.distribucion_anios} de 30 años con dato en ${f.distribucion_periodo} (criterio de la OMM: 24 o más).`
      : f.distribucion_nivel === "referencia" ? `Referencia, no normal: el registro diario del SMN para este observatorio tiene ${f.distribucion_anios} de 30 años con dato en ${f.distribucion_periodo} (la OMM pide 24 para una normal).` : null,
    generado_en: f.generado_en,
  };
}
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

type FilaHoy = { instante: string; temperatura_c: number | null; bufr_b64: string; marcas: string };
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * La máxima y la mínima de hoy (día local de la capital) y su lugar frente a lo normal. Decodifica, de los mensajes guardados,
 * solo los dos que traen los termómetros (12 UTC y 00 UTC siguiente) y lee las lecturas horarias del día para el «hasta ahora».
 */
export async function hoyFrenteANormal(db: D1Database, clave: string, ahoraMs: number) {
  const fecha = fechaLocal(clave, ahoraMs);
  const off = desfaseHoras(clave, ahoraMs);
  const inicioDia = Date.parse(`${fecha}T00:00:00Z`) + off * 3600_000;
  const doce = `${fecha}T12:00:00.000Z`;
  const siguiente = new Date(Date.parse(`${fecha}T00:00:00Z`) + 86400_000).toISOString();
  const lect = await filas<FilaHoy>(db, "SELECT instante, temperatura_c, marcas, CASE WHEN instante IN (?, ?) THEN bufr_b64 ELSE '' END AS bufr_b64 FROM clima_medicion WHERE clave = ? AND instante >= ? AND instante < ? ORDER BY instante",
    [doce, siguiente, clave, new Date(inicioDia).toISOString(), new Date(inicioDia + 86400_000).toISOString()]);
  // El mensaje de las 00 UTC siguiente cae dentro del día local en todas las zonas de México (UTC−5 a UTC−8).
  const extremo = (instante: string, tipo: "maxima" | "minima") => {
    const m = lect.find((x) => x.instante === instante && x.bufr_b64);
    if (!m) return null;
    try {
      const e = extraerExtremos(decodificarBufr(b64(m.bufr_b64))).find((x) => x.tipo === tipo && x.desde_h === -12 && x.hasta_h === 0);
      return e ? { valor_c: e.valor_c, instante, periodo: tipo === "minima" ? "00–12 UTC (la noche)" : "12–00 UTC (el día)", marcada: m.marcas !== "[]" } : null;
    } catch { return null; }
  };
  const minT = extremo(doce, "minima"), maxT = extremo(siguiente, "maxima");
  const horarias = lect.filter((x) => x.temperatura_c !== null && x.marcas === "[]");
  const desdeAm = horarias.filter((x) => Date.parse(x.instante) >= inicioDia + 6 * 3600_000);
  const mayor = desdeAm.reduce<FilaHoy | null>((a, x) => (!a || (x.temperatura_c as number) > (a.temperatura_c as number) ? x : a), null);
  const menorNoche = horarias.filter((x) => Date.parse(x.instante) <= inicioDia + 10 * 3600_000).reduce<FilaHoy | null>((a, x) => (!a || (x.temperatura_c as number) < (a.temperatura_c as number) ? x : a), null);
  const normal = await normalDe(db, clave, fecha);
  const comparar = (v: number | null, dist: { percentiles: number[]; media_c: number | null } | null | undefined, oficial: number | null | undefined) => v === null ? null : {
    contra_normal_mes_c: oficial === null || oficial === undefined ? null : Math.round((v - oficial) * 10) / 10,
    contra_media_del_dia_c: dist?.media_c === null || dist?.media_c === undefined ? null : Math.round((v - dist.media_c) * 10) / 10,
    percentil: dist ? Math.round(rangoPercentil(dist.percentiles, v)) : null,
  };
  const maxima = maxT ? { ...maxT, completa: true } : mayor ? { valor_c: mayor.temperatura_c as number, instante: mayor.instante, periodo: "lecturas horarias desde las 6:00 (hasta ahora)", marcada: false, completa: false } : null;
  const minima = minT ? { ...minT, completa: true } : menorNoche ? { valor_c: menorNoche.temperatura_c as number, instante: menorNoche.instante, periodo: "lecturas horarias de la madrugada (sin el termómetro de mínima)", marcada: false, completa: false } : null;
  return {
    fecha, zona: ZONA[clave],
    maxima: maxima ? { ...maxima, frente_a_normal: comparar(maxima.valor_c, normal?.dia?.tmax, normal?.oficial?.tmax_c) } : null,
    minima: minima ? { ...minima, frente_a_normal: comparar(minima.valor_c, normal?.dia?.tmin, normal?.oficial?.tmin_c) } : null,
    normal,
    regla: "Máxima y mínima del día = termómetros de máxima y de mínima del observatorio en la sinóptica del SMN (mínima: mensaje de las 12 UTC, periodo 00–12 UTC; máxima: mensaje de las 00 UTC siguiente, periodo 12–00 UTC). Antes de que llegue la máxima se da la mayor lectura horaria desde las 6:00, marcada «hasta ahora». Percentil = lugar del valor entre todas las máximas (o mínimas) diarias del mismo observatorio en una ventana de 15 días centrada en la fecha, en el periodo de la distribución.",
  };
}

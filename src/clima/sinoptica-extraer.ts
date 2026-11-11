// Del mensaje BUFR 301150 + 307096 (sinóptica de superficie) a una observación con unidades de uso común. Función pura:
// la usa el Worker al custodiar y la usa el validador contra ecCodes (scripts/clima/validar_bufr.py).
import type { MensajeBufr } from "./bufr";

export type ObsSinoptica = {
  wmo: string; wigos: string | null; nombre: string | null; instante: string;
  lat: number | null; lon: number | null; altura_m: number | null;
  temperatura_c: number | null; rocio_c: number | null; humedad_pct: number | null;
  presion_estacion_hpa: number | null; presion_mar_hpa: number | null;
  viento_dir_grados: number | null; viento_ms: number | null; viento_periodo_min: number | null; rafaga_ms: number | null;
  lluvia_1h_mm: number | null; lluvia_24h_mm: number | null; visibilidad_m: number | null; nubosidad_pct: number | null;
};

const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

export function extraerSinoptica(m: MensajeBufr): ObsSinoptica {
  const el = m.elementos;
  const primero = (fxy: string): number | null => { const e = el.find((x) => x.fxy === fxy); return typeof e?.valor === "number" ? e.valor : null; };
  const texto = (fxy: string): string | null => { const e = el.find((x) => x.fxy === fxy); return typeof e?.valor === "string" ? e.valor : null; };
  const bloque = primero("001001"), estacion = primero("001002");
  if (bloque === null || estacion === null) throw new Error("sinóptica sin número OMM de estación");
  const wmo = `${bloque}${String(estacion).padStart(3, "0")}`;
  const [a, me, d, h, mi] = ["004001", "004002", "004003", "004004", "004005"].map(primero);
  if ([a, me, d, h, mi].some((x) => x === null)) throw new Error(`sinóptica ${wmo} sin fecha completa`);
  const p2 = (n: number | null) => String(n).padStart(2, "0");
  const instante = `${a}-${p2(me)}-${p2(d)}T${p2(h)}:${p2(mi)}:00.000Z`;
  const wig = ["001125", "001126", "001127"].map(primero);
  const wigLocal = texto("001128");
  const wigos = wig.every((x) => x !== null) && wigLocal ? `${wig[0]}-${wig[1]}-${wig[2]}-${wigLocal}` : null;
  // Viento: el primer 011001/011002, con el periodo (004025, minutos) que lo antecede; ráfaga: el primer 011041.
  const iViento = el.findIndex((x) => x.fxy === "011002");
  let periodo: number | null = null;
  for (let i = iViento - 1; i >= 0 && iViento >= 0; i--) if (el[i].fxy === "004025") { periodo = typeof el[i].valor === "number" ? Math.abs(el[i].valor as number) : null; break; }
  // Lluvia: cada 013011 lleva antes su periodo 004024 (horas, negativo hacia atrás).
  const lluvia = new Map<number, number | null>();
  let horas: number | null = null;
  for (const e of el) {
    if (e.fxy === "004024") horas = typeof e.valor === "number" ? e.valor : null;
    else if (e.fxy === "013011" && horas !== null && !lluvia.has(horas)) lluvia.set(horas, typeof e.valor === "number" ? e.valor : null);
  }
  const k2c = (v: number | null) => (v === null ? null : r2(v - 273.15));
  const pa2hpa = (v: number | null) => (v === null ? null : r1(v / 100));
  const lluviaMm = (v: number | null | undefined) => (v === undefined ? null : v === null ? null : v < 0 ? 0 : v); // −0.1 = traza en BUFR
  return {
    wmo, wigos, nombre: texto("001015"), instante,
    lat: primero("005001"), lon: primero("006001"), altura_m: primero("007030"),
    temperatura_c: k2c(primero("012101")), rocio_c: k2c(primero("012103")), humedad_pct: primero("013003"),
    presion_estacion_hpa: pa2hpa(primero("010004")), presion_mar_hpa: pa2hpa(primero("010051")),
    viento_dir_grados: primero("011001"), viento_ms: primero("011002"), viento_periodo_min: periodo, rafaga_ms: primero("011041"),
    lluvia_1h_mm: lluviaMm(lluvia.get(-1)), lluvia_24h_mm: lluviaMm(lluvia.get(-24)),
    visibilidad_m: primero("020001"), nubosidad_pct: primero("020010"),
  };
}

/** Extremo de temperatura del termómetro de máxima o de mínima, con su periodo en horas respecto de la hora del mensaje. */
export type ExtremoSinoptica = { tipo: "maxima" | "minima"; valor_c: number; desde_h: number; hasta_h: number };

/**
 * Máximas (012111) y mínimas (012112) que trae el mensaje, cada una con el periodo que la antecede en la secuencia 307096:
 * dos 004024 seguidos (inicio y fin, en horas, negativos hacia atrás). Los 012111/012112 sin valor o cuyo periodo no viene en
 * horas (los de 004025, en minutos, que el SMN deja vacíos) se ignoran. En los mensajes del SMN: a las 00 UTC, máxima de las
 * últimas 12 h (12–00 UTC: el día); a las 12 UTC, mínima de las últimas 12 h (00–12 UTC: la noche). Función pura.
 */
export function extraerExtremos(m: MensajeBufr): ExtremoSinoptica[] {
  const el = m.elementos;
  const out: ExtremoSinoptica[] = [];
  for (let i = 2; i < el.length; i++) {
    const e = el[i];
    if ((e.fxy !== "012111" && e.fxy !== "012112") || typeof e.valor !== "number") continue;
    const a = el[i - 2], b = el[i - 1];
    if (a.fxy !== "004024" || b.fxy !== "004024" || typeof a.valor !== "number" || typeof b.valor !== "number") continue;
    out.push({ tipo: e.fxy === "012111" ? "maxima" : "minima", valor_c: Math.round((e.valor - 273.15) * 100) / 100, desde_h: a.valor, hasta_h: b.valor });
  }
  return out;
}

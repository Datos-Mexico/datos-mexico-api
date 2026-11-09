// Verificación de cada medición oficial antes de guardarla. Funciones puras: lo que no pasa se marca y se muestra marcado;
// nunca se borra ni se rellena. Las reglas, en palabras, se publican en /api/v1/clima/estaciones.
import type { EstacionCapital } from "./estaciones";
import type { ObsSinoptica } from "./sinoptica-extraer";

export type Marca = { codigo: string; detalle: string };
export type Previa = { instante: string; temperatura_c: number | null; rocio_c: number | null; humedad_pct: number | null; presion_mar_hpa: number | null };
export type Testigo = { icao: string; instante: string; temperatura_c: number | null };
export type Cotejo = { icao: string; instante: string; dif_c: number; tipica_c: number; tolerancia_c: number };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** Gradiente térmico estándar para comparar dos puntos a distinta altura: 6.5 °C por kilómetro. */
export const GRADIENTE_C_POR_M = 0.0065;
/** Diferencia típica estación − aeropuerto: mediana de los últimos 30 días; con menos de 48 cotejos se usa 0 y tolerancia amplia. */
export const TESTIGO_MIN_COTEJOS = 48;
export const TESTIGO_TOLERANCIA_C = 4;
export const TESTIGO_TOLERANCIA_INICIAL_C = 6;
/** Ventana para emparejar la medición con un METAR: el más cercano a ±40 minutos. */
export const TESTIGO_VENTANA_MS = 40 * 60_000;

const f1 = (n: number) => n.toFixed(1).replace("-", "−");
/** Humedad relativa por la fórmula de Magnus (OMM, Guía 8), para cotejar humedad, temperatura y rocío. */
export const humedadMagnus = (t: number, td: number) => 100 * Math.exp((17.62 * td) / (243.12 + td) - (17.62 * t) / (243.12 + t));
/** Mes local (UTC−6) de una observación: los récords del SMN son por mes calendario de México. */
export const mesLocal = (instante: string) => new Date(Date.parse(instante) - 6 * 3600_000).getUTCMonth();

export function verificarMedicion(o: ObsSinoptica, e: EstacionCapital, previa: Previa | null): Marca[] {
  const m: Marca[] = [];
  const mes = mesLocal(o.instante);
  if (o.temperatura_c === null) m.push({ codigo: "sin-temperatura", detalle: "el SMN no reportó temperatura en esta observación" });
  else {
    const lo = e.tmin_record[mes], hi = e.tmax_record[mes];
    if (o.temperatura_c < lo || o.temperatura_c > hi) m.push({ codigo: "fuera-de-record", detalle: `${f1(o.temperatura_c)} °C fuera del récord del observatorio para ${MESES[mes]} (${f1(lo)} a ${f1(hi)} °C, registros desde ${e.records_desde})` });
  }
  if (o.temperatura_c !== null && o.rocio_c !== null) {
    if (o.rocio_c > o.temperatura_c + 0.5) m.push({ codigo: "rocio-mayor", detalle: `punto de rocío ${f1(o.rocio_c)} °C mayor que la temperatura ${f1(o.temperatura_c)} °C` });
    else if (o.humedad_pct !== null) {
      const calc = humedadMagnus(o.temperatura_c, o.rocio_c);
      if (Math.abs(calc - o.humedad_pct) > 8) m.push({ codigo: "humedad-incongruente", detalle: `humedad ${o.humedad_pct} % y la que dan temperatura y rocío ${calc.toFixed(0)} %` });
    }
  }
  if (o.humedad_pct !== null && (o.humedad_pct < 1 || o.humedad_pct > 100)) m.push({ codigo: "humedad-fuera-de-rango", detalle: `humedad ${o.humedad_pct} %` });
  if (o.presion_mar_hpa !== null && (o.presion_mar_hpa < 870 || o.presion_mar_hpa > 1085)) m.push({ codigo: "presion-fuera-de-rango", detalle: `presión al nivel del mar ${f1(o.presion_mar_hpa)} hPa fuera de los extremos mundiales (870 a 1085)` });
  if (o.viento_ms !== null && (o.viento_ms < 0 || o.viento_ms > 75)) m.push({ codigo: "viento-fuera-de-rango", detalle: `viento ${o.viento_ms} m/s` });
  if (o.viento_dir_grados !== null && (o.viento_dir_grados < 0 || o.viento_dir_grados > 360)) m.push({ codigo: "direccion-fuera-de-rango", detalle: `dirección ${o.viento_dir_grados}°` });
  if (previa) {
    const horas = (Date.parse(o.instante) - Date.parse(previa.instante)) / 3600_000;
    // Lectura posiblemente repetida: temperatura, rocío y humedad idénticos a los de la hora anterior (se vio el 9-nov-2026 en
    // Tacubaya a mediodía, con la presión y el viento cambiando y el aeropuerto subiendo 4 °C).
    if (horas === 1 && o.temperatura_c !== null && o.temperatura_c === previa.temperatura_c && o.rocio_c !== null && o.rocio_c === previa.rocio_c && o.humedad_pct !== null && o.humedad_pct === previa.humedad_pct)
      m.push({ codigo: "igual-a-la-hora-anterior", detalle: `temperatura (${f1(o.temperatura_c)} °C), rocío y humedad idénticos a los de la hora anterior: puede ser una lectura repetida` });
    if (horas > 0 && horas <= 3) {
      const maxT = 8 + 2 * horas, maxP = 6 * horas;
      if (o.temperatura_c !== null && previa.temperatura_c !== null && Math.abs(o.temperatura_c - previa.temperatura_c) > maxT)
        m.push({ codigo: "salto-temperatura", detalle: `${f1(o.temperatura_c - previa.temperatura_c)} °C respecto de la lectura de hace ${horas} h (máximo físico usado: ${maxT} °C)` });
      if (o.presion_mar_hpa !== null && previa.presion_mar_hpa !== null && Math.abs(o.presion_mar_hpa - previa.presion_mar_hpa) > maxP)
        m.push({ codigo: "salto-presion", detalle: `${f1(o.presion_mar_hpa - previa.presion_mar_hpa)} hPa respecto de la lectura de hace ${horas} h (máximo usado: ${maxP} hPa)` });
    }
  }
  return m;
}

/** Diferencia estación − aeropuerto corregida por la altura (el aeropuerto se lleva a la altura del observatorio). */
export function diferenciaTestigo(o: ObsSinoptica, e: EstacionCapital, t: Testigo): number | null {
  if (o.temperatura_c === null || t.temperatura_c === null || e.desnivel_aeropuerto_m === null) return null;
  const esperada = t.temperatura_c + GRADIENTE_C_POR_M * e.desnivel_aeropuerto_m; // desnivel = aeropuerto − observatorio
  return Math.round((o.temperatura_c - esperada) * 100) / 100;
}

/** Cotejo con el testigo: marca si la diferencia se aparta de la típica del par más de la tolerancia. */
export function cotejarTestigo(dif: number, historia: number[], icao: string, instante: string): { cotejo: Cotejo; marca: Marca | null } {
  const suficiente = historia.length >= TESTIGO_MIN_COTEJOS;
  const orden = [...historia].sort((a, b) => a - b);
  const tipica = suficiente ? orden[Math.floor(orden.length / 2)] : 0;
  const tol = suficiente ? TESTIGO_TOLERANCIA_C : TESTIGO_TOLERANCIA_INICIAL_C;
  const cotejo = { icao, instante, dif_c: dif, tipica_c: Math.round(tipica * 100) / 100, tolerancia_c: tol };
  const marca = Math.abs(dif - tipica) > tol ? { codigo: "difiere-del-aeropuerto", detalle: `difiere ${f1(dif)} °C del aeropuerto ${icao} (ya corregido por altura); lo típico del par es ${f1(tipica)} °C y la tolerancia ${tol} °C` } : null;
  return { cotejo, marca };
}

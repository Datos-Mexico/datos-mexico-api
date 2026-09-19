// Réplica de _parse_fecha y _parse_fecha_dia del legacy, con los mismos mensajes de error.
import { ErrorHttp } from "./errores";

const DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const bisiesto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;

function isoAFecha(s: string): { y: number; m: number; d: number } {
  // Equivalente práctico de date.fromisoformat para YYYY-MM-DD (también acepta YYYYMMDD como CPython ≥ 3.11).
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid isoformat string: '${s}'`);
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12) throw new Error("month must be in 1..12");
  const max = DIAS_MES[mo - 1] + (mo === 2 && bisiesto(y) ? 1 : 0);
  if (d < 1 || d > max) throw new Error("day is out of range for month");
  return { y, m: mo, d };
}

const iso = (f: { y: number; m: number; d: number }) => `${String(f.y).padStart(4, "0")}-${String(f.m).padStart(2, "0")}-${String(f.d).padStart(2, "0")}`;

/** Acepta 'YYYY-MM' o 'YYYY-MM-01'. Devuelve 'YYYY-MM-01'. 422 si no es un mes válido. */
export function parseFecha(valor: string): string {
  try {
    let s = valor;
    if (s.length === 7) s = s + "-01";
    const f = isoAFecha(s);
    if (f.d !== 1) throw new Error("fecha debe ser día 1 del mes (YYYY-MM o YYYY-MM-01)");
    return iso(f);
  } catch (e) {
    throw new ErrorHttp(422, `fecha inválida: ${(e as Error).message}`);
  }
}

/** Acepta 'YYYY-MM-DD'. 422 si formato inválido. */
export function parseFechaDia(valor: string): string {
  try {
    return iso(isoAFecha(valor));
  } catch (e) {
    throw new ErrorHttp(422, `fecha inválida (esperado YYYY-MM-DD): ${(e as Error).message}`);
  }
}

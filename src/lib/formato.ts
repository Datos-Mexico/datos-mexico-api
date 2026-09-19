import { redondear } from "./numeros";
/** Equivalente de `f"{x:,.0f}"` de Python: miles con coma, sin decimales. */
export function miles0(x: number): string {
  const r = redondear(x, 0);
  const s = Math.abs(r).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return (r < 0 ? "-" : "") + s;
}
/** Equivalente de `f"{x:.1f}"`. */
export function dec1(x: number): string {
  return redondear(x, 1).toFixed(1);
}

// Utilería común del bloque CDMX: filtros compartidos de servidores/export, paginación, formato Decimal.
import { z } from "zod";
import { ErrorHttp } from "../lib/errores";
import { enteroOpcional } from "../lib/validacion";
import type { Detalle } from "../lib/validacion";

/** Decimal de Pydantic: cadena con dos decimales ("18500.00") o null. */
export const dec2 = (v: number | null | undefined): string | null => (v === null || v === undefined ? null : Number(v).toFixed(2));

export function decimalOpcional(valor: string | undefined, nombre: string): number | null {
  if (valor === undefined) return null;
  if (!/^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$/.test(valor)) {
    throw new ErrorHttp(422, [{ type: "decimal_parsing", loc: ["query", nombre], msg: "Input should be a valid decimal", input: valor } satisfies Detalle]);
  }
  return Number(valor);
}
export function enteroRuta(valor: string, nombre: string): number {
  if (!/^\s*[-+]?\d+\s*$/.test(valor)) throw new ErrorHttp(422, [{ type: "int_parsing", loc: ["path", nombre], msg: "Input should be a valid integer, unable to parse string as an integer", input: valor } satisfies Detalle]);
  return Number(valor);
}
export function enteroConDefault(valor: string | undefined, nombre: string, def: number, ge?: number, le?: number): number {
  const v = enteroOpcional(valor, nombre, ge, le);
  return v === null ? def : v;
}
export const paginas = (total: number, per_page: number) => (total > 0 ? Math.floor((total + per_page - 1) / per_page) : 0);

export type Filtros = {
  sector_id: number | null; sexo: string | null; edad_min: number | null; edad_max: number | null; sueldo_min: number | null; sueldo_max: number | null;
  puesto_search: string | null; tipo_contratacion_id: number | null; tipo_personal_id: number | null; universo_id: number | null;
  page: number; per_page: number; order_by: string; order: string;
};
const q = (get: (k: string) => string | undefined, k: string) => get(k);
/** Equivalente de get_filters(): mismos nombres, defaults y validaciones (422 de FastAPI). */
export function leerFiltros(get: (k: string) => string | undefined): Filtros {
  return {
    sector_id: enteroOpcional(q(get, "sector_id"), "sector_id"), sexo: q(get, "sexo") ?? null,
    edad_min: enteroOpcional(q(get, "edad_min"), "edad_min"), edad_max: enteroOpcional(q(get, "edad_max"), "edad_max"),
    sueldo_min: decimalOpcional(q(get, "sueldo_min"), "sueldo_min"), sueldo_max: decimalOpcional(q(get, "sueldo_max"), "sueldo_max"),
    puesto_search: q(get, "puesto_search") ?? null,
    tipo_contratacion_id: enteroOpcional(q(get, "tipo_contratacion_id"), "tipo_contratacion_id"), tipo_personal_id: enteroOpcional(q(get, "tipo_personal_id"), "tipo_personal_id"),
    universo_id: enteroOpcional(q(get, "universo_id"), "universo_id"),
    page: enteroConDefault(q(get, "page"), "page", 1, 1), per_page: enteroConDefault(q(get, "per_page"), "per_page", 50, 1, 200),
    order_by: q(get, "order_by") ?? "id", order: q(get, "order") ?? "asc",
  };
}
/** Predicados WHERE de apply_filters(), en el mismo orden; alias p=personas, n=nombramientos, csex=cat_sexos, cp=cat_puestos. */
export function predicados(f: Filtros): { where: string; params: unknown[] } {
  const w: string[] = []; const p: unknown[] = [];
  const add = (cond: string, v: unknown) => { p.push(v); w.push(cond.replace("?", `?${p.length}`)); };
  if (f.sector_id !== null) add("n.sector_id = ?", f.sector_id);
  if (f.sexo !== null) add("csex.nombre = ?", f.sexo);
  if (f.edad_min !== null) add("p.edad >= ?", f.edad_min);
  if (f.edad_max !== null) add("p.edad <= ?", f.edad_max);
  if (f.sueldo_min !== null) add("n.sueldo_bruto >= ?", f.sueldo_min);
  if (f.sueldo_max !== null) add("n.sueldo_bruto <= ?", f.sueldo_max);
  if (f.puesto_search !== null) add("lower(cp.nombre) LIKE lower(?)", `%${f.puesto_search}%`);
  if (f.tipo_contratacion_id !== null) add("n.tipo_contratacion_id = ?", f.tipo_contratacion_id);
  if (f.tipo_personal_id !== null) add("n.tipo_personal_id = ?", f.tipo_personal_id);
  if (f.universo_id !== null) add("n.universo_id = ?", f.universo_id);
  return { where: w.length ? w.join(" AND ") : "1=1", params: p };
}
const COLS_PERSONA = new Set(["id", "nombre", "apellido_1", "edad"]);
const PERMITIDAS = new Set(["id", "nombre", "apellido_1", "edad", "sueldo_bruto", "sueldo_neto", "fecha_ingreso"]);
export function ordenSql(f: Filtros): string {
  const col = PERMITIDAS.has(f.order_by) ? f.order_by : "id";
  const ref = COLS_PERSONA.has(col) ? `p.${col}` : `n.${col}`;
  // Postgres: ASC pone los NULL al final y DESC al principio; SQLite hace lo contrario, se fija explícitamente.
  return f.order === "desc" ? `ORDER BY ${ref} DESC NULLS FIRST` : `ORDER BY ${ref} ASC NULLS LAST`;
}
// Zod de los parámetros de get_filters (solo para la documentación; la validación es manual).
export const FiltrosQuery = z.object({
  sector_id: z.number().int().optional(), sexo: z.string().optional(), edad_min: z.number().int().optional(), edad_max: z.number().int().optional(),
  sueldo_min: z.union([z.number(), z.string().regex(/^(?!^[-+.]*$)[+-]?0*\d*\.?\d*$/)]).optional(), sueldo_max: z.union([z.number(), z.string().regex(/^(?!^[-+.]*$)[+-]?0*\d*\.?\d*$/)]).optional(), puesto_search: z.string().optional(),
  tipo_contratacion_id: z.number().int().optional(), tipo_personal_id: z.number().int().optional(), universo_id: z.number().int().optional(),
  page: z.number().int().min(1).default(1), per_page: z.number().int().min(1).max(200).default(50), order_by: z.string().default("id"), order: z.string().default("asc"),
});
export const paginado = <T extends z.ZodTypeAny>(item: T) => z.object({ data: z.array(item), total: z.number().int(), page: z.number().int(), per_page: z.number().int(), pages: z.number().int() });

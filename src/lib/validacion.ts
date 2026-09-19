// Validación manual de parámetros de query con los mismos mensajes que FastAPI/Pydantic v2.
import { ErrorHttp } from "./errores";

export type Detalle = { type: string; loc: (string | number)[]; msg: string; input: unknown; ctx?: Record<string, unknown> };

/** Cadena opcional que debe cumplir un patrón (Query(None, pattern=...)). */
export function textoConPatron(valor: string | undefined, nombre: string, patron: string): string | null {
  if (valor === undefined) return null;
  if (!new RegExp(patron).test(valor)) {
    throw new ErrorHttp(422, [{ type: "string_pattern_mismatch", loc: ["query", nombre], msg: `String should match pattern '${patron}'`, input: valor, ctx: { pattern: patron } } satisfies Detalle]);
  }
  return valor;
}

/** Entero opcional con cotas (Query(None, ge=, le=)). */
export function enteroOpcional(valor: string | undefined, nombre: string, ge?: number, le?: number): number | null {
  if (valor === undefined) return null;
  if (!/^\s*[-+]?\d+\s*$/.test(valor)) {
    throw new ErrorHttp(422, [{ type: "int_parsing", loc: ["query", nombre], msg: "Input should be a valid integer, unable to parse string as an integer", input: valor } satisfies Detalle]);
  }
  const n = Number(valor);
  if (ge !== undefined && n < ge) throw new ErrorHttp(422, [{ type: "greater_than_equal", loc: ["query", nombre], msg: `Input should be greater than or equal to ${ge}`, input: valor, ctx: { ge } } satisfies Detalle]);
  if (le !== undefined && n > le) throw new ErrorHttp(422, [{ type: "less_than_equal", loc: ["query", nombre], msg: `Input should be less than or equal to ${le}`, input: valor, ctx: { le } } satisfies Detalle]);
  return n;
}

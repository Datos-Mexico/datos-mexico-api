// Pulso del Protocolo DPM: definiciones compartidas. Contrato en github.com/Datos-Mexico/datos-mexico-dpm (PULSO.md).
import { z } from "zod";
import type { AppContext } from "../index";
import { fila } from "../lib/db";
import { ErrorHttp } from "../lib/errores";
import type { Detalle } from "../lib/validacion";

export const PROTOCOLO_VERSION = "0.2.1";
export const PROTOCOLO_URL = "https://github.com/Datos-Mexico/datos-mexico-dpm";
export const CLASES = ["DPMS", "DPS", "DPM", "fuera-de-clase", "sin-ventana"] as const;
export type Clase = (typeof CLASES)[number];
export const EN_CLASE: readonly Clase[] = ["DPMS", "DPS", "DPM"];
export const MODOS = ["servido", "custodiado"] as const;
export const ESTADOS = ["declarada", "verificada"] as const;
export const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const MINUTO_MS = 60_000;
export const VENTANA_MS = 60 * MINUTO_MS;        // §7.1: ventana de observación
export const GRACIA_MS = 5 * MINUTO_MS;          // §4: un resumen es puntual si llega dentro de 5 min del fin de su minuto
export const MAX_ATRASO_MS = 24 * 60 * MINUTO_MS; // §4: después de 24 h se rechaza
export const MAX_RESUMENES = 1000;
export const MAX_ATRASO_USUARIOS_DIAS = 7;
export const DIAS_PARA_VERIFICADA = 7;
const OFFSET_MX_MS = 6 * 60 * MINUTO_MS; // America/Mexico_City es UTC-6 todo el año desde octubre de 2022

/** §4 y §7.4: clase que corresponde a un periodo en milisegundos; null = sin cota declarada = fuera de clase. */
export function clasePorIntervalo(ms: number | null | undefined): Clase {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "fuera-de-clase";
  if (ms <= 1) return "DPMS";
  if (ms <= 1000) return "DPS";
  if (ms <= 60_000) return "DPM";
  return "fuera-de-clase";
}
const FINURA: Record<Clase, number> = { DPMS: 0, DPS: 1, DPM: 2, "fuera-de-clase": 3, "sin-ventana": 4 };
/** §7.5: de dos clases, la menos fina. */
export const menosFina = (a: Clase, b: Clase): Clase => (FINURA[a] >= FINURA[b] ? a : b);
/** La más fina de un conjunto (para la insignia). */
export const masFina = (cs: Clase[]): Clase | null => cs.filter((c) => EN_CLASE.includes(c)).sort((x, y) => FINURA[x] - FINURA[y])[0] ?? null;

// ---- tiempo ----
const RE_INSTANTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.(\d{1,3}))?Z$/;
export const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const iso = (d: Date | number) => new Date(d).toISOString();
export const pisoMinuto = (d: Date | number) => new Date(Math.floor(new Date(d).getTime() / MINUTO_MS) * MINUTO_MS);
/** Instante ISO 8601 UTC; 422 con la ruta del campo si no lo es. */
export function parseInstante(valor: unknown, loc: (string | number)[]): Date {
  if (typeof valor !== "string" || !RE_INSTANTE.test(valor) || Number.isNaN(Date.parse(valor))) {
    throw new ErrorHttp(422, [{ type: "value_error", loc, msg: "Instante inválido: se espera ISO 8601 UTC, por ejemplo 2026-10-31T18:04:02.130Z", input: valor } satisfies Detalle]);
  }
  return new Date(valor);
}
/** Fecha civil en America/Mexico_City de un instante. */
export function fechaMx(d: Date | number): string { return new Date(new Date(d).getTime() - OFFSET_MX_MS).toISOString().slice(0, 10); }
/** [inicio, fin) en UTC de una fecha civil de America/Mexico_City. */
export function rangoUtcDeFechaMx(fecha: string): { inicio: Date; fin: Date } {
  const [y, m, d] = fecha.split("-").map(Number);
  const inicio = new Date(Date.UTC(y, m - 1, d) + OFFSET_MX_MS);
  return { inicio, fin: new Date(inicio.getTime() + 24 * 60 * MINUTO_MS) };
}
export function sumarDias(fecha: string, n: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function esFechaValida(f: string): boolean {
  if (!RE_FECHA.test(f)) return false;
  const [y, m, d] = f.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// ---- validación de cuerpos (misma forma de error que el resto de la API) ----
export function validar<T>(esquema: z.ZodType<T>, cuerpo: unknown): T {
  const r = esquema.safeParse(cuerpo);
  if (r.success) return r.data;
  throw new ErrorHttp(422, r.error.issues.map((i) => { const falta = i.code === "invalid_type" && i.message.includes("received undefined"); return { type: falta ? "missing" : i.code, loc: ["body", ...i.path.map(String)], msg: falta ? "Field required" : i.message, input: null } satisfies Detalle; }));
}
export const e422 = (loc: (string | number)[], msg: string, input: unknown = null) => new ErrorHttp(422, [{ type: "value_error", loc, msg, input } satisfies Detalle]);
export function slugRuta(valor: string | undefined, nombre: string): string {
  if (!valor || !SLUG.test(valor)) throw new ErrorHttp(422, [{ type: "string_pattern_mismatch", loc: ["path", nombre], msg: `String should match pattern '${SLUG.source}'`, input: valor ?? null } satisfies Detalle]);
  return valor;
}

// ---- sistemas y llaves ----
export type Sistema = { sistema: string; nombre: string; operador: string; url: string | null; estado: "declarada" | "verificada"; adhesion_declarada: string; llave_hash: string | null; creado_en: string };
export async function sha256hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function nuevaLlave(sistema: string): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return `dpm_${sistema}_${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
export async function sistemaPorId(c: AppContext, sistema: string): Promise<Sistema> {
  const s = await fila<Sistema>(c.env.DB_DPM, "SELECT sistema, nombre, operador, url, estado, adhesion_declarada, llave_hash, creado_en FROM sistemas WHERE sistema = ?", [sistema]);
  if (!s) throw new ErrorHttp(404, `sistema ${sistema} no está registrado`);
  return s;
}
/** §2: la llave de reporte autoriza únicamente sobre su propio sistema. 401 si falta o no corresponde. */
export async function sistemaConLlave(c: AppContext, sistema: string): Promise<Sistema> {
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
  if (!m) throw new ErrorHttp(401, "Falta la llave de reporte (Authorization: Bearer <llave>)", { "WWW-Authenticate": "Bearer" });
  const s = await sistemaPorId(c, sistema);
  if (!s.llave_hash || (await sha256hex(m[1].trim())) !== s.llave_hash) throw new ErrorHttp(401, "La llave no corresponde a este sistema", { "WWW-Authenticate": "Bearer" });
  return s;
}

// Motor de consultas de los cubos: arma SELECT … GROUP BY … con parámetros ligados a partir de una definición declarativa.
// Todo identificador que llega a SQL sale de la definición (claves de medidas y dimensiones validadas contra ella); los
// valores de los filtros van siempre como parámetros (?), nunca interpolados.
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { ErrorHttp } from "../lib/errores";
import type { Detalle } from "../lib/validacion";
import type { ColumnaResultado, Consulta, Cubo, Dimension, Medida, MiembroVirtual } from "./tipos";

export const TOPE_FILAS = 50_000;
export const TOPE_MIEMBROS = 5_000;

const err422 = (nombre: string, msg: string, input: unknown): ErrorHttp => new ErrorHttp(422, [{ type: "value_error", loc: ["query", nombre], msg, input } satisfies Detalle]);

export function medidaDe(cubo: Cubo, clave: string, param = "medidas"): Medida {
  const m = cubo.medidas.find((x) => x.clave === clave);
  if (!m) throw err422(param, `la medida '${clave}' no existe en el cubo '${cubo.clave}'; las válidas son: ${cubo.medidas.map((x) => x.clave).join(", ")}`, clave);
  return m;
}
export function dimensionDe(cubo: Cubo, clave: string, param = "columnas"): Dimension {
  const d = cubo.dimensiones.find((x) => x.clave === clave);
  if (!d) throw err422(param, `la dimensión '${clave}' no existe en el cubo '${cubo.clave}'; las válidas son: ${cubo.dimensiones.map((x) => x.clave).join(", ")}`, clave);
  return d;
}

/** Lee la consulta de la query string: medidas, columnas, f.<dimensión>=v1|v2, padres, orden, sentido, limite. */
export function leerConsulta(cubo: Cubo, q: Record<string, string>): Consulta {
  const lista = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const medidas = lista(q.medidas);
  const columnas = lista(q.columnas);
  if (!medidas.length) throw err422("medidas", "indique al menos una medida (separadas por coma)", q.medidas ?? null);
  for (const m of medidas) medidaDe(cubo, m);
  for (const c of columnas) dimensionDe(cubo, c);
  if (new Set(medidas).size !== medidas.length) throw err422("medidas", "hay medidas repetidas", q.medidas);
  if (new Set(columnas).size !== columnas.length) throw err422("columnas", "hay columnas repetidas", q.columnas);
  const filtros: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(q)) {
    if (!k.startsWith("f.")) continue;
    const dim = k.slice(2); dimensionDe(cubo, dim, k);
    const valores = v.split("|").map((s) => s.trim()).filter(Boolean);
    if (!valores.length) throw err422(k, "el filtro no trae valores (sepárelos con |)", v);
    if (valores.length > 500) throw err422(k, "máximo 500 valores por filtro", valores.length);
    filtros[dim] = valores;
  }
  for (const d of cubo.filtro_obligatorio ?? []) if (!filtros[d]?.length) throw err422(`f.${d}`, `este cubo exige un filtro por '${d}' en cada consulta (por ejemplo f.${d}=${cubo.predeterminado.filtros?.[d]?.[0] ?? "…"}); los miembros están en /api/v1/cubos/${cubo.clave}/miembros?dimension=${d}&q=`, null);
  for (const d of cubo.dimensiones) {
    if (!d.particion) continue;
    const cubierta = Boolean(filtros[d.clave]?.length) || columnas.includes(d.clave) || (d.particion.implicita_en ?? []).some((x) => columnas.includes(x));
    if (!cubierta) throw err422(`f.${d.clave}`, `la dimensión '${d.clave}' parte el universo en niveles que se contienen (sumarlos cuenta varias veces lo mismo): filtre un nivel (por ejemplo f.${d.clave}=${cubo.predeterminado.filtros?.[d.clave]?.[0] ?? "…"}) o inclúyala en columnas${d.particion.implicita_en?.length ? ` (o agrupe por ${d.particion.implicita_en.join(", ")})` : ""}`, null);
  }
  const padres = q.padres === "1" || q.padres === "true";
  const orden = q.orden?.trim() || null;
  if (orden && !medidas.includes(orden) && !columnas.includes(orden)) throw err422("orden", `'${orden}' no está entre las medidas ni las columnas de la consulta`, orden);
  const sentido = q.sentido === "asc" ? "asc" : q.sentido === "desc" || q.sentido === undefined ? "desc" : null;
  if (!sentido) throw err422("sentido", "debe ser 'asc' o 'desc'", q.sentido);
  let limite: number | null = null;
  if (q.limite !== undefined && q.limite !== "") {
    if (!/^\d+$/.test(q.limite)) throw err422("limite", "debe ser un entero", q.limite);
    limite = Math.min(Number(q.limite), TOPE_FILAS);
    if (limite < 1) throw err422("limite", "debe ser al menos 1", q.limite);
  }
  return { medidas, columnas, filtros, padres, orden, sentido, limite };
}

/** Con `padres`, antepone a cada columna sus ancestros en la jerarquía (sin repetir). */
function columnasConPadres(cubo: Cubo, columnas: string[], padres: boolean): Dimension[] {
  const out: Dimension[] = [];
  const meter = (d: Dimension) => { if (!out.some((x) => x.clave === d.clave)) out.push(d); };
  for (const c of columnas) {
    const d = dimensionDe(cubo, c);
    if (padres) {
      const cadena: Dimension[] = []; let p = d.padre ? dimensionDe(cubo, d.padre) : null;
      while (p) { cadena.unshift(p); p = p.padre ? dimensionDe(cubo, p.padre) : null; }
      cadena.forEach(meter);
    }
    meter(d);
  }
  return out;
}

const col = (s: string) => `"${s.replace(/"/g, '""')}"`;

type Virtual = { dim: Dimension; miembros: MiembroVirtual[] };
type Armado = { sql: string; params: unknown[]; columnas: ColumnaResultado[]; dims: Dimension[]; medidas: Medida[]; virtual: Virtual | null; ordenCol: string };

/** Arma la consulta. Una dimensión virtual entre las columnas no se despliega en SQL (D1 limita los UNION ALL y las
 *  variables ligadas): se pide una fila ancha por grupo con una columna por miembro y medida, y `consultar` la despliega. */
export function armar(cubo: Cubo, q: Consulta): Armado {
  const dims = columnasConPadres(cubo, q.columnas, q.padres);
  const virtuales = dims.filter((d) => d.virtual);
  if (virtuales.length > 1) throw err422("columnas", `solo puede haber una dimensión virtual por consulta (${virtuales.map((d) => d.clave).join(", ")})`, q.columnas);
  const virtual = virtuales[0] ?? null;
  const medidas = q.medidas.map((m) => medidaDe(cubo, m));
  const filtroVirtual = Object.keys(q.filtros).map((k) => dimensionDe(cubo, k)).find((d) => d.virtual && d.clave !== virtual?.clave) ?? null;
  if (virtual && filtroVirtual) throw err422("columnas", "no se puede filtrar por una dimensión virtual y desplegar otra a la vez", q.columnas);
  // miembros virtuales activos: los filtrados, o todos
  const miembrosDe = (d: Dimension): MiembroVirtual[] => { const f = q.filtros[d.clave]; const todos = d.virtual!; if (!f) return todos; const sel = todos.filter((m) => f.includes(m.id)); if (!sel.length) throw err422(`f.${d.clave}`, `ningún valor coincide con los miembros de '${d.clave}'`, f); return sel; };

  // WHERE: condición base + filtros de dimensiones reales, todos con parámetros
  const partes: string[] = []; const params: unknown[] = [];
  if (cubo.donde) partes.push(`(${cubo.donde})`);
  for (const [k, valores] of Object.entries(q.filtros)) {
    const d = dimensionDe(cubo, k); if (d.virtual) continue;
    partes.push(`${d.id} IN (${valores.map(() => "?").join(", ")})`); params.push(...valores);
  }
  const where = partes.length ? ` WHERE ${partes.join(" AND ")}` : "";

  const reales = dims.filter((d) => !d.virtual);
  const selDims = reales.flatMap((d) => (d.nombre ? [`${d.id} AS ${col(d.clave + "_id")}`, `${d.nombre} AS ${col(d.clave)}`] : [`${d.id} AS ${col(d.clave)}`]));
  const grupo = reales.flatMap((d) => (d.nombre ? [d.id, d.nombre] : [d.id]));
  const groupBy = grupo.length ? ` GROUP BY ${grupo.join(", ")}` : "";

  // expresión de cada medida: la de la definición o, si hay virtual filtrada sin desplegar, la suma de sus miembros
  const exprMedida = (m: Medida, miembros: MiembroVirtual[] | null, dimVirtual: Dimension | null): string => {
    if (!miembros) return m.sql;
    const partes = miembros.map((x) => x.sql[m.clave]).filter((s): s is string => !!s);
    if (!partes.length) throw err422("medidas", `la medida '${m.clave}' no se desagrega por '${dimVirtual!.clave}'`, m.clave);
    return partes.length === 1 ? partes[0] : `(${partes.join(" + ")})`;
  };

  const ordenCol = q.orden ?? medidas[0].clave;
  const limite = q.limite ?? TOPE_FILAS;
  let sql: string; let virt: Virtual | null = null;
  if (!virtual) {
    const miembrosFiltro = filtroVirtual ? miembrosDe(filtroVirtual) : null;
    const selMed = medidas.map((m) => `${exprMedida(m, miembrosFiltro, filtroVirtual)} AS ${col(m.clave)}`);
    sql = `SELECT ${[...selDims, ...selMed].join(", ")} FROM ${cubo.desde}${where}${groupBy}`;
    const ordenDim = dims.find((d) => d.clave === ordenCol);
    const orderBy = ordenDim ? `${col(ordenDim.nombre ? ordenDim.clave + "_id" : ordenDim.clave)} ${q.sentido.toUpperCase()}` : `${col(ordenCol)} ${q.sentido.toUpperCase()} NULLS LAST`;
    const restoOrden = reales.filter((d) => d.clave !== ordenCol).map((d) => col(d.nombre ? d.clave + "_id" : d.clave));
    sql = `SELECT * FROM (${sql}) ORDER BY ${[orderBy, ...restoOrden].join(", ")} LIMIT ${limite + 1}`;
  } else {
    const miembros = miembrosDe(virtual);
    for (const m of medidas) if (!miembros.some((x) => x.sql[m.clave])) throw err422("medidas", `la medida '${m.clave}' no se desagrega por '${virtual.clave}'`, m.clave);
    const selMed = miembros.flatMap((mi, i) => medidas.map((m) => `${mi.sql[m.clave] ?? "NULL"} AS ${col(`v__${i}__${m.clave}`)}`));
    sql = `SELECT ${[...selDims, ...selMed].join(", ")} FROM ${cubo.desde}${where}${groupBy} LIMIT ${TOPE_FILAS + 1}`;
    virt = { dim: virtual, miembros };
  }

  const columnas: ColumnaResultado[] = [];
  for (const d of dims) {
    if (d.nombre || d.virtual) columnas.push({ clave: d.clave + "_id", titulo: `${d.titulo} ID`, tipo: "id", dimension: d.clave });
    columnas.push({ clave: d.clave, titulo: d.titulo, tipo: "dimension", dimension: d.clave });
    if (d.tipo === "geografica" && d.claves_geo) columnas.push({ clave: d.clave + "_cve", titulo: `${d.titulo} (clave INEGI)`, tipo: "geo", dimension: d.clave });
  }
  for (const m of medidas) columnas.push({ clave: m.clave, titulo: m.titulo, tipo: "medida", unidad: m.unidad, sumable: m.sumable });
  return { sql, params, columnas, dims, medidas, virtual: virt, ordenCol };
}

export type Resultado = { columnas: ColumnaResultado[]; filas: Record<string, unknown>[]; n: number; limitado: boolean; limite: number; ms: number };

/** Despliega las filas anchas de una dimensión virtual (una fila por grupo × miembro) y las ordena como pide la consulta. */
function desplegar(a: Armado, anchas: Record<string, unknown>[], q: Consulta): Record<string, unknown>[] {
  const { dim, miembros } = a.virtual!;
  const out: Record<string, unknown>[] = [];
  for (const f of anchas) {
    miembros.forEach((mi, i) => {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(f)) if (!k.startsWith("v__")) o[k] = f[k];
      o[dim.clave + "_id"] = mi.id; o[dim.clave] = mi.nombre;
      for (const m of a.medidas) o[m.clave] = f[`v__${i}__${m.clave}`] ?? null;
      out.push(o);
    });
  }
  const esDim = a.dims.some((d) => d.clave === a.ordenCol);
  const clave = esDim ? (a.dims.find((d) => d.clave === a.ordenCol)!.nombre || a.dims.find((d) => d.clave === a.ordenCol)!.virtual ? a.ordenCol + "_id" : a.ordenCol) : a.ordenCol;
  const signo = q.sentido === "asc" ? 1 : -1;
  const cmp = (x: unknown, y: unknown): number => {
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === "number" && typeof y === "number") return signo * (x - y);
    return signo * String(x).localeCompare(String(y));
  };
  const resto = a.dims.filter((d) => d.clave !== a.ordenCol).map((d) => (d.nombre || d.virtual ? d.clave + "_id" : d.clave));
  out.sort((x, y) => { const c = cmp(x[clave], y[clave]); if (c) return c; for (const k of resto) { const r = String(x[k] ?? "").localeCompare(String(y[k] ?? "")); if (r) return r; } return 0; });
  return out;
}

export async function consultar(c: AppContext, cubo: Cubo, q: Consulta): Promise<Resultado> {
  const a = armar(cubo, q);
  const db = c.env[cubo.binding] as D1Database;
  const t0 = Date.now();
  let filasR: Record<string, unknown>[];
  try { filasR = await filas<Record<string, unknown>>(db, a.sql, a.params); }
  catch (e) { throw new ErrorHttp(504, `la consulta excedió la capacidad de la base (${(e as Error).message.slice(0, 120)}); reduzca columnas o agregue filtros`); }
  const ms = Date.now() - t0;
  const limite = q.limite ?? TOPE_FILAS;
  if (a.virtual) filasR = desplegar(a, filasR, q);
  const limitado = filasR.length > limite;
  if (limitado) filasR.length = limite;
  // claves INEGI de dimensiones geográficas con correspondencia estática
  for (const d of a.dims) {
    if (d.tipo !== "geografica" || !d.claves_geo) continue;
    const k = d.nombre || d.virtual ? d.clave + "_id" : d.clave;
    for (const f of filasR) f[d.clave + "_cve"] = d.claves_geo[String(f[k])] ?? null;
  }
  // orden de claves igual al de `columnas`
  const orden = a.columnas.map((x) => x.clave);
  const out = filasR.map((f) => { const o: Record<string, unknown> = {}; for (const k of orden) o[k] = f[k] ?? null; return o; });
  return { columnas: a.columnas, filas: out, n: out.length, limitado, limite, ms };
}

/** Miembros de una dimensión (id, nombre, filas), con búsqueda por contenido y respetando los filtros de otras dimensiones. */
export async function miembros(c: AppContext, cubo: Cubo, dim: Dimension, filtros: Record<string, string[]>, q: string | null, limite: number): Promise<{ id: string; nombre: string; n: number | null }[]> {
  if (dim.virtual) {
    const k = q ? q.toLowerCase() : null;
    return dim.virtual.filter((m) => !k || m.nombre.toLowerCase().includes(k) || m.id.toLowerCase().includes(k)).slice(0, limite).map((m) => ({ id: m.id, nombre: m.nombre, n: null }));
  }
  if (dim.miembros) {
    const partes: string[] = []; const params: unknown[] = [];
    if (dim.miembros.donde) partes.push(`(${dim.miembros.donde})`);
    if (q) { partes.push(`(${dim.miembros.nombre} LIKE ? COLLATE NOCASE OR ${dim.miembros.id} LIKE ? COLLATE NOCASE)`); params.push(`%${q}%`, `%${q}%`); }
    const sql = `SELECT ${dim.miembros.id} AS id, ${dim.miembros.nombre} AS nombre FROM ${dim.miembros.desde}${partes.length ? ` WHERE ${partes.join(" AND ")}` : ""} ORDER BY ${dim.miembros.orden ?? "2"} LIMIT ${limite}`;
    const r = await filas<{ id: unknown; nombre: unknown }>(c.env[cubo.binding] as D1Database, sql, params);
    return r.map((x) => ({ id: String(x.id), nombre: x.nombre === null || x.nombre === undefined ? String(x.id) : String(x.nombre), n: null }));
  }
  for (const d of cubo.filtro_obligatorio ?? []) if (d !== dim.clave && !filtros[d]?.length) throw err422(`f.${d}`, `los miembros de '${dim.clave}' se leen de la tabla de hechos y este cubo exige un filtro por '${d}' para recorrerla (por ejemplo f.${d}=${cubo.predeterminado.filtros?.[d]?.[0] ?? "…"})`, null);
  const partes: string[] = []; const params: unknown[] = [];
  if (cubo.donde) partes.push(`(${cubo.donde})`);
  for (const [k, valores] of Object.entries(filtros)) {
    const d = dimensionDe(cubo, k, `f.${k}`); if (d.virtual || d.clave === dim.clave) continue;
    partes.push(`${d.id} IN (${valores.map(() => "?").join(", ")})`); params.push(...valores);
  }
  if (q) { partes.push(`(${dim.nombre ?? dim.id} LIKE ? COLLATE NOCASE OR ${dim.id} LIKE ? COLLATE NOCASE)`); params.push(`%${q}%`, `%${q}%`); }
  const where = partes.length ? ` WHERE ${partes.join(" AND ")}` : "";
  const nombre = dim.nombre ?? dim.id;
  const sql = `SELECT ${dim.id} AS id, ${nombre} AS nombre, COUNT(*) AS n FROM ${cubo.desde}${where} GROUP BY ${dim.id}, ${nombre} ORDER BY ${dim.orden ?? "1"} LIMIT ${limite}`;
  const db = c.env[cubo.binding] as D1Database;
  const r = await filas<{ id: unknown; nombre: unknown; n: number }>(db, sql, params);
  return r.map((x) => ({ id: String(x.id), nombre: x.nombre === null || x.nombre === undefined ? String(x.id) : String(x.nombre), n: x.n }));
}

const memoria = new Map<string, { hasta: number; valor: unknown }>();
export async function memo<T>(clave: string, minutos: number, f: () => Promise<T>): Promise<T> {
  const c = memoria.get(clave); const ahora = Date.now();
  if (c && c.hasta > ahora) return c.valor as T;
  const v = await f(); memoria.set(clave, { hasta: ahora + minutos * 60_000, valor: v }); return v;
}

export async function filasDelCubo(c: AppContext, cubo: Cubo): Promise<number> {
  return memo(`filas:${cubo.clave}`, 30, async () => (await fila<{ n: number }>(c.env[cubo.binding] as D1Database, `SELECT COUNT(*) AS n FROM ${cubo.desde}${cubo.donde ? ` WHERE ${cubo.donde}` : ""}`))!.n);
}
export async function corteDelCubo(c: AppContext, cubo: Cubo): Promise<string | null> {
  if (!cubo.sql_corte) return null;
  return memo(`corte:${cubo.clave}`, 30, async () => { const r = await fila<{ corte: unknown }>(c.env[cubo.binding] as D1Database, cubo.sql_corte!); return r?.corte === null || r?.corte === undefined ? null : String(r.corte); });
}

/** CSV con BOM para Excel; los valores con coma, comilla o salto van entre comillas. */
export function aCsv(columnas: ColumnaResultado[], filasR: Record<string, unknown>[]): string {
  const esc = (v: unknown) => { if (v === null || v === undefined) return ""; const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lineas = [columnas.map((c) => esc(c.titulo)).join(",")];
  for (const f of filasR) lineas.push(columnas.map((c) => esc(f[c.clave])).join(","));
  return "﻿" + lineas.join("\r\n") + "\r\n";
}

// Banco de Información Económica (BIE) del INEGI: las series económicas (INPC, PIB trimestral, IGAE, balanza comercial,
// coyuntura, cuentas nacionales, manufacturas…) por área geográfica, descargadas completas del sitio del INEGI
// (scripts/bie_arbol.py, bie_descarga.py, bie_d1.py) en la D1 datosmexico-api-bie. Misma forma que /api/v1/inegi/*.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import { enteroOpcional, textoConPatron } from "../lib/validacion";
import { condicionBusqueda, terminosDe } from "../lib/busqueda";
import { memo } from "../cubos/motor";

const TAG = ["bie"];
const ok = (descripcion: string, esquema: z.ZodTypeAny) => ({ "200": { description: descripcion, ...contentJson(esquema) } });
const RESP_404 = { "404": { description: "No existe.", ...contentJson(z.object({ detail: z.string() })) } };
const RESP_422 = { "422": { description: "Parámetro inválido.", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };
const FUENTE = "INEGI — Banco de Información Económica (BIE), www.inegi.org.mx/app/indicadores/?tm=3";

const SerieZ = z.object({ id: z.string(), nombre: z.string(), unidad: z.string().nullable(), frecuencia: z.string().nullable(), fuente: z.string().nullable(), tema: z.string().nullable(), ruta: z.string().nullable(), periodo_inicial: z.string().nullable(), periodo_final: z.string().nullable(), ultima_actualizacion: z.string().nullable(), decimales: z.number().int().nullable(), n_areas: z.number().int(), n_observaciones: z.number().int() });
type Serie = z.infer<typeof SerieZ>;
const SEL = "id, nombre, unidad, frecuencia, fuente, tema, ruta, periodo_inicial, periodo_final, ultima_actualizacion, decimales, n_areas, n_observaciones";
type NodoTema = { tema: string; nombre: string; tema_superior: string | null; orden: number | null; nivel: number };
async function arbol(c: AppContext): Promise<Map<string, NodoTema>> {
  return memo("bie:temas", 30, async () => new Map((await filas<NodoTema>(c.env.DB_BIE, "SELECT tema, nombre, tema_superior, orden, nivel FROM temas")).map((t) => [t.tema, t])));
}
function rutaDe(temas: Map<string, NodoTema>, hoja: string | null): { tema: string; nombre: string; nivel: number }[] {
  const out: { tema: string; nombre: string; nivel: number }[] = [];
  for (let t = hoja; t; t = temas.get(t)?.tema_superior ?? null) { const n = temas.get(t); if (!n) break; out.unshift({ tema: n.tema, nombre: n.nombre, nivel: n.nivel }); }
  return out;
}

export class BieResumen extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "bie_resumen", summary: "Cuántas series del BIE tenemos y hasta cuándo",
    description: "Resumen verificable del Banco de Información Económica en el observatorio: series, observaciones, áreas geográficas, temas del árbol, periodos extremos y última actualización publicada por el INEGI. El BIE es el otro banco del INEGI (además del Banco de Indicadores, /api/v1/inegi): inflación (INPC), PIB trimestral, IGAE, balanza comercial, indicadores de coyuntura, cuentas nacionales, manufacturas, sector externo…",
    responses: { ...ok("Resumen del BIE.", z.object({ fuente: z.string(), series: z.number().int(), observaciones: z.number().int(), areas: z.number().int(), temas: z.number().int(), primer_periodo: z.string().nullable(), ultimo_periodo: z.string().nullable(), ultima_actualizacion_inegi: z.string().nullable(), nota: z.string() })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const db = c.env.DB_BIE;
    const r = (await fila<{ series: number; obs: number; act: string | null }>(db, "SELECT COUNT(*) AS series, SUM(n_observaciones) AS obs, MAX(ultima_actualizacion) AS act FROM series"))!;
    const p = (await fila<{ p0: string | null; p1: string | null }>(db, "SELECT MIN(periodo) AS p0, MAX(periodo) AS p1 FROM periodos"))!;
    const areas = (await fila<{ n: number }>(db, "SELECT COUNT(*) AS n FROM areas"))!.n; const temas = (await fila<{ n: number }>(db, "SELECT COUNT(*) AS n FROM temas"))!.n;
    return { fuente: FUENTE, series: r.series, observaciones: r.obs, areas, temas, primer_periodo: p.p0, ultimo_periodo: p.p1, ultima_actualizacion_inegi: r.act, nota: "Descargado de la API interna del sitio del INEGI (su API de desarrolladores no responde para el BIE); cada valor se guarda como lo publica el INEGI." };
  }
}

export class BieSeries extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "bie_series", summary: "Buscar series del BIE",
    description: "Busca en las series del Banco de Información Económica. `q` busca sin distinguir acentos ni mayúsculas en el nombre, la ruta temática, la unidad y la fuente, y amplía con sinónimos («inflación» también busca «precios al consumidor»; los términos usados vienen en `terminos`). Filtros: `tema` (tema hoja del árbol, ver /api/v1/bie/arbol), `frecuencia`. Paginado con `limit` (1-500) y `offset`.",
    request: { query: z.object({ q: z.string().optional(), tema: z.string().optional(), frecuencia: z.string().optional(), limit: z.number().int().min(1).max(500).default(50).optional(), offset: z.number().int().min(0).default(0).optional() }) },
    responses: { ...ok("Series que cumplen los filtros.", z.object({ total: z.number().int(), limit: z.number().int(), offset: z.number().int(), terminos: z.array(z.string()), items: z.array(SerieZ) })), ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const q = c.req.query("q"); const tema = textoConPatron(c.req.query("tema"), "tema", "^\\d+$"); const frecuencia = c.req.query("frecuencia");
    const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 500) ?? 50; const offset = enteroOpcional(c.req.query("offset"), "offset", 0) ?? 0;
    const cond: string[] = []; const params: unknown[] = [];
    let ordenQ = ""; const ordenParams: unknown[] = [];
    if (q) { const b = condicionBusqueda("busqueda", q); cond.push(b.sql); params.push(...b.params); ordenQ = `${b.orden}, `; ordenParams.push(...b.ordenParams); }
    if (tema) { cond.push("tema = ?"); params.push(tema); }
    if (frecuencia) { cond.push("frecuencia = ? COLLATE NOCASE"); params.push(frecuencia); }
    const where = cond.length ? " WHERE " + cond.join(" AND ") : "";
    const total = (await fila<{ n: number }>(c.env.DB_BIE, `SELECT COUNT(*) AS n FROM series${where}`, params))!.n;
    const items = await filas<Serie>(c.env.DB_BIE, `SELECT ${SEL} FROM series${where} ORDER BY ${ordenQ}n_observaciones DESC, CAST(id AS INTEGER) LIMIT ? OFFSET ?`, [...params, ...ordenParams, limit, offset]);
    return { total, limit, offset, terminos: q ? terminosDe(q) : [], items };
  }
}

export class BieSerie extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "bie_serie", summary: "Ficha de una serie del BIE",
    description: "Metadatos de una serie (nombre, unidad, frecuencia, fuente, periodos, última actualización del INEGI), su ruta temática completa y las áreas geográficas con observaciones.",
    request: { params: z.object({ id: z.string() }) },
    responses: { ...ok("Ficha.", SerieZ.extend({ ruta_temas: z.array(z.object({ tema: z.string(), nombre: z.string(), nivel: z.number().int() })), areas: z.array(z.object({ clave: z.string(), nombre: z.string(), desglose: z.string(), n_observaciones: z.number().int() })), observaciones_url: z.string() })), ...RESP_404, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const id = c.req.param("id") ?? "";
    const s = await fila<Serie>(c.env.DB_BIE, `SELECT ${SEL} FROM series WHERE id = ?`, [id]);
    if (!s) throw new ErrorHttp(404, `la serie '${id}' no existe en el BIE`);
    const areas = await filas<{ clave: string; nombre: string; desglose: string; n_observaciones: number }>(c.env.DB_BIE, "SELECT a.clave, a.nombre, a.desglose, COUNT(*) AS n_observaciones FROM observaciones o JOIN areas a ON a.clave = o.area WHERE o.serie = ? GROUP BY a.clave ORDER BY a.clave", [id]);
    return { ...s, ruta_temas: rutaDe(await arbol(c), s.tema), areas, observaciones_url: `/api/v1/bie/series/${id}/observaciones` };
  }
}

export class BieObservaciones extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "bie_observaciones", summary: "Serie del BIE (observaciones)",
    description: "Observaciones de una serie tal como las publica el INEGI: `valor_texto` es el decimal original y `valor` el número; `estatus` es la letra de la cifra cuando el INEGI la publica (D definitiva, P preliminar, R revisada…). `area` filtra por clave (00 nacional, 01-32 entidades; otras áreas en la ficha). `desde`/`hasta` acotan el periodo por comparación de texto en el formato del INEGI ('2020/01', '2020/02'…). Paginado con `limit` (1-5000) y `offset`.",
    request: { params: z.object({ id: z.string() }), query: z.object({ area: z.string().optional(), desde: z.string().optional(), hasta: z.string().optional(), limit: z.number().int().min(1).max(5000).default(1000).optional(), offset: z.number().int().min(0).default(0).optional() }) },
    responses: { ...ok("Observaciones.", z.object({ serie: z.string(), nombre: z.string(), unidad: z.string().nullable(), frecuencia: z.string().nullable(), total: z.number().int(), limit: z.number().int(), offset: z.number().int(), observaciones: z.array(z.object({ area: z.string(), periodo: z.string(), valor: z.number().nullable(), valor_texto: z.string(), estatus: z.string().nullable() })) })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const id = c.req.param("id") ?? ""; const area = c.req.query("area") ?? null; const desde = c.req.query("desde") ?? null; const hasta = c.req.query("hasta") ?? null;
    const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 5000) ?? 1000; const offset = enteroOpcional(c.req.query("offset"), "offset", 0) ?? 0;
    const s = await fila<Serie>(c.env.DB_BIE, `SELECT ${SEL} FROM series WHERE id = ?`, [id]);
    if (!s) throw new ErrorHttp(404, `la serie '${id}' no existe en el BIE`);
    const cond = ["serie = ?"]; const params: unknown[] = [id];
    if (area) { cond.push("area = ?"); params.push(area); }
    if (desde) { cond.push("periodo >= ?"); params.push(desde); }
    if (hasta) { cond.push("periodo <= ?"); params.push(hasta); }
    const where = " WHERE " + cond.join(" AND ");
    const total = (await fila<{ n: number }>(c.env.DB_BIE, `SELECT COUNT(*) AS n FROM observaciones${where}`, params))!.n;
    const observaciones = await filas<{ area: string; periodo: string; valor: number | null; valor_texto: string; estatus: string | null }>(c.env.DB_BIE, `SELECT area, periodo, valor, valor_texto, estatus FROM observaciones${where} ORDER BY area, periodo LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { serie: id, nombre: s.nombre, unidad: s.unidad, frecuencia: s.frecuencia, total, limit, offset, observaciones };
  }
}

export class BieArbol extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "bie_arbol", summary: "Árbol temático del BIE",
    description: "La jerarquía de temas con la que el INEGI organiza el Banco de Información Económica (14 temas raíz: coyuntura, ocupación, productividad, cuentas nacionales, manufacturas, sector externo…). Sin `tema` devuelve las raíces; con `tema`, la ruta hasta él, sus subtemas y las series que cuelgan directamente de él (`limit`/`offset` paginan las series).",
    request: { query: z.object({ tema: z.string().optional(), limit: z.number().int().min(1).max(500).default(100).optional(), offset: z.number().int().min(0).default(0).optional() }) },
    responses: { ...ok("Nodo.", z.object({ fuente: z.string(), ruta: z.array(z.object({ tema: z.string(), nombre: z.string(), nivel: z.number().int() })), tema: z.object({ tema: z.string(), nombre: z.string(), nivel: z.number().int(), n_subtemas: z.number().int(), n_series: z.number().int() }).nullable(), subtemas: z.array(z.object({ tema: z.string(), nombre: z.string(), nivel: z.number().int(), orden: z.number().int().nullable(), n_subtemas: z.number().int(), n_series: z.number().int() })), series_total: z.number().int(), limit: z.number().int(), offset: z.number().int(), series: z.array(SerieZ) })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const tema = textoConPatron(c.req.query("tema"), "tema", "^\\d+$");
    const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 500) ?? 100; const offset = enteroOpcional(c.req.query("offset"), "offset", 0) ?? 0;
    const temas = await arbol(c);
    if (tema && !temas.has(tema)) throw new ErrorHttp(404, `el tema '${tema}' no existe en el árbol del BIE`);
    const directos = await memo("bie:directos", 30, async () => new Map((await filas<{ tema: string; n: number }>(c.env.DB_BIE, "SELECT tema, COUNT(*) AS n FROM serie_temas GROUP BY tema")).map((x) => [x.tema, x.n])));
    const hijosDe = new Map<string | null, NodoTema[]>();
    for (const t of temas.values()) { const k = t.tema_superior || null; if (!hijosDe.has(k)) hijosDe.set(k, []); hijosDe.get(k)!.push(t); }
    const bajo = (t: string): number => (directos.get(t) ?? 0) + (hijosDe.get(t) ?? []).reduce((s, h) => s + bajo(h.tema), 0);
    const nodo = (t: NodoTema) => ({ tema: t.tema, nombre: t.nombre, nivel: t.nivel, orden: t.orden, n_subtemas: (hijosDe.get(t.tema) ?? []).length, n_series: bajo(t.tema) });
    const subtemas = (hijosDe.get(tema ?? null) ?? []).slice().sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || Number(a.tema) - Number(b.tema)).map(nodo);
    let series_total = 0; let series: Serie[] = [];
    if (tema) { series_total = directos.get(tema) ?? 0; series = await filas<Serie>(c.env.DB_BIE, `SELECT ${SEL} FROM series s JOIN serie_temas st ON st.serie = s.id WHERE st.tema = ? ORDER BY CAST(s.id AS INTEGER) LIMIT ? OFFSET ?`, [tema, limit, offset]); }
    return { fuente: FUENTE, ruta: tema ? rutaDe(temas, tema) : [], tema: tema ? nodo(temas.get(tema)!) : null, subtemas, series_total, limit, offset, series };
  }
}

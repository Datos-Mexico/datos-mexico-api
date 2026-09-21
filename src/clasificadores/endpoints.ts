// Catálogos y clasificadores autónomos del INEGI (D1 datosmexico-api-clasificadores, scripts/clasificadores_d1.py):
// SCIAN 2023/2018/2013 con su índice de productos, SINCO 2019/2011, CMO histórica y el Catálogo Único de Claves de Áreas
// Geoestadísticas (AGEEML: 32 entidades, 2,478 municipios y 296,633 localidades vigentes al corte 2026/08). Cada catálogo se
// cargó solo después de reproducir los conteos por nivel que el INEGI publica (tabla `catalogos.verificacion`).
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { memo } from "../cubos/motor";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import type { Detalle } from "../lib/validacion";
import { enteroOpcional, textoConPatron } from "../lib/validacion";

const TAG = ["clasificadores"];
const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const RESP_404 = { "404": { description: "No existe.", ...contentJson(z.object({ detail: z.string() })) } };
const RESP_422 = { "422": { description: "Parámetro inválido.", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };
const VERSIONES = { scian: ["2023", "2018", "2013"], sinco: ["2019", "2011"] } as const;
const NIVELES = { scian: ["sector", "subsector", "rama", "subrama", "clase"], sinco: ["division", "grupo_principal", "subgrupo", "grupo_unitario"], cmo: ["grupo_principal", "subgrupo", "grupo_unitario"] } as const;
type Clasificador = keyof typeof NIVELES;
function version(c: Clasificador, v: string | undefined): string | null {
  if (c === "cmo") return null;
  const vs = VERSIONES[c] as readonly string[]; const x = v ?? vs[0];
  if (!vs.includes(x)) throw new ErrorHttp(422, [{ type: "enum", loc: ["query", "version"], msg: `Input should be ${vs.map((s) => `'${s}'`).join(", ")}`, input: v } satisfies Detalle]);
  return x;
}
function nivelValido(c: Clasificador, n: string | undefined): string | null {
  if (n === undefined) return null;
  if (!(NIVELES[c] as readonly string[]).includes(n)) throw new ErrorHttp(422, [{ type: "enum", loc: ["query", "nivel"], msg: `Input should be ${NIVELES[c].map((s) => `'${s}'`).join(", ")}`, input: n } satisfies Detalle]);
  return n;
}

const Catalogo = z.object({ catalogo: z.string(), titulo: z.string(), version: z.string(), fuente_url: z.string(), corte: z.string().nullable(), filas: z.number().int(), verificacion: z.array(z.object({ nivel: z.string(), obtenido: z.number().int(), publicado: z.number().int().nullable(), estado: z.string() })) });
export class ClasificadoresLista extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clasificadores_lista", summary: "Qué catálogos y clasificadores del INEGI tenemos y cómo se verificaron",
    description: "SCIAN 2023, 2018 y 2013 (con índice de productos), SINCO 2019 y 2011, Clasificación Mexicana de Ocupaciones (histórica) y el Catálogo Único de Claves de Áreas Geoestadísticas (entidades, municipios, localidades). Para cada uno: origen exacto, versión o corte que declara el INEGI, filas cargadas y los conteos por nivel obtenidos contra los publicados por el INEGI.",
    responses: { ...ok("Catálogos.", z.object({ n: z.number().int(), items: z.array(Catalogo) })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const r = await memo("clasificadores:lista", 60, () => filas<Record<string, unknown>>(c.env.DB_CLASIFICADORES, "SELECT * FROM catalogos ORDER BY catalogo"));
    return { n: r.length, items: r.map((x) => ({ ...x, verificacion: JSON.parse(String(x.verificacion)) })) };
  }
}

const Categoria = z.object({ version: z.string().nullable(), nivel: z.string(), codigo: z.string(), codigo_padre: z.string().nullable(), titulo: z.string(), descripcion: z.string().nullable() }).passthrough();
const Pagina = z.object({ clasificador: z.string(), version: z.string().nullable(), total: z.number().int(), limit: z.number().int(), offset: z.number().int(), items: z.array(Categoria) });
function buscar(c: Clasificador) {
  return class extends OpenAPIRoute {
    schema = {
      tags: TAG, operationId: `clasificador_${c}`, summary: { scian: "SCIAN: sectores, subsectores, ramas, subramas y clases", sinco: "SINCO: divisiones, grupos principales, subgrupos y grupos unitarios", cmo: "CMO (histórica): grupos principales, subgrupos y grupos unitarios" }[c],
      description: { scian: "Sistema de Clasificación Industrial de América del Norte, tal como lo publica el INEGI (archivo de estructura y productos del visor SCIAN). `version` 2023 (por omisión), 2018 o 2013; `nivel` sector, subsector, rama, subrama o clase; `codigo_padre` para descender un nivel; `q` busca en título y descripción. Cada categoría trae descripción, «incluye», «excluye» y la marca de comparabilidad con Canadá y Estados Unidos.", sinco: "Sistema Nacional de Clasificación de Ocupaciones. `version` 2019 (por omisión; edición 2020 con la fe de erratas de 2025) o 2011; `nivel` division, grupo_principal, subgrupo o grupo_unitario. La versión 2019 trae descripción y ocupaciones de ejemplo (extraídas del documento oficial, que el INEGI solo publica en PDF); 2011 solo códigos y títulos.", cmo: "Clasificación Mexicana de Ocupaciones (versión histórica, la que usó la ENOE hasta 2012), extraída de los volúmenes I y II que el INEGI publica en PDF. `nivel` grupo_principal, subgrupo o grupo_unitario." }[c],
      request: { query: z.object({ ...(c === "cmo" ? {} : { version: z.enum(VERSIONES[c as "scian" | "sinco"]).optional() }), nivel: z.enum(NIVELES[c]).optional(), codigo_padre: z.string().optional(), q: z.string().optional(), limit: z.number().int().min(1).max(2000).default(200).optional(), offset: z.number().int().min(0).default(0).optional() }) },
      responses: { ...ok("Categorías.", Pagina), ...RESP_422, ...RESP_429 },
    };
    async handle(ctx: AppContext) {
      const v = version(c, ctx.req.query("version")); const nivel = nivelValido(c, ctx.req.query("nivel")); const padre = ctx.req.query("codigo_padre"); const q = ctx.req.query("q");
      const limit = enteroOpcional(ctx.req.query("limit"), "limit", 1, 2000) ?? 200; const offset = enteroOpcional(ctx.req.query("offset"), "offset", 0) ?? 0;
      const cond: string[] = []; const params: unknown[] = [];
      if (v) { cond.push("version = ?"); params.push(v); }
      if (nivel) { cond.push("nivel = ?"); params.push(nivel); }
      if (padre) { cond.push("codigo_padre = ?"); params.push(padre); }
      if (q) { cond.push("(titulo LIKE ? COLLATE NOCASE OR descripcion LIKE ? COLLATE NOCASE OR codigo LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `${q}%`); }
      const where = cond.length ? " WHERE " + cond.join(" AND ") : "";
      const db = ctx.env.DB_CLASIFICADORES;
      const total = (await fila<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${c}${where}`, params))!.n;
      const items = await filas<Record<string, unknown>>(db, `SELECT ${c === "cmo" ? "NULL AS version, " : ""}* FROM ${c}${where} ORDER BY codigo LIMIT ? OFFSET ?`, [...params, limit, offset]);
      return { clasificador: c, version: v, total, limit, offset, items };
    }
  };
}
export const ClasificadorScian = buscar("scian"); export const ClasificadorSinco = buscar("sinco"); export const ClasificadorCmo = buscar("cmo");

const Ficha = z.object({ clasificador: z.string(), version: z.string().nullable(), categoria: Categoria, ancestros: z.array(Categoria), hijos: z.array(Categoria), productos: z.array(z.string()).optional(), ocupaciones: z.array(z.string()).optional() });
function ficha(c: Clasificador) {
  return class extends OpenAPIRoute {
    schema = {
      tags: TAG, operationId: `clasificador_${c}_codigo`, summary: { scian: "Una categoría del SCIAN con sus ancestros, hijos y productos", sinco: "Una categoría del SINCO con sus ancestros e hijos", cmo: "Una categoría de la CMO con sus ancestros, hijos y ocupaciones" }[c],
      description: "Ficha completa de un código: la categoría, la cadena de ancestros hasta el nivel superior, los hijos directos y, en el SCIAN, el índice de productos de la clase; en la CMO, las ocupaciones individuales del grupo unitario.",
      request: { params: z.object({ codigo: z.string() }), query: z.object(c === "cmo" ? {} : { version: z.enum(VERSIONES[c as "scian" | "sinco"]).optional() }) },
      responses: { ...ok("Ficha.", Ficha), ...RESP_404, ...RESP_422, ...RESP_429 },
    };
    async handle(ctx: AppContext) {
      const v = version(c, ctx.req.query("version")); const codigo = ctx.req.param("codigo") ?? ""; const db = ctx.env.DB_CLASIFICADORES;
      const wv = v ? " AND version = ?" : ""; const pv = v ? [v] : [];
      const cat = await fila<Record<string, unknown>>(db, `SELECT * FROM ${c} WHERE codigo = ?${wv}`, [codigo, ...pv]);
      if (!cat) throw new ErrorHttp(404, `código '${codigo}' no existe en ${c}${v ? " " + v : ""}`);
      const ancestros: Record<string, unknown>[] = []; let p = cat.codigo_padre as string | null;
      while (p) { const a = await fila<Record<string, unknown>>(db, `SELECT * FROM ${c} WHERE codigo = ?${wv}`, [p, ...pv]); if (!a) break; ancestros.unshift(a); p = a.codigo_padre as string | null; }
      const hijos = await filas<Record<string, unknown>>(db, `SELECT * FROM ${c} WHERE codigo_padre = ?${wv} ORDER BY codigo`, [codigo, ...pv]);
      const extra: Record<string, string[]> = {};
      if (c === "scian") extra.productos = (await filas<{ producto: string }>(db, "SELECT producto FROM scian_productos WHERE version = ? AND codigo_clase = ? ORDER BY orden", [v, codigo])).map((x) => x.producto);
      if (c === "cmo") extra.ocupaciones = (await filas<{ ocupacion: string }>(db, "SELECT ocupacion FROM cmo_ocupaciones WHERE codigo_grupo_unitario = ? ORDER BY orden", [codigo])).map((x) => x.ocupacion);
      return { clasificador: c, version: v, categoria: c === "cmo" ? { version: null, ...cat } : cat, ancestros, hijos, ...extra };
    }
  };
}
export const ClasificadorScianCodigo = ficha("scian"); export const ClasificadorSincoCodigo = ficha("sinco"); export const ClasificadorCmoCodigo = ficha("cmo");

// ---------------------------------------------------------------- AGEEML
const Entidad = z.object({ cve_ent: z.string(), nom_ent: z.string(), nom_abr: z.string().nullable(), pob_total: z.number().int().nullable(), pob_masculina: z.number().int().nullable(), pob_femenina: z.number().int().nullable(), viviendas_habitadas: z.number().int().nullable(), fecha_corte: z.string().nullable() });
export class GeoEntidades extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "geo_entidades", summary: "Las 32 entidades federativas (Catálogo Único de Claves de Áreas Geoestadísticas)", description: "Clave, nombre oficial y abreviatura del INEGI, con la población y viviendas habitadas del Censo 2020 que el catálogo trae asociadas.", responses: { ...ok("Entidades.", z.object({ n: z.number().int(), items: z.array(Entidad) })), ...RESP_429 } };
  async handle(c: AppContext) { const r = await memo("geo:entidades", 60, () => filas<Record<string, unknown>>(c.env.DB_CLASIFICADORES, "SELECT * FROM ageeml_entidades ORDER BY cve_ent")); return { n: r.length, items: r }; }
}
const Municipio = z.object({ cve_ent: z.string(), cve_mun: z.string(), cvegeo: z.string(), nom_ent: z.string(), nom_mun: z.string(), cve_cab: z.string().nullable(), nom_cab: z.string().nullable(), pob_total: z.number().int().nullable(), viviendas_habitadas: z.number().int().nullable(), fecha_corte: z.string().nullable() }).passthrough();
export class GeoMunicipios extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "geo_municipios", summary: "Los 2,478 municipios y demarcaciones (corte 2026/06)", description: "Catálogo Único de Claves de Áreas Geoestadísticas Municipales del INEGI: clave, nombre, cabecera municipal y población del Censo 2020. Filtros `cve_ent` (2 dígitos) y `q` (nombre contiene).", request: { query: z.object({ cve_ent: z.string().regex(/^\d{2}$/).optional(), q: z.string().optional() }) }, responses: { ...ok("Municipios.", z.object({ n: z.number().int(), items: z.array(Municipio) })), ...RESP_422, ...RESP_429 } };
  async handle(c: AppContext) {
    const ent = textoConPatron(c.req.query("cve_ent"), "cve_ent", "^\\d{2}$"); const q = c.req.query("q"); const cond: string[] = []; const params: unknown[] = [];
    if (ent) { cond.push("cve_ent = ?"); params.push(ent); }
    if (q) { cond.push("nom_mun LIKE ? COLLATE NOCASE"); params.push(`%${q}%`); }
    const r = await filas<Record<string, unknown>>(c.env.DB_CLASIFICADORES, `SELECT * FROM ageeml_municipios${cond.length ? " WHERE " + cond.join(" AND ") : ""} ORDER BY cve_ent, cve_mun`, params);
    return { n: r.length, items: r };
  }
}
const Localidad = z.object({ cve_ent: z.string(), cve_mun: z.string(), cve_loc: z.string(), cvegeo: z.string(), nom_ent: z.string(), nom_mun: z.string(), nom_loc: z.string(), ambito: z.string().nullable(), lat: z.number().nullable(), lon: z.number().nullable(), altitud: z.number().int().nullable(), pob_total: z.number().int().nullable(), fecha_corte: z.string().nullable() }).passthrough();
export class GeoLocalidades extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "geo_localidades", summary: "Las 296,633 localidades vigentes (corte 2026/08) con coordenadas y población", description: "Catálogo Único de Claves de Áreas Geoestadísticas de Localidades: clave, nombre, ámbito (U urbana, R rural), latitud, longitud, altitud, carta topográfica y población y viviendas del Censo 2020 (vacío donde el INEGI no la publica). Filtros: `cve_ent`, `cve_mun` (requiere cve_ent), `ambito` (U o R), `q` (nombre contiene). Paginado con `limit` (1-1000) y `offset`.", request: { query: z.object({ cve_ent: z.string().regex(/^\d{2}$/).optional(), cve_mun: z.string().regex(/^\d{3}$/).optional(), ambito: z.enum(["U", "R"]).optional(), q: z.string().optional(), limit: z.number().int().min(1).max(1000).default(100).optional(), offset: z.number().int().min(0).default(0).optional() }) }, responses: { ...ok("Localidades.", z.object({ total: z.number().int(), limit: z.number().int(), offset: z.number().int(), items: z.array(Localidad) })), ...RESP_422, ...RESP_429 } };
  async handle(c: AppContext) {
    const ent = textoConPatron(c.req.query("cve_ent"), "cve_ent", "^\\d{2}$"); const mun = textoConPatron(c.req.query("cve_mun"), "cve_mun", "^\\d{3}$"); const amb = c.req.query("ambito"); const q = c.req.query("q");
    const limit = enteroOpcional(c.req.query("limit"), "limit", 1, 1000) ?? 100; const offset = enteroOpcional(c.req.query("offset"), "offset", 0) ?? 0;
    if (mun && !ent) throw new ErrorHttp(422, [{ type: "missing", loc: ["query", "cve_ent"], msg: "Field required", input: null } satisfies Detalle]);
    if (amb && amb !== "U" && amb !== "R") throw new ErrorHttp(422, [{ type: "enum", loc: ["query", "ambito"], msg: "Input should be 'U' or 'R'", input: amb } satisfies Detalle]);
    const cond: string[] = []; const params: unknown[] = [];
    if (ent) { cond.push("cve_ent = ?"); params.push(ent); }
    if (mun) { cond.push("cve_mun = ?"); params.push(mun); }
    if (amb) { cond.push("ambito = ?"); params.push(amb); }
    if (q) { cond.push("nom_loc LIKE ? COLLATE NOCASE"); params.push(`%${q}%`); }
    const where = cond.length ? " WHERE " + cond.join(" AND ") : ""; const db = c.env.DB_CLASIFICADORES;
    const total = (await fila<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ageeml_localidades${where}`, params))!.n;
    const items = await filas<Record<string, unknown>>(db, `SELECT * FROM ageeml_localidades${where} ORDER BY cve_ent, cve_mun, cve_loc LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return { total, limit, offset, items };
  }
}
export class GeoLocalidad extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "geo_localidad", summary: "Una localidad por su clave geoestadística (9 dígitos)", request: { params: z.object({ cvegeo: z.string().regex(/^\d{9}$/) }) }, responses: { ...ok("Localidad.", Localidad), ...RESP_404, ...RESP_429 } };
  async handle(c: AppContext) {
    const r = await fila<Record<string, unknown>>(c.env.DB_CLASIFICADORES, "SELECT * FROM ageeml_localidades WHERE cvegeo = ?", [c.req.param("cvegeo")]);
    if (!r) throw new ErrorHttp(404, "localidad no existe en el catálogo vigente"); return r;
  }
}

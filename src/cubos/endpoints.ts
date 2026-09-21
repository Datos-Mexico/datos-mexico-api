// Cubos: la capa uniforme que consume el explorador del observatorio (datosmexico.org/observatorio). Catálogo, ficha
// (diccionario), miembros de una dimensión y la consulta (tabla agregada en JSON o CSV) con una URL que la reproduce.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import { enteroOpcional } from "../lib/validacion";
import { CUBOS, TEMAS, cuboPorClave } from "./definiciones";
import { TOPE_FILAS, TOPE_MIEMBROS, aCsv, consultar, corteDelCubo, dimensionDe, filasDelCubo, leerConsulta, miembros } from "./motor";
import type { Cubo } from "./tipos";

const TAG = ["cubos"];
const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const RESP_404 = { "404": { description: "No existe.", ...contentJson(z.object({ detail: z.string() })) } };
const RESP_422 = { "422": { description: "Parámetro inválido.", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };
const CLAVE = "^[a-z0-9]+(-[a-z0-9]+)*$";

const MedidaZ = z.object({ clave: z.string(), titulo: z.string(), unidad: z.string().nullable(), sumable: z.boolean(), decimales: z.number().int().nullable(), descripcion: z.string().nullable() });
const DimensionZ = z.object({ clave: z.string(), titulo: z.string(), tipo: z.enum(["categorica", "temporal", "geografica"]), geo: z.string().nullable(), padre: z.string().nullable(), virtual: z.boolean(), con_nombre: z.boolean(), filtro_obligatorio: z.boolean(), descripcion: z.string().nullable() });
const ResumenZ = z.object({ clave: z.string(), nombre: z.string(), tema: z.string(), descripcion: z.string(), fuente: z.string(), fuente_url: z.string(), licencia: z.string(), n_medidas: z.number().int(), n_dimensiones: z.number().int(), ficha_url: z.string(), datos_url: z.string() });
const FichaZ = ResumenZ.extend({ filas: z.number().int(), corte: z.string().nullable(), medidas: z.array(MedidaZ), dimensiones: z.array(DimensionZ), predeterminado: z.object({ medidas: z.array(z.string()), columnas: z.array(z.string()), filtros: z.record(z.string(), z.array(z.string())) }), notas: z.array(z.string()), api_dominio: z.string(), miembros_url: z.string(), como_consultar: z.string() });
const ColumnaZ = z.object({ clave: z.string(), titulo: z.string(), tipo: z.enum(["id", "dimension", "geo", "medida"]), dimension: z.string().optional(), unidad: z.string().optional(), sumable: z.boolean().optional() });

const urlPredeterminada = (c: Cubo): string => {
  const p = new URLSearchParams(); p.set("medidas", c.predeterminado.medidas.join(",")); p.set("columnas", c.predeterminado.columnas.join(","));
  for (const [k, v] of Object.entries(c.predeterminado.filtros ?? {})) p.set(`f.${k}`, v.join("|"));
  p.set("limite", "50");
  return `/api/v1/cubos/${c.clave}/datos?${p.toString()}`;
};
const resumen = (c: Cubo) => ({ clave: c.clave, nombre: c.nombre, tema: c.tema, descripcion: c.descripcion, fuente: c.fuente, fuente_url: c.fuente_url, licencia: c.licencia, n_medidas: c.medidas.length, n_dimensiones: c.dimensiones.length, ficha_url: `/api/v1/cubos/${c.clave}`, datos_url: urlPredeterminada(c) });

function cuboOr404(clave: string): Cubo {
  if (!new RegExp(CLAVE).test(clave)) throw new ErrorHttp(404, `el cubo '${clave}' no existe; consulte /api/v1/cubos`);
  const c = cuboPorClave(clave);
  if (!c) throw new ErrorHttp(404, `el cubo '${clave}' no existe; consulte /api/v1/cubos`);
  return c;
}

export class CubosCatalogo extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "cubos_catalogo", summary: "Qué cubos se pueden explorar",
    description: "Catálogo de los cubos del explorador del observatorio, agrupados por tema. Un cubo es una tabla consultable con medidas (columnas numéricas que se agregan) y dimensiones (columnas por las que se agrupa y filtra). Cada cubo trae la URL de su ficha (diccionario) y la de su consulta predeterminada.",
    responses: { ...ok("Catálogo.", z.object({ n_temas: z.number().int(), n_cubos: z.number().int(), como_consultar: z.string(), temas: z.array(z.object({ clave: z.string(), nombre: z.string(), descripcion: z.string(), cubos: z.array(ResumenZ) })) })), ...RESP_429 },
  };
  async handle() {
    return { n_temas: TEMAS.length, n_cubos: CUBOS.length, como_consultar: COMO_CONSULTAR, temas: TEMAS.map((t) => ({ ...t, cubos: CUBOS.filter((c) => c.tema === t.clave).map(resumen) })) };
  }
}

const COMO_CONSULTAR = "GET /api/v1/cubos/{cubo}/datos?medidas=a,b&columnas=x,y&f.x=v1|v2&padres=1&orden=a&sentido=desc&limite=50&formato=jsonrecords|jsonarrays|csv. Las medidas y columnas se separan con coma; cada filtro es un parámetro f.<dimensión> cuyos valores (identificadores de miembro, ver /miembros) se separan con |. Sin `limite` se devuelven hasta 50,000 filas y `limitado` avisa si faltaron.";

export class CuboFicha extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "cubo_ficha", summary: "Ficha (diccionario) de un cubo",
    description: "Medidas con unidad y si son sumables, dimensiones con tipo (categórica, temporal, geográfica), jerarquía (padre) y si son virtuales (sus miembros son columnas de una tabla ancha), filas del universo, corte más reciente, consulta predeterminada, notas de método y fuente.",
    request: { params: z.object({ cubo: z.string() }) },
    responses: { ...ok("Ficha.", FichaZ), ...RESP_404, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const cubo = cuboOr404(c.req.param("cubo") ?? "");
    const [filas, corte] = await Promise.all([filasDelCubo(c, cubo), corteDelCubo(c, cubo)]);
    return {
      ...resumen(cubo), filas, corte,
      medidas: cubo.medidas.map((m) => ({ clave: m.clave, titulo: m.titulo, unidad: m.unidad ?? null, sumable: m.sumable, decimales: m.decimales ?? null, descripcion: m.descripcion ?? null })),
      dimensiones: cubo.dimensiones.map((d) => ({ clave: d.clave, titulo: d.titulo, tipo: d.tipo, geo: d.geo ?? null, padre: d.padre ?? null, virtual: !!d.virtual, con_nombre: !!(d.nombre || d.virtual), filtro_obligatorio: (cubo.filtro_obligatorio ?? []).includes(d.clave), descripcion: d.descripcion ?? null })),
      predeterminado: { medidas: cubo.predeterminado.medidas, columnas: cubo.predeterminado.columnas, filtros: cubo.predeterminado.filtros ?? {} },
      notas: cubo.notas, api_dominio: cubo.api_dominio, miembros_url: `/api/v1/cubos/${cubo.clave}/miembros?dimension=${cubo.dimensiones[0].clave}`, como_consultar: COMO_CONSULTAR,
    };
  }
}

export class CuboMiembros extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "cubo_miembros", summary: "Miembros de una dimensión",
    description: "Los valores que toma una dimensión (identificador, nombre y filas), ordenados como en la fuente. `q` busca por contenido en el nombre o el identificador; los filtros `f.<dimensión>` de otras dimensiones acotan la lista (por ejemplo, las escuelas de una institución). Tope: 5,000 miembros por llamada.",
    request: { params: z.object({ cubo: z.string() }), query: z.object({ dimension: z.string(), q: z.string().optional(), limite: z.number().int().min(1).max(TOPE_MIEMBROS).optional() }) },
    responses: { ...ok("Miembros.", z.object({ cubo: z.string(), dimension: z.string(), n: z.number().int(), limitado: z.boolean(), items: z.array(z.object({ id: z.string(), nombre: z.string(), n: z.number().int().nullable() })) })), ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const cubo = cuboOr404(c.req.param("cubo") ?? "");
    const q = c.req.query();
    if (!q.dimension) throw new ErrorHttp(422, [{ type: "missing", loc: ["query", "dimension"], msg: "Field required", input: null }]);
    const dim = dimensionDe(cubo, q.dimension, "dimension");
    const limite = enteroOpcional(q.limite, "limite", 1, TOPE_MIEMBROS) ?? 1000;
    const filtros: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(q)) if (k.startsWith("f.")) { dimensionDe(cubo, k.slice(2), k); filtros[k.slice(2)] = v.split("|").map((s) => s.trim()).filter(Boolean); }
    const items = await miembros(c, cubo, dim, filtros, q.q?.trim() || null, limite + 1);
    const limitado = items.length > limite; if (limitado) items.length = limite;
    return { cubo: cubo.clave, dimension: dim.clave, n: items.length, limitado, items };
  }
}

export class CuboDatos extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "cubo_datos", summary: "Consultar un cubo (tabla agregada)",
    description: `La consulta del explorador: agrega las medidas por las columnas (dimensiones) pedidas, con filtros, orden y límite. ${COMO_CONSULTAR} Con \`padres=1\` cada columna trae antes sus niveles superiores en la jerarquía. Las dimensiones con nombre devuelven dos columnas (\`<dimensión>_id\` y \`<dimensión>\`); las geográficas con clave INEGI distinta del identificador agregan \`<dimensión>_cve\`. \`formato=csv\` descarga el archivo; \`jsonarrays\` devuelve las filas como arreglos en el orden de \`columnas\`.`,
    request: { params: z.object({ cubo: z.string() }), query: z.object({ medidas: z.string(), columnas: z.string().optional(), padres: z.string().optional(), orden: z.string().optional(), sentido: z.enum(["asc", "desc"]).optional(), limite: z.number().int().min(1).max(TOPE_FILAS).optional(), formato: z.enum(["jsonrecords", "jsonarrays", "csv"]).optional() }) },
    responses: { ...ok("Resultado.", z.object({ cubo: z.string(), consulta: z.object({ medidas: z.array(z.string()), columnas: z.array(z.string()), filtros: z.record(z.string(), z.array(z.string())), padres: z.boolean(), orden: z.string().nullable(), sentido: z.string(), limite: z.number().int() }), columnas: z.array(ColumnaZ), filas: z.array(z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())])), n: z.number().int(), limitado: z.boolean(), ms: z.number().int(), fuente: z.string(), csv_url: z.string() })), "200 (csv)": { description: "CSV con BOM (formato=csv).", content: { "text/csv": { schema: z.string() } } }, ...RESP_404, ...RESP_422, "504": { description: "La consulta excedió la capacidad de la base: reduzca columnas o agregue filtros.", ...contentJson(z.object({ detail: z.string() })) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const cubo = cuboOr404(c.req.param("cubo") ?? "");
    const raw = c.req.query();
    const q = leerConsulta(cubo, raw);
    const formato = raw.formato ?? "jsonrecords";
    if (!["jsonrecords", "jsonarrays", "csv"].includes(formato)) throw new ErrorHttp(422, [{ type: "literal_error", loc: ["query", "formato"], msg: "Input should be 'jsonrecords', 'jsonarrays' or 'csv'", input: formato }]);
    const r = await consultar(c, cubo, q);
    if (formato === "csv") {
      return new Response(aCsv(r.columnas, r.filas), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename=${cubo.clave}.csv`, "x-filas": String(r.n), "x-limitado": String(r.limitado) } });
    }
    const u = new URL(c.req.url); u.searchParams.set("formato", "csv"); u.searchParams.delete("limite");
    const filas = formato === "jsonarrays" ? r.filas.map((f) => r.columnas.map((col) => f[col.clave])) : r.filas;
    return { cubo: cubo.clave, consulta: { medidas: q.medidas, columnas: q.columnas, filtros: q.filtros, padres: q.padres, orden: q.orden, sentido: q.sentido, limite: r.limite }, columnas: r.columnas, filas, n: r.n, limitado: r.limitado, ms: r.ms, fuente: cubo.fuente, csv_url: u.pathname + u.search };
  }
}

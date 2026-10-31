// Pulso del Protocolo DPM: rutas bajo /dpm/v1 (PULSO.md). El sistema reporta hechos; el pulso juzga.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { ErrorHttp } from "../lib/errores";
import { RESP_401, RESP_403, SEGURIDAD, requiereAdmin } from "../lib/auth";
import { RESP_429 } from "../lib/comun";
import {
  CLASES, type Clase, EN_CLASE, ESTADOS, FUENTE_TIPOS, GRACIA_MS, MAX_ATRASO_MS, MAX_ATRASO_USUARIOS_DIAS, MAX_RESUMENES, MINUTO_MS, MODOS, PROTOCOLO_URL, PROTOCOLO_VERSION, SLUG, type Sistema, VIAS,
  e422, esFechaValida, fechaMx, iso, masFina, nuevaLlave, parseInstante, pisoMinuto, rangoUtcDeFechaMx, sha256hex, sistemaConLlave, sistemaPorId, slugRuta, sumarDias, validar,
} from "./comun";
import { cicloPulso, evaluarClases, evaluarEstados } from "./evaluacion";
import { svgInsignia, textoInsignia } from "./insignia";

const TAG = ["dpm"];
const Detalle = z.object({ detail: z.string() });
const RESP_422 = { "422": { description: "Validation Error", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };
const RESP_404 = { "404": { description: "Sistema o dato no registrado.", ...contentJson(Detalle) } };
const RESP_401_LLAVE = { "401": { description: "Llave de reporte ausente o que no corresponde al sistema.", ...contentJson(Detalle) } };
const LLAVE = [{ LlaveDPM: [] }];
const ok = (d: string, e: z.ZodTypeAny) => ({ "200": { description: d, ...contentJson(e) } });
const CAMPOS_SISTEMA = "sistema, nombre, operador, url, estado, adhesion_declarada, llave_hash, creado_en";

type DatoFila = { sistema: string; dato: string; nombre: string; fuente: string; reloj_fuente_ms: number | null; fuente_tipo: "calendario" | "evento"; latencia_fuente_ms: number | null; via: "consulta" | "entrega"; modo: "servido" | "custodiado"; ultima_verificacion: string | null; clase: Clase; clase_desde: string | null; w_ms: number | null; instante_evaluado: string | null; evaluado_en: string | null; declarado_en: string };
const DatoPublico = z.object({ sistema: z.string(), dato: z.string(), nombre: z.string(), fuente: z.string(), fuente_tipo: z.enum(FUENTE_TIPOS), via: z.enum(VIAS), modo: z.enum(MODOS), relojes: z.object({ fuente_ms: z.number().int().nullable().describe("Fuente por calendario: periodo de publicación. Fuente por evento: latencia de entrega declarada (el pulso la eleva si observa una mayor)."), refresco_peor_intervalo_ms: z.number().int().nullable().describe("Vía de consulta: peor intervalo entre consultas de la última ventana. Vía de entrega: peor latencia del evento a la persona."), verificacion: z.string().nullable() }), clase: z.enum(CLASES), clase_desde: z.string().nullable(), instante_evaluado: z.string().nullable(), evaluado_en: z.string().nullable(), declarado_en: z.string() });
const datoPublico = (d: DatoFila) => ({ sistema: d.sistema, dato: d.dato, nombre: d.nombre, fuente: d.fuente, fuente_tipo: d.fuente_tipo ?? "calendario", via: d.via ?? "consulta", modo: d.modo, relojes: { fuente_ms: (d.fuente_tipo ?? "calendario") === "evento" ? d.latencia_fuente_ms : d.reloj_fuente_ms, refresco_peor_intervalo_ms: d.w_ms, verificacion: d.ultima_verificacion }, clase: d.clase, clase_desde: d.clase_desde, instante_evaluado: d.instante_evaluado, evaluado_en: d.evaluado_en, declarado_en: d.declarado_en });
const SistemaPublico = z.object({ sistema: z.string(), nombre: z.string(), operador: z.string(), url: z.string().nullable(), estado: z.enum(ESTADOS), adhesion_declarada: z.string(), estado_desde: z.string().nullable(), datos: z.array(DatoPublico) });
/** §2 antes que nada: lee `sistema` del cuerpo, exige la llave y solo entonces se valida el resto del cuerpo. */
async function cuerpoConLlave(c: AppContext): Promise<unknown> {
  const cuerpo = await c.req.json().catch(() => ({}));
  const sistema = (cuerpo as { sistema?: unknown })?.sistema;
  if (typeof sistema !== "string" || !SLUG.test(sistema)) throw new ErrorHttp(401, "Falta el campo sistema o no es válido; la llave de reporte se verifica contra él", { "WWW-Authenticate": "Bearer" });
  await sistemaConLlave(c, sistema);
  return cuerpo;
}
async function datosDe(c: AppContext, sistema: string): Promise<DatoFila[]> { return filas<DatoFila>(c.env.DB_DPM, "SELECT * FROM datos WHERE sistema = ? ORDER BY dato", [sistema]); }
async function datoPorId(c: AppContext, sistema: string, dato: string): Promise<DatoFila> {
  const d = await fila<DatoFila>(c.env.DB_DPM, "SELECT * FROM datos WHERE sistema = ? AND dato = ?", [sistema, dato]);
  if (!d) throw new ErrorHttp(404, `el dato ${dato} no está declarado en el catálogo de ${sistema}`);
  return d;
}
async function estadoDesde(c: AppContext, sistema: string): Promise<string | null> {
  return (await fila<{ desde: string }>(c.env.DB_DPM, "SELECT desde FROM estados WHERE sistema = ? ORDER BY desde DESC LIMIT 1", [sistema]))?.desde ?? null;
}
const sistemaPublico = async (c: AppContext, s: Sistema) => ({ sistema: s.sistema, nombre: s.nombre, operador: s.operador, url: s.url, estado: s.estado, adhesion_declarada: s.adhesion_declarada, estado_desde: await estadoDesde(c, s.sistema), datos: (await datosDe(c, s.sistema)).map(datoPublico) });

/** ¿Tuvo el dato alguna clase DPM/DPS/DPMS en algún instante de [inicio, fin)? Se lee del historial de clases. */
async function enClaseDurante(c: AppContext, sistema: string, dato: string, inicio: string, fin: string): Promise<boolean> {
  const r = await fila<{ n: number }>(c.env.DB_DPM,
    `SELECT COUNT(*) AS n FROM clases k WHERE k.sistema = ? AND k.dato = ? AND k.clase IN ('DPM','DPS','DPMS') AND k.desde < ?
       AND COALESCE((SELECT MIN(k2.desde) FROM clases k2 WHERE k2.sistema = k.sistema AND k2.dato = k.dato AND k2.desde > k.desde), '9999-12-31T00:00:00.000Z') > ?`, [sistema, dato, fin, inicio]);
  return (r?.n ?? 0) > 0;
}

// ------------------------------------------------------------------ lecturas públicas (§9)

export class DpmEstado extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "dpm_estado", summary: "Estado del pulso: sistemas, clases vigentes, caudal y usuarios DPM diarios",
    description: "La única fuente autorizada de las cifras del Protocolo DPM. Sistemas adheridos con su estado, cada dato con su clase vigente (calculada por reloj al cierre de cada minuto, con cinco minutos de gracia), los dos caudales con su ventana (nunca sumados) y los usuarios DPM diarios del último día completo, sumados por sistema. Solo los sistemas con adhesión verificada aportan a las cifras.",
    responses: { ...ok("Estado del pulso.", z.object({ protocolo: z.object({ nombre: z.string(), version: z.string(), url: z.string() }), calculado_en: z.string(), instante_evaluado: z.string().nullable(), sistemas: z.array(SistemaPublico), caudal: z.object({ refresco: z.object({ observaciones_por_minuto: z.number().nullable(), observaciones: z.number().int(), ventana: z.string(), desde: z.string(), hasta: z.string() }), ingesta: z.object({ observaciones_por_minuto: z.number().nullable(), observaciones: z.number().int(), ventana: z.string(), desde: z.string(), hasta: z.string() }), nota: z.string() }), usuarios_dpm_diarios: z.object({ fecha: z.string(), total: z.number().int().nullable(), por_sistema: z.array(z.object({ sistema: z.string(), usuarios_distintos: z.number().int(), metodo: z.string(), cuenta: z.boolean(), motivo: z.string().nullable() })), leyenda: z.string() }), regla: z.string() })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const ahora = new Date();
    const sistemas = await filas<Sistema>(c.env.DB_DPM, `SELECT ${CAMPOS_SISTEMA} FROM sistemas ORDER BY adhesion_declarada, sistema`);
    const publicos = []; for (const s of sistemas) publicos.push(await sistemaPublico(c, s));
    const instante_evaluado = (await fila<{ t: string | null }>(c.env.DB_DPM, "SELECT MAX(instante_evaluado) AS t FROM datos"))?.t ?? null;
    // §8 caudal de refresco: observaciones custodiadas con verificación, de sistemas verificados, últimas 24 h, entre 1,440.
    const hace24h = iso(ahora.getTime() - 24 * 60 * MINUTO_MS), hace30d = iso(ahora.getTime() - 30 * 24 * 60 * MINUTO_MS);
    const refresco = (await fila<{ n: number | null }>(c.env.DB_DPM, "SELECT SUM(r.observaciones) AS n FROM resumenes r JOIN datos d ON d.sistema = r.sistema AND d.dato = r.dato JOIN sistemas s ON s.sistema = r.sistema WHERE s.estado = 'verificada' AND d.modo = 'custodiado' AND d.ultima_verificacion IS NOT NULL AND r.minuto >= ?", [hace24h]))?.n ?? 0;
    const ingesta = (await fila<{ n: number | null }>(c.env.DB_DPM, "SELECT SUM(i.observaciones) AS n FROM ingestas i JOIN sistemas s ON s.sistema = i.sistema WHERE s.estado = 'verificada' AND i.verificacion_metodo IS NOT NULL AND i.fin >= ?", [hace30d]))?.n ?? 0;
    const hayVerificados = sistemas.some((s) => s.estado === "verificada");
    const redondeo = (x: number) => Math.round(x * 100) / 100;
    // §8 usuarios DPM diarios del último día completo en America/Mexico_City.
    const fecha = sumarDias(fechaMx(ahora), -1); const { inicio, fin } = rangoUtcDeFechaMx(fecha);
    const reportes = await filas<{ sistema: string; usuarios_distintos: number; metodo: string; datos: string; estado: string }>(c.env.DB_DPM, "SELECT u.sistema, u.usuarios_distintos, u.metodo, u.datos, s.estado FROM usuarios_dia u JOIN sistemas s ON s.sistema = u.sistema WHERE u.fecha = ? ORDER BY u.sistema", [fecha]);
    const por_sistema = []; let total: number | null = hayVerificados ? 0 : null;
    for (const r of reportes) {
      let cuenta = false; let motivo: string | null = null;
      if (r.estado !== "verificada") motivo = "sistema sin adhesión verificada";
      else {
        const datos: string[] = JSON.parse(r.datos);
        for (const d of datos) if (await enClaseDurante(c, r.sistema, d, iso(inicio), iso(fin))) { cuenta = true; break; }
        if (!cuenta) motivo = "ninguno de los datos reportados tuvo clase ese día";
      }
      if (cuenta) total = (total ?? 0) + r.usuarios_distintos;
      por_sistema.push({ sistema: r.sistema, usuarios_distintos: r.usuarios_distintos, metodo: r.metodo, cuenta, motivo });
    }
    return {
      protocolo: { nombre: "Protocolo DPM · Datos Por Minuto", version: PROTOCOLO_VERSION, url: PROTOCOLO_URL },
      calculado_en: iso(ahora), instante_evaluado, sistemas: publicos,
      caudal: {
        refresco: { observaciones_por_minuto: hayVerificados ? redondeo(refresco / 1440) : null, observaciones: refresco, ventana: "últimas 24 horas", desde: hace24h, hasta: iso(ahora) },
        ingesta: { observaciones_por_minuto: hayVerificados ? redondeo(ingesta / (30 * 1440)) : null, observaciones: ingesta, ventana: "últimos 30 días", desde: hace30d, hasta: iso(ahora) },
        nota: "Dos renglones separados que nunca se suman. Solo observaciones custodiadas y verificadas de sistemas con adhesión verificada.",
      },
      usuarios_dpm_diarios: { fecha, total, por_sistema, leyenda: "Sumados por sistema: una persona que usa dos sistemas adheridos cuenta dos veces. Solo cuentan los sistemas verificados que tuvieron al menos un dato en clase ese día." },
      regla: "Ninguna cifra del Protocolo DPM se enuncia en público si no la produjo este pulso. Un valor null significa que aún no hay cifra que decir.",
    };
  }
}

export class DpmSistema extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "dpm_sistema", summary: "Un sistema adherido: ficha, estado e historial de estados", request: { params: z.object({ sistema: z.string() }) }, responses: { ...ok("Sistema.", SistemaPublico.extend({ historial_estados: z.array(z.object({ desde: z.string(), estado: z.enum(ESTADOS) })) })), ...RESP_404, ...RESP_422, ...RESP_429 } };
  async handle(c: AppContext) {
    const s = await sistemaPorId(c, slugRuta(c.req.param("sistema"), "sistema"));
    const historial_estados = await filas<{ desde: string; estado: "declarada" | "verificada" }>(c.env.DB_DPM, "SELECT desde, estado FROM estados WHERE sistema = ? ORDER BY desde", [s.sistema]);
    return { ...(await sistemaPublico(c, s)), historial_estados };
  }
}
export class DpmDato extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "dpm_dato", summary: "Un dato: catálogo vigente, clase vigente, peor intervalo y los tres relojes", request: { params: z.object({ sistema: z.string(), dato: z.string() }) }, responses: { ...ok("Dato.", DatoPublico), ...RESP_404, ...RESP_422, ...RESP_429 } };
  async handle(c: AppContext) { return datoPublico(await datoPorId(c, slugRuta(c.req.param("sistema"), "sistema"), slugRuta(c.req.param("dato"), "dato"))); }
}
export class DpmDatoHistorial extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "dpm_dato_historial", summary: "Historial de clases de un dato (no se edita) y versiones de su catálogo", request: { params: z.object({ sistema: z.string(), dato: z.string() }) }, responses: { ...ok("Historial.", z.object({ sistema: z.string(), dato: z.string(), clases: z.array(z.object({ desde: z.string(), clase: z.enum(CLASES), w_ms: z.number().int().nullable() })), catalogo: z.array(z.object({ desde: z.string(), nombre: z.string(), fuente: z.string(), reloj_fuente_ms: z.number().int().nullable(), fuente_tipo: z.enum(FUENTE_TIPOS), latencia_fuente_ms: z.number().int().nullable(), via: z.enum(VIAS), modo: z.enum(MODOS), ultima_verificacion: z.string().nullable(), nota: z.string().nullable() })) })), ...RESP_404, ...RESP_422, ...RESP_429 } };
  async handle(c: AppContext) {
    const d = await datoPorId(c, slugRuta(c.req.param("sistema"), "sistema"), slugRuta(c.req.param("dato"), "dato"));
    const clases = await filas<{ desde: string; clase: Clase; w_ms: number | null }>(c.env.DB_DPM, "SELECT desde, clase, w_ms FROM clases WHERE sistema = ? AND dato = ? ORDER BY desde", [d.sistema, d.dato]);
    const catalogo = await filas<{ desde: string; nombre: string; fuente: string; reloj_fuente_ms: number | null; fuente_tipo: "calendario" | "evento"; latencia_fuente_ms: number | null; via: "consulta" | "entrega"; modo: "servido" | "custodiado"; ultima_verificacion: string | null; nota: string | null }>(c.env.DB_DPM, "SELECT desde, nombre, fuente, reloj_fuente_ms, fuente_tipo, latencia_fuente_ms, via, modo, ultima_verificacion, nota FROM datos_historial WHERE sistema = ? AND dato = ? ORDER BY desde", [d.sistema, d.dato]);
    return { sistema: d.sistema, dato: d.dato, clases, catalogo };
  }
}
export class DpmUsuariosLectura extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "dpm_usuarios", summary: "Usuarios DPM diarios por fecha y por sistema",
    description: "Reportes de usuarios distintos por día (America/Mexico_City) con su método de conteo. `desde` y `hasta` en AAAA-MM-DD; por omisión, los últimos 30 días completos. La columna `cuenta` dice si ese reporte entra en la cifra pública (sistema verificado con al menos un dato en clase ese día).",
    request: { query: z.object({ desde: z.string().optional(), hasta: z.string().optional() }) },
    responses: { ...ok("Usuarios por día.", z.object({ desde: z.string(), hasta: z.string(), dias: z.array(z.object({ fecha: z.string(), total: z.number().int(), por_sistema: z.array(z.object({ sistema: z.string(), usuarios_distintos: z.number().int(), metodo: z.string(), cuenta: z.boolean() })) })), leyenda: z.string() })), ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const ayer = sumarDias(fechaMx(new Date()), -1);
    const hasta = c.req.query("hasta") ?? ayer, desde = c.req.query("desde") ?? sumarDias(hasta, -29);
    if (!esFechaValida(desde)) throw e422(["query", "desde"], "Fecha inválida (AAAA-MM-DD)", desde);
    if (!esFechaValida(hasta)) throw e422(["query", "hasta"], "Fecha inválida (AAAA-MM-DD)", hasta);
    if (desde > hasta) throw e422(["query", "desde"], "desde no puede ser posterior a hasta", desde);
    if (sumarDias(desde, 366) <= hasta) throw e422(["query", "hasta"], "El rango no puede exceder 366 días", hasta);
    const reportes = await filas<{ sistema: string; fecha: string; usuarios_distintos: number; metodo: string; datos: string; estado: string }>(c.env.DB_DPM, "SELECT u.sistema, u.fecha, u.usuarios_distintos, u.metodo, u.datos, s.estado FROM usuarios_dia u JOIN sistemas s ON s.sistema = u.sistema WHERE u.fecha >= ? AND u.fecha <= ? ORDER BY u.fecha, u.sistema", [desde, hasta]);
    const porFecha = new Map<string, { fecha: string; total: number; por_sistema: { sistema: string; usuarios_distintos: number; metodo: string; cuenta: boolean }[] }>();
    for (const r of reportes) {
      const dia = porFecha.get(r.fecha) ?? { fecha: r.fecha, total: 0, por_sistema: [] }; porFecha.set(r.fecha, dia);
      let cuenta = false;
      if (r.estado === "verificada") { const { inicio, fin } = rangoUtcDeFechaMx(r.fecha); for (const d of JSON.parse(r.datos) as string[]) if (await enClaseDurante(c, r.sistema, d, iso(inicio), iso(fin))) { cuenta = true; break; } }
      if (cuenta) dia.total += r.usuarios_distintos;
      dia.por_sistema.push({ sistema: r.sistema, usuarios_distintos: r.usuarios_distintos, metodo: r.metodo, cuenta });
    }
    return { desde, hasta, dias: [...porFecha.values()], leyenda: "Sumados por sistema: una persona que usa dos sistemas adheridos cuenta dos veces." };
  }
}
export class DpmInsignia extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "dpm_insignia", summary: "La insignia viva de un sistema (SVG)", description: "`/dpm/v1/insignia/{sistema}.svg`. Muestra el estado de adhesión y, si el sistema está verificado y tiene datos en clase, la clase más fina vigente. Cambia sola en el minuto siguiente a cada evaluación.", request: { params: z.object({ archivo: z.string().describe("<sistema>.svg") }) }, responses: { "200": { description: "SVG de la insignia.", content: { "image/svg+xml": { schema: z.string() } } }, ...RESP_404, ...RESP_422, ...RESP_429 } };
  async handle(c: AppContext) {
    const archivo = c.req.param("archivo") ?? "";
    if (!archivo.endsWith(".svg")) throw new ErrorHttp(404, "la insignia se sirve como <sistema>.svg");
    const s = await sistemaPorId(c, slugRuta(archivo.slice(0, -4), "sistema"));
    const clase = s.estado === "verificada" ? masFina((await datosDe(c, s.sistema)).map((d) => d.clase)) : null;
    return new Response(svgInsignia(textoInsignia(s.estado, clase), s.estado, clase), { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=60" } });
  }
}

// ------------------------------------------------------------------ reportes de los sistemas (§3-§6)

const Declaracion = z.object({ nombre: z.string().min(1).max(200), fuente: z.string().min(1).max(200), fuente_tipo: z.enum(FUENTE_TIPOS).default("calendario").optional(), reloj_fuente_ms: z.number().int().min(0).nullable().optional(), latencia_fuente_ms: z.number().int().min(0).nullable().optional(), via: z.enum(VIAS).default("consulta").optional(), modo: z.enum(MODOS), ultima_verificacion: z.string().nullable().optional() });
export class DpmDatoDeclarar extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "dpm_dato_declarar", summary: "Declarar o actualizar un dato en el catálogo (llave del sistema)", security: LLAVE,
    description: "§3. `fuente_tipo` `calendario` (por omisión): `reloj_fuente_ms` es la cota, el periodo con el que la fuente publica; `null` deja al dato fuera de clase. `fuente_tipo` `evento`: `latencia_fuente_ms` es la latencia de entrega declarada del evento al sistema, cota cuando la ventana no tiene eventos; el pulso la eleva si observa una mayor; `null` deja al dato fuera de clase. `via` `consulta` (por omisión) o `entrega` (protocolo 0.3 §6). `ultima_verificacion` es el reloj de la verificación; sin él, un dato custodiado no cuenta en el caudal. Cada versión queda en el historial del dato.",
    request: { params: z.object({ sistema: z.string(), dato: z.string() }), body: contentJson(Declaracion) },
    responses: { ...ok("Dato declarado.", DatoPublico), ...RESP_401_LLAVE, ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const sistema = slugRuta(c.req.param("sistema"), "sistema"), dato = slugRuta(c.req.param("dato"), "dato");
    await sistemaConLlave(c, sistema);
    const b = validar(Declaracion, await c.req.json().catch(() => ({})));
    const verificacion = b.ultima_verificacion == null ? null : iso(parseInstante(b.ultima_verificacion, ["body", "ultima_verificacion"]));
    const fuenteTipo = b.fuente_tipo ?? "calendario", via = b.via ?? "consulta";
    const reloj = fuenteTipo === "calendario" ? (b.reloj_fuente_ms ?? null) : null;
    const latencia = fuenteTipo === "evento" ? (b.latencia_fuente_ms ?? null) : null;
    const ahora = iso(new Date());
    await c.env.DB_DPM.batch([
      c.env.DB_DPM.prepare("INSERT INTO datos (sistema, dato, nombre, fuente, reloj_fuente_ms, fuente_tipo, latencia_fuente_ms, via, modo, ultima_verificacion, declarado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (sistema, dato) DO UPDATE SET nombre = excluded.nombre, fuente = excluded.fuente, reloj_fuente_ms = excluded.reloj_fuente_ms, fuente_tipo = excluded.fuente_tipo, latencia_fuente_ms = excluded.latencia_fuente_ms, via = excluded.via, modo = excluded.modo, ultima_verificacion = excluded.ultima_verificacion").bind(sistema, dato, b.nombre, b.fuente, reloj, fuenteTipo, latencia, via, b.modo, verificacion, ahora),
      c.env.DB_DPM.prepare("INSERT OR REPLACE INTO datos_historial (sistema, dato, desde, nombre, fuente, reloj_fuente_ms, fuente_tipo, latencia_fuente_ms, via, modo, ultima_verificacion, nota) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)").bind(sistema, dato, ahora, b.nombre, b.fuente, reloj, fuenteTipo, latencia, via, b.modo, verificacion),
    ]);
    return datoPublico(await datoPorId(c, sistema, dato));
  }
}

const ResumenEntrada = z.object({ dato: z.string().regex(SLUG), minuto: z.string(), refrescos: z.number().int().min(0), primero: z.string(), ultimo: z.string(), intervalo_max_ms: z.number().int().min(0), observaciones: z.number().int().min(0), eventos: z.number().int().min(0).optional(), latencia_fuente_max_ms: z.number().int().min(0).optional(), entregas: z.number().int().min(0).optional(), latencia_entrega_max_ms: z.number().int().min(0).optional() });
const LoteResumenes = z.object({ sistema: z.string().regex(SLUG), resumenes: z.array(ResumenEntrada).min(1).max(MAX_RESUMENES) });
export class DpmResumenes extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "dpm_resumenes", summary: "Reportar resúmenes por minuto (llave del sistema)", security: LLAVE,
    description: "§4. Por cada dato y minuto: refrescos ocurridos, instante del primero y del último, peor intervalo dentro del minuto y observaciones nuevas. Fuentes por evento: `eventos` y `latencia_fuente_max_ms` (obligatoria si hubo eventos). Vía de entrega: `entregas` y `latencia_entrega_max_ms` (obligatoria si hubo entregas); con entregas, `refrescos` puede ser 0 y entonces `primero` y `ultimo` son la primera y la última entrega. Un minuto sin refrescos ni entregas no se reporta. Hasta 1,000 resúmenes por envío. Un resumen es puntual si llega dentro de los cinco minutos posteriores al fin de su minuto; solo los puntuales cuentan para la clase. Se aceptan hasta 24 horas tarde para historial y caudal; después, 422. Reenviar la misma clave reemplaza el resumen sin recuperar la puntualidad perdida.",
    request: { body: contentJson(LoteResumenes) },
    responses: { ...ok("Resúmenes recibidos.", z.object({ sistema: z.string(), recibidos: z.number().int(), puntuales: z.number().int(), tardios: z.number().int(), recibido: z.string() })), ...RESP_401_LLAVE, ...RESP_404, ...RESP_422, "413": { description: "Más de 1,000 resúmenes en un envío.", ...contentJson(Detalle) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const cuerpo = await cuerpoConLlave(c);
    if (Array.isArray((cuerpo as { resumenes?: unknown })?.resumenes) && ((cuerpo as { resumenes: unknown[] }).resumenes.length > MAX_RESUMENES)) throw new ErrorHttp(413, `Máximo ${MAX_RESUMENES} resúmenes por envío`);
    const b = validar(LoteResumenes, cuerpo);
    const catalogo = new Map((await datosDe(c, b.sistema)).map((d) => [d.dato, d]));
    const ahora = new Date(); const ahoraIso = iso(ahora);
    const vistos = new Set<string>(); const sentencias: D1PreparedStatement[] = []; let puntuales = 0;
    b.resumenes.forEach((r, i) => {
      const loc = ["body", "resumenes", i];
      const def = catalogo.get(r.dato);
      if (!def) throw new ErrorHttp(404, `el dato ${r.dato} no está declarado en el catálogo de ${b.sistema}`);
      const eventos = r.eventos ?? 0, entregas = r.entregas ?? 0;
      if (eventos > 0 && r.latencia_fuente_max_ms === undefined) throw e422([...loc, "latencia_fuente_max_ms"], "con eventos > 0 se exige latencia_fuente_max_ms", null);
      if (entregas > 0 && r.latencia_entrega_max_ms === undefined) throw e422([...loc, "latencia_entrega_max_ms"], "con entregas > 0 se exige latencia_entrega_max_ms", null);
      if (r.refrescos === 0 && entregas === 0) throw e422([...loc, "refrescos"], "un resumen sin refrescos debe traer entregas > 0", r.refrescos);
      if (r.refrescos === 0 && (def.via ?? "consulta") !== "entrega") throw e422([...loc, "refrescos"], "refrescos = 0 solo se admite en un dato por vía de entrega", r.refrescos);
      const minuto = parseInstante(r.minuto, [...loc, "minuto"]);
      if (minuto.getTime() % MINUTO_MS !== 0) throw e422([...loc, "minuto"], "minuto debe estar truncado al minuto (segundos y milisegundos en cero)", r.minuto);
      const fin = minuto.getTime() + MINUTO_MS;
      if (minuto.getTime() > pisoMinuto(ahora).getTime()) throw e422([...loc, "minuto"], "minuto en el futuro", r.minuto);
      if (ahora.getTime() - fin > MAX_ATRASO_MS) throw e422([...loc, "minuto"], "resumen de hace más de 24 horas: ya no se acepta", r.minuto);
      const primero = parseInstante(r.primero, [...loc, "primero"]), ultimo = parseInstante(r.ultimo, [...loc, "ultimo"]);
      if (primero.getTime() < minuto.getTime() || primero.getTime() >= fin) throw e422([...loc, "primero"], "primero debe caer dentro de su minuto", r.primero);
      if (ultimo.getTime() < minuto.getTime() || ultimo.getTime() >= fin) throw e422([...loc, "ultimo"], "ultimo debe caer dentro de su minuto", r.ultimo);
      if (ultimo.getTime() < primero.getTime()) throw e422([...loc, "ultimo"], "ultimo no puede ser anterior a primero", r.ultimo);
      const lapso = ultimo.getTime() - primero.getTime();
      if (r.refrescos === 0) {
        if (r.intervalo_max_ms !== 0) throw e422([...loc, "intervalo_max_ms"], "sin refrescos, intervalo_max_ms debe ser 0", r.intervalo_max_ms);
      } else if (r.refrescos === 1) {
        if (lapso !== 0) throw e422([...loc, "ultimo"], "con un solo refresco, primero y ultimo deben ser iguales", r.ultimo);
        if (r.intervalo_max_ms !== 0) throw e422([...loc, "intervalo_max_ms"], "con un solo refresco, intervalo_max_ms debe ser 0", r.intervalo_max_ms);
      } else {
        if (r.intervalo_max_ms > lapso) throw e422([...loc, "intervalo_max_ms"], "intervalo_max_ms no puede exceder ultimo − primero", r.intervalo_max_ms);
        if (r.intervalo_max_ms * (r.refrescos - 1) < lapso) throw e422([...loc, "intervalo_max_ms"], "intervalo_max_ms no puede ser menor que el intervalo promedio (ultimo − primero) / (refrescos − 1)", r.intervalo_max_ms);
      }
      const clave = `${r.dato}|${minuto.getTime()}`;
      if (vistos.has(clave)) throw e422([...loc, "minuto"], "resumen repetido en el mismo envío", r.minuto);
      vistos.add(clave);
      const puntual = ahora.getTime() <= fin + GRACIA_MS ? 1 : 0; puntuales += puntual;
      // Un reemplazo nunca recupera puntualidad: puntual = MIN(previo, nuevo).
      sentencias.push(c.env.DB_DPM.prepare("INSERT INTO resumenes (sistema, dato, minuto, refrescos, primero, ultimo, intervalo_max_ms, observaciones, eventos, latencia_fuente_max_ms, entregas, latencia_entrega_max_ms, recibido, puntual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (sistema, dato, minuto) DO UPDATE SET refrescos = excluded.refrescos, primero = excluded.primero, ultimo = excluded.ultimo, intervalo_max_ms = excluded.intervalo_max_ms, observaciones = excluded.observaciones, eventos = excluded.eventos, latencia_fuente_max_ms = excluded.latencia_fuente_max_ms, entregas = excluded.entregas, latencia_entrega_max_ms = excluded.latencia_entrega_max_ms, recibido = excluded.recibido, puntual = MIN(resumenes.puntual, excluded.puntual)")
        .bind(b.sistema, r.dato, iso(minuto), r.refrescos, iso(primero), iso(ultimo), r.intervalo_max_ms, r.observaciones, r.eventos ?? null, r.latencia_fuente_max_ms ?? null, r.entregas ?? null, r.latencia_entrega_max_ms ?? null, ahoraIso, puntual));
    });
    await c.env.DB_DPM.batch(sentencias);
    return { sistema: b.sistema, recibidos: b.resumenes.length, puntuales, tardios: b.resumenes.length - puntuales, recibido: ahoraIso };
  }
}

const Ingesta = z.object({ sistema: z.string().regex(SLUG), dato: z.string().regex(SLUG), inicio: z.string(), fin: z.string(), observaciones: z.number().int().min(0), verificacion: z.object({ metodo: z.string().min(1).max(300), resultado: z.string().min(1).max(300) }).optional() });
export class DpmIngestas extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "dpm_ingestas", summary: "Reportar una ingesta de universo completo (llave del sistema)", security: LLAVE,
    description: "§5. Las cargas de universos no pasan por el resumen por minuto: alimentan el caudal de ingesta, separado del de refresco. Sin `verificacion` la ingesta se guarda pero no cuenta en el caudal. El dato debe ser custodiado.",
    request: { body: contentJson(Ingesta) },
    responses: { "201": { description: "Ingesta registrada.", ...contentJson(z.object({ sistema: z.string(), dato: z.string(), inicio: z.string(), fin: z.string(), observaciones: z.number().int(), cuenta_en_caudal: z.boolean(), recibido: z.string() })) }, ...RESP_401_LLAVE, ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const b = validar(Ingesta, await cuerpoConLlave(c));
    const d = await datoPorId(c, b.sistema, b.dato);
    if (d.modo !== "custodiado") throw e422(["body", "dato"], "solo un dato custodiado puede reportar ingestas", b.dato);
    const inicio = parseInstante(b.inicio, ["body", "inicio"]), fin = parseInstante(b.fin, ["body", "fin"]); const ahora = new Date();
    if (fin.getTime() < inicio.getTime()) throw e422(["body", "fin"], "fin no puede ser anterior a inicio", b.fin);
    if (fin.getTime() > ahora.getTime() + 5_000) throw e422(["body", "fin"], "fin en el futuro", b.fin);
    await c.env.DB_DPM.prepare("INSERT OR REPLACE INTO ingestas (sistema, dato, inicio, fin, observaciones, verificacion_metodo, verificacion_resultado, recibido) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(b.sistema, b.dato, iso(inicio), iso(fin), b.observaciones, b.verificacion?.metodo ?? null, b.verificacion?.resultado ?? null, iso(ahora)).run();
    return c.json({ sistema: b.sistema, dato: b.dato, inicio: iso(inicio), fin: iso(fin), observaciones: b.observaciones, cuenta_en_caudal: !!b.verificacion, recibido: iso(ahora) }, 201);
  }
}

const Usuarios = z.object({ sistema: z.string().regex(SLUG), fecha: z.string(), usuarios_distintos: z.number().int().min(0), metodo: z.string().min(1).max(200), datos: z.array(z.string().regex(SLUG)).min(1).max(100) });
export class DpmUsuariosReporte extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "dpm_usuarios_reporte", summary: "Reportar usuarios distintos de un día (llave del sistema)", security: LLAVE,
    description: "§6. Un conteo por sistema y día civil (America/Mexico_City): personas distintas que recibieron al menos un dato de los listados. Nunca identificadores. Un segundo reporte de la misma fecha la reemplaza si llega dentro de los siete días siguientes; después se rechaza. No se aceptan fechas futuras ni el día en curso.",
    request: { body: contentJson(Usuarios) },
    responses: { "201": { description: "Reporte registrado.", ...contentJson(z.object({ sistema: z.string(), fecha: z.string(), usuarios_distintos: z.number().int(), metodo: z.string(), datos: z.array(z.string()), recibido: z.string() })) }, ...RESP_401_LLAVE, ...RESP_404, ...RESP_422, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const b = validar(Usuarios, await cuerpoConLlave(c));
    if (!esFechaValida(b.fecha)) throw e422(["body", "fecha"], "Fecha inválida (AAAA-MM-DD)", b.fecha);
    const ahora = new Date(); const hoy = fechaMx(ahora);
    if (b.fecha >= hoy) throw e422(["body", "fecha"], "solo se reportan días completos: la fecha debe ser anterior al día en curso en America/Mexico_City", b.fecha);
    if (sumarDias(b.fecha, MAX_ATRASO_USUARIOS_DIAS) < hoy) throw e422(["body", "fecha"], `reporte de hace más de ${MAX_ATRASO_USUARIOS_DIAS} días: ya no se acepta`, b.fecha);
    const declarados = new Set((await datosDe(c, b.sistema)).map((d) => d.dato));
    for (const d of b.datos) if (!declarados.has(d)) throw new ErrorHttp(404, `el dato ${d} no está declarado en el catálogo de ${b.sistema}`);
    await c.env.DB_DPM.prepare("INSERT OR REPLACE INTO usuarios_dia (sistema, fecha, usuarios_distintos, metodo, datos, recibido) VALUES (?, ?, ?, ?, ?, ?)").bind(b.sistema, b.fecha, b.usuarios_distintos, b.metodo, JSON.stringify([...new Set(b.datos)]), iso(ahora)).run();
    return c.json({ sistema: b.sistema, fecha: b.fecha, usuarios_distintos: b.usuarios_distintos, metodo: b.metodo, datos: [...new Set(b.datos)], recibido: iso(ahora) }, 201);
  }
}

// ------------------------------------------------------------------ administración (JWT admin del observatorio)

const Alta = z.object({ sistema: z.string().regex(SLUG), nombre: z.string().min(1).max(200), operador: z.string().min(1).max(200), url: z.string().url().max(300).nullable().optional(), adhesion_declarada: z.string() });
const RespLlave = z.object({ sistema: z.string(), llave: z.string(), aviso: z.string() });
export class DpmSistemaAlta extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "dpm_sistema_alta", summary: "Registrar un sistema adherido y emitir su llave de reporte (admin)", security: SEGURIDAD, description: "Crea el sistema en estado declarada, con la fecha de adhesión de su ficha en el registro, y devuelve la llave de reporte una sola vez: el pulso guarda únicamente su hash.", request: { body: contentJson(Alta) }, responses: { "201": { description: "Sistema registrado; la llave solo se muestra aquí.", ...contentJson(RespLlave) }, ...RESP_401, ...RESP_403, ...RESP_422, "409": { description: "El sistema ya existe.", ...contentJson(Detalle) }, ...RESP_429 } };
  async handle(c: AppContext) {
    await requiereAdmin(c);
    const b = validar(Alta, await c.req.json().catch(() => ({})));
    if (!esFechaValida(b.adhesion_declarada)) throw e422(["body", "adhesion_declarada"], "Fecha inválida (AAAA-MM-DD)", b.adhesion_declarada);
    if (await fila(c.env.DB_DPM, "SELECT 1 FROM sistemas WHERE sistema = ?", [b.sistema])) throw new ErrorHttp(409, `el sistema ${b.sistema} ya existe; para una llave nueva usa /dpm/v1/sistemas/${b.sistema}/llave`);
    const llave = nuevaLlave(b.sistema); const ahora = iso(new Date());
    await c.env.DB_DPM.batch([
      c.env.DB_DPM.prepare("INSERT INTO sistemas (sistema, nombre, operador, url, estado, adhesion_declarada, llave_hash, creado_en) VALUES (?, ?, ?, ?, 'declarada', ?, ?, ?)").bind(b.sistema, b.nombre, b.operador, b.url ?? null, b.adhesion_declarada, await sha256hex(llave), ahora),
      c.env.DB_DPM.prepare("INSERT INTO estados (sistema, desde, estado) VALUES (?, ?, 'declarada')").bind(b.sistema, ahora),
    ]);
    return c.json({ sistema: b.sistema, llave, aviso: "Guárdala ahora: el pulso solo conserva su hash y no puede volver a mostrarla." }, 201);
  }
}
export class DpmSistemaLlave extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "dpm_sistema_llave", summary: "Emitir una llave de reporte nueva para un sistema (admin)", security: SEGURIDAD, description: "Invalida la llave anterior. Úsalo para un sistema sembrado sin llave o para rotarla.", request: { params: z.object({ sistema: z.string() }) }, responses: { "201": { description: "Llave nueva; solo se muestra aquí.", ...contentJson(RespLlave) }, ...RESP_401, ...RESP_403, ...RESP_404, ...RESP_422, ...RESP_429 } };
  async handle(c: AppContext) {
    await requiereAdmin(c);
    const s = await sistemaPorId(c, slugRuta(c.req.param("sistema"), "sistema"));
    const llave = nuevaLlave(s.sistema);
    await c.env.DB_DPM.prepare("UPDATE sistemas SET llave_hash = ? WHERE sistema = ?").bind(await sha256hex(llave), s.sistema).run();
    return c.json({ sistema: s.sistema, llave, aviso: "Guárdala ahora: el pulso solo conserva su hash y no puede volver a mostrarla." }, 201);
  }
}
export class DpmEvaluar extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "dpm_evaluar", summary: "Correr ahora la evaluación de clases y estados (admin)", security: SEGURIDAD, description: "La misma evaluación que corre el disparador programado cada minuto (clases al cierre de T = ahora − 5 min) y cada hora (estados). Sirve para operar y para verificar; no cambia las reglas.", responses: { ...ok("Resultado de la evaluación.", z.object({ clases: z.object({ instante_evaluado: z.string(), evaluados: z.number().int(), cambios: z.number().int() }), estados: z.object({ sistemas: z.number().int(), cambios: z.number().int() }) })), ...RESP_401, ...RESP_403, ...RESP_429 } };
  async handle(c: AppContext) {
    await requiereAdmin(c);
    const ahora = new Date();
    return { clases: await evaluarClases(c.env, ahora), estados: await evaluarEstados(c.env, ahora) };
  }
}
export { cicloPulso };

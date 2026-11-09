import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import { CLIMA_CADA_MIN, CLIMA_FUENTE, CLIMA_FUENTE_URL } from "./refresco";
import { ESTACIONES } from "./estaciones";
import { SINOPTICA_FUENTE, SINOPTICA_RELOJ_MS } from "./sinoptica";
import { AEROPUERTO_FUENTE } from "./aeropuerto";
import { cifrasEntrega } from "./envivo";
import { TESTIGO_MIN_COTEJOS, TESTIGO_TOLERANCIA_C, TESTIGO_TOLERANCIA_INICIAL_C } from "./verificacion";

const TAG = ["clima"];
const libre = z.record(z.string(), z.unknown());
const ok = (descripcion: string, esquema: z.ZodTypeAny) => ({ "200": { description: descripcion, ...contentJson(esquema) } });
const iso = (d: Date | number) => new Date(d).toISOString();
const DPM = (dato: string) => ({ sistema: "datos-mexico", dato, ficha: `https://api.datosmexico.org/dpm/v1/datos/datos-mexico/${dato}` });

/** Las reglas de la casa, en palabras: se publican con los datos para que cualquiera pueda rehacer la verificación. */
export const REGLAS = {
  fuentes: [
    { papel: "medicion", nombre: SINOPTICA_FUENTE, cada: "hora", nota: "Manda sobre todo lo demás. Observatorios con personal del SMN; el SMN publica cada hora unos 11 minutos después de la hora. Las estaciones automáticas de 10 minutos de CONAGUA no publican datos (730 de 730 en error al 9-nov-2026); una sonda diaria las vigila y, si vuelven, la medición migra." },
    { papel: "testigo", nombre: AEROPUERTO_FUENTE, cada: "hora (minuto 40) y especiales", nota: "Otra institución y otros instrumentos. Sirve para cotejar, nunca para sustituir." },
    { papel: "pronostico", nombre: `${CLIMA_FUENTE} (modelo numérico)`, cada: "15 minutos", nota: "No es medición. Se pide en el punto de cada observatorio y se compara contra la medición: error del modelo = modelo − medición, con el valor que el modelo daba para cada hora en la última consulta anterior a esa hora." },
  ],
  verificacion: [
    "Integridad: el archivo BUFR debe estar completo (BUFR…7777, longitud declarada), ser de la estación y la hora pedidas; se guarda con su huella SHA-256 y el mensaje original.",
    "Completitud: cada hora se dice cuántas de las 32 llegaron y cuáles faltan.",
    "Rangos: la temperatura debe caer entre el récord de mínima y el de máxima del propio observatorio para ese mes (Base de Datos Climatológica Nacional del SMN); el rocío no puede superar a la temperatura; la humedad debe concordar con temperatura y rocío (Magnus, ±8 puntos); presión al nivel del mar entre 870 y 1085 hPa; viento entre 0 y 75 m/s.",
    "Salto: respecto de la lectura anterior (hasta 3 h antes), la temperatura no puede cambiar más de 8 °C + 2 °C por hora transcurrida, ni la presión más de 6 hPa por hora. Tampoco se deja pasar sin marca una lectura con temperatura, rocío y humedad idénticos a los de la hora anterior (posible lectura repetida).",
    `Testigo: la diferencia con el aeropuerto, con el aeropuerto llevado a la altura del observatorio (6.5 °C por km), no puede apartarse más de ${TESTIGO_TOLERANCIA_C} °C de la diferencia típica de ese par (mediana de 30 días); con menos de ${TESTIGO_MIN_COTEJOS} cotejos la típica es 0 y la tolerancia ${TESTIGO_TOLERANCIA_INICIAL_C} °C. Solo hay testigo con un aeropuerto a 50 km o menos y 400 m o menos de desnivel.`,
    "Lo que no pasa se marca y se muestra marcado. Nunca se borra ni se rellena.",
  ],
  aviso_records: "Los récords provienen del SMN tal cual. Algunos son dudosos (por ejemplo, 45.5 °C en enero en Saltillo); un récord dudoso solo vuelve más permisivo el rango, nunca marca una lectura buena.",
  entrega: "La entrega en vivo mide otra cosa: de que una lectura queda guardada en el observatorio a que el navegador confirma que la recibió, en una página visible. No mide la antigüedad de la medición. Nunca se presentan juntas como «clima por segundo».",
};

export class ClimaEstaciones extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_estaciones", summary: "Las 32 capitales: observatorio oficial, aeropuerto testigo, récords y reglas de verificación",
    description: "Para cada capital, el observatorio sinóptico del SMN que la mide (número OMM, clave climatológica, coordenadas de OSCAR/Surface, distancia al centro urbano), su aeropuerto testigo (o por qué no tiene) y los récords mensuales con que se verifica cada lectura. Incluye las reglas de verificación en palabras. Generado con scripts/clima/generar_estaciones.py.",
    responses: { ...ok("Estaciones y reglas.", z.object({ reglas: libre, estaciones: z.array(libre) })), ...RESP_429 },
  };
  async handle() { return { reglas: REGLAS, estaciones: ESTACIONES }; }
}

type FilaMedicion = { clave: string; instante: string; wmo: string; temperatura_c: number | null; rocio_c: number | null; humedad_pct: number | null; presion_estacion_hpa: number | null; presion_mar_hpa: number | null; viento_dir_grados: number | null; viento_ms: number | null; viento_periodo_min: number | null; rafaga_ms: number | null; lluvia_1h_mm: number | null; lluvia_24h_mm: number | null; visibilidad_m: number | null; nubosidad_pct: number | null; publicado_en: string | null; llegado_en: string; fuente_url: string; sha256: string; marcas: string; testigo_icao: string | null; testigo_instante: string | null; testigo_dif_c: number | null; testigo_tipica_c: number | null };
const COLS_MED = "clave, instante, wmo, temperatura_c, rocio_c, humedad_pct, presion_estacion_hpa, presion_mar_hpa, viento_dir_grados, viento_ms, viento_periodo_min, rafaga_ms, lluvia_1h_mm, lluvia_24h_mm, visibilidad_m, nubosidad_pct, publicado_en, llegado_en, fuente_url, sha256, marcas, testigo_icao, testigo_instante, testigo_dif_c, testigo_tipica_c";
const medicionPublica = (m: FilaMedicion) => ({ ...m, marcas: JSON.parse(m.marcas) as { codigo: string; detalle: string }[] });

export class ClimaMedicion extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_medicion", summary: "Medición oficial vigente de las 32 capitales, con testigo, pronóstico, error del modelo y relojes",
    description: "Por capital: la última observación oficial del SMN (hora medida, hora en que el caché de la OMM la tuvo, hora en que llegó al observatorio, marcas de verificación y cotejo con el aeropuerto), el último METAR del aeropuerto testigo, el pronóstico de modelo vigente y el último error del modelo. Con el lote de la última hora (cuántas de 32 y cuáles faltan). Es el dato `datos-mexico/clima-estaciones` del Protocolo DPM: fuente cada hora, fuera de clase por la fuente.",
    responses: { ...ok("Medición vigente.", z.object({ relojes: libre, lote: libre.nullable(), dpm: z.array(libre), capitales: z.array(libre) })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const db = c.env.DB_PLATAFORMA;
    const med = await filas<FilaMedicion>(db, `SELECT ${COLS_MED.split(", ").map((k) => `m.${k}`).join(", ")} FROM clima_medicion m JOIN (SELECT clave, MAX(instante) AS i FROM clima_medicion GROUP BY clave) u ON u.clave = m.clave AND u.i = m.instante`);
    const aer = await filas<Record<string, unknown> & { icao: string }>(db, "SELECT a.icao, a.instante, a.tipo, a.temperatura_c, a.rocio_c, a.qnh_hpa, a.viento_dir_grados, a.viento_ms, a.rafaga_ms, a.crudo, a.recibido_noaa, a.llegado_en FROM clima_aeropuerto a JOIN (SELECT icao, MAX(instante) AS i FROM clima_aeropuerto GROUP BY icao) u ON u.icao = a.icao AND u.i = a.instante");
    const pro = await filas<Record<string, unknown> & { clave: string }>(db, "SELECT clave, temperatura_c, humedad_pct, viento_kmh, codigo_tiempo, tiempo_fuente, obtenido_en FROM clima_actual");
    const err = await filas<Record<string, unknown> & { clave: string }>(db, "SELECT e.* FROM clima_error_modelo e JOIN (SELECT clave, MAX(hora) AS h FROM clima_error_modelo GROUP BY clave) u ON u.clave = e.clave AND u.h = e.hora");
    const lote = await fila<{ hora: string; recibidas: number; marcadas: number; faltan: string; primera_llegada: string | null; ultima_llegada: string | null }>(db, "SELECT hora, recibidas, marcadas, faltan, primera_llegada, ultima_llegada FROM clima_lotes WHERE recibidas > 0 ORDER BY hora DESC LIMIT 1");
    const porClave = <T extends { clave: string }>(xs: T[]) => new Map(xs.map((x) => [x.clave, x]));
    const M = porClave(med), P = porClave(pro), E = porClave(err), A = new Map(aer.map((a) => [a.icao, a]));
    const ultimaMed = med.reduce<string | null>((a, m) => (!a || m.instante > a ? m.instante : a), null);
    return {
      relojes: { fuente_ms: SINOPTICA_RELOJ_MS, ultima_hora_medida: ultimaMed, consultado_en: iso(Date.now()) },
      lote: lote ? { ...lote, esperadas: ESTACIONES.length, faltan: JSON.parse(lote.faltan) as string[] } : null,
      dpm: [DPM("clima-estaciones"), DPM("clima-entrega"), DPM("clima-capitales")],
      capitales: ESTACIONES.map((e) => {
        const m = M.get(e.clave);
        return {
          clave: e.clave, estado: e.estado, capital: e.capital,
          estacion: { wmo: e.wmo, nombre: e.estacion, clicom: e.clicom, lat: e.lat, lon: e.lon, altitud_m: e.altitud_m, km_capital: e.km_capital },
          medicion: m ? medicionPublica(m) : null,
          aeropuerto: e.icao ? { icao: e.icao, nombre: e.aeropuerto, km: e.km_aeropuerto, desnivel_m: e.desnivel_aeropuerto_m, ultimo: A.get(e.icao) ?? null } : { sin_testigo: e.sin_testigo },
          pronostico: P.get(e.clave) ?? null,
          error_modelo: E.get(e.clave) ?? null,
        };
      }),
    };
  }
}

export class ClimaCapital extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_capital", summary: "Historia de una capital: medición oficial, modelo, error del modelo y aeropuerto",
    description: "Hasta 30 días (`dias`, por omisión 30) de observaciones horarias del SMN con sus marcas, el valor del modelo para cada hora y su error, el METAR del aeropuerto testigo y el resumen del error del modelo (n, error absoluto medio, sesgo).",
    request: { params: z.object({ clave: z.string().regex(/^\d{2}$/) }), query: z.object({ dias: z.coerce.number().int().min(1).max(30).optional() }) },
    responses: { ...ok("Historia.", libre), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const d = await this.getValidatedData<typeof this.schema>();
    const e = ESTACIONES.find((x) => x.clave === d.params.clave);
    if (!e) throw new ErrorHttp(404, `No hay capital con clave ${d.params.clave}`);
    const desde = iso(Date.now() - (d.query.dias ?? 30) * 86400_000);
    const db = c.env.DB_PLATAFORMA;
    const med = (await filas<FilaMedicion>(db, `SELECT ${COLS_MED} FROM clima_medicion WHERE clave = ? AND instante >= ? ORDER BY instante`, [e.clave, desde])).map(medicionPublica);
    const err = await filas<Record<string, unknown>>(db, "SELECT hora, temperatura_medida_c, temperatura_modelo_c, error_temperatura_c, humedad_medida_pct, humedad_modelo_pct, error_humedad_pct, viento_medido_ms, viento_modelo_ms, error_viento_ms FROM clima_error_modelo WHERE clave = ? AND hora >= ? ORDER BY hora", [e.clave, desde]);
    const aer = e.icao ? await filas<Record<string, unknown>>(db, "SELECT instante, tipo, temperatura_c, rocio_c, qnh_hpa, viento_ms, crudo FROM clima_aeropuerto WHERE icao = ? AND instante >= ? ORDER BY instante", [e.icao, desde]) : [];
    const res = await fila<{ n: number; mae: number | null; sesgo: number | null }>(db, "SELECT COUNT(error_temperatura_c) AS n, AVG(ABS(error_temperatura_c)) AS mae, AVG(error_temperatura_c) AS sesgo FROM clima_error_modelo WHERE clave = ? AND hora >= ?", [e.clave, desde]);
    return { capital: { clave: e.clave, estado: e.estado, capital: e.capital }, estacion: e, desde, medicion: med, error_modelo: err, aeropuerto: aer, resumen_error_temperatura: { n: res?.n ?? 0, error_absoluto_medio_c: res?.mae === null || res?.mae === undefined ? null : Math.round(res.mae * 100) / 100, sesgo_c: res?.sesgo === null || res?.sesgo === undefined ? null : Math.round(res.sesgo * 100) / 100 } };
  }
}

export class ClimaErrorModelo extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_error_modelo", summary: "Error del modelo: por capital, por hora del día y por mes",
    description: "Indicador propio del observatorio. Error = modelo − medición oficial del SMN, en temperatura (°C), humedad (puntos) y viento (m/s). Por capital en los últimos `dias` (por omisión 30), por hora local del día (UTC−6) y por mes, con n, error absoluto medio y sesgo. El modelo es Open-Meteo en el punto del observatorio, con el valor que daba para cada hora en la última consulta anterior a esa hora.",
    request: { query: z.object({ dias: z.coerce.number().int().min(1).max(365).optional() }) },
    responses: { ...ok("Error del modelo.", libre), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const d = await this.getValidatedData<typeof this.schema>();
    const desde = iso(Date.now() - (d.query.dias ?? 30) * 86400_000);
    const db = c.env.DB_PLATAFORMA;
    const AGG = "COUNT(error_temperatura_c) AS n, ROUND(AVG(ABS(error_temperatura_c)), 2) AS mae_temperatura_c, ROUND(AVG(error_temperatura_c), 2) AS sesgo_temperatura_c, ROUND(AVG(ABS(error_humedad_pct)), 1) AS mae_humedad_pts, ROUND(AVG(ABS(error_viento_ms)), 2) AS mae_viento_ms";
    const porCapital = await filas<Record<string, unknown> & { clave: string }>(db, `SELECT clave, ${AGG} FROM clima_error_modelo WHERE hora >= ? GROUP BY clave`, [desde]);
    const porHora = await filas(db, `SELECT CAST(strftime('%H', datetime(hora, '-6 hours')) AS INTEGER) AS hora_local, ${AGG} FROM clima_error_modelo WHERE hora >= ? GROUP BY hora_local ORDER BY hora_local`, [desde]);
    const porMes = await filas(db, `SELECT strftime('%Y-%m', datetime(hora, '-6 hours')) AS mes, ${AGG} FROM clima_error_modelo GROUP BY mes ORDER BY mes`);
    const nombres = new Map(ESTACIONES.map((e) => [e.clave, e.capital]));
    return { desde, definicion: REGLAS.fuentes[2].nota, por_capital: porCapital.map((r) => ({ ...r, capital: nombres.get(r.clave) })), por_hora_local: porHora, por_mes: porMes };
  }
}

export class ClimaLotes extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_lotes", summary: "Completitud hora por hora: cuántas de las 32 llegaron y cuáles faltan",
    request: { query: z.object({ horas: z.coerce.number().int().min(1).max(720).optional() }) },
    responses: { ...ok("Lotes.", z.object({ esperadas: z.number().int(), lotes: z.array(libre) })), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const d = await this.getValidatedData<typeof this.schema>();
    const lotes = await filas<{ faltan: string }>(c.env.DB_PLATAFORMA, "SELECT hora, recibidas, marcadas, faltan, primera_llegada, ultima_llegada, consultas FROM clima_lotes WHERE hora >= ? ORDER BY hora DESC", [iso(Date.now() - (d.query.horas ?? 48) * 3600_000)]);
    return { esperadas: ESTACIONES.length, lotes: lotes.map((l) => ({ ...l, faltan: JSON.parse(l.faltan) })) };
  }
}

export class ClimaMensajeOriginal extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_mensaje_original", summary: "El mensaje BUFR original de una observación, para auditarla",
    description: "Devuelve el archivo tal como se leyó del caché de la OMM (base64), su dirección y su huella SHA-256. Cualquiera puede decodificarlo con ecCodes y comparar.",
    request: { params: z.object({ clave: z.string().regex(/^\d{2}$/) }), query: z.object({ instante: z.string() }) },
    responses: { ...ok("Mensaje original.", libre), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const d = await this.getValidatedData<typeof this.schema>();
    const t = Date.parse(d.query.instante);
    if (!Number.isFinite(t)) throw new ErrorHttp(422, "instante debe ser una fecha ISO");
    const m = await fila(c.env.DB_PLATAFORMA, "SELECT clave, instante, wmo, fuente_url, sha256, bufr_b64, llegado_en FROM clima_medicion WHERE clave = ? AND instante = ?", [d.params.clave, iso(t)]);
    if (!m) throw new ErrorHttp(404, "No hay observación con esa clave e instante");
    return m;
  }
}

export class ClimaSondaEmas extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "clima_sonda_emas", summary: "Sonda diaria del portal de estaciones automáticas de CONAGUA", responses: { ...ok("Últimos 60 días.", z.object({ dias: z.array(libre) })), ...RESP_429 } };
  async handle(c: AppContext) { return { dias: await filas(c.env.DB_PLATAFORMA, "SELECT fecha, estaciones, con_datos, detalle, consultado_en FROM clima_sonda_emas ORDER BY fecha DESC LIMIT 60") }; }
}

export class ClimaEntrega extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_entrega", summary: "Entrega en vivo: conexiones abiertas y latencias medidas",
    description: "El dato `datos-mexico/clima-entrega` del Protocolo DPM. Latencia de cada entrega = de que la lectura quedó guardada en el observatorio a que el navegador (página visible) confirmó recibirla, medida con relojes del servidor. No es la antigüedad de la medición. Conexión: WebSocket en wss://api.datosmexico.org/api/v1/clima/en-vivo.",
    responses: { ...ok("Cifras de la entrega.", libre), ...RESP_429 },
  };
  async handle(c: AppContext) { return { ...(await cifrasEntrega(c.env)), dpm: DPM("clima-entrega"), aviso: REGLAS.entrega }; }
}

/** Dirección pública de comprobación del dato datos-mexico/clima-estaciones (protocolo 0.4 §8 bis). */
export class ClimaComprobacionEstaciones extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "clima_comprobacion_estaciones", summary: "Comprobación de cara pública de la medición oficial para el pulso DPM", responses: { ...ok("Último refresco y refrescos de la última hora.", z.object({ ultimo_refresco: z.string().nullable(), refrescos_ultima_hora: z.number().int() })), ...RESP_429 } };
  async handle(c: AppContext) {
    const u = (await fila<{ t: string | null }>(c.env.DB_PLATAFORMA, "SELECT MAX(instante) AS t FROM clima_consultas WHERE fuente = 'sinoptica' AND pedidos > 0"))?.t ?? null;
    const n = (await fila<{ n: number }>(c.env.DB_PLATAFORMA, "SELECT COUNT(*) AS n FROM clima_consultas WHERE fuente = 'sinoptica' AND pedidos > 0 AND instante >= ?", [iso(Date.now() - 3600_000)]))?.n ?? 0;
    return { ultimo_refresco: u, refrescos_ultima_hora: n };
  }
}
/** Dirección pública de comprobación del dato datos-mexico/clima-entrega: última entrega y entregas de la última hora. */
export class ClimaComprobacionEntrega extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "clima_comprobacion_entrega", summary: "Comprobación de cara pública de la entrega en vivo para el pulso DPM", responses: { ...ok("Última entrega y entregas de la última hora.", z.object({ ultimo_refresco: z.string().nullable(), refrescos_ultima_hora: z.number().int() })), ...RESP_429 } };
  async handle(c: AppContext) { const x = await cifrasEntrega(c.env); return { ultimo_refresco: x.ultimo_refresco, refrescos_ultima_hora: x.refrescos_ultima_hora }; }
}

type Fila = { clave: string; estado: string; capital: string; lat: number; lon: number; temperatura_c: number | null; humedad_pct: number | null; viento_kmh: number | null; codigo_tiempo: number | null; tiempo_fuente: string; intervalo_fuente_s: number | null; obtenido_en: string; verificado_en: string | null };
const Capital = z.object({ clave: z.string(), estado: z.string(), capital: z.string(), lat: z.number(), lon: z.number(), temperatura_c: z.number().nullable(), humedad_pct: z.number().nullable(), viento_kmh: z.number().nullable(), codigo_tiempo: z.number().int().nullable(), tiempo_fuente: z.string(), verificado_en: z.string().nullable() });

export class ClimaActual extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_actual", summary: "Pronóstico de modelo para las 32 capitales (no es medición)",
    description: "Temperatura, humedad, viento y código de tiempo que da un MODELO numérico para el punto de cada observatorio oficial, con el instante de su intervalo. Fuente: Open-Meteo, que publica cada 15 minutos; el observatorio lo refresca cada 5 minutos en un solo pedido y verifica cada respuesta (32 de 32, intervalo reciente, coordenadas que coinciden). Desde noviembre de 2026 la medición es la del SMN (`/api/v1/clima/medicion`); esto es el pronóstico contra el que se calcula el error del modelo. Es el dato `datos-mexico/clima-capitales` del Protocolo DPM: con una fuente de 15 minutos queda fuera de clase, y así se publica.",
    responses: { "200": { description: "Pronóstico de modelo.", ...contentJson(z.object({ fuente: z.string(), fuente_url: z.string(), es: z.string(), relojes: z.object({ fuente_ms: z.number().int(), refresco_ms: z.number().int(), ultimo_refresco: z.string().nullable(), ultima_verificacion: z.string().nullable() }), dpm: z.object({ sistema: z.string(), dato: z.string(), ficha: z.string() }), capitales: z.array(Capital) })) }, ...RESP_429 },
  };
  async handle(c: AppContext) {
    const capitales = await filas<Fila>(c.env.DB_PLATAFORMA, "SELECT * FROM clima_actual ORDER BY estado");
    const ultimo = (await fila<{ t: string | null }>(c.env.DB_PLATAFORMA, "SELECT MAX(obtenido_en) AS t FROM clima_actual"))?.t ?? null;
    const verif = (await fila<{ t: string | null }>(c.env.DB_PLATAFORMA, "SELECT MAX(verificado_en) AS t FROM clima_actual"))?.t ?? null;
    return {
      fuente: CLIMA_FUENTE, fuente_url: CLIMA_FUENTE_URL, es: "pronóstico de modelo, no medición",
      relojes: { fuente_ms: 900_000, refresco_ms: CLIMA_CADA_MIN * 60_000, ultimo_refresco: ultimo, ultima_verificacion: verif },
      dpm: DPM("clima-capitales"),
      capitales: capitales.map(({ lat, lon, intervalo_fuente_s: _i, obtenido_en: _o, ...r }) => ({ ...r, lat, lon })),
    };
  }
}

/** Dirección pública de comprobación del dato datos-mexico/clima-capitales (protocolo 0.4 §8 bis). */
export class ClimaComprobacion extends OpenAPIRoute {
  schema = { tags: TAG, operationId: "clima_comprobacion", summary: "Comprobación de cara pública del pronóstico de modelo para el pulso DPM", description: "Responde cuándo fue el último refresco del pronóstico y cuántos hubo en la última hora, leído de la bitácora de refrescos. Es la dirección que el pulso consulta por su cuenta cada diez minutos para cotejar lo reportado.", responses: { ...{ "200": { description: "Último refresco y refrescos de la última hora.", ...contentJson(z.object({ ultimo_refresco: z.string().nullable(), refrescos_ultima_hora: z.number().int() })) } }, ...RESP_429 } };
  async handle(c: AppContext) {
    const hace1h = new Date(Date.now() - 60 * 60_000).toISOString();
    const u = (await fila<{ t: string | null }>(c.env.DB_PLATAFORMA, "SELECT MAX(obtenido_en) AS t FROM clima_refrescos"))?.t ?? null;
    const n = (await fila<{ n: number }>(c.env.DB_PLATAFORMA, "SELECT COUNT(*) AS n FROM clima_refrescos WHERE obtenido_en >= ?", [hace1h]))?.n ?? 0;
    return { ultimo_refresco: u, refrescos_ultima_hora: n };
  }
}

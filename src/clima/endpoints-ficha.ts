// Endpoints de la ficha de cada capital y de las piezas que la componen. Cada pieza conserva su fuente y su papel: medición
// oficial (SMN), pronóstico oficial (SMN), modelo (Open-Meteo), lo normal (SMN), el Sol (calculado aquí) y la constancia del
// observatorio (cuenta propia sobre lo custodiado). Nada se mezcla en una sola cifra.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { ErrorHttp } from "../lib/errores";
import { ESTACIONES } from "./estaciones";
import { CAPITALES } from "./capitales";
import { hoyFrenteANormal, normalDe, fechaLocal, ZONA } from "./normales";
import { constancia, CONSTANCIA_REGLA } from "./constancia";
import { pronosticoSmnDe, SMN_PRONOSTICO_FUENTE } from "./pronostico-smn";
import { modeloFichaDe, MODELO_FICHA_TOPE_DIA } from "./modelo-ficha";
import { solDelDia, alturaSol } from "./sol";
import { avisosVigentes } from "./avisos";
import { minutosEntrega } from "./envivo";
import { aireDe } from "./aire";

const TAG = ["clima"];
const libre = z.record(z.string(), z.unknown());
const ok = (descripcion: string, esquema: z.ZodTypeAny) => ({ "200": { description: descripcion, ...contentJson(esquema) } });
const iso = (d: Date | number) => new Date(d).toISOString();
const clave = z.object({ clave: z.string().regex(/^\d{2}$/) });
const estacion = (k: string) => { const e = ESTACIONES.find((x) => x.clave === k); if (!e) throw new ErrorHttp(404, `No hay capital con clave ${k}`); return e; };

/** Regla de publicación del acierto del pronóstico: 30 días completos de comparación, ni uno menos. */
export const DIAS_PARA_PUBLICAR = 30;
async function cobertura(db: D1Database, tabla: "clima_error_modelo", ahora: number) {
  const p = await fila<{ h: string | null }>(db, `SELECT MIN(hora) AS h FROM ${tabla}`);
  if (!p?.h) return { primera_hora: null, dias_cubiertos: 0, dias_para_publicar: DIAS_PARA_PUBLICAR, completo: false, completo_desde: null };
  const t0 = Date.parse(p.h);
  const dias = Math.floor((ahora - t0) / 86400_000);
  return { primera_hora: p.h, dias_cubiertos: dias, dias_para_publicar: DIAS_PARA_PUBLICAR, completo: dias >= DIAS_PARA_PUBLICAR, completo_desde: iso(t0 + DIAS_PARA_PUBLICAR * 86400_000) };
}

/** Punto en polígono (anillo GeoJSON [lon, lat]), por cruce de rayos. */
function dentro(lon: number, lat: number, anillo: [number, number][]): boolean {
  let s = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) s = !s;
  }
  return s;
}

export class ClimaCiudad extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_ciudad", summary: "Ficha de una capital: medición, hoy frente a lo normal, pronóstico oficial y de modelo, Sol, aire, avisos y constancia",
    description: "Todo lo de una capital en un pedido, cada pieza con su fuente y su papel: la medición oficial vigente del SMN; la máxima y la mínima de hoy (termómetros del observatorio) frente a lo normal (normal oficial del mes y lugar del día en el registro diario del SMN); el pronóstico oficial del SMN por municipio (horas y 4 días); el pronóstico de modelo a 10 días con índice UV (Open-Meteo); amanecer y atardecer calculados; calidad del aire; avisos del SMN vigentes que cubren la capital; la constancia de su observatorio en 7 días y el error del modelo en 30 días con su regla de publicación.",
    request: { params: clave },
    responses: { ...ok("Ficha.", libre), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const d = await this.getValidatedData<typeof this.schema>();
    const e = estacion(d.params.clave);
    const cap = CAPITALES.find((x) => x.clave === e.clave)!;
    const db = c.env.DB_PLATAFORMA;
    const ahora = Date.now();
    const hoy = fechaLocal(e.clave, ahora), manana = fechaLocal(e.clave, ahora + 86400_000);
    const [med, hoyN, ayerN, smn, modelo, avisos, cons, err, cob, aire] = await Promise.all([
      fila<Record<string, unknown> & { marcas: string }>(db, "SELECT instante, temperatura_c, rocio_c, humedad_pct, presion_mar_hpa, viento_dir_grados, viento_ms, rafaga_ms, lluvia_1h_mm, lluvia_24h_mm, visibilidad_m, nubosidad_pct, publicado_en, llegado_en, marcas FROM clima_medicion WHERE clave = ? ORDER BY instante DESC LIMIT 1", [e.clave]),
      hoyFrenteANormal(db, e.clave, ahora),
      hoyFrenteANormal(db, e.clave, ahora - 86400_000),
      pronosticoSmnDe(db, e.clave, ahora),
      modeloFichaDe(c.env, e.clave, ahora),
      avisosVigentes(c.env, ahora).catch(() => []),
      constancia(db, ahora, 7),
      fila<{ n: number; mae: number | null; sesgo: number | null }>(db, "SELECT COUNT(error_temperatura_c) AS n, ROUND(AVG(ABS(error_temperatura_c)), 2) AS mae, ROUND(AVG(error_temperatura_c), 2) AS sesgo FROM clima_error_modelo WHERE clave = ? AND hora >= ?", [e.clave, iso(ahora - 30 * 86400_000)]),
      cobertura(db, "clima_error_modelo", ahora),
      aireDe(c.env, e.clave, ahora).catch((x) => ({ estado: `error: ${String(x).slice(0, 100)}` })),
    ]);
    if (modelo.renovar) c.executionCtx.waitUntil(modelo.renovar);
    const mia = cons.capitales.find((x) => x.clave === e.clave);
    return {
      capital: { clave: e.clave, estado: e.estado, capital: e.capital, lat: cap.lat, lon: cap.lon, zona: ZONA[e.clave] },
      estacion: { wmo: e.wmo, nombre: e.estacion, clicom: e.clicom, lat: e.lat, lon: e.lon, altitud_m: e.altitud_m, km_capital: e.km_capital },
      generado_en: iso(ahora),
      medicion: med ? { ...med, marcas: JSON.parse(med.marcas) } : null,
      hoy: hoyN,
      ayer: { fecha: ayerN.fecha, maxima: ayerN.maxima, minima: ayerN.minima, normal_mes: ayerN.normal?.oficial ? { periodo: ayerN.normal.oficial.periodo, tmax_c: ayerN.normal.oficial.tmax_c, tmin_c: ayerN.normal.oficial.tmin_c } : null },
      pronostico_smn: smn,
      modelo: modelo.datos ? { ...modelo.datos, estado: modelo.estado, tope_llamadas_dia: MODELO_FICHA_TOPE_DIA } : { estado: modelo.estado },
      sol: { hoy: { fecha: hoy, ...solDelDia(hoy, cap.lat, cap.lon) }, manana: { fecha: manana, ...solDelDia(manana, cap.lat, cap.lon) }, altura_ahora_grados: alturaSol(ahora, cap.lat, cap.lon), metodo: "Calculado por Datos México (algoritmo de la NOAA, Meeus); refracción estándar." },
      aire,
      avisos: avisos.filter((a) => a.poligonos.some((p) => dentro(cap.lon, cap.lat, p))).map(({ poligonos: _p, ...a }) => ({ ...a, original: `https://api.datosmexico.org/api/v1/clima/avisos/${a.sha256}` })),
      constancia_7d: mia ? { ...mia, regla: CONSTANCIA_REGLA } : null,
      error_modelo_30d: { n: err?.n ?? 0, error_absoluto_medio_c: err?.mae ?? null, sesgo_c: err?.sesgo ?? null, cobertura: cob, publicable: cob.completo },
    };
  }
}

export class ClimaNormales extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_normales", summary: "Lo normal de una capital: normal oficial del mes y distribución del día en el registro del SMN",
    description: "Normal climatológica oficial del observatorio (SMN; 1991-2020 o, si el SMN no la publica, 1981-2010, o ninguna, dicho así) y distribución de la máxima y la mínima diarias del registro diario del mismo observatorio en una ventana de 15 días centrada en la fecha (`fecha` = MM-DD; por omisión, hoy en la capital). Percentiles 0, 5, …, 100. Generado con scripts/clima/generar_normales.py, con huella SHA-256 de cada archivo fuente.",
    request: { params: clave, query: z.object({ fecha: z.string().regex(/^\d{2}-\d{2}$/).optional() }) },
    responses: { ...ok("Lo normal.", libre), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const d = await this.getValidatedData<typeof this.schema>();
    const e = estacion(d.params.clave);
    const f = d.query.fecha ? `2000-${d.query.fecha}` : fechaLocal(e.clave, Date.now());
    const n = await normalDe(c.env.DB_PLATAFORMA, e.clave, f);
    if (!n) throw new ErrorHttp(503, "La base de lo normal aún no está cargada");
    return { capital: { clave: e.clave, capital: e.capital }, estacion: { wmo: e.wmo, clicom: e.clicom, nombre: e.estacion }, fecha: f.slice(5), ...n };
  }
}

export class ClimaNormalHoy extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_normal_hoy", summary: "Las 32 capitales hoy frente a lo normal",
    description: "Para cada capital, la máxima y la mínima de hoy (termómetros del observatorio del SMN; «hasta ahora» mientras no llega el mensaje de las 00 UTC) frente a la normal oficial del mes y su percentil en el registro diario del observatorio.",
    responses: { ...ok("Hoy frente a lo normal.", libre), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const ahora = Date.now();
    const xs = await Promise.all(ESTACIONES.map(async (e) => {
      const h = await hoyFrenteANormal(c.env.DB_PLATAFORMA, e.clave, ahora);
      return { clave: e.clave, capital: e.capital, fecha: h.fecha, maxima: h.maxima, minima: h.minima, normal_mes: h.normal?.oficial ? { periodo: h.normal.oficial.periodo, tmax_c: h.normal.oficial.tmax_c, tmin_c: h.normal.oficial.tmin_c } : null, nivel: h.normal?.dia?.nivel ?? null };
    }));
    return { generado_en: iso(ahora), capitales: xs };
  }
}

export class ClimaConstancia extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_constancia", summary: "Constancia de los 32 observatorios del SMN: cuántas horas llegaron, cuáles faltan y a qué horas",
    description: "Por observatorio, en los últimos `dias` (1 a 30, por omisión 7): horas vigiladas, lecturas que llegaron, marcadas y faltantes, racha actual y peor racha sin lectura, faltas por bloque de 6 horas locales, retraso mediano de publicación del SMN y una franja de una letra por hora. Ordenado de menos a más constante.",
    request: { query: z.object({ dias: z.coerce.number().int().min(1).max(30).optional() }) },
    responses: { ...ok("Constancia.", libre), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const d = await this.getValidatedData<typeof this.schema>();
    return constancia(c.env.DB_PLATAFORMA, Date.now(), d.query.dias ?? 7);
  }
}

export class ClimaPronosticoSmn extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_pronostico_smn", summary: "Pronóstico oficial del SMN para una capital (horas y 4 días)",
    description: `${SMN_PRONOSTICO_FUENTE}: la emisión vigente para el municipio de la capital. Se guardan todas las emisiones para medir su acierto.`,
    request: { params: clave },
    responses: { ...ok("Pronóstico oficial.", libre), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const d = await this.getValidatedData<typeof this.schema>();
    const e = estacion(d.params.clave);
    return { capital: { clave: e.clave, capital: e.capital }, ...(await pronosticoSmnDe(c.env.DB_PLATAFORMA, e.clave, Date.now())) };
  }
}

export class ClimaErrorSmn extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_error_smn", summary: "Qué tanto acierta el pronóstico oficial del SMN, por anticipación",
    description: "Error = pronóstico del SMN − medición oficial del SMN, en temperatura (°C), por capital y por anticipación (horas entre la emisión del pronóstico y la hora pronosticada: 0–24, 24–48, 48–72, 72–120). Cada emisión cuenta por separado. Se publica como indicador con 30 días completos.",
    request: { query: z.object({ dias: z.coerce.number().int().min(1).max(365).optional() }) },
    responses: { ...ok("Error del SMN.", libre), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const d = await this.getValidatedData<typeof this.schema>();
    const desde = iso(Date.now() - (d.query.dias ?? 30) * 86400_000);
    const db = c.env.DB_PLATAFORMA;
    const BIN = "CASE WHEN (julianday(m.instante) - julianday(p.emision)) * 24 < 24 THEN '0-24' WHEN (julianday(m.instante) - julianday(p.emision)) * 24 < 48 THEN '24-48' WHEN (julianday(m.instante) - julianday(p.emision)) * 24 < 72 THEN '48-72' ELSE '72-120' END";
    const base = `FROM clima_smn_hora p JOIN clima_medicion m ON m.clave = p.clave AND m.instante = p.hora WHERE m.instante >= ? AND p.hora > p.emision AND m.marcas = '[]' AND m.temperatura_c IS NOT NULL AND p.temperatura_c IS NOT NULL`;
    const AGG = "COUNT(*) AS n, ROUND(AVG(ABS(p.temperatura_c - m.temperatura_c)), 2) AS mae_temperatura_c, ROUND(AVG(p.temperatura_c - m.temperatura_c), 2) AS sesgo_temperatura_c";
    const [porAnt, porCap, p0] = await Promise.all([
      filas(db, `SELECT ${BIN} AS anticipacion_h, ${AGG} ${base} GROUP BY anticipacion_h ORDER BY anticipacion_h`, [desde]),
      filas(db, `SELECT p.clave, ${BIN} AS anticipacion_h, ${AGG} ${base} GROUP BY p.clave, anticipacion_h ORDER BY p.clave, anticipacion_h`, [desde]),
      fila<{ e: string | null }>(db, "SELECT MIN(emision) AS e FROM clima_smn_emision WHERE tipo = 'hora'"),
    ]);
    const t0 = p0?.e ? Date.parse(p0.e) : null;
    const dias = t0 ? Math.floor((Date.now() - t0) / 86400_000) : 0;
    return { desde, definicion: "pronóstico oficial del SMN (municipio de la capital) − medición oficial del SMN (observatorio de la capital), lecturas sin marcas; anticipación = hora pronosticada − emisión del archivo", cobertura: { primera_emision: p0?.e ?? null, dias_cubiertos: dias, dias_para_publicar: DIAS_PARA_PUBLICAR, completo: dias >= DIAS_PARA_PUBLICAR }, por_anticipacion: porAnt, por_capital: porCap };
  }
}

export class ClimaEntregaMinutos extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "clima_entrega_minutos", summary: "Registro de la entrega en vivo, minuto por minuto (solo lectura)",
    description: "Un renglón por minuto cerrado hace más de dos minutos con entregas a páginas visibles, confirmaciones de páginas ocultas, la peor latencia del minuto (ms, reloj del servidor) y si ya se reportó al pulso del Protocolo DPM. Sin datos de visitantes. Permite recalcular la entrega desde su registro (auditoría 002, recomendación 1). Hasta 35 días.",
    request: { query: z.object({ horas: z.coerce.number().int().min(1).max(840).optional() }) },
    responses: { ...ok("Minutos.", libre), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const d = await this.getValidatedData<typeof this.schema>();
    const hasta = iso(Date.now() + 60_000), desde = iso(Date.now() - (d.query.horas ?? 24) * 3600_000);
    const minutos = await minutosEntrega(c.env, desde, hasta);
    return { desde, regla: "Minutos cerrados hace más de dos (los que ya pudieron reportarse). entregas = confirmaciones de páginas visibles; ocultas = confirmaciones de pestañas ocultas (no cuentan como entrega); latencia_max_ms = peor latencia de extremo a extremo del minuto; reportado = 1 si el minuto ya está en el pulso.", minutos };
  }
}

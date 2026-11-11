// Calidad del aire de cada capital: medición de SINAICA (Sistema Nacional de Información de la Calidad del Aire, INECC) y el
// Índice AIRE Y SALUD de la NOM-172-SEMARNAT-2023 (DOF, 25 de enero de 2024) calculado aquí con la regla de la norma.
//
// Medido el 11 de noviembre de 2026 (informe en la bitácora de la API):
// - SINAICA no tiene API documentada; sus páginas públicas leen dos rutas sin sesión: `lib/libd/cnxn.php` (POST
//   metodo=getUltimosEnvios: último envío de cada estación) y `estacion.php?estId=N` (las últimas 48 horas de cada contaminante,
//   en la variable `conts`). Son datos PRELIMINARES, sin validar, y así se publican.
// - La mayoría de las redes envía a los :10 de cada hora; la de la Ciudad de México a los :31; algunas van horas atrás.
// - SINAICA etiqueta la hora h como el promedio de (h−1, h] en hora local de la red; hay redes que parecen fechar por el inicio
//   de la hora: incertidumbre de ±1 h, declarada.
// - Cobertura: 18 capitales con estación a ≤5 km que reportó en 24 h, 3 solo con una más lejana, 11 sin medición. Donde no hay,
//   se dice que no hay: el modelo de Open-Meteo (CAMS) se apartó de lo medido entre 0.2 y 2.2 veces y no la sustituye.
// - El índice que calcula este módulo reprodujo 14 de 14 promedios ponderados y 276 de 276 categorías del índice que publica
//   SINAICA. Se guarda también el índice publicado por SINAICA, para cotejar en cada vuelta.
import type { Env } from "../index";
import { fila, filas } from "../lib/db";
import { AIRE_ESTACIONES, type CandidataAire } from "./aire-estaciones";
import { desfaseHoras } from "./normales";

export const AIRE_FUENTE = "SINAICA (INECC), datos preliminares sin validar";
const BASE = "https://sinaica.inecc.gob.mx";
const AGENTE = { "user-agent": "Mozilla/5.0 (compatible; datosmexico.org observatorio)" };
export const CONTAMINANTES = ["PM2.5", "PM10", "O3", "NO2", "SO2", "CO"] as const;
type Contaminante = (typeof CONTAMINANTES)[number];
const UNIDAD: Record<Contaminante, string> = { "PM2.5": "µg/m³", PM10: "µg/m³", O3: "ppm", NO2: "ppm", SO2: "ppm", CO: "ppm" };
const REGLA: Record<Contaminante, string> = {
  "PM2.5": "promedio móvil ponderado de 12 h × 0.694 (NOM-172, 5.2.5.3 y anexo A)", PM10: "promedio móvil ponderado de 12 h × 0.714 (NOM-172, 5.2.5.3 y anexo A)",
  O3: "promedio de 1 h", NO2: "promedio de 1 h", SO2: "promedio de 1 h", CO: "promedio móvil de 8 h (6 de 8 horas o más)",
};
// Puntos de corte de la NOM-172-SEMARNAT-2023, columna «a partir de enero de 2026», aplicados como «≤» (así los aplica SINAICA:
// 276 de 276 categorías). Límite superior de Buena, Aceptable, Mala y Muy mala; arriba, Extremadamente mala.
const CORTES: Record<Contaminante, number[]> = {
  "PM2.5": [15, 25, 79, 130], PM10: [45, 50, 132, 213], O3: [0.058, 0.09, 0.135, 0.175], NO2: [0.053, 0.106, 0.16, 0.213], SO2: [0.035, 0.075, 0.185, 0.304], CO: [5, 9, 12, 16],
};
export const CATEGORIAS = [
  { calidad: "Buena", riesgo: "Bajo", color: "#00E400" }, { calidad: "Aceptable", riesgo: "Moderado", color: "#FFFF00" },
  { calidad: "Mala", riesgo: "Alto", color: "#FF7E00" }, { calidad: "Muy mala", riesgo: "Muy alto", color: "#FF0000" },
  { calidad: "Extremadamente mala", riesgo: "Extremadamente alto", color: "#8F3F97" },
];
const FA: Partial<Record<Contaminante, number>> = { "PM2.5": 0.694, PM10: 0.714 };
const DEC: Record<Contaminante, number> = { "PM2.5": 0, PM10: 0, O3: 3, NO2: 3, SO2: 3, CO: 2 };
const redondeo = (x: number, d: number) => Math.floor(x * 10 ** d + 0.5 + 1e-9) / 10 ** d; // mitad hacia arriba (NOM-172)
const RECIENTE_MS = 3 * 3600_000;
const PEGADO_HORAS = 6;

/** Una hora de un contaminante: valor y fin de la hora en UTC. */
type Hora = { fin_utc: string; valor: number };

/** Concentración base del índice según la NOM-172 a partir de las horas más recientes (de la más nueva a la más vieja). */
export function concentracionBase(p: Contaminante, horas: Hora[], ahoraMs: number): { valor: number; fin: string; n: number } | { sin: string } {
  if (!horas.length) return { sin: "sin datos" };
  const h0 = Date.parse(horas[0].fin_utc);
  if (ahoraMs - h0 > RECIENTE_MS) return { sin: "sin dato en las últimas 3 horas" };
  const en = (k: number) => horas.find((x) => Math.round((h0 - Date.parse(x.fin_utc)) / 3600_000) === k)?.valor ?? null;
  if (p === "PM2.5" || p === "PM10") {
    // 12 horas, i = 0 la más reciente; cada hora conserva su lugar aunque falten intermedias; 2 de las 3 más recientes.
    const serie = Array.from({ length: 12 }, (_, k) => { const v = en(k); return v === null ? null : redondeo(v, 0); });
    if (serie.slice(0, 3).filter((v) => v !== null).length < 2) return { sin: "faltan horas recientes (la norma pide 2 de las 3 últimas)" };
    const vals = serie.filter((v): v is number => v !== null);
    const cmax = Math.max(...vals), cmin = Math.min(...vals);
    const w = cmax > 0 ? 1 - (cmax - cmin) / cmax : 1;
    const W = w > 0.5 ? redondeo(w, 2) : 0.5;
    let num = 0, den = 0;
    serie.forEach((v, i) => { if (v !== null) { num += v * W ** i; den += W ** i; } });
    return { valor: redondeo((num / den) * (FA[p] as number), 0), fin: horas[0].fin_utc, n: vals.length };
  }
  if (p === "CO") {
    const serie = Array.from({ length: 8 }, (_, k) => en(k)).filter((v): v is number => v !== null);
    if (serie.length < 6) return { sin: "menos de 6 de las 8 horas" };
    return { valor: redondeo(serie.reduce((a, b) => a + b, 0) / serie.length, 2), fin: horas[0].fin_utc, n: serie.length };
  }
  return { valor: redondeo(horas[0].valor, 3), fin: horas[0].fin_utc, n: 1 };
}
export const categoriaDe = (p: Contaminante, c: number) => { const i = CORTES[p].findIndex((l) => c <= l); return i < 0 ? 4 : i; };

/** Sensor que repite el mismo valor muchas horas seguidas (p. ej. PM2.5 fijo en 38 durante 12 h): no entra al índice. */
export function pegado(horas: Hora[]): boolean {
  const ult = horas.slice(0, PEGADO_HORAS);
  return ult.length === PEGADO_HORAS && ult.every((x) => x.valor === ult[0].valor);
}

// ─── Custodia (cron) ────────────────────────────────────────────────────────────────────────────────────────────────────
type Envio = { idEstacion: number; ultimoEnvio: string | null; numDatos: number };
const localAUtc = (clave: string, local: string, ms: number) => { const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(local); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + desfaseHoras(clave, ms) * 3600_000 : NaN; };

/** Variable `conts` de la página de una estación: {contaminante: [48 horas: {fecha, hora, valorAct} | null]}. */
export function leerConts(html: string): Record<string, ({ fecha: string; hora: number; valorAct: number | string | null } | null)[]> {
  const i = html.indexOf("conts = {");
  if (i < 0) throw new Error("la página de la estación no trae conts");
  const ini = html.indexOf("{", i);
  let prof = 0, j = ini, enCadena = false;
  for (; j < html.length; j++) {
    const ch = html[j];
    if (enCadena) { if (ch === "\\") j++; else if (ch === '"') enCadena = false; continue; }
    if (ch === '"') enCadena = true; else if (ch === "{" || ch === "[") prof++; else if (ch === "}" || ch === "]") { prof--; if (prof === 0) break; }
  }
  return JSON.parse(html.slice(ini, j + 1));
}

export async function custodiarAire(env: Env, ahora: Date, fetchImpl: typeof fetch = fetch): Promise<{ estaciones: number; paginas: number; nuevas: number; capitales_con_medicion: number; fallas: string[] }> {
  const ms = ahora.getTime(), llegado = ahora.toISOString();
  const fallas: string[] = [];
  const r = await fetchImpl(`${BASE}/lib/libd/cnxn.php`, { method: "POST", headers: { ...AGENTE, "content-type": "application/x-www-form-urlencoded" }, body: "metodo=getUltimosEnvios" });
  if (!r.ok) throw new Error(`SINAICA (últimos envíos) respondió ${r.status}`);
  const envios = new Map(((await r.json()) as Envio[]).map((e) => [Number(e.idEstacion), e]));
  // Elección, por capital: se recorren las candidatas con envío en las últimas 6 h (primero las de ≤5 km, luego las demás, cada
  // grupo de la más cercana a la más lejana) hasta dar con una que tenga algún contaminante con dato en las últimas 6 h; si esa
  // no mide partículas, se busca además, entre las de ≤5 km, una que sí las mida. Hasta 3 páginas por capital. Cada contaminante
  // lo da la estación elegida más cercana que lo mida.
  const fresca = (clave: string, c: CandidataAire) => { const e = envios.get(c.id); const t = e?.ultimoEnvio ? localAUtc(clave, e.ultimoEnvio, ms) : NaN; return Number.isFinite(t) && ms - t < 6 * 3600_000; };
  const paginas = new Map<number, Promise<{ params: string[]; filas: { par: string; finLocal: string; valor: number }[] } | null>>();
  const leerEstacion = (clave: string, c: CandidataAire) => {
    if (!paginas.has(c.id)) paginas.set(c.id, (async () => {
      try {
        const p = await fetchImpl(`${BASE}/estacion.php?estId=${c.id}`, { headers: AGENTE });
        if (!p.ok) throw new Error(`${p.status}`);
        const conts = leerConts(await p.text());
        const params: string[] = [], out: { par: string; finLocal: string; valor: number }[] = [];
        for (const par of CONTAMINANTES) {
          const xs = (conts[par] ?? []).filter((x): x is { fecha: string; hora: number; valorAct: number | string | null } => !!x && x.valorAct !== null && x.valorAct !== "" && Number.isFinite(Number(x.valorAct)));
          for (const x of xs) out.push({ par, finLocal: `${x.fecha}T${String(x.hora).padStart(2, "0")}:00`, valor: Number(x.valorAct) });
          if (xs.some((x) => ms - localAUtc(clave, `${x.fecha}T${String(x.hora).padStart(2, "0")}:00`, ms) < 6 * 3600_000)) params.push(par);
        }
        return { params, filas: out };
      } catch (e) { fallas.push(`${c.id} ${c.nombre}: ${String(e).slice(0, 80)}`); return null; }
    })());
    return paginas.get(c.id)!;
  };
  const elegidas: { clave: string; ests: (CandidataAire & { parametros: string[] })[] }[] = [];
  await Promise.all(AIRE_ESTACIONES.map(async (a) => {
    const frescas = a.candidatas.filter((c) => fresca(a.clave, c));
    const orden = [...frescas.filter((c) => c.km <= 5), ...frescas.filter((c) => c.km > 5)];
    const ests: (CandidataAire & { parametros: string[] })[] = [];
    let intentos = 0;
    for (const c of orden) {
      if (intentos >= 3) break;
      const yaPm = ests.some((e) => e.parametros.includes("PM2.5") || e.parametros.includes("PM10"));
      if (ests.length && (yaPm || c.km > 5)) break;
      intentos++;
      const pag = await leerEstacion(a.clave, c);
      if (!pag || !pag.params.length) continue;
      if (ests.length && !pag.params.some((x) => x === "PM2.5" || x === "PM10")) continue;
      ests.push({ ...c, parametros: pag.params });
    }
    elegidas.push({ clave: a.clave, ests });
  }));
  let nuevas = 0;
  const st: D1PreparedStatement[] = [];
  const porEstacion = new Map<number, string>();
  for (const e of elegidas) for (const c of e.ests) if (!porEstacion.has(c.id)) porEstacion.set(c.id, e.clave);
  for (const [id, clave] of porEstacion) {
    const pag = await paginas.get(id);
    if (!pag) continue;
    const ya = new Set((await filas<{ k: string }>(env.DB_PLATAFORMA, "SELECT parametro || '|' || fin_local AS k FROM clima_aire_hora WHERE estacion = ? AND fin_local >= ?", [id, new Date(ms - 4 * 86400_000).toISOString().slice(0, 10)])).map((x) => x.k));
    for (const f of pag.filas) {
      if (ya.has(`${f.par}|${f.finLocal}`)) continue;
      st.push(env.DB_PLATAFORMA.prepare("INSERT OR IGNORE INTO clima_aire_hora (estacion, parametro, fin_local, fin_utc, valor, llegado_en) VALUES (?, ?, ?, ?, ?, ?)").bind(id, f.par, f.finLocal, new Date(localAUtc(clave, f.finLocal, ms)).toISOString(), f.valor, llegado));
      nuevas++;
    }
  }
  const lista = [...paginas.keys()];
  // Índice que publica SINAICA, para cotejar (no es la fuente: la fuente son las concentraciones).
  try {
    const ix = await fetchImpl(`${BASE}/index.php`, { headers: AGENTE });
    const html = await ix.text();
    const m = /let cump = (\{[\s\S]*?\});\s*\n/.exec(html);
    if (m) {
      const cump = JSON.parse(m[1]) as Record<string, { redes?: Record<string, { ests?: Record<string, { cumple?: Record<string, number>; calc?: Record<string, number | string> }> }>; date?: string }> & { date?: string };
      const fecha = (cump as { date?: string }).date ?? null;
      for (const s of Object.values(cump)) if (s && typeof s === "object") for (const red of Object.values(s.redes ?? {})) for (const [id, e] of Object.entries(red.ests ?? {})) {
        if (!porEstacion.has(Number(id)) || !e.cumple) continue;
        st.push(env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO clima_aire_sinaica (estacion, calculado_en, cumple, calc, leido_en) VALUES (?, ?, ?, ?, ?)").bind(Number(id), fecha, JSON.stringify(e.cumple), JSON.stringify(e.calc ?? {}), llegado));
      }
    }
  } catch (e) { fallas.push(`índice publicado: ${String(e).slice(0, 80)}`); }
  for (const e of elegidas) st.push(env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO clima_aire_eleccion (clave, estaciones, elegido_en) VALUES (?, ?, ?)").bind(e.clave, JSON.stringify(e.ests), llegado));
  st.push(env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO clima_consultas (instante, fuente, pedidos, nuevas, detalle) VALUES (?, 'aire', ?, ?, ?)").bind(new Date(Math.floor(ms / 60_000) * 60_000).toISOString(), lista.length + 2, nuevas, fallas.length ? fallas.slice(0, 4).join("; ") : null));
  for (let i = 0; i < st.length; i += 400) await env.DB_PLATAFORMA.batch(st.slice(i, i + 400));
  return { estaciones: porEstacion.size, paginas: lista.length, nuevas, capitales_con_medicion: elegidas.filter((e) => e.ests.length).length, fallas };
}

// ─── Lectura (ficha) ────────────────────────────────────────────────────────────────────────────────────────────────────
export async function aireDe(env: Env, clave: string, ahora: number) {
  const base = { fuente: AIRE_FUENTE, norma: "NOM-172-SEMARNAT-2023 (DOF 25-01-2024), Índice AIRE Y SALUD; cortes vigentes desde enero de 2026", papel: "medicion_preliminar" };
  const el = await fila<{ estaciones: string; elegido_en: string }>(env.DB_PLATAFORMA, "SELECT estaciones, elegido_en FROM clima_aire_eleccion WHERE clave = ?", [clave]);
  const candidatas = AIRE_ESTACIONES.find((a) => a.clave === clave)?.candidatas ?? [];
  if (!candidatas.length) return { ...base, estado: "sin_estacion", explicacion: "SINAICA no tiene estaciones de calidad del aire a 15 km o menos del centro de esta capital." };
  if (!el) return { ...base, estado: "sin_lectura_aun", explicacion: "La primera lectura de SINAICA llega al minuto 42 de la hora." };
  const ests = JSON.parse(el.estaciones) as (CandidataAire & { parametros: string[] })[];
  if (!ests.length) return { ...base, estado: "sin_envio_reciente", explicacion: candidatas.length === 1 ? `La única estación de SINAICA a 15 km o menos (${candidatas[0].nombre}, a ${candidatas[0].km} km) no ha enviado datos útiles en las últimas 6 horas.` : `Ninguna de las ${candidatas.length} estaciones de SINAICA a 15 km o menos (${candidatas.map((c) => c.nombre).join(", ")}) ha enviado datos útiles en las últimas 6 horas.`, elegido_en: el.elegido_en };
  const contaminantes: Record<string, unknown>[] = [];
  let peor = -1, manda: string | null = null;
  for (const p of CONTAMINANTES) {
    const est = ests.find((e) => e.parametros.includes(p));
    if (!est) continue;
    const horas = await filas<Hora>(env.DB_PLATAFORMA, "SELECT fin_utc, valor FROM clima_aire_hora WHERE estacion = ? AND parametro = ? AND fin_utc >= ? ORDER BY fin_utc DESC", [est.id, p, new Date(ahora - 15 * 3600_000).toISOString()]);
    const fuera = pegado(horas);
    const c = concentracionBase(p, horas, ahora);
    const fila0: Record<string, unknown> = { parametro: p, unidad: UNIDAD[p], regla: REGLA[p], estacion: { id: est.id, nombre: est.nombre, red: est.red, km: est.km } };
    // Si la red va atrás, se dice cuánto: el índice solo usa datos de las últimas 3 horas.
    if ("sin" in c) { const u = await fila<{ u: string | null }>(env.DB_PLATAFORMA, "SELECT MAX(fin_utc) AS u FROM clima_aire_hora WHERE estacion = ? AND parametro = ?", [est.id, p]); contaminantes.push({ ...fila0, sin: c.sin, ultimo_dato: u?.u ?? null }); continue; }
    const cat = categoriaDe(p, c.valor);
    contaminantes.push({ ...fila0, concentracion: c.valor, hora_fin: c.fin, horas_usadas: c.n, categoria: CATEGORIAS[cat].calidad, color: CATEGORIAS[cat].color, ...(fuera ? { marca: `posible sensor pegado: el mismo valor ${PEGADO_HORAS} horas seguidas; no entra al índice` } : {}) });
    if (!fuera && cat > peor) { peor = cat; manda = p; }
  }
  // Cotejo con el índice que publica SINAICA para la estación que da el contaminante que manda.
  let cotejo: Record<string, unknown> | null = null;
  const estManda = manda ? ests.find((e) => e.parametros.includes(manda as string)) : null;
  if (estManda) {
    const s = await fila<{ calculado_en: string | null; cumple: string; calc: string }>(env.DB_PLATAFORMA, "SELECT calculado_en, cumple, calc FROM clima_aire_sinaica WHERE estacion = ? ORDER BY leido_en DESC LIMIT 1", [estManda.id]);
    if (s) {
      const cumple = JSON.parse(s.cumple) as Record<string, number>;
      const k = manda === "O3" ? "O3/1" : (manda as string);
      const pub = cumple[k];
      cotejo = { estacion: estManda.id, calculado_en: s.calculado_en, contaminante: manda, categoria_publicada: pub ? CATEGORIAS[pub - 1]?.calidad ?? null : null, coincide: pub ? pub - 1 === peor : null, nota: "El índice de SINAICA se calcula a una hora fija y puede ir una hora atrás o adelante del de aquí." };
    }
  }
  return {
    ...base, estado: peor >= 0 ? "medido" : "sin_dato_reciente", elegido_en: el.elegido_en,
    indice: peor >= 0 ? { calidad: CATEGORIAS[peor].calidad, riesgo: CATEGORIAS[peor].riesgo, color: CATEGORIAS[peor].color, contaminante: manda } : null,
    contaminantes, estaciones: ests.map(({ parametros, ...e }) => ({ ...e, parametros })), cotejo_sinaica: cotejo,
    nota: "Concentraciones horarias preliminares de SINAICA (INECC), sin validar. Índice = la peor categoría entre los contaminantes con dato reciente, calculada aquí con la NOM-172. La hora de cada red puede estar corrida ±1 h.",
  };
}

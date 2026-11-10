// Avisos oficiales del Servicio Meteorológico Nacional: lluvias, ciclones tropicales y frentes fríos, tal como el SMN los
// publica en su canal CAP 1.2 (licencia CC BY 4.0). Cada 5 minutos se lee el índice (Atom) y se bajan solo los mensajes
// nuevos de las últimas 48 horas; cada uno se guarda con su huella SHA-256 y lo que se leyó de él (gravedad, vigencia,
// zonas dibujadas por el SMN). Vigente = no ha vencido y ningún mensaje posterior lo actualiza.
// Lo que el canal no trae no se inventa: desde el 19 de octubre de 2026 el SMN no publica ahí los avisos de frente frío (sí en
// su sitio web); el endpoint dice cuándo fue el último de cada tipo.
import type { Env } from "../index";
import { filas } from "../lib/db";

export const AVISOS_INDICE = "https://smn.conagua.gob.mx/tools/PHP/feedsmn/cap.php";
export const AVISOS_FUENTE = "Servicio Meteorológico Nacional (CONAGUA), avisos en CAP 1.2, licencia CC BY 4.0";
const AGENTE = { "user-agent": "datosmexico.org (observatorio; avisos del clima; equipo@datosmexico.org)" };
const VENTANA_MS = 48 * 3600_000; // solo se bajan los mensajes de las últimas 48 horas: ninguno más viejo puede seguir vigente
const POR_VUELTA = 12;

const iso = (ms: number) => new Date(ms).toISOString();
const desentidad = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const uno = (xml: string, etiqueta: string) => {
  const m = new RegExp(`<${etiqueta}(?:\\s[^>]*)?>([\\s\\S]*?)</${etiqueta}>`).exec(xml);
  return m ? desentidad(m[1].trim()) : null;
};
const todos = (xml: string, etiqueta: string) => [...xml.matchAll(new RegExp(`<${etiqueta}(?:\\s[^>]*)?>([\\s\\S]*?)</${etiqueta}>`, "g"))].map((m) => desentidad(m[1].trim()));
const utc = (s: string | null) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? iso(t) : null; };
const tipoDe = (url: string) => /avisossmn-(lluvias|ciclontropical|frentefrio)/i.exec(url)?.[1].toLowerCase() ?? "otro";

export type Aviso = {
  url: string; identificador: string; tipo: string; mensaje: string; enviado: string; vigente_desde: string | null; vence: string | null;
  evento: string | null; titulo: string | null; descripcion: string | null; instruccion: string | null;
  gravedad: string | null; urgencia: string | null; certeza: string | null; semaforo: string | null; categoria: string | null; trayectoria: string | null;
  zona: string | null; poligonos: [number, number][][]; referencias: string | null;
};

/** Lee un mensaje CAP del SMN. Exige lo mínimo para dibujarlo y fecharlo; lo demás queda nulo si no viene. */
export function leerCap(url: string, xml: string): Aviso {
  if (!/<alert[\s>]/.test(xml) || !/urn:oasis:names:tc:emergency:cap:1\.2/.test(xml)) throw new Error("no es un mensaje CAP 1.2");
  const info = uno(xml, "info") ?? "";
  const param = new Map<string, string>();
  for (const p of [...info.matchAll(/<parameter>\s*<valueName>([\s\S]*?)<\/valueName>\s*<value>([\s\S]*?)<\/value>\s*<\/parameter>/g)]) param.set(desentidad(p[1].trim()).toLowerCase(), desentidad(p[2].trim()));
  // El CAP da cada vértice como «lat,lon» separados por espacios; GeoJSON pide [lon, lat]. Un anillo debe cerrar.
  const poligonos = todos(info, "polygon").map((p) => {
    const anillo = p.split(/\s+/).map((v) => v.split(",").map(Number)).filter((v) => v.length === 2 && v.every(Number.isFinite)).map(([lat, lon]) => [lon, lat] as [number, number]);
    if (anillo.length && (anillo[0][0] !== anillo[anillo.length - 1][0] || anillo[0][1] !== anillo[anillo.length - 1][1])) anillo.push(anillo[0]);
    return anillo;
  }).filter((a) => a.length >= 4);
  const enviado = utc(uno(xml, "sent"));
  const identificador = uno(xml, "identifier");
  if (!identificador || !enviado) throw new Error("mensaje sin identificador o sin fecha de envío");
  return {
    url, identificador, tipo: tipoDe(url), mensaje: uno(xml, "msgType") ?? "Alert", enviado,
    vigente_desde: utc(uno(info, "effective")), vence: utc(uno(info, "expires")),
    evento: uno(info, "event"), titulo: uno(info, "headline"), descripcion: uno(info, "description"), instruccion: uno(info, "instruction"),
    gravedad: uno(info, "severity"), urgencia: uno(info, "urgency"), certeza: uno(info, "certainty"),
    semaforo: param.get("semáforo") ?? param.get("semaforo") ?? null, categoria: param.get("categoría") ?? param.get("categoria") ?? null, trayectoria: param.get("trayectoria") ?? null,
    zona: uno(info, "areaDesc"), poligonos, referencias: uno(xml, "references"),
  };
}

type Entrada = { url: string; actualizado: number };
function leerIndice(atom: string): Entrada[] {
  return [...atom.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => ({ url: desentidad(uno(m[1], "id") ?? ""), actualizado: Date.parse(uno(m[1], "updated") ?? "") }))
    .filter((e) => /^https:\/\/smn\.conagua\.gob\.mx\/.+_cap\.xml$/.test(e.url) && Number.isFinite(e.actualizado));
}

export type ResultadoAvisos = { indice: number; recientes: number; nuevos: number; fallas: string[]; ultimo_por_tipo: Record<string, string> };

/** Una vuelta: lee el índice y custodia los mensajes nuevos de las últimas 48 horas. */
export async function custodiarAvisos(env: Env, ahora: Date, fetchImpl: typeof fetch = fetch): Promise<ResultadoAvisos> {
  // El SMN sirve el índice con caché de un año: se pide siempre fresco.
  const r = await fetchImpl(`${AVISOS_INDICE}?t=${ahora.getTime()}`, { headers: AGENTE, cache: "no-store" });
  if (!r.ok) throw new Error(`el índice de avisos del SMN respondió ${r.status}`);
  const indice = leerIndice(await r.text());
  const ultimo_por_tipo: Record<string, string> = {};
  for (const e of indice) { const t = tipoDe(e.url); if (!ultimo_por_tipo[t] || e.actualizado > Date.parse(ultimo_por_tipo[t])) ultimo_por_tipo[t] = iso(e.actualizado); }
  await env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO clima_consultas (instante, fuente, pedidos, nuevas, detalle) VALUES (?, 'avisos', 1, 0, ?)").bind(iso(ahora.getTime()), JSON.stringify({ indice: indice.length, ultimo_por_tipo })).run();
  const recientes = indice.filter((e) => ahora.getTime() - e.actualizado < VENTANA_MS);
  const tenidos = new Set((await filas<{ url: string }>(env.DB_PLATAFORMA, `SELECT url FROM clima_avisos WHERE enviado >= ?`, [iso(ahora.getTime() - VENTANA_MS - 86400_000)])).map((x) => x.url));
  const faltan = recientes.filter((e) => !tenidos.has(e.url)).sort((a, b) => b.actualizado - a.actualizado).slice(0, POR_VUELTA);
  const fallas: string[] = []; let nuevos = 0;
  for (const e of faltan) {
    try {
      const rx = await fetchImpl(e.url, { headers: AGENTE, cache: "no-store" });
      if (!rx.ok) throw new Error(`respondió ${rx.status}`);
      const bytes = new Uint8Array(await rx.arrayBuffer());
      const xml = new TextDecoder().decode(bytes);
      const a = leerCap(e.url, xml);
      const huella = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
      await env.DB_PLATAFORMA.prepare("INSERT OR IGNORE INTO clima_avisos (url, identificador, tipo, mensaje, enviado, vigente_desde, vence, evento, titulo, descripcion, instruccion, gravedad, urgencia, certeza, semaforo, categoria, trayectoria, zona, poligonos, referencias, llegado_en, sha256, xml) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(a.url, a.identificador, a.tipo, a.mensaje, a.enviado, a.vigente_desde, a.vence, a.evento, a.titulo, a.descripcion, a.instruccion, a.gravedad, a.urgencia, a.certeza, a.semaforo, a.categoria, a.trayectoria, a.zona, JSON.stringify(a.poligonos), a.referencias, iso(Date.now()), huella, xml).run();
      nuevos++;
    } catch (x) { fallas.push(`${e.url.split("/").pop()}: ${x instanceof Error ? x.message : String(x)}`); }
  }
  return { indice: indice.length, recientes: recientes.length, nuevos, fallas, ultimo_por_tipo };
}

type FilaAviso = Omit<Aviso, "poligonos"> & { poligonos: string; llegado_en: string; sha256: string };

/** Avisos vigentes: no vencidos y que ningún mensaje posterior actualiza o cancela. */
export async function avisosVigentes(env: Env, ahora: number): Promise<(Aviso & { llegado_en: string; sha256: string })[]> {
  const rs = await filas<FilaAviso>(env.DB_PLATAFORMA, "SELECT url, identificador, tipo, mensaje, enviado, vigente_desde, vence, evento, titulo, descripcion, instruccion, gravedad, urgencia, certeza, semaforo, categoria, trayectoria, zona, poligonos, referencias, llegado_en, sha256 FROM clima_avisos WHERE enviado >= ? ORDER BY enviado", [iso(ahora - VENTANA_MS - 86400_000)]);
  // <references> lista «remitente,identificador,fecha» separados por espacios; un aviso referido por otro posterior queda atrás.
  const superados = new Set<string>();
  for (const r of rs) for (const ref of (r.referencias ?? "").split(/\s+/)) { const id = ref.split(",")[1]; if (id) superados.add(id.toLowerCase()); }
  return rs
    .filter((r) => r.mensaje !== "Cancel" && !superados.has(r.identificador.toLowerCase()) && (!r.vence || Date.parse(r.vence) > ahora) && (!r.vigente_desde || Date.parse(r.vigente_desde) <= ahora + 6 * 3600_000))
    .map((r) => ({ ...r, poligonos: JSON.parse(r.poligonos) as [number, number][][] }));
}

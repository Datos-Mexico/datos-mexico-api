// Entrega en vivo del clima: el dato `datos-mexico/clima-entrega` del Protocolo DPM. Cada vez que una lectura nueva entra al
// observatorio (medición oficial, aeropuerto o pronóstico), las páginas abiertas la reciben empujada por WebSocket, sin pedirla,
// y el navegador confirma que la recibió. La latencia de cada entrega se mide con relojes del servidor, de extremo a extremo:
// desde que la lectura quedó guardada en el observatorio hasta que llega la confirmación del navegador. Lo que esta latencia NO
// mide es la antigüedad de la lectura: esa la dice la fuente (la medición oficial del SMN es horaria). Las dos cosas se
// muestran separadas; nunca se dice «clima por segundo».
// Solo cuentan las entregas a páginas visibles: una pestaña oculta no es una persona mirando. Un solo objeto durable
// coordina la difusión (hiberna entre eventos: sin costo de duración mientras nadie habla).
import { DurableObject } from "cloudflare:workers";
import type { Env } from "../index";

export type TipoLectura = "medicion" | "aeropuerto" | "pronostico";
export type Evento = { tipo: TipoLectura; evento_ms: number; datos: { clave: string }[] };
type Adjunto = { abierto_ms: number; acks: string[] };
export type MinutoEntregas = { minuto: string; entregas: number; ocultas: number; latencia_max_ms: number; primero_ms: number; ultimo_ms: number };

const iso = (ms: number) => new Date(ms).toISOString();
const minutoDe = (ms: number) => iso(Math.floor(ms / 60_000) * 60_000);

export class ClimaEnVivo extends DurableObject<Env> {
  private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec("CREATE TABLE IF NOT EXISTS eventos (id TEXT PRIMARY KEY, tipo TEXT NOT NULL, evento_ms INTEGER NOT NULL, enviado_ms INTEGER NOT NULL, destinatarios INTEGER NOT NULL)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS estado (tipo TEXT NOT NULL, clave TEXT NOT NULL, datos TEXT NOT NULL, PRIMARY KEY (tipo, clave))");
      this.sql.exec("CREATE TABLE IF NOT EXISTS entregas (minuto TEXT PRIMARY KEY, entregas INTEGER NOT NULL, ocultas INTEGER NOT NULL, latencia_max_ms INTEGER NOT NULL, primero_ms INTEGER, ultimo_ms INTEGER, reportado INTEGER NOT NULL DEFAULT 0)");
      this.sql.exec("CREATE TABLE IF NOT EXISTS latencias (ms_llegada INTEGER NOT NULL, latencia_ms INTEGER NOT NULL)");
    });
  }

  /** Conexión de una página: se acepta en modo hibernable y se le manda el estado vigente (eso es consulta, no entrega). */
  async fetch(_req: Request): Promise<Response> {
    const par = new WebSocketPair();
    const [cliente, servidor] = Object.values(par);
    this.ctx.acceptWebSocket(servidor);
    servidor.serializeAttachment({ abierto_ms: Date.now(), acks: [] } satisfies Adjunto);
    const estado: Record<string, Record<string, unknown>> = { medicion: {}, aeropuerto: {}, pronostico: {} };
    for (const r of this.sql.exec<{ tipo: string; clave: string; datos: string }>("SELECT tipo, clave, datos FROM estado")) estado[r.tipo][r.clave] = JSON.parse(r.datos);
    servidor.send(JSON.stringify({ t: "estado", estado }));
    return new Response(null, { status: 101, webSocket: cliente });
  }

  /** Difunde una lectura nueva a todas las páginas abiertas. */
  async difundir(e: Evento): Promise<{ id: string; destinatarios: number }> {
    const id = `${e.evento_ms.toString(36)}${e.tipo[0]}${Math.floor(Math.random() * 1296).toString(36)}`;
    for (const d of e.datos) this.sql.exec("INSERT OR REPLACE INTO estado (tipo, clave, datos) VALUES (?, ?, ?)", e.tipo, d.clave, JSON.stringify(d));
    const sockets = this.ctx.getWebSockets();
    const msg = JSON.stringify({ t: "lectura", id, tipo: e.tipo, datos: e.datos });
    let enviados = 0;
    for (const ws of sockets) { try { ws.send(msg); enviados++; } catch { /* conexión cerrándose */ } }
    this.sql.exec("INSERT INTO eventos (id, tipo, evento_ms, enviado_ms, destinatarios) VALUES (?, ?, ?, ?, ?)", id, e.tipo, e.evento_ms, Date.now(), enviados);
    const hace2d = Date.now() - 2 * 86400_000;
    this.sql.exec("DELETE FROM eventos WHERE enviado_ms < ?", hace2d);
    this.sql.exec("DELETE FROM latencias WHERE ms_llegada < ?", hace2d);
    this.sql.exec("DELETE FROM entregas WHERE minuto < ? AND reportado = 1", iso(Date.now() - 8 * 86400_000));
    return { id, destinatarios: enviados };
  }

  /** Confirmación del navegador: {t:"ack", id, visible}. La latencia se calcula aquí, con el reloj del servidor. */
  async webSocketMessage(ws: WebSocket, mensaje: string | ArrayBuffer): Promise<void> {
    const llegada = Date.now();
    if (typeof mensaje !== "string" || mensaje.length > 200) return;
    let m: { t?: unknown; id?: unknown; visible?: unknown };
    try { m = JSON.parse(mensaje); } catch { return; }
    if (m.t !== "ack" || typeof m.id !== "string") return;
    const adj = (ws.deserializeAttachment() as Adjunto | null) ?? { abierto_ms: llegada, acks: [] };
    if (adj.acks.includes(m.id)) return; // una confirmación por página y lectura
    const ev = this.sql.exec<{ evento_ms: number }>("SELECT evento_ms FROM eventos WHERE id = ?", m.id).toArray()[0];
    if (!ev) return;
    adj.acks = [...adj.acks.slice(-31), m.id];
    ws.serializeAttachment(adj);
    const minuto = minutoDe(llegada);
    if (m.visible !== true) {
      this.sql.exec("INSERT INTO entregas (minuto, entregas, ocultas, latencia_max_ms) VALUES (?, 0, 1, 0) ON CONFLICT (minuto) DO UPDATE SET ocultas = ocultas + 1", minuto);
      return;
    }
    const latencia = Math.max(0, llegada - ev.evento_ms);
    this.sql.exec("INSERT INTO entregas (minuto, entregas, ocultas, latencia_max_ms, primero_ms, ultimo_ms) VALUES (?, 1, 0, ?, ?, ?) ON CONFLICT (minuto) DO UPDATE SET entregas = entregas + 1, latencia_max_ms = MAX(latencia_max_ms, excluded.latencia_max_ms), primero_ms = MIN(COALESCE(primero_ms, excluded.primero_ms), excluded.primero_ms), ultimo_ms = MAX(COALESCE(ultimo_ms, excluded.ultimo_ms), excluded.ultimo_ms)", minuto, latencia, llegada, llegada);
    this.sql.exec("INSERT INTO latencias (ms_llegada, latencia_ms) VALUES (?, ?)", llegada, latencia);
    try { ws.send(JSON.stringify({ t: "latencia", id: m.id, ms: latencia })); } catch { /* cerrada */ }
  }

  async webSocketClose(): Promise<void> { /* el runtime responde el cierre (fecha de compatibilidad ≥ 2026-04-07) */ }

  /** Minutos cerrados con entregas aún no reportados al pulso. */
  async pendientes(antesDe: string): Promise<MinutoEntregas[]> {
    return this.sql.exec<MinutoEntregas>("SELECT minuto, entregas, ocultas, latencia_max_ms, primero_ms, ultimo_ms FROM entregas WHERE reportado = 0 AND entregas > 0 AND minuto < ? AND minuto >= ? ORDER BY minuto", antesDe, iso(Date.now() - 23 * 3600_000)).toArray();
  }
  async marcarReportados(minutos: string[]): Promise<void> {
    for (const m of minutos) this.sql.exec("UPDATE entregas SET reportado = 1 WHERE minuto = ?", m);
  }

  /** Cara pública de comprobación (protocolo 0.4 §8 bis) y cifras de la página. */
  async cifras(): Promise<{ ultimo_refresco: string | null; refrescos_ultima_hora: number; ocultas_ultima_hora: number; conexiones: number; latencia_24h: { n: number; p50_ms: number | null; p95_ms: number | null; max_ms: number | null }; ultimo_evento: string | null }> {
    // Cara pública: solo minutos cerrados hace más de dos (auditoría 002). Una entrega del minuto en curso aún no puede estar en el
    // pulso (se reporta cuando el minuto cierra); contarla hacía que la comprobación viera algo «no reportado» y no coincidiera.
    const corte = iso(Math.floor(Date.now() / 60_000) * 60_000 - 120_000);
    const hace1h = iso(Date.now() - 3600_000);
    const h = this.sql.exec<{ u: number | null; n: number | null; o: number | null }>("SELECT MAX(ultimo_ms) AS u, SUM(entregas) AS n, SUM(ocultas) AS o FROM entregas WHERE minuto >= ? AND minuto < ?", hace1h, corte).one();
    const u = this.sql.exec<{ u: number | null }>("SELECT MAX(ultimo_ms) AS u FROM entregas WHERE minuto < ?", corte).one().u;
    const lat = this.sql.exec<{ l: number }>("SELECT latencia_ms AS l FROM latencias WHERE ms_llegada >= ? ORDER BY latencia_ms", Date.now() - 86400_000).toArray().map((x) => x.l);
    const q = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : null);
    const ev = this.sql.exec<{ e: number | null }>("SELECT MAX(evento_ms) AS e FROM eventos").one().e;
    return {
      ultimo_refresco: u ? iso(u) : null, refrescos_ultima_hora: h.n ?? 0, ocultas_ultima_hora: h.o ?? 0, conexiones: this.ctx.getWebSockets().length,
      latencia_24h: { n: lat.length, p50_ms: q(0.5), p95_ms: q(0.95), max_ms: lat.length ? lat[lat.length - 1] : null }, ultimo_evento: ev ? iso(ev) : null,
    };
  }
}

const stub = (env: Env) => env.CLIMA_EN_VIVO.getByName("clima");

/** Llamada desde la custodia: difunde la lectura. Nunca lanza (la entrega no debe tumbar la custodia). */
export async function difundir(env: Env, e: Evento): Promise<{ id: string; destinatarios: number } | null> {
  try { return await stub(env).difundir(e); } catch (x) { console.error("clima en vivo: difundir", x); return null; }
}
export const pendientesEntregas = (env: Env, antesDe: string) => stub(env).pendientes(antesDe);
export const marcarEntregasReportadas = (env: Env, minutos: string[]) => stub(env).marcarReportados(minutos);
export const cifrasEntrega = (env: Env) => stub(env).cifras();
export const conectarEnVivo = (env: Env, req: Request) => stub(env).fetch(req);

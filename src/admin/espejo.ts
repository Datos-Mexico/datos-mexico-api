// Espejo de fuentes: el worker descarga un archivo público del INEGI desde la red de Cloudflare y lo guarda en R2
// (inegi/fuentes/...), sin pasar por la red del observatorio. Sirve para que las máquinas locales conviertan
// desde R2 (rápido) cuando el INEGI limita la velocidad hacia una sola IP. Solo administradores; solo hosts del INEGI.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { ErrorHttp } from "../lib/errores";
import { RESP_401, RESP_403, SEGURIDAD, requiereAdmin } from "../lib/auth";

const Cuerpo = z.object({ url: z.string().url(), clave: z.string().regex(/^inegi\/(fuentes|tabulados)\/[A-Za-z0-9_\-./()]+$/) });
export class AdminEspejo extends OpenAPIRoute {
  schema = {
    tags: ["admin"], operationId: "admin_espejo_fuente", summary: "[Operacional] Copiar un archivo público del INEGI al almacén (R2) desde la red de Cloudflare", security: SEGURIDAD,
    description: "Descarga la URL (solo www.inegi.org.mx) y la guarda tal cual en R2 bajo la clave dada (prefijos inegi/fuentes/ o inegi/tabulados/), devolviendo tamaño, ETag y si ya existía con el mismo tamaño. Es la vía para acelerar la ingesta cuando el INEGI limita la velocidad por dirección IP. Requiere JWT admin.",
    request: { body: contentJson(Cuerpo) },
    responses: { "200": { description: "Archivo en R2.", ...contentJson(z.object({ clave: z.string(), bytes: z.number().int(), etag: z.string(), existia: z.boolean(), ms: z.number().int() })) }, ...RESP_401, ...RESP_403, "422": { description: "URL o clave inválidas.", ...contentJson(z.object({ detail: z.unknown() })) }, "502": { description: "El INEGI no entregó el archivo.", ...contentJson(z.object({ detail: z.string() })) } },
  };
  async handle(c: AppContext) {
    await requiereAdmin(c);
    const r = Cuerpo.safeParse(await c.req.json().catch(() => ({})));
    if (!r.success) throw new ErrorHttp(422, r.error.issues.map((i) => ({ type: i.code, loc: ["body", ...i.path.map(String)], msg: i.message, input: null })));
    const { url, clave } = r.data; const u = new URL(url);
    if (u.hostname !== "www.inegi.org.mx" || u.protocol !== "https:") throw new ErrorHttp(422, [{ type: "value_error", loc: ["body", "url"], msg: "solo https://www.inegi.org.mx", input: url }]);
    const t0 = Date.now();
    const previo = await c.env.DATOS.head(clave);
    const resp = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (observatorio datosmexico; espejo de fuentes)" } });
    if (!resp.ok || !resp.body) throw new ErrorHttp(502, `INEGI respondió ${resp.status} para ${url}`);
    const len = Number(resp.headers.get("content-length") ?? "0");
    if (previo && len > 0 && previo.size === len) return { clave, bytes: previo.size, etag: previo.httpEtag, existia: true, ms: Date.now() - t0 };
    const tipo = resp.headers.get("content-type") ?? "application/octet-stream";
    // R2 acepta un flujo si conoce la longitud: se envuelve en FixedLengthStream; si no hay longitud, se materializa
    let obj: R2Object | null;
    if (len > 0) { const fl = new FixedLengthStream(len); resp.body.pipeTo(fl.writable); obj = await c.env.DATOS.put(clave, fl.readable, { httpMetadata: { contentType: tipo }, customMetadata: { origen: url } }); }
    else obj = await c.env.DATOS.put(clave, await resp.arrayBuffer(), { httpMetadata: { contentType: tipo }, customMetadata: { origen: url } });
    if (!obj) throw new ErrorHttp(502, "no se pudo guardar en R2");
    // el INEGI corta descargas bajo carga: si lo guardado no mide lo anunciado, se borra y se reporta
    if (len > 0 && obj.size !== len) { await c.env.DATOS.delete(clave); throw new ErrorHttp(502, `descarga incompleta del INEGI: ${obj.size} de ${len} bytes`); }
    return { clave, bytes: obj.size, etag: obj.httpEtag, existia: false, ms: Date.now() - t0 };
  }
}

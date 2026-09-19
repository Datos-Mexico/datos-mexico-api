// Límite de peticiones por minuto, por dirección IP y por ruta, con los mismos cupos que el
// legacy (slowapi, por endpoint) y el mismo cuerpo de respuesta 429.
import type { MiddlewareHandler } from "hono";
import type { Env } from "../index";
import { respuestaError } from "./errores";

// Cupo por ruta exacta; las rutas con parámetro de ruta se resuelven por prefijo. Todo lo demás bajo /api/v1: 60/min.
const CUPOS: Record<string, number> = {
  "/api/v1/consar/recursos/totales": 30, "/api/v1/consar/recursos/por-afore": 30, "/api/v1/consar/recursos/por-componente": 30,
  "/api/v1/consar/recursos/imss-vs-issste": 30, "/api/v1/consar/recursos/composicion": 30, "/api/v1/consar/recursos/serie": 30,
  "/api/v1/consar/comisiones/serie": 30, "/api/v1/consar/comisiones/snapshot": 30, "/api/v1/consar/flujos/serie": 30, "/api/v1/consar/flujos/snapshot": 30,
  "/api/v1/consar/traspasos/serie": 30, "/api/v1/consar/traspasos/snapshot": 30, "/api/v1/consar/activo-neto/snapshot": 30,
  "/api/v1/consar/rendimientos/snapshot": 30, "/api/v1/consar/medidas/snapshot": 30, "/api/v1/consar/cuentas/snapshot": 30,
  "/api/v1/consar/precios/snapshot": 30, "/api/v1/consar/precios/comparativo": 30, "/api/v1/consar/precios-gestion/snapshot": 30,
  "/api/v1/consar/precios-gestion/comparativo": 30,
  "/api/v1/enigh/validaciones": 30, "/api/v1/enigh/hogares/by-decil": 30, "/api/v1/enigh/hogares/by-entidad": 30, "/api/v1/enigh/poblacion/demographics": 30,
  "/api/v1/enigh/gastos/by-rubro": 30, "/api/v1/enigh/actividad/agro": 30, "/api/v1/enigh/actividad/noagro": 30, "/api/v1/enigh/actividad/jcf": 30,
  "/api/v1/comparativo/ingreso/cdmx-vs-nacional": 30, "/api/v1/comparativo/actividad-cdmx-vs-nacional": 30, "/api/v1/comparativo/bancarizacion": 30,
  "/api/v1/comparativo/decil-servidores-cdmx": 20, "/api/v1/comparativo/aportes-vs-jubilaciones-actuales": 20, "/api/v1/comparativo/gastos/cdmx-vs-nacional": 20, "/api/v1/comparativo/top-vs-bottom": 20,
  "/api/v1/servidores/": 30, "/api/v1/servidores/stats": 15,
  "/api/v1/sectores/": 30, "/api/v1/sectores/compare": 15,
  "/api/v1/dashboard/stats": 10,
  "/api/v1/analytics/puestos/ranking": 20, "/api/v1/analytics/sectores/ranking": 20, "/api/v1/analytics/brecha-edad": 20,
  "/api/v1/personas/": 30, "/api/v1/nombramientos/": 30,
  "/api/v1/export/csv": 5,
  "/api/v1/enoe/indicadores/nacional/serie": 30, "/api/v1/enoe/indicadores/nacional/snapshot": 30, "/api/v1/enoe/indicadores/entidad/serie": 30, "/api/v1/enoe/indicadores/entidad/snapshot": 30, "/api/v1/enoe/indicadores/entidad/ranking": 30,
  "/api/v1/enoe/ocupados/por-sector/snapshot": 30, "/api/v1/enoe/ocupados/por-sector/serie": 30, "/api/v1/enoe/ocupados/por-posicion/snapshot": 30, "/api/v1/enoe/ocupados/por-posicion/serie": 30,
};
function cupo(ruta: string): number {
  if (ruta in CUPOS) return CUPOS[ruta];
  if (/^\/api\/v1\/sectores\/[^/]+\/stats$/.test(ruta)) return 30;
  if (/^\/api\/v1\/enoe\/microdatos\/[^/]+\/list$/.test(ruta)) return 10;
  if (/^\/api\/v1\/enoe\/microdatos\/[^/]+\/count$/.test(ruta)) return 30;
  if (/^\/api\/v1\/inegi\/indicadores\/[^/]+\/observaciones$/.test(ruta)) return 30;
  return 60;
}

export const limitarPeticiones: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const ruta = new URL(c.req.url).pathname;
  const ip = c.req.header("cf-connecting-ip") ?? "desconocida";
  const n = cupo(ruta);
  const limitador = n === 5 ? c.env.RL_5 : n === 10 ? c.env.RL_10 : n === 15 ? c.env.RL_15 : n === 20 ? c.env.RL_20 : n === 30 ? c.env.RL_30 : c.env.RL_60;
  if (limitador) {
    const { success } = await limitador.limit({ key: `${ip}:${ruta}` });
    if (!success) return respuestaError(429, "Rate limit exceeded. Try again later.");
  }
  await next();
};

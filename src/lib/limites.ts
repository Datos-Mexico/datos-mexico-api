// Límite de peticiones por minuto, por dirección IP y por ruta, con los mismos cupos que el
// legacy (slowapi: 60/minute o 30/minute según endpoint) y el mismo cuerpo de respuesta 429.
import type { MiddlewareHandler } from "hono";
import type { Env } from "../index";
import { respuestaError } from "./errores";

// Rutas con cupo de 30 por minuto; todo lo demás bajo /api/v1 usa 60 por minuto.
const RUTAS_30 = new Set([
  "/api/v1/consar/recursos/totales", "/api/v1/consar/recursos/por-afore", "/api/v1/consar/recursos/por-componente",
  "/api/v1/consar/recursos/imss-vs-issste", "/api/v1/consar/recursos/composicion", "/api/v1/consar/recursos/serie",
  "/api/v1/consar/comisiones/serie", "/api/v1/consar/comisiones/snapshot", "/api/v1/consar/flujos/serie", "/api/v1/consar/flujos/snapshot",
  "/api/v1/consar/traspasos/serie", "/api/v1/consar/traspasos/snapshot", "/api/v1/consar/activo-neto/snapshot",
  "/api/v1/consar/rendimientos/snapshot", "/api/v1/consar/medidas/snapshot", "/api/v1/consar/cuentas/snapshot",
  "/api/v1/consar/precios/snapshot", "/api/v1/consar/precios/comparativo", "/api/v1/consar/precios-gestion/snapshot",
  "/api/v1/consar/precios-gestion/comparativo",
  "/api/v1/enigh/validaciones", "/api/v1/enigh/hogares/by-decil", "/api/v1/enigh/hogares/by-entidad", "/api/v1/enigh/poblacion/demographics",
  "/api/v1/enigh/gastos/by-rubro", "/api/v1/enigh/actividad/agro", "/api/v1/enigh/actividad/noagro", "/api/v1/enigh/actividad/jcf",
]);

export const limitarPeticiones: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const ruta = new URL(c.req.url).pathname;
  const ip = c.req.header("cf-connecting-ip") ?? "desconocida";
  const limitador = RUTAS_30.has(ruta) ? c.env.RL_30 : c.env.RL_60;
  if (limitador) {
    const { success } = await limitador.limit({ key: `${ip}:${ruta}` });
    if (!success) return respuestaError(429, "Rate limit exceeded. Try again later.");
  }
  await next();
};

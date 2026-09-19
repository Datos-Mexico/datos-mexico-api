import { Hono } from "hono";
import { cors } from "hono/cors";
import { fromHono } from "chanfana";
import { DESCRIPCION, TITULO, VERSION } from "./descripcion";
import type { Context } from "hono";
import { Salud } from "./endpoints/salud";
import { Afores, TiposRecurso } from "./consar/catalogos";

export type Env = {
  DB_CONSAR: D1Database;
};
export type AppContext = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();
app.use("*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] }));

const openapi = fromHono(app, {
  docs_url: "/docs",
  redoc_url: "/redoc",
  openapi_url: "/openapi.json",
  openapiVersion: "3.1",
  generateOperationIds: true,
  schema: {
    info: {
      title: TITULO,
      version: VERSION,
      description: DESCRIPCION,
      contact: { name: "Observatorio Datos México", url: "https://datosmexico.org", email: "equipo@datosmexico.org" },
      license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
    },
    servers: [{ url: "https://api.datosmexico.org", description: "Producción" }],
  },
});

openapi.get("/health", Salud);
openapi.get("/api/v1/consar/afores", Afores);
openapi.get("/api/v1/consar/tipos-recurso", TiposRecurso);
app.get("/", (c) => c.redirect("/docs", 302));

export default app;

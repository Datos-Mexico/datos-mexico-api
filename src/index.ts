import { Hono } from "hono";
import { cors } from "hono/cors";
import { fromHono } from "chanfana";
import { ZodError } from "zod";
import { HTTPException } from "hono/http-exception";
import { DESCRIPCION, TITULO, VERSION } from "./descripcion";
import type { Context } from "hono";
import { Salud } from "./endpoints/salud";
import { Afores, TiposRecurso } from "./consar/catalogos";
import { RecursosComposicion, RecursosImssVsIssste, RecursosPorAfore, RecursosPorComponente, RecursosSerie, RecursosTotales } from "./consar/recursos";
import { ComisionesSerie, ComisionesSnapshot, FlujosSerie, FlujosSnapshot, PeaCotizantesSerie, TraspasosSerie, TraspasosSnapshot } from "./consar/flujos";
import { ActivoNetoAgregado, ActivoNetoSerie, ActivoNetoSnapshot, RendimientosSerie, RendimientosSistema, RendimientosSnapshot } from "./consar/activo_rendimiento";
import { CuentasSerie, CuentasSistema, CuentasSnapshot, MedidasSerie, MedidasSnapshot, MetricasCuenta, MetricasSensibilidad } from "./consar/medidas_cuentas";
import { PreciosComparativo, PreciosGestionComparativo, PreciosGestionSerie, PreciosGestionSnapshot, PreciosSerie, PreciosSnapshot } from "./consar/precios";
import { ActividadAgro, ActividadJcf, ActividadNoagro, EnighMetadataEndpoint, EnighValidaciones, GastosByRubro, HogaresByDecil, HogaresByEntidad, HogaresSummaryEndpoint, PoblacionDemographics } from "./enigh/endpoints";
import { ActividadCdmxVsNacional, AportesVsJubilaciones, Bancarizacion, DecilServidoresCdmx, GastosCdmxVsNacional, IngresoCdmxVsNacional, TopVsBottom } from "./comparativo/endpoints";
import { ExportCsv, ServidorDetalle, ServidoresLista, ServidoresStats } from "./cdmx/servidores";
import { CatNivelesSalariales, CatPuestos, CatSectores, CatSexos, CatTiposContratacion, CatTiposNomina, CatTiposPersonal, CatUniversos, SectorStats, SectoresCompare, SectoresLista } from "./cdmx/sectores_catalogos";
import { BrechaEdad, DashboardStatsEndpoint, PuestosRanking, SectoresRanking } from "./cdmx/dashboard_analytics";
import { NombramientoDetalle, NombramientosLista, PersonaDetalle, PersonasLista } from "./cdmx/personas_nombramientos";
import { cacheControl } from "./lib/cache";
import { CatalogoEntidades, CatalogoEtapas, CatalogoIndicadores, EnoeHealthEndpoint, EnoeMetadataEndpoint, EntidadRanking, EntidadSerie, EntidadSnapshot, NacionalSerie, NacionalSnapshot, PosicionSerie, PosicionSnapshot, SectorSerie, SectorSnapshot } from "./enoe/endpoints";
import { CatalogoDatasets, CatalogoEsquema } from "./catalogo/endpoints";
import { MicrodatosCount, MicrodatosList, MicrodatosSchema } from "./enoe/microdatos";
import { ErrorHttp, respuestaError } from "./lib/errores";
import { limitarPeticiones } from "./lib/limites";

export type Env = {
  DB_CONSAR: D1Database;
  DB_ENIGH: D1Database;
  DB_CDMX: D1Database;
  DB_ENOE: D1Database;
  DATOS: R2Bucket;
  HYPERDRIVE: Hyperdrive;
  RL_5: RateLimit;
  RL_10: RateLimit;
  RL_15: RateLimit;
  RL_20: RateLimit;
  RL_30: RateLimit;
  RL_60: RateLimit;
};
export type AppContext = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();
app.use("*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] }));
app.use("/api/v1/*", limitarPeticiones);
app.use("/api/v1/*", cacheControl);

// chanfana recorta la barra final de las rutas de colección en el documento OpenAPI; el legacy las publica con barra.
const CON_BARRA = ["/api/v1/servidores", "/api/v1/sectores", "/api/v1/personas", "/api/v1/nombramientos"];
app.use("/openapi.json", async (c, next) => {
  await next();
  const doc = (await c.res.clone().json()) as { paths: Record<string, unknown> };
  const paths: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.paths)) paths[CON_BARRA.includes(k) ? k + "/" : k] = v;
  c.res = new Response(JSON.stringify({ ...doc, paths }), { status: c.res.status, headers: c.res.headers });
});

const openapi = fromHono(app, {
  docs_url: "/docs",
  redoc_url: "/redoc",
  openapi_url: "/openapi.json",
  openapiVersion: "3.1",
  generateOperationIds: true,
  raiseOnError: true,
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
openapi.get("/api/v1/catalogo/datasets", CatalogoDatasets);
openapi.get("/api/v1/catalogo/datasets/:dataset/esquema", CatalogoEsquema);
openapi.get("/api/v1/consar/afores", Afores);
openapi.get("/api/v1/consar/tipos-recurso", TiposRecurso);
openapi.get("/api/v1/consar/recursos/totales", RecursosTotales);
openapi.get("/api/v1/consar/recursos/por-afore", RecursosPorAfore);
openapi.get("/api/v1/consar/recursos/por-componente", RecursosPorComponente);
openapi.get("/api/v1/consar/recursos/imss-vs-issste", RecursosImssVsIssste);
openapi.get("/api/v1/consar/recursos/composicion", RecursosComposicion);
openapi.get("/api/v1/consar/recursos/serie", RecursosSerie);
openapi.get("/api/v1/consar/comisiones/serie", ComisionesSerie);
openapi.get("/api/v1/consar/comisiones/snapshot", ComisionesSnapshot);
openapi.get("/api/v1/consar/flujos/serie", FlujosSerie);
openapi.get("/api/v1/consar/flujos/snapshot", FlujosSnapshot);
openapi.get("/api/v1/consar/traspasos/serie", TraspasosSerie);
openapi.get("/api/v1/consar/traspasos/snapshot", TraspasosSnapshot);
openapi.get("/api/v1/consar/pea-cotizantes/serie", PeaCotizantesSerie);
openapi.get("/api/v1/consar/activo-neto/serie", ActivoNetoSerie);
openapi.get("/api/v1/consar/activo-neto/snapshot", ActivoNetoSnapshot);
openapi.get("/api/v1/consar/activo-neto/agregado", ActivoNetoAgregado);
openapi.get("/api/v1/consar/rendimientos/serie", RendimientosSerie);
openapi.get("/api/v1/consar/rendimientos/snapshot", RendimientosSnapshot);
openapi.get("/api/v1/consar/rendimientos/sistema", RendimientosSistema);
openapi.get("/api/v1/consar/metricas-sensibilidad", MetricasSensibilidad);
openapi.get("/api/v1/consar/medidas/serie", MedidasSerie);
openapi.get("/api/v1/consar/medidas/snapshot", MedidasSnapshot);
openapi.get("/api/v1/consar/metricas-cuenta", MetricasCuenta);
openapi.get("/api/v1/consar/cuentas/serie", CuentasSerie);
openapi.get("/api/v1/consar/cuentas/snapshot", CuentasSnapshot);
openapi.get("/api/v1/consar/cuentas/sistema", CuentasSistema);
openapi.get("/api/v1/consar/precios/serie", PreciosSerie);
openapi.get("/api/v1/consar/precios/snapshot", PreciosSnapshot);
openapi.get("/api/v1/consar/precios/comparativo", PreciosComparativo);
openapi.get("/api/v1/consar/precios-gestion/serie", PreciosGestionSerie);
openapi.get("/api/v1/consar/precios-gestion/snapshot", PreciosGestionSnapshot);
openapi.get("/api/v1/consar/precios-gestion/comparativo", PreciosGestionComparativo);
openapi.get("/api/v1/enigh/metadata", EnighMetadataEndpoint);
openapi.get("/api/v1/enigh/validaciones", EnighValidaciones);
openapi.get("/api/v1/enigh/hogares/summary", HogaresSummaryEndpoint);
openapi.get("/api/v1/enigh/hogares/by-decil", HogaresByDecil);
openapi.get("/api/v1/enigh/hogares/by-entidad", HogaresByEntidad);
openapi.get("/api/v1/enigh/poblacion/demographics", PoblacionDemographics);
openapi.get("/api/v1/enigh/gastos/by-rubro", GastosByRubro);
openapi.get("/api/v1/enigh/actividad/agro", ActividadAgro);
openapi.get("/api/v1/enigh/actividad/noagro", ActividadNoagro);
openapi.get("/api/v1/enigh/actividad/jcf", ActividadJcf);
openapi.get("/api/v1/comparativo/ingreso/cdmx-vs-nacional", IngresoCdmxVsNacional);
openapi.get("/api/v1/comparativo/decil-servidores-cdmx", DecilServidoresCdmx);
openapi.get("/api/v1/comparativo/aportes-vs-jubilaciones-actuales", AportesVsJubilaciones);
openapi.get("/api/v1/comparativo/actividad-cdmx-vs-nacional", ActividadCdmxVsNacional);
openapi.get("/api/v1/comparativo/gastos/cdmx-vs-nacional", GastosCdmxVsNacional);
openapi.get("/api/v1/comparativo/bancarizacion", Bancarizacion);
openapi.get("/api/v1/comparativo/top-vs-bottom", TopVsBottom);
// CDMX: servidores, sectores, catálogos, dashboard, analytics, personas, nombramientos, export
openapi.get("/api/v1/servidores/", ServidoresLista);
openapi.get("/api/v1/servidores/stats", ServidoresStats);
openapi.get("/api/v1/servidores/:servidor_id", ServidorDetalle);
openapi.get("/api/v1/sectores/", SectoresLista);
openapi.get("/api/v1/sectores/compare", SectoresCompare);
openapi.get("/api/v1/sectores/:sector_id/stats", SectorStats);
openapi.get("/api/v1/catalogos/tipos-contratacion", CatTiposContratacion);
openapi.get("/api/v1/catalogos/tipos-personal", CatTiposPersonal);
openapi.get("/api/v1/catalogos/tipos-nomina", CatTiposNomina);
openapi.get("/api/v1/catalogos/universos", CatUniversos);
openapi.get("/api/v1/catalogos/sectores", CatSectores);
openapi.get("/api/v1/catalogos/sexos", CatSexos);
openapi.get("/api/v1/catalogos/niveles-salariales", CatNivelesSalariales);
openapi.get("/api/v1/catalogos/puestos", CatPuestos);
openapi.get("/api/v1/dashboard/stats", DashboardStatsEndpoint);
openapi.get("/api/v1/analytics/puestos/ranking", PuestosRanking);
openapi.get("/api/v1/analytics/sectores/ranking", SectoresRanking);
openapi.get("/api/v1/analytics/brecha-edad", BrechaEdad);
openapi.get("/api/v1/personas/", PersonasLista);
openapi.get("/api/v1/personas/:persona_id", PersonaDetalle);
openapi.get("/api/v1/nombramientos/", NombramientosLista);
openapi.get("/api/v1/nombramientos/:nombramiento_id", NombramientoDetalle);
openapi.get("/api/v1/export/csv", ExportCsv);
// ENOE (agregados; los microdatos van a R2 en otra fase)
openapi.get("/api/v1/enoe/health", EnoeHealthEndpoint);
openapi.get("/api/v1/enoe/metadata", EnoeMetadataEndpoint);
openapi.get("/api/v1/enoe/catalogos/indicadores", CatalogoIndicadores);
openapi.get("/api/v1/enoe/catalogos/entidades", CatalogoEntidades);
openapi.get("/api/v1/enoe/catalogos/etapas-metodologicas", CatalogoEtapas);
openapi.get("/api/v1/enoe/indicadores/nacional/serie", NacionalSerie);
openapi.get("/api/v1/enoe/indicadores/nacional/snapshot", NacionalSnapshot);
openapi.get("/api/v1/enoe/indicadores/entidad/serie", EntidadSerie);
openapi.get("/api/v1/enoe/indicadores/entidad/snapshot", EntidadSnapshot);
openapi.get("/api/v1/enoe/indicadores/entidad/ranking", EntidadRanking);
openapi.get("/api/v1/enoe/ocupados/por-sector/snapshot", SectorSnapshot);
openapi.get("/api/v1/enoe/ocupados/por-sector/serie", SectorSerie);
openapi.get("/api/v1/enoe/ocupados/por-posicion/snapshot", PosicionSnapshot);
openapi.get("/api/v1/enoe/ocupados/por-posicion/serie", PosicionSerie);
openapi.get("/api/v1/enoe/microdatos/:tabla/list", MicrodatosList);
openapi.get("/api/v1/enoe/microdatos/:tabla/count", MicrodatosCount);
openapi.get("/api/v1/enoe/microdatos/:tabla/schema", MicrodatosSchema);
// Rutas de colección sin barra final: 307 hacia la ruta con barra, como Starlette.
for (const col of ["servidores", "sectores", "personas", "nombramientos"]) {
  app.get(`/api/v1/${col}`, (c) => { const u = new URL(c.req.url); u.pathname += "/"; return c.redirect(u.toString(), 307); });
}
app.get("/", (c) => c.redirect("/docs", 302));

app.onError(async (err, c) => {
  if (err instanceof ErrorHttp) return respuestaError(err.status, err.detail);
  // chanfana envuelve los errores de validación en una HTTPException de Hono cuyo cuerpo
  // trae {errors:[{code,message,path}]}. Se traduce a la forma de FastAPI (422, lista type/loc/msg/input).
  if (err instanceof HTTPException && err.res) {
    type CuerpoChanfana = { errors?: { message: string; path: string[] }[] };
    let cuerpo: CuerpoChanfana | null = null;
    try { cuerpo = (await err.res.clone().json()) as CuerpoChanfana; } catch { cuerpo = null; }
    if (cuerpo?.errors) {
      const detalles = cuerpo.errors.map((e) => {
        const faltante = /received undefined|required/i.test(e.message);
        return { type: faltante ? "missing" : "value_error", loc: e.path, msg: faltante ? "Field required" : e.message, input: null };
      });
      return respuestaError(422, detalles);
    }
    return err.res;
  }
  if (err instanceof ZodError) {
    const detalles = err.issues.map((i) => ({ type: "value_error", loc: i.path.map(String), msg: i.message, input: null }));
    return respuestaError(422, detalles);
  }
  console.error(err);
  return respuestaError(500, "Internal Server Error");
});

export default app;

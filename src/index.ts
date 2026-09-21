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
import { InegiCatalogo, InegiArbol, InegiIndicador, InegiIndicadores, InegiObservaciones, InegiResumen } from "./inegi/endpoints";
import { DatosAbiertosDescarga, DatosAbiertosPrograma, DatosAbiertosProgramas, DatosAbiertosResumen, DatosAbiertosTabulados } from "./inegi/datos_abiertos";
import { DenueActividades, DenueCerca, DenueResumen, DenueUnidad, DenueUnidades } from "./denue/endpoints";
import { CensoIndicador, CensoIndicadores, CensoLocalidad, CensoLocalidades, CensoResumen } from "./censo2020/endpoints";
import { AuthMe, AuthRegister, AuthToken } from "./auth/endpoints";
import { ErrataBorrar, ErrataDetalle, ErrataReportar, ErrataRevisar, ErratasLista } from "./erratas/endpoints";
import { DemoBorrar, DemoCrear, DemoEditar, DemoEstudiante, DemoEstudiantes, DemoReset, DemoResumen, DemoToggleBono } from "./demo/endpoints";
import { AdminRefrescarTablero } from "./cdmx/operacion";
import { AdminEspejo } from "./admin/espejo";
import { MicrodatosCount, MicrodatosList, MicrodatosSchema } from "./enoe/microdatos";
import { AnuiesAgregado, AnuiesCiclos, AnuiesColumnas, AnuiesDescarga, AnuiesEdades, AnuiesInstitucion, AnuiesInstituciones, AnuiesPrograma, AnuiesProgramas, AnuiesProcedencia, AnuiesResumen, AnuiesSerie, AnuiesValores } from "./anuies/endpoints";
import { UnamAnuarioAgregado, UnamAnuarioCampos, UnamAnuarioCarreras, UnamAnuarioEdades, UnamAnuarioNiveles, UnamAnuarioPlanteles, UnamAnuarioProcedencia, UnamAnuarioSerie, UnamConcursoArchivos, UnamConcursoDistribucion, UnamConcursoEncabezados, UnamConcursoTabla, UnamConcursoUniverso, UnamDescarga, UnamResumen } from "./unam/endpoints";
import { CuboDatos, CuboFicha, CuboMiembros, CubosCatalogo } from "./cubos/endpoints";
import { ErrorHttp, respuestaError } from "./lib/errores";
import { limitarPeticiones } from "./lib/limites";

export type Env = {
  DB_CONSAR: D1Database;
  DB_ENIGH: D1Database;
  DB_CDMX: D1Database;
  DB_ENOE: D1Database;
  DB_BISE: D1Database;
  DB_DENUE: D1Database;
  DB_CENSO2020: D1Database;
  DB_PLATAFORMA: D1Database;
  DB_ANUIES: D1Database;
  DB_UNAM: D1Database;
  SECRET_KEY: string;
  DATOS: R2Bucket;
  RL_5: RateLimit;
  RL_10: RateLimit;
  RL_15: RateLimit;
  RL_20: RateLimit;
  RL_30: RateLimit;
  RL_60: RateLimit;
  RL_120: RateLimit;
  RL_600: RateLimit;
};
export type AppContext = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();
app.use("*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], exposeHeaders: ["*"] }));
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
      termsOfService: "https://datosmexico.org/privacidad",
    },
    externalDocs: { description: "Modelo institucional del observatorio", url: "https://datosmexico.org/modelo" },
    servers: [{ url: "https://api.datosmexico.org", description: "Producción" }],
    tags: [
      { name: "consar", description: "CONSAR — Sistema de Ahorro para el Retiro: recursos, comisiones, flujos, traspasos, activo neto, rendimientos, cuentas y precios de las SIEFOREs. Fuente: CONSAR vía datos.gob.mx." },
      { name: "enigh", description: "ENIGH 2024 Nueva Serie — microdatos completos y agregados que reproducen el comunicado oficial. Fuente: INEGI." },
      { name: "comparativo", description: "Cruces entre el padrón de servidores públicos de la CDMX y la ENIGH." },
      { name: "servidores", description: "Padrón de remuneraciones de servidores públicos de la Ciudad de México: búsqueda y estadísticas. Solo lectura." },
      { name: "sectores", description: "Sectores del padrón CDMX: lista, estadísticas y comparación." },
      { name: "catalogos", description: "Catálogos del padrón CDMX (sexos, puestos, contratación, personal, nómina, universos, sectores, niveles salariales). Solo lectura." },
      { name: "dashboard", description: "Tablero del padrón CDMX a partir de tablas derivadas (mv_dashboard_*)." },
      { name: "analytics", description: "Rankings y brechas del padrón CDMX." },
      { name: "personas", description: "Personas del padrón CDMX. Solo lectura: las correcciones se reportan en Erratas." },
      { name: "nombramientos", description: "Nombramientos del padrón CDMX. Solo lectura: las correcciones se reportan en Erratas." },
      { name: "export", description: "Exportación CSV del padrón CDMX." },
      { name: "enoe", description: "ENOE 15+ — indicadores laborales trimestrales por entidad y microdatos completos (101.5 millones de filas). Fuente: INEGI." },
      { name: "inegi", description: "Banco de Indicadores del INEGI completo: 31,817 indicadores a nivel nacional, estatal y municipal, al día con la última actualización publicada." },
      { name: "inegi-datos-abiertos", description: "Todos los microdatos y tabulados de la descarga masiva del INEGI: microdatos en Parquet con tipado riguroso y el zip original conservado, tabulados archivados íntegros, todo con manifiesto (SHA-256, filas, esquema) y avance medible contra el inventario oficial." },
      { name: "denue", description: "DENUE — las 6,138,075 unidades económicas del país con sus 42 campos (edición 05/2026). Fuente: INEGI." },
      { name: "censo2020", description: "Censo de Población y Vivienda 2020 — 286 indicadores por localidad, municipio y entidad (ITER); AGEB y manzana en archivos Parquet. Fuente: INEGI." },
      { name: "anuies", description: "Anuario Estadístico de Educación Superior (ANUIES) completo: todas las instituciones del país, 2000-2001 a 2025-2026, programa por programa (matrícula, nuevo ingreso, egresados, lugares, titulados y solicitudes por sexo, edad, discapacidad, lengua indígena y procedencia). Fuente: anuario.anuies.mx." },
      { name: "unam", description: "Todo lo que tenemos de la UNAM: el Concurso de Selección a licenciatura (distribución de aciertos por carrera-plantel, encabezados oficiales, universo, cobertura, cronología; dataset del observatorio, CC BY 4.0) y la UNAM en el Anuario ANUIES ciclo por ciclo." },
      { name: "cubos", description: "Cubos del explorador del observatorio (datosmexico.org/observatorio): una capa uniforme de medidas y dimensiones sobre las bases del catálogo, con consulta agregada en JSON o CSV y una URL que reproduce cada tabla." },
      { name: "catalogo", description: "Qué bases tenemos, hasta cuándo llegan, con qué se verificaron y su esquema. Lo que no está aquí, no lo tenemos." },
      { name: "erratas", description: "Registro público de posibles errores en datos oficiales: quién lo reportó, qué se observó, qué se propone, revisión y edición en que se corrigió. El dato publicado nunca cambia por esta vía." },
      { name: "auth", description: "Autenticación OAuth2 (password flow → JWT). Las cuentas las provisiona el observatorio; el registro público está deshabilitado." },
      { name: "admin", description: "Operación: recálculo de tablas derivadas a partir de las oficiales. Solo administradores." },
      { name: "demo", description: "Demo del curso de Bases de Datos (ITAM, sección 001): tabla pedagógica, no oficial." },
      { name: "demo-admin", description: "Administración de la tabla del curso. Solo administradores." },
    ],
  },
});

openapi.get("/health", Salud);
openapi.get("/api/v1/catalogo/datasets", CatalogoDatasets);
openapi.get("/api/v1/catalogo/datasets/:dataset/esquema", CatalogoEsquema);
// Cubos del explorador (capa declarativa sobre las bases; ver src/cubos/)
openapi.get("/api/v1/cubos", CubosCatalogo);
openapi.get("/api/v1/cubos/:cubo", CuboFicha);
openapi.get("/api/v1/cubos/:cubo/miembros", CuboMiembros);
openapi.get("/api/v1/cubos/:cubo/datos", CuboDatos);
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

// Banco de Indicadores del INEGI (nuevo; no existe en el legacy)
openapi.get("/api/v1/inegi/resumen", InegiResumen);
openapi.get("/api/v1/inegi/indicadores", InegiIndicadores);
openapi.get("/api/v1/inegi/indicadores/:id", InegiIndicador);
openapi.get("/api/v1/inegi/indicadores/:id/observaciones", InegiObservaciones);
openapi.get("/api/v1/inegi/catalogos/:catalogo", InegiCatalogo);
openapi.get("/api/v1/inegi/arbol", InegiArbol);

// Datos abiertos del INEGI ingeridos (microdatos en Parquet + tabulados archivados, con manifiesto)
openapi.get("/api/v1/inegi/datos-abiertos/resumen", DatosAbiertosResumen);
openapi.get("/api/v1/inegi/datos-abiertos/programas", DatosAbiertosProgramas);
openapi.get("/api/v1/inegi/datos-abiertos/programas/:programa_slug", DatosAbiertosPrograma);
openapi.get("/api/v1/inegi/datos-abiertos/tabulados", DatosAbiertosTabulados);
openapi.get("/api/v1/inegi/datos-abiertos/descarga/*", DatosAbiertosDescarga);

// DENUE (Directorio Estadístico Nacional de Unidades Económicas; nuevo)
openapi.get("/api/v1/denue/resumen", DenueResumen);
openapi.get("/api/v1/denue/unidades", DenueUnidades);
openapi.get("/api/v1/denue/unidades/cerca", DenueCerca);
openapi.get("/api/v1/denue/unidades/:id", DenueUnidad);
openapi.get("/api/v1/denue/actividades", DenueActividades);

// Censo de Población y Vivienda 2020, ITER (nuevo)
openapi.get("/api/v1/anuies/resumen", AnuiesResumen);
openapi.get("/api/v1/anuies/ciclos", AnuiesCiclos);
openapi.get("/api/v1/anuies/columnas", AnuiesColumnas);
openapi.get("/api/v1/anuies/valores", AnuiesValores);
openapi.get("/api/v1/anuies/instituciones", AnuiesInstituciones);
openapi.get("/api/v1/anuies/instituciones/:clave", AnuiesInstitucion);
openapi.get("/api/v1/anuies/serie", AnuiesSerie);
openapi.get("/api/v1/anuies/agregado", AnuiesAgregado);
openapi.get("/api/v1/anuies/procedencia", AnuiesProcedencia);
openapi.get("/api/v1/anuies/edades", AnuiesEdades);
openapi.get("/api/v1/anuies/programas", AnuiesProgramas);
openapi.get("/api/v1/anuies/programas/:id", AnuiesPrograma);
openapi.get("/api/v1/anuies/descarga/*", AnuiesDescarga);
openapi.get("/api/v1/unam/resumen", UnamResumen);
openapi.get("/api/v1/unam/concurso/encabezados", UnamConcursoEncabezados);
openapi.get("/api/v1/unam/concurso/distribucion/:anio/:concurso/:carrera_codigo", UnamConcursoDistribucion);
openapi.get("/api/v1/unam/concurso/universo", UnamConcursoUniverso);
openapi.get("/api/v1/unam/concurso/tablas/:tabla", UnamConcursoTabla);
openapi.get("/api/v1/unam/concurso/archivos", UnamConcursoArchivos);
openapi.get("/api/v1/unam/descarga/*", UnamDescarga);
openapi.get("/api/v1/unam/anuario/serie", UnamAnuarioSerie);
openapi.get("/api/v1/unam/anuario/planteles", UnamAnuarioPlanteles);
openapi.get("/api/v1/unam/anuario/carreras", UnamAnuarioCarreras);
openapi.get("/api/v1/unam/anuario/campos", UnamAnuarioCampos);
openapi.get("/api/v1/unam/anuario/niveles", UnamAnuarioNiveles);
openapi.get("/api/v1/unam/anuario/agregado", UnamAnuarioAgregado);
openapi.get("/api/v1/unam/anuario/procedencia", UnamAnuarioProcedencia);
openapi.get("/api/v1/unam/anuario/edades", UnamAnuarioEdades);
openapi.get("/api/v1/censo2020/resumen", CensoResumen);
openapi.get("/api/v1/censo2020/localidades", CensoLocalidades);
openapi.get("/api/v1/censo2020/localidades/:entidad/:mun/:loc", CensoLocalidad);
openapi.get("/api/v1/censo2020/indicadores", CensoIndicadores);
openapi.get("/api/v1/censo2020/indicadores/:columna", CensoIndicador);

// Erratas (registro público de observaciones sobre datos oficiales; las bases oficiales son de solo lectura)
openapi.get("/api/v1/erratas", ErratasLista);
openapi.post("/api/v1/erratas", ErrataReportar);
openapi.get("/api/v1/erratas/:id", ErrataDetalle);
openapi.put("/api/v1/erratas/:id", ErrataRevisar);
openapi.delete("/api/v1/erratas/:id", ErrataBorrar);

// Autenticación (mismo contrato que el legacy)
openapi.post("/api/v1/auth/register", AuthRegister);
openapi.post("/api/v1/auth/token", AuthToken);
openapi.get("/api/v1/auth/me", AuthMe);

// Operación (recalcula tablas derivadas a partir de las oficiales; no modifica datos publicados)
openapi.post("/api/v1/admin/refresh-materialized-views", AdminRefrescarTablero);
openapi.post("/api/v1/admin/espejo", AdminEspejo);

// Demo del curso Bases de Datos (tabla pedagógica, no oficial)
openapi.get("/api/v1/demo/estudiantes", DemoEstudiantes);
openapi.get("/api/v1/demo/resumen", DemoResumen);
openapi.get("/api/v1/demo/estudiantes/:id", DemoEstudiante);
openapi.put("/api/v1/demo/estudiantes/:id/toggle-bono", DemoToggleBono);
openapi.post("/api/v1/admin/demo/estudiantes", DemoCrear);
openapi.put("/api/v1/admin/demo/estudiantes/:id", DemoEditar);
openapi.delete("/api/v1/admin/demo/estudiantes/:id", DemoBorrar);
openapi.post("/api/v1/admin/demo/reset", DemoReset);

// Esquema de seguridad (candado en el Swagger): OAuth2 password flow contra /api/v1/auth/token
openapi.registry.registerComponent("securitySchemes", "OAuth2PasswordBearer", { type: "oauth2", flows: { password: { tokenUrl: "/api/v1/auth/token", scopes: {} } } });
// Rutas de colección sin barra final: 307 hacia la ruta con barra, como Starlette.
for (const col of ["servidores", "sectores", "personas", "nombramientos"]) {
  app.get(`/api/v1/${col}`, (c) => { const u = new URL(c.req.url); u.pathname += "/"; return c.redirect(u.toString(), 307); });
}
app.get("/", (c) => c.redirect("/docs", 302));

app.onError(async (err, c) => {
  if (err instanceof ErrorHttp) return respuestaError(err.status, err.detail, err.headers);
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

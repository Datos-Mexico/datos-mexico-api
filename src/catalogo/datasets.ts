// Catálogo público de datos del observatorio: qué bases tenemos, hasta cuándo llegan y cómo están hechas.
// La metadata curada vive aquí; las cifras (filas, columnas, cortes) se leen en vivo de cada base D1.
import type { Env } from "../index";

export type DatasetDef = {
  clave: string; nombre: string; fuente: string; fuente_url: string; licencia: string; descripcion: string;
  binding: keyof Env; prefijo_api: string; periodicidad: string;
  // consulta que devuelve el corte más reciente contenido en la base (o null si no aplica)
  sql_corte: string | null; unidad_corte: string;
  tablas_excluidas?: RegExp;
  notas: string[];
};

export const DATASETS: DatasetDef[] = [
  {
    clave: "consar", nombre: "CONSAR — Sistema de Ahorro para el Retiro", fuente: "CONSAR vía datos.gob.mx", fuente_url: "https://datos.gob.mx/busca/organization/consar", licencia: "CC-BY-4.0",
    descripcion: "Recursos registrados en el SAR por AFORE y tipo de recurso, comisiones, flujos, traspasos, activo neto, rendimientos, medidas de sensibilidad, cuentas administradas y precios diarios de las SIEFOREs (bolsa y gestión).",
    binding: "DB_CONSAR", prefijo_api: "/api/v1/consar", periodicidad: "mensual (precios: diaria)",
    sql_corte: "SELECT max(fecha) AS corte FROM recursos_mensuales", unidad_corte: "último mes con recursos registrados",
    notas: ["Todas las series se verificaron contra el CSV oficial (identidad contable del sar_total al peso en 100 % de las filas 2020+).", "Los precios diarios llegan a 2025-12-06."],
  },
  {
    clave: "enigh", nombre: "ENIGH 2024 Nueva Serie", fuente: "INEGI", fuente_url: "https://www.inegi.org.mx/programas/enigh/nc/2024/", licencia: "Términos de libre uso INEGI",
    descripcion: "Microdatos completos de la Encuesta Nacional de Ingresos y Gastos de los Hogares 2024 (91,414 hogares muestra, 38.8 millones expandidos) con sus 111 catálogos, más los agregados que reproducen el Comunicado INEGI 112/25 al peso.",
    binding: "DB_ENIGH", prefijo_api: "/api/v1/enigh", periodicidad: "bienal (edición 2024; la siguiente, con datos 2026, se publica en 2027)",
    sql_corte: null, unidad_corte: "edición",
    notas: ["Las tablas anchas (concentradohogar, hogares, poblacion, noagro) se guardan en dos partes por el límite de 100 columnas de D1; la parte 2 lleva el sufijo _2 y la misma llave.", "13 cifras oficiales del Comunicado 112/25 reproducidas: ver /api/v1/enigh/validaciones."],
  },
  {
    clave: "cdmx", nombre: "Servidores públicos de la Ciudad de México", fuente: "Gobierno de la Ciudad de México (padrón de remuneraciones)", fuente_url: "https://datos.cdmx.gob.mx/", licencia: "Datos abiertos CDMX",
    descripcion: "246,845 personas y 246,836 nombramientos del padrón de remuneraciones de la CDMX con sus catálogos (sectores, puestos, tipos de contratación, personal, nómina, universos, niveles salariales).",
    binding: "DB_CDMX", prefijo_api: "/api/v1/servidores", periodicidad: "corte único (snapshot sin fecha de alta/baja)",
    sql_corte: "SELECT max(fecha_ingreso) AS corte FROM nombramientos", unidad_corte: "fecha de ingreso más reciente en el padrón",
    tablas_excluidas: /^mv_/,
    notas: ["Las cinco vistas materializadas del tablero (mv_dashboard_*) se conservan como tablas con el contenido del último refresco del legacy."],
  },
  {
    clave: "enoe", nombre: "ENOE — Encuesta Nacional de Ocupación y Empleo (15+)", fuente: "INEGI", fuente_url: "https://www.inegi.org.mx/programas/enoe/15ymas/", licencia: "Términos de libre uso INEGI",
    descripcion: "13 indicadores laborales trimestrales (nacional y por entidad, 2005T1-2025T1), cortes de ocupados por sector y posición, y catálogos. Los 101.5 millones de filas de microdatos no están en esta base: se publican aparte.",
    binding: "DB_ENOE", prefijo_api: "/api/v1/enoe", periodicidad: "trimestral",
    sql_corte: "SELECT max(periodo) AS corte FROM indicadores_nacionales", unidad_corte: "último trimestre con indicadores",
    notas: ["Gap documental en 2020T2 (ETOE telefónica, sin microdatos).", "Microdatos (viv, hog, sdem, coe1, coe2): 101.5 millones de filas consultables en /api/v1/enoe/microdatos/{tabla}/list, /count y /schema; se sirven desde particiones Parquet por trimestre y entidad en almacenamiento de objetos (paginación por cursor), con los Parquet por trimestre como respaldo permanente."],
  },
  {
    clave: "inegi", nombre: "INEGI — Banco de Indicadores (BISE)", fuente: "INEGI, API de indicadores", fuente_url: "https://www.inegi.org.mx/servicios/api_indicadores.html", licencia: "Términos de libre uso INEGI",
    descripcion: "Los 31,817 indicadores del catálogo oficial del Banco de Indicadores del INEGI con todas sus observaciones a nivel nacional, por entidad federativa y, en los 594 indicadores que el INEGI publica por municipio, para los 2,478 municipios; además, el catálogo de todos los datos abiertos de la descarga masiva del INEGI (4,259 archivos de microdatos de 103 programas convertidos a Parquet con sus originales, y 18,150 tabulados de 183 programas archivados) consultable en /api/v1/inegi/datos-abiertos; más los catálogos de unidades, frecuencias, temas, fuentes, notas y multiplicadores. Cada valor se conserva como lo publica el INEGI (decimal original como texto).",
    binding: "DB_BISE", prefijo_api: "/api/v1/inegi", periodicidad: "la de cada indicador (mensual, trimestral, anual, quinquenal, decenal...)",
    sql_corte: "SELECT max(ultimo_periodo) AS corte FROM indicadores", unidad_corte: "periodo más reciente con observaciones (formato del INEGI)",
    notas: ["Cobertura geográfica: nacional (00), 32 entidades (01-32) y 2,478 municipios (claves de 5 dígitos, Marco Geoestadístico 2025) en los indicadores con datos municipales.", "Los indicadores con con_datos = 0 existen en el catálogo pero no tienen observaciones en ninguno de los tres niveles.", "El INEGI repite algunas observaciones en sus respuestas (36,462 en 300 indicadores el 2026-09-19); se conserva la primera aparición y las repeticiones quedan auditadas fuera de la base.", "Resumen verificable en /api/v1/inegi/resumen."],
  },
  {
    clave: "denue", nombre: "INEGI — DENUE (Directorio Estadístico Nacional de Unidades Económicas)", fuente: "INEGI, descarga masiva por entidad", fuente_url: "https://www.inegi.org.mx/app/descarga/?ti=6", licencia: "Términos de libre uso INEGI",
    descripcion: "Todas las unidades económicas del DENUE de los 32 estados (edición 05/2026) con sus 42 campos originales: nombre, razón social, actividad SCIAN 2018, personal ocupado, domicilio completo, claves geoestadísticas hasta manzana, contacto y coordenadas; más el catálogo de actividades derivado y el diccionario de datos del INEGI.",
    binding: "DB_DENUE", prefijo_api: "/api/v1/denue", periodicidad: "el INEGI publica actualizaciones del directorio dos veces al año",
    sql_corte: "SELECT valor AS corte FROM edicion WHERE clave = 'fecha_diccionario'", unidad_corte: "fecha del diccionario de datos de la edición cargada",
    notas: ["Los campos se conservan tal cual (textos del INEGI, con espacios finales recortados; vacíos como nulos).", "Búsqueda por nombre, actividad, estado, municipio, código postal y cercanía a una coordenada; resumen verificable en /api/v1/denue/resumen."],
  },
  {
    clave: "censo2020", nombre: "INEGI — Censo de Población y Vivienda 2020 (ITER, resultados por localidad)", fuente: "INEGI, datos abiertos del Censo 2020 (4a edición)", fuente_url: "https://www.inegi.org.mx/programas/ccpv/2020/#datos_abiertos", licencia: "Términos de libre uso INEGI",
    descripcion: "Los 286 indicadores del Censo 2020 para las 189,432 localidades del país y sus totales municipales, estatales y nacional (195,662 filas), con el diccionario de datos del INEGI. Los valores protegidos por confidencialidad ('*') y no disponibles ('N/D') se conservan tal cual.",
    binding: "DB_CENSO2020", prefijo_api: "/api/v1/censo2020", periodicidad: "decenal (Censo 2020; el siguiente en 2030)",
    sql_corte: "SELECT '2020' AS corte", unidad_corte: "año censal",
    notas: ["La tabla de 286 columnas se guarda en tres partes (iter, iter_2, iter_3) con la misma llave entidad+mun+loc por el límite de 100 columnas de D1.", "Los resultados por AGEB y manzana urbana (32 archivos) se publican aparte como Parquet en almacenamiento de objetos.", "Resumen verificable en /api/v1/censo2020/resumen (la población total nacional debe ser 126,014,024)."],
  },
];

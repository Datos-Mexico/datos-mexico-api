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
    sql_corte: "SELECT '2024' AS corte", unidad_corte: "año de levantamiento de la edición cargada",
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
    descripcion: "13 indicadores laborales trimestrales (nacional y por entidad, 2005T1-2026T2, recalculados desde los microdatos oficiales y exactos contra el Banco de Indicadores del INEGI), cortes de ocupados por sector y posición, y catálogos. Los 101.5 millones de filas de microdatos no están en esta base: se publican aparte.",
    binding: "DB_ENOE", prefijo_api: "/api/v1/enoe", periodicidad: "trimestral",
    sql_corte: "SELECT max(periodo) AS corte FROM indicadores_nacionales", unidad_corte: "último trimestre con indicadores",
    notas: ["Gap documental en 2020T2 (ETOE telefónica, sin microdatos).", "Microdatos (viv, hog, sdem, coe1, coe2): 101.5 millones de filas consultables en /api/v1/enoe/microdatos/{tabla}/list, /count y /schema; se sirven desde particiones Parquet por trimestre y entidad en almacenamiento de objetos (paginación por cursor), con los Parquet por trimestre como respaldo permanente."],
  },
  {
    clave: "inegi", nombre: "INEGI — Banco de Indicadores (BISE)", fuente: "INEGI, API de indicadores", fuente_url: "https://www.inegi.org.mx/servicios/api_indicadores.html", licencia: "Términos de libre uso INEGI",
    descripcion: "Los 31,817 indicadores del catálogo oficial del Banco de Indicadores del INEGI con todas sus observaciones a nivel nacional, por entidad federativa y, en los 594 indicadores que el INEGI publica por municipio, para los 2,478 municipios; además, el catálogo de todos los datos abiertos de la descarga masiva del INEGI (4,259 archivos de microdatos de 103 programas convertidos a Parquet con sus originales, y 18,150 tabulados de 183 programas archivados) consultable en /api/v1/inegi/datos-abiertos; más los catálogos de unidades, frecuencias, temas, fuentes, notas y multiplicadores. Cada valor se conserva como lo publica el INEGI (decimal original como texto).",
    binding: "DB_BISE", prefijo_api: "/api/v1/inegi", periodicidad: "la de cada indicador (mensual, trimestral, anual, quinquenal, decenal...)",
    sql_corte: "SELECT substr(max(ultima_actualizacion), 1, 10) AS corte FROM indicadores", unidad_corte: "fecha de la última actualización publicada por el INEGI entre todos los indicadores (los periodos llegan hasta 2050 en las proyecciones de población)",
    notas: ["Cobertura geográfica: nacional (00), 32 entidades (01-32) y 2,478 municipios (claves de 5 dígitos, Marco Geoestadístico 2025) en los indicadores con datos municipales.", "Los indicadores con con_datos = 0 existen en el catálogo pero no tienen observaciones en ninguno de los tres niveles.", "El INEGI repite algunas observaciones en sus respuestas (36,462 en 300 indicadores el 2026-09-19); se conserva la primera aparición y las repeticiones quedan auditadas fuera de la base.", "Resumen verificable en /api/v1/inegi/resumen."],
  },
  {
    clave: "denue", nombre: "INEGI — DENUE (Directorio Estadístico Nacional de Unidades Económicas)", fuente: "INEGI, descarga masiva por entidad", fuente_url: "https://www.inegi.org.mx/app/descarga/?ti=6", licencia: "Términos de libre uso INEGI",
    descripcion: "Todas las unidades económicas del DENUE de los 32 estados (edición 05/2026) con sus 42 campos originales: nombre, razón social, actividad SCIAN 2018, personal ocupado, domicilio completo, claves geoestadísticas hasta manzana, contacto y coordenadas; más el catálogo de actividades derivado y el diccionario de datos del INEGI.",
    binding: "DB_DENUE", prefijo_api: "/api/v1/denue", periodicidad: "el INEGI publica actualizaciones del directorio dos veces al año",
    sql_corte: "SELECT substr(valor, 7, 4) || '-' || substr(valor, 4, 2) || '-' || substr(valor, 1, 2) AS corte FROM edicion WHERE clave = 'fecha_diccionario'", unidad_corte: "fecha del diccionario de datos de la edición cargada (el INEGI la publica como dd/mm/aaaa)",
    notas: ["Los campos se conservan tal cual (textos del INEGI, con espacios finales recortados; vacíos como nulos).", "Búsqueda por nombre, actividad, estado, municipio, código postal y cercanía a una coordenada; resumen verificable en /api/v1/denue/resumen."],
  },
  {
    clave: "censo2020", nombre: "INEGI — Censo de Población y Vivienda 2020 (ITER, resultados por localidad)", fuente: "INEGI, datos abiertos del Censo 2020 (4a edición)", fuente_url: "https://www.inegi.org.mx/programas/ccpv/2020/#datos_abiertos", licencia: "Términos de libre uso INEGI",
    descripcion: "Los 286 indicadores del Censo 2020 para las 189,432 localidades del país y sus totales municipales, estatales y nacional (195,662 filas), con el diccionario de datos del INEGI. Los valores protegidos por confidencialidad ('*') y no disponibles ('N/D') se conservan tal cual.",
    binding: "DB_CENSO2020", prefijo_api: "/api/v1/censo2020", periodicidad: "decenal (Censo 2020; el siguiente en 2030)",
    sql_corte: "SELECT '2020' AS corte", unidad_corte: "año censal",
    notas: ["La tabla de 286 columnas se guarda en tres partes (iter, iter_2, iter_3) con la misma llave entidad+mun+loc por el límite de 100 columnas de D1.", "Los resultados por AGEB y manzana urbana (32 archivos) se publican aparte como Parquet en almacenamiento de objetos.", "Resumen verificable en /api/v1/censo2020/resumen (la población total nacional debe ser 126,014,024)."],
  },
  {
    clave: "vitales", nombre: "INEGI — Registros vitales: defunciones registradas 1990-2024 y nacimientos registrados 1985-2024", fuente: "INEGI, microdatos de las Estadísticas de defunciones registradas (EDR) y de nacimientos registrados (ENR), descarga masiva", fuente_url: "https://www.inegi.org.mx/programas/edr/", licencia: "Términos de libre uso INEGI",
    descripcion: "Los 75 archivos anuales de microdatos (120.5 millones de registros) agregados por año de registro, entidad y municipio de residencia, sexo, edad, causa (CIE-10 y lista mexicana, desde 1998), edad de la madre y orden del parto; verificados cada año contra el Banco de Indicadores del INEGI (nacional, entidad y municipio). Los microdatos completos están en /api/v1/inegi/datos-abiertos (programas edr y enr).",
    binding: "DB_VITALES", prefijo_api: "/api/v1/cubos", periodicidad: "anual (el INEGI publica el año anterior hacia octubre)",
    sql_corte: "SELECT MAX(anio_regis) AS corte FROM defunciones_municipio", unidad_corte: "último año de registro cargado",
    notas: ["Todo por lugar de residencia habitual: es la base de las series «registradas» del INEGI; por lugar de registro u ocurrencia las cifras no coinciden.", "Los catálogos de causas (capítulos CIE-10, 59 grupos y 422 causas de la lista mexicana) son los del INEGI 2024, re-decodificados de CP437."],
  },
  {
    clave: "seguridad", nombre: "INEGI — Percepción de inseguridad: ENVIPE 2017-2026 por entidad y ENSU 2016-2026 por ciudad", fuente: "INEGI, microdatos de la ENVIPE (TPer_Vic1) y de la ENSU (CB), descarga masiva", fuente_url: "https://www.inegi.org.mx/programas/envipe/", licencia: "Términos de libre uso INEGI",
    descripcion: "Personas de 18 años y más que consideran inseguro vivir en su colonia, municipio o entidad (ENVIPE, 10 ediciones, por entidad y sexo) y en su ciudad (ENSU, 40 trimestres, hasta 90 ciudades), expandidas con el factor; verificadas contra el Banco de Indicadores (6200118581) y el cuadro 1.7 de los tabulados de junio 2026. Los microdatos completos están en /api/v1/inegi/datos-abiertos (programas envipe y ensu).",
    binding: "DB_SEGURIDAD", prefijo_api: "/api/v1/cubos", periodicidad: "ENVIPE anual (septiembre); ENSU trimestral",
    sql_corte: "SELECT MAX(periodo) AS corte FROM ensu_percepcion", unidad_corte: "último trimestre de la ENSU cargado",
    notas: ["La tasa de prevalencia delictiva de la ENVIPE no se publica: ninguna reconstrucción desde el módulo de victimización reprodujo la cifra oficial (ver la bitácora)."],
  },
  {
    clave: "anuies", nombre: "ANUIES — Anuario Estadístico de Educación Superior (todas las instituciones, 2000-2001 en adelante)", fuente: "ANUIES, consulta interactiva del anuario", fuente_url: "https://anuario.anuies.mx/", licencia: "© ANUIES; datos públicos citados con su fuente",
    descripcion: "Programa por programa (carrera en una escuela o campus de una institución, por nivel y modalidad): matrícula, nuevo ingreso, egresados, lugares ofertados, titulados y solicitudes, por sexo, edad, discapacidad, hablantes de lengua indígena y procedencia del nuevo ingreso. Todas las instituciones del país, ciclo por ciclo desde 2000-2001, con la conciliación de cada ciclo contra el agregado nacional del propio servicio.",
    binding: "DB_ANUIES", prefijo_api: "/api/v1/anuies", periodicidad: "anual (ciclo escolar; ANUIES publica cada anuario al año siguiente)",
    sql_corte: "SELECT max(ciclo) AS corte FROM ciclos", unidad_corte: "último ciclo escolar cargado",
    notas: ["Cada ciclo se descargó íntegro por páginas del servicio de ANUIES y se concilió contra el agregado nacional que el mismo servicio devuelve sin dimensiones (columna conciliacion de /api/v1/anuies/ciclos).", "Por el límite de 100 columnas de D1, las 96 columnas de edad y las 40 de procedencia van en tablas aparte (programas_edad, programas_procedencia) con la misma llave; un Parquet por ciclo en R2 trae las 167 cifras juntas.", "Las claves de columna son las de ANUIES en minúsculas; su título está en /api/v1/anuies/columnas."],
  },
  {
    clave: "unam", nombre: "UNAM — Concurso de Selección a licenciatura (dataset del observatorio)", fuente: "DGAE-UNAM, listados públicos de resultados; reconstrucción del observatorio (repositorio datos-mexico-unam)", fuente_url: "https://datosmexico.org/unam", licencia: "CC BY 4.0",
    descripcion: "La distribución de aciertos por carrera-plantel-concurso de 2018 en adelante, los encabezados oficiales (oferta, aspirantes, presentaron, aciertos mínimos, seleccionados), el universo oficial de carrera-plantel, la cobertura medida y su sesgo, el proceso anual (registrados, sustentantes, seleccionados) y la cronología del caso 2026. Ninguna tabla contiene filas individuales.",
    binding: "DB_UNAM", prefijo_api: "/api/v1/unam", periodicidad: "por concurso (dos al año desde 2021)",
    sql_corte: "SELECT max(anio) AS corte FROM encabezados", unidad_corte: "último año de concurso con encabezados",
    notas: ["Cobertura declarada y no aleatoria: ver /api/v1/unam/concurso/tablas/cobertura y sesgo_cobertura.", "La UNAM en el Anuario ANUIES (matrícula, egreso, titulación, planteles, carreras, procedencia, edades, 2000-2001 en adelante) se sirve en /api/v1/unam/anuario/* desde la base anuies.", "Los CSV, el diccionario y la licencia se descargan tal cual desde /api/v1/unam/concurso/archivos."],
  },
];

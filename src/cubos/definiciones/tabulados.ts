// Tabulados del INEGI explorables (scripts/tabulados_explorables.py; D1 datosmexico-api-tabulados): un cubo por familia de cuadros.
// Cada cuadro publicado en Excel está en formato largo: las categorías de la fila en d1…d5 (su nombre depende del cuadro y
// está en la ficha del cuadro, /api/v1/inegi/tabulados/{familia}/{cuadro}), el encabezado de la columna y el valor. El cubo
// exige filtrar un cuadro: mezclar cuadros no tiene sentido, y dentro de un cuadro las filas «Total» contienen a las demás.
import type { Cubo, Dimension } from "../tipos";

const MEDIDAS = [
  { clave: "valor", titulo: "Valor publicado", sql: "SUM(h.valor)", unidad: "según el cuadro", sumable: false, decimales: 3, descripcion: "La celda tal como la publica el INEGI (conteo, promedio, porcentaje o millones de pesos según el cuadro). Sumar celdas solo tiene sentido dentro de una misma columna y sin mezclar filas de total con sus partes." },
  { clave: "celdas", titulo: "Celdas", sql: "COUNT(*)", unidad: "celdas", sumable: true },
];
const dimCuadro = (familia: string): Dimension => ({ clave: "cuadro", titulo: "Cuadro", id: "h.cuadro", nombre: "c.titulo", tipo: "categorica", orden: "1", miembros: { desde: "tab_cuadros c", id: "c.cuadro", nombre: "c.titulo", donde: `c.familia = '${familia}'`, orden: "c.cuadro" }, descripcion: "Obligatorio: cada cuadro tiene sus propias dimensiones de fila y columnas; la ficha del cuadro las nombra." });
const dimsGenericas = (n: number): Dimension[] => Array.from({ length: n }, (_, i) => ({ clave: `d${i + 1}`, titulo: `Dimensión ${i + 1} de la fila`, id: `h.d${i + 1}`, tipo: "categorica" as const, descripcion: `Categoría ${i + 1} de la fila del cuadro (entidad federativa, sexo, grupo de edad, tamaño de localidad, estimador…): su nombre está en \`dimensiones[${i}]\` de la ficha del cuadro. Vacía cuando el cuadro tiene menos dimensiones.` }));
const dimColumna: Dimension = { clave: "columna", titulo: "Columna del cuadro", id: "h.columna", tipo: "categorica", descripcion: "Encabezado de la columna, con su grupo (p. ej. «Tamaño de localidad › 1-249 habitantes»)." };
const FUENTE = { licencia: "Términos de libre uso INEGI", binding: "DB_TABULADOS" as const };

const censo = (familia: string, nombre: string, descripcion: string, fuente: string, fuente_url: string, cuadro: string, notas: string[], ndim = 4): Cubo => ({
  clave: `tabulados-${familia}`, nombre, tema: "poblacion", fuente, fuente_url, ...FUENTE, descripcion,
  desde: "tab_datos h JOIN tab_cuadros c ON c.familia = h.familia AND c.cuadro = h.cuadro", donde: `h.familia = '${familia}'`,
  medidas: MEDIDAS, dimensiones: [dimCuadro(familia), ...dimsGenericas(ndim), dimColumna],
  predeterminado: { medidas: ["valor"], columnas: ["d1", "columna"], filtros: { cuadro: [cuadro] } },
  sql_corte: `SELECT corte FROM tab_familias WHERE familia = '${familia}'`, filtro_obligatorio: ["cuadro"],
  notas: ["Cada celda es exactamente la del cuadro publicado (control de lectura: celdas numéricas leídas = celdas numéricas de la hoja; el Excel original está en la ficha del cuadro con su SHA-256).", "Las filas de total («Estados Unidos Mexicanos», «Total») contienen a las demás: al agrupar por una dimensión, excluya los totales o filtre las otras dimensiones en su total.", ...notas],
  api_dominio: `/api/v1/inegi/tabulados/${familia}`,
});
const csi = (familia: string, nombre: string, descripcion: string, cuadro: string, lado: string, notas: string[]): Cubo => ({
  clave: `tabulados-${familia}`, nombre, tema: "cuentas-nacionales", fuente: "INEGI — Sistema de Cuentas Nacionales de México, Cuentas por Sectores Institucionales (año base 2018)", fuente_url: "https://www.inegi.org.mx/programas/csi/", ...FUENTE, descripcion,
  desde: "tab_datos h JOIN tab_cuadros c ON c.familia = h.familia AND c.cuadro = h.cuadro", donde: `h.familia = '${familia}'`,
  medidas: [{ ...MEDIDAS[0], unidad: "millones de pesos corrientes" }, MEDIDAS[1]],
  dimensiones: [
    dimCuadro(familia),
    { clave: "cuenta", titulo: "Cuenta", id: "h.d1", tipo: "categorica", descripcion: "Cuenta del sistema (I producción, II.1.1 generación del ingreso, III.1 capital, IV balances…)." },
    { clave: "concepto", titulo: "Concepto", id: "h.d2", tipo: "categorica", descripcion: "Transacción o saldo con su código (P.1 Producción, B.1b Valor agregado bruto, D.1 Remuneraciones…)." },
    { clave: "lado", titulo: "Recursos/pasivos o usos/activos", id: "h.d3", tipo: "categorica" },
    { clave: "sector", titulo: "Sector institucional", id: "h.d4", tipo: "categorica", descripcion: "C.0 bienes y servicios, S.1 economía interna, S.11 sociedades no financieras, S.12 financieras, S.13 gobierno general, S.14 hogares, S.15 ISFLSH, S.2 resto del mundo." },
    { clave: "nivel", titulo: "Nivel jerárquico", id: "h.d5", tipo: "categorica", orden: "CAST(h.d5 AS INTEGER)", descripcion: "Sangría del concepto en el cuadro (los de mayor nivel se suman en el anterior)." },
    { clave: "periodo", titulo: "Periodo", id: "h.columna", tipo: "temporal" },
  ],
  predeterminado: { medidas: ["valor"], columnas: ["concepto", "periodo"], filtros: { cuadro: [cuadro], lado: [lado] } },
  sql_corte: `SELECT corte FROM tab_familias WHERE familia = '${familia}'`, filtro_obligatorio: ["cuadro"],
  notas: ["Cada celda es exactamente la del cuadro publicado (control de lectura: celdas numéricas leídas = celdas numéricas de la hoja; el Excel original está en la ficha del cuadro).", "Los conceptos son jerárquicos: un concepto de nivel n suma sus componentes de nivel n+1; al agrupar, filtre un nivel o un concepto.", ...notas],
  api_dominio: `/api/v1/inegi/tabulados/${familia}`,
});

export const TAB_CENSO2020 = censo("censo2020", "Censo 2020: tabulados básicos", "Los 107 cuadros de los tabulados básicos nacionales y estatales del Censo de Población y Vivienda 2020 (población, fecundidad, mortalidad, migración, etnicidad, discapacidad, educación, características económicas, servicios de salud, situación conyugal, religión, hogares censales y vivienda), celda por celda.", "INEGI — Censo de Población y Vivienda 2020, tabulados del cuestionario básico (nacional y estatal)", "https://www.inegi.org.mx/programas/ccpv/2020/#tabulados", "cpv2020_b_eum_01_poblacion:02", ["Población total 2020: 126 014 024 (cuadro 02 de población; igual al Banco de Indicadores, 1002000001)."]);
export const TAB_INTERCENSAL2015 = censo("intercensal2015", "Encuesta Intercensal 2015: tabulados", "Los 108 cuadros de la Encuesta Intercensal 2015 (población, fecundidad, mortalidad, migración, etnicidad, educación, salud, características económicas, trabajo no remunerado, movilidad cotidiana, situación conyugal, hogares, ingresos, vivienda, suficiencia alimentaria), con su precisión estadística: cada cifra trae valor, error estándar, límites de confianza, coeficiente de variación y efecto de diseño en la dimensión «Estimador».", "INEGI — Encuesta Intercensal 2015, tabulados", "https://www.inegi.org.mx/programas/intercensal/2015/#tabulados", "01_poblacion:02", ["Es una encuesta: use el estimador «Valor» y consulte su coeficiente de variación; las cifras por entidad y grupo tienen error muestral."]);
export const TAB_CENSO2010 = censo("censo2010", "Censo 2010: tabulados básicos estatales", "Los 81 cuadros de los tabulados básicos por entidad federativa del Censo de Población y Vivienda 2010 (población, fecundidad, mortalidad, migración, lengua indígena, discapacidad, educación, características económicas, servicios de salud, situación conyugal, religión, hogares censales y vivienda).", "INEGI — Censo de Población y Vivienda 2010, tabulados del cuestionario básico (estatal)", "https://www.inegi.org.mx/programas/ccpv/2010/#tabulados", "01_02B_ESTATAL", ["Población total 2010: 112 336 538 (cuadro 01_02B; igual al Banco de Indicadores).", "La descarga masiva del INEGI archiva estos cuadros en PDF; el Excel se tomó del mismo sitio (misma ruta con extensión .xls) y se archivó junto al PDF."]);
export const TAB_CONTEO2005 = censo("conteo2005", "II Conteo 2005: tabulados básicos", "Los 37 cuadros de los tabulados básicos nacionales del II Conteo de Población y Vivienda 2005 (población, educación, fecundidad, hogares, lengua indígena, migración, servicios de salud y vivienda).", "INEGI — II Conteo de Población y Vivienda 2005, tabulados básicos", "https://www.inegi.org.mx/programas/ccpv/2005/#tabulados", "Cont2005_NAL_Poblacion:Cont2005_Nal_POB2", ["Población total 2005: 103 263 388 (cuadro POB2; igual al Banco de Indicadores)."], 5);
export const TAB_CSI_ANUAL = csi("csi-anual", "Cuentas por sectores institucionales, anuales 2003-2024", "Serie anual 2003-2024 de las cuentas por sector institucional (bienes y servicios, economía interna y sus cinco sectores, resto del mundo) y la madurez residual de títulos y préstamos, a precios corrientes en millones de pesos, año base 2018.", "CSI_103", "R/P - Recursos/Pasivos", ["Producción total (P.1, C.0 bienes y servicios) 2003: 13 989 250.87 millones de pesos, tal como lo publica el cuadro CSI_100."]);
export const TAB_CSI_TRIMESTRAL = csi("csi-trimestral", "Cuentas por sectores institucionales, trimestrales 2008-2026", "Serie trimestral 2008-2026 (T1-T4, acumulados a 6 y 9 meses y anual) de las cuentas corrientes y de acumulación, cuentas de activos y balances de cierre por sector institucional, a precios corrientes en millones de pesos, año base 2018.", "CSIT_106", "Recursos/Pasivos", ["Los periodos «6 Meses», «9 Meses» y «Anual» son acumulados del año; no se suman con los trimestres."]);
export const TABULADOS = [TAB_CENSO2020, TAB_INTERCENSAL2015, TAB_CENSO2010, TAB_CONTEO2005, TAB_CSI_ANUAL, TAB_CSI_TRIMESTRAL];

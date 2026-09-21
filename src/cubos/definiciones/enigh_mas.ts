// Cubos adicionales de la ENIGH 2024 sobre las tablas que ya están en D1 (personas, viviendas, gastos e ingresos por
// registro): completan el concentrado por hogar (enigh.ts). Verificación: la población expandida (130,325,969), las
// viviendas (38,356,042), el gasto monetario G1 (1,710,635,640,154.41) y el ingreso trimestral (2,602,301,126,844.02)
// reproducen las sumas directas de cada tabla en D1.
import type { Cubo } from "../tipos";

const FUENTE = { fuente: "INEGI — Encuesta Nacional de Ingresos y Gastos de los Hogares 2024, Nueva Serie (microdatos)", fuente_url: "https://www.inegi.org.mx/programas/enigh/nc/2024/", licencia: "Términos de libre uso INEGI" };
const EDAD = "CASE WHEN p.edad IS NULL THEN 'NE' WHEN p.edad < 15 THEN '0-14' WHEN p.edad < 30 THEN '15-29' WHEN p.edad < 45 THEN '30-44' WHEN p.edad < 60 THEN '45-59' WHEN p.edad < 75 THEN '60-74' ELSE '75+' END";

export const ENIGH_PERSONAS: Cubo = {
  clave: "enigh-personas", nombre: "Personas en los hogares (ENIGH 2024)", tema: "ingreso-gasto", ...FUENTE,
  descripcion: "Las personas de los hogares de la ENIGH 2024 expandidas con el factor (130.3 millones), por entidad, sexo, grupo de edad, nivel de escolaridad aprobado, situación conyugal y habla de lengua indígena.",
  binding: "DB_ENIGH", desde: "poblacion p LEFT JOIN cat_entidad e ON e.clave = p.entidad LEFT JOIN cat_sexo sx ON sx.clave = p.sexo LEFT JOIN cat_nivelaprob na ON na.clave = p.nivelaprob LEFT JOIN cat_edo_conyug ec ON ec.clave = p.edo_conyug",
  medidas: [
    { clave: "personas", titulo: "Personas", sql: "SUM(p.factor)", unidad: "personas", sumable: true, descripcion: "Personas expandidas con el factor del hogar (la muestra es de 300,654)." },
    { clave: "personas_muestra", titulo: "Personas en la muestra", sql: "COUNT(*)", unidad: "personas", sumable: true },
    { clave: "edad_promedio", titulo: "Edad promedio", sql: "SUM(p.edad * p.factor) / SUM(p.factor)", unidad: "años", sumable: false, decimales: 1 },
  ],
  dimensiones: [
    { clave: "entidad", titulo: "Entidad", id: "p.entidad", nombre: "e.descripcion", tipo: "geografica", geo: "entidad", orden: "1" },
    { clave: "sexo", titulo: "Sexo", id: "p.sexo", nombre: "sx.descripcion", tipo: "categorica", orden: "1" },
    { clave: "edad", titulo: "Grupo de edad", id: EDAD, tipo: "categorica", orden: "CASE WHEN p.edad IS NULL THEN 99 ELSE p.edad END" },
    { clave: "escolaridad", titulo: "Nivel de escolaridad aprobado", id: "p.nivelaprob", nombre: "na.descripcion", tipo: "categorica", orden: "1", descripcion: "Último nivel aprobado (personas de 3 años y más; en blanco para menores)." },
    { clave: "edo_conyug", titulo: "Situación conyugal", id: "p.edo_conyug", nombre: "ec.descripcion", tipo: "categorica", orden: "1", descripcion: "Personas de 12 años y más." },
    { clave: "hablaind", titulo: "Habla lengua indígena", id: "p.hablaind", nombre: "CASE p.hablaind WHEN '1' THEN 'Sí' WHEN '2' THEN 'No' ELSE 'No aplica (menores de 3 años)' END", tipo: "categorica", orden: "1" },
  ],
  predeterminado: { medidas: ["personas"], columnas: ["edad"] },
  sql_corte: "SELECT '2024' AS corte",
  notas: ["La población expandida de la ENIGH es una estimación de la encuesta (130,325,969 personas en 2024); no es la del Censo ni la de las proyecciones del CONAPO.", "Los promedios se ponderan con el factor y no se suman entre grupos."],
  api_dominio: "/api/v1/enigh",
};

export const ENIGH_VIVIENDAS: Cubo = {
  clave: "enigh-viviendas", nombre: "Viviendas (ENIGH 2024)", tema: "ingreso-gasto", ...FUENTE,
  descripcion: "Las viviendas de la ENIGH 2024 expandidas con el factor (38.4 millones) y sus residentes, por entidad, tipo de vivienda, tenencia, material de los pisos y tamaño de localidad; cuartos y dormitorios promedio.",
  binding: "DB_ENIGH", desde: "viviendas v LEFT JOIN cat_entidad e ON e.clave = substr(v.ubica_geo, 1, 2) LEFT JOIN cat_tipo_viv tv ON tv.clave = v.tipo_viv LEFT JOIN cat_tenencia te ON te.clave = v.tenencia LEFT JOIN cat_mat_pisos mp ON mp.clave = v.mat_pisos LEFT JOIN cat_tam_loc tl ON tl.clave = v.tam_loc",
  medidas: [
    { clave: "viviendas", titulo: "Viviendas", sql: "SUM(v.factor)", unidad: "viviendas", sumable: true },
    { clave: "residentes", titulo: "Residentes", sql: "SUM(v.tot_resid * v.factor)", unidad: "personas", sumable: true },
    { clave: "hogares", titulo: "Hogares", sql: "SUM(v.tot_hog * v.factor)", unidad: "hogares", sumable: true },
    { clave: "cuartos", titulo: "Cuartos promedio", sql: "SUM(v.num_cuarto * v.factor) / SUM(v.factor)", unidad: "cuartos", sumable: false, decimales: 2 },
    { clave: "dormitorios", titulo: "Dormitorios promedio", sql: "SUM(v.cuart_dorm * v.factor) / SUM(v.factor)", unidad: "cuartos", sumable: false, decimales: 2 },
    { clave: "viviendas_muestra", titulo: "Viviendas en la muestra", sql: "COUNT(*)", unidad: "viviendas", sumable: true },
  ],
  dimensiones: [
    { clave: "entidad", titulo: "Entidad", id: "substr(v.ubica_geo, 1, 2)", nombre: "e.descripcion", tipo: "geografica", geo: "entidad", orden: "1" },
    { clave: "tipo_viv", titulo: "Tipo de vivienda", id: "v.tipo_viv", nombre: "tv.descripcion", tipo: "categorica", orden: "1" },
    { clave: "tenencia", titulo: "Tenencia", id: "v.tenencia", nombre: "te.descripcion", tipo: "categorica", orden: "1" },
    { clave: "mat_pisos", titulo: "Material de los pisos", id: "v.mat_pisos", nombre: "mp.descripcion", tipo: "categorica", orden: "1" },
    { clave: "tam_loc", titulo: "Tamaño de localidad", id: "v.tam_loc", nombre: "tl.descripcion", tipo: "categorica", orden: "1" },
  ],
  predeterminado: { medidas: ["viviendas", "residentes"], columnas: ["tenencia"] },
  sql_corte: "SELECT '2024' AS corte",
  notas: ["Viviendas expandidas con su factor; los residentes son los de la vivienda (tot_resid), que incluyen a todos los hogares que la habitan."],
  api_dominio: "/api/v1/enigh",
};

export const ENIGH_GASTOS: Cubo = {
  clave: "enigh-gastos", nombre: "Gasto de los hogares por rubro (ENIGH 2024)", tema: "ingreso-gasto", ...FUENTE,
  descripcion: "El gasto trimestral de los hogares registro por registro (5.3 millones de registros), expandido con el factor, por entidad, tipo de gasto (monetario, para otro hogar, autoconsumo, regalos, transferencias, alquiler estimado) y clave de gasto (1,055 rubros del catálogo del INEGI).",
  // Sobre gastos_resumen: los 5,311,497 registros de gastoshogar agregados dentro de D1 por entidad × tipo × clave (32
  // INSERT … SELECT, uno por entidad; SUM(registros) = COUNT(*) de gastoshogar y el G1 idéntico al peso, verificado al
  // crearla): agrupar la tabla completa en cada consulta tardaba 19 s.
  binding: "DB_ENIGH", desde: "gastos_resumen g LEFT JOIN cat_entidad e ON e.clave = g.entidad LEFT JOIN cat_tipo_gasto tg ON tg.clave = g.tipo_gasto LEFT JOIN cat_gastos cg ON cg.clave = g.clave",
  medidas: [
    { clave: "gasto", titulo: "Gasto trimestral (expandido)", sql: "SUM(g.gasto_tri)", unidad: "pesos (trimestre)", sumable: true, decimales: 0, descripcion: "Gasto trimestral monetario de todos los hogares del grupo (gasto_tri × factor). Los tipos G3, G5 y G7 no tienen gasto monetario y suman cero: su valor está en el gasto no monetario." },
    { clave: "gasto_no_monetario", titulo: "Gasto trimestral no monetario (expandido)", sql: "SUM(g.gas_nm_tri)", unidad: "pesos (trimestre)", sumable: true, decimales: 0 },
    { clave: "registros", titulo: "Registros de gasto", sql: "SUM(g.registros)", unidad: "registros", sumable: true },
  ],
  dimensiones: [
    { clave: "entidad", titulo: "Entidad", id: "g.entidad", nombre: "e.descripcion", tipo: "geografica", geo: "entidad", orden: "1" },
    { clave: "tipo_gasto", titulo: "Tipo de gasto", id: "g.tipo_gasto", nombre: "tg.descripcion", tipo: "categorica", orden: "1" },
    { clave: "rubro", titulo: "Clave de gasto", id: "g.clave", nombre: "cg.descripcion", tipo: "categorica", orden: "1", descripcion: "Las 1,055 claves del catálogo de gastos de la ENIGH (búsqueda por nombre en /miembros)." },
  ],
  predeterminado: { medidas: ["gasto"], columnas: ["tipo_gasto"] },
  sql_corte: "SELECT '2024' AS corte",
  notas: ["El gasto monetario G1 de este cubo (1.71 billones de pesos trimestrales) es una parte del gasto monetario del concentrado por hogar (1.85 billones), que suma además los gastos de las personas (gastospersona) y otras erogaciones.", "Pesos de 2024, trimestrales, sin deflactar."],
  api_dominio: "/api/v1/enigh",
};

export const ENIGH_INGRESOS: Cubo = {
  clave: "enigh-ingresos", nombre: "Ingresos de los hogares por fuente (ENIGH 2024)", tema: "ingreso-gasto", ...FUENTE,
  descripcion: "El ingreso trimestral de las personas de los hogares por fuente (83 claves: sueldos, negocios, rentas, jubilaciones, becas, remesas, programas sociales…), expandido con el factor, por entidad.",
  binding: "DB_ENIGH", desde: "ingresos i LEFT JOIN cat_entidad e ON e.clave = i.entidad LEFT JOIN cat_ingresos_cat ci ON ci.clave = i.clave",
  medidas: [
    { clave: "ingreso", titulo: "Ingreso trimestral (expandido)", sql: "SUM(i.ing_tri * i.factor)", unidad: "pesos (trimestre)", sumable: true, decimales: 0 },
    { clave: "registros", titulo: "Registros de ingreso", sql: "COUNT(*)", unidad: "registros", sumable: true },
  ],
  dimensiones: [
    { clave: "entidad", titulo: "Entidad", id: "i.entidad", nombre: "e.descripcion", tipo: "geografica", geo: "entidad", orden: "1" },
    { clave: "fuente", titulo: "Fuente de ingreso", id: "i.clave", nombre: "ci.descripcion", tipo: "categorica", orden: "1" },
  ],
  predeterminado: { medidas: ["ingreso"], columnas: ["fuente"] },
  sql_corte: "SELECT '2024' AS corte",
  notas: ["La suma de todas las fuentes (2.60 billones de pesos trimestrales) es menor que el ingreso corriente del concentrado por hogar (3.02 billones), que agrega además el alquiler estimado de la vivienda propia y otros ingresos no monetarios.", "Pesos de 2024, trimestrales, sin deflactar."],
  api_dominio: "/api/v1/enigh",
};

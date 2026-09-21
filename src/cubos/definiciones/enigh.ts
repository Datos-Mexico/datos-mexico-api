// Cubo de la ENIGH 2024 (concentrado por hogar): hogares expandidos con el factor, ingresos y gastos trimestrales
// promedio por hogar (ponderados por el factor), por entidad, decil, tamaño de localidad, estrato, clase de hogar y
// sexo de la jefatura. Verificado contra /api/v1/enigh/hogares/by-decil y by-entidad (mismas medias).
import type { Cubo, Medida } from "../tipos";

const prom = (clave: string, titulo: string, col = clave): Medida => ({ clave, titulo, sql: `SUM(h.${col} * h.factor) / SUM(h.factor)`, unidad: "pesos por hogar (trimestre)", sumable: false, decimales: 2, descripcion: "Promedio por hogar ponderado por el factor de expansión." });
const total = (clave: string, titulo: string, col: string): Medida => ({ clave, titulo, sql: `SUM(h.${col} * h.factor)`, unidad: "pesos (trimestre)", sumable: true, decimales: 0, descripcion: "Suma expandida con el factor: el total de los hogares del grupo." });

export const ENIGH_HOGARES: Cubo = {
  clave: "enigh-hogares", nombre: "Ingreso y gasto de los hogares (ENIGH 2024)", tema: "ingreso-gasto", fuente: "INEGI — Encuesta Nacional de Ingresos y Gastos de los Hogares 2024, Nueva Serie", fuente_url: "https://www.inegi.org.mx/programas/enigh/nc/2024/", licencia: "Términos de libre uso INEGI",
  descripcion: "Hogares (expandidos), ingreso corriente y gasto monetario trimestrales por hogar, con sus principales componentes, por entidad, decil de ingreso, tamaño de localidad, estrato socioeconómico, clase de hogar y sexo de la jefatura.",
  binding: "DB_ENIGH", desde: "concentradohogar h LEFT JOIN cat_entidad e ON e.clave = substr(h.ubica_geo, 1, 2) LEFT JOIN cat_tam_loc tl ON tl.clave = h.tam_loc LEFT JOIN cat_est_socio es ON es.clave = h.est_socio LEFT JOIN cat_clase_hog ch ON ch.clave = h.clase_hog LEFT JOIN cat_sexo sx ON sx.clave = h.sexo_jefe",
  medidas: [
    { clave: "hogares", titulo: "Hogares", sql: "SUM(h.factor)", unidad: "hogares", sumable: true, descripcion: "Hogares expandidos con el factor (la muestra es de 91,414)." },
    { clave: "hogares_muestra", titulo: "Hogares en la muestra", sql: "COUNT(*)", unidad: "hogares", sumable: true },
    prom("ing_cor", "Ingreso corriente trimestral promedio"), { ...prom("ing_cor_mensual", "Ingreso corriente mensual promedio", "ing_cor"), sql: "SUM(h.ing_cor * h.factor) / SUM(h.factor) / 3", unidad: "pesos por hogar (mes)" },
    prom("gasto_mon", "Gasto monetario trimestral promedio"), total("ing_cor_total", "Ingreso corriente total (expandido)", "ing_cor"), total("gasto_mon_total", "Gasto monetario total (expandido)", "gasto_mon"),
    prom("ingtrab", "Ingreso del trabajo promedio"), prom("negocio", "Ingreso por negocios propios promedio"), prom("rentas", "Ingreso por rentas de la propiedad promedio"), prom("transfer", "Transferencias promedio"), prom("jubilacion", "Jubilaciones y pensiones promedio"), prom("becas", "Becas promedio"), prom("remesas", "Remesas promedio"), prom("bene_gob", "Beneficios de programas de gobierno promedio"), prom("estim_alqu", "Estimación del alquiler de la vivienda promedio"),
    prom("alimentos", "Gasto en alimentos, bebidas y tabaco promedio"), prom("vesti_calz", "Gasto en vestido y calzado promedio"), prom("vivienda", "Gasto en vivienda y servicios promedio"), prom("limpieza", "Gasto en artículos y servicios para la casa promedio"), prom("salud", "Gasto en salud promedio"), prom("transporte", "Gasto en transporte y comunicaciones promedio"), prom("educa_espa", "Gasto en educación y esparcimiento promedio"), prom("personales", "Gasto en cuidados personales promedio"), prom("transf_gas", "Transferencias de gasto promedio"),
    { clave: "integrantes", titulo: "Integrantes por hogar promedio", sql: "SUM(h.tot_integ * h.factor) / SUM(h.factor)", unidad: "personas", sumable: false, decimales: 2 },
    { clave: "edad_jefe", titulo: "Edad de la jefatura promedio", sql: "SUM(h.edad_jefe * h.factor) / SUM(h.factor)", unidad: "años", sumable: false, decimales: 1 },
  ],
  dimensiones: [
    { clave: "entidad", titulo: "Entidad", id: "substr(h.ubica_geo, 1, 2)", nombre: "e.descripcion", tipo: "geografica", geo: "entidad", orden: "1" },
    { clave: "decil", titulo: "Decil de ingreso", id: "h.decil", tipo: "categorica", orden: "1", descripcion: "Decil nacional de ingreso corriente per cápita del hogar (1 = 10 % más pobre)." },
    { clave: "tam_loc", titulo: "Tamaño de localidad", id: "h.tam_loc", nombre: "tl.descripcion", tipo: "categorica", orden: "1" },
    { clave: "est_socio", titulo: "Estrato socioeconómico", id: "h.est_socio", nombre: "es.descripcion", tipo: "categorica", orden: "1" },
    { clave: "clase_hog", titulo: "Clase de hogar", id: "h.clase_hog", nombre: "ch.descripcion", tipo: "categorica", orden: "1" },
    { clave: "sexo_jefe", titulo: "Sexo de la jefatura", id: "h.sexo_jefe", nombre: "sx.descripcion", tipo: "categorica", orden: "1" },
  ],
  predeterminado: { medidas: ["hogares", "ing_cor", "gasto_mon"], columnas: ["decil"] },
  sql_corte: "SELECT '2024' AS corte",
  notas: ["Cifras trimestrales en pesos de 2024, como las publica el INEGI; los promedios se ponderan con el factor de expansión y reproducen el Comunicado 112/25 (ver /api/v1/enigh/validaciones).", "Los promedios no se suman entre grupos; los totales expandidos sí."],
  api_dominio: "/api/v1/enigh",
};

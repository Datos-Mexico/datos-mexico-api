// Cubo del padrón de remuneraciones de servidores públicos de la Ciudad de México (246,836 nombramientos).
import type { Cubo } from "../tipos";

export const CDMX_NOMBRAMIENTOS: Cubo = {
  clave: "cdmx-nombramientos", nombre: "Nombramientos y sueldos del Gobierno de la CDMX", tema: "cdmx", fuente: "Gobierno de la Ciudad de México — padrón de remuneraciones de servidores públicos", fuente_url: "https://datos.cdmx.gob.mx/", licencia: "Datos abiertos CDMX",
  descripcion: "Los nombramientos del padrón con su sector, puesto, tipo de contratación, personal, nómina, universo, nivel salarial, sexo y año de ingreso; sueldos brutos y netos mensuales.",
  binding: "DB_CDMX", desde: "nombramientos n JOIN personas p ON p.id = n.persona_id LEFT JOIN cat_sectores s ON s.id = n.sector_id LEFT JOIN cat_puestos pu ON pu.id = n.puesto_id LEFT JOIN cat_tipos_contratacion tc ON tc.id = n.tipo_contratacion_id LEFT JOIN cat_tipos_personal tp ON tp.id = n.tipo_personal_id LEFT JOIN cat_tipos_nomina tn ON tn.id = n.tipo_nomina_id LEFT JOIN cat_universos u ON u.id = n.universo_id LEFT JOIN cat_niveles_salariales nv ON nv.id = n.nivel_salarial_id LEFT JOIN cat_sexos sx ON sx.id = p.sexo_id",
  medidas: [
    { clave: "nombramientos", titulo: "Nombramientos", sql: "COUNT(*)", unidad: "nombramientos", sumable: true },
    { clave: "personas", titulo: "Personas", sql: "COUNT(DISTINCT n.persona_id)", unidad: "personas", sumable: false },
    { clave: "sueldo_bruto", titulo: "Sueldo bruto mensual (suma)", sql: "SUM(n.sueldo_bruto)", unidad: "pesos", sumable: true, decimales: 2 },
    { clave: "sueldo_bruto_promedio", titulo: "Sueldo bruto mensual promedio", sql: "AVG(n.sueldo_bruto)", unidad: "pesos", sumable: false, decimales: 2 },
    { clave: "sueldo_neto", titulo: "Sueldo neto mensual (suma)", sql: "SUM(n.sueldo_neto)", unidad: "pesos", sumable: true, decimales: 2 },
    { clave: "sueldo_neto_promedio", titulo: "Sueldo neto mensual promedio", sql: "AVG(n.sueldo_neto)", unidad: "pesos", sumable: false, decimales: 2 },
    { clave: "edad_promedio", titulo: "Edad promedio", sql: "AVG(p.edad)", unidad: "años", sumable: false, decimales: 1 },
  ],
  dimensiones: [
    { clave: "sector", titulo: "Sector (dependencia)", id: "s.clave", nombre: "s.nombre", tipo: "categorica", orden: "2" },
    { clave: "puesto", titulo: "Puesto", id: "pu.id", nombre: "pu.nombre", tipo: "categorica", orden: "2" },
    { clave: "tipo_contratacion", titulo: "Tipo de contratación", id: "tc.nombre", tipo: "categorica" },
    { clave: "tipo_personal", titulo: "Tipo de personal", id: "tp.nombre", tipo: "categorica" },
    { clave: "tipo_nomina", titulo: "Tipo de nómina", id: "tn.clave", tipo: "categorica" },
    { clave: "universo", titulo: "Universo", id: "u.clave", nombre: "u.nombre", tipo: "categorica", orden: "2" },
    { clave: "nivel_salarial", titulo: "Nivel salarial", id: "nv.clave", tipo: "categorica", orden: "CAST(nv.clave AS INTEGER)" },
    { clave: "sexo", titulo: "Sexo", id: "sx.nombre", tipo: "categorica" },
    { clave: "anio_ingreso", titulo: "Año de ingreso", id: "substr(n.fecha_ingreso, 1, 4)", tipo: "temporal" },
  ],
  predeterminado: { medidas: ["nombramientos", "sueldo_bruto_promedio"], columnas: ["sector"] },
  sql_corte: "SELECT MAX(fecha_ingreso) AS corte FROM nombramientos",
  notas: ["Corte único del padrón (sin fechas de baja). Los sueldos son mensuales en pesos corrientes tal como los publica el padrón.", "Una persona puede tener más de un nombramiento; «Personas» cuenta personas distintas y no se suma entre grupos."],
  api_dominio: "/api/v1/servidores",
};

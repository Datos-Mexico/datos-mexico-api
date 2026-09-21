// Cubos de la CONSAR (SAR): recursos, comisiones, cuentas, activo neto, rendimientos, traspasos y flujos, por AFORE y mes.
import type { Cubo, Dimension } from "../tipos";

const FUENTE = { fuente: "CONSAR — Comisión Nacional del Sistema de Ahorro para el Retiro (datos abiertos)", fuente_url: "https://datos.gob.mx/busca/organization/consar", licencia: "CC-BY-4.0" };
const D_MES = (col = "fecha"): Dimension => ({ clave: "mes", titulo: "Mes", id: col, tipo: "temporal", descripcion: "Primer día del mes (AAAA-MM-01)." });
const D_ANIO = (col = "fecha"): Dimension => ({ clave: "anio", titulo: "Año", id: `substr(${col}, 1, 4)`, tipo: "temporal" });
const D_AFORE: Dimension = { clave: "afore", titulo: "AFORE", id: "a.codigo", nombre: "a.nombre_corto", tipo: "categorica", orden: "MIN(a.orden_display)" };
const D_SIEFORE: Dimension = { clave: "siefore", titulo: "SIEFORE", id: "s.slug", nombre: "s.nombre", tipo: "categorica", orden: "MIN(s.orden_display)" };
const D_SIEFORE_CAT: Dimension = { clave: "categoria_siefore", titulo: "Categoría de SIEFORE", id: "s.categoria", tipo: "categorica" };
const N_STOCK = "Los montos son saldos al cierre del mes: sumar meses no tiene sentido; sumar AFOREs sí.";

export const CONSAR_RECURSOS: Cubo = {
  clave: "consar-recursos", nombre: "Recursos registrados en el SAR", tema: "retiro", ...FUENTE,
  descripcion: "Saldo mensual de los recursos del Sistema de Ahorro para el Retiro por AFORE y tipo de recurso (SAR total, recursos administrados, vivienda, RCV IMSS/ISSSTE, ahorro voluntario y solidario, fondos de previsión…), desde 1998.",
  binding: "DB_CONSAR", desde: "recursos_mensuales r JOIN afores a ON a.id = r.afore_id JOIN tipos_recurso t ON t.id = r.tipo_recurso_id",
  medidas: [{ clave: "monto", titulo: "Monto", sql: "SUM(r.monto_mxn_mm)", unidad: "millones de pesos", sumable: true, decimales: 2 }],
  dimensiones: [D_MES("r.fecha"), D_ANIO("r.fecha"), D_AFORE, { clave: "tipo_recurso", titulo: "Tipo de recurso", id: "t.codigo", nombre: "t.nombre_corto", tipo: "categorica", orden: "MIN(t.orden_display)" }, { clave: "categoria_recurso", titulo: "Categoría del tipo de recurso", id: "t.categoria", tipo: "categorica", descripcion: "total, aggregate o component: los totales ya contienen a sus componentes." }],
  predeterminado: { medidas: ["monto"], columnas: ["afore", "mes"], filtros: { tipo_recurso: ["sar_total"], anio: ["2025"] } },
  sql_corte: "SELECT MAX(fecha) AS corte FROM recursos_mensuales",
  notas: [N_STOCK, "Los tipos de recurso se anidan (SAR total ⊃ recursos administrados ⊃ componentes): filtre un tipo antes de sumar entre tipos."], api_dominio: "/api/v1/consar",
};
export const CONSAR_COMISIONES: Cubo = {
  clave: "consar-comisiones", nombre: "Comisiones por AFORE", tema: "retiro", ...FUENTE,
  descripcion: "Comisión anual sobre saldo que cobra cada AFORE, mes por mes.",
  binding: "DB_CONSAR", desde: "comisiones c JOIN afores a ON a.id = c.afore_id",
  medidas: [{ clave: "comision", titulo: "Comisión (% anual sobre saldo)", sql: "AVG(c.comision)", unidad: "porcentaje", sumable: false, decimales: 3 }],
  dimensiones: [D_MES("c.fecha"), D_ANIO("c.fecha"), D_AFORE],
  predeterminado: { medidas: ["comision"], columnas: ["afore", "anio"] },
  sql_corte: "SELECT MAX(fecha) AS corte FROM comisiones", notas: ["La comisión es un porcentaje: al agrupar varios meses o AFOREs se promedia (promedio simple, no ponderado por saldo)."], api_dominio: "/api/v1/consar",
};
const METRICAS_CUENTA: [string, string][] = [["total_cuentas_afores", "Cuentas administradas por las AFOREs"], ["trabajadores_registrados", "Trabajadores registrados"], ["trabajadores_asignados", "Trabajadores asignados"], ["asignados_banco_mexico", "Asignados con recursos en Banco de México"], ["asignados_siefores", "Asignados con recursos en SIEFOREs"], ["trabajadores_imss", "Trabajadores IMSS"], ["trabajadores_issste", "Trabajadores ISSSTE"], ["trabajadores_independientes", "Trabajadores independientes"], ["cuentas_inhabilitadas", "Cuentas inhabilitadas"]];
export const CONSAR_CUENTAS: Cubo = {
  clave: "consar-cuentas", nombre: "Cuentas administradas", tema: "retiro", ...FUENTE,
  descripcion: "Cuentas y trabajadores registrados y asignados por AFORE, mes por mes (métricas operacionales de cuentas administradas).",
  binding: "DB_CONSAR", desde: "cuenta_administrada c JOIN afores a ON a.id = c.afore_id JOIN cat_metrica_cuenta m ON m.id = c.metrica_id",
  medidas: METRICAS_CUENTA.map(([k, t]) => ({ clave: k, titulo: t, sql: `SUM(CASE WHEN m.slug = '${k}' THEN c.valor END)`, unidad: "cuentas", sumable: true })),
  dimensiones: [D_MES("c.fecha"), D_ANIO("c.fecha"), D_AFORE],
  predeterminado: { medidas: ["total_cuentas_afores"], columnas: ["afore"], filtros: { mes: ["2025-12-01"] } },
  sql_corte: "SELECT MAX(fecha) AS corte FROM cuenta_administrada", notas: [N_STOCK, "Las métricas que existen para cada AFORE están en /api/v1/consar/metricas-cuenta; las que faltan aquí son agregados de sistema."], api_dominio: "/api/v1/consar",
};
export const CONSAR_ACTIVO: Cubo = {
  clave: "consar-activo-neto", nombre: "Activo neto por SIEFORE", tema: "retiro", ...FUENTE,
  descripcion: "Activo neto de cada SIEFORE de cada AFORE al cierre de mes.",
  binding: "DB_CONSAR", desde: "activo_neto n JOIN afores a ON a.id = n.afore_id JOIN cat_siefore s ON s.id = n.siefore_id",
  medidas: [{ clave: "monto", titulo: "Activo neto", sql: "SUM(n.monto_mxn_mm)", unidad: "millones de pesos", sumable: true, decimales: 2 }],
  dimensiones: [D_MES("n.fecha"), D_ANIO("n.fecha"), D_AFORE, D_SIEFORE, D_SIEFORE_CAT],
  predeterminado: { medidas: ["monto"], columnas: ["afore", "siefore"], filtros: { mes: ["2025-12-01"] } },
  sql_corte: "SELECT MAX(fecha) AS corte FROM activo_neto", notas: [N_STOCK], api_dominio: "/api/v1/consar",
};
export const CONSAR_RENDIMIENTOS: Cubo = {
  clave: "consar-rendimientos", nombre: "Rendimientos por SIEFORE y plazo", tema: "retiro", ...FUENTE,
  descripcion: "Rendimiento (% anual) de cada SIEFORE de cada AFORE por plazo (12, 24, 36 meses, 5 años e histórico), mes por mes.",
  binding: "DB_CONSAR", desde: "rendimiento r JOIN afores a ON a.id = r.afore_id JOIN cat_siefore s ON s.id = r.siefore_id",
  medidas: [{ clave: "rendimiento", titulo: "Rendimiento (% anual)", sql: "AVG(r.rendimiento_pct)", unidad: "porcentaje", sumable: false, decimales: 2 }],
  dimensiones: [D_MES("r.fecha"), D_ANIO("r.fecha"), D_AFORE, D_SIEFORE, D_SIEFORE_CAT, { clave: "plazo", titulo: "Plazo", id: "r.plazo", tipo: "categorica" }],
  predeterminado: { medidas: ["rendimiento"], columnas: ["afore", "siefore"], filtros: { plazo: ["12_meses"] } },
  sql_corte: "SELECT MAX(fecha) AS corte FROM rendimiento", notas: ["Al agrupar se promedia (promedio simple). Filtre un plazo y un mes para leer cifras publicadas tal cual."], api_dominio: "/api/v1/consar",
};
export const CONSAR_TRASPASOS: Cubo = {
  clave: "consar-traspasos", nombre: "Traspasos entre AFOREs", tema: "retiro", ...FUENTE,
  descripcion: "Cuentas cedidas y recibidas en traspasos por AFORE, mes por mes. En cada mes, la suma de cedidas es igual a la de recibidas.",
  binding: "DB_CONSAR", desde: "traspaso t JOIN afores a ON a.id = t.afore_id",
  medidas: [{ clave: "cedidas", titulo: "Cuentas cedidas", sql: "SUM(t.num_tras_cedido)", unidad: "cuentas", sumable: true }, { clave: "recibidas", titulo: "Cuentas recibidas", sql: "SUM(t.num_tras_recibido)", unidad: "cuentas", sumable: true }],
  dimensiones: [D_MES("t.fecha"), D_ANIO("t.fecha"), D_AFORE],
  predeterminado: { medidas: ["cedidas", "recibidas"], columnas: ["afore", "anio"], filtros: { anio: ["2024", "2025"] } },
  sql_corte: "SELECT MAX(fecha) AS corte FROM traspaso", notas: ["Flujos mensuales: sí se suman entre meses."], api_dominio: "/api/v1/consar",
};
export const CONSAR_FLUJOS: Cubo = {
  clave: "consar-flujos", nombre: "Entradas y salidas de recursos", tema: "retiro", ...FUENTE,
  descripcion: "Montos que entran y salen de cada AFORE mes por mes.",
  binding: "DB_CONSAR", desde: "flujo_recurso f JOIN afores a ON a.id = f.afore_id",
  medidas: [{ clave: "entradas", titulo: "Entradas", sql: "SUM(f.montos_entradas)", unidad: "millones de pesos", sumable: true, decimales: 2 }, { clave: "salidas", titulo: "Salidas", sql: "SUM(f.montos_salidas)", unidad: "millones de pesos", sumable: true, decimales: 2 }],
  dimensiones: [D_MES("f.fecha"), D_ANIO("f.fecha"), D_AFORE],
  predeterminado: { medidas: ["entradas", "salidas"], columnas: ["afore", "anio"], filtros: { anio: ["2024", "2025"] } },
  sql_corte: "SELECT MAX(fecha) AS corte FROM flujo_recurso", notas: ["Flujos mensuales: sí se suman entre meses."], api_dominio: "/api/v1/consar",
};

const D_DIA = (col: string): Dimension => ({ clave: "dia", titulo: "Día", id: col, tipo: "temporal", descripcion: "Fecha (AAAA-MM-DD)." });
export const CONSAR_PRECIOS: Cubo = {
  clave: "consar-precios", nombre: "Precios de las SIEFOREs (bolsa)", tema: "retiro", ...FUENTE,
  descripcion: "Precio diario de bolsa de cada SIEFORE de cada AFORE desde 1997 (648,469 cotizaciones).",
  binding: "DB_CONSAR", desde: "precio_bolsa p JOIN afores a ON a.id = p.afore_id JOIN cat_siefore s ON s.id = p.siefore_id",
  medidas: [{ clave: "precio", titulo: "Precio", sql: "AVG(p.precio)", unidad: "pesos", sumable: false, decimales: 6, descripcion: "Al agrupar días o fondos se promedia." }, { clave: "precio_max", titulo: "Precio máximo", sql: "MAX(p.precio)", unidad: "pesos", sumable: false, decimales: 6 }, { clave: "precio_min", titulo: "Precio mínimo", sql: "MIN(p.precio)", unidad: "pesos", sumable: false, decimales: 6 }, { clave: "cotizaciones", titulo: "Cotizaciones", sql: "COUNT(*)", unidad: "días", sumable: true }],
  dimensiones: [D_DIA("p.fecha"), { ...D_MES("substr(p.fecha, 1, 7) || '-01'"), descripcion: "Mes (AAAA-MM-01)." }, D_ANIO("p.fecha"), D_AFORE, D_SIEFORE, D_SIEFORE_CAT],
  predeterminado: { medidas: ["precio"], columnas: ["afore", "mes"], filtros: { siefore: ["sb 60-64"], anio: ["2025"] } },
  sql_corte: "SELECT MAX(fecha) AS corte FROM precio_bolsa", notas: ["Precio de bolsa (valuación pública); el precio de gestión está en /api/v1/consar/precios-gestion."], api_dominio: "/api/v1/consar",
};

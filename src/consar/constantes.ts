// Textos y caveats del dataset CONSAR, verbatim del legacy (verificados contra el CSV oficial).
export const SOURCE_CONSAR =
  "CONSAR vía datos.gob.mx (CC-BY-4.0) — " +
  "https://repodatos.atdt.gob.mx/api_update/consar/monto_recursos_registrados_afore/09_recursos.csv";

export const CAVEAT_UNIDAD =
  "Montos en millones de pesos MXN CORRIENTES (no deflactados). " +
  "Para comparaciones históricas reales, deflactar con INPC BASE 2018=100 INEGI.";

export const CAVEAT_PENSION_BIENESTAR =
  "Pensión Bienestar (FPB9) tiene serie corta: inicio 2024-07-01, " +
  "régimen administrativo diferenciado (reporta solo 2 de 15 conceptos).";

export const CAVEAT_FONDOS_PREV =
  "fondos_prevision_social es EXCLUSIVO de XXI-Banorte (reportado desde 2009-02). " +
  "Para otras AFOREs este componente es 0 por construcción.";

export const CAVEAT_BONO_ISSSTE =
  "bono_pension_issste arranca 2008-12 con la reforma ISSSTE 2007; " +
  "reconoce aportaciones realizadas bajo el régimen previo.";

export const CAVEAT_BANXICO =
  "recursos_depositados_banxico captura cuentas asignadas sin AFORE elegida. " +
  "Se reporta a nivel sistema desde 2012-01; cobertura parcial antes.";

export const CAVEAT_IDENTIDAD_SAR =
  "Identidad contable sar_total = rcv_imss + rcv_issste + bono_pension_issste " +
  "+ vivienda + ahorro_voluntario_y_solidario + capital_afores + banxico " +
  "+ fondos_prevision_social. Verificada empíricamente: cierre al peso " +
  "(Δ ≤ 0.05 mm MXN) en 98.83% de filas; cierre al peso en 100% de filas 2020+. " +
  "Residuo de 24 filas concentrado 100% en XXI-Banorte 2010-2012 " +
  "(probable artefacto transitorio post-introducción de fondos_prevision_social).";

export const CAVEAT_AHORRO_PRE_DESAGREGACION =
  "Caveat ahorro_voluntario / ahorro_solidario en 2009-01..08: en el refresh " +
  "del 2026-02-27 CONSAR cambió la convención de 'missing' para los meses " +
  "previos a la desagregación voluntario/solidario. Esos 8 meses ahora se " +
  "publican con los componentes ahorro_voluntario y ahorro_solidario en 0.0 " +
  "(antes eran celdas vacías). El agregado ahorro_voluntario_y_solidario " +
  "para esos meses sí reporta el monto histórico real (~570-601 mm MXN por " +
  "AFORE), por lo que la identidad ahorro_voluntario_y_solidario = " +
  "ahorro_voluntario + ahorro_solidario NO se cumple en esos 8 meses para 9 " +
  "AFOREs (72 filas) — y eso es fiel a la fuente, no error de ingesta. " +
  "Tratar esos ceros como ausencia de información, no como ahorro cero real.";

export const EJEMPLO_GENERICO = { count: 11, fecha: "2025-06-01", source: "CONSAR — Sistema de Ahorro para el Retiro" };

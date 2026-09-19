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

// ---- comisiones (dataset #06)
export const CAVEAT_COMISION_BIENESTAR = "Pensión Bienestar (FPB9) NO reporta comisión: régimen administrativo diferenciado (serie comienza 2024-07-01 con esquema sin comisión sobre saldo).";
export const CAVEAT_COMISION_REFORMA = "Cobertura empieza 2008-03-01 con la reforma de transparencia CONSAR. Tendencia secular descendente: cap regulatorio fue bajando ~1.96% (2008) → ~0.55% (2025).";
// ---- flujos (dataset #04)
export const CAVEAT_FLUJO_BIENESTAR = "Pensión Bienestar (FPB9) NO reporta en este dataset (régimen administrativo diferenciado). Solo 10 de las 11 AFOREs aparecen en flujos.";
export const CAVEAT_FLUJO_COBERTURA = "Cobertura empieza 2009-01-01. CSV original es rectangular sin celdas faltantes (todas las afores reportan en todos los meses dentro de la cobertura).";
// ---- traspasos (dataset #08)
export const CAVEAT_TRASPASO_BIENESTAR = "Pensión Bienestar (FPB9) NO reporta este dataset (régimen administrativo diferenciado). Solo 10 de las 11 AFOREs aparecen en traspasos.";
export const CAVEAT_TRASPASO_NULLS = "Filas con num_tras_cedido y num_tras_recibido ambos NULL representan meses previos al alta de la AFORE en el sistema (336 filas en el corte 2025-06).";
export const CAVEAT_TRASPASO_IDENTIDAD = "Identidad implícita Σ cedidos = Σ recibidos (cada traspaso es 1 cedido + 1 recibido). Verificada empíricamente: cierre exacto en 100% de meses 2021-2025; residuo histórico concentrado pre-2020 (39% global de 282 meses con datos). Probable explicación: cancelaciones, cuentas asignadas Banxico, ajustes administrativos antes de estandarización de reportes.";
// ---- PEA vs cotizantes (dataset #02)
export const CAVEAT_PEA_COBERTURA_INTERPRETACION = "porcentaje_pea_afore mide cobertura formal del SAR sobre la PEA. La diferencia con 100 (brecha_no_cubierta_pct) integra informalidad laboral, desempleo y trabajadores elegibles que aún no se han registrado. No es índice de fracaso del SAR sino reflejo del mercado laboral mexicano.";
export const CAVEAT_PEA_FUENTES = "PEA y cotizantes vienen de fuentes distintas (INEGI ENOE para PEA, CONSAR para cotizantes); CONSAR publica el ratio precalculado en este dataset.";
// ---- activo neto (dataset #07)
export const CAVEAT_ACTIVO_NETO_UNIDAD = CAVEAT_UNIDAD;
export const CAVEAT_ACTIVO_NETO_NULLS = "NULLs preservados (670 totales en CSV oficial): 560 en sb 95-99 + 110 en sb 55-59. Sparsity estructural por cohortes tardías: algunas afores no reportan esos buckets en todos los meses.";
export const CAVEAT_ACTIVO_NETO_DECOMPOSITION = "Sub-variants concat de #07 (xxi banorte 1..10, sura av1..3, profuturo cp/lp, banamex av plus, xxi banorte ahorro individual) descomponen a tuplas atómicas (afore × siefore) vía consar.afore_siefore_alias. Profuturo cp/lp y Sura av1 confirmados por docs CONSAR; Sura av2/av3 mapeados por inferencia lexicográfica + bijection con #10 (mapping_validated=FALSE).";
export const CAVEAT_ACTIVO_NETO_AGG_ADICIONALES = "Categoría act_neto_total_adicionales tiene 0 rows: el CSV oficial no reporta el agregado de siefores adicionales a nivel afore commercial. Los 1,139 rows con tipo='adicionales' son sub-variants que se descomponen a activo_neto atómico. Schema preparado para futura publicación CONSAR.";
// ---- rendimientos (dataset #10)
export const CAVEAT_RENDIMIENTO_UNIDAD = "Rendimientos en porcentaje anualizado neto reportado por CONSAR. Plazos 12_meses/24_meses/36_meses/5_anios son ventanas rolling; historico es rendimiento histórico desde inicio del SAR (sólo publicado para sb 60-64).";
export const CAVEAT_RENDIMIENTO_HISTORICO = "plazo='historico' sólo se publica para sb 60-64 (siefore generacional principal post-reforma 2019). Las otras 11 siefores no tienen serie histórica — coherente con la introducción del régimen generacional en la reforma SB 2019; cohortes 55-59 y 65-69+ no existían bajo el régimen previo.";
export const CAVEAT_RENDIMIENTO_DECOMPOSITION = "Sub-variants concat de #10 (banamex(siav2), profuturo(sac/siav), sura(siav/siav1/siav2), xxi-banorte(siav/sps1..sps10) — 17 strings) descomponen a tuplas atómicas (afore × siefore) vía consar.afore_siefore_alias (fuente_csv='#10'). 15 de 17 docs-confirmed; sura(siav2) y (siav1) inferencia lexicográfica con bijection con #07 (mapping_validated expuesto).";
export const CAVEAT_RENDIMIENTO_SIS = "rendimiento_sis es agregado INTER-afore (sistema completo): promedio ponderado CONSAR sobre todas las afores que ofrecen cada siefore. Distinto de activo_neto_agg de #07 que es agregado INTRA-afore (cada afore reporta totales propios).";
// ---- medidas de sensibilidad (dataset #03)
export const CAVEAT_MEDIDA_PIVOT = "Long-format derivado de pivot wide→long del CSV oficial #03 (7,840 wide rows × 7 métricas → 46,657 long rows). Skip-empties: solo se materializa una fila cuando valor != '' en CSV. NULLs no se almacenan; consultar con metrica_slug específica para obtener la cobertura real.";
export const CAVEAT_MEDIDA_DECOMPOSITION = "Sub-variants concat (banamex(siav2), profuturo(sac/siav), sura(siav/siav1/siav2), xxi-banorte(siav/sps1..sps10) — 17 strings idénticos a #10) decompuestos vía consar.afore_siefore_alias (reuso fuente_csv='#10', mismo mapping lógico). El campo siefore='siefores adicionales' del CSV se IGNORA en sub-variants — el siefore real proviene del decompose.";
export const CAVEAT_MEDIDA_PID_CORRECCION = "PID (provision_exposicion_instrumentos_derivados) etiquetada como 'pct' del activo expuesto, NO 'monto' absoluto. Corrección empírica vs DDL académico ds3 que asume 'monto'. Validación: Coppel/Inbursa/PensionISSSTE = 0% siempre (no operan derivados); range observado [0, 1.75]% coherente con cap regulatorio CONSAR para exposición a derivados.";
export const CAVEAT_MEDIDA_SUBVARIANT_METRICAS = "Sub-variants concat (productos adicionales SAC/SIAV/SPS) NO reportan tracking_error, escenarios_var ni PID. Decisión arquitectural CONSAR: estas 3 métricas NO aplican a productos no-básicos (1,139 NULLs por métrica × 3 = 3,417 NULLs estructurales).";
export const CAVEAT_MEDIDA_ESCENARIOS_SPARSITY = "escenarios_var tiene 76% sparsity incluso en canonical (1,901 / 6,701 reportados). Métrica esporádica que CONSAR sólo publica cuando hay stress-test reciente.";
// ---- cuentas administradas (dataset #05)
export const CAVEAT_CUENTA_BIGINT = "Métricas reportadas como counts BIGINT (cuentas o trabajadores). Empíricamente todos los valores en CSV son integer (no fraccionarios). Producción adopta BIGINT vs ds3 NUMERIC(20,2) por exactitud semántica y eficiencia.";
export const CAVEAT_CUENTA_DESDE_FECHA = "Cobertura temporal heterogénea por métrica: total_cuentas_afores y trabajadores_imss/registrados desde 1997-12; trabajadores_asignados desde 2001-06; subdivisiones asignados_banco_mexico/siefores desde 2012-01; trabajadores_independientes/issste desde 2005-08; cuentas_inhabilitadas desde 2024-09 (reforma); cuentas_bienestar_010 desde 2024-07 (reforma Pensión Bienestar).";
export const CAVEAT_CUENTA_IDENTIDAD_SAR = "Identidad SAR triple-capa post-reforma 2024 (descriptiva): pre-2024-07 cierre 100% (sentinel total_sar = Σ commercial.total_afores); 2024-07/08 cierre 100% (commercial + bienestar); 2024-09+ emerge residuo creciente NO atribuible (5,552,645 en 2025-06). Causa específica del residuo no determinable con dataset #05; probable atribución a cuentas en transición jurisdiccional bajo reforma 2024.";
export const CAVEAT_CUENTA_NO_COMMERCIAL = "Etiquetas no-commercial agrupadas en /cuentas/sistema con 3 categorías: sistema_total (total_cuentas_sar — agregado SAR completo), sistema_categoria_especial (cuentas_bienestar_010 — categoría reformista 2024), administrativa_especial (prestadora_de_servicios — entidad regulatoria especial).";
// ---- precio bolsa (dataset #01)
export const CAVEAT_PRECIO_NAV = "Precios NAV (Net Asset Value) en MXN por SIEFORE. Granularidad diaria de mercado (M-V principalmente, algunos weekends por reporting CONSAR). Range empírico observado [0.560568, 19.045541]: NAV inicial ~$1.00 al lanzamiento de cada SIEFORE, crece con rendimientos acumulados.";
export const CAVEAT_PRECIO_COBERTURA = "Cobertura más profunda del proyecto: 1997-01-08 → 2025-12-06 (28 años, 7,059 fechas). Cohortes generacionales más nuevas (sb 95-99, post-reforma SB 2019) tienen series más cortas. Productos legacy (sac, siav, siav1, siav2) pueden estar discontinuados.";
export const CAVEAT_PRECIO_BANAMEX_MERGE = "AFORE codigo banamex unifica strings 'banamex' y 'citibanamex' del CSV original (rebrand corporativo 2014). Empíricamente disjoint en (fecha × siefore): banamex string reportó 10 siefores excepto sb 55-59 y siav; citibanamex reportó SOLO sb 55-59 y siav. Series unificadas bajo afore_id=3 para preservar continuidad histórica 1997+.";
// ---- precio gestión (dataset #11)
export const CAVEAT_GESTION_PRECIO = "Precios de gestión interna en MXN por SIEFORE. Granularidad diaria de mercado (M-V principalmente, algunos weekends por reporting CONSAR). Range empírico observado [0.506404, 24.853032]: max NAV +30% vs precio_bolsa (19.045541), sugiere distinta base/comisión entre serie de precio bolsa y serie de gestión interna. Hallazgo descriptivo, NO interpretativo.";
export const CAVEAT_GESTION_COBERTURA = "Cobertura diaria 1997-01-07 → 2025-12-06 (28+ años, 7,060 fechas). 1 fecha extra vs precio_bolsa: 1997-01-07 (única fecha cubierta exclusivamente por XXI legacy/sb5). Cohortes generacionales más nuevas (sb 95-99, post-reforma SB 2019) tienen series más cortas. Productos legacy (sac, siav) pueden estar discontinuados.";
export const CAVEAT_GESTION_BANAMEX_MERGE = "AFORE codigo banamex unifica strings 'banamex' y 'citibanamex' del CSV original (rebrand corporativo 2014). Empíricamente disjoint en (fecha × siefore): banamex string reportó 10 siefores excepto sb 55-59 y siav; citibanamex reportó SOLO sb 55-59 y siav. Series unificadas bajo afore_id=3 (codigo=banamex) para preservar continuidad histórica 1997+. Validado a 588K rows + 0 PK colisiones.";
export const CAVEAT_GESTION_XXI_LEGACY = "AFORE codigo xxi_banorte unifica strings 'xxi-banorte' (con guion) y 'xxi' (legacy standalone pre-fusión 2013). XXI legacy aparece exclusivamente para SIEFORE sb5 (basica_legacy ≤2012, 3,664 fechas distintas 1997-01-07 → 2012-12-01). XXI-Banorte cubre 17 siefores ≠ sb5 desde 1997-01-08+. Disjoint perfecto en siefore: 0 PK colisiones. Series unificadas bajo afore_id=2 (codigo=xxi_banorte) preservan continuidad histórica.";
export const CAVEAT_GESTION_NO_PENSIONISSSTE = "PensionISSSTE (afore_id=6, AFORE pública del ISSSTE) NO aparece en este dataset. Diferencia estructural vs precio_bolsa: el reporte CONSAR de precios de gestión interna omite la AFORE pública. Filtrar por afore_codigo='pensionissste' devuelve 404. Para precio bolsa de PensionISSSTE consultar /precios/serie.";
export const PLAZOS_VALIDOS = ["12_meses", "24_meses", "36_meses", "5_anios", "historico"] as const;

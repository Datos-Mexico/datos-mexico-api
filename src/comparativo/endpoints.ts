// Comparativos CDMX ↔ ENIGH (7 endpoints del legacy). Cada consulta va a su propia base D1
// (DB_CDMX o DB_ENIGH) y se combina aquí, igual que el legacy combinaba en Python.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { fila, filas } from "../lib/db";
import { RESP_429 } from "../lib/comun";
import { redondear } from "../lib/numeros";
import { percentilCont } from "../lib/estadistica";
import { dec1, miles0 } from "../lib/formato";
import { RUBROS } from "../enigh/constantes";

const TAG = ["comparativo"];
const ok = (descripcion: string, esquema: z.ZodTypeAny) => ({ "200": { description: descripcion, ...contentJson(esquema) } });
export const CAVEAT_CDMX_SNAPSHOT = "cdmx.nombramientos es snapshot sin fecha alta/baja. Incluye todos los registros disponibles sin filtro temporal (246,841 registros, 1 por persona).";
export const CAVEAT_ENIGH_UNIDADES = "ENIGH mide ingreso total del hogar (salarios + transferencias + rentas + pensiones + actividad económica), no sueldo individual; mean 3.35 personas/hogar.";
export const CAVEAT_DECILES_ENIGH = "Deciles ENIGH son factor-weighted cumulative sum sobre ing_cor hogar trimestral; reproducen tabulados oficiales INEGI (±0.15% en 8/10 deciles, documentado en plan v2 §1.ter).";
const SUELDO_NO_NULO = "sueldo_bruto IS NOT NULL";

// ---------------------------------------------------------------- C1
const IngresoCdmxServidor = z.object({ unit: z.string(), n_servidores: z.number().int(), mean_sueldo_bruto_mensual: z.number(), median_sueldo_bruto_mensual: z.number() });
const IngresoEnighHogar = z.object({ unit: z.string(), scope: z.string(), n_hogares_expandido: z.number().int(), mean_ing_cor_mensual: z.number() });
const IngresoComparativoResponse = z.object({ cdmx_servidor: IngresoCdmxServidor, enigh_hogar_nacional: IngresoEnighHogar, enigh_hogar_cdmx: IngresoEnighHogar, brecha_mean_servidor_vs_hogar_nacional: z.number(), ratio_hogar_nacional_sobre_servidor: z.number(), brecha_mean_servidor_vs_hogar_cdmx: z.number(), ratio_hogar_cdmx_sobre_servidor: z.number(), note: z.string(), caveats: z.array(z.string()) });
export class IngresoCdmxVsNacional extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "ingreso_cdmx_vs_nacional_api_v1_comparativo_ingreso_cdmx_vs_nacional_get", summary: "Ingreso Cdmx Vs Nacional",
    description: "Compara ingreso mensual en las 3 referencias relevantes.\n\n- CDMX servidor (persona): mean/median de sueldo_bruto mensual\n- ENIGH hogar nacional: mean ing_cor trim/3 (ponderado factor)\n- ENIGH hogar CDMX (entidad 09): mean ing_cor trim/3 ponderado\n\nLas 3 cifras responden preguntas distintas. Brechas y ratios se calculan\nvs servidor mean (base común), pero son ilustrativos — las unidades no\nson directamente comparables (persona vs hogar).",
    responses: { ...ok("Comparativo ingreso CDMX (padrón servidores) vs nacional (ENIGH).", IngresoComparativoResponse), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const cdmx = (await fila<{ mean_bruto: number; n: number }>(c.env.DB_CDMX, `SELECT AVG(sueldo_bruto) AS mean_bruto, COUNT(*) AS n FROM nombramientos WHERE ${SUELDO_NO_NULO}`))!;
    const [median] = await percentilCont(c.env.DB_CDMX, "nombramientos", "sueldo_bruto", SUELDO_NO_NULO, [0.5]);
    const nac = (await fila<{ mean_mensual: number; n_hogares_exp: number }>(c.env.DB_ENIGH, "SELECT (SUM(ing_cor * factor) / SUM(factor) / 3.0) AS mean_mensual, SUM(factor) AS n_hogares_exp FROM concentradohogar"))!;
    const cdmxE = (await fila<{ mean_mensual: number; n_hogares_exp: number }>(c.env.DB_ENIGH, "SELECT (SUM(c.ing_cor * c.factor) / SUM(c.factor) / 3.0) AS mean_mensual, SUM(c.factor) AS n_hogares_exp FROM concentradohogar c WHERE substr(c.ubica_geo, 1, 2) = '09'"))!;
    const servidor_mean = cdmx.mean_bruto, nac_mean = nac.mean_mensual, cdmx_hog_mean = cdmxE.mean_mensual;
    return {
      cdmx_servidor: { unit: "pesos mensuales por persona (servidor público CDMX)", n_servidores: cdmx.n, mean_sueldo_bruto_mensual: redondear(servidor_mean, 2), median_sueldo_bruto_mensual: redondear(median!, 2) },
      enigh_hogar_nacional: { unit: "pesos mensuales por hogar (ing_cor expandido)", scope: "nacional", n_hogares_expandido: nac.n_hogares_exp, mean_ing_cor_mensual: redondear(nac_mean, 2) },
      enigh_hogar_cdmx: { unit: "pesos mensuales por hogar (ing_cor expandido)", scope: "entidad 09 — Ciudad de México", n_hogares_expandido: cdmxE.n_hogares_exp, mean_ing_cor_mensual: redondear(cdmx_hog_mean, 2) },
      brecha_mean_servidor_vs_hogar_nacional: redondear(nac_mean - servidor_mean, 2), ratio_hogar_nacional_sobre_servidor: redondear(nac_mean / servidor_mean, 3),
      brecha_mean_servidor_vs_hogar_cdmx: redondear(cdmx_hog_mean - servidor_mean, 2), ratio_hogar_cdmx_sobre_servidor: redondear(cdmx_hog_mean / servidor_mean, 3),
      note: "Brechas calculadas vs mean_servidor_bruto como base. Las unidades difieren (persona individual vs hogar con múltiples miembros), por lo que la 'brecha' no es equivalente a desigualdad entre personas. Un hogar ENIGH promedio tiene 3.35 personas y combina salarios + pensiones + transferencias + rentas + actividad económica.",
      caveats: [CAVEAT_CDMX_SNAPSHOT, CAVEAT_ENIGH_UNIDADES, "Cifras ENIGH son trimestrales en microdato; se dividen entre 3 para reportar mensual. Las publicaciones oficiales INEGI reportan mensuales directamente."],
    };
  }
}

// ---------------------------------------------------------------- C2
const PercentilRow = z.object({ percentil: z.string(), sueldo_mensual: z.number() });
const DecilBound = z.object({ decil: z.number().int(), lower_mensual: z.number(), upper_mensual: z.number() });
const EscenarioMapeoRow = z.object({ percentil: z.string(), ingreso_hogar_supuesto_mensual: z.number(), decil_hogar_enigh: z.number().int().nullable() });
const EscenarioResponse = z.object({ nombre: z.string(), supuesto: z.string(), ingreso_adicional_mensual: z.number(), mapeo: z.array(EscenarioMapeoRow) });
const CaveatsInterpretativos = z.object({ frontera_p50: z.string(), narrativa_correcta: z.string(), insight_principal: z.string(), implicacion_narrativa: z.string() });
const DecilServidoresResponse = z.object({ cdmx_servidor: z.record(z.string(), z.unknown()), enigh_deciles_mensuales: z.array(DecilBound), escenarios: z.array(EscenarioResponse), narrative: z.string(), caveats: z.array(z.string()), caveats_interpretativos: CaveatsInterpretativos });
void PercentilRow;
type Bound = { decil: number; lower_mensual: number; upper_mensual: number };
function mapearDecil(ingreso: number, bounds: Bound[]): number | null {
  for (const b of bounds) if (b.lower_mensual <= ingreso && ingreso <= b.upper_mensual) return b.decil;
  if (ingreso > bounds[bounds.length - 1].upper_mensual) return 10;
  if (ingreso < bounds[0].lower_mensual) return 1;
  return null;
}
export class DecilServidoresCdmx extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "decil_servidores_cdmx_api_v1_comparativo_decil_servidores_cdmx_get", summary: "Decil Servidores Cdmx",
    description: "Mapea percentiles del sueldo servidor CDMX a deciles ENIGH bajo 2 escenarios.\n\n**Escenario A — Perceptor único**: el servidor es la única fuente de\ningreso del hogar. Ingreso hogar ≈ sueldo_bruto servidor directo.\n\n**Escenario B — Servidor + perceptor mediano asalariado**: se asume el\nhogar con 2 perceptores: el servidor CDMX más una persona con ingreso\nequivalente a la mediana nacional de 'Sueldos, salarios o jornal'\n(enigh.ingresos.clave='P001'). Aproximación más defendible que\n'2× sueldo servidor' porque no asume que la pareja gana igual; ancla\nen una distribución empírica externa (n≈106k perceptores asalariados).\n\nLos deciles ENIGH se definen por bounds min/max de ing_cor trimestral\ndividido entre 3 para comparar mensual. Pueden haber huecos estrechos\nentre el upper de un decil y el lower del siguiente; el mapeo\ndevuelve el decil más cercano en esos casos.\n\nTESIS CENTRAL del observatorio: cuantifica el posicionamiento del\nservidor público CDMX dentro de la distribución de ingresos hogar a\nnivel nacional, con supuestos explícitos y acotación por escenarios.",
    responses: { ...ok("Posición del padrón CDMX en los deciles nacionales ENIGH.", DecilServidoresResponse), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const [p25, p50, p75, p90] = (await percentilCont(c.env.DB_CDMX, "nombramientos", "sueldo_bruto", SUELDO_NO_NULO, [0.25, 0.5, 0.75, 0.9])) as number[];
    const bounds = await filas<Bound>(c.env.DB_ENIGH, "SELECT decil AS decil, (MIN(ing_cor) / 3.0) AS lower_mensual, (MAX(ing_cor) / 3.0) AS upper_mensual FROM concentradohogar WHERE decil IS NOT NULL GROUP BY decil ORDER BY decil");
    const [medTri] = await percentilCont(c.env.DB_ENIGH, "ingresos", "ing_tri", "ing_tri > 0 AND clave = 'P001'", [0.5]);
    const median_asalariado = (medTri as number) / 3.0;
    const percentiles: [string, number][] = [["p25", p25], ["p50", p50], ["p75", p75], ["p90", p90]];
    const mapeo_a = percentiles.map(([name, val]) => ({ percentil: name, ingreso_hogar_supuesto_mensual: redondear(val, 2), decil_hogar_enigh: mapearDecil(val, bounds) }));
    const mapeo_b = percentiles.map(([name, val]) => ({ percentil: name, ingreso_hogar_supuesto_mensual: redondear(val + median_asalariado, 2), decil_hogar_enigh: mapearDecil(val + median_asalariado, bounds) }));
    const decil_p50_a = mapeo_a[1].decil_hogar_enigh!, decil_p50_b = mapeo_b[1].decil_hogar_enigh;
    const bound_p50 = bounds.find((b) => b.decil === decil_p50_a)!;
    const frontera_distancia = redondear(bound_p50.upper_mensual - p50, 2);
    const decil_siguiente = decil_p50_a < 10 ? decil_p50_a + 1 : decil_p50_a;
    const salto = decil_p50_b && decil_p50_a ? decil_p50_b - decil_p50_a : null;
    const txt = (v: number | null) => (v === null ? "None" : String(v));
    return {
      cdmx_servidor: { unit: "pesos mensuales por persona (sueldo_bruto)", percentiles: percentiles.map(([name, val]) => ({ percentil: name, sueldo_mensual: redondear(val, 2) })) },
      enigh_deciles_mensuales: bounds.map((b) => ({ decil: b.decil, lower_mensual: redondear(b.lower_mensual, 2), upper_mensual: redondear(b.upper_mensual, 2) })),
      escenarios: [
        { nombre: "A: Perceptor único", supuesto: "Servidor CDMX es la única fuente de ingreso del hogar", ingreso_adicional_mensual: 0.0, mapeo: mapeo_a },
        { nombre: "B: Servidor + perceptor mediano asalariado", supuesto: "Hogar con 2 perceptores: servidor CDMX + persona con ingreso equivalente a la mediana nacional de 'Sueldos, salarios o jornal' (enigh.ingresos.clave='P001', n≈106k perceptores, mediana mensual documentada)", ingreso_adicional_mensual: redondear(median_asalariado, 2), mapeo: mapeo_b },
      ],
      narrative: `Bajo Escenario A (servidor CDMX como perceptor único), el servidor mediano (sueldo $${miles0(p50)}/mes) cae en el decil ${decil_p50_a} de ingresos hogar nacional. Bajo Escenario B (servidor + perceptor mediano asalariado $${miles0(median_asalariado)}/mes), el hogar total $${miles0(p50 + median_asalariado)}/mes cae en el decil ${txt(decil_p50_b)}. La diferencia entre escenarios refleja el peso relativo del perceptor adicional; ambos escenarios son conservadores porque omiten transferencias, rentas y otros componentes del ing_cor ENIGH.`,
      caveats: [
        CAVEAT_CDMX_SNAPSHOT, CAVEAT_DECILES_ENIGH,
        "ENIGH.ing_cor incluye transferencias, rentas, pensiones y actividad económica además del salario. Los escenarios A y B acotan pero subestiman el decil real del hogar servidor CDMX si tiene esas fuentes adicionales.",
        "Escenario B usa mediana P001 como proxy del segundo perceptor; parejas con ingresos asimétricos (mayoría real) darían deciles intermedios entre A y B.",
        "Los bounds de decil son min/max de ing_cor dentro del decil. Un sueldo podría caer entre el upper de un decil y el lower del siguiente si el rango tiene microhuecos; en ese caso el decil inmediato superior o inferior aplica por cercanía.",
      ],
      caveats_interpretativos: {
        frontera_p50: `Mediana CDMX $${miles0(p50)} cae a $${miles0(frontera_distancia)} del boundary d${decil_p50_a}/d${decil_siguiente} (upper d${decil_p50_a} = $${miles0(bound_p50.upper_mensual)}). Pequeña variación en distribución CDMX reclasificaría narrativa.`,
        narrativa_correcta: `Servidor mediano CDMX está EN FRONTERA d${decil_p50_a}/d${decil_siguiente} nacional, no firmemente dentro de d${decil_p50_a}.`,
        insight_principal: `La posición socioeconómica del hogar depende más de COMPOSICIÓN (número de perceptores) que del salario individual. Agregar un perceptor mediano nacional al servidor mediano CDMX mueve el hogar ${txt(salto)} deciles arriba (d${decil_p50_a} → d${txt(decil_p50_b)}).`,
        implicacion_narrativa: `Afirmar 'servidor público CDMX = decil ${decil_p50_a}' es técnicamente correcto bajo supuesto específico (perceptor único) pero engañoso sin contexto. La posición real depende de variables no visibles en cdmx.nombramientos (¿hay cónyuge? ¿cuánto gana? ¿hay otros perceptores?).`,
      },
    };
  }
}

// ---------------------------------------------------------------- C3
const CdmxAportesActuales = z.object({ unit: z.string(), n_servidores: z.number().int(), mean_sueldo_bruto: z.number(), mean_sueldo_neto: z.number(), mean_deduccion_total: z.number(), pct_deduccion_sobre_bruto: z.number() });
const EnighJubilacionesActuales = z.object({ unit_trim: z.string(), unit_mes: z.string(), pct_hogares_con_jubilacion: z.number(), mean_jubilacion_sobre_todos_trim: z.number(), mean_jubilacion_solo_jubilados_trim: z.number(), mean_jubilacion_solo_jubilados_mensual: z.number(), n_hogares_con_jubilacion_expandido: z.number().int() });
const AportesVsJubilacionesResponse = z.object({ cdmx_aportes_actuales: CdmxAportesActuales, enigh_jubilaciones_actuales: EnighJubilacionesActuales, interpretacion: z.string(), caveats: z.array(z.string()) });
export class AportesVsJubilaciones extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "aportes_vs_jubilaciones_actuales_api_v1_comparativo_aportes_vs_jubilaciones_actuales_get", summary: "Aportes Vs Jubilaciones Actuales",
    description: "Yuxtaposición descriptiva — NO proyección actuarial.\n\n- CDMX.deducciones (bruto - neto) es el agregado total: ISR + IMSS/ISSSTE\n  + SAR + otras deducciones. NO es separable a nivel registro.\n- ENIGH.jubilaciones son pensiones CURRENTLY cobradas por hogares ENIGH 2024\n  NS, no proyecciones de lo que recibirá un servidor CDMX al jubilarse.\n- Los sistemas y las generaciones tienen reglas distintas. La comparación\n  útil es magnitud relativa, no equivalencia.",
    responses: { ...ok("Comparativo aportes SAR (descontados al servidor CDMX) vs jubilación actual ENIGH.", AportesVsJubilacionesResponse), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const cdmx = (await fila<{ n: number; mean_bruto: number; mean_neto: number; mean_deduc: number; pct_deduc: number }>(c.env.DB_CDMX, `
SELECT COUNT(*) AS n, AVG(sueldo_bruto) AS mean_bruto, AVG(sueldo_neto) AS mean_neto, AVG(sueldo_bruto - sueldo_neto) AS mean_deduc,
       (AVG(CASE WHEN sueldo_bruto > 0 THEN (sueldo_bruto - sueldo_neto) / sueldo_bruto ELSE NULL END) * 100) AS pct_deduc
FROM nombramientos WHERE sueldo_bruto IS NOT NULL AND sueldo_neto IS NOT NULL`))!;
    const e = (await fila<{ mean_jub_trim_todos: number; pct_con_jub: number; mean_jub_trim_solo_jub: number | null; n_exp_con_jub: number }>(c.env.DB_ENIGH, `
SELECT (SUM(jubilacion * factor) / SUM(factor)) AS mean_jub_trim_todos,
       (100.0 * SUM(CASE WHEN jubilacion > 0 THEN factor ELSE 0 END) / SUM(factor)) AS pct_con_jub,
       (SUM(CASE WHEN jubilacion > 0 THEN jubilacion * factor ELSE 0 END) / NULLIF(SUM(CASE WHEN jubilacion > 0 THEN factor ELSE 0 END), 0)) AS mean_jub_trim_solo_jub,
       SUM(CASE WHEN jubilacion > 0 THEN factor ELSE 0 END) AS n_exp_con_jub
FROM concentradohogar`))!;
    const solo = e.mean_jub_trim_solo_jub || 0;
    return {
      cdmx_aportes_actuales: { unit: "pesos mensuales por servidor público CDMX", n_servidores: cdmx.n, mean_sueldo_bruto: redondear(cdmx.mean_bruto, 2), mean_sueldo_neto: redondear(cdmx.mean_neto, 2), mean_deduccion_total: redondear(cdmx.mean_deduc, 2), pct_deduccion_sobre_bruto: redondear(cdmx.pct_deduc, 2) },
      enigh_jubilaciones_actuales: { unit_trim: "pesos trimestrales por hogar", unit_mes: "pesos mensuales por hogar (trim / 3)", pct_hogares_con_jubilacion: redondear(e.pct_con_jub, 2), mean_jubilacion_sobre_todos_trim: redondear(e.mean_jub_trim_todos, 2), mean_jubilacion_solo_jubilados_trim: redondear(solo, 2), mean_jubilacion_solo_jubilados_mensual: redondear(solo / 3, 2), n_hogares_con_jubilacion_expandido: e.n_exp_con_jub },
      interpretacion: `Mensualmente, un servidor CDMX activo aporta ~$${miles0(cdmx.mean_deduc)} en deducciones totales (promedio) — este monto INCLUYE ISR + IMSS/ISSSTE + SAR + otras, sin separación a nivel registro. Simultáneamente, ${dec1(e.pct_con_jub)}% de los hogares nacionales reciben jubilación, con promedio trimestral $${miles0(solo)} ($${miles0(solo / 3)}/mes) solo para quienes la reciben. Son dos realidades coexistentes del sistema de pensiones, no un gap actuarial predictivo.`,
      caveats: [
        CAVEAT_CDMX_SNAPSHOT,
        "cdmx.nombramientos.deducciones (bruto - neto) es el agregado total: INCLUYE ISR + IMSS/ISSSTE + SAR + créditos personales + otras deducciones sin separación posible a nivel registro. Usarla como proxy de 'aporte a pensión' sobreestima el aporte real.",
        "ENIGH.jubilaciones son pensiones CURRENTLY cobradas por hogares del universo ENIGH 2024 NS (18.5% de hogares), no proyección de lo que recibirá un servidor CDMX al jubilarse.",
        "NO es comparación actuarial. El gap deducción CDMX hoy vs jubilación promedio ENIGH hoy NO predice el futuro del servidor CDMX. Sistemas (IMSS-1973, IMSS-1997, ISSSTE-2007, cuentas individuales SAR) y generaciones con reglas distintas.",
        "La comparación útil es magnitud relativa (¿qué fracción del ingreso activo se aporta vs qué fracción del hogar pensionado proviene de jubilación?), no equivalencia 1:1.",
      ],
    };
  }
}

// ---------------------------------------------------------------- C4
const ActividadComparativa = z.object({ tipo: z.string(), hogares_expandido_nacional: z.number().int(), hogares_expandido_cdmx: z.number().int(), pct_nacional: z.number(), pct_cdmx: z.number(), ratio_cdmx_sobre_nacional: z.number() });
const ActividadCdmxVsNacionalResponse = z.object({ agro: ActividadComparativa, noagro: ActividadComparativa, n_hogares_total_nacional: z.number().int(), n_hogares_total_cdmx: z.number().int(), note: z.string(), nota_hipotesis: z.string(), caveats: z.array(z.string()) });
export class ActividadCdmxVsNacional extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "actividad_cdmx_vs_nacional_api_v1_comparativo_actividad_cdmx_vs_nacional_get", summary: "Actividad Cdmx Vs Nacional",
    description: "Contraste urbano/rural: % hogares con actividad agro y no-agro en CDMX vs nacional.\n\nEsperable: CDMX << nacional en agro (9.64% nacional, memory indica residuos\nperiurbanos Milpa Alta/Tláhuac/Xochimilco en CDMX); CDMX >= nacional en noagro\n(22.77% nacional; CDMX es metrópoli comercial con mayor actividad\nno-agropecuaria por hogar).",
    responses: { ...ok("Comparativo actividades de hogares CDMX vs nacional (agro / noagro / jcf).", ActividadCdmxVsNacionalResponse), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const r = (await fila<Record<string, number>>(c.env.DB_ENIGH, `
WITH hog_agro AS (SELECT DISTINCT folioviv, foliohog FROM agro),
     hog_noagro AS (SELECT DISTINCT folioviv, foliohog FROM noagro)
SELECT
    (SELECT SUM(factor) FROM hogares) AS total_nac,
    (SELECT SUM(factor) FROM hogares WHERE entidad='09') AS total_cdmx,
    (SELECT COALESCE(SUM(h.factor), 0) FROM hog_agro ha JOIN hogares h USING (folioviv, foliohog)) AS agro_nac,
    (SELECT COALESCE(SUM(h.factor), 0) FROM hog_agro ha JOIN hogares h USING (folioviv, foliohog) WHERE h.entidad='09') AS agro_cdmx,
    (SELECT COALESCE(SUM(h.factor), 0) FROM hog_noagro ha JOIN hogares h USING (folioviv, foliohog)) AS noagro_nac,
    (SELECT COALESCE(SUM(h.factor), 0) FROM hog_noagro ha JOIN hogares h USING (folioviv, foliohog) WHERE h.entidad='09') AS noagro_cdmx`))!;
    const pa_nac = (100 * r.agro_nac) / r.total_nac, pa_cdmx = (100 * r.agro_cdmx) / r.total_cdmx, pn_nac = (100 * r.noagro_nac) / r.total_nac, pn_cdmx = (100 * r.noagro_cdmx) / r.total_cdmx;
    return {
      agro: { tipo: "agropecuaria", hogares_expandido_nacional: r.agro_nac, hogares_expandido_cdmx: r.agro_cdmx, pct_nacional: redondear(pa_nac, 2), pct_cdmx: redondear(pa_cdmx, 2), ratio_cdmx_sobre_nacional: pa_nac ? redondear(pa_cdmx / pa_nac, 3) : 0 },
      noagro: { tipo: "no-agropecuaria", hogares_expandido_nacional: r.noagro_nac, hogares_expandido_cdmx: r.noagro_cdmx, pct_nacional: redondear(pn_nac, 2), pct_cdmx: redondear(pn_cdmx, 2), ratio_cdmx_sobre_nacional: pn_nac ? redondear(pn_cdmx / pn_nac, 3) : 0 },
      n_hogares_total_nacional: r.total_nac, n_hogares_total_cdmx: r.total_cdmx,
      note: "CDMX tiene presencia residual de actividad agro (periurbana: Milpa Alta, Tláhuac, Xochimilco). Noagro es actividad persona-trabajo-tipoact (comercio, servicios, manufactura); el ratio captura concentración económica vs actividad agrícola.",
      nota_hipotesis: "Hipótesis a explorar: CDMX concentra empleo formal asalariado, reduciendo la necesidad/incentivo de auto-empleo no-agropecuario. Estados con menor formalización laboral pueden tener mayor % noagro por acceso limitado a empleo asalariado. Esta hipótesis NO se ha probado con los datos cargados.",
      caveats: ["Cobertura hogares usa DISTINCT (folioviv, foliohog) sobre agro/noagro porque son tablas persona-trabajo-tipoact, no hogar-raíz.", "Un hogar con múltiples miembros con actividades distintas cuenta UNA VEZ en cobertura (pero múltiples veces en sumas de ventas)."],
    };
  }
}

// ---------------------------------------------------------------- C5
const GastoRubroComparativo = z.object({ slug: z.string(), nombre: z.string(), mean_cdmx_mensual: z.number(), mean_nacional_mensual: z.number(), delta_absoluto: z.number(), delta_pct: z.number(), pct_del_monetario_cdmx: z.number(), pct_del_monetario_nacional: z.number() });
const GastosCdmxVsNacionalResponse = z.object({ mean_gasto_mon_mensual_nacional: z.number(), mean_gasto_mon_mensual_cdmx: z.number(), rubros: z.array(GastoRubroComparativo), note: z.string(), caveats: z.array(z.string()) });
const SQL_C5 = `
SELECT
    (SUM(c.gasto_mon * c.factor) / SUM(c.factor) / 3.0) AS gmon_nac,
    (SUM(CASE WHEN h.entidad='09' THEN c.gasto_mon * c.factor END) / NULLIF(SUM(CASE WHEN h.entidad='09' THEN c.factor END), 0) / 3.0) AS gmon_cdmx,
    ${RUBROS.map(([col]) => `(SUM(c.${col} * c.factor) / SUM(c.factor) / 3.0) AS ${col}_nac`).join(", ")},
    ${RUBROS.map(([col]) => `(SUM(CASE WHEN h.entidad='09' THEN c.${col} * c.factor END) / NULLIF(SUM(CASE WHEN h.entidad='09' THEN c.factor END), 0) / 3.0) AS ${col}_cdmx`).join(", ")}
FROM concentradohogar c
JOIN hogares h USING (folioviv, foliohog)`;
export class GastosCdmxVsNacional extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "gastos_cdmx_vs_nacional_api_v1_comparativo_gastos_cdmx_vs_nacional_get", summary: "Gastos Cdmx Vs Nacional",
    description: "Gasto mensual por rubro — los 9 rubros INEGI oficiales — CDMX vs nacional.\n\nDevuelve mean mensual por rubro en ambos scopes y delta absoluto + relativo,\nmás estructura de gasto (%) de cada rubro sobre el gasto monetario total.",
    responses: { ...ok("Comparativo gastos rubro a rubro CDMX vs nacional ENIGH.", GastosCdmxVsNacionalResponse), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const r = (await fila<Record<string, number | null>>(c.env.DB_ENIGH, SQL_C5))!;
    const gmon_nac = r.gmon_nac as number, gmon_cdmx = r.gmon_cdmx as number;
    const rubros = RUBROS.map(([col, slug, nombre]) => {
      const nac = r[`${col}_nac`] as number, cdmx = r[`${col}_cdmx`] as number;
      return { slug, nombre, mean_cdmx_mensual: redondear(cdmx, 2), mean_nacional_mensual: redondear(nac, 2), delta_absoluto: redondear(cdmx - nac, 2), delta_pct: nac ? redondear(((cdmx - nac) / nac) * 100, 2) : 0.0, pct_del_monetario_cdmx: gmon_cdmx ? redondear((100 * cdmx) / gmon_cdmx, 2) : 0.0, pct_del_monetario_nacional: gmon_nac ? redondear((100 * nac) / gmon_nac, 2) : 0.0 };
    });
    return {
      mean_gasto_mon_mensual_nacional: redondear(gmon_nac, 2), mean_gasto_mon_mensual_cdmx: redondear(gmon_cdmx, 2), rubros,
      note: "Valores desde enigh.concentradohogar (tabla summary oficial). Todos los agregados ponderados por factor. Delta positivo = CDMX gasta más que el promedio nacional en ese rubro; negativo = menos.",
      caveats: ["Los valores son nacional / CDMX (entidad 09). No se desagrega por decil dentro de CDMX. Un hogar CDMX decil 1 y uno decil 10 pueden tener estructuras de gasto muy distintas.", "Las publicaciones INEGI oficiales cubren total nacional. El corte CDMX es analítico propio y no tiene bound directo del Comunicado 112/25."],
    };
  }
}

// ---------------------------------------------------------------- C6
const BancarizacionResponse = z.object({ definicion_operativa: z.string(), n_hogares_expandido_nacional: z.number().int(), n_hogares_expandido_cdmx: z.number().int(), hogares_con_uso_tarjeta_nacional: z.number().int(), hogares_con_uso_tarjeta_cdmx: z.number().int(), pct_nacional: z.number(), pct_cdmx: z.number(), delta_pp: z.number(), ratio_cdmx_sobre_nacional: z.number(), caveats: z.array(z.string()) });
export class Bancarizacion extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "bancarizacion_api_v1_comparativo_bancarizacion_get", summary: "Bancarizacion",
    description: "Uso de tarjeta (crédito o débito) en trimestre — CDMX vs nacional.\n\nDefinición operativa: \"hogar con ≥1 registro en enigh.gastotarjetas en\nel trimestre de referencia\". NO mide posesión de tarjeta, solo uso\nefectivo en trimestre; captura débito + crédito indistintamente.",
    responses: { ...ok("Bancarización (% hogares con cuenta) CDMX vs nacional. Cifra nacional corregida 7.1→8.87% en S7.", BancarizacionResponse), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const r = (await fila<Record<string, number>>(c.env.DB_ENIGH, `
WITH hog_tarj AS (SELECT DISTINCT folioviv, foliohog FROM gastotarjetas)
SELECT
    (SELECT SUM(factor) FROM hogares) AS total_nac,
    (SELECT SUM(factor) FROM hogares WHERE entidad='09') AS total_cdmx,
    COALESCE((SELECT SUM(h.factor) FROM hog_tarj ht JOIN hogares h USING (folioviv, foliohog)), 0) AS con_tarj_nac,
    COALESCE((SELECT SUM(h.factor) FROM hog_tarj ht JOIN hogares h USING (folioviv, foliohog) WHERE h.entidad='09'), 0) AS con_tarj_cdmx`))!;
    const pct_nac = (100 * r.con_tarj_nac) / r.total_nac, pct_cdmx = (100 * r.con_tarj_cdmx) / r.total_cdmx;
    return {
      definicion_operativa: "Hogar con ≥1 registro en enigh.gastotarjetas en el trimestre de referencia. NO mide posesión de tarjeta; mide USO EFECTIVO en trimestre. Captura débito + crédito sin distinción.",
      n_hogares_expandido_nacional: r.total_nac, n_hogares_expandido_cdmx: r.total_cdmx, hogares_con_uso_tarjeta_nacional: r.con_tarj_nac, hogares_con_uso_tarjeta_cdmx: r.con_tarj_cdmx,
      pct_nacional: redondear(pct_nac, 2), pct_cdmx: redondear(pct_cdmx, 2), delta_pp: redondear(pct_cdmx - pct_nac, 2), ratio_cdmx_sobre_nacional: pct_nac ? redondear(pct_cdmx / pct_nac, 3) : 0,
      caveats: [
        "Definición mide USO, no POSESIÓN. Un hogar con tarjeta que no la usó en trimestre NO está contado. Un hogar sin tarjeta pero que usó una prestada o un pago con tarjeta de tercero SÍ está contado (los casos reales son marginales pero existen).",
        "gastotarjetas captura débito + crédito sin distinguir. Si se quisiera solo crédito, requiere filtro adicional por clave.",
        "La cifra nacional (~8.87%) parece baja en términos absolutos porque la definición es trimestral, no anual. Un hogar que use tarjeta semestralmente tiene 50% probabilidad de aparecer en un trimestre.",
      ],
    };
  }
}

// ---------------------------------------------------------------- C7
const TopVsBottomResponse = z.object({ top_bracket: z.record(z.string(), z.unknown()), bottom_bracket: z.record(z.string(), z.unknown()), narrative: z.string(), insights: z.array(z.string()), caveats: z.array(z.string()) });
export class TopVsBottom extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "top_vs_bottom_api_v1_comparativo_top_vs_bottom_get", summary: "Top Vs Bottom",
    description: "Extremos CDMX (p1/p5/p10 vs p90/p95/p99) mapeados contra ENIGH d1 y d10.\n\nMuestra el rango completo de la brecha entre servidores públicos CDMX y la\ndistribución nacional de ingresos hogar. Insight central esperable:\nincluso el p99 CDMX (top 1% servidores) está debajo del mean mensual d10\nnacional — la distribución CDMX está comprimida respecto a la distribución\nnacional hogar (última incluye transferencias + rentas + múltiples perceptores).",
    responses: { ...ok("Comparativo d10 nacional vs decil más alto CDMX (top puestos).", TopVsBottomResponse), ...RESP_429 },
  };
  async handle(c: AppContext) {
    const [p01, p05, p10, p90, p95, p99] = (await percentilCont(c.env.DB_CDMX, "nombramientos", "sueldo_bruto", SUELDO_NO_NULO, [0.01, 0.05, 0.1, 0.9, 0.95, 0.99])) as number[];
    const ext = (await fila<Record<string, number>>(c.env.DB_ENIGH, `
SELECT
    (SUM(CASE WHEN decil=1 THEN ing_cor * factor END) / NULLIF(SUM(CASE WHEN decil=1 THEN factor END), 0) / 3.0) AS d1_mean_mensual,
    (SUM(CASE WHEN decil=10 THEN ing_cor * factor END) / NULLIF(SUM(CASE WHEN decil=10 THEN factor END), 0) / 3.0) AS d10_mean_mensual,
    (MIN(CASE WHEN decil=1 THEN ing_cor END) / 3.0) AS d1_lower,
    (MAX(CASE WHEN decil=1 THEN ing_cor END) / 3.0) AS d1_upper,
    (MIN(CASE WHEN decil=10 THEN ing_cor END) / 3.0) AS d10_lower,
    (MAX(CASE WHEN decil=10 THEN ing_cor END) / 3.0) AS d10_upper
FROM concentradohogar`))!;
    const d1_mean = ext.d1_mean_mensual, d1_upper = ext.d1_upper, d10_mean = ext.d10_mean_mensual, d10_lower = ext.d10_lower;
    const insight_p99 = `CDMX p99 ($${miles0(p99)}/mes) está por DEBAJO del mean d10 nacional ($${miles0(d10_mean)}/mes hogar) por $${miles0(d10_mean - p99)}/mes. El top 1% de servidores CDMX, a nivel individual, no alcanza el promedio de ingreso hogar del decil 10 nacional.`;
    const insight_p99_vs_d10_lower = p99 < d10_lower
      ? `Para caer en d10 nacional (lower d10 $${miles0(d10_lower)}), un servidor necesitaría ganar ~$${miles0(d10_lower)}/mes individualmente — superior al p99 CDMX ($${miles0(p99)}).`
      : `El p99 CDMX ($${miles0(p99)}) supera el lower d10 nacional ($${miles0(d10_lower)}), es decir, solo el top 1% de servidores entra individualmente en d10 hogar.`;
    const insight_p01 = `CDMX p01 ($${miles0(p01)}/mes) vs d1 mean nacional ($${miles0(d1_mean)}/mes hogar). Brecha p01 vs d1_mean = $${miles0(p01 - d1_mean)}. Un servidor en el bottom 1% gana ${p01 > d1_mean ? "más" : "menos"} que un hogar promedio d1 (que incluye múltiples perceptores o transferencias).`;
    return {
      top_bracket: { unit: "pesos mensuales", cdmx_servidor_percentiles: { p90: redondear(p90, 2), p95: redondear(p95, 2), p99: redondear(p99, 2) }, enigh_d10: { mean_mensual: redondear(d10_mean, 2), lower_mensual: redondear(d10_lower, 2), upper_mensual: redondear(ext.d10_upper, 2) }, brecha_p99_vs_d10_mean: redondear(d10_mean - p99, 2), ratio_d10_mean_sobre_p99: p99 ? redondear(d10_mean / p99, 3) : 0 },
      bottom_bracket: { unit: "pesos mensuales", cdmx_servidor_percentiles: { p01: redondear(p01, 2), p05: redondear(p05, 2), p10: redondear(p10, 2) }, enigh_d1: { mean_mensual: redondear(d1_mean, 2), lower_mensual: redondear(ext.d1_lower, 2), upper_mensual: redondear(d1_upper, 2) }, brecha_p01_vs_d1_mean: redondear(p01 - d1_mean, 2) },
      narrative: `El top 1% de servidores CDMX ($${miles0(p99)}/mes individual) entra al decil 10 nacional como perceptor único (lower d10 = $${miles0(d10_lower)}), pero se posiciona en el segmento inferior de ese decil. El mean del decil 10 nacional es $${miles0(d10_mean)}/mes como hogar, lo que típicamente representa hogares con múltiples perceptores altos o patrimonio generador de ingresos adicionales. La distancia p99_servidor vs mean_d10_hogar no es evidencia de 'servidores top CDMX debajo del decil 10' sino de que el decil 10 nacional está dominado por hogares con composición de ingreso más rica que un solo salario.`,
      insights: [insight_p99, insight_p99_vs_d10_lower, insight_p01],
      caveats: [CAVEAT_CDMX_SNAPSHOT, CAVEAT_DECILES_ENIGH, CAVEAT_ENIGH_UNIDADES, "ENIGH d10 incluye outliers muy altos (upper ~$5.8M/mes) que elevan el mean de d10. El mean d10 no es el tope del decil; es el promedio. El upper d10 representa el ingreso máximo observado.", "La distribución CDMX servidor está inherentemente acotada por regulaciones salariales del sector público; la distribución ENIGH hogar refleja el rango completo de ingresos de la economía."],
    };
  }
}

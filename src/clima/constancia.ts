// Constancia de cada observatorio del SMN: de las horas que el observatorio vigiló, en cuántas llegó la lectura de cada capital,
// cuántas llegaron marcadas, a qué horas del día suelen faltar y cuánto tarda el SMN en publicarlas. Se calcula de lo que ya
// custodia el observatorio (clima_lotes y clima_medicion): ninguna cifra nueva, solo la cuenta a la vista.
// Una hora «faltó» cuando el SMN no la publicó en ningún caché global de la OMM en todos los repasos (hasta H+50 y dos repasos
// de historia); si el propio observatorio no vigiló una hora (sin lote), esa hora no se le cuenta al SMN.
import { filas } from "../lib/db";
import { ESTACIONES } from "./estaciones";
import { ZONA } from "./normales";

export const CONSTANCIA_REGLA = "Horas vigiladas = horas con lote del observatorio en la ventana (sin lote, la hora no se le cuenta al SMN). Faltó = el SMN no la publicó en los cachés globales de la OMM en ningún repaso. Marcada = llegó pero no pasó alguna verificación. Retraso = hora en que el caché de la OMM tuvo el archivo (Last-Modified) menos la hora de la observación. Franja = cadena de una letra por hora, de la más antigua a la más reciente: L llegó, M llegó marcada, F faltó, · sin vigilancia.";

const horaLocal = (clave: string, ms: number) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: ZONA[clave], hour: "2-digit", hour12: false }).format(new Date(ms))) % 24;

export async function constancia(db: D1Database, ahoraMs: number, dias: number) {
  const corte = Math.floor(ahoraMs / 3600_000) * 3600_000 - 2 * 3600_000; // la hora en curso y la anterior aún tienen repasos
  const desde = corte - dias * 86400_000;
  const desdeIso = new Date(desde).toISOString(), corteIso = new Date(corte).toISOString();
  const [lotes, meds] = await Promise.all([
    filas<{ hora: string; faltan: string }>(db, "SELECT hora, faltan FROM clima_lotes WHERE hora > ? AND hora <= ? ORDER BY hora", [desdeIso, corteIso]),
    filas<{ clave: string; instante: string; marcas: string; publicado_en: string | null; llegado_en: string }>(db, "SELECT clave, instante, marcas, publicado_en, llegado_en FROM clima_medicion WHERE instante > ? AND instante <= ?", [desdeIso, corteIso]),
  ]);
  const horas: number[] = [];
  for (let t = desde + 3600_000; t <= corte; t += 3600_000) horas.push(t);
  const vigiladas = new Map(lotes.map((l) => [Date.parse(l.hora), new Set(JSON.parse(l.faltan) as string[])]));
  const porClave = new Map<string, Map<number, { marcada: boolean; retraso_min: number | null; llegada_min: number }>>();
  for (const m of meds) {
    const t = Date.parse(m.instante);
    if (!porClave.has(m.clave)) porClave.set(m.clave, new Map());
    porClave.get(m.clave)!.set(t, { marcada: m.marcas !== "[]", retraso_min: m.publicado_en ? (Date.parse(m.publicado_en) - t) / 60_000 : null, llegada_min: (Date.parse(m.llegado_en) - t) / 60_000 });
  }
  const mediana = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const k = Math.floor(s.length / 2); return Math.round((s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2) * 10) / 10; };
  let totV = 0, totL = 0;
  const capitales = ESTACIONES.map((e) => {
    const mios = porClave.get(e.clave) ?? new Map();
    let vig = 0, llego = 0, marc = 0, falto = 0, racha = 0, peorRacha = 0, rachaActual = 0;
    const faltasPorHora = Array(24).fill(0), vigPorHora = Array(24).fill(0);
    const retrasos: number[] = [];
    let franja = "", ultima: string | null = null, segundoLote = 0;
    for (const t of horas) {
      const faltan = vigiladas.get(t);
      const m = mios.get(t);
      if (!faltan && !m) { franja += "·"; continue; }
      vig++; vigPorHora[horaLocal(e.clave, t)]++;
      if (m) {
        llego++; if (m.marcada) marc++;
        if (m.retraso_min !== null) { retrasos.push(m.retraso_min); if (m.retraso_min > 20) segundoLote++; }
        franja += m.marcada ? "M" : "L"; ultima = new Date(t).toISOString(); racha = 0;
      } else {
        falto++; faltasPorHora[horaLocal(e.clave, t)]++; franja += "F"; racha++; peorRacha = Math.max(peorRacha, racha);
      }
    }
    rachaActual = racha;
    totV += vig; totL += llego;
    // Franja horaria donde más falta (bloques de 6 h locales), para leer patrones de turno.
    const bloques = [0, 6, 12, 18].map((h0) => {
      const f = faltasPorHora.slice(h0, h0 + 6).reduce((a, b) => a + b, 0), v = vigPorHora.slice(h0, h0 + 6).reduce((a, b) => a + b, 0);
      return { de: `${String(h0).padStart(2, "0")}:00`, a: `${String(h0 + 6).padStart(2, "0")}:00`, vigiladas: v, faltaron: f, pct_falto: v ? Math.round((f / v) * 1000) / 10 : null };
    });
    return {
      clave: e.clave, capital: e.capital, estacion: e.estacion, wmo: e.wmo,
      horas_vigiladas: vig, llegaron: llego, marcadas: marc, faltaron: falto,
      pct_llegaron: vig ? Math.round((llego / vig) * 1000) / 10 : null,
      racha_actual_faltando_h: rachaActual, peor_racha_h: peorRacha, ultima_lectura: ultima,
      retraso_mediano_min: mediana(retrasos), pct_segundo_lote: retrasos.length ? Math.round((segundoLote / retrasos.length) * 1000) / 10 : null,
      faltas_por_bloque_local: bloques, franja,
    };
  });
  return {
    ventana: { desde: new Date(desde + 3600_000).toISOString(), hasta: corteIso, horas: horas.length, dias },
    nacional: { lecturas_vigiladas: totV, llegaron: totL, pct_llegaron: totV ? Math.round((totL / totV) * 1000) / 10 : null, horas_completas: lotes.filter((l) => (JSON.parse(l.faltan) as string[]).length === 0).length, horas_vigiladas: lotes.length },
    regla: CONSTANCIA_REGLA,
    capitales: capitales.sort((a, b) => (a.pct_llegaron ?? 101) - (b.pct_llegaron ?? 101) || a.clave.localeCompare(b.clave)),
  };
}

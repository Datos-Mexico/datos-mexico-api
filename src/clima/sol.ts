// Amanecer, atardecer, mediodía solar y duración del día, calculados aquí (no dependen de ninguna fuente): algoritmo de la
// NOAA (Global Monitoring Laboratory, «NOAA Solar Calculator»: ecuación del tiempo y declinación de Meeus, «Astronomical
// Algorithms», cap. 25), con refracción estándar y radio del Sol: el centro a 0.833° bajo el horizonte; crepúsculo civil a 6°.
// Precisión del método: ~1 minuto en latitudes de México. Se coteja contra Open-Meteo en las pruebas (scripts/clima).

const rad = Math.PI / 180;

/** Parámetros solares del día juliano (Meeus): declinación (°) y ecuación del tiempo (min) a mediodía UTC del día. */
function solar(jd: number) {
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
  const lon = L0 + C - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * T) * rad);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos((125.04 - 1934.136 * T) * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lon * rad)) / rad;
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqt = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
  return { decl, eqt };
}

/** Minutos UTC (desde las 00 UTC de la fecha) del evento con el Sol a `alt` grados; null si no ocurre (no pasa en México). */
function evento(jd: number, lat: number, lon: number, alt: number, sale: boolean): number | null {
  // Dos pasadas: la segunda recalcula con el instante aproximado del evento.
  let t = 720 - 4 * lon;
  for (let i = 0; i < 2; i++) {
    const { decl, eqt } = solar(jd + t / 1440);
    const cosH = (Math.cos((90 + alt) * rad) - Math.sin(lat * rad) * Math.sin(decl * rad)) / (Math.cos(lat * rad) * Math.cos(decl * rad));
    if (cosH > 1 || cosH < -1) return null;
    const H = Math.acos(cosH) / rad;
    t = 720 - 4 * (lon + (sale ? H : -H)) - eqt;
  }
  return t;
}

/** El Sol de una fecha local (AAAA-MM-DD) en un punto, con la zona de la capital para expresar las horas. */
export function solDelDia(fecha: string, lat: number, lon: number) {
  const [a, m, d] = fecha.split("-").map(Number);
  const base = Date.UTC(a, m - 1, d);
  // Día juliano a las 00 UTC de la fecha. Para México (UTC−5 a UTC−8) el día local cae entero en el mismo día UTC salvo el
  // atardecer, que puede pasar de las 00 UTC: se maneja con minutos > 1440.
  const jd = base / 86400_000 + 2440587.5;
  const aIso = (min: number | null) => (min === null ? null : new Date(base + Math.round(min * 60_000)).toISOString());
  const salida = evento(jd, lat, lon, 0.833, true), puesta = evento(jd, lat, lon, 0.833, false);
  const { eqt } = solar(jd + 0.5);
  const mediodia = 720 - 4 * lon - eqt;
  const civilA = evento(jd, lat, lon, 6, true), civilB = evento(jd, lat, lon, 6, false);
  const { decl } = solar(jd + mediodia / 1440);
  return {
    amanecer: aIso(salida), atardecer: aIso(puesta), mediodia_solar: aIso(mediodia),
    crepusculo_civil: { inicio: aIso(civilA), fin: aIso(civilB) },
    duracion_min: salida !== null && puesta !== null ? Math.round(puesta - salida) : null,
    altura_maxima_grados: Math.round((90 - Math.abs(lat - decl)) * 10) / 10,
  };
}

/** Altura del Sol (grados) en un instante y un punto: sirve para pintar el cielo de la ficha según la hora real. */
export function alturaSol(ms: number, lat: number, lon: number): number {
  const jd = ms / 86400_000 + 2440587.5;
  const { decl, eqt } = solar(jd);
  const minUtc = ((ms % 86400_000) + 86400_000) % 86400_000 / 60_000;
  const H = (minUtc + eqt + 4 * lon) / 4 - 180;
  const s = Math.sin(lat * rad) * Math.sin(decl * rad) + Math.cos(lat * rad) * Math.cos(decl * rad) * Math.cos(H * rad);
  return Math.round((Math.asin(Math.max(-1, Math.min(1, s))) / rad) * 10) / 10;
}

// Coteja el amanecer y el atardecer calculados por el observatorio (src/clima/sol.ts) contra Open-Meteo, que los calcula por su
// cuenta, para las 32 capitales en una fecha. Una llamada por capital (32 llamadas a Open-Meteo: correr a mano, no en el cron).
// Uso: npx tsx scripts/clima/cotejar_sol.ts [AAAA-MM-DD]
// Medido el 11-nov-2026 con cuatro capitales de tres husos: diferencia máxima 0.24 min.
import { solDelDia } from "../../src/clima/sol";
import { CAPITALES } from "../../src/clima/capitales";

const fecha = process.argv[2] ?? new Date().toISOString().slice(0, 10);
let peor = 0;
for (const c of CAPITALES) {
  const r = (await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&daily=sunrise,sunset&timezone=GMT&timeformat=unixtime&start_date=${fecha}&end_date=${fecha}`)).json()) as { daily: { sunrise: number[]; sunset: number[] } };
  const s = solDelDia(fecha, c.lat, c.lon);
  const dA = (Date.parse(s.amanecer!) / 1000 - r.daily.sunrise[0]) / 60, dB = (Date.parse(s.atardecer!) / 1000 - r.daily.sunset[0]) / 60;
  peor = Math.max(peor, Math.abs(dA), Math.abs(dB));
  console.log(`${c.clave} ${c.capital.padEnd(28)} amanecer Δ ${dA.toFixed(2)} min · atardecer Δ ${dB.toFixed(2)} min`);
  await new Promise((ok) => setTimeout(ok, 250));
}
console.log(`peor diferencia: ${peor.toFixed(2)} min`);
process.exit(peor <= 1 ? 0 : 1);

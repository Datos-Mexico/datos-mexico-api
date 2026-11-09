// Entrada para el validador: decodifica con el lector GRIB del Worker cada archivo recibido por argumento.
import { readFileSync } from "node:fs";
import { leerGrib } from "../../src/clima/grib";
const out: Record<string, unknown> = {};
for (const f of process.argv.slice(2)) {
  try { out[f] = leerGrib(new Uint8Array(readFileSync(f))).map((c) => ({ ...c, valores: Array.from(c.valores) })); }
  catch (e) { out[f] = { error: String(e) }; }
}
process.stdout.write(JSON.stringify(out));

// Entrada para el validador: decodifica con el decodificador del Worker cada archivo BUFR recibido por argumento.
import { readFileSync } from "node:fs";
import { decodificarBufr } from "../../src/clima/bufr";
import { extraerSinoptica } from "../../src/clima/sinoptica-extraer";
const out: Record<string, unknown> = {};
for (const f of process.argv.slice(2)) {
  try {
    const m = decodificarBufr(new Uint8Array(readFileSync(f)));
    out[f] = { fxy: m.elementos.map((e) => e.fxy), val: m.elementos.map((e) => e.valor), obs: extraerSinoptica(m), version: m.versionTablas, centro: m.centro };
  } catch (e) { out[f] = { error: String(e) }; }
}
process.stdout.write(JSON.stringify(out));

// Lector GRIB edición 2 (OMM, FM 92) mínimo, para el pronóstico global GFS de la NOAA recortado a México por el filtro de
// NOMADS, que entrega cada campo con empaque simple (plantilla 5.0) en una malla latitud-longitud (plantilla 3.0). Ante
// cualquier otra cosa (otro empaque, mapa de bits, otra malla) lanza un error: el campo no se usa, nunca se adivina.
// Verificado contra ecCodes (ECMWF) valor por valor; ver scripts/clima/validar_grib.py.

export type CampoGrib = {
  disciplina: number; categoria: number; parametro: number; plantillaProducto: number;
  superficie: number; nivel: number; horaPronostico: number;
  ni: number; nj: number; lat1: number; lon1: number; lat2: number; lon2: number;
  /** Valores en filas de norte a sur y columnas de oeste a este (normalizado sea cual sea el barrido de la fuente). */
  valores: Float32Array;
};

const u = (b: Uint8Array, i: number, n: number) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + b[i + k]; return v; };
/** Enteros con signo de GRIB: el bit más alto es el signo y el resto la magnitud. */
const s = (b: Uint8Array, i: number, n: number) => { const v = u(b, i, n), m = 2 ** (8 * n - 1); return v >= m ? -(v - m) : v; };

export function leerGrib(b: Uint8Array): CampoGrib[] {
  const campos: CampoGrib[] = [];
  let p = 0;
  while (p + 16 <= b.length) {
    if (String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]) !== "GRIB") throw new Error(`GRIB: se esperaba «GRIB» en ${p}`);
    if (b[p + 7] !== 2) throw new Error(`GRIB: edición ${b[p + 7]} no soportada`);
    const total = u(b, p + 8, 8), fin = p + total, disciplina = b[p + 6];
    if (String.fromCharCode(b[fin - 4], b[fin - 3], b[fin - 2], b[fin - 1]) !== "7777") throw new Error("GRIB: mensaje sin «7777»");
    let q = p + 16;
    let malla: Omit<CampoGrib, "disciplina" | "categoria" | "parametro" | "plantillaProducto" | "superficie" | "nivel" | "horaPronostico" | "valores"> & { barrido: number } | null = null;
    let prod: { plantilla: number; categoria: number; parametro: number; superficie: number; nivel: number; hora: number } | null = null;
    let rep: { n: number; R: number; E: number; D: number; bits: number } | null = null;
    while (q < fin - 4) {
      const largo = u(b, q, 4), sec = b[q + 4];
      if (sec === 3) {
        if (u(b, q + 12, 2) !== 0) throw new Error("GRIB: malla distinta de latitud-longitud");
        const ni = u(b, q + 30, 4), nj = u(b, q + 34, 4);
        malla = { ni, nj, lat1: s(b, q + 46, 4) / 1e6, lon1: s(b, q + 50, 4) / 1e6, lat2: s(b, q + 55, 4) / 1e6, lon2: s(b, q + 59, 4) / 1e6, barrido: b[q + 71] };
      } else if (sec === 4) {
        const plantilla = u(b, q + 7, 2);
        // Plantillas 4.0 (instante) y 4.8 (estadística en un intervalo): el encabezado común es igual.
        prod = { plantilla, categoria: b[q + 9], parametro: b[q + 10], hora: u(b, q + 18, 4), superficie: b[q + 22], nivel: s(b, q + 24, 4) / 10 ** s(b, q + 23, 1) };
      } else if (sec === 5) {
        if (u(b, q + 9, 2) !== 0) throw new Error("GRIB: empaque distinto del simple (5.0)");
        const dv = new DataView(b.buffer, b.byteOffset + q + 11, 4);
        rep = { n: u(b, q + 5, 4), R: dv.getFloat32(0, false), E: s(b, q + 15, 2), D: s(b, q + 17, 2), bits: b[q + 19] };
      } else if (sec === 6) {
        if (b[q + 5] !== 255) throw new Error("GRIB: mapa de bits no soportado");
      } else if (sec === 7) {
        if (!malla || !prod || !rep) throw new Error("GRIB: datos antes de la malla, el producto o la representación");
        const { ni, nj, barrido } = malla;
        if (rep.n !== ni * nj) throw new Error(`GRIB: ${rep.n} puntos ≠ ${ni}×${nj}`);
        const crudos = new Float32Array(rep.n);
        const fE = 2 ** rep.E, fD = 10 ** rep.D;
        if (rep.bits === 0) crudos.fill(rep.R / fD);
        else {
          let bit = (q + 5) * 8;
          for (let k = 0; k < rep.n; k++) {
            let x = 0;
            for (let t = 0; t < rep.bits; t++, bit++) x = x * 2 + ((b[bit >> 3] >> (7 - (bit & 7))) & 1);
            crudos[k] = (rep.R + x * fE) / fD;
          }
        }
        // Barrido: bit 0x80 = i hacia el oeste; 0x40 = j hacia el norte; 0x20 = j consecutivo (no se usa en GFS).
        if (barrido & 0x20) throw new Error("GRIB: barrido por columnas no soportado");
        const valores = new Float32Array(rep.n);
        for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
          const fila = barrido & 0x40 ? nj - 1 - j : j, col = barrido & 0x80 ? ni - 1 - i : i;
          valores[fila * ni + col] = crudos[j * ni + i];
        }
        const norte = Math.max(malla.lat1, malla.lat2), sur = Math.min(malla.lat1, malla.lat2);
        const oeste = Math.min(malla.lon1, malla.lon2), este = Math.max(malla.lon1, malla.lon2);
        campos.push({ disciplina, categoria: prod.categoria, parametro: prod.parametro, plantillaProducto: prod.plantilla, superficie: prod.superficie, nivel: prod.nivel, horaPronostico: prod.hora, ni, nj, lat1: norte, lon1: oeste, lat2: sur, lon2: este, valores });
      }
      q += largo;
    }
    p = fin;
  }
  return campos;
}

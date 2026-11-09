// Decodificador BUFR edición 4 (OMM, FM 94) mínimo y sin dependencias, para leer en el Worker las observaciones sinópticas
// que el Servicio Meteorológico Nacional publica en WIS2. Cubre lo que usan sus mensajes: un subconjunto sin compresión,
// elementos de la tabla B, secuencias de la tabla D y replicación fija o diferida. Ante cualquier otra cosa (compresión,
// operadores 2XXXXX, descriptores fuera de la tabla) lanza un error: el mensaje queda marcado, nunca se adivina.
// Verificado contra ecCodes (ECMWF) valor por valor; ver scripts/clima/validar_bufr.py.
import { TABLA_B, TABLA_D } from "./bufr-tablas";

export type Elemento = { fxy: string; valor: number | string | null };
export type MensajeBufr = {
  edicion: number; centro: number; categoria: number; versionTablas: number;
  fechaTipica: string; subconjuntos: number; observado: boolean; elementos: Elemento[];
};

class Bits {
  private pos = 0;
  constructor(private readonly b: Uint8Array, inicio: number, private readonly fin: number) { this.pos = inicio * 8; }
  leer(n: number): number {
    if (this.pos + n > this.fin * 8) throw new Error("BUFR: la sección 4 se acabó antes que los descriptores");
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.b[(this.pos + i) >> 3];
      v = v * 2 + ((byte >> (7 - ((this.pos + i) & 7))) & 1);
    }
    this.pos += n;
    return v;
  }
}

const u = (b: Uint8Array, i: number, n: number) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + b[i + k]; return v; };

export function decodificarBufr(b: Uint8Array): MensajeBufr {
  if (b.length < 8 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== "BUFR") throw new Error("BUFR: no empieza con «BUFR»");
  const total = u(b, 4, 3), edicion = b[7];
  if (edicion !== 4) throw new Error(`BUFR: edición ${edicion} no soportada`);
  if (total !== b.length) throw new Error(`BUFR: longitud declarada ${total} ≠ recibida ${b.length}`);
  if (String.fromCharCode(b[total - 4], b[total - 3], b[total - 2], b[total - 1]) !== "7777") throw new Error("BUFR: no termina con «7777»");
  // Sección 1 (edición 4).
  let p = 8;
  const s1 = u(b, p, 3);
  const centro = u(b, p + 4, 2), opcional = (b[p + 9] & 0x80) !== 0, categoria = b[p + 10], versionTablas = b[p + 13];
  const pad = (n: number) => String(n).padStart(2, "0");
  const fechaTipica = `${u(b, p + 15, 2)}-${pad(b[p + 17])}-${pad(b[p + 18])}T${pad(b[p + 19])}:${pad(b[p + 20])}:${pad(b[p + 21])}Z`;
  p += s1;
  if (opcional) p += u(b, p, 3); // sección 2: datos locales, no se usan
  // Sección 3: descriptores.
  const s3 = u(b, p, 3), subconjuntos = u(b, p + 4, 2), banderas = b[p + 6];
  if (banderas & 0x40) throw new Error("BUFR: datos comprimidos no soportados");
  const raiz: string[] = [];
  for (let i = p + 7; i + 1 < p + s3; i += 2) {
    const f = b[i] >> 6, x = b[i] & 0x3f, y = b[i + 1];
    raiz.push(`${f}${String(x).padStart(2, "0")}${String(y).padStart(3, "0")}`);
  }
  p += s3;
  // Sección 4: datos.
  const s4 = u(b, p, 3);
  const bits = new Bits(b, p + 4, p + s4);
  const elementos: Elemento[] = [];
  const elemento = (fxy: string, esFactor = false): number | string | null => {
    const t = TABLA_B[fxy];
    if (!t) throw new Error(`BUFR: descriptor ${fxy} fuera de la tabla`);
    const [escala, referencia, ancho, texto] = t;
    let valor: number | string | null;
    if (texto) {
      let s = "", todos = true;
      for (let i = 0; i < ancho / 8; i++) { const c = bits.leer(8); if (c !== 0xff) todos = false; s += String.fromCharCode(c); }
      valor = todos ? null : s.replace(/[\0 ]+$/g, "");
    } else {
      const crudo = bits.leer(ancho);
      if (!esFactor && ancho > 1 && crudo === 2 ** ancho - 1) valor = null;
      else valor = (crudo + referencia) / 10 ** escala;
      if (valor !== null && escala > 0) valor = Number(valor.toFixed(escala));
    }
    elementos.push({ fxy, valor });
    return valor;
  };
  const procesar = (lista: readonly string[]): void => {
    for (let i = 0; i < lista.length; i++) {
      const d = lista[i], f = d[0];
      if (f === "0") elemento(d);
      else if (f === "3") { const seq = TABLA_D[d]; if (!seq) throw new Error(`BUFR: secuencia ${d} fuera de la tabla`); procesar(seq); }
      else if (f === "1") {
        const x = Number(d.slice(1, 3)), y = Number(d.slice(3));
        let veces = y;
        if (y === 0) { const factor = lista[++i]; if (!factor?.startsWith("031")) throw new Error(`BUFR: replicación diferida sin factor (${factor})`); veces = Number(elemento(factor, true)); }
        const grupo = lista.slice(i + 1, i + 1 + x);
        if (grupo.length !== x) throw new Error(`BUFR: replicación ${d} pide ${x} descriptores y hay ${grupo.length}`);
        for (let k = 0; k < veces; k++) procesar(grupo);
        i += x;
      } else throw new Error(`BUFR: operador ${d} no soportado`);
    }
  };
  for (let sub = 0; sub < subconjuntos; sub++) procesar(raiz);
  return { edicion, centro, categoria, versionTablas, fechaTipica, subconjuntos, observado: (banderas & 0x80) !== 0, elementos };
}

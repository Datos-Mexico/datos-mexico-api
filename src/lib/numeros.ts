// Redondeo con la misma semántica que round() de Python: sobre el valor exacto del
// double, empates a la cifra par. toFixed redondea empates hacia arriba, así que
// se detecta el empate exacto en la expansión decimal completa y se resuelve a mano.
export function redondear(x: number, n: number): number {
  if (!Number.isFinite(x)) return x;
  const exacto = Math.abs(x).toFixed(60); // expansión decimal exacta para |x| < 2^53 con ≤ 52 bits fraccionales
  const punto = exacto.indexOf(".");
  const entero = exacto.slice(0, punto);
  const frac = exacto.slice(punto + 1);
  const cola = frac.slice(n);
  const esEmpate = cola[0] === "5" && /^0*$/.test(cola.slice(1));
  let resultado: number;
  if (!esEmpate) {
    resultado = Number(Math.abs(x).toFixed(n));
  } else {
    // truncar a n decimales y decidir por paridad del último dígito conservado
    const base = entero + (n > 0 ? "." + frac.slice(0, n) : "");
    const ultimo = n > 0 ? Number(frac[n - 1]) : Number(entero[entero.length - 1]);
    let v = Number(base);
    if (ultimo % 2 === 1) v = Number((v + Math.pow(10, -n)).toFixed(n));
    resultado = v;
  }
  return x < 0 ? -resultado : resultado;
}

// repr() de Python para cadenas: comillas simples salvo que contenga una simple y ninguna doble.
export function repr(s: string): string {
  if (s.includes("'") && !s.includes('"')) return `"${s}"`;
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

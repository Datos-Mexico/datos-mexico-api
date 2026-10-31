// La insignia viva del Protocolo DPM (INSIGNIA.md): la sirve el pulso y dice solo lo que el pulso sabe.
import type { Clase } from "./comun";

const ANCHO_CARACTER = 6.4, RELLENO = 10, ALTO = 20;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function textoInsignia(estado: "declarada" | "verificada", clase: Clase | null): string {
  if (estado === "declarada") return "adhesión declarada";
  return clase ?? "adhesión verificada";
}
export function svgInsignia(derecha: string, estado: "declarada" | "verificada", clase: Clase | null): string {
  const izquierda = "Protocolo DPM";
  const wi = Math.round(izquierda.length * ANCHO_CARACTER + RELLENO * 2);
  const wd = Math.round(derecha.length * ANCHO_CARACTER + RELLENO * 2);
  const color = estado === "declarada" ? "#6b7280" : clase ? "#166534" : "#1d4ed8";
  const titulo = `Sistema adherido al Protocolo DPM de Datos México: ${derecha}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${wi + wd}" height="${ALTO}" role="img" aria-label="${esc(titulo)}">
<title>${esc(titulo)}</title>
<rect width="${wi}" height="${ALTO}" fill="#111111"/>
<rect x="${wi}" width="${wd}" height="${ALTO}" fill="${color}"/>
<g fill="#ffffff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
<text x="${wi / 2}" y="14">${esc(izquierda)}</text>
<text x="${wi + wd / 2}" y="14">${esc(derecha)}</text>
</g>
</svg>
`;
}

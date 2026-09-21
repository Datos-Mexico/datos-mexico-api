// Búsqueda tolerante para los catálogos del INEGI: sin acentos ni mayúsculas y con sinónimos del lenguaje común hacia
// el vocabulario del INEGI («desempleo» → «desocupada»; «inflación» → «precios al consumidor»). La columna `busqueda`
// de cada catálogo guarda el texto ya normalizado (scripts/bise_busqueda_d1.py), así que D1 solo hace LIKE.
export function sinAcentos(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Cada entrada: término del usuario (normalizado) → términos del INEGI que también se buscan. */
const SINONIMOS: Record<string, string[]> = {
  desempleo: ["desocupada", "desocupacion", "desocupados"], desocupacion: ["desocupada", "desocupados"], desocupado: ["desocupada", "desocupacion"], desempleados: ["desocupada", "desocupados"], paro: ["desocupada"],
  empleo: ["ocupada", "ocupados", "trabajadores"], ocupacion: ["ocupada", "ocupados"], trabajo: ["ocupada", "ocupacion", "trabajadores", "empleo"],
  informalidad: ["informal"], subempleo: ["subocupada", "subocupacion"],
  inflacion: ["precios al consumidor", "inpc", "indice nacional de precios"], inpc: ["precios al consumidor", "indice nacional de precios"], precios: ["precios", "inpc"],
  pib: ["producto interno bruto", "pib"], "producto interno bruto": ["pib"], igae: ["indicador global de la actividad economica", "igae"],
  natalidad: ["nacimientos", "nacidos", "fecundidad"], nacimientos: ["natalidad", "nacidos"], mortalidad: ["defunciones", "muertes"], muertes: ["defunciones"], defunciones: ["mortalidad", "muertes"],
  poblacion: ["poblacion", "habitantes"], habitantes: ["poblacion"],
  salario: ["remuneraciones", "salarios", "sueldos", "salario minimo"], sueldo: ["remuneraciones", "salarios", "sueldos"], ingresos: ["ingreso", "remuneraciones"],
  pobreza: ["pobreza", "linea de pobreza", "carencia"], vivienda: ["viviendas", "vivienda"], viviendas: ["vivienda"],
  escuela: ["escolar", "educacion", "escolaridad"], educacion: ["escolar", "escolaridad", "educativo"], analfabetismo: ["analfabeta", "alfabetismo"],
  homicidios: ["homicidio", "defunciones por homicidio", "presuntos delitos registrados como homicidio"], delincuencia: ["delitos", "delictiva", "victimizacion"], inseguridad: ["inseguridad", "percepcion de la inseguridad"], crimen: ["delitos"],
  exportaciones: ["exportacion", "exportador"], importaciones: ["importacion"], comercio: ["comercio", "comercial"],
  turismo: ["turistas", "turistica", "turismo"], salud: ["salud", "medicos", "hospital"], medicos: ["medicos", "personal medico"],
  agua: ["agua", "hidrico"], electricidad: ["energia electrica", "electrica"], internet: ["internet", "tic", "tecnologias de la informacion"],
  migracion: ["migracion", "migrante", "migrantes"], remesas: ["remesas"], indigena: ["indigena", "lengua indigena", "hablantes"],
  discapacidad: ["discapacidad"], hogares: ["hogares", "hogar"], matrimonios: ["matrimonios", "nupcialidad"], divorcios: ["divorcios", "nupcialidad"],
  automoviles: ["vehiculos", "automotor", "automotriz"], vehiculos: ["vehiculos", "automotor"], gasolina: ["gasolinas", "combustibles"],
  manufactura: ["manufacturera", "manufactureras", "manufacturas", "industrias manufactureras"], industria: ["industrial", "industrias"], construccion: ["construccion", "obra"],
  mineria: ["minera", "mineria", "extraccion"], agricultura: ["agricola", "agropecuario", "cultivos"], ganaderia: ["pecuario", "ganado"],
};

/** Términos a buscar (normalizados, sin repetidos): el texto del usuario y sus sinónimos; la búsqueda es «alguno de estos». */
export function terminosDe(q: string): string[] {
  const base = sinAcentos(q);
  if (!base) return [];
  const out = [base]; const palabras = base.split(" ");
  // un sinónimo aplica si el término es toda la consulta, una palabra completa de ella o (si tiene varias palabras) una frase contenida
  for (const [k, vs] of Object.entries(SINONIMOS)) if (base === k || (k.includes(" ") ? base.includes(k) : palabras.includes(k))) for (const v of vs) if (!out.includes(v)) out.push(v);
  return out.slice(0, 8);
}

/** Condición SQL `(col LIKE ? OR col LIKE ? …)` con sus parámetros, sobre una columna ya normalizada. */
export function condicionBusqueda(columna: string, q: string): { sql: string; params: string[]; orden: string; ordenParams: string[] } {
  const t = terminosDe(q);
  if (!t.length) return { sql: "1=1", params: [], orden: "0", ordenParams: [] };
  // orden: primero lo que contiene el texto tal cual, luego lo que solo coincide por sinónimo
  return { sql: `(${t.map(() => `${columna} LIKE ?`).join(" OR ")})`, params: t.map((x) => `%${x}%`), orden: `CASE WHEN ${columna} LIKE ? THEN 0 ELSE 1 END`, ordenParams: [`%${t[0]}%`] };
}

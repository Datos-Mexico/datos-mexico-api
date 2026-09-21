// Capa de cubos: una descripción declarativa por tabla consultable (medidas, dimensiones, jerarquías) que un solo
// motor traduce a SQL con parámetros ligados. Es lo que consume el explorador del observatorio (datosmexico.org/observatorio)
// y lo que hace que cada tabla del explorador tenga una URL de la API que la reproduce exactamente.
import type { Env } from "../index";

export type Medida = {
  clave: string;
  titulo: string;
  /** Expresión SQL agregada (SUM(x), COUNT(*), AVG(x), SUM(a*f)/SUM(f)). Nunca lleva texto del usuario. */
  sql: string;
  unidad?: string;
  /** true si sumar la medida entre miembros de una dimensión tiene sentido (conteos, montos); false para tasas, promedios y precios. */
  sumable: boolean;
  decimales?: number;
  descripcion?: string;
};

export type MiembroVirtual = {
  id: string;
  nombre: string;
  /** Por medida compatible, la expresión SQL agregada que corresponde a este miembro (una columna de la tabla ancha). */
  sql: Record<string, string>;
};

export type Dimension = {
  clave: string;
  titulo: string;
  /** Expresión SQL del identificador del miembro (columna o expresión sobre la cláusula FROM). */
  id: string;
  /** Expresión SQL del nombre legible; si falta, el identificador es el nombre. */
  nombre?: string;
  tipo: "categorica" | "temporal" | "geografica";
  /** Para dimensiones geográficas: nivel INEGI del identificador (o de `claves_geo`). */
  geo?: "entidad" | "municipio" | "localidad";
  /** Si el identificador no es la clave INEGI, la correspondencia id → clave INEGI (se agrega como columna `<clave>_cve`). */
  claves_geo?: Record<string, string>;
  /** Clave de la dimensión padre en una jerarquía (entidad ← municipio ← localidad). */
  padre?: string;
  /** Expresión SQL para ordenar miembros (por omisión, el identificador). */
  orden?: string;
  /** Origen alterno de los miembros (catálogo) cuando agrupar la tabla de hechos sería demasiado caro: cláusula FROM y expresiones de id y nombre sobre ella. */
  miembros?: { desde: string; id: string; nombre: string; donde?: string; orden?: string; /** Columna ya normalizada (sin acentos, minúsculas) sobre la que `q` busca con sinónimos (src/lib/busqueda.ts); si falta, LIKE sobre nombre e id. */ buscar?: string };
  /** Dimensión virtual: sus miembros son columnas de una tabla ancha; la consulta se despliega en el worker. */
  virtual?: MiembroVirtual[];
  /**
   * Dimensión de partición: sus miembros son universos que se contienen (país ⊃ entidades ⊃ municipios), de modo que
   * agregar a través de ellos suma varias veces lo mismo. Toda consulta debe filtrarla o llevarla en columnas; también
   * basta que alguna de las dimensiones de `implicita_en` vaya en columnas (agrupar por geografía ya separa los niveles).
   */
  particion?: { implicita_en?: string[] };
  descripcion?: string;
};

export type Cubo = {
  clave: string;
  nombre: string;
  tema: string;
  descripcion: string;
  fuente: string;
  fuente_url: string;
  licencia: string;
  binding: keyof Env;
  /** Cláusula FROM (tabla con sus joins a catálogos). */
  desde: string;
  /** Condición base (sin parámetros) que define el universo del cubo. */
  donde?: string;
  medidas: Medida[];
  dimensiones: Dimension[];
  /** Consulta inicial del explorador. */
  predeterminado: { medidas: string[]; columnas: string[]; filtros?: Record<string, string[]> };
  /** SQL que devuelve el corte más reciente (columna `corte`), o null. */
  sql_corte: string | null;
  notas: string[];
  /** Dimensiones que deben llevar filtro en toda consulta (tablas de hechos demasiado grandes para agrupar enteras). */
  filtro_obligatorio?: string[];
  /** Prefijo de los endpoints del dominio donde vive el mismo dato con más detalle. */
  api_dominio: string;
};

export type Tema = { clave: string; nombre: string; descripcion: string };

export type Consulta = {
  medidas: string[];
  columnas: string[];
  filtros: Record<string, string[]>;
  padres: boolean;
  orden: string | null;
  sentido: "asc" | "desc";
  limite: number | null;
};

export type ColumnaResultado = { clave: string; titulo: string; tipo: "id" | "dimension" | "geo" | "medida"; dimension?: string; unidad?: string; sumable?: boolean };

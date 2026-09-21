// Temas y cubos publicados. El orden es el del explorador.
import type { Cubo, Tema } from "../tipos";
import { ANUIES_EDADES, ANUIES_MATRICULA, ANUIES_PROCEDENCIA, ANUIES_TRAYECTORIA } from "./anuies";
import { ENOE_ENTIDAD, ENOE_NACIONAL, ENOE_POSICION, ENOE_SECTOR } from "./enoe";
import { CONSAR_ACTIVO, CONSAR_COMISIONES, CONSAR_CUENTAS, CONSAR_FLUJOS, CONSAR_PRECIOS, CONSAR_RECURSOS, CONSAR_RENDIMIENTOS, CONSAR_TRASPASOS } from "./consar";
import { CENSO_ITER } from "./censo2020";
import { CENSO_CARACTERISTICAS, CENSO_HOGARES } from "./censo2020_mas";
import { ENIGH_HOGARES } from "./enigh";
import { BISE_INDICADORES } from "./bise";
// import { BIE_SERIES } from "./bie_series"; // se publica cuando termine la carga del BIE (scripts/bie_d1.py)
import { DENUE_UNIDADES } from "./denue";
import { CDMX_NOMBRAMIENTOS } from "./cdmx";
import { UNAM_CONCURSO } from "./unam";
import { DEF_CAUSA, DEF_LISTA, DEF_MUNICIPIO, NAC_MADRE, NAC_MUNICIPIO } from "./vitales";
import { ENIGH_GASTOS, ENIGH_INGRESOS, ENIGH_PERSONAS, ENIGH_VIVIENDAS } from "./enigh_mas";
import { ENSU_PERCEPCION, ENVIPE_PERCEPCION } from "./seguridad";

export const TEMAS: Tema[] = [
  { clave: "educacion-superior", nombre: "Educación superior", descripcion: "Anuario Estadístico de Educación Superior (ANUIES): todas las instituciones, 2000-2001 a 2025-2026." },
  { clave: "trabajo", nombre: "Trabajo", descripcion: "Encuesta Nacional de Ocupación y Empleo (INEGI): indicadores trimestrales por entidad." },
  { clave: "retiro", nombre: "Ahorro para el retiro", descripcion: "Sistema de Ahorro para el Retiro (CONSAR): recursos, comisiones, cuentas, rendimientos, traspasos y flujos por AFORE." },
  { clave: "poblacion", nombre: "Población", descripcion: "Censo de Población y Vivienda 2020 (INEGI) por localidad, municipio y entidad; nacimientos registrados 1985-2024 y defunciones registradas 1990-2024 por municipio, causa y edad." },
  { clave: "economia", nombre: "Economía", descripcion: "Unidades económicas del DENUE (INEGI) por lugar, actividad y tamaño." },
  { clave: "ingreso-gasto", nombre: "Ingreso y gasto de los hogares", descripcion: "ENIGH 2024 (INEGI): hogares, personas, viviendas, ingresos por fuente y gastos por rubro, por entidad, decil y tipo de hogar." },
  { clave: "seguridad", nombre: "Seguridad pública", descripcion: "Percepción de inseguridad: ENVIPE (anual, por entidad, 2017-2026) y ENSU (trimestral, por ciudad, 2016-2026), del INEGI." },
  { clave: "cdmx", nombre: "Gobierno de la Ciudad de México", descripcion: "Padrón de remuneraciones de servidores públicos de la CDMX." },
  { clave: "unam", nombre: "UNAM", descripcion: "Concurso de Selección a licenciatura (dataset del observatorio)." },
  { clave: "inegi", nombre: "Bancos de indicadores del INEGI", descripcion: "Banco de Indicadores (31,039 indicadores con datos por país, entidad y municipio) y Banco de Información Económica (89 mil series económicas: inflación, PIB, IGAE, comercio exterior, coyuntura)." },
];

export const CUBOS: Cubo[] = [
  ANUIES_MATRICULA, ANUIES_TRAYECTORIA, ANUIES_EDADES, ANUIES_PROCEDENCIA,
  ENOE_ENTIDAD, ENOE_NACIONAL, ENOE_SECTOR, ENOE_POSICION,
  CONSAR_RECURSOS, CONSAR_COMISIONES, CONSAR_CUENTAS, CONSAR_ACTIVO, CONSAR_RENDIMIENTOS, CONSAR_TRASPASOS, CONSAR_FLUJOS, CONSAR_PRECIOS,
  CENSO_ITER, CENSO_CARACTERISTICAS, CENSO_HOGARES, NAC_MUNICIPIO, NAC_MADRE, DEF_MUNICIPIO, DEF_CAUSA, DEF_LISTA, DENUE_UNIDADES, ENIGH_HOGARES, ENIGH_PERSONAS, ENIGH_VIVIENDAS, ENIGH_GASTOS, ENIGH_INGRESOS, ENVIPE_PERCEPCION, ENSU_PERCEPCION, CDMX_NOMBRAMIENTOS, UNAM_CONCURSO, BISE_INDICADORES,
];

// Invariantes de las definiciones (fallan al arrancar el worker, no en producción a media consulta).
for (const c of CUBOS) {
  if (!TEMAS.some((t) => t.clave === c.tema)) throw new Error(`cubo ${c.clave}: tema ${c.tema} no existe`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.clave)) throw new Error(`cubo ${c.clave}: clave inválida`);
  const claves = new Set<string>();
  for (const x of [...c.medidas, ...c.dimensiones]) { if (claves.has(x.clave)) throw new Error(`cubo ${c.clave}: clave repetida ${x.clave}`); claves.add(x.clave); if (!/^[a-z0-9_]+$/.test(x.clave)) throw new Error(`cubo ${c.clave}: clave inválida ${x.clave}`); }
  for (const d of c.dimensiones) if (d.padre && !c.dimensiones.some((p) => p.clave === d.padre)) throw new Error(`cubo ${c.clave}: padre ${d.padre} de ${d.clave} no existe`);
  for (const m of c.predeterminado.medidas) if (!c.medidas.some((x) => x.clave === m)) throw new Error(`cubo ${c.clave}: medida predeterminada ${m} no existe`);
  for (const d of c.predeterminado.columnas) if (!c.dimensiones.some((x) => x.clave === d)) throw new Error(`cubo ${c.clave}: columna predeterminada ${d} no existe`);
  for (const f of Object.keys(c.predeterminado.filtros ?? {})) if (!c.dimensiones.some((x) => x.clave === f)) throw new Error(`cubo ${c.clave}: filtro predeterminado ${f} no existe`);
  for (const f of c.filtro_obligatorio ?? []) if (!c.predeterminado.filtros?.[f]?.length) throw new Error(`cubo ${c.clave}: el filtro obligatorio ${f} no está en el predeterminado`);
}
if (new Set(CUBOS.map((c) => c.clave)).size !== CUBOS.length) throw new Error("cubos con clave repetida");

export const cuboPorClave = (clave: string): Cubo | undefined => CUBOS.find((c) => c.clave === clave);

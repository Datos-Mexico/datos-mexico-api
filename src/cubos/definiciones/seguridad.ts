// Percepción de inseguridad del INEGI: ENVIPE (anual, por entidad, 2017-2026) y ENSU (trimestral, por ciudad,
// 2016-2026), agregadas por scripts/seguridad_d1.py desde los microdatos oficiales (D1 datosmexico-api-seguridad).
// La ENVIPE reproduce el indicador 6200118581 del Banco de Indicadores (país y 32 entidades, a la milésima); la ENSU
// reproduce ciudad por ciudad el cuadro 1.7 de los tabulados básicos de junio 2026.
import type { Cubo, Medida } from "../tipos";

const MEDIDAS: Medida[] = [
  { clave: "personas", titulo: "Personas de 18 años y más", sql: "SUM(d.personas)", unidad: "personas", sumable: true, descripcion: "Población de 18 años y más representada (factor de expansión)." },
  { clave: "inseguro", titulo: "Se sienten inseguras", sql: "SUM(d.inseguro)", unidad: "personas", sumable: true },
  { clave: "seguro", titulo: "Se sienten seguras", sql: "SUM(d.seguro)", unidad: "personas", sumable: true },
  { clave: "pct_inseguro", titulo: "Porcentaje que se siente inseguro", sql: "100.0 * SUM(d.inseguro) / SUM(d.personas)", unidad: "%", sumable: false, decimales: 2, descripcion: "Inseguras entre todas las personas de 18 y más (incluidas las que no saben), como lo publica el INEGI." },
  { clave: "pct_seguro", titulo: "Porcentaje que se siente seguro", sql: "100.0 * SUM(d.seguro) / SUM(d.personas)", unidad: "%", sumable: false, decimales: 2 },
];

export const ENVIPE_PERCEPCION: Cubo = {
  clave: "envipe-percepcion", nombre: "Percepción de inseguridad (ENVIPE)", tema: "seguridad",
  fuente: "INEGI — Encuesta Nacional de Victimización y Percepción sobre Seguridad Pública (ENVIPE), microdatos TPer_Vic1", fuente_url: "https://www.inegi.org.mx/programas/envipe/", licencia: "Términos de libre uso INEGI",
  descripcion: "Personas de 18 años y más que consideran inseguro vivir en su colonia, municipio o entidad, por edición (2017-2026, sin 2020; cada edición pregunta por el momento de la entrevista), entidad y sexo. El porcentaje de inseguridad en la colonia es el indicador «Percepción de la inseguridad» del Banco de Indicadores del INEGI.",
  binding: "DB_SEGURIDAD", desde: "envipe_percepcion d JOIN cat_entidad e ON e.clave = d.ent JOIN cat_sexo s ON s.clave = d.sexo JOIN cat_ambito a ON a.clave = d.ambito",
  medidas: MEDIDAS,
  dimensiones: [
    { clave: "anio", titulo: "Edición", id: "d.anio", tipo: "temporal", descripcion: "Año de la edición de la ENVIPE (levantada entre marzo y abril de ese año); 2020 no se publica." },
    { clave: "entidad", titulo: "Entidad", id: "substr('0' || d.ent, -2)", nombre: "e.nombre", tipo: "geografica", geo: "entidad", orden: "1" },
    { clave: "sexo", titulo: "Sexo", id: "d.sexo", nombre: "s.nombre", tipo: "categorica", orden: "1" },
    { clave: "ambito", titulo: "Ámbito", id: "d.ambito", nombre: "a.nombre", tipo: "categorica", orden: "CASE d.ambito WHEN 'colonia' THEN 1 WHEN 'municipio' THEN 2 ELSE 3 END", descripcion: "Colonia, municipio o entidad: elija uno (las personas son las mismas en los tres; sumar ámbitos las cuenta tres veces).", particion: {} },
  ],
  predeterminado: { medidas: ["pct_inseguro", "personas"], columnas: ["entidad"], filtros: { anio: ["2026"], ambito: ["colonia"] } },
  sql_corte: "SELECT MAX(anio) AS corte FROM envipe_percepcion",
  notas: ["Verificado: el porcentaje de inseguridad en la colonia reproduce el indicador 6200118581 del INEGI en el país y las 32 entidades en cada edición (diferencia < 0.005 puntos).", "La edición 2020 no se publica: con ningún factor de la tabla se reproduce el 48.74 % que el INEGI publica para ese año (los microdatos dan 42.93 %).", "Los porcentajes no se suman entre entidades ni ediciones: agrúpelos siempre con la dimensión que quiera comparar.", "La tasa de prevalencia delictiva no se publica: ninguna reconstrucción desde el módulo de victimización reprodujo la cifra oficial."],
  api_dominio: "/api/v1/inegi/datos-abiertos/programas/envipe",
};

export const ENSU_PERCEPCION: Cubo = {
  clave: "ensu-percepcion", nombre: "Percepción de inseguridad por ciudad (ENSU)", tema: "seguridad",
  fuente: "INEGI — Encuesta Nacional de Seguridad Pública Urbana (ENSU), microdatos CB", fuente_url: "https://www.inegi.org.mx/programas/ensu/", licencia: "Términos de libre uso INEGI",
  descripcion: "Personas de 18 años y más que consideran inseguro vivir en su ciudad, por trimestre (septiembre 2016 a junio 2026), ciudad de interés (hasta 90) y sexo (desde 2021).",
  binding: "DB_SEGURIDAD", desde: "ensu_percepcion d JOIN cat_ciudad c ON c.clave = d.ciudad LEFT JOIN cat_entidad e ON e.clave = c.ent JOIN cat_sexo s ON s.clave = d.sexo",
  medidas: MEDIDAS,
  dimensiones: [
    { clave: "periodo", titulo: "Trimestre", id: "d.periodo", tipo: "temporal", descripcion: "Mes de levantamiento (AAAA-MM): marzo, junio, septiembre y diciembre." },
    { clave: "entidad", titulo: "Entidad", id: "substr('0' || c.ent, -2)", nombre: "e.nombre", tipo: "geografica", geo: "entidad", orden: "1" },
    { clave: "ciudad", titulo: "Ciudad", id: "d.ciudad", nombre: "c.nombre", tipo: "categorica", padre: "entidad", orden: "c.nombre" },
    { clave: "sexo", titulo: "Sexo", id: "d.sexo", nombre: "s.nombre", tipo: "categorica", orden: "1", descripcion: "Antes de 2021 la tabla no trae sexo (clave 9)." },
  ],
  predeterminado: { medidas: ["pct_inseguro", "personas"], columnas: ["ciudad"], filtros: { periodo: ["2026-06"] } },
  sql_corte: "SELECT MAX(periodo) AS corte FROM ensu_percepcion",
  notas: ["Verificado contra el cuadro 1.7 de los tabulados básicos de junio 2026 del INEGI: población, «seguro» e «inseguro» exactos en todas las ciudades.", "Los porcentajes no se suman entre ciudades ni trimestres.", "Las ciudades de interés cambian con los años; una ciudad sin dato en un trimestre no se levantó ese trimestre."],
  api_dominio: "/api/v1/inegi/datos-abiertos/programas/ensu",
};

// ENDIREH 2021: prevalencia de violencia contra las mujeres de 15 años y más, con las banderas construidas por el INEGI
// (tabla TB_VD) por entidad y grupo de edad (scripts/endireh_d1.py). Exacta contra los cuadros 21.1 y 21.2 del INEGI.
const PCT = (col: string, titulo: string, base = "d.mujeres"): Medida => ({ clave: `pct_${col}`, titulo, sql: `100.0 * SUM(d.${col}) / SUM(${base})`, unidad: "%", sumable: false, decimales: 2 });
const N = (col: string, titulo: string): Medida => ({ clave: col, titulo, sql: `SUM(d.${col})`, unidad: "mujeres", sumable: true });
export const ENDIREH_VIOLENCIA: Cubo = {
  clave: "endireh-violencia", nombre: "Violencia contra las mujeres (ENDIREH 2021)", tema: "seguridad",
  fuente: "INEGI — Encuesta Nacional sobre la Dinámica de las Relaciones en los Hogares (ENDIREH) 2021, microdatos (tabla de violencia por ámbito)", fuente_url: "https://www.inegi.org.mx/programas/endireh/2021/", licencia: "Términos de libre uso INEGI",
  descripcion: "Mujeres de 15 años y más que han vivido violencia a lo largo de la vida y en los últimos 12 meses (total, psicológica, física, sexual, económica; escolar, laboral, comunitaria, familiar y de pareja), por entidad y grupo de edad, con las banderas que construye el propio INEGI y su factor. Reproduce los cuadros 21.1 y 21.2 de los tabulados del INEGI en el país y las 32 entidades.",
  binding: "DB_ENCUESTAS", desde: "endireh_violencia d JOIN cat_entidad e ON e.clave = d.ent",
  medidas: [
    N("mujeres", "Mujeres de 15 años y más"), N("con_pareja", "Con pareja alguna vez"),
    N("vtot_a", "Con violencia a lo largo de la vida"), PCT("vtot_a", "% violencia total a lo largo de la vida"), N("vtot_12m", "Con violencia en los últimos 12 meses"), PCT("vtot_12m", "% violencia total últimos 12 meses"),
    PCT("vpsi_a", "% psicológica (vida)"), PCT("vpsi_12m", "% psicológica (12 meses)"), PCT("vfis_a", "% física (vida)"), PCT("vfis_12m", "% física (12 meses)"), PCT("vsex_a", "% sexual (vida)"), PCT("vsex_12m", "% sexual (12 meses)"), PCT("veco_a", "% económica o patrimonial (vida)"), PCT("veco_12m", "% económica o patrimonial (12 meses)"),
    PCT("vesc_a", "% ámbito escolar (vida)"), PCT("vlab_a", "% ámbito laboral (vida)"), PCT("vcom_a", "% ámbito comunitario (vida)"), PCT("vfam", "% ámbito familiar (12 meses)"), PCT("vpar_a", "% de pareja (vida, entre mujeres con pareja alguna vez)", "d.con_pareja"), PCT("vpar_12m", "% de pareja (12 meses, entre mujeres con pareja alguna vez)", "d.con_pareja"),
  ],
  dimensiones: [
    { clave: "edicion", titulo: "Edición", id: "d.edicion", tipo: "temporal" },
    { clave: "entidad", titulo: "Entidad", id: "substr('0' || d.ent, -2)", nombre: "e.nombre", tipo: "geografica", geo: "entidad", orden: "1" },
    { clave: "edad", titulo: "Grupo de edad", id: "d.edad_grupo", tipo: "categorica", orden: "CASE d.edad_grupo WHEN '15-24' THEN 1 WHEN '25-34' THEN 2 WHEN '35-44' THEN 3 WHEN '45-54' THEN 4 WHEN '55-64' THEN 5 WHEN '65+' THEN 6 ELSE 7 END" },
  ],
  predeterminado: { medidas: ["pct_vtot_a", "pct_vtot_12m", "mujeres"], columnas: ["entidad"] },
  sql_corte: "SELECT MAX(edicion) AS corte FROM endireh_violencia",
  notas: ["Los porcentajes no se suman entre entidades ni grupos.", "Verificado: total y cuatro tipos de violencia, a lo largo de la vida y en los últimos 12 meses, iguales a los cuadros 21.1 y 21.2 del INEGI en las 33 geografías (±0.0005 puntos).", "La violencia de pareja se calcula sobre las mujeres que han tenido pareja alguna vez, como lo hace el INEGI."],
  api_dominio: "/api/v1/inegi/datos-abiertos/programas/endireh",
};

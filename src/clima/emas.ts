// Sonda diaria del portal de estaciones meteorológicas automáticas (EMAs) de CONAGUA, que publicaban cada 10 minutos. Al
// 2026-11-09 el portal no da datos de ninguna de sus 730 estaciones (todas en «emaError», reportes vacíos), por eso la medición
// oficial se toma de la red sinóptica horaria (decisión del CEO). Esta sonda pregunta una vez al día; si alguna estación vuelve
// a tener datos, queda registrado y la medición se migra a 10 minutos (con nota en la bitácora). Dos pedidos al día.
import type { Env } from "../index";

const CAPAS = "https://smn.conagua.gob.mx/tools/PHP/ConsultaCapas.php?tipo=EMAS&clave=0";
const REPORTE = "https://smn.conagua.gob.mx/tools/GUI/EMAS_reporte_v2.php?id=37&formato=txt&tipo=24h"; // Observatorio Mérida (ESIME)
const iso = (d: Date | number) => new Date(d).toISOString();

export async function sondearEmas(env: Env, ahora: Date, fetchImpl: typeof fetch = fetch): Promise<{ estaciones: number | null; con_datos: number | null; detalle: string }> {
  const fecha = iso(ahora).slice(0, 10);
  let estaciones: number | null = null, conDatos: number | null = null, detalle = "";
  try {
    const cab = { "user-agent": "datosmexico.org (observatorio; sonda EMAs)", referer: "https://smn.conagua.gob.mx/tools/GUI/EMAS.php" };
    const r = await fetchImpl(CAPAS, { headers: cab });
    if (!r.ok) throw new Error(`capas: HTTP ${r.status}`);
    const lista = (await r.json()) as { icono?: string }[];
    estaciones = lista.length;
    conDatos = lista.filter((x) => x.icono && x.icono !== "emaError").length;
    const t = await (await fetchImpl(REPORTE, { headers: cab })).text();
    const renglones = t.split("\n").filter((l) => /^\d{4}\/\d{2}\/\d{2}/.test(l.trim())).length;
    detalle = `${conDatos} de ${estaciones} estaciones fuera de «emaError»; reporte de 24 h del observatorio de Mérida con ${renglones} renglones de datos`;
  } catch (e) { detalle = `error: ${String(e).slice(0, 200)}`; }
  await env.DB_PLATAFORMA.prepare("INSERT OR REPLACE INTO clima_sonda_emas (fecha, estaciones, con_datos, detalle, consultado_en) VALUES (?, ?, ?, ?, ?)").bind(fecha, estaciones, conDatos, detalle, iso(ahora)).run();
  return { estaciones, con_datos: conDatos, detalle };
}

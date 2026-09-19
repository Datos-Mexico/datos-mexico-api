// Normalización de fechas al estilo del legacy: acepta YYYY-MM o YYYY-MM-01 y devuelve YYYY-MM-01.
import { ErrorHttp } from "./errores";

const RE_MES = /^(\d{4})-(\d{2})$/;
const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

export function primerDiaDelMes(valor: string, nombre: string): string {
  let m = RE_MES.exec(valor);
  if (m) return `${m[1]}-${m[2]}-01`;
  m = RE_DIA.exec(valor);
  if (m) return `${m[1]}-${m[2]}-01`;
  throw new ErrorHttp(422, [{ type: "value_error", loc: ["query", nombre], msg: `Value error, formato inválido: '${valor}' (esperado YYYY-MM o YYYY-MM-01)`, input: valor }]);
}

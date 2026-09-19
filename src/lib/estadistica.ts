// percentile_cont de Postgres reproducido sobre SQLite: posición (n-1)·p sobre los valores ordenados,
// interpolación lineal entre los dos vecinos. Devuelve null si no hay filas.
export async function percentilCont(db: D1Database, tabla: string, columna: string, where: string, ps: number[]): Promise<(number | null)[]> {
  const n = (await db.prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${where}`).first<{ n: number }>())!.n;
  if (n === 0) return ps.map(() => null);
  const res: (number | null)[] = [];
  for (const p of ps) {
    const pos = (n - 1) * p;
    const lo = Math.floor(pos);
    const filas = await db.prepare(`SELECT ${columna} AS v FROM ${tabla} WHERE ${where} ORDER BY ${columna} LIMIT 2 OFFSET ?1`).bind(lo).all<{ v: number }>();
    const v = filas.results.map((r) => Number(r.v));
    res.push(v.length === 1 || pos === lo ? v[0] : v[0] + (v[1] - v[0]) * (pos - lo));
  }
  return res;
}

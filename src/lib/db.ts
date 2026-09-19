// Acceso uniforme a D1 con parámetros posicionales.
export async function filas<T = Record<string, unknown>>(db: D1Database, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.prepare(sql).bind(...params).all<T>();
  return r.results ?? [];
}

export async function fila<T = Record<string, unknown>>(db: D1Database, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await db.prepare(sql).bind(...params).first<T>();
  return (r as T | null) ?? null;
}

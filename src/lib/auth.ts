// Autenticación con el mismo contrato que el legacy (FastAPI): OAuth2 password flow → JWT HS256
// (claims `sub` = username, `exp`), verificación de contraseñas bcrypt (los hashes migrados de Neon
// son $2b$), usuarios en la D1 datosmexico-api-plataforma. Errores idénticos:
// 401 {"detail":"Could not validate credentials"} con `WWW-Authenticate: Bearer`, 403 {"detail":"Admin privileges required"}.
import bcrypt from "bcryptjs";
import { contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { ErrorHttp } from "./errores";

export type Usuario = { id: number; username: string; email: string; hashed_password: string; is_active: number; is_admin: number; created_at: string };
export const MINUTOS_TOKEN = 30;

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = ""; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const deB64url = (s: string) => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0)); };
async function clave(secreto: string) { return crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }

export async function firmarToken(secreto: string, username: string, minutos = MINUTOS_TOKEN): Promise<string> {
  const cabecera = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const cuerpo = b64url(JSON.stringify({ sub: username, exp: Math.floor(Date.now() / 1000) + minutos * 60 }));
  const firma = b64url(await crypto.subtle.sign("HMAC", await clave(secreto), new TextEncoder().encode(`${cabecera}.${cuerpo}`)));
  return `${cabecera}.${cuerpo}.${firma}`;
}
export async function leerToken(secreto: string, token: string): Promise<{ sub?: string; exp?: number } | null> {
  try {
    const partes = token.split("."); if (partes.length !== 3) return null;
    const ok = await crypto.subtle.verify("HMAC", await clave(secreto), deB64url(partes[2]), new TextEncoder().encode(`${partes[0]}.${partes[1]}`));
    if (!ok) return null;
    const cuerpo = JSON.parse(new TextDecoder().decode(deB64url(partes[1])));
    if (typeof cuerpo.exp === "number" && cuerpo.exp < Date.now() / 1000) return null;
    return cuerpo;
  } catch { return null; }  // token malformado (base64 inválido, JSON roto) = inválido, nunca 500
}
export const verificarContrasena = (plana: string, hash: string) => bcrypt.compareSync(plana, hash);
export const hashContrasena = (plana: string) => bcrypt.hashSync(plana, 12);

const NO_VALIDO = () => new ErrorHttp(401, "Could not validate credentials", { "WWW-Authenticate": "Bearer" });

/** Usuario del JWT del header Authorization (get_current_user del legacy). */
export async function usuarioActual(c: AppContext): Promise<Usuario> {
  const auth = c.req.header("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) throw new ErrorHttp(401, "Not authenticated", { "WWW-Authenticate": "Bearer" });
  const cuerpo = await leerToken(c.env.SECRET_KEY, m[1].trim());
  if (!cuerpo || !cuerpo.sub) throw NO_VALIDO();
  const u = await c.env.DB_PLATAFORMA.prepare("SELECT id, username, email, hashed_password, is_active, is_admin, created_at FROM users WHERE username = ?").bind(cuerpo.sub).first<Usuario>();
  if (!u || !u.is_active) throw NO_VALIDO();
  return u;
}
/** require_admin del legacy. */
export async function requiereAdmin(c: AppContext): Promise<Usuario> {
  const u = await usuarioActual(c);
  if (!u.is_admin) throw new ErrorHttp(403, "Admin privileges required");
  return u;
}
export const SEGURIDAD = [{ OAuth2PasswordBearer: [] }];
const Detalle401 = z.object({ detail: z.string() });
export const RESP_401 = { "401": { description: "JWT ausente o inválido.", ...contentJson(Detalle401) } };
export const RESP_403 = { "403": { description: "Usuario autenticado sin privilegios admin.", ...contentJson(Detalle401) } };

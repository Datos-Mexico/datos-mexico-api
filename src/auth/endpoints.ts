// Autenticación — mismo contrato que el legacy: registro deshabilitado (403), OAuth2 password flow → JWT, perfil.
import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../index";
import { ErrorHttp } from "../lib/errores";
import { RESP_401, SEGURIDAD, firmarToken, usuarioActual, verificarContrasena, type Usuario } from "../lib/auth";
import type { Detalle } from "../lib/validacion";

const TAG = ["auth"];
const MENSAJE_REGISTRO = "Registration is currently disabled. Admin users are created via CLI (see api/scripts/create_admin.py). Contact project owner: df.avila.diaz@gmail.com";
const RESP_422 = { "422": { description: "Validation Error", ...contentJson(z.object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.union([z.string(), z.number()])), msg: z.string(), input: z.unknown() })) })) } };

export class AuthRegister extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "register_api_v1_auth_register_post", summary: "Registro de usuarios — deshabilitado",
    description: "Endpoint de registro de usuarios **intencionalmente deshabilitado**. La route existe en el código y siempre devuelve `403 Forbidden` con el mensaje correspondiente. Si en el futuro el observatorio decide abrir registro público, la route ya está lista en el contrato del API y sólo requiere reemplazar el cuerpo de la función por la lógica de creación. La provisión de cuentas admin se hace con `scripts/plataforma_usuario.py` (hash bcrypt directo a la D1 de plataforma); contacto: `df.avila.diaz@gmail.com`.",
    request: { body: contentJson(z.object({ username: z.string(), email: z.string(), password: z.string() })) },
    responses: { "403": { description: "Registro deshabilitado actualmente. La route existe en el código pero está intencionalmente bloqueada.", ...contentJson(z.object({ detail: z.string() })) }, ...RESP_422 },
  };
  async handle(c: AppContext) {
    let cuerpo: Record<string, unknown> = {};
    try { cuerpo = (await c.req.json()) as Record<string, unknown>; } catch { cuerpo = {}; }
    const faltan = ["username", "email", "password"].filter((k) => cuerpo[k] === undefined);
    if (faltan.length) throw new ErrorHttp(422, faltan.map((k) => ({ type: "missing", loc: ["body", k], msg: "Field required", input: cuerpo } satisfies Detalle)));
    throw new ErrorHttp(403, MENSAJE_REGISTRO);
  }
}

export class AuthToken extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "login_api_v1_auth_token_post", summary: "Obtener JWT por OAuth2 password flow",
    description: "Autenticación por OAuth2 password flow. Recibe `username` y `password` como `application/x-www-form-urlencoded` y devuelve un JWT bearer con vigencia de 30 minutos. El token debe enviarse en endpoints autenticados como `Authorization: Bearer <token>`. Algoritmo de firma: `HS256` (simétrico, secreto en la variable `SECRET_KEY` del worker). Las contraseñas se verifican con bcrypt contra los mismos hashes migrados del legacy.",
    request: { body: { content: { "application/x-www-form-urlencoded": { schema: z.object({ grant_type: z.string().regex(/^password$/).optional(), username: z.string(), password: z.string(), scope: z.string().default("").optional(), client_id: z.string().optional(), client_secret: z.string().optional() }) } } } },
    responses: { "200": { description: "Token JWT bearer emitido. Vigencia: 30 minutos.", ...contentJson(z.object({ access_token: z.string(), token_type: z.string() })) }, "401": { description: "Credenciales incorrectas (usuario inexistente o password no coincide).", ...contentJson(z.object({ detail: z.string() })) }, ...RESP_422 },
  };
  async handle(c: AppContext) {
    const form = await c.req.parseBody();
    const username = typeof form.username === "string" ? form.username : undefined; const password = typeof form.password === "string" ? form.password : undefined;
    const faltan = [["username", username], ["password", password]].filter(([, v]) => v === undefined).map(([k]) => k as string);
    if (faltan.length) throw new ErrorHttp(422, faltan.map((k) => ({ type: "missing", loc: ["body", k], msg: "Field required", input: null } satisfies Detalle)));
    const u = await c.env.DB_PLATAFORMA.prepare("SELECT id, username, email, hashed_password, is_active, is_admin, created_at FROM users WHERE username = ?").bind(username).first<Usuario>();
    if (!u || !verificarContrasena(password!, u.hashed_password)) throw new ErrorHttp(401, "Incorrect username or password", { "WWW-Authenticate": "Bearer" });
    return { access_token: await firmarToken(c.env.SECRET_KEY, u.username), token_type: "bearer" };
  }
}

const Perfil = z.object({ id: z.number().int(), username: z.string(), email: z.string(), is_active: z.boolean(), is_admin: z.boolean(), created_at: z.string() });
export class AuthMe extends OpenAPIRoute {
  schema = {
    tags: TAG, operationId: "get_me_api_v1_auth_me_get", summary: "Perfil del usuario autenticado", security: SEGURIDAD,
    description: "Devuelve el perfil del usuario asociado al JWT enviado en el header `Authorization`. Útil para que un cliente confirme la vigencia del token y obtenga su flag `is_admin`. No incluye el `hashed_password` ni datos sensibles.",
    responses: { "200": { description: "Perfil del usuario autenticado.", ...contentJson(Perfil) }, ...RESP_401 },
  };
  async handle(c: AppContext) {
    const u = await usuarioActual(c);
    return { id: u.id, username: u.username, email: u.email, is_active: !!u.is_active, is_admin: !!u.is_admin, created_at: u.created_at.replace(" ", "T") };
  }
}

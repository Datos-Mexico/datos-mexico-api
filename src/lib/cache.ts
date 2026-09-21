// Cache-Control por prefijo, igual que el CacheControlMiddleware del legacy.
import type { MiddlewareHandler } from "hono";
const PREFIJOS_NO_STORE = ["/api/v1/auth", "/api/v1/personas", "/api/v1/nombramientos", "/api/v1/ingest", "/api/v1/admin", "/api/v1/demo"];
function valor(path: string): string | null {
  if (PREFIJOS_NO_STORE.some((p) => path.startsWith(p))) return "no-store";
  // el catálogo y las fichas de los cubos cambian con cada despliegue: caché corta para que el explorador vea los cubos nuevos pronto
  if (path === "/api/v1/cubos" || /^\/api\/v1\/cubos\/[^/]+$/.test(path)) return "public, max-age=300";
  if (path.includes("/catalogos/") || path.startsWith("/api/v1/sectores")) return "public, max-age=3600";
  if (path.startsWith("/api/v1/dashboard")) return "public, max-age=3600";
  if (path.startsWith("/api/v1/analytics")) return "public, max-age=900";
  if (path.startsWith("/api/v1/enigh") || path.startsWith("/api/v1/comparativo") || path.startsWith("/api/v1/consar") || path.startsWith("/api/v1/enoe") || path.startsWith("/api/v1/inegi") || path.startsWith("/api/v1/denue") || path.startsWith("/api/v1/censo2020") || path.startsWith("/api/v1/anuies") || path.startsWith("/api/v1/unam") || path.startsWith("/api/v1/cubos")) return "public, max-age=3600";
  if (path.includes("/servidores/")) return "public, max-age=300";
  return null;
}
export const cacheControl: MiddlewareHandler = async (c, next) => {
  await next();
  const v = valor(new URL(c.req.url).pathname);
  if (!v) return;
  c.res.headers.set("Cache-Control", v);
  if (v !== "no-store") {
    const vary = (c.res.headers.get("Vary") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!vary.some((s) => s.toLowerCase() === "origin")) vary.push("Origin");
    c.res.headers.set("Vary", vary.join(", "));
  }
};

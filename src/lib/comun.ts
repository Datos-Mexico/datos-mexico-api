import { z } from "zod";
import { contentJson } from "chanfana";

// Documentación del 429 tal como la publica el legacy.
export const Error429 = z.object({ detail: z.string() });
export const RESP_429 = { "429": { description: "Rate limit excedido.", ...contentJson(Error429) } };

export const bool = (v: unknown): boolean => v === 1 || v === true || v === "1";

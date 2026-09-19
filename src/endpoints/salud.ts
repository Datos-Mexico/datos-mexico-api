import { OpenAPIRoute, contentJson } from "chanfana";
import { z } from "zod";
import { VERSION } from "../descripcion";

export class Salud extends OpenAPIRoute {
  schema = {
    tags: ["Sistema"],
    summary: "Estado del servicio",
    description: "Responde si la API está viva y qué versión corre.",
    responses: {
      "200": {
        description: "Servicio operando",
        ...contentJson(z.object({ status: z.literal("ok"), version: z.string(), hora_utc: z.string() })),
      },
    },
  };

  async handle() {
    return { status: "ok" as const, version: VERSION, hora_utc: new Date().toISOString() };
  }
}

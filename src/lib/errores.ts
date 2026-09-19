// Errores con la misma forma que el legacy (FastAPI): {"detail": ...}
export class ErrorHttp extends Error {
  constructor(public status: number, public detail: unknown) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
}

export function respuestaError(status: number, detail: unknown): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

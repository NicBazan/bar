import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const notFound = (what = "Recurso") => new HttpError(404, "NOT_FOUND", `${what} inexistente`);
export const forbidden = (code = "FORBIDDEN", msg?: string) => new HttpError(403, code, msg);
export const conflict = (code: string, msg?: string) => new HttpError(409, code, msg);

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ZodError) {
    return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
  }
  if (err instanceof HttpError) {
    return reply.status(err.status).send({ error: err.code, message: err.message });
  }
  const status = (err as FastifyError).statusCode;
  if (status && status < 500) {
    return reply.status(status).send({ error: (err as FastifyError).code ?? "BAD_REQUEST", message: err.message });
  }
  req.log.error(err);
  return reply.status(500).send({ error: "INTERNAL" });
}

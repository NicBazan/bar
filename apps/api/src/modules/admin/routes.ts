import type { FastifyInstance } from "fastify";
import { adminMenuRoutes } from "./menu.routes.js";
import { adminTablesRoutes } from "./tables.routes.js";
import { adminTeamRoutes } from "./team.routes.js";

/** Panel del dueño/encargado: carta, mesas y QR, equipo y datos del local */
export async function adminRoutes(app: FastifyInstance) {
  await app.register(adminMenuRoutes);
  await app.register(adminTablesRoutes);
  await app.register(adminTeamRoutes);
}

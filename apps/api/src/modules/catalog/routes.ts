import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getVenueMenu } from "./service.js";

export async function catalogRoutes(app: FastifyInstance) {
  // Pública y cacheable: la carta se puede leer sin sesión
  app.get("/venues/:venueId/menu", async (req, reply) => {
    const { venueId } = z.object({ venueId: z.uuid() }).parse(req.params);
    const menu = await getVenueMenu(venueId);
    reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
    return menu;
  });
}

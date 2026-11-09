import { config } from "./config.js";
import { buildApp } from "./app.js";
import { runAutomations } from "./modules/automations/runner.js";

const app = await buildApp();
await app.listen({ port: config.port, host: config.host });

// Avisos automáticos dentro del mismo proceso (PC, Render, Fly). En Vercel no hay proceso que quede
// vivo: ahí lo dispara Vercel Cron llamando a POST /v1/internal/automations/run con CRON_SECRET.
if (config.automationsEveryMin > 0) {
  let running = false; // nunca dos corridas solapadas en este proceso
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runAutomations();
      if (r.sent > 0) app.log.info(r, "avisos automáticos enviados");
    } catch (err) {
      app.log.error({ err }, "falló el motor de avisos automáticos");
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), config.automationsEveryMin * 60_000).unref();
  setTimeout(() => void tick(), 60_000).unref(); // primera corrida un minuto después de arrancar
}

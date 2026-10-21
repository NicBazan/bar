import { config } from "../../config.js";

export type Email = { to: string; subject: string; text: string; html?: string; headers?: Record<string, string> };

/**
 * Adaptador de envío de emails.
 * - console (local): el email se escribe en el log de la API (.mvp/logs/api.log) y queda en memoria
 *   para los tests. Nunca sale nada a internet.
 * - resend (producción): API HTTP de Resend, sin dependencias extra.
 */
const recent: Array<Email & { at: Date }> = [];

/** Solo fuera de producción: últimos emails "enviados" por el adaptador de consola (tests y dev) */
export function devOutbox(): ReadonlyArray<Email & { at: Date }> {
  return config.isProd ? [] : recent;
}

export async function sendEmail(email: Email): Promise<void> {
  if (config.email.provider === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.email.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: config.email.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: email.headers,
      }),
    });
    if (!res.ok) throw new Error(`Resend respondió ${res.status}`);
    return;
  }
  recent.push({ ...email, at: new Date() });
  if (recent.length > 200) recent.shift();
  console.log(`\n[EMAIL] Para: ${email.to}\n[EMAIL] Asunto: ${email.subject}\n${email.text}\n`);
}

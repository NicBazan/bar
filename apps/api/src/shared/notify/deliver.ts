import { config } from "../../config.js";
import { signUnsubToken } from "../auth/tokens.js";
import { sendEmail } from "../email/index.js";
import { sendPush } from "../push.js";

/**
 * Entrega de un aviso a UN cliente por los canales que aceptó (Web Push y/o email).
 * La usan las campañas del dueño y los avisos automáticos: una sola implementación de
 * la baja en un toque (Ley 25.326) y del escape de HTML.
 */

export type Recipient = {
  id: string;
  email: string;
  name: string | null;
  marketingOptInAt: Date | null;
  pushSubs: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>;
};

export type Message = { tenantId: string; venueName: string; title: string; body: string; url: string; linkLabel: string };

export type DeliveryResult = { pushSent: number; emailSent: boolean; goneSubs: string[] };

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Solo quien aceptó avisos de este bar por algún canal */
export const hasConsent = (c: Pick<Recipient, "marketingOptInAt" | "pushSubs">) => Boolean(c.marketingOptInAt) || c.pushSubs.length > 0;

export async function deliverToCustomer(c: Recipient, m: Message, onEmailError?: (e: unknown) => void): Promise<DeliveryResult> {
  const result: DeliveryResult = { pushSent: 0, emailSent: false, goneSubs: [] };
  for (const s of c.pushSubs) {
    const r = await sendPush(s, { title: `${m.venueName}: ${m.title}`, body: m.body, url: m.url, tid: m.tenantId });
    if (r === "sent") result.pushSent++;
    if (r === "gone") result.goneSubs.push(s.id);
  }
  if (c.marketingOptInAt) {
    try {
      await sendEmail(await emailFor(c, m));
      result.emailSent = true;
    } catch (e) {
      onEmailError?.(e);
    }
  }
  return result;
}

async function emailFor(c: Recipient, m: Message) {
  const token = await signUnsubToken(c.id, m.tenantId);
  const unsub = `${config.publicGuestUrl}/baja?t=${token}`;
  const oneClick = `${config.publicGuestUrl}/v1/customer/unsubscribe?t=${token}`;
  const hello = c.name ? `Hola ${c.name}:` : "";
  return {
    to: c.email,
    subject: `${m.venueName}: ${m.title}`,
    text: `${hello ? `${hello}\n\n` : ""}${m.body}\n\n${m.linkLabel}: ${m.url}\n\nNo quiero recibir más avisos de ${m.venueName}: ${unsub}`,
    html:
      `<p>${escapeHtml(hello)}</p><p>${escapeHtml(m.body)}</p>` +
      `<p><a href="${escapeHtml(m.url)}">${escapeHtml(m.linkLabel)}</a></p>` +
      `<p style="font-size:12px;color:#666"><a href="${escapeHtml(unsub)}">Darme de baja de los avisos de ${escapeHtml(m.venueName)}</a></p>`,
    headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

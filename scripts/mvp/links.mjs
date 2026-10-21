// Genera .mvp/LINKS.html: links y QR para abrir el MVP desde el celular.
// Uso (lo llama start-mvp.ps1): node scripts/mvp/links.mjs <archivo-json-de-entrada> <salida.html>
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// qrcode está instalado en staff-web (se usa para los QR del admin)
const QRCode = createRequire(path.join(root, "apps", "staff-web", "package.json"))("qrcode");

const [input, output] = process.argv.slice(2);
const data = JSON.parse(readFileSync(input, "utf8").replace(/^﻿/, ""));
// data = { lanIp, cartaTunnel, panelTunnel, tables: [{label, code}], startedAt }

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const qr = (url) => QRCode.toString(url, { type: "svg", margin: 1, width: 220, color: { dark: "#14110f", light: "#ffffff" } });

const firstTable = data.tables[0];
const lanCarta = data.lanIp ? `http://${data.lanIp}:3000` : null;
const lanPanel = data.lanIp ? `http://${data.lanIp}:3001` : null;

const blocks = [];
const lh = data.localHttps;
if (lh && firstTable) {
  blocks.push({
    title: `Carta · Mesa ${firstTable.label} (HTTPS en tu Wi-Fi, con cámara)`,
    url: `${lh.carta}/t/${firstTable.code}`,
    note: "Requiere instalar una vez el certificado del MVP en el celular (tarjeta de al lado).",
  });
  blocks.push({
    title: "1º: certificado del MVP (instalar una sola vez)",
    url: lh.ca,
    note: "Android: abrilo, se descarga; Ajustes → Seguridad → Encriptación y credenciales → Instalar certificado → Certificado CA. iPhone: abrilo en Safari, Ajustes → Perfil descargado → Instalar, y después Ajustes → General → Información → Confianza de certificados → activarlo.",
  });
}
if (data.cartaTunnel && firstTable) {
  blocks.push({
    title: `Carta · Mesa ${firstTable.label} (HTTPS, desde cualquier red)`,
    url: `${data.cartaTunnel}/t/${firstTable.code}`,
    note: "Con cámara y Realidad Aumentada. Si en tu Wi-Fi no abre, probá con datos móviles (el DNS del router bloquea trycloudflare.com).",
  });
}
if (lanCarta && firstTable) {
  blocks.push({
    title: `Carta · Mesa ${firstTable.label} (misma red Wi-Fi)`,
    url: `${lanCarta}/t/${firstTable.code}`,
    note: "Sin HTTPS: funciona todo menos la cámara/AR.",
  });
}
if (lh) blocks.push({ title: "Panel del local (HTTPS en tu Wi-Fi)", url: `${lh.panel}/login`, note: "" });
if (data.panelTunnel) blocks.push({ title: "Panel del local (HTTPS)", url: `${data.panelTunnel}/login`, note: "Mozo, cocina, admin y super admin." });
if (lanPanel) blocks.push({ title: "Panel del local (misma red Wi-Fi)", url: `${lanPanel}/login`, note: "" });

const cards = await Promise.all(
  blocks.map(
    async (b) => `
    <article class="card">
      <h2>${esc(b.title)}</h2>
      <div class="qr">${await qr(b.url)}</div>
      <a href="${esc(b.url)}">${esc(b.url)}</a>
      ${b.note ? `<p class="note">${esc(b.note)}</p>` : ""}
    </article>`,
  ),
);

const tableRows = data.tables
  .map((t) => {
    const links = [
      lh ? `<a href="${esc(`${lh.carta}/t/${t.code}`)}">HTTPS Wi-Fi</a>` : "",
      data.cartaTunnel ? `<a href="${esc(`${data.cartaTunnel}/t/${t.code}`)}">HTTPS túnel</a>` : "",
      lanCarta ? `<a href="${esc(`${lanCarta}/t/${t.code}`)}">Wi-Fi</a>` : "",
      `<a href="${esc(`http://localhost:3000/t/${t.code}`)}">esta PC</a>`,
    ]
      .filter(Boolean)
      .join(" · ");
    return `<tr><td>Mesa ${esc(t.label)}</td><td><code>${esc(t.code)}</code></td><td>${links}</td></tr>`;
  })
  .join("");

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bar MVP · Links</title>
<style>
  :root { --ink:#14110f; --surface:#1e1a17; --line:#3a322c; --cream:#f5ede3; --muted:#a89a8c; --amber:#f0a43a; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--ink); color:var(--cream); font:15px/1.5 system-ui, sans-serif; padding:24px 16px; }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { font-family: Georgia, serif; font-weight: 400; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 24px; }
  .grid { display:grid; gap:16px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:20px; padding:16px; }
  .card h2 { font-size:15px; margin:0 0 12px; }
  .qr { background:#fff; border-radius:12px; padding:8px; width:236px; }
  .qr svg { display:block; width:220px; height:220px; }
  a { color: var(--amber); word-break: break-all; }
  .note { color: var(--muted); font-size: 13px; margin: 8px 0 0; }
  table { width:100%; border-collapse: collapse; margin-top: 12px; }
  td, th { text-align:left; padding:8px; border-bottom:1px solid var(--line); }
  code { background:#2a2420; padding:2px 6px; border-radius:6px; }
  section { margin-top: 32px; }
  .creds td:first-child { color: var(--muted); }
</style>
</head>
<body>
<main>
  <h1>🍸 Bar MVP andando</h1>
  <p class="sub">Arrancado el ${esc(new Date(data.startedAt).toLocaleString("es-AR"))}. Escaneá un QR con el celular.</p>
  <div class="grid">${cards.join("")}</div>

  <section>
    <h2>Usuarios de prueba</h2>
    <table class="creds">
      <tr><td>Dueño (admin del bar)</td><td><code>dueno@bardemo.test</code> / <code>demo1234</code></td></tr>
      <tr><td>Mozo</td><td><code>mozo@bardemo.test</code> / <code>demo1234</code></td></tr>
      <tr><td>Cocina (KDS)</td><td><code>cocina@bardemo.test</code> / <code>demo1234</code></td></tr>
      <tr><td>Super admin (plataforma)</td><td><code>superadmin@bar.test</code> / <code>superadmin1234</code></td></tr>
    </table>
  </section>

  <section>
    <h2>Todas las mesas</h2>
    <table>${tableRows}</table>
  </section>

  <section>
    <h2>Cómo probar el flujo completo</h2>
    <ol>
      <li>Celular: escaneá la carta → <b>Abrir Carta / Unirse a Mesa</b>.</li>
      <li>En la PC: panel → entrá como <b>mozo</b> → <b>Abrir mesa</b>.</li>
      <li>Celular: agregá platos (probá la Tostada de palta en 3D) → <b>Confirmar y Enviar</b>.</li>
      <li>Mozo: <b>Confirmar y enviar a cocina</b>. Cocina (KDS): <b>Empezar</b> → <b>Listo</b>.</li>
      <li>Mientras esperás: <b>🕹️ Sudoku</b> en la carta.</li>
      <li>Dueño: <b>Admin</b> para editar la carta, marcar agotados, imprimir QR y sumar al equipo.</li>
    </ol>
    <p class="note">Sobre el certificado del MVP: lo genera tu PC solo para esta demo (su clave privada no sale de la carpeta .mvp). Cuando termines de probar, podés quitarlo del celular desde la misma pantalla de credenciales.</p>
    <p class="note">Para apagar todo: doble clic en <code>DETENER-MVP.cmd</code>. Para volver a prenderlo: <code>INICIAR-MVP.cmd</code>. Logs en <code>.mvp/logs</code>.</p>
  </section>
</main>
</body>
</html>`;

writeFileSync(output, html, "utf8");
console.log(`LINKS listo: ${output}`);

// Prueba de humo contra el MVP ya arrancado (servidores de producción, a través de los rewrites):
// escanear → abrir mesa → pedir → confirmar → cocina → listo → llamar al mozo → cerrar.
// Uso: node scripts/mvp/smoke.mjs [urlCarta] [urlPanel] [codigoDeMesa]
const [carta = "http://localhost:3000", panel = "http://localhost:3001", code] = process.argv.slice(2);
const ok = (cond, msg) => {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
};
async function call(base, path, { method = "GET", token, body, headers = {} } = {}) {
  const res = await fetch(`${base}/v1${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const login = async (email, password) => (await call(panel, "/staff/login", { method: "POST", body: { email, password } })).data.token;

const mozo = await login("mozo@bardemo.test", "demo1234");
const cocina = await login("cocina@bardemo.test", "demo1234");
const dueno = await login("dueno@bardemo.test", "demo1234");
ok(mozo && cocina && dueno, "login de mozo, cocina y dueño por el panel");

let tableCode = code;
if (!tableCode) {
  const tables = await call(panel, "/admin/tables", { token: dueno });
  tableCode = tables.data.tables.find((t) => t.status === "FREE" && t.qr)?.qr.code;
}
ok(tableCode, `mesa libre: ${tableCode}`);

const join = await call(carta, `/tags/${tableCode}/session`, { method: "POST", body: { deviceKey: `smoke-${Date.now()}` } });
ok(join.status === 200 && join.data.session.status === "PENDING", "el comensal entra y la mesa queda esperando al mozo");
const guest = join.data.token;

const open = await call(panel, `/staff/sessions/${join.data.session.id}/open`, { method: "POST", token: mozo });
ok(open.status === 200, "el mozo abre la mesa");

const menu = await call(carta, `/venues/${join.data.session.venueId}/menu`);
const dishes = menu.data.categories.flatMap((c) => c.dishes);
const papas = dishes.find((d) => d.name === "Papas bravas");
const bife = dishes.find((d) => d.name === "Bife de chorizo");
const order = await call(carta, "/orders", {
  method: "POST",
  token: guest,
  headers: { "idempotency-key": `smoke-${Date.now()}` },
  body: { items: [{ dishId: papas.id, quantity: 1 }, { dishId: bife.id, quantity: 1, modifierIds: [bife.modifierGroups[0].modifiers[0].id] }] },
});
ok(order.status === 201, `pedido enviado (${order.data.items?.length} ítems, $ ${order.data.totalCents / 100})`);

const approve = await call(panel, `/staff/orders/${order.data.id}/approve`, { method: "POST", token: mozo });
ok(approve.status === 200, "el mozo confirma y va a cocina");

for (const item of order.data.items) {
  for (const status of ["IN_PROGRESS", "READY"]) {
    const r = await call(panel, `/staff/order-items/${item.id}/status`, { method: "PATCH", token: cocina, body: { status } });
    ok(r.status === 200, `cocina: ${item.nameSnapshot} → ${status}`);
  }
}

const state = await call(carta, "/state?since=0", { token: guest });
const types = state.data.events.map((e) => e.type);
ok(types.includes("order.approved") && types.filter((t) => t === "item.status_changed").length === 4, "el celular recibe la confirmación y los 4 cambios de estado");

const callWaiter = await call(carta, "/service-calls", { method: "POST", token: guest, body: { type: "WAITER" } });
ok(callWaiter.status === 201, "llamar al mozo");

const session = await call(carta, "/session", { token: guest });
ok(session.data.hub?.wifi?.ssid, `Wi-Fi visible para la mesa abierta: ${session.data.hub?.wifi?.ssid}`);

const close = await call(panel, `/staff/sessions/${join.data.session.id}/close`, { method: "POST", token: mozo });
ok(close.status === 200, "el mozo cierra la mesa");

const headers = (await fetch(`${carta}/t/${tableCode}`)).headers;
ok((headers.get("content-security-policy") ?? "").includes("default-src 'self'"), "la carta sirve CSP en producción");
console.log("\nTODO OK");

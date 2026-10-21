// Service worker de la carta: solo muestra avisos Web Push de "Mi cuenta" (no cachea nada).
// Cada aviso trae "No recibir más": baja en un toque desde la propia notificación.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Novedades", body: event.data ? event.data.text() : "" };
  }
  const url = typeof data.url === "string" && data.url.startsWith(self.location.origin) ? data.url : "/";
  event.waitUntil(
    self.registration.showNotification(data.title || "Novedades del bar", {
      body: data.body || "",
      data: { url, tid: typeof data.tid === "string" ? data.tid : undefined },
      tag: "bar-promo",
      actions: [{ action: "unsubscribe", title: "No recibir más" }],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "unsubscribe") {
    // Baja solo del bar que mandó el aviso: la suscripción del navegador sigue para los demás
    const tid = event.notification.data?.tid;
    event.waitUntil(
      self.registration.pushManager.getSubscription().then(async (sub) => {
        if (!sub) return;
        await fetch("/v1/customer/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint, tenantId: tid }),
        }).catch(() => undefined);
        if (!tid) await sub.unsubscribe();
      }),
    );
    return;
  }
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url === url);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});

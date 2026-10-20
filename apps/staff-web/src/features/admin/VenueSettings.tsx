"use client";

import { useEffect, useState } from "react";
import { Btn, Card, Empty, Field, inputCls, useToasts } from "@/components/ui";
import { type AdminVenue, api } from "@/lib/api";

export function VenueSettings() {
  const { run, view } = useToasts();
  const [v, setV] = useState<AdminVenue | null>(null);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    void run(() => api<AdminVenue>("/admin/venue")).then((d) => d && setV(d));
  }, [run]);

  if (!v) return <Empty>Cargando…</Empty>;

  const reviewOk = !v.googleReviewUrl || /^https:\/\/\S+$/.test(v.googleReviewUrl);

  const save = () =>
    run(
      () =>
        api("/admin/venue", {
          method: "PATCH",
          body: {
            name: v.name.trim(),
            layoutMode: v.layoutMode,
            wifiSsid: v.wifiSsid?.trim() || null,
            wifiPassword: v.wifiPassword || null,
            googleReviewUrl: v.googleReviewUrl?.trim() || null,
          },
        }),
      "Datos guardados",
    );

  return (
    <div className="grid max-w-2xl gap-4">
      {view}
      <Card>
        <h3 className="mb-3 font-display text-xl">El local</h3>
        <Field label="Nombre que ven los clientes">
          <input className={inputCls} value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
      </Card>

      <Card>
        <h3 className="font-display text-xl">📶 Wi-Fi para clientes</h3>
        <p className="mb-3 text-sm text-muted">
          Se muestra en la carta, con botón para copiar la clave, <b>solo a mesas que el mozo ya abrió</b> (no a quien solo fotografió el QR).
          Usá la red de invitados, no la del sistema de caja.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre de la red (SSID)">
            <input className={inputCls} value={v.wifiSsid ?? ""} maxLength={32} onChange={(e) => setV({ ...v, wifiSsid: e.target.value })} />
          </Field>
          <Field label="Contraseña">
            <div className="flex gap-2">
              <input className={inputCls} type={showPass ? "text" : "password"} value={v.wifiPassword ?? ""} maxLength={63} onChange={(e) => setV({ ...v, wifiPassword: e.target.value })} />
              <Btn onClick={() => setShowPass((s) => !s)}>{showPass ? "Ocultar" : "Ver"}</Btn>
            </div>
          </Field>
        </div>
      </Card>

      <Card>
        <h3 className="font-display text-xl">⭐ Reseñas</h3>
        <p className="mb-3 text-sm text-muted">Link a tu ficha de Google (o donde quieras reseñas). Aparece en la carta cuando la mesa ya pidió.</p>
        <Field label="Link de reseñas" hint={reviewOk ? "Tiene que empezar con https://" : "El link tiene que empezar con https://"}>
          <input className={inputCls} value={v.googleReviewUrl ?? ""} maxLength={300} onChange={(e) => setV({ ...v, googleReviewUrl: e.target.value })} placeholder="https://g.page/r/…/review" />
        </Field>
      </Card>

      <div>
        <Btn kind="primary" disabled={!v.name.trim() || !reviewOk} onClick={() => void save()}>Guardar cambios</Btn>
      </div>
    </div>
  );
}

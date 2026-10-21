"use client";

import { useEffect, useState } from "react";
import { Btn, Card, Empty, Field, inputCls, useToasts } from "@/components/ui";
import { type AdminVenue, api, upload } from "@/lib/api";

export function VenueSettings() {
  const { run, view } = useToasts();
  const [v, setV] = useState<AdminVenue | null>(null);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    void run(() => api<AdminVenue>("/admin/venue")).then((d) => d && setV(d));
  }, [run]);

  if (!v) return <Empty>Cargando…</Empty>;

  const reviewOk = !v.googleReviewUrl || /^https:\/\/\S+$/.test(v.googleReviewUrl);
  const igOk = !v.instagramUrl || /^https:\/\/(www\.)?instagram\.com\/\S+$/i.test(v.instagramUrl);

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    const r = await run(() => upload<{ logoUrl: string }>("/admin/venue/logo", file), "Logo actualizado");
    if (r) setV({ ...v, logoUrl: r.logoUrl });
  };
  const removeLogo = async () => {
    if (await run(() => api("/admin/venue/logo", { method: "DELETE" }), "Logo quitado")) setV({ ...v, logoUrl: null });
  };

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
            address: v.address?.trim() || null,
            instagramUrl: v.instagramUrl?.trim() || null,
          },
        }),
      "Datos guardados",
    );

  return (
    <div className="grid max-w-2xl gap-4">
      {view}
      <Card>
        <h3 className="mb-3 font-display text-xl">El local</h3>
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-2xl border border-line bg-surface-2 text-3xl">
            {v.logoUrl ? <img src={v.logoUrl} alt="Logo" className="h-full w-full object-contain" /> : "🍸"}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">Logo (JPG, PNG o WebP). Aparece en la bienvenida y en la carta.</p>
            <div className="flex gap-2">
              <label className="inline-flex h-10 cursor-pointer items-center rounded-xl bg-amber px-4 text-sm font-semibold text-amber-ink">
                {v.logoUrl ? "Cambiar logo" : "Subir logo"}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void uploadLogo(e.target.files?.[0])} />
              </label>
              {v.logoUrl && <Btn kind="ghost" onClick={() => void removeLogo()}>Quitar</Btn>}
            </div>
          </div>
        </div>
        <div className="grid gap-3">
          <Field label="Nombre que ven los clientes">
            <input className={inputCls} value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field label="Dirección">
            <input className={inputCls} value={v.address ?? ""} maxLength={160} onChange={(e) => setV({ ...v, address: e.target.value })} placeholder="Av. Siempre Viva 742, Palermo" />
          </Field>
          <Field label="Instagram" hint={igOk ? "Link completo, ej.: https://instagram.com/tubar" : "Tiene que ser un link de instagram.com"}>
            <input className={inputCls} value={v.instagramUrl ?? ""} maxLength={200} onChange={(e) => setV({ ...v, instagramUrl: e.target.value })} placeholder="https://instagram.com/tubar" />
          </Field>
        </div>
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
        <Btn kind="primary" disabled={!v.name.trim() || !reviewOk || !igOk} onClick={() => void save()}>Guardar cambios</Btn>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { setCustomerToken } from "@/lib/customer";
import { load } from "@/lib/storage";

/**
 * Ingreso sin contraseña: email → código de 6 dígitos.
 * La primera vez crea la cuenta (con consentimiento explícito) y suma la visita de la mesa actual.
 */
export function LoginScreen({ venueId, venueName, logoUrl, tag, onDone }: {
  venueId: string;
  venueName: string;
  logoUrl: string | null;
  tag?: string;
  onDone: (token: string) => void;
}) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/customer/auth/request-code", { method: "POST", body: { venueId, email } });
      setStep("code");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? "Pediste muchos códigos. Esperá unos minutos." : "Revisá el email e intentá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const guestToken = tag ? load<string | null>(`bar.token.${tag}`, null) : null;
      const res = await api<{ token: string }>("/customer/auth/verify", {
        method: "POST",
        body: { venueId, email, code, name: name.trim() || undefined, acceptPrivacy: accept, guestToken: guestToken ?? undefined },
      });
      setCustomerToken(venueId, res.token);
      onDone(res.token);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sin conexión, probá de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col bg-paper px-5 pt-10 pb-8 text-night">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-night text-xl text-white">
          {logoUrl ? <img src={logoUrl} alt="" className="h-full w-full object-contain p-1" /> : "🍸"}
        </span>
        <div>
          <p className="text-xs text-night/60">Mi cuenta en</p>
          <p className="font-semibold">{venueName}</p>
        </div>
      </div>

      <section className="mt-8 rounded-[28px] bg-night p-6 text-white">
        <p className="text-sm text-white/60">Sumá tus visitas</p>
        <h1 className="mt-1 text-2xl leading-tight font-semibold">Guardá tus puntos, tu historial y pedí lo mismo de siempre en un toque.</h1>
        <p className="mt-3 text-xs text-white/50">Sin contraseña ni app: te mandamos un código por email.</p>
      </section>

      {step === "email" ? (
        <form
          key="email"
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void requestCode();
          }}
        >
          <label className="block text-sm font-medium" htmlFor="email">Tu email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vos@email.com"
            className="h-12 w-full rounded-2xl border border-night/10 bg-white px-4 text-base outline-none focus:border-brand"
          />
          <button disabled={busy || !email} className="h-12 w-full rounded-2xl bg-brand font-semibold text-white active:bg-brand-dark disabled:opacity-50">
            {busy ? "Enviando…" : "Mandame el código"}
          </button>
        </form>
      ) : (
        <form
          key="code"
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <p className="text-sm text-night/70">
            Te mandamos un código a <b className="text-night">{email}</b>. Vence en 10 minutos.
          </p>
          <input
            aria-label="Código de 6 dígitos"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
            className="h-14 w-full rounded-2xl border border-night/10 bg-white text-center font-mono text-2xl tracking-[0.5em] outline-none focus:border-brand"
          />
          <input
            aria-label="Tu nombre"
            value={name}
            maxLength={60}
            autoComplete="given-name"
            onChange={(e) => setName(e.target.value)}
            placeholder="¿Cómo te llamamos? (opcional)"
            className="h-12 w-full rounded-2xl border border-night/10 bg-white px-4 text-base outline-none focus:border-brand"
          />
          <label className="flex min-h-11 items-start gap-3 text-xs text-night/70">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 h-5 w-5 accent-brand" />
            <span>
              Acepto la{" "}
              <Link href="/privacidad" target="_blank" className="font-semibold text-brand underline">
                política de privacidad
              </Link>{" "}
              (solo hace falta la primera vez). {venueName} guarda tu email y tus pedidos para tu historial y tus puntos.
            </span>
          </label>
          <button disabled={busy || code.length !== 6} className="h-12 w-full rounded-2xl bg-brand font-semibold text-white active:bg-brand-dark disabled:opacity-50">
            {busy ? "Verificando…" : "Entrar"}
          </button>
          <button type="button" onClick={() => { setStep("email"); setCode(""); setError(null); }} className="h-11 w-full text-sm text-night/60">
            Usar otro email o pedir otro código
          </button>
        </form>
      )}

      {error && <p role="alert" className="mt-3 rounded-2xl bg-brand/10 px-4 py-3 text-sm text-brand-dark">{error}</p>}

      <Link href={tag ? `/v/${venueId}/menu?tag=${tag}` : `/v/${venueId}/menu`} className="mt-auto pt-8 text-center text-sm text-night/60">
        ← Volver a la carta
      </Link>
    </main>
  );
}

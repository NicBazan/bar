"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api, type JoinSessionResponse } from "@/lib/api";
import { getDeviceKey, save } from "@/lib/storage";

interface JoinTableButtonProps {
  code: string;
  venueId: string;
  tableLabel: string;
  nfc?: { uid: string; ctr: string; cmac: string };
}

export function JoinTableButton({ code, venueId, tableLabel, nfc }: JoinTableButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [isMaintenance, setIsMaintenance] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // La firma NFC sirve una sola vez: si ya se usó (recarga de la página) se sigue como QR
  const [nfcUsable, setNfcUsable] = useState(Boolean(nfc));

  const handleJoin = async (pinToSend?: string, useNfc = nfcUsable) => {
    setLoading(true);
    setPinError(null);
    setGeneralError(null);

    try {
      const bodyPayload: { deviceKey: string; pin?: string } = {
        deviceKey: getDeviceKey(),
      };

      if (pinToSend) {
        bodyPayload.pin = pinToSend;
      }

      const nfcQuery = nfc && useNfc ?`?${new URLSearchParams(nfc).toString()}` : "";
      const res = await api<JoinSessionResponse>(`/tags/${code}/session${nfcQuery}`, {
        method: "POST",
        body: bodyPayload,
      });

      // Guardamos el token en almacenamiento local como respaldo del cookie HttpOnly
      save(`bar.token.${code}`, res.token);

      // Redirección exitosa a la carta
      router.push(`/v/${res.session.venueId || venueId}/menu?tag=${code}`);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "REPLAY_ATTACK_DETECTED" || err.code === "INVALID_NFC_SIGNATURE") && useNfc) {
        // Toque NFC viejo o inválido: reintentar como QR (pedirá PIN si la mesa ya está abierta)
        setNfcUsable(false);
        return await handleJoin(pinToSend, false);
      }

      if (err instanceof ApiError) {
        // 1. Error 402: Límite Freemium superado por el bar
        if (
          err.status === 402 ||
          err.code === "PLAN_LIMIT_REACHED" ||
          err.code === "SUBSCRIPTION_CANCELED"
        ) {
          setIsMaintenance(true);
          return;
        }

        // 2. PIN incorrecto (va antes: requiresPin también es true para este caso)
        if (err.code === "PIN_INVALID") {
          setPinError("El PIN ingresado es incorrecto. Pedíselo a quien abrió la mesa.");
          setShowPinModal(true);
          return;
        }

        // 3. Error 401/403: Requiere PIN de la sesión activa
        if (err.requiresPin || err.code === "PIN_REQUIRED") {
          setShowPinModal(true);
          return;
        }

        setGeneralError(err.message || "No se pudo conectar a la mesa.");
      } else {
        setGeneralError("Error de conexión. Por favor reintenta.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) {
      setPinError("El PIN debe tener 4 dígitos.");
      return;
    }
    void handleJoin(pin);
  };

  // Pantalla amigable si el bar superó su cuota Freemium (402)
  if (isMaintenance) {
    return (
      <div className="w-full max-w-sm rounded-3xl border border-amber/30 bg-surface/80 p-6 text-center shadow-2xl backdrop-blur-md">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber/10 text-3xl">
          🔔
        </div>
        <h2 className="font-display text-2xl text-cream">Atención en mesa</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          El sistema digital de este local se encuentra temporalmente en mantenimiento.
        </p>
        <div className="mt-4 rounded-2xl border border-line bg-surface-2 p-3 text-xs font-medium text-amber">
          Por favor, realizá tu pedido directamente con el mozo.
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xs">
      {generalError && (
        <div className="mb-4 rounded-2xl border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
          {generalError}
        </div>
      )}

      <button
        onClick={() => void handleJoin()}
        disabled={loading}
        className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-amber to-warn py-4 px-6 font-semibold text-amber-ink shadow-lg shadow-amber/20 transition-all duration-200 active:scale-95 disabled:opacity-50"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg
              className="h-5 w-5 animate-spin text-amber-ink"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8z"
              ></path>
            </svg>
            Ingresando...
          </span>
        ) : (
          <>
            <span className="text-base tracking-wide">Abrir Carta / Unirse a Mesa</span>
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </>
        )}
      </button>

      {/* Modal para ingresar PIN si la mesa ya está abierta */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-6 shadow-2xl animate-sheet">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber/10 text-2xl">
                🔒
              </div>
              <h3 className="font-display text-2xl text-cream">Mesa {tableLabel} iniciada</h3>
              <p className="mt-2 text-xs text-muted">
                Alguien ya abrió esta mesa. Ingresá el PIN de 4 dígitos que figura en su pantalla para unirte.
              </p>
            </div>

            <form onSubmit={handlePinSubmit} className="mt-6">
              <div className="flex justify-center">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  autoFocus
                  placeholder="••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="w-44 rounded-2xl border border-line bg-surface-2 py-3 text-center font-display text-3xl tracking-[0.5em] text-cream outline-none transition focus:border-amber focus:ring-2 focus:ring-amber/20"
                />
              </div>

              {pinError && (
                <p className="mt-3 text-center text-xs text-warn">{pinError}</p>
              )}

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowPinModal(false)}
                  className="flex-1 rounded-xl border border-line py-3 text-sm font-medium text-muted transition hover:bg-surface-2"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading || pin.length !== 4}
                  className="flex-1 rounded-xl bg-amber py-3 text-sm font-semibold text-amber-ink shadow-md transition disabled:opacity-40"
                >
                  {loading ? "Validando..." : "Ingresar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

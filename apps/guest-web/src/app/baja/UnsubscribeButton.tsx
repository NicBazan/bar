"use client";

import { useState } from "react";
import { api } from "@/lib/api";

// Botón (no automático al abrir): los antivirus de correo abren los links y darían de baja solos
export function UnsubscribeButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const go = async () => {
    setState("busy");
    try {
      await api("/customer/unsubscribe", { method: "POST", body: { t: token } });
      setState("done");
    } catch {
      setState("error");
    }
  };
  if (state === "done") return <p className="mt-5 rounded-2xl bg-paper p-4 text-sm font-medium">Listo, no te mandamos más promos por email. ✅</p>;
  return (
    <>
      <button onClick={() => void go()} disabled={state === "busy"} className="mt-5 h-12 w-full rounded-2xl bg-brand font-semibold text-white active:bg-brand-dark disabled:opacity-50">
        {state === "busy" ? "Un momento…" : "Darme de baja"}
      </button>
      {state === "error" && <p className="mt-3 text-sm text-brand-dark">El link no es válido o venció.</p>}
    </>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type SessionState, type StateEvents, api } from "@/lib/api";
import { load, remove } from "@/lib/storage";

export type Notice = { id: number; text: string; tone: "info" | "success" | "warn" };

const POLL_MS = 4000;

/**
 * Estado en vivo de la mesa para la carta: sesión (PIN, abierta o pendiente), pedidos y llamados.
 * Usa el token que guardó JoinTableButton al entrar y se mantiene al día por catch-up de eventos
 * (/state?since=seq): cada 4 s, al volver a la pestaña y al recuperar la conexión.
 */
export function useLiveTable(tag: string | undefined) {
  const tokenKey = `bar.token.${tag}`;
  const [session, setSession] = useState<SessionState | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "no_session" | "closed">("loading");
  const [notices, setNotices] = useState<Notice[]>([]);
  const lastSeq = useRef(0);

  const token = () => (tag ? load<string | null>(tokenKey, null) : null);

  const notify = useCallback((text: string, tone: Notice["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setNotices((n) => [...n, { id, text, tone }]);
    setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 5000);
  }, []);

  const refresh = useCallback(async () => {
    const t = token();
    if (!t) return setStatus("no_session");
    try {
      const s = await api<SessionState>("/session", { token: t });
      setSession(s);
      lastSeq.current = Math.max(lastSeq.current, s.lastSeq);
      setStatus("ready");
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) {
        remove(tokenKey);
        setStatus("closed");
      } else if (e instanceof ApiError && e.status === 401) {
        remove(tokenKey);
        setStatus("no_session");
      }
      // Errores de red: se reintenta en el próximo tick sin tocar el estado
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (status !== "ready") return;
    let busy = false;
    const tick = async () => {
      const t = token();
      if (busy || !t || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const res = await api<StateEvents>(`/state?since=${lastSeq.current}`, { token: t });
        if (res.events.length > 0) {
          for (const ev of res.events) announce(ev, notify);
          lastSeq.current = res.lastSeq;
          await refresh();
        }
      } catch {
        /* red inestable */
      } finally {
        busy = false;
      }
    };
    const id = setInterval(tick, POLL_MS);
    const wake = () => void tick();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, notify, refresh]);

  const callService = useCallback(
    async (type: "WAITER" | "BILL") => {
      try {
        const res = await api<{ deduplicated: boolean }>("/service-calls", { method: "POST", token: token(), body: { type } });
        notify(
          res.deduplicated ? "Ya avisamos, en breve se acercan." : type === "BILL" ? "Pediste la cuenta 🧾" : "Avisamos al mozo 🙋",
          "success",
        );
        await refresh();
      } catch (e) {
        notify(e instanceof ApiError ? e.message : "Sin conexión, probá de nuevo", "warn");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notify, refresh],
  );

  return { session, status, notices, notify, refresh, callService };
}

function announce(ev: StateEvents["events"][number], notify: (t: string, tone?: Notice["tone"]) => void) {
  const p = ev.payload;
  switch (ev.type) {
    case "session.opened":
      return notify("¡La mesa está abierta! Ya podés pedir.", "success");
    case "order.approved":
      return notify("El mozo confirmó tu pedido 👨‍🍳", "success");
    case "order.rejected":
      return notify(`Pedido rechazado: ${String(p.reason ?? "")}`, "warn");
    case "item.status_changed":
      if (p.status === "READY") return notify(`¡${String(p.name)} está listo!`, "success");
      if (p.status === "IN_PROGRESS") return notify(`Preparando ${String(p.name)}…`);
      return;
    case "service_call.updated":
      if (p.status === "ACKNOWLEDGED") return notify("El mozo ya viene en camino.");
      return;
    case "session.closed":
      return notify("La mesa se cerró. ¡Gracias por venir!");
  }
}

"use client";

import type { CreateOrderBody } from "@bar/shared-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type Menu, type Order, type SessionState, type StateEvents, type TagInfo, api } from "@/lib/api";
import { getDeviceKey, load, remove, save, uuid } from "@/lib/storage";

type Phase = "loading" | "need_pin" | "ready" | "closed" | "error";

export type Notice = { id: number; text: string; tone: "info" | "success" | "warn" };

const POLL_MS = 4000;

type JoinResponse = { token: string; session: { id: string; status: string; pin: string } };

/**
 * Todo el estado de la mesa del comensal: resolver el tag, unirse (con PIN si hace falta),
 * mantener la sesión al día por catch-up de eventos (/state?since=seq) y enviar pedidos/llamados.
 */
export function useTableSession(tag: string) {
  const tokenKey = `bar.token.${tag}`;
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [tagInfo, setTagInfo] = useState<TagInfo | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const token = useRef<string | null>(null);
  const lastSeq = useRef(0);

  const notify = useCallback((text: string, tone: Notice["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setNotices((n) => [...n, { id, text, tone }]);
    setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 5000);
  }, []);

  const refreshSession = useCallback(async () => {
    if (!token.current) return;
    try {
      const s = await api<SessionState>("/session", { token: token.current });
      setSession(s);
      lastSeq.current = Math.max(lastSeq.current, s.lastSeq);
      setPhase("ready");
    } catch (e) {
      if (e instanceof ApiError && (e.status === 410 || e.status === 401)) {
        remove(tokenKey);
        token.current = null;
        setPhase(e.status === 410 ? "closed" : "loading");
        // Token vencido: volver a unirse (si el dispositivo ya estaba en la mesa no pide PIN)
        if (e.status === 401) await joinRef.current?.();
        return;
      }
      throw e;
    }
  }, [tokenKey]);
  const joinRef = useRef<((pin?: string) => Promise<void>) | null>(null);

  const join = useCallback(
    async (pin?: string) => {
      try {
        const res = await api<JoinResponse>(`/tags/${tag}/session`, {
          method: "POST",
          body: { deviceKey: getDeviceKey(), ...(pin ? { pin } : {}) },
        });
        token.current = res.token;
        save(tokenKey, res.token);
        await refreshSession();
      } catch (e) {
        if (e instanceof ApiError && e.code === "PIN_REQUIRED") return setPhase("need_pin");
        if (e instanceof ApiError && e.code === "PIN_INVALID") {
          setPhase("need_pin");
          throw e;
        }
        throw e;
      }
    },
    [tag, tokenKey, refreshSession],
  );
  joinRef.current = join;

  // Arranque: tag + carta en paralelo, después la sesión (reusa el token si ya estaba en la mesa)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await api<TagInfo>(`/tags/${tag}`);
        if (cancelled) return;
        setTagInfo(info);
        const m = await api<Menu>(`/venues/${info.venue.id}/menu`);
        if (cancelled) return;
        setMenu(m);

        token.current = load<string | null>(tokenKey, null);
        if (token.current) await refreshSession();
        // Sin token, o el guardado era de una mesa ya cerrada (volvió a escanear): sesión nueva
        if (!token.current) await join();
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError && e.status === 404 ? "Esta mesa no existe o fue desactivada." : "No pudimos conectar. Revisá tu conexión.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tag, tokenKey, join, refreshSession]);

  // Catch-up de eventos: polling + al volver a la pestaña o recuperar conexión
  useEffect(() => {
    if (phase !== "ready") return;
    let busy = false;
    const tick = async () => {
      if (busy || !token.current || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const res = await api<StateEvents>(`/state?since=${lastSeq.current}`, { token: token.current });
        if (res.events.length > 0) {
          for (const ev of res.events) announce(ev, notify);
          lastSeq.current = res.lastSeq;
          await refreshSession();
        }
      } catch {
        /* red inestable: se reintenta en el próximo tick */
      } finally {
        busy = false;
      }
    };
    const id = setInterval(tick, POLL_MS);
    const onWake = () => void tick();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [phase, notify, refreshSession]);

  /**
   * Envía el pedido con una Idempotency-Key que se guarda hasta que el servidor confirma:
   * si se corta la red o se recarga la página, el reintento no duplica el pedido.
   */
  const submitOrder = useCallback(
    async (body: CreateOrderBody): Promise<Order> => {
      const pendingKey = `bar.pendingOrder.${tag}`;
      const pending = load<{ key: string; body: string } | null>(pendingKey, null);
      const serialized = JSON.stringify(body);
      const key = pending && pending.body === serialized ? pending.key : uuid();
      save(pendingKey, { key, body: serialized });

      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const order = await api<Order>("/orders", {
            method: "POST",
            token: token.current,
            body,
            headers: { "idempotency-key": key },
          });
          remove(pendingKey);
          await refreshSession();
          return order;
        } catch (e) {
          lastError = e;
          if (e instanceof ApiError) break; // error de negocio: no reintentar
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      throw lastError;
    },
    [tag, refreshSession],
  );

  const callService = useCallback(
    async (type: "WAITER" | "BILL") => {
      try {
        const res = await api<{ deduplicated: boolean }>("/service-calls", { method: "POST", token: token.current, body: { type } });
        notify(
          res.deduplicated ? "Ya avisamos, en breve se acercan." : type === "BILL" ? "Pediste la cuenta 🧾" : "Avisamos al mozo 🙋",
          "success",
        );
        await refreshSession();
      } catch (e) {
        notify(e instanceof ApiError ? (e.message ?? "No se pudo avisar") : "Sin conexión, probá de nuevo", "warn");
      }
    },
    [notify, refreshSession],
  );

  return { phase, error, tagInfo, menu, session, notices, join, submitOrder, callService, notify };
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

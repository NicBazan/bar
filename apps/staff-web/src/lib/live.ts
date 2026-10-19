"use client";

import { useEffect, useRef, useState } from "react";
import { type StaffRole, type StaffUser, type StateEvents, api, getAuth } from "./api";

/** Protege la pantalla: sin sesión o con rol no permitido, redirige al login */
export function useStaffAuth(roles: StaffRole[]) {
  const [user, setUser] = useState<StaffUser | null>(null);
  useEffect(() => {
    const auth = getAuth();
    if (!auth || !roles.includes(auth.user.role)) {
      window.location.href = "/login";
      return;
    }
    setUser(auth.user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return user;
}

/**
 * Mantiene la pantalla al día: catch-up de eventos (/state?since=seq) cada 3 s
 * y al volver a la pestaña o recuperar red. Si llegan eventos, llama a refresh().
 */
export function useLiveEvents(enabled: boolean, refresh: () => Promise<void>, onEvents?: (ev: StateEvents["events"]) => void) {
  const seq = useRef<number | null>(null);
  const [online, setOnline] = useState(true);
  const cb = useRef({ refresh, onEvents });
  cb.current = { refresh, onEvents };

  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        // Primer tick: solo toma la secuencia actual (no re-anuncia lo viejo)
        const res = await api<StateEvents>(`/state?since=${seq.current ?? 0}`);
        const first = seq.current === null;
        seq.current = res.lastSeq;
        setOnline(true);
        if (first) await cb.current.refresh();
        else if (res.events.length > 0) {
          cb.current.onEvents?.(res.events);
          await cb.current.refresh();
        }
      } catch {
        setOnline(false);
      } finally {
        busy = false;
      }
    };
    void tick();
    const id = setInterval(tick, 3000);
    const wake = () => void tick();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [enabled]);

  return online;
}

/**
 * Sonido de alerta con Web Audio (sin archivos). Los navegadores bloquean el audio
 * hasta un gesto del usuario: por eso el botón "Iniciar turno" llama a unlock().
 */
export function useChime() {
  const ctx = useRef<AudioContext | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  const unlock = async () => {
    ctx.current ??= new AudioContext();
    await ctx.current.resume();
    setUnlocked(true);
    // Mantener la pantalla encendida en tablets de cocina/salón
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      wakeLock.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      /* no soportado */
    }
  };

  const play = (kind: "order" | "call" | "ready" = "order") => {
    const c = ctx.current;
    if (!c || c.state !== "running") return;
    const notes = kind === "call" ? [880, 660, 880] : kind === "ready" ? [523, 784] : [660, 880];
    notes.forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const t = c.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.17);
    });
  };

  return { unlocked, unlock, play };
}

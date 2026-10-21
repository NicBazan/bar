"use client";

import { useCallback, useEffect, useState } from "react";
import { Btn, Empty, Modal, useToasts } from "@/components/ui";
import { type TableCustomer, api } from "@/lib/api";

/** Clientes con "Mi cuenta" sentados en la mesa: saldo de sellos/puntos y canje de premios */
export function TableCustomers({ sessionId, tableLabel, onClose }: { sessionId: string; tableLabel: string; onClose: () => void }) {
  const { run, view } = useToasts();
  const [list, setList] = useState<TableCustomer[] | null>(null);
  const [confirm, setConfirm] = useState<{ customer: TableCustomer; reward: { id: string; name: string } } | null>(null);

  const load = useCallback(async () => {
    const d = await run(() => api<TableCustomer[]>(`/staff/sessions/${sessionId}/customers`));
    if (d) setList(d);
  }, [run, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const redeem = async () => {
    if (!confirm) return;
    const ok = await run(
      () => api("/staff/loyalty/redeem", { method: "POST", body: { sessionId, customerId: confirm.customer.id, rewardId: confirm.reward.id } }),
      `Canjeado: ${confirm.reward.name}`,
    );
    setConfirm(null);
    if (ok) await load();
  };

  return (
    <Modal open title={`Clientes · Mesa ${tableLabel}`} onClose={onClose}>
      {view}
      {list === null ? (
        <Empty>Cargando…</Empty>
      ) : list.length === 0 ? (
        <Empty>Nadie en esta mesa entró con "Mi cuenta" todavía.</Empty>
      ) : (
        <ul className="grid gap-3">
          {list.map((c) => (
            <li key={c.id} className="rounded-2xl border border-line bg-surface-2 p-4">
              <p className="font-semibold">{c.name || "Cliente"}</p>
              <p className="text-xs text-muted">{c.email}</p>
              {c.loyalty.active ? (
                <>
                  <p className="mt-2 text-sm">
                    Saldo: <b className="text-amber">{c.loyalty.balance}</b> {c.loyalty.mode === "STAMPS" ? "sellos" : "puntos"}
                  </p>
                  <div className="mt-3 grid gap-2">
                    {c.loyalty.rewards.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                        <span>
                          {r.name} <span className="text-muted">· {r.cost}</span>
                        </span>
                        <Btn size="sm" kind={r.canRedeem ? "primary" : "secondary"} disabled={!r.canRedeem} onClick={() => setConfirm({ customer: c, reward: r })}>
                          Canjear
                        </Btn>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted">El programa de fidelización está apagado.</p>
              )}
              {confirm?.customer.id === c.id && (
                <div className="mt-3 rounded-xl border border-amber/50 bg-amber/10 p-3 text-sm">
                  <p>
                    ¿Entregar <b>{confirm.reward.name}</b> a {c.name || "este cliente"}? Se descuenta del saldo.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Btn size="sm" onClick={() => setConfirm(null)}>Cancelar</Btn>
                    <Btn size="sm" kind="primary" onClick={() => void redeem()}>Sí, canjear</Btn>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

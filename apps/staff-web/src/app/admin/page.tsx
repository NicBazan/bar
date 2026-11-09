"use client";

import { useEffect, useState } from "react";
import { StaffHeader } from "@/components/StaffHeader";
import { Loyalty } from "@/features/admin/Loyalty";
import { MenuEditor } from "@/features/admin/MenuEditor";
import { Overview } from "@/features/admin/Overview";
import { Promotions } from "@/features/admin/Promotions";
import { TablesQr } from "@/features/admin/TablesQr";
import { Team } from "@/features/admin/Team";
import { VenueSettings } from "@/features/admin/VenueSettings";
import { useStaffAuth } from "@/lib/live";

type Tab = "inicio" | "carta" | "mesas" | "fidelizacion" | "promos" | "equipo" | "local";

const TABS: Array<[Tab, string]> = [
  ["inicio", "Inicio"],
  ["carta", "Carta"],
  ["mesas", "Mesas y QR"],
  ["fidelizacion", "Fidelización"],
  ["promos", "Promos y avisos"],
  ["equipo", "Equipo"],
  ["local", "Local"],
];

/** Panel del dueño / encargado. La pestaña activa vive en el hash (#carta) para poder recargar o compartir */
export default function AdminPage() {
  const user = useStaffAuth(["OWNER", "MANAGER"]);
  const [tab, setTab] = useState<Tab>("inicio");

  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1) as Tab;
      if (TABS.some(([id]) => id === h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  };

  if (!user) return null;

  return (
    <main>
      <StaffHeader user={user} title="Admin" contained />
      <nav className="sticky top-[61px] z-10 border-b border-line bg-paper/95 backdrop-blur print:hidden">
        <div className="no-scrollbar mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2 md:px-6">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => go(id)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm transition ${tab === id ? "bg-amber text-amber-ink" : "bg-surface-2 text-muted"}`}
          >
            {label}
          </button>
        ))}
        </div>
      </nav>
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        {tab === "inicio" && <Overview onGo={go} />}
        {tab === "carta" && <MenuEditor />}
        {tab === "mesas" && <TablesQr />}
        {tab === "fidelizacion" && <Loyalty />}
        {tab === "promos" && <Promotions />}
        {tab === "equipo" && <Team />}
        {tab === "local" && <VenueSettings />}
      </div>
    </main>
  );
}

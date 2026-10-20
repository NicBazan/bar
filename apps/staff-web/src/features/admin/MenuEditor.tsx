"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Btn, Card, Empty, Field, Modal, Toggle, inputCls, useToasts } from "@/components/ui";
import { type AdminDish, type AdminMenu, api, formatMoney } from "@/lib/api";
import { DishEditor } from "./DishEditor";

export function MenuEditor() {
  const { run, view } = useToasts();
  const [menu, setMenu] = useState<AdminMenu | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ dish: AdminDish | null; categoryId: string } | null>(null);
  const [catModal, setCatModal] = useState<{ id?: string; name: string; stationKey: string } | null>(null);
  const [stationModal, setStationModal] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const m = await run(() => api<AdminMenu>("/admin/menu"));
    if (m) setMenu(m);
  }, [run]);
  useEffect(() => {
    void load();
  }, [load]);

  // Disponible / oculto: un toque, con actualización optimista
  const setAvailability = async (dish: AdminDish, patch: { available?: boolean; hidden?: boolean }) => {
    setMenu((m) =>
      m && {
        ...m,
        categories: m.categories.map((c) => ({ ...c, dishes: c.dishes.map((d) => (d.id === dish.id ? { ...d, ...patch } : d)) })),
      },
    );
    const ok = await run(() => api(`/admin/dishes/${dish.id}/availability`, { method: "PUT", body: patch }));
    if (!ok) await load();
  };

  const saveCategory = async () => {
    if (!catModal?.name.trim()) return;
    const body = { name: catModal.name.trim(), stationKey: catModal.stationKey || null };
    const ok = await run(
      () => (catModal.id ? api(`/admin/categories/${catModal.id}`, { method: "PATCH", body }) : api("/admin/categories", { method: "POST", body })),
      catModal.id ? "Categoría actualizada" : "Categoría creada",
    );
    if (ok) {
      setCatModal(null);
      await load();
    }
  };

  const deleteCategory = async (id: string, name: string) => {
    if (!confirm(`¿Borrar la categoría "${name}"?`)) return;
    if (await run(() => api(`/admin/categories/${id}`, { method: "DELETE" }), "Categoría borrada")) await load();
  };

  const moveCategory = async (index: number, dir: -1 | 1) => {
    if (!menu) return;
    const a = menu.categories[index];
    const b = menu.categories[index + dir];
    if (!a || !b) return;
    await run(() =>
      Promise.all([
        api(`/admin/categories/${a.id}`, { method: "PATCH", body: { position: index + dir } }),
        api(`/admin/categories/${b.id}`, { method: "PATCH", body: { position: index } }),
      ]),
    );
    await load();
  };

  if (!menu) return <Empty>Cargando carta…</Empty>;

  const q = query.trim().toLowerCase();
  const visible = (d: AdminDish) => (showArchived || d.active) && (!q || d.name.toLowerCase().includes(q));
  const soldOut = menu.categories.flatMap((c) => c.dishes).filter((d) => d.active && !d.available).length;

  return (
    <div className="grid gap-4">
      {view}
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} max-w-xs`} placeholder="Buscar plato…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-muted">
          <Toggle checked={showArchived} onChange={setShowArchived} label="Mostrar archivados" /> Mostrar archivados
        </label>
        {soldOut > 0 && <Badge tone="warn">{soldOut} agotado(s)</Badge>}
        <span className="flex-1" />
        <Btn onClick={() => setStationModal(true)}>Estaciones de cocina</Btn>
        <Btn kind="primary" onClick={() => setCatModal({ name: "", stationKey: "" })}>+ Categoría</Btn>
      </div>

      {menu.categories.length === 0 && <Empty>Tu carta está vacía. Empezá creando una categoría (ej.: Entradas, Principales, Bebidas).</Empty>}

      {menu.categories.map((cat, ci) => {
        const dishes = cat.dishes.filter(visible);
        return (
          <Card key={cat.id}>
            <header className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="font-display text-xl">{cat.name}</h3>
              {cat.stationKey && <Badge>{menu.stations.find((s) => s.key === cat.stationKey)?.name ?? cat.stationKey}</Badge>}
              <span className="flex-1" />
              <Btn size="sm" kind="ghost" disabled={ci === 0} onClick={() => moveCategory(ci, -1)} title="Subir">↑</Btn>
              <Btn size="sm" kind="ghost" disabled={ci === menu.categories.length - 1} onClick={() => moveCategory(ci, 1)} title="Bajar">↓</Btn>
              <Btn size="sm" onClick={() => setCatModal({ id: cat.id, name: cat.name, stationKey: cat.stationKey ?? "" })}>Editar</Btn>
              {cat.dishes.length === 0 && <Btn size="sm" kind="danger" onClick={() => deleteCategory(cat.id, cat.name)}>Borrar</Btn>}
              <Btn size="sm" kind="primary" onClick={() => setEditing({ dish: null, categoryId: cat.id })}>+ Plato</Btn>
            </header>

            {dishes.length === 0 ? (
              <p className="text-sm text-muted">{cat.dishes.length === 0 ? "Sin platos todavía." : "Nada coincide con el filtro."}</p>
            ) : (
              <ul className="divide-y divide-line">
                {dishes.map((d) => (
                  <li key={d.id} className={`flex flex-wrap items-center gap-3 py-2.5 ${!d.active ? "opacity-50" : ""}`}>
                    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2 text-xl">
                      {d.assets.PHOTO ? <img src={d.assets.PHOTO.url} alt="" className="h-full w-full object-cover" /> : d.assets.GLB_LOD0 ? "🧊" : "🍽️"}
                    </div>
                    <button className="min-w-40 flex-1 text-left" onClick={() => setEditing({ dish: d, categoryId: cat.id })}>
                      <p className="font-semibold">
                        {d.name}{" "}
                        {d.assets.GLB_LOD0 && <Badge tone="amber">3D</Badge>} {d.hidden && <Badge>oculto</Badge>}{" "}
                        {!d.active && <Badge>archivado</Badge>}
                      </p>
                      <p className="text-sm text-muted">
                        {d.variants.length > 0
                          ? d.variants.map((v) => `${v.name} ${formatMoney(v.priceCents)}`).join(" · ")
                          : formatMoney(d.localPriceCents ?? d.priceCents)}
                        {d.modifierGroups.length > 0 && ` · ${d.modifierGroups.length} grupo(s) de opciones`}
                      </p>
                    </button>
                    {d.active && (
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-sm">
                          <Toggle checked={d.available} onChange={(v) => setAvailability(d, { available: v })} label={`${d.name} disponible`} />
                          <span className={d.available ? "text-ok" : "text-warn"}>{d.available ? "Disponible" : "Agotado"}</span>
                        </label>
                        <Btn size="sm" kind="ghost" onClick={() => setAvailability(d, { hidden: !d.hidden })}>{d.hidden ? "Mostrar" : "Ocultar"}</Btn>
                        <Btn size="sm" onClick={() => setEditing({ dish: d, categoryId: cat.id })}>Editar</Btn>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}

      {editing && (
        <DishEditor
          key={editing.dish?.id ?? "nuevo"}
          dish={editing.dish && (menu.categories.flatMap((c) => c.dishes).find((d) => d.id === editing.dish!.id) ?? editing.dish)}
          categoryId={editing.categoryId}
          menu={menu}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}

      <Modal
        open={catModal !== null}
        title={catModal?.id ? "Editar categoría" : "Nueva categoría"}
        onClose={() => setCatModal(null)}
        footer={
          <>
            <Btn onClick={() => setCatModal(null)}>Cancelar</Btn>
            <Btn kind="primary" disabled={!catModal?.name.trim()} onClick={saveCategory}>Guardar</Btn>
          </>
        }
      >
        {catModal && (
          <div className="grid gap-3">
            <Field label="Nombre">
              <input autoFocus className={inputCls} value={catModal.name} maxLength={80} onChange={(e) => setCatModal({ ...catModal, name: e.target.value })} />
            </Field>
            <Field label="Estación de cocina" hint="A qué pantalla del KDS van los platos de esta categoría">
              <select className={inputCls} value={catModal.stationKey} onChange={(e) => setCatModal({ ...catModal, stationKey: e.target.value })}>
                <option value="">— Ninguna —</option>
                {menu.stations.map((s) => (
                  <option key={s.key} value={s.key}>{s.name}</option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </Modal>

      {stationModal && <StationsModal stations={menu.stations} onClose={() => setStationModal(false)} onSaved={load} />}
    </div>
  );
}

function StationsModal({ stations, onClose, onSaved }: { stations: AdminMenu["stations"]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { run, view } = useToasts();
  const [name, setName] = useState("");
  const key = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 30);
  const add = async () => {
    if (!key) return;
    if (await run(() => api("/admin/stations", { method: "POST", body: { key, name: name.trim() } }), "Estación creada")) {
      setName("");
      await onSaved();
    }
  };
  return (
    <Modal open title="Estaciones de cocina" onClose={onClose} footer={<Btn onClick={onClose}>Listo</Btn>}>
      {view}
      <p className="mb-3 text-sm text-muted">Cada estación es una pantalla del KDS (ej.: Parrilla, Barra, Fríos).</p>
      <ul className="mb-4 flex flex-wrap gap-2">
        {stations.map((s) => (
          <li key={s.key}><Badge>{s.name}</Badge></li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input className={inputCls} placeholder="Nueva estación, ej.: Pastelería" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <Btn kind="primary" disabled={!key} onClick={add}>Agregar</Btn>
      </div>
    </Modal>
  );
}

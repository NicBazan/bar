"use client";

import { useState } from "react";
import { Badge, Btn, Field, Modal, inputCls, useToasts } from "@/components/ui";
import { type AdminDish, type AdminMenu, api, formatMoney, parseMoney, upload } from "@/lib/api";

type Tab = "datos" | "tamanos" | "opciones" | "medios";

const centsToInput = (c: number) => String(c / 100).replace(".", ",");
const csv = (xs: string[]) => xs.join(", ");
const fromCsv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

/**
 * Alta y edición de un plato. `dish` null = plato nuevo en `categoryId`.
 * Cada pestaña guarda por separado (los tamaños y opciones se reemplazan enteros).
 */
export function DishEditor({
  dish,
  categoryId,
  menu,
  onClose,
  onSaved,
}: {
  dish: AdminDish | null;
  categoryId: string;
  menu: AdminMenu;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { run, view } = useToasts();
  const [tab, setTab] = useState<Tab>("datos");
  const [busy, setBusy] = useState(false);

  // ── Datos ──
  const [name, setName] = useState(dish?.name ?? "");
  const [description, setDescription] = useState(dish?.description ?? "");
  const [price, setPrice] = useState(dish ? centsToInput(dish.priceCents) : "");
  const [catId, setCatId] = useState(dish?.categoryId ?? categoryId);
  const [station, setStation] = useState(dish?.stationKey ?? "");
  const [allergens, setAllergens] = useState(csv(dish?.allergens ?? []));
  const [tags, setTags] = useState(csv(dish?.tags ?? []));

  // ── Tamaños ──
  const [variants, setVariants] = useState(
    (dish?.variants ?? []).map((v) => ({ name: v.name, price: centsToInput(v.priceCents) })),
  );

  // ── Opciones ──
  const [groups, setGroups] = useState(
    (dish?.modifierGroups ?? []).map((g) => ({
      name: g.name,
      min: g.minSelect,
      max: g.maxSelect,
      modifiers: g.modifiers.map((m) => ({ name: m.name, price: centsToInput(m.priceCents) })),
    })),
  );

  const isNew = dish === null;
  const priceCents = parseMoney(price);

  const saveDatos = async () => {
    if (!name.trim() || priceCents === null) return;
    setBusy(true);
    const body = {
      categoryId: catId,
      name: name.trim(),
      description: description.trim() || null,
      priceCents,
      allergens: fromCsv(allergens),
      tags: fromCsv(tags),
      stationKey: station || null,
    };
    const ok = await run(
      () => (isNew ? api("/admin/dishes", { method: "POST", body }) : api(`/admin/dishes/${dish.id}`, { method: "PATCH", body })),
      isNew ? "Plato creado" : "Cambios guardados",
    );
    setBusy(false);
    if (ok) {
      await onSaved();
      if (isNew) onClose();
    }
  };

  const saveVariants = async () => {
    if (!dish) return;
    const body = variants.map((v) => ({ name: v.name.trim(), priceCents: parseMoney(v.price) ?? -1 }));
    if (body.some((v) => !v.name || v.priceCents < 0)) return;
    setBusy(true);
    await run(() => api(`/admin/dishes/${dish.id}/variants`, { method: "PUT", body }), "Tamaños guardados");
    setBusy(false);
    await onSaved();
  };

  const saveGroups = async () => {
    if (!dish) return;
    const body = groups.map((g) => ({
      name: g.name.trim(),
      minSelect: g.min,
      maxSelect: Math.max(1, g.max),
      modifiers: g.modifiers.map((m) => ({ name: m.name.trim(), priceCents: parseMoney(m.price) ?? 0 })),
    }));
    if (body.some((g) => !g.name || g.modifiers.length === 0 || g.modifiers.some((m) => !m.name))) return;
    setBusy(true);
    await run(() => api(`/admin/dishes/${dish.id}/modifier-groups`, { method: "PUT", body }), "Opciones guardadas");
    setBusy(false);
    await onSaved();
  };

  const uploadFile = async (kind: "PHOTO" | "GLB_LOD0" | "USDZ", file: File | undefined) => {
    if (!dish || !file) return;
    setBusy(true);
    await run(() => upload(`/admin/dishes/${dish.id}/media/${kind}`, file), "Archivo subido");
    setBusy(false);
    await onSaved();
  };

  const removeMedia = async (kind: "PHOTO" | "GLB_LOD0" | "USDZ") => {
    if (!dish) return;
    await run(() => api(`/admin/dishes/${dish.id}/media/${kind}`, { method: "DELETE" }), "Quitado");
    await onSaved();
  };

  const archive = async () => {
    if (!dish || !confirm(`¿Archivar "${dish.name}"? Deja de verse en la carta; los pedidos viejos se conservan.`)) return;
    const ok = await run(() => api(`/admin/dishes/${dish.id}`, { method: "DELETE" }), "Plato archivado");
    if (ok) {
      await onSaved();
      onClose();
    }
  };

  const restore = async () => {
    if (!dish) return;
    await run(() => api(`/admin/dishes/${dish.id}`, { method: "PATCH", body: { active: true } }), "Plato restaurado");
    await onSaved();
  };

  const tabs: Array<[Tab, string]> = [
    ["datos", "Datos"],
    ["tamanos", "Tamaños"],
    ["opciones", "Opciones"],
    ["medios", "Foto y 3D"],
  ];

  return (
    <Modal
      open
      wide
      title={isNew ? "Nuevo plato" : dish.name}
      onClose={onClose}
      footer={
        <>
          {!isNew && dish.active && <Btn kind="danger" onClick={archive}>Archivar</Btn>}
          {!isNew && !dish.active && <Btn kind="ok" onClick={restore}>Restaurar</Btn>}
          <span className="flex-1" />
          <Btn onClick={onClose}>Cerrar</Btn>
          {tab === "datos" && (
            <Btn kind="primary" disabled={busy || !name.trim() || priceCents === null} onClick={saveDatos}>
              {isNew ? "Crear plato" : "Guardar"}
            </Btn>
          )}
          {tab === "tamanos" && <Btn kind="primary" disabled={busy} onClick={saveVariants}>Guardar tamaños</Btn>}
          {tab === "opciones" && <Btn kind="primary" disabled={busy} onClick={saveGroups}>Guardar opciones</Btn>}
        </>
      }
    >
      {view}
      <div className="mb-4 flex gap-1 overflow-x-auto">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            disabled={isNew && id !== "datos"}
            onClick={() => setTab(id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm disabled:opacity-30 ${tab === id ? "bg-cream text-ink" : "bg-surface-2 text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {isNew && <p className="mb-3 text-xs text-muted">Creá el plato y después vas a poder sumarle tamaños, opciones, foto y modelo 3D.</p>}

      {tab === "datos" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre">
            <input className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Milanesa napolitana" />
          </Field>
          <Field label="Precio" hint={priceCents === null && price ? "Precio inválido" : priceCents !== null ? formatMoney(priceCents) : "En pesos, ej.: 12500"}>
            <input className={inputCls} value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} placeholder="12500" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Descripción">
              <textarea className={`${inputCls} min-h-20`} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          <Field label="Categoría">
            <select className={inputCls} value={catId} onChange={(e) => setCatId(e.target.value)}>
              {menu.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Estación de cocina" hint="Vacío = la de la categoría">
            <select className={inputCls} value={station} onChange={(e) => setStation(e.target.value)}>
              <option value="">— La de la categoría —</option>
              {menu.stations.map((s) => (
                <option key={s.key} value={s.key}>{s.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Alérgenos" hint="Separados por coma: gluten, lactosa, huevo">
            <input className={inputCls} value={allergens} onChange={(e) => setAllergens(e.target.value)} />
          </Field>
          <Field label="Etiquetas" hint="Separadas por coma: vegano, sin_tacc, picante">
            <input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
        </div>
      )}

      {tab === "tamanos" && (
        <div className="grid gap-2">
          <p className="text-sm text-muted">Si el plato tiene tamaños (ej.: media pinta / pinta), el comensal elige uno y se cobra ese precio.</p>
          {variants.map((v, i) => (
            <div key={i} className="flex gap-2">
              <input className={inputCls} placeholder="Nombre" value={v.name} onChange={(e) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className={`${inputCls} max-w-32`} placeholder="Precio" inputMode="decimal" value={v.price} onChange={(e) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
              <Btn kind="ghost" onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}>✕</Btn>
            </div>
          ))}
          <div><Btn size="sm" onClick={() => setVariants((vs) => [...vs, { name: "", price: "" }])}>+ Agregar tamaño</Btn></div>
        </div>
      )}

      {tab === "opciones" && (
        <div className="grid gap-4">
          <p className="text-sm text-muted">Grupos de opciones como "Punto de cocción" (elegir 1, obligatorio) o "Extras" (hasta 3, con precio).</p>
          {groups.map((g, gi) => (
            <div key={gi} className="rounded-2xl border border-line p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1">
                  <Field label="Grupo">
                    <input className={inputCls} value={g.name} onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === gi ? { ...x, name: e.target.value } : x)))} />
                  </Field>
                </div>
                <Field label="Mínimo">
                  <input className={`${inputCls} w-20`} type="number" min={0} max={10} value={g.min} onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === gi ? { ...x, min: Number(e.target.value) } : x)))} />
                </Field>
                <Field label="Máximo">
                  <input className={`${inputCls} w-20`} type="number" min={1} max={10} value={g.max} onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === gi ? { ...x, max: Number(e.target.value) } : x)))} />
                </Field>
                <Btn kind="ghost" onClick={() => setGroups((gs) => gs.filter((_, j) => j !== gi))}>Quitar grupo</Btn>
              </div>
              <div className="mt-2 grid gap-2">
                {g.modifiers.map((m, mi) => (
                  <div key={mi} className="flex gap-2">
                    <input className={inputCls} placeholder="Opción" value={m.name} onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === gi ? { ...x, modifiers: x.modifiers.map((y, k) => (k === mi ? { ...y, name: e.target.value } : y)) } : x)))} />
                    <input className={`${inputCls} max-w-28`} placeholder="+ precio" inputMode="decimal" value={m.price} onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === gi ? { ...x, modifiers: x.modifiers.map((y, k) => (k === mi ? { ...y, price: e.target.value } : y)) } : x)))} />
                    <Btn kind="ghost" onClick={() => setGroups((gs) => gs.map((x, j) => (j === gi ? { ...x, modifiers: x.modifiers.filter((_, k) => k !== mi) } : x)))}>✕</Btn>
                  </div>
                ))}
                <div><Btn size="sm" onClick={() => setGroups((gs) => gs.map((x, j) => (j === gi ? { ...x, modifiers: [...x.modifiers, { name: "", price: "0" }] } : x)))}>+ Opción</Btn></div>
              </div>
            </div>
          ))}
          <div><Btn size="sm" onClick={() => setGroups((gs) => [...gs, { name: "", min: 0, max: 1, modifiers: [{ name: "", price: "0" }] }])}>+ Agregar grupo</Btn></div>
        </div>
      )}

      {tab === "medios" && dish && (
        <div className="grid gap-4">
          <MediaRow
            title="Foto"
            hint="JPG, PNG o WebP, hasta 5 MB"
            accept="image/jpeg,image/png,image/webp"
            current={dish.assets.PHOTO}
            preview
            busy={busy}
            onFile={(f) => uploadFile("PHOTO", f)}
            onRemove={() => removeMedia("PHOTO")}
          />
          <MediaRow
            title="Modelo 3D (.glb)"
            hint="Para el visor 3D y la Realidad Aumentada en Android. Hasta 25 MB; ideal menos de 1,5 MB."
            accept=".glb,model/gltf-binary"
            current={dish.assets.GLB_LOD0}
            busy={busy}
            onFile={(f) => uploadFile("GLB_LOD0", f)}
            onRemove={() => removeMedia("GLB_LOD0")}
          />
          <MediaRow
            title="Modelo para iPhone (.usdz)"
            hint="Opcional: si no está, el iPhone lo genera a partir del .glb."
            accept=".usdz"
            current={dish.assets.USDZ}
            busy={busy}
            onFile={(f) => uploadFile("USDZ", f)}
            onRemove={() => removeMedia("USDZ")}
          />
        </div>
      )}
    </Modal>
  );
}

function MediaRow({
  title,
  hint,
  accept,
  current,
  preview,
  busy,
  onFile,
  onRemove,
}: {
  title: string;
  hint: string;
  accept: string;
  current?: { url: string; bytes: number | null };
  preview?: boolean;
  busy: boolean;
  onFile: (f: File | undefined) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line p-3">
      {preview && (
        <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-xl bg-surface-2 text-2xl">
          {current ? <img src={current.url} alt="" className="h-full w-full object-cover" /> : "📷"}
        </div>
      )}
      <div className="min-w-48 flex-1">
        <p className="font-semibold">{title} {current && <Badge tone="ok">cargado</Badge>}</p>
        <p className="text-xs text-muted">{hint}</p>
        {current && (
          <p className="mt-1 truncate text-xs text-muted">
            {current.url}
            {current.bytes ? ` · ${(current.bytes / 1024 / 1024).toFixed(1)} MB` : ""}
          </p>
        )}
      </div>
      <label className={`inline-flex h-10 cursor-pointer items-center rounded-xl bg-amber px-4 text-sm font-semibold text-amber-ink ${busy ? "pointer-events-none opacity-40" : ""}`}>
        {current ? "Reemplazar" : "Subir"}
        <input type="file" accept={accept} className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {current && <Btn kind="ghost" onClick={onRemove}>Quitar</Btn>}
    </div>
  );
}

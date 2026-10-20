"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Btn, Card, Empty, Field, Modal, Toggle, inputCls, useToasts } from "@/components/ui";
import { type AdminTable, type AdminTables, api } from "@/lib/api";

const BASE_KEY = "bar.admin.guestBase";

const STATUS: Record<AdminTable["status"], { label: string; tone: "muted" | "ok" | "warn" | "amber" }> = {
  FREE: { label: "libre", tone: "muted" },
  PENDING: { label: "esperando al mozo", tone: "amber" },
  OPEN: { label: "ocupada", tone: "ok" },
  BILL_REQUESTED: { label: "pidió la cuenta", tone: "warn" },
};

function useQr(url: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return setSrc(null);
    let alive = true;
    QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M", color: { dark: "#14110f", light: "#ffffff" } })
      .then((d) => alive && setSrc(d))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [url]);
  return src;
}

export function TablesQr() {
  const { run, view, push } = useToasts();
  const [data, setData] = useState<AdminTables | null>(null);
  const [base, setBase] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminTable | null>(null);
  const [nfcFor, setNfcFor] = useState<AdminTable | null>(null);

  const load = useCallback(async () => {
    const d = await run(() => api<AdminTables>("/admin/tables"));
    if (d) {
      setData(d);
      setBase((b) => {
        if (b) return b;
        try {
          return localStorage.getItem(BASE_KEY) || d.guestBaseUrl;
        } catch {
          return d.guestBaseUrl;
        }
      });
    }
  }, [run]);
  useEffect(() => {
    void load();
  }, [load]);

  const saveBase = (v: string) => {
    setBase(v);
    try {
      localStorage.setItem(BASE_KEY, v);
    } catch {
      /* noop */
    }
  };

  const baseOk = /^https?:\/\/[^\s/]+(:\d+)?$/.test(base.replace(/\/+$/, ""));
  const urlFor = useCallback((code: string) => `${base.replace(/\/+$/, "")}/t/${code}`, [base]);
  const active = useMemo(() => data?.tables.filter((t) => t.active && t.qr) ?? [], [data]);

  const regenerate = async (t: AdminTable) => {
    if (!confirm(`¿Generar un QR nuevo para la mesa ${t.label}? El QR impreso actual deja de funcionar.`)) return;
    if (await run(() => api(`/admin/tables/${t.id}/regenerate-qr`, { method: "POST" }), "QR nuevo generado")) await load();
  };

  if (!data) return <Empty>Cargando mesas…</Empty>;

  return (
    <div className="grid gap-4">
      {view}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Field
              label="Dirección de la carta (para los QR)"
              hint="La que abre el celular del cliente: tu dominio, el túnel HTTPS o la IP de la red local (http://192.168.x.x:3000)."
            >
              <input className={inputCls} value={base} onChange={(e) => saveBase(e.target.value.trim())} placeholder="https://carta.tubar.com" />
            </Field>
          </div>
          <Btn onClick={() => saveBase(data.guestBaseUrl)}>Usar la del servidor</Btn>
          <Btn kind="primary" disabled={!baseOk || active.length === 0} onClick={() => window.print()}>🖨️ Imprimir todos los QR</Btn>
          <Btn onClick={() => setCreating(true)}>+ Mesa</Btn>
        </div>
        {!baseOk && <p className="mt-2 text-sm text-warn">La dirección no es válida: tiene que empezar con http:// o https:// y no llevar ruta.</p>}
        {base.startsWith("http://localhost") && (
          <p className="mt-2 text-sm text-warn">Ojo: "localhost" solo funciona en esta compu. Para el celular usá la IP de la red o el túnel HTTPS.</p>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {data.tables.map((t) => (
          <TableCard
            key={t.id}
            table={t}
            url={t.qr ? urlFor(t.qr.code) : null}
            onCopy={(u) => navigator.clipboard?.writeText(u).then(() => push("Link copiado"))}
            onRegenerate={() => regenerate(t)}
            onEdit={() => setEditing(t)}
            onNfc={() => setNfcFor(t)}
          />
        ))}
      </div>

      {/* Hoja de impresión: solo se ve al imprimir (globals.css → @media print) */}
      <div className="print-area hidden">
        <div className="grid grid-cols-3 gap-6 p-6">
          {active.map((t) => (
            <PrintCard key={t.id} label={t.label} url={urlFor(t.qr!.code)} />
          ))}
        </div>
      </div>

      {creating && <TableModal areas={data.areas} onClose={() => setCreating(false)} onSaved={load} />}
      {editing && <TableModal table={editing} areas={data.areas} onClose={() => setEditing(null)} onSaved={load} />}
      {nfcFor && <NfcModal table={nfcFor} onClose={() => setNfcFor(null)} onSaved={load} />}
    </div>
  );
}

function TableCard({
  table,
  url,
  onCopy,
  onRegenerate,
  onEdit,
  onNfc,
}: {
  table: AdminTable;
  url: string | null;
  onCopy: (u: string) => void;
  onRegenerate: () => void;
  onEdit: () => void;
  onNfc: () => void;
}) {
  const qr = useQr(table.active ? url : null);
  const st = STATUS[table.status];
  return (
    <Card className={table.active ? "" : "opacity-50"}>
      <div className="flex items-center gap-2">
        <h3 className="font-display text-2xl">Mesa {table.label}</h3>
        <span className="flex-1" />
        {table.active ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge>desactivada</Badge>}
      </div>
      <p className="text-xs text-muted">
        {table.seats} lugares {table.nfc?.uid ? "· 📡 NFC vinculado" : ""}
      </p>
      <div className="mt-3 flex gap-3">
        <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-xl bg-white">
          {qr ? <img src={qr} alt={`QR de la mesa ${table.label}`} className="h-full w-full" /> : <span className="text-xs text-ink/50">sin QR</span>}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {url && (
            <button onClick={() => onCopy(url)} className="truncate rounded-lg bg-surface-2 px-2 py-1 text-left font-mono text-[11px] text-muted" title="Copiar link">
              {url}
            </button>
          )}
          {qr && (
            <a href={qr} download={`QR-mesa-${table.label}.png`} className="inline-flex h-8 items-center justify-center rounded-xl border border-line bg-surface-2 px-3 text-xs">
              ⬇ Descargar PNG
            </a>
          )}
          <Btn size="sm" onClick={onRegenerate}>QR nuevo</Btn>
          <div className="flex gap-1.5">
            <Btn size="sm" onClick={onEdit}>Editar</Btn>
            <Btn size="sm" onClick={onNfc}>NFC</Btn>
          </div>
        </div>
      </div>
    </Card>
  );
}

function PrintCard({ label, url }: { label: string; url: string }) {
  const qr = useQr(url);
  return (
    <div className="flex flex-col items-center rounded-2xl border-2 border-black p-4 text-center text-black" style={{ breakInside: "avoid" }}>
      <p className="text-2xl font-bold">Mesa {label}</p>
      {qr && <img src={qr} alt="" className="my-2 h-44 w-44" />}
      <p className="text-sm font-semibold">Escaneá para ver la carta y pedir</p>
      <p className="mt-1 text-[10px] break-all text-black/60">{url}</p>
    </div>
  );
}

function TableModal({
  table,
  areas,
  onClose,
  onSaved,
}: {
  table?: AdminTable;
  areas: AdminTables["areas"];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { run, view } = useToasts();
  const [label, setLabel] = useState(table?.label ?? "");
  const [seats, setSeats] = useState(table?.seats ?? 4);
  const [areaId, setAreaId] = useState(table?.areaId ?? "");
  const [activeT, setActiveT] = useState(table?.active ?? true);
  const save = async () => {
    const body = { label: label.trim(), seats, areaId: areaId || null, ...(table ? { active: activeT } : {}) };
    const ok = await run(
      () => (table ? api(`/admin/tables/${table.id}`, { method: "PATCH", body }) : api("/admin/tables", { method: "POST", body })),
      table ? "Mesa actualizada" : "Mesa creada con su QR",
    );
    if (ok) {
      await onSaved();
      onClose();
    }
  };
  return (
    <Modal
      open
      title={table ? `Mesa ${table.label}` : "Nueva mesa"}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn kind="primary" disabled={!label.trim()} onClick={save}>Guardar</Btn>
        </>
      }
    >
      {view}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre o número">
          <input autoFocus className={inputCls} value={label} maxLength={20} onChange={(e) => setLabel(e.target.value)} placeholder="7, Barra 2, Terraza 1…" />
        </Field>
        <Field label="Lugares">
          <input className={inputCls} type="number" min={1} max={40} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
        </Field>
        <Field label="Área">
          <select className={inputCls} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">— Sin área —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>
        {table && (
          <label className="flex items-center gap-3 pt-6 text-sm">
            <Toggle checked={activeT} onChange={setActiveT} label="Mesa activa" /> {activeT ? "Activa" : "Desactivada (el QR no abre la carta)"}
          </label>
        )}
      </div>
    </Modal>
  );
}

function NfcModal({ table, onClose, onSaved }: { table: AdminTable; onClose: () => void; onSaved: () => Promise<void> }) {
  const { run, view } = useToasts();
  const [uid, setUid] = useState(table.nfc?.uid ?? "");
  const valid = /^[0-9a-fA-F]{14}$/.test(uid);
  const link = async (value: string | null) => {
    if (await run(() => api(`/admin/tables/${table.id}/nfc`, { method: "PUT", body: { uid: value } }), value ? "Chip vinculado" : "Chip desvinculado")) {
      await onSaved();
      onClose();
    }
  };
  return (
    <Modal
      open
      title={`NFC · Mesa ${table.label}`}
      onClose={onClose}
      footer={
        <>
          {table.nfc?.uid && <Btn kind="danger" onClick={() => link(null)}>Desvincular</Btn>}
          <span className="flex-1" />
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn kind="primary" disabled={!valid} onClick={() => link(uid.toUpperCase())}>Vincular chip</Btn>
        </>
      }
    >
      {view}
      <div className="grid gap-3 text-sm">
        <p className="text-muted">
          Con un chip <b>NTAG 424 DNA</b> el cliente apoya el celular y la mesa se abre sola, con prueba de presencia física (cada toque
          firma un contador que no se puede reusar).
        </p>
        <Field label="UID del chip" hint="14 caracteres hexadecimales (lo muestra la app NXP TagWriter / TagXplorer)">
          <input className={`${inputCls} font-mono uppercase`} value={uid} maxLength={14} onChange={(e) => setUid(e.target.value.replace(/[^0-9a-fA-F]/g, ""))} placeholder="04A1B2C3D4E5F6" />
        </Field>
        {table.nfc && (
          <Field label="URL a grabar en el chip (SDM / SUN mirroring)">
            <code className="block rounded-xl bg-surface-2 p-3 text-xs break-all">{table.nfc.urlTemplate}</code>
          </Field>
        )}
        <p className="text-xs text-muted">
          En el chip, configurá el espejo de UID, contador y CMAC sobre {"{UID}"}, {"{CTR}"} y {"{CMAC}"}, con la clave de archivo SDM igual a
          NFC_MASTER_KEY del servidor.
        </p>
      </div>
    </Modal>
  );
}

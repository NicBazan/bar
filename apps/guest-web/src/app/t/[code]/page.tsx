import type { Metadata } from "next";
import { JoinTableButton } from "@/components/JoinTableButton";
import { ApiError, api, type TagInfo } from "@/lib/api";

interface TableWelcomePageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: TableWelcomePageProps): Promise<Metadata> {
  const { code } = await params;
  try {
    const info = await api<TagInfo>(`/tags/${code}`);
    return {
      title: `${info.venue.name} · Mesa ${info.table.label}`,
      description: `Carta digital y pedidos para la Mesa ${info.table.label} en ${info.venue.name}`,
    };
  } catch {
    return {
      title: "Mesa · Carta Digital",
    };
  }
}

export default async function TableWelcomePage({ params }: TableWelcomePageProps) {
  const { code } = await params;

  let tagInfo: TagInfo | null = null;
  let notFoundError = false;

  try {
    tagInfo = await api<TagInfo>(`/tags/${code}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFoundError = true;
    }
  }

  if (notFoundError || !tagInfo) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center p-6 text-center">
        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl border border-line bg-surface text-4xl shadow-xl">
          🔍
        </div>
        <h1 className="font-display text-2xl text-cream">Mesa no encontrada</h1>
        <p className="mt-2 text-sm text-muted">
          El código QR o NFC no corresponde a una mesa activa de nuestro sistema.
        </p>
        <div className="mt-6 rounded-2xl border border-line bg-surface p-4 text-xs text-muted">
          Por favor, solicita asistencia al personal del bar.
        </div>
      </main>
    );
  }

  const { venue, table } = tagInfo;

  return (
    <main className="relative mx-auto flex min-h-dvh max-w-md flex-col justify-between overflow-hidden px-6 py-12 text-center">
      {/* Glow ambiental decorativo */}
      <div className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-72 w-72 -translate-x-1/2 rounded-full bg-amber/10 blur-[100px]"></div>

      {/* Cabecera / Identidad */}
      <header className="flex flex-col items-center pt-8">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl border border-line/60 bg-gradient-to-br from-surface-2 to-surface text-4xl shadow-2xl ring-1 ring-white/5">
          🍸
        </div>
        <span className="text-xs font-semibold tracking-widest text-amber uppercase">
          Bienvenidos a
        </span>
        <h1 className="mt-2 font-display text-4xl font-normal tracking-tight text-cream">
          {venue.name}
        </h1>
      </header>

      {/* Tarjeta de Mesa Central */}
      <section className="my-auto flex flex-col items-center py-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-5 py-2 shadow-inner backdrop-blur-md">
          <span className="h-2 w-2 rounded-full bg-ok animate-pulse"></span>
          <span className="text-sm font-medium tracking-wide text-cream/90">
            Mesa activa
          </span>
        </div>

        <div className="mt-4 font-display text-6xl font-light tracking-tight text-amber">
          {table.label}
        </div>
        <p className="mt-2 text-xs text-muted">
          Tu pedido se preparará y enviará directamente a este lugar
        </p>
      </section>

      {/* Acción de Entrada */}
      <footer className="flex flex-col items-center pb-4">
        <JoinTableButton
          code={code}
          venueId={venue.id}
          tableLabel={table.label}
        />
        <p className="mt-6 text-[11px] tracking-wide text-muted/60">
          Experiencia gastronómica interactiva · Sin descargas
        </p>
      </footer>
    </main>
  );
}

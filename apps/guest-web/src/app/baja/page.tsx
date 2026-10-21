import type { Metadata, Viewport } from "next";
import { UnsubscribeButton } from "./UnsubscribeButton";

export const metadata: Metadata = { title: "Dejar de recibir promos" };
export const viewport: Viewport = { themeColor: "#faf8f5" };

/** Link de baja de cada email de promos: un toque y listo (Ley 25.326) */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-5 text-night">
      <div className="w-full max-w-sm rounded-[28px] bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Dejar de recibir promos por email</h1>
        <p className="mt-2 text-sm text-night/60">Vas a seguir pudiendo usar tu cuenta y tus puntos. Podés volver a activarlas desde tu perfil.</p>
        {t ? <UnsubscribeButton token={t} /> : <p className="mt-4 text-sm text-brand-dark">El link está incompleto.</p>}
      </div>
    </main>
  );
}

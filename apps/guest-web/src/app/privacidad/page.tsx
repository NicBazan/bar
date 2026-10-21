import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Política de privacidad" };
export const viewport: Viewport = { themeColor: "#faf8f5" };

/** Texto base para "Mi cuenta" (Ley 25.326 de Protección de Datos Personales) */
export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-paper text-night">
      <article className="mx-auto max-w-md space-y-4 px-5 py-10 text-sm leading-relaxed">
        <h1 className="text-2xl font-semibold">Política de privacidad de "Mi cuenta"</h1>
        <p>
          Esta cuenta es opcional: podés pedir desde la mesa sin registrarte. Si creás una cuenta, el bar donde la creaste es el
          responsable de tus datos. Cada bar tiene su propia cuenta y no comparte datos con otros bares.
        </p>
        <h2 className="pt-2 font-semibold">Qué datos guardamos</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Tu email y, si lo cargás, tu nombre.</li>
          <li>Tus pedidos y visitas en ese bar, y los puntos o sellos que sumes.</li>
          <li>Si las activás, tus preferencias de avisos (notificaciones o emails de promos).</li>
        </ul>
        <p>No guardamos tu ubicación ni contraseñas: entrás con un código que te llega por email.</p>
        <h2 className="pt-2 font-semibold">Para qué los usamos</h2>
        <p>
          Para mostrarte tu historial, sumar tus puntos y, solo si lo aceptás aparte, mandarte promociones del bar (como máximo
          una por semana). Podés darte de baja de los avisos en un toque desde cada email o desde tu perfil.
        </p>
        <h2 className="pt-2 font-semibold">Tus derechos</h2>
        <p>
          Desde tu perfil podés descargar todos tus datos y borrar tu cuenta cuando quieras. Al borrarla, tus pedidos quedan en
          el bar sin tu nombre ni tu email (el bar los necesita para su contabilidad). El titular de los datos tiene la
          facultad de ejercer el derecho de acceso a los mismos en forma gratuita a intervalos no inferiores a seis meses, salvo
          que se acredite un interés legítimo al efecto (art. 14, inc. 3, Ley 25.326). La Agencia de Acceso a la Información
          Pública, órgano de control de la Ley 25.326, atiende las denuncias y reclamos relacionados con el incumplimiento de
          las normas sobre protección de datos personales.
        </p>
      </article>
    </main>
  );
}

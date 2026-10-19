export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-5xl">📱</div>
      <h1 className="font-display text-3xl">Escaneá el QR de tu mesa</h1>
      <p className="text-muted">O apoyá el celular sobre la tarjeta NFC para ver la carta y pedir.</p>
    </main>
  );
}

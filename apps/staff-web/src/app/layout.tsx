import type { Metadata, Viewport } from "next";
import { Fraunces, Outfit } from "next/font/google";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme";

// Títulos en Fraunces (serif suave) y texto en Outfit (sans redondeada), como la referencia del 09/11.
// Autoalojadas por next/font: no se piden a Google en cada visita
const serif = Fraunces({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-serif", display: "swap" });
const sans = Outfit({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Panel del local",
  description: "Mozo, cocina y administración",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#faf6f1" }, { media: "(prefers-color-scheme: dark)", color: "#1b1917" }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        {/* Tema elegido (claro/oscuro) antes de pintar: sin parpadeo */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}

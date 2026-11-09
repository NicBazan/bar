import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme";

// IBM Plex Sans (base de conocimientos: Inter delata UI generica); autoalojada por next/font, sin pedir a Google en runtime
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-plex", display: "swap" });

export const metadata: Metadata = {
  title: "Panel del local",
  description: "Mozo, cocina y administración",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f5f6" }, { media: "(prefers-color-scheme: dark)", color: "#101216" }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${sans.variable}`} suppressHydrationWarning>
      <head>
        {/* Tema elegido (claro/oscuro) antes de pintar: sin parpadeo */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}

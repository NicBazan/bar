import type { NextConfig } from "next";

// URL de la API vista desde el servidor de Next (en Vercel: la URL pública de Render)
const API_ORIGIN = (process.env.API_INTERNAL_URL ?? "http://localhost:4000").replace(/\/+$/, "");
const isProd = process.env.NODE_ENV === "production";

// CSP del panel (más estricta que la carta: sin 3D ni decodificadores externos).
// unsafe-inline: Next inyecta scripts inline para hidratar. En dev no se aplica (Next necesita eval).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  transpilePackages: ["@bar/shared-types"],
  poweredByHeader: false,
  // Dev desde otros dispositivos: celular por Wi-Fi y túnel HTTPS de Cloudflare
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.trycloudflare.com", "localhost"],
  // El navegador llama a /v1/* en el MISMO dominio y Next lo reenvía a la API:
  // sin CORS, funciona igual por localhost, por la IP de la red, por el túnel o en producción.
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${API_ORIGIN}/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          ...(isProd
            ? [
                { key: "Content-Security-Policy", value: CSP },
                { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;

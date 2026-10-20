import type { NextConfig } from "next";

// URL de la API vista desde el servidor de Next (en Vercel: la URL pública de Render)
const API_ORIGIN = (process.env.API_INTERNAL_URL ?? "http://localhost:4000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@bar/shared-types"],
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
        ],
      },
    ];
  },
};

export default nextConfig;

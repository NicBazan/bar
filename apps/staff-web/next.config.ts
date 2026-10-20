import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@bar/shared-types"],
  // Permite abrir el panel en dev desde otros dispositivos de la red (tablet de cocina, celular)
  allowedDevOrigins: ["192.168.100.25", "localhost"],
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

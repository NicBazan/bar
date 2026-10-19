import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@bar/shared-types"],
  allowedDevOrigins: ["192.168.100.25", "172.25.240.1", "localhost"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;

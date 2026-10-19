const isProd = process.env.NODE_ENV === "production";

function required(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProd) throw new Error(`Falta la variable de entorno ${name}`);
  return devDefault;
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  // En dev se usa un secreto fijo; en producción es obligatorio
  jwtSecret: new TextEncoder().encode(required("JWT_SECRET", "dev-only-secret-change-me-0123456789")),
  nfcMasterKey: required("NFC_MASTER_KEY", "00112233445566778899AABBCCDDEEFF"),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001").split(","),
  guestTokenTtl: "12h",
  staffTokenTtl: "12h",
  serviceCallCooldownSec: 60,
};

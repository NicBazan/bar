import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Los tests e2e usan la base de desarrollo con el seed del bar demo
    env: {
      DATABASE_URL: "postgresql://bar:bar_dev_password@localhost:5433/bar?schema=public",
      // Clave de fábrica del NTAG 424 (todo ceros): permite usar el vector de ejemplo de NXP
      NFC_MASTER_KEY: "00000000000000000000000000000000",
    },
    testTimeout: 20000,
    fileParallelism: false,
  },
});

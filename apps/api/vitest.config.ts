import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./test/test-db.js";

export default defineConfig({
  test: {
    // Base propia de los tests (bar_test), creada, migrada y con el seed en cada corrida
    globalSetup: ["./test/global-setup.ts"],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      // Clave de fábrica del NTAG 424 (todo ceros): permite usar el vector de ejemplo de NXP
      NFC_MASTER_KEY: "00000000000000000000000000000000",
    },
    testTimeout: 20000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});

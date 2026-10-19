import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Los tests e2e usan la base de desarrollo con el seed del bar demo
    env: { DATABASE_URL: "postgresql://bar:bar_dev_password@localhost:5433/bar?schema=public" },
    testTimeout: 20000,
    fileParallelism: false,
  },
});

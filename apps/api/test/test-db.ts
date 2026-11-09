// Base exclusiva de los tests. Se puede cambiar con TEST_DATABASE_URL (por ejemplo, en CI).
// Nunca apunta a la base de desarrollo (`bar`): ver global-setup.ts.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://bar:bar_dev_password@localhost:5433/bar_test?schema=public";

if (/\/bar(\?|$)/.test(TEST_DATABASE_URL)) {
  throw new Error("TEST_DATABASE_URL apunta a la base de desarrollo; los tests necesitan una base propia");
}

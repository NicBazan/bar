// Prepara una base de datos SOLO para tests (`bar_test`), separada de la de desarrollo:
// los tests crean, cierran y borran datos, y no deben tocar el bar demo con el que se prueba a mano.
// En cada corrida: crea la base si falta, aplica las migraciones y recarga el seed (estado conocido).
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@bar/db";
import { TEST_DATABASE_URL } from "./test-db.js";

const dbPackage = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/db");

// Comandos fijos (sin entrada externa). execSync usa la shell, necesaria en Windows para los .cmd de node_modules/.bin
function run(command: string) {
  execSync(command, { cwd: dbPackage, env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, stdio: "inherit" });
}

async function ensureDatabase() {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Nombre de base de test inválido: ${name}`);
  // Conexión a la base de mantenimiento del mismo servidor para poder crear la de test
  url.pathname = "/postgres";
  const admin = new PrismaClient({ datasourceUrl: url.toString() });
  try {
    const rows = await admin.$queryRaw<Array<{ exists: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name}) AS "exists"`;
    if (!rows[0]?.exists) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }
}

export default async function setup() {
  await ensureDatabase();
  run("pnpm exec prisma migrate deploy");
  run("pnpm exec tsx prisma/seed.ts");
}

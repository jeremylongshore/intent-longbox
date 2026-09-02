import { mkdirSync } from "node:fs";
import { loadConfig } from "./config.js";
import { getPool } from "./db.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error("DATABASE_URL is not set");
  mkdirSync(config.uploadsDir, { recursive: true });
  const db = getPool(config.databaseUrl);
  const app = await buildApp(db, config);
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

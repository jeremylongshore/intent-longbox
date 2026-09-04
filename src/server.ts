import { mkdirSync } from "node:fs";
import { loadConfig } from "./config.js";
import { getPool } from "./db.js";
import { buildApp } from "./app.js";
import { assertAppendOnlyTriggersOrThrow, scheduleAppendOnlyCheck } from "./services/appendOnlyDetector.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error("DATABASE_URL is not set");
  mkdirSync(config.uploadsDir, { recursive: true });
  const db = getPool(config.databaseUrl);
  // Fail closed BEFORE the app is built or a port is bound (E02-D05, 041 §9.2): if
  // locked decision 4 is not enforced in the database, this process must not accept
  // writes it cannot promise are immutable. Then re-check every five minutes, which
  // is the only instrument that catches a trigger disabled after boot.
  await assertAppendOnlyTriggersOrThrow(db);
  const app = await buildApp(db, config);
  scheduleAppendOnlyCheck(db, app.log);
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

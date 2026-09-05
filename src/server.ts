import { mkdirSync } from "node:fs";
import { assertGatewayConfigOrThrow, loadConfig } from "./config.js";
import { getPool } from "./db.js";
import { buildApp } from "./app.js";
import { assertAppendOnlyTriggersOrThrow, scheduleAppendOnlyCheck } from "./services/appendOnlyDetector.js";
import { assertRoleSeparationOrThrow, assertTenantIsolationOrThrow } from "./services/roleSeparation.js";
import { loadOutboxParams, startOutboxPoller } from "./services/outbox.js";
import { buildConsumerRegistry } from "./consumers/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error("DATABASE_URL is not set");
  // E03-D01 / 046 §11 I5: the gateway override outranks EVERY per-shop
  // credential (046 §7.3), so its scope is checked before anything else — a
  // half-configured pair or a host off the registered allowlist stops the boot.
  // First, and before the database is touched, because this is the one
  // misconfiguration whose consequence is every shop's key leaving the estate.
  assertGatewayConfigOrThrow();
  mkdirSync(config.uploadsDir, { recursive: true });
  const db = getPool(config.databaseUrl);
  // Fail closed BEFORE the app is built or a port is bound (E02-D05, 041 §9.2): if
  // locked decision 4 is not enforced in the database, this process must not accept
  // writes it cannot promise are immutable. Then re-check every five minutes, which
  // is the only instrument that catches a trigger disabled after boot.
  // Role separation FIRST (E02-D06, 041 §9.2 item 2). It is the stronger of the
  // two controls and it is the reason the trigger check below can be trusted: a
  // connection that could turn the triggers off would pass the trigger check at
  // boot and still be able to fail it a second later. Ordered first so the error
  // a misconfigured deployment sees names the actual defect — the wrong role in
  // DATABASE_URL — rather than a downstream symptom.
  await assertRoleSeparationOrThrow(db);
  // THE TENANT BOUNDARY, CHECKED BEFORE A PORT IS BOUND (E03-B04, 019 T24).
  // Third in the sequence and for the same fail-closed reason as the two around
  // it: 034 §3.4 says row-level security "fails to a database misconfiguration",
  // and a restored dump, a policy dropped during an incident or a role granted
  // BYPASSRLS all leave a server that reads and writes perfectly well with no
  // tenant boundary at all. T24 is non-waivable, so this process does not serve
  // requests it cannot promise are isolated.
  await assertTenantIsolationOrThrow(db);
  await assertAppendOnlyTriggersOrThrow(db);
  const app = await buildApp(db, config);
  scheduleAppendOnlyCheck(db, app.log);
  // ONE POLLER PER PROCESS (043 §7.1), started AFTER both fail-closed checks
  // above and given the same shape as the detector beside it: an unref'd
  // setInterval returning a stop function. Ordered after them deliberately — a
  // worker that drained the queue while the append-only guarantee was off would
  // be performing irreversible external effects and appending attempt rows that
  // something could edit behind it.
  //
  // Two processes are safe by construction: each one's claim transaction takes
  // `FOR UPDATE … SKIP LOCKED`, so the second skips rows the first holds. No
  // lease table, no worker registry, no leader election (043 §7.2).
  // The connector ring is resolved ONCE, by `loadConfig`, which is also where
  // the fail-closed refusal lives — so no job re-scans `process.env` for a key
  // this process already holds (the invariant review of `16f17ef`, note 8).
  startOutboxPoller(
    db,
    buildConsumerRegistry({ ...(config.connectorKeys ? { keyring: config.connectorKeys } : {}) }),
    loadOutboxParams(),
    app.log
  );
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

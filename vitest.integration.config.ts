import { defineConfig } from "vitest/config";

// Postgres-backed integration + HTTP smoke lane. Gated by INTEGRATION=1
// (pnpm test:integration). Skips cleanly when no database is reachable —
// see tests/integration/helpers.ts.
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // Each file provisions its own database; keep files sequential so a local
    // single Postgres container isn't hammered by parallel CREATE DATABASE.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**", "node_modules/**"],
    environment: "node",
    coverage: {
      provider: "v8",
      // Coverage floor is scoped to the pure/service logic; routes + db glue are
      // exercised by the Postgres integration lane instead (see TESTING.md).
      //
      // `src/consumers/**` joined the set with E02-D07. It is not glue: a job
      // handler holds the fail-closed listing guard (043 §4.3, A3) and the
      // draft-composition rules that 019 T7 and locked decision 5 bind, and both
      // are pure decisions a unit test can reach. Leaving the directory outside
      // the include would have meant the one function whose POLARITY is the most
      // costly amendment in 043 contributed nothing to the floor.
      //
      // `src/catalog/**` joined with E04-D06, on the same test and for the same
      // reason. It is the least glue-like directory in the tree: `certify()` is
      // ~790 lines of refusals standing between a mistaken manifest and an
      // IMMUTABLE `vertical_pack_version` row that every later definition and
      // edition cites; `resolve()` is total over five outcomes and never throws;
      // the mint reconciles two retry policies on one SQLSTATE; the projection
      // rebuild decides what to do with a chain the write-time trigger says
      // cannot exist. Those are decisions, not queries — the Postgres lane
      // (`tests/integration/lcid-*.test.ts`, `catalog-edition-write.test.ts`)
      // asserts what the DATABASE guarantees, and it cannot reach any of them.
      include: [
        "src/services/**/*.ts",
        "src/providers/**/*.ts",
        "src/consumers/**/*.ts",
        "src/catalog/**/*.ts",
      ],
      thresholds: {
        lines: 80,
      },
      reporter: ["text", "html"],
    },
  },
});

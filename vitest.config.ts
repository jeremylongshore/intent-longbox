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
      include: ["src/services/**/*.ts", "src/providers/**/*.ts", "src/consumers/**/*.ts"],
      thresholds: {
        lines: 80,
      },
      reporter: ["text", "html"],
    },
  },
});

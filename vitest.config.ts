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
      include: ["src/services/**/*.ts", "src/providers/**/*.ts"],
      thresholds: {
        lines: 80,
      },
      reporter: ["text", "html"],
    },
  },
});

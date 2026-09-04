// ESLint flat config — TypeScript service. Minimal, matches existing code style:
// typescript-eslint recommended + a few correctness rules; prettier disables
// formatting rules (prettier owns formatting).
import js from "@eslint/js";
import ts from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default ts.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "uploads/**",
      "public/**", // browser-global script, not part of the Node lint surface
      ".audit-harness/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      // The codebase leans on explicit casts at the pg/query boundary.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "no-console": "off", // scripts + server logging use console deliberately
      eqeqeq: ["error", "always"],
    },
  },
  {
    // `.dependency-cruiser.cjs` is CommonJS by construction: dependency-cruiser
    // loads it with `require`, so it ends in `module.exports` and lives outside the
    // ESM surface every other file in this repo is in.
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { module: "writable", require: "readonly" } },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      // Tests cast fake pools/providers across seams.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  prettier
);

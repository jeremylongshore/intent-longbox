// `pnpm contracts:emit` — regenerate `contracts/openapi.v1.json` from the Zod
// contract. The path and the script name are 042 §2.5's, verbatim.
//
// The artifact is COMMITTED and CI fails when it differs from a regeneration
// (042 I15, `tests/contract/openapi-is-current.test.ts`). That is what makes
// §2.3's additive-only rule reviewable rather than aspirational: a contract
// change arrives as a diff in the PR, where a reviewer can see a field being
// removed or an optional one becoming required — the two changes that are `v2`
// and not `v1`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderOpenApiDocument } from "../src/contracts/v1/openapi.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const OPENAPI_PATH = join(repoRoot, "contracts", "openapi.v1.json");

mkdirSync(dirname(OPENAPI_PATH), { recursive: true });
writeFileSync(OPENAPI_PATH, renderOpenApiDocument(), "utf8");
console.log(`openapi: wrote ${OPENAPI_PATH}`);

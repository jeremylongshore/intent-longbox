// No code path in this system reads a Shopify CUSTOMER (E03-B08; 000-docs/064
// §7.3; 053 §6; 041 §8.4; 019 T32).
//
// WHY THIS TEST EXISTS AT ALL. `pnpm privacy-fulfil` and the privacy job can
// answer a `customers/redact` with `no_data_held`, and that is a CLAIM about this
// system made to a merchant and, through them, to a person. A claim like that
// must stand on something checkable, and it stands on three things — two of them
// properties of this tree:
//
//   1. no scope the connector may request reads a customer (`SHOPIFY_MAX_SCOPES`,
//      pinned in `tests/webhook-replay-policy.test.ts` and enforced two-sidedly
//      at install time);
//   2. **no code path calls a customer-bearing endpoint — this file**;
//   3. no RECORDED grant for the store carries such a scope, checked per store at
//      runtime by the job's guard.
//
// (2) is not implied by (1). A shop on the legacy static path holds a token whose
// scopes this database never recorded, so what stops that shop's data from
// containing a customer is that nothing here ASKS for one. That is a property of
// the code, and a property of the code is a property somebody can change in one
// line — which is precisely what a contract test is for.
//
// THE CHEAP WAY TO BREAK IT is a "who bought this?" feature: one GraphQL field on
// the draft mutation, one `customer` selection on an order read. The reviewer who
// would catch that is the one reading this file.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

/**
 * The paths that speak to Shopify. Deliberately NOT the whole of `src/`: this is
 * a statement about the provider surface, and widening it to every file would
 * make the test fail on the word "customer" in a comment about privacy — which
 * is answered by deleting the comment, the wrong direction.
 */
const SURFACES = [
  path.join(root, "src", "services", "shopify.ts"),
  path.join(root, "src", "services", "connectors"),
  path.join(root, "src", "consumers"),
];

/**
 * A read of a customer, as it would actually appear.
 *
 * The Admin API's customer surface is reached by a GraphQL field or connection
 * (`customer`, `customers`, `customerSegment…`) or by a REST path
 * (`/customers/…`). Each is matched as a TOKEN so that the word inside a
 * sentence does not trip it.
 */
const CUSTOMER_READS = [
  /\bcustomers?\s*\(/,
  /\bcustomers?\s*\{/,
  /["'`][^"'`]*\/customers?[/.][^"'`]*["'`]/,
  /\bcustomerSegment/,
  /\bcustomerAccount/,
];

/** Comments are prose and prose is not a call. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function filesUnder(target: string): string[] {
  if (statSync(target).isFile()) return [target];
  const out: string[] = [];
  for (const entry of readdirSync(target)) {
    const full = path.join(target, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("no customer-bearing call exists (000-docs/064 §7.3)", () => {
  const files = SURFACES.flatMap(filesUnder);

  it("scans a non-empty set of files, so a moved directory fails loudly", () => {
    // A path scan that silently matches nothing is the shape that reports
    // compliance for a directory somebody renamed.
    expect(files.length).toBeGreaterThan(4);
  });

  for (const file of files) {
    it(`${path.relative(root, file)} calls no customer surface`, () => {
      const body = stripComments(readFileSync(file, "utf8"));
      for (const pattern of CUSTOMER_READS) {
        expect(
          pattern.test(body),
          `${path.relative(root, file)} matches ${String(pattern)}. If this is a real customer ` +
            `read, then \`no_data_held\` is no longer a claim this system can make and ` +
            `000-docs/064 §7 must be reopened before the code lands.`
        ).toBe(false);
      }
    });
  }
});

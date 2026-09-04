// Contract — 043 A2(b) and §11 I5(c): the static lint on the read-then-write
// shape, run over EVERY file in `src/consumers/`.
//
// THE GATE IS AT THE DIRECTORY, NOT AT ONE HAND-PICKED CONSUMER. A rule proved
// against one example is a rule enforced by whoever remembers the example.
// Adding a consumer file enrols it here automatically; there is no list to
// update and no way to opt out.
//
// AND THE LINT IS PROVED ABLE TO FAIL (029 §5 move 8: "prove the gate can
// fail"). A deliberately-bad fixture is analysed below and MUST be flagged. A
// gate that has never been seen to fail is a gate nobody has checked.
//
// Bead: longbox-e5b.2.17 (E02-D07). Docs: 043 §3.2, A2, §11 I5; 042 I22.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { analyzeWriteShape } from "../lint/writeShape.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const consumersDir = path.join(root, "src", "consumers");
const consumerFiles = readdirSync(consumersDir).filter((f) => f.endsWith(".ts"));

describe("the read-then-write lint can fail (029 §5 move 8)", () => {
  it("flags a handler that SELECTs a table and then INSERTs it with no ON CONFLICT", () => {
    // This fixture is the exact shape that passes a deliver-twice-in-sequence
    // test and breaks at the same instant.
    const bad = `
      export async function badConsumer(tx) {
        const existing = await tx.query(\`SELECT id FROM shopify_draft WHERE scan_session_id = $1\`, [s]);
        if (existing.rows.length === 0) {
          await tx.query(\`INSERT INTO shopify_draft (scan_session_id, shop_id) VALUES ($1,$2)\`, [s, sh]);
        }
      }`;
    const findings = analyzeWriteShape(bad);
    expect(findings.map((f) => f.table)).toEqual(["shopify_draft"]);
    expect(findings[0]!.reason).toContain("read-then-write shape");
  });

  it("flags a SELECT-then-UPDATE on the same table too", () => {
    const bad = `
      const row = await tx.query(\`SELECT status FROM scan_session WHERE id = $1\`);
      await tx.query(\`UPDATE scan_session SET status = $2 WHERE id = $1\`);`;
    expect(analyzeWriteShape(bad).map((f) => f.table)).toEqual(["scan_session"]);
  });

  it("accepts a write guarded by ON CONFLICT — the constraint IS the idempotency", () => {
    const good = `
      await tx.query(\`SELECT id FROM shopify_draft WHERE outbox_id = $1\`);
      await tx.query(\`INSERT INTO shopify_draft (outbox_id) VALUES ($1) ON CONFLICT (outbox_id) DO NOTHING\`);`;
    expect(analyzeWriteShape(good)).toEqual([]);
  });

  it("accepts a read guarded by FOR UPDATE — the row lock makes it atomic (041 §4.2)", () => {
    // A lint that flagged the anchor-lock pattern would be telling every correct
    // handler in the tree to stop taking its lock.
    const good = `
      await tx.query(\`SELECT * FROM scan_session WHERE id = $1 FOR UPDATE\`);
      await tx.query(\`UPDATE scan_session SET status = $2 WHERE id = $1\`);`;
    expect(analyzeWriteShape(good)).toEqual([]);
  });

  it("ignores SQL words that appear only in a comment", () => {
    const good = `
      // INSERT INTO shopify_draft would be wrong here; see 043 §3.2.
      /* SELECT id FROM shopify_draft */
      export const x = 1;`;
    expect(analyzeWriteShape(good)).toEqual([]);
  });
});

describe("every registered consumer's write shape (043 A2(b))", () => {
  it("finds consumer files to lint at all — an empty sweep is not a pass", () => {
    // The failure this guards against is the lint quietly checking nothing after
    // a directory move: zero files scanned reads exactly like zero violations.
    expect(consumerFiles.length).toBeGreaterThan(0);
    expect(consumerFiles).toContain("draftRequested.ts");
  });

  it.each(consumerFiles)("%s performs no unprotected read-then-write", (file) => {
    const findings = analyzeWriteShape(readFileSync(path.join(consumersDir, file), "utf8"));
    expect(findings.map((f) => `${file}: ${f.reason}`)).toEqual([]);
  });
});

describe("the one write the draft consumer performs is constraint-guarded", () => {
  // THE SCOPE THE LINT ABOVE DOES NOT COVER, ASSERTED DIRECTLY RATHER THAN
  // ASSUMED. `analyzeWriteShape` reads one file and does not resolve imports, so
  // it cannot see that `draftRequested.ts` reads `shopify_draft` (the guard) and
  // writes it through `insertShopifyDraft` in `src/services/scanSession.ts`.
  // That single crossing is the whole of the gap, and this asserts it shut.
  const scanSession = readFileSync(path.join(root, "src", "services", "scanSession.ts"), "utf8");

  it("insertShopifyDraft writes through ON CONFLICT on the job id, not a prior SELECT", () => {
    const stmt = scanSession.slice(scanSession.indexOf("INSERT INTO shopify_draft"));
    expect(stmt).toContain("ON CONFLICT (outbox_id) WHERE outbox_id IS NOT NULL DO NOTHING");
  });

  it("the draft consumer never SELECTs shopify_draft to decide whether to INSERT it", () => {
    // The guard reads `shopify_draft`, but it decides whether to CALL SHOPIFY —
    // not whether to write a row. Those are different questions, and conflating
    // them is how a guard turns into an idempotency check that does not hold.
    const consumer = readFileSync(path.join(consumersDir, "draftRequested.ts"), "utf8");
    expect(consumer).not.toMatch(/rows\.length\s*===?\s*0[\s\S]{0,200}insertShopifyDraft/);
  });
});

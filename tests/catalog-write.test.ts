// WRITING A DEFINITION AND AN EDITION — the order of the steps, and the two
// refusals (E04-D06; 030 §3.3, §5.1, A4, I7; 047 §4.4, I5).
//
// `tests/integration/catalog-edition-write.test.ts` proves this against Postgres:
// the FKs hold, the append-only trigger refuses an UPDATE, the alias rows coexist
// because no UNIQUE forbids them. What that lane cannot show is the SEQUENCE and
// the REFUSALS, because both happen before the statements it observes:
//
//   * an edition whose vertical disagrees with its definition's is refused rather
//     than written, and the check reads EVERY definition row rather than the
//     newest — an edition attaching to a work that USED to be a comic is exactly
//     the broken parent pointer I7 exists to refuse, and it is invisible to a
//     check that only looks at the current row;
//   * an edition naming a definition nobody described is refused, because the FK
//     is to `lcid_registry` and therefore proves only that the NAME was minted;
//   * the mint runs INSIDE the caller's transaction and only when no LCID was
//     supplied, which is what makes 047 I5's "a mint commits with its citing row"
//     true rather than merely intended.
import { describe, expect, it } from "vitest";
import {
  UnattachedDefinitionError,
  VerticalMismatchError,
  insertDefinition,
  insertEdition,
  parseLcid,
} from "../src/catalog/index.js";
import { fakeTx } from "./fakes.js";

const CORPUS = "c0000000-0000-4000-8000-000000000001";
const PACK = "p0000000-0000-4000-8000-000000000001";

const definitionAttributes = {
  series: "Amazing Spider-Man",
  publisher: "Marvel",
  volume: "1",
  year: "1963",
};

const editionAttributes = { issue: "300", variant: null, printing: null, cover: null, coverDate: null };

/**
 * A recorder that answers the definition read with `rows` and every INSERT with
 * a row id. `rows` models `collectible_definition` newest-first, which is the
 * order the real statement returns.
 */
function tx(rows: { vertical: string; attributes: Record<string, unknown> }[] = []) {
  return fakeTx((text) => {
    if (text.includes("FROM collectible_definition")) return { rows };
    if (text.includes("RETURNING id")) return { rows: [{ id: "row-1" }] };
    return undefined;
  });
}

describe("insertDefinition — the work, and its name minted with it (047 I5)", () => {
  it("mints an LCID in the caller's transaction and cites it on the definition row", async () => {
    const w = tx();
    const out = await insertDefinition(w.tx, {
      vertical: "comic",
      verticalCode: "cmc",
      packVersionId: PACK,
      corpusVersionId: CORPUS,
      attributes: definitionAttributes,
    });
    expect(parseLcid(out.definitionLcid)).toMatchObject({ kind: "definition", verticalCode: "cmc" });
    const insert = w.only("INSERT INTO collectible_definition");
    expect(insert.values?.[0]).toBe(out.definitionLcid);
    expect(insert.values?.[1]).toBe("comic");
    // The mint happened first and in the same recorder — one transaction.
    const mintIndex = w.calls.findIndex((c) => c.text.includes("INSERT INTO lcid_registry"));
    const rowIndex = w.calls.findIndex((c) => c.text.includes("INSERT INTO collectible_definition"));
    expect(mintIndex).toBeGreaterThanOrEqual(0);
    expect(rowIndex).toBeGreaterThan(mintIndex);
  });

  it("does NOT mint when the caller supplies an LCID — a new VERSION of a known work", async () => {
    const w = tx();
    const out = await insertDefinition(w.tx, {
      vertical: "comic",
      verticalCode: "cmc",
      packVersionId: PACK,
      corpusVersionId: CORPUS,
      attributes: definitionAttributes,
      definitionLcid: "LBX-D-CMC-known",
    });
    expect(out.definitionLcid).toBe("LBX-D-CMC-known");
    expect(w.matching("INSERT INTO lcid_registry")).toHaveLength(0);
  });

  it("signs the WORK with the work's own field list, not the edition's", async () => {
    // The signature column is `definitionSignature`, resolved THROUGH the pack
    // registry — an unregistered vertical is refused here exactly as the edition
    // signature refuses it, rather than being quietly comic-signed.
    const w = tx();
    await insertDefinition(w.tx, {
      vertical: "comic",
      verticalCode: "cmc",
      packVersionId: PACK,
      corpusVersionId: CORPUS,
      attributes: definitionAttributes,
    });
    const signature = w.only("INSERT INTO collectible_definition").values?.[5] as string;
    expect(signature).toContain("amazing spider-man");
    expect(signature).not.toContain("300");
  });

  it("REFUSES an unregistered vertical before writing anything", async () => {
    const w = tx();
    await expect(
      insertDefinition(w.tx, {
        vertical: "vinyl",
        verticalCode: "vnl",
        packVersionId: PACK,
        corpusVersionId: CORPUS,
        attributes: definitionAttributes,
      })
    ).rejects.toThrow();
    expect(w.calls).toHaveLength(0);
  });

  it("defaults `authored_by` to system and `minted_by` to import, and honours both when stated", async () => {
    const w = tx();
    await insertDefinition(w.tx, {
      vertical: "comic",
      verticalCode: "cmc",
      packVersionId: PACK,
      corpusVersionId: CORPUS,
      attributes: definitionAttributes,
    });
    expect(w.only("INSERT INTO collectible_definition").values?.[6]).toBe("system");
    expect(w.only("INSERT INTO lcid_registry").values?.[4]).toBe("import");

    const w2 = tx();
    await insertDefinition(w2.tx, {
      vertical: "comic",
      verticalCode: "cmc",
      packVersionId: PACK,
      corpusVersionId: CORPUS,
      attributes: definitionAttributes,
      mintedBy: "human_review",
      authoredBy: "human",
    });
    expect(w2.only("INSERT INTO collectible_definition").values?.[6]).toBe("human");
    expect(w2.only("INSERT INTO lcid_registry").values?.[4]).toBe("human_review");
  });
});

const editionReq = {
  vertical: "comic",
  verticalCode: "cmc",
  packVersionId: PACK,
  corpusVersionId: CORPUS,
  definitionLcid: "LBX-D-CMC-known",
  attributes: editionAttributes,
};

describe("insertEdition — the two refusals (030 I7)", () => {
  it("REFUSES an edition whose definition nobody has described", async () => {
    // The FK is to `lcid_registry`, so it proves the NAME was minted and nothing
    // about whether the WORK was ever described. A definition with no attributes
    // has no series, so its edition would have no signature.
    const w = tx([]);
    await expect(insertEdition(w.tx, editionReq)).rejects.toBeInstanceOf(UnattachedDefinitionError);
    expect(w.matching("INSERT INTO edition")).toHaveLength(0);
    expect(w.matching("INSERT INTO lcid_registry")).toHaveLength(0);
  });

  it("REFUSES an edition whose vertical disagrees with its definition's", async () => {
    const w = tx([{ vertical: "sports_card", attributes: definitionAttributes }]);
    await expect(insertEdition(w.tx, editionReq)).rejects.toBeInstanceOf(VerticalMismatchError);
    expect(w.matching("INSERT INTO edition")).toHaveLength(0);
  });

  it("checks EVERY definition version, not just the newest one", async () => {
    // The newest row agrees; an older one does not. Checking only the newest
    // would attach this edition to a work that used to be something else, and
    // every later read would follow the broken pointer silently.
    const w = tx([
      { vertical: "comic", attributes: definitionAttributes },
      { vertical: "sports_card", attributes: definitionAttributes },
    ]);
    await expect(insertEdition(w.tx, editionReq)).rejects.toBeInstanceOf(VerticalMismatchError);
  });

  it("names both verticals in the refusal, so the finding is actionable", async () => {
    const w = tx([{ vertical: "tcg_card", attributes: definitionAttributes }]);
    await expect(insertEdition(w.tx, editionReq)).rejects.toThrow(/tcg_card/);
  });

  it("mints only AFTER both checks pass, so a refused edition burns no name", async () => {
    // The namespace is never reused (047 §4.1), so a name minted for a write that
    // was then refused would be unreachable for ever.
    const w = tx([{ vertical: "sports_card", attributes: definitionAttributes }]);
    await expect(insertEdition(w.tx, editionReq)).rejects.toBeInstanceOf(VerticalMismatchError);
    expect(w.matching("INSERT INTO lcid_registry")).toHaveLength(0);
  });
});

describe("insertEdition — the signature rows (030 A4, 047 A1)", () => {
  const described = () => tx([{ vertical: "comic", attributes: definitionAttributes }]);

  it("binds every edition column in its declared position, not merely a plausible one", async () => {
    // ⚠ THE POSITIONAL ASSERTION, ADDED BECAUSE ITS ABSENCE LET TWO MUTANTS LIVE.
    // The invariant review of E04-D06 showed that swapping `definitionLcid` with
    // `vertical`, or `packVersionId` with `corpusVersionId`, left every other
    // case in this file green: each pair is a bare string at the JS boundary, so
    // nothing but the parameter ORDER distinguishes them — and the surviving
    // mutant writes an edition whose parent pointer is the word "comic".
    // Asserting the whole array in one `toEqual` is what kills that class, the
    // way `tests/catalog-lifecycle.test.ts` already does for the lifecycle facts.
    const w = described();
    const out = await insertEdition(w.tx, editionReq);
    expect(w.only("INSERT INTO edition\n").values).toEqual([
      out.editionLcid,
      "LBX-D-CMC-known",
      "comic",
      PACK,
      CORPUS,
      JSON.stringify(editionAttributes),
      out.signatures[0],
      false,
      "system",
    ]);
    // The signature row's positions are asserted whole for the same reason: its
    // `vertical` and its `edition_lcid` are both strings, and its
    // `normalization_version` and `corpus_version_id` are both "the version of
    // something".
    expect(w.only("INSERT INTO edition_signature").values).toEqual([
      "comic",
      out.signatures[0],
      out.normalizationVersion,
      out.editionLcid,
      CORPUS,
      "system",
    ]);
  });

  it("binds every DEFINITION column in its declared position too", async () => {
    const w = tx();
    const out = await insertDefinition(w.tx, {
      vertical: "comic",
      verticalCode: "cmc",
      packVersionId: PACK,
      corpusVersionId: CORPUS,
      attributes: definitionAttributes,
    });
    expect(w.only("INSERT INTO collectible_definition").values).toEqual([
      out.definitionLcid,
      "comic",
      PACK,
      CORPUS,
      JSON.stringify(definitionAttributes),
      expect.stringContaining("amazing spider-man"),
      "system",
    ]);
  });

  it("writes the PRIMARY signature on the edition row and in `edition_signature`", async () => {
    const w = described();
    const out = await insertEdition(w.tx, editionReq);
    expect(out.signatures).toHaveLength(1);
    expect(w.only("INSERT INTO edition\n").values?.[6]).toBe(out.signatures[0]);
    const signatureRows = w.matching("INSERT INTO edition_signature");
    expect(signatureRows).toHaveLength(1);
    expect(signatureRows[0]!.values?.[1]).toBe(out.signatures[0]);
  });

  it("composes the signature from the DEFINITION's series and the EDITION's issue", async () => {
    const w = described();
    const out = await insertEdition(w.tx, editionReq);
    expect(out.signatures[0]).toContain("amazing spider-man");
    expect(out.signatures[0]).toContain("300");
  });

  it("writes ONE signature row per alias, all under the same edition LCID", async () => {
    // 030 A4: a series renamed mid-run or a regional alternate is the SAME
    // edition under another name. The table has no UNIQUE precisely so these can
    // coexist; an implementation that wrote only the primary would make the
    // alternate name unlookupable.
    const w = described();
    const out = await insertEdition(w.tx, {
      ...editionReq,
      aliasAttributes: [{ ...editionAttributes, variant: "newsstand" }],
    });
    expect(out.signatures).toHaveLength(2);
    const rows = w.matching("INSERT INTO edition_signature");
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.values?.[3]))).toEqual(new Set([out.editionLcid]));
    expect(rows[0]!.values?.[1]).not.toBe(rows[1]!.values?.[1]);
  });

  it("VALIDATES an alias payload too — an unchecked alias is an unchecked identity", async () => {
    const w = described();
    await expect(
      insertEdition(w.tx, { ...editionReq, aliasAttributes: [{ issue: "300", nonsense: true }] })
    ).rejects.toThrow();
  });

  it("stamps the normalization version it actually signed with", async () => {
    const w = described();
    const out = await insertEdition(w.tx, editionReq);
    expect(w.only("INSERT INTO edition_signature").values?.[2]).toBe(out.normalizationVersion);
  });

  it("defaults `is_canonical_edition` to false rather than asserting canonicity", async () => {
    const w = described();
    await insertEdition(w.tx, editionReq);
    expect(w.only("INSERT INTO edition\n").values?.[7]).toBe(false);
    const w2 = described();
    await insertEdition(w2.tx, { ...editionReq, isCanonicalEdition: true });
    expect(w2.only("INSERT INTO edition\n").values?.[7]).toBe(true);
  });

  it("does NOT dedupe: two editions may carry one signature, and the write succeeds", async () => {
    // 047 A1 — the mint path is deliberately AP on a signature collision. Two
    // concurrent mints of one signature are two valid LCIDs, repaired later by a
    // human-arbitrated merge. There is no lookup here and no merge.
    const w = described();
    await insertEdition(w.tx, editionReq);
    for (const call of w.calls) {
      expect(call.text).not.toContain("SELECT DISTINCT s.edition_lcid");
      expect(call.text).not.toContain("INSERT INTO lcid_merge");
    }
  });

  it("honours a supplied edition LCID without minting a second name", async () => {
    const w = described();
    const out = await insertEdition(w.tx, { ...editionReq, editionLcid: "LBX-E-CMC-supplied" });
    expect(out.editionLcid).toBe("LBX-E-CMC-supplied");
    expect(w.matching("INSERT INTO lcid_registry")).toHaveLength(0);
  });

  it("reads the definition's attributes from its NEWEST row", async () => {
    // Every row decides the vertical check; the newest decides the signature,
    // because that is the current statement of what the work is.
    const w = tx([
      { vertical: "comic", attributes: { ...definitionAttributes, series: "Renamed Series" } },
      { vertical: "comic", attributes: definitionAttributes },
    ]);
    const out = await insertEdition(w.tx, editionReq);
    expect(out.signatures[0]).toContain("renamed series");
    expect(w.only("FROM collectible_definition").text).toContain("ORDER BY created_at DESC, id DESC");
  });
});

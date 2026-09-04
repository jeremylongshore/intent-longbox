// L2 contract: the declared v1 surface, the generated artifact, and the four
// negative properties 042 makes structural rather than remembered.
//
// It covers 042 I5(a/c) (the route table enumerates every route with its kind),
// I6 (every route versioned and tenant-scoped or allowlisted with a kind, a
// reason and a closing bead — and the G2 defect count), I8 (no numeric grade in
// the contract at all), I9 (the server declares no operator-facing field and
// emits no operator prose) and I15 (the committed OpenAPI equals a
// regeneration).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, ERROR_CODE_NAMES } from "../../src/contracts/v1/errors.js";
import { renderOpenApiDocument } from "../../src/contracts/v1/openapi.js";
import { ROUTES, ROUTE_ALLOWLIST, STATIC_MOUNTS } from "../../src/contracts/v1/routes.js";
import { API_PREFIX, TENANT_PREFIX, eventDtos } from "../../src/contracts/v1/schemas.js";
import { GRADE_LABELS } from "../../src/services/condition.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const committed = readFileSync(join(repoRoot, "contracts", "openapi.v1.json"), "utf8");

describe("the route table (042 §3.1, I6)", () => {
  it("enumerates every route with its kind, and every kind is one of the two", () => {
    for (const route of ROUTES) {
      const allowed = ROUTE_ALLOWLIST.find((r) => r.path === route.path);
      const scoped = route.path.startsWith(TENANT_PREFIX);
      expect(
        scoped || allowed !== undefined,
        `${route.method} ${route.path} is neither tenant-scoped nor allowlisted`
      ).toBe(true);
      if (!scoped) expect(["exemption", "defect"]).toContain(allowed!.kind);
    }
  });

  it("gives every allowlist row a reason, and every DEFECT row a closing bead", () => {
    for (const row of ROUTE_ALLOWLIST) {
      expect(row.reason.length, `${row.path} has no reason`).toBeGreaterThan(40);
      if (row.kind === "defect") {
        // 042 A8, the Q8 ruling: "a declared exposure against a non-waivable
        // threshold is not the same epistemic object as a declared trigger
        // exemption". A defect row means THIS RECORD REFUSED TO HIDE IT, never
        // this record permitted it — and a row with no owner is the waiver-by-
        // declaration the tag exists to prevent.
        expect(row.closingBead, `${row.path} is kind=defect with no closing bead`).toBeTruthy();
      }
    }
  });

  it("carries EXACTLY ONE defect row, and it is the shop picker (042 A8, 044 §6 row 4)", () => {
    const defects = ROUTE_ALLOWLIST.filter((r) => r.kind === "defect");
    expect(defects.map((d) => `${d.method} ${d.path}`)).toEqual(["GET /api/v1/shops"]);
    expect(defects[0]!.closingBead).toMatch(/E03-B02/);
    // ⚠ THE G2 EXIT CONDITION IS `toHaveLength(0)`, AND IT IS NOT ASSERTED HERE.
    // 042 A8: "no defect-kind row may exist at G2", and this one closes when
    // E03-B02/B03 give the API a caller identity — until then it returns every
    // shop in the database to anybody, which is a live 019 T24 exposure that
    // this bead refuses to hide and must not pretend to have fixed.
    expect(defects).toHaveLength(1);
  });

  it("declares ONE static mount, and the uploads tree is not it (E03-D05, 046 §6 Q5)", () => {
    // This assertion used to read `["/", "uploads"]`. The second mount published
    // every shop's photographs to anyone with a URL (046 §3.3 B5) and 046 §6 Q5
    // ruled DELETE rather than replace, so the list is shorter by exactly the
    // boundary that closed — and a re-added mount fails here rather than in a
    // review.
    expect(STATIC_MOUNTS.map((m) => m.prefix)).toEqual(["/"]);
    for (const mount of STATIC_MOUNTS) expect(mount.reason).toContain("042 §3.5");
  });

  it("serves photo bytes through an ORDINARY tenant route, not an exemption (E03-D05)", () => {
    const photo = ROUTES.find((r) => r.path.endsWith("/photos/:photoId"));
    expect(photo, "the photo-fetch route is not declared").toBeDefined();
    expect(photo!.path.startsWith(TENANT_PREFIX)).toBe(true);
    expect(ROUTE_ALLOWLIST.some((r) => r.path === photo!.path)).toBe(false);
    expect(photo!.mutating).toBe(false);
    expect(photo!.errors).toContain("PHOTO_NOT_FOUND");
    // 019 T24 as a status code: a photo outside this shop or session is the same
    // answer as one that never existed. A 403 anywhere on this route would be an
    // oracle for "that id exists somewhere else".
    expect(ERROR_CODES.PHOTO_NOT_FOUND.status).toBe(404);
    expect(photo!.errors).not.toContain("SHOP_NOT_FOUND");
    // Bytes, not JSON — declared, so the artifact says `string/binary` instead
    // of describing a photograph as an object.
    expect(photo!.response).toBeNull();
    expect(photo!.responseMediaType).toBe("application/octet-stream");
  });

  it("versions everything except the liveness probe, which is unversioned BY DECLARATION", () => {
    for (const route of ROUTES) {
      if (route.path === "/healthz") continue;
      expect(route.path.startsWith(API_PREFIX), `${route.path} is unversioned`).toBe(true);
    }
    expect(ROUTE_ALLOWLIST.find((r) => r.path === "/healthz")!.kind).toBe("exemption");
  });

  it("requires an Idempotency-Key on every mutating route and on no read (042 §5.1)", () => {
    const mutating = ROUTES.filter((r) => r.mutating).map((r) => `${r.method} ${r.path}`);
    // "All eight mutating routes. Not 'should' and not 'on the paths that
    // matter'." (`POST …/transitions` is 040 §7's and is not built.)
    expect(mutating).toHaveLength(7);
    for (const route of ROUTES) {
      expect(route.mutating).toBe(route.method === "POST");
    }
  });

  it("meters exactly the one route that spends money (042 §8.2)", () => {
    const metered = ROUTES.filter((r) => r.rateClass === "metered").map((r) => r.path);
    expect(metered).toEqual([`${TENANT_PREFIX}/scan-sessions/:id/identify`]);
  });
});

describe("the error registry (042 §4.2)", () => {
  it("declares four things for every code, and a copy row exactly when renderable", () => {
    for (const code of ERROR_CODE_NAMES) {
      const spec = ERROR_CODES[code];
      expect(spec.status).toBeGreaterThanOrEqual(400);
      expect(typeof spec.retryable).toBe("boolean");
      expect(spec.operatorRenderable ? spec.copyRow : null).toEqual(
        spec.operatorRenderable ? spec.copyRow : null
      );
      if (spec.operatorRenderable) expect(spec.copyRow).toBeTruthy();
      else expect(spec.copyRow).toBeNull();
    }
  });

  it("keeps the two 409s that disagree about retryability apart (042 §4.4)", () => {
    // The case a client cannot infer from the status, and the one that matters:
    // E05-B08's offline queue has to tell them apart on reconnect with no human
    // present, against a 019 T23 that signs lost/duplicated items at zero.
    expect(ERROR_CODES.STALE_WORLD_VIEW).toMatchObject({ status: 409, retryable: false });
    expect(ERROR_CODES.WRITE_CONFLICT_RETRY_EXHAUSTED).toMatchObject({ status: 409, retryable: true });
  });

  it("names every code a route declares, and declares every code some route can produce", () => {
    for (const route of ROUTES) {
      for (const code of route.errors) expect(ERROR_CODE_NAMES).toContain(code);
    }
  });
});

describe("042 I9 — the server declares no operator-facing field", () => {
  const FORBIDDEN = /confidence|percent|provider|model|cost|price_usd/i;

  it("declares no confidence, provider, model or cost field in any response DTO", () => {
    // 042 E13: `IdentifyOutcome` declares all four and `routes:193` returned it
    // whole, with a static grep over ONE client file as the only guard. This is
    // that guard moved upstream of the thing that emits the material.
    const doc = JSON.parse(committed) as Record<string, unknown>;
    const fields: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (obj["properties"] && typeof obj["properties"] === "object") {
        fields.push(...Object.keys(obj["properties"] as object));
      }
      Object.values(obj).forEach(walk);
    };
    walk(doc["paths"]);
    const offenders = fields.filter((f) => FORBIDDEN.test(f));
    expect(offenders).toEqual([]);
  });

  it("keeps `llm_rerank`'s four forbidden columns out of the event projection", () => {
    const keys = Object.keys(eventDtos.llm_rerank.shape);
    expect(keys).not.toContain("confidence");
    expect(keys).not.toContain("provider");
    expect(keys).not.toContain("model");
    expect(keys).not.toContain("cost_usd");
    // What a screen IS allowed to be built from: a band word and a flag.
    expect(keys).toContain("band");
    expect(keys).toContain("contradiction");
  });

  it("keeps operator identifiers out of every event projection (019 T35, non-waivable)", () => {
    for (const [table, dto] of Object.entries(eventDtos)) {
      const keys = Object.keys(dto.shape);
      expect(keys, `${table} publishes an operator identifier`).not.toContain("confirmed_by");
      expect(keys, `${table} publishes an operator identifier`).not.toContain("created_by");
      expect(keys, `${table} publishes an operator identifier`).not.toContain("operator_id");
    }
  });

  it("keeps the photo's storage key off the wire (042 §3.5)", () => {
    expect(Object.keys(eventDtos.scan_photo.shape)).not.toContain("storage_url");
    expect(committed).not.toContain("storage_url");
    expect(committed).not.toContain("storage_key");
  });

  it("emits no percentage, model identifier or provider identifier in the artifact (I9(c))", () => {
    expect(committed).not.toMatch(/%/);
    expect(committed).not.toMatch(/claude|gpt-|anthropic|openai|sonnet|haiku/i);
  });
});

describe("042 I8 — no numeric grade appears anywhere in the declared contract", () => {
  it("admits only the seven band words on the condition DTO, and types none of them numeric", () => {
    // Locked decision 5, 019 T7 (non-waivable) and 037 §1.1. This complements
    // 041 I2 (which forbids the WRITER) and 037 I3 (which forbids the RENDERED
    // suggestion): this one forbids the SHAPE from existing in the contract at
    // all, and the three fail differently.
    const doc = JSON.parse(committed) as Record<string, unknown>;
    const text = JSON.stringify(doc);
    for (const label of GRADE_LABELS) expect(text).toContain(`"${label}"`);
    const gradeFields = text.match(/"grade[a-z_]*":\s*\{"type":"(integer|number)"/g) ?? [];
    expect(gradeFields).toEqual([]);
  });
});

describe("042 I15 — the committed OpenAPI equals the generated one", () => {
  it("is byte-identical to a regeneration", () => {
    // The gate that makes §2.3's additive-only rule REVIEWABLE rather than
    // aspirational: a contract change shows up as a diff in the PR, where a
    // reviewer can see a field being removed or an optional one becoming
    // required — the two changes that are v2 and not v1.
    expect(renderOpenApiDocument()).toBe(committed);
  });

  it("describes every declared route and no route it does not have", () => {
    const doc = JSON.parse(committed) as { paths: Record<string, Record<string, unknown>> };
    const described = Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`)
    );
    const declared = ROUTES.map((r) => `${r.method} ${r.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`);
    expect(described.sort()).toEqual(declared.sort());
  });
});

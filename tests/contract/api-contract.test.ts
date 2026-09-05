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

  it("carries ZERO defect rows — the G2 exit condition (042 A8, 044 §6 row 4)", () => {
    // ⚠ THIS ASSERTION USED TO READ `toHaveLength(1)`, AND THE ONE ROW WAS
    // `GET /api/v1/shops`: a route that returned every shop in the database to
    // any caller (042 E4, 034 E9), a live 019 T24 exposure the record refused to
    // hide and refused to pretend it had fixed.
    //
    // E03-D08 fixed it rather than reclassified it. The route is now *my shops*
    // (048 §6.4) — behind a device session, answering from a query rooted at
    // `membership` — so its row is an `exemption` that says what it IS, and 042
    // A8's "no defect-kind row may exist at G2" is a passing test instead of a
    // deferred sentence.
    //
    // **The assertion is `toEqual([])` and not `not.toContain(...)`**: the point
    // of a G2 exit condition is that the NEXT defect row fails the build too,
    // and a test that named this one path would have quietly allowed a second.
    const defects = ROUTE_ALLOWLIST.filter((r) => r.kind === "defect");
    expect(defects.map((d) => `${d.method} ${d.path} — ${d.closingBead ?? "no bead"}`)).toEqual([]);
    // Kept as a live assertion rather than deleted with the row: a `defect` kind
    // still EXISTS in the type, and the day somebody declares one it must carry
    // a closing bead (the check above in this file) AND fail this one.
    expect(ROUTE_ALLOWLIST.some((r) => r.kind === "defect")).toBe(false);
  });

  it("classifies my-shops as the route that ESTABLISHES a tenant (048 §6.4, E03-D08)", () => {
    const row = ROUTE_ALLOWLIST.find((r) => r.path === "/api/v1/shops");
    expect(row?.kind).toBe("exemption");
    // An exemption row with a closing bead would be a defect wearing the other
    // kind's label — the exact collapse 042 A8's Q8 ruling exists to prevent.
    expect(row?.closingBead).toBeUndefined();
    const spec = ROUTES.find((r) => r.path === "/api/v1/shops");
    expect(spec?.errors).toContain("SESSION_REQUIRED");
    expect(spec?.mutating).toBe(false);
    // 048 R14: an authenticated read outside the tenant plugin has no ordinary
    // bucket, so it is keyed on the DEVICE. `none` here would make the route
    // that used to leak the shop table also the one unmetered read.
    expect(spec?.rateClass).toBe("device");
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
    //
    // TEN at E03-D09: the seven shop-scoped writes plus the three authentication
    // writes (048 §6.2's `device-sessions`, `operator-sessions` and its `/end`).
    // All three REQUIRE the header — the hook enforces it, ahead of the multipart
    // parser (R10) — because 048 §5.2's second CSRF mechanism is exactly "a
    // cross-site HTML form cannot set a custom header", and the routes that mint
    // credentials are the last place to drop that. What they do NOT do is store a
    // replay: an authentication act's effect is its `Set-Cookie`, which
    // `request_idempotency` does not hold, so a replayed 201 would be a screen
    // that says signed-in while the browser holds nothing.
    //
    // TWELVE at E03-D07, which adds the two redemption routes (048 §7). Both
    // require the header for the same CSRF reason; they part company on §5.1's
    // STORAGE, and the split is the ruling this bead had to make rather than
    // inherit. `POST …/invitations/redemptions` takes a `request_idempotency`
    // row — it writes a `membership` and sets a PIN, which are witness rows that
    // outlive the response, so it fails the exemption's clause (b) and 042
    // v1.3.0's forward-looking sentence about "E03-D07's enrollment redemption"
    // does not reach it. `POST …/device-enrollments` IS exempt, under 042
    // v1.4.2's clause (b2) — a shown-once credential plus a UNIQUE on the act,
    // which it names as `device_enrollment_code_use (code_id)`. The class is FOUR
    // routes: the three session ones sit under (b1) (a `Set-Cookie` and nothing
    // else) and owe no constraint, which is why v1.4.2 had to make (b) two
    // disjuncts — v1.4.1's conjunction expelled three of its own members.
    expect(mutating).toHaveLength(12);
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

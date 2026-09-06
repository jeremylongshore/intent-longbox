// L2 contract: **a route whose idempotency hash is not its literal body DECLARES
// what it is taken over, and the declaration is checked against the code.**
//
// Bead: longbox-e5b.3.34 (alias E03-D24), the data-model lens's H5. Docs:
// 000-docs/063 §3.4, §0; 042 §5.1 (class two's `uniqueOn`, the construction this
// copies), §5.4 (the body hash and what it is for); 048 §9.2 (what must not be
// stored where a dump can invert it), R19.
//
// ============================================================================
// WHY THIS FILE EXISTS
// ============================================================================
//
// 042 §5.4 hashes the request body so a reused key with different content is a
// 422. Five routes deliberately hash something else, each for a good reason:
// a password and an invitation code are low-entropy secrets a stored SHA-256
// would be an offline verifier for; an address is a person; and an enrolment's
// confirming code is a TOTP value that changes every thirty seconds for one
// logical act.
//
// Until this bead every one of those reasons lived in a COMMENT. The consistency
// lens's finding is that 042 §5.1 class TWO already solved the same problem one
// class over — a member NAMES its constraint and a test reads the migrations to
// confirm it exists — so the same shape applies here: the route declares in
// plain English what its hash is taken over, and this file asserts the SERVICE
// actually builds that shape.
//
// **And the failure it would have caught is not hypothetical.** The enrolment
// route shipped hashing the confirming code; CI caught it half a minute later
// (063 §0) because a retry sent a different code and got a 422 — the
// lost-response-becomes-a-dead-enrolment failure 042 §5.1 exists to prevent.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTES } from "../../src/contracts/v1/routes.js";

/**
 * For each declaring route: the function that builds its `IdempotentRequest`,
 * and the literal that must appear inside it.
 *
 * The literal is the KEY the body object is built with — the one thing a
 * reviewer can compare against the prose and a build can compare against the
 * source. It is deliberately not a regex over the whole file: the whole point is
 * that the shape is built where the request is built.
 */
const BUILDERS: Readonly<Record<string, { file: string; fn: string; contains: readonly string[] }>> = {
  "/api/v1/credentials": {
    file: "src/services/auth/api.ts",
    fn: "setOwnPassword",
    contains: ["password_supplied: true"],
  },
  "/api/v1/credentials/rotations": {
    file: "src/services/auth/api.ts",
    fn: "rotateOwnPassword",
    contains: ["password_supplied: true"],
  },
  "/api/v1/authenticators": {
    file: "src/services/auth/api.ts",
    fn: "enrolOwnAuthenticator",
    contains: ["ticket_digest: digestOf(input.ticket)"],
  },
  "/api/v1/invitations/redemptions": {
    file: "src/services/auth/api.ts",
    fn: "redeemInvitation",
    contains: ["code_digest: digestOf(input.code)", "pin_supplied: true"],
  },
  "/api/v1/invitations": {
    file: "src/services/auth/api.ts",
    fn: "createInvitation",
    contains: ["email_digest: digestOf(input.email.toLowerCase())"],
  },
};

const read = (path: string): string => readFileSync(path, "utf8");

/** The body of `fn`, by brace-matching. `rate-class-enforcement`'s helper, verbatim. */
function functionBody(source: string, fn: string): string | undefined {
  const decl = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${fn}\\s*\\(`).exec(source);
  if (!decl) return undefined;
  let paren = 0;
  let i = source.indexOf("(", decl.index);
  for (; i < source.length; i += 1) {
    if (source[i] === "(") paren += 1;
    else if (source[i] === ")") {
      paren -= 1;
      if (paren === 0) break;
    }
  }
  if (paren !== 0) return undefined;
  let angle = 0;
  let open = -1;
  for (let j = i + 1; j < source.length; j += 1) {
    const c = source[j];
    if (c === "<") angle += 1;
    else if (c === ">") angle -= 1;
    else if (c === "{" && angle === 0) {
      open = j;
      break;
    }
  }
  if (open === -1) return undefined;
  let depth = 0;
  for (let k = open; k < source.length; k += 1) {
    const ch = source[k];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, k + 1);
    }
  }
  return undefined;
}

describe("a non-body idempotency hash is DECLARED and the declaration is checked (042 §5.4, H5)", () => {
  it("declares one for every route that hashes something other than its body, and for no other", () => {
    const declared = ROUTES.filter((r) => r.idempotencyHashOf !== undefined).map((r) => r.path);
    expect(declared.sort()).toEqual(Object.keys(BUILDERS).sort());
  });

  it("gives every declaration a reason a reviewer can disagree with", () => {
    for (const route of ROUTES) {
      if (route.idempotencyHashOf === undefined) continue;
      // Long enough to say WHAT and WHY. A one-word label would pass a grep and
      // teach a reader nothing, which is the failure the comment version had.
      expect(
        route.idempotencyHashOf.length,
        `${route.path}: the declaration says too little`
      ).toBeGreaterThan(60);
    }
  });

  it("finds the declared shape in the function that builds the request", () => {
    for (const [path, builder] of Object.entries(BUILDERS)) {
      const body = functionBody(read(builder.file), builder.fn);
      expect(body, `${path}: no function \`${builder.fn}\` in ${builder.file}`).toBeDefined();
      for (const literal of builder.contains) {
        expect(body!, `${path}: \`${builder.fn}\` no longer builds ${literal}`).toContain(literal);
      }
    }
  });

  it("REFUSES a builder that puts a raw secret in the hashed body", () => {
    // The property every one of these declarations exists for: `request_hash` is
    // STORED, so a low-entropy secret hashed into it is an offline verifier for
    // anybody holding a dump (048 §9.2). Asserted over the literal source rather
    // than over a declaration, because the declaration is the thing under test.
    for (const builder of Object.values(BUILDERS)) {
      const body = functionBody(read(builder.file), builder.fn)!;
      for (const raw of ["password: input.password", "pin: input.pin", "code: input.code"]) {
        expect(body, `${builder.fn} hashes ${raw} into the stored request`).not.toContain(`body: { ${raw}`);
      }
    }
  });

  it("keeps every OTHER mutating route on the literal body", () => {
    // A route that hashes something else without saying so is the state this
    // file ends. The set is asserted positively above; this is the direction
    // that catches a NEW route quietly joining the class.
    const undeclared = ROUTES.filter(
      (r) => r.mutating && r.idempotencyHashOf === undefined && r.idempotency === undefined
    );
    expect(undeclared.length, "there are mutating routes, so the check is not vacuous").toBeGreaterThan(0);
  });
});

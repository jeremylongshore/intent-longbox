// L3: the Zod → JSON-Schema converter (042 §2.5).
//
// It exists because the generated artifact is the thing E14-B04 will build
// contract tests from and E17-B01 will hand a partner, so a converter that is
// subtly wrong ships a contract that lies. Two of its rules were wrong in the
// first version and the invariant review caught both — this file is what would
// have caught them first, and both cases are pinned below by name.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toJsonSchema } from "../src/contracts/v1/openapi.js";

describe("required-ness comes from isOptional(), not from a typeName check", () => {
  it("treats a BARE z.unknown() as optional — the case that was wrong", () => {
    // Zod accepts `{}` for `z.object({ a: z.unknown() })`: `unknown` is optional
    // even though its `typeName` is not `ZodOptional`. The first version listed
    // it as REQUIRED, which describes a stricter API than the one that runs — in
    // the direction a partner would build against.
    expect(z.object({ a: z.unknown() }).safeParse({}).success).toBe(true);
    expect(toJsonSchema(z.object({ a: z.unknown() }))["required"]).toBeUndefined();
  });

  it("keeps a plain field required and drops an .optional() one", () => {
    const schema = z.object({ kept: z.string(), gone: z.string().optional() });
    expect(toJsonSchema(schema)["required"]).toEqual(["kept"]);
  });

  it("treats a .default() field as optional on the wire, because the client may omit it", () => {
    expect(toJsonSchema(z.object({ d: z.array(z.string()).default([]) }))["required"]).toBeUndefined();
  });

  it("treats a .nullable() field as REQUIRED — null is a value a client must send", () => {
    expect(toJsonSchema(z.object({ n: z.string().nullable() }))["required"]).toEqual(["n"]);
  });

  it("omits `required` entirely when nothing is", () => {
    expect(Object.keys(toJsonSchema(z.object({ a: z.string().optional() })))).not.toContain("required");
  });
});

describe("additionalProperties claims only what the schema enforces", () => {
  it("says false ONLY for .strict()", () => {
    expect(toJsonSchema(z.object({ a: z.string() }).strict())["additionalProperties"]).toBe(false);
  });

  it("says nothing for a plain object, which STRIPS rather than rejects", () => {
    // The second wrong rule. A plain `z.object()` accepts an unknown key and
    // drops it; publishing `additionalProperties: false` teaches a client to fear
    // a field the server would have ignored.
    expect(z.object({ a: z.string() }).safeParse({ a: "x", extra: 1 }).success).toBe(true);
    expect(toJsonSchema(z.object({ a: z.string() }))).not.toHaveProperty("additionalProperties");
  });
});

describe("the constructors this contract actually uses", () => {
  it("converts a string with its uuid format and its length bounds", () => {
    expect(toJsonSchema(z.string().uuid())).toEqual({ type: "string", format: "uuid" });
    expect(toJsonSchema(z.string().min(1).max(200))).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 200,
    });
  });

  it("distinguishes an integer from a number", () => {
    expect(toJsonSchema(z.number().int())).toEqual({ type: "integer" });
    expect(toJsonSchema(z.number())).toEqual({ type: "number" });
  });

  it("converts an enum to its exact value list — 019 T7's band words ride on this", () => {
    expect(toJsonSchema(z.enum(["high", "medium", "low"]))).toEqual({
      type: "string",
      enum: ["high", "medium", "low"],
    });
  });

  it("converts a nullable to an anyOf carrying null", () => {
    expect(toJsonSchema(z.string().nullable())).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
  });

  it("converts arrays, records, literals and unknown", () => {
    expect(toJsonSchema(z.array(z.string()))).toEqual({ type: "array", items: { type: "string" } });
    expect(toJsonSchema(z.record(z.unknown()))).toEqual({ type: "object", additionalProperties: {} });
    expect(toJsonSchema(z.literal("accepted"))).toEqual({ const: "accepted" });
    expect(toJsonSchema(z.unknown())).toEqual({});
  });

  it("unwraps a .refine() to the schema it refines", () => {
    // `priceRequest` is a refined object (title-or-query); without this the
    // emitter would throw on the route that needs it most.
    const refined = z.object({ a: z.string().optional() }).refine(() => true);
    expect(toJsonSchema(refined)).toEqual({ type: "object", properties: { a: { type: "string" } } });
  });

  it("THROWS on a constructor it does not know, rather than emitting a fiction", () => {
    // The property that makes a hand-written converter defensible: an unsupported
    // shape is a loud build failure, not a silently wrong artifact.
    expect(() => toJsonSchema(z.date())).toThrow(/unsupported Zod constructor/);
  });
});

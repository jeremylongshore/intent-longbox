// THE SHIPPED MANIFEST SET — and the one lookup that is deliberately NOT
// fail-closed (E04-D06; 030 §6 rule 3; 049 §8).
//
// `manifestFor` is the exception to the module's own posture, and the exception
// is the reason it needs a test: everything else in `catalog` refuses an
// unregistered vertical by throwing, and this function answers `undefined`. The
// caller is `scripts/register-pack.ts`, which must be able to say "no manifest
// ships for that vertical, here are the ones that do" — a better sentence than a
// stack trace. Turning it fail-closed to match its neighbours would break that
// call site silently, so the asymmetry is asserted rather than left to be
// tidied up by the next person who notices it.
//
// Kept in its own file rather than folded into `pack-manifest.test.ts` so that a
// concurrently-landing change to the manifests themselves (E04-D05) and this
// coverage bead do not contend for the same lines.
//
// E04-D07 CLOSED THE HOLE THIS FILE USED TO PIN. Both registries are `Map`s now,
// so the last describe block asserts the property that replaced the defect: a
// vertical named after an `Object.prototype` member is not registered, at BOTH
// entry points, in each one's own idiom.
import { describe, expect, it } from "vitest";
import {
  MANIFESTS,
  UnregisteredVerticalError,
  assertCertified,
  manifestFor,
  packFor,
} from "../src/catalog/index.js";

describe("manifestFor — a lookup, not a gate", () => {
  it("returns the manifest for every vertical this build ships", () => {
    for (const [vertical, manifest] of MANIFESTS) {
      expect(manifestFor(vertical)).toBe(manifest);
      // The key IS the manifest's own vertical — a registry keyed on anything
      // else would hand back a manifest describing a different vertical.
      expect(manifest.vertical).toBe(vertical);
    }
  });

  it("answers `undefined` for an unregistered vertical rather than throwing", () => {
    expect(manifestFor("vinyl")).toBeUndefined();
    expect(manifestFor("")).toBeUndefined();
  });

  it("ships only manifests that certify — the fail-closed boundary is elsewhere", () => {
    // 030 §6 rule 3: `packFor` and `assertCertified` are where an unregistered or
    // uncertifiable pack is refused. A manifest that shipped without certifying
    // would become an immutable `vertical_pack_version` row with no repair path.
    for (const manifest of MANIFESTS.values()) {
      expect(() => assertCertified(manifest)).not.toThrow();
    }
  });

  it("assigns a DISTINCT three-character vertical code to each shipped pack (049 §8)", () => {
    const codes = [...MANIFESTS.values()].map((m) => m.verticalCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z]{3}$/);
  });
});

// THE INHERITED-KEY HOLE, closed by both registries being `Map`s (E04-D07; PR #79
// review NOTE 3, and PR #80's MiniMax finding 2 applied a second time).
//
// With a plain object literal, `MANIFESTS[vertical]` and `PACKS[vertical]` both
// resolve members of `Object.prototype`, which are not `undefined`, so an
// `=== undefined` guard waves them through. ONE defect produced TWO different
// wrong answers, which is why both entry points are asserted here:
//
//   * `manifestFor("toString")` returned `Object.prototype.toString` — a
//     FUNCTION, from a signature promising `VerticalPackManifest | undefined`.
//     `scripts/register-pack.ts` passed its own `=== undefined` guard and was
//     stopped only by `assertCertified`, so an operator running
//     `--vertical toString` got a certification stack trace instead of the "no
//     manifest ships for that vertical, here are the ones that do" sentence the
//     script exists to print.
//   * `packFor("toString")` returned the same member and then failed with a
//     `TypeError` from whichever of the six pack functions ran first — NEVER with
//     `UnregisteredVerticalError`. 030 §6 rule 3 requires an unregistered vertical
//     to be "rejected at the boundary"; a boundary that crashes instead of raising
//     its own named refusal has been bypassed, not enforced.
//
// `__proto__` is in the list deliberately: on a plain object it is an ACCESSOR
// rather than a data property, so it is the one name whose old behaviour differed
// from the rest again. A `Map` has none of them.
const INHERITED_KEYS = [
  "toString",
  "valueOf",
  "constructor",
  "hasOwnProperty",
  "__proto__",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
];

describe("a vertical named after an Object.prototype member is NOT registered", () => {
  it.each(INHERITED_KEYS)("manifestFor(%s) answers undefined, in its own idiom", (vertical) => {
    // `manifestFor` is deliberately NOT fail-closed — it answers `undefined` so
    // the registration script can print a good sentence — so the fix must not
    // have quietly turned it into a throwing function on the way past.
    expect(manifestFor(vertical)).toBeUndefined();
  });

  it.each(INHERITED_KEYS)("packFor(%s) throws the NAMED refusal, not a TypeError", (vertical) => {
    // The CLASS matters as much as the throw: a `TypeError` from inside a pack
    // function is what the object literal produced, and it says nothing at all
    // about the vertical being unregistered.
    expect(() => packFor(vertical)).toThrow(UnregisteredVerticalError);
  });

  it.each(INHERITED_KEYS)("does not report %s in the manifest set either", (vertical) => {
    // The set membership is why the two lookups agree: neither name is a key.
    expect(MANIFESTS.has(vertical)).toBe(false);
  });
});

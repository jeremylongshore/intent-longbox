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
import { describe, expect, it } from "vitest";
import { MANIFESTS, assertCertified, manifestFor, type VerticalPackManifest } from "../src/catalog/index.js";

describe("manifestFor — a lookup, not a gate", () => {
  it("returns the manifest for every vertical this build ships", () => {
    for (const [vertical, manifest] of Object.entries(MANIFESTS)) {
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

  it("⚠ LEAKS the prototype chain — observed, not blessed, and caught downstream", () => {
    // `MANIFESTS` is an object literal and the lookup is a bare index, so
    // `manifestFor("toString")` hands back `Object.prototype.toString` — a
    // FUNCTION, from a signature that promises `VerticalPackManifest |
    // undefined`. `scripts/register-pack.ts` is the only caller and it reaches
    // this with `--vertical toString`, passing the `=== undefined` guard.
    //
    // It is recorded here rather than fixed, because a one-line change to a
    // shipped module is not this bead's (E04-D06 is the coverage floor) and the
    // NEXT thing the script does is the fail-closed boundary 030 §6 rule 3 puts
    // there on purpose: `certify` reports findings and `assertCertified` throws,
    // so a prototype key cannot become a `vertical_pack_version` row. The blast
    // radius is a confusing error message, not a bad row.
    //
    // ⚠ IF SOMEONE FIXES `manifestFor` TO USE `Object.hasOwn`, THIS TEST FAILS —
    // which is the intended signal. Delete the case with the fix, which is
    // E04-D07 (`longbox-e5b.4.19`) and says so in its title.
    const leaked = manifestFor("toString");
    expect(typeof leaked).toBe("function");
    expect(() => assertCertified(leaked as unknown as VerticalPackManifest)).toThrow();
  });

  it("ships only manifests that certify — the fail-closed boundary is elsewhere", () => {
    // 030 §6 rule 3: `packFor` and `assertCertified` are where an unregistered or
    // uncertifiable pack is refused. A manifest that shipped without certifying
    // would become an immutable `vertical_pack_version` row with no repair path.
    for (const manifest of Object.values(MANIFESTS)) {
      expect(() => assertCertified(manifest)).not.toThrow();
    }
  });

  it("assigns a DISTINCT three-character vertical code to each shipped pack (049 §8)", () => {
    const codes = Object.values(MANIFESTS).map((m) => m.verticalCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z]{3}$/);
  });
});

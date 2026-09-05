// EVERY SHIPPED PACK MANIFEST, KEYED BY VERTICAL (E04-B04).
//
// ⚠ THIS IS THE DATA HALF OF THE REGISTRY, AND `packRegistry.ts` IS STILL THE
// FUNCTION HALF. 049 §10 handed E04-B04 the cannon's question (F2) of whether
// `packRegistry.ts` collapses into the manifest loader. **It does not, yet, and
// the reason is one-directional:** a manifest is inert data that must be
// certified BEFORE it becomes a row, and certification asks the pack's functions
// what they do (`certifySignaturePositions` perturbs the real signature
// function). So the manifest layer depends on the registry, and folding the
// registry into it would make the thing being checked import the thing checking
// it. The collapse becomes possible when `signature_fn_ref` is resolved at boot
// from a ROW rather than from a literal map — 030 §5.2's end state — which needs
// a loader that reads the database, and that is a bead of its own.
//
// The two halves are kept honest by a contract test rather than by care: the
// manifest set's KEYS must equal `REGISTERED_VERTICALS`, so a pack cannot be
// registered without a manifest and a manifest cannot name a pack that does not
// exist. (051 §6 F2 spelled that assertion `Object.keys(MANIFESTS)` and takes a
// PATCH to `[...MANIFESTS.keys()]` with E04-D07 — the SET compared and F2's own
// ruling are unchanged; only the expression moved, with the map below.)
//
// ⚠ AND IT IS A THIRD FILE RATHER THAN A `manifests/` DIRECTORY. `catalog` is a
// FLAT module by contract: `tests/contract/catalog-surface.test.ts` asserts that
// every sibling is re-exported from `index.ts` and that no file reaches outside
// the module, and both checks read the directory as a flat list. A subdirectory
// would have passed the leaf rule while being invisible to the orphan rule — a
// file inside `catalog` that `index.ts` need never mention.

import type { VerticalPackManifest } from "./packManifest.js";
import { comicManifest } from "./comicManifest.js";
import { sportsCardManifest, tcgCardManifest } from "./cardManifests.js";

/**
 * Every manifest this build ships, keyed by `vertical_pack.vertical`.
 *
 * ⚠ A `Map` AND NOT AN OBJECT LITERAL, FOR THE REASON E04-D04 RECORDED IN
 * `src/services/confirmationOutcome.ts` AND THIS FILE SHIPPED THE OTHER WAY
 * (E04-D07; PR #79 review NOTE 3).
 *
 * `MANIFESTS[vertical]` on a plain object resolves INHERITED keys: `"toString"`,
 * `"valueOf"`, `"constructor"`, `"hasOwnProperty"` and `"__proto__"` all find a
 * member of `Object.prototype`, which is not `undefined`, so an `=== undefined`
 * guard waves them through. `manifestFor("toString")` returned
 * `Object.prototype.toString` — a FUNCTION, from a signature that promises
 * `VerticalPackManifest | undefined` — and `scripts/register-pack.ts` carried it
 * past its own guard to `certify()`, which failed with a confusing sentence
 * rather than the one the script exists to print.
 *
 * A `Map` has no inherited keys, so the refusal is a property of THE DATA
 * STRUCTURE rather than of a guard someone has to remember to write. That
 * matters more here than the one-line `Object.hasOwn` alternative because
 * **this value is EXPORTED**: a guard inside `manifestFor` would leave every
 * future `MANIFESTS[x]` call site holding the same trap, and `catalog`'s public
 * surface would still hand a caller an object whose lookup can answer with
 * something that is not a manifest.
 */
export const MANIFESTS: ReadonlyMap<string, VerticalPackManifest> = new Map([
  [comicManifest.vertical, comicManifest],
  [sportsCardManifest.vertical, sportsCardManifest],
  [tcgCardManifest.vertical, tcgCardManifest],
]);

/**
 * The manifest for a vertical, or `undefined`.
 *
 * Deliberately NOT fail-closed by throwing: the registration script needs to
 * report "no manifest ships for that vertical" with the list of the ones that do,
 * which is a better sentence than a stack trace. The fail-closed boundary is
 * `packFor` (030 §6 rule 3) and `assertCertified`.
 *
 * `undefined` now means `undefined` for EVERY string, including the names of
 * `Object.prototype`'s members — see the map above.
 */
export function manifestFor(vertical: string): VerticalPackManifest | undefined {
  return MANIFESTS.get(vertical);
}

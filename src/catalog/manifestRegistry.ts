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
// The two halves are kept honest by a contract test rather than by care:
// `Object.keys(MANIFESTS)` must equal `REGISTERED_VERTICALS`, so a pack cannot be
// registered without a manifest and a manifest cannot name a pack that does not
// exist.
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

/** Every manifest this build ships, keyed by `vertical_pack.vertical`. */
export const MANIFESTS: Readonly<Record<string, VerticalPackManifest>> = {
  [comicManifest.vertical]: comicManifest,
  [sportsCardManifest.vertical]: sportsCardManifest,
  [tcgCardManifest.vertical]: tcgCardManifest,
};

/**
 * The manifest for a vertical, or `undefined`.
 *
 * Deliberately NOT fail-closed by throwing: the registration script needs to
 * report "no manifest ships for that vertical" with the list of the ones that do,
 * which is a better sentence than a stack trace. The fail-closed boundary is
 * `packFor` (030 §6 rule 3) and `assertCertified`.
 */
export function manifestFor(vertical: string): VerticalPackManifest | undefined {
  return MANIFESTS[vertical];
}

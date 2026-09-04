// COPY FACTS AND PROVIDER NAMES — refused in EVERY vertical, by name (E04-B03).
//
// ⚠ WHY THIS IS ITS OWN MODULE, AND WHY THAT IS THE WHOLE POINT OF THE RULE.
// E04-B02 put this denylist inside `comicIdentity.ts`, which was right while one
// pack existed and wrong the moment a second one did: a card pack importing the
// comic pack to learn that `grader` is forbidden would have made the rule look
// like a COMIC rule that cards borrowed. 047 A6 says the opposite in terms —
// "`grader` and `cert_number` are COPY facts in EVERY vertical … a slabbed card
// is the same edition as a raw one, held by a different copy in a different
// condition at a different price" — and the Q6 ruling is that this "is not a pack
// decision at all: it is the same rule restated".
//
// So the rule lives ABOVE both packs. A pack does not opt into it, cannot opt out
// of it, and does not import a sibling to obtain it. That is the difference
// between a shared invariant and a convention one pack happens to follow.
//
// 030 §4 rule 2's provider prohibition travels the same way, for the same reason:
// no core table has a column named after a provider, "including in `attributes`,
// where a `gcd_id` key would smuggle the same coupling past the DDL".

/**
 * Attribute keys that name a COPY, not an edition, in any vertical (047 A6).
 *
 * Lowercased and stripped of `_`/`-` before comparison, so `cert_number`,
 * `certNumber` and `CERT-NUMBER` are one entry. The list is deliberately about
 * IDENTITY-ADJACENT copy facts and not about every copy fact there is: a pack
 * author who invents `slabLabel` gets `.strict()`'s ordinary refusal, which is
 * correct — the named list exists to give the FORESEEABLE mistakes a sentence
 * that explains itself.
 *
 * ⚠ `serialnumber` JOINED THIS LIST AT E04-B03, and it is the card vertical's
 * version of the same category error. A parallel printed to a run of 99 is an
 * EDITION fact — every copy of it shares the run — but `07/99` stamped on one
 * card is a COPY fact, exactly as a CGC cert number is. The card pack therefore
 * carries `printRun` (the run, an edition attribute) and refuses `serialNumber`
 * (the copy's place in it), which is 036's `physical_item` to hold.
 */
export const COPY_FACT_KEYS: readonly string[] = [
  "grader",
  "certnumber",
  "cert",
  "certification",
  "slab",
  "grade",
  "gradelabel",
  "graderlabel",
  "condition",
  "serialnumber",
  "serial",
];

/** Provider-named keys, refused by 030 §4 rule 2. */
const PROVIDER_KEY_RE = /^(gcd|metron|pricecharting|ebay|covrprice|comicvine|tcgplayer|psa|bgs|cgc|sgc)_?id$/;

/** Case- and separator-insensitive comparison form. */
export function canonicalKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

/** Thrown when an attribute payload names a copy fact (047 §2.3, A6; 036; 037). */
export class CopyFactInEditionError extends Error {
  constructor(readonly key: string) {
    super(
      `attribute ${JSON.stringify(key)} is a COPY fact, not an edition attribute (047 §2.3, A6). ` +
        `A slabbed book is the SAME EDITION as a raw one — it is a different copy, in a different ` +
        `condition, at a different price, and none of those three is identity. A grader's label is ` +
        `a number wearing a name, and locked decision 5 with 019 T7 (non-waivable) forbid a numeric ` +
        `grade anywhere on the identity path. It belongs on physical_item (036) and its ` +
        `condition_assessment (037).`
    );
    this.name = "CopyFactInEditionError";
  }
}

/** Thrown when an attribute payload names a provider (030 §4 rule 2). */
export class ProviderKeyInAttributesError extends Error {
  constructor(readonly key: string) {
    super(
      `attribute ${JSON.stringify(key)} names a PROVIDER (030 §4 rule 2). No core table has a ` +
        `column named after a provider — "including in attributes, where a \`gcd_id\` key would ` +
        `smuggle the same coupling past the DDL and past a grep for column names". An external ` +
        `identifier is an alias row in edition_external_id under a rights row, never an attribute.`
    );
    this.name = "ProviderKeyInAttributesError";
  }
}

/**
 * Refuse the two forbidden key classes before a pack schema ever sees the
 * payload, so the FORESEEABLE mistakes get the sentence that explains them rather
 * than `.strict()`'s "unrecognized key 'grader'".
 */
export function assertNoForbiddenKeys(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (COPY_FACT_KEYS.includes(canonicalKey(key))) throw new CopyFactInEditionError(key);
    if (PROVIDER_KEY_RE.test(canonicalKey(key))) throw new ProviderKeyInAttributesError(key);
  }
}

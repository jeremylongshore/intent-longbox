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

/**
 * Provider-named keys, refused by 030 §4 rule 2.
 *
 * ⚠ `cbcs`, `pgx` and `beckett` JOINED AT E04-D05, and the reason is a message
 * and not a hole. Without them `pgxId` and `beckett_id` fell PAST this rule to
 * the grader-namespace rule below, which refused them — correctly — with a
 * sentence saying the key "names a grade, a certification, a serial or a slab
 * label". It does not: it names a provider's identifier, and the author would
 * have been told the wrong thing about their own key. The namespace lists are
 * now aligned, so the key that names a grading company as a PROVIDER gets the
 * provider's sentence and the key that names one as a GRADE gets the copy
 * fact's.
 */
const PROVIDER_KEY_RE =
  /^(gcd|metron|pricecharting|ebay|covrprice|comicvine|tcgplayer|psa|bgs|cgc|sgc|cbcs|pgx|beckett)_?id$/;

/**
 * The grading companies whose NAME, used as a key's namespace, makes the key a
 * copy fact whatever noun follows it (E04-D05).
 *
 * ⚠ WHY A PREFIX RULE EXISTS AT ALL, AND WHAT WAS WRONG WITHOUT IT.
 * `COPY_FACT_KEYS` above is an EXACT list, so `psaGrade`, `bgs_grade`,
 * `cgcCertNumber`, `sgc-cert` and `CGC_Serial` were refused only by
 * `FIELD_NOT_IN_SCHEMA` — that is, refused because no pack's Zod object happened
 * to declare them. That is refusal by ACCIDENT: 051 §4.1 advertises C10 as a
 * refusal BY NAME, and a future pack author who declares `psaGrade` in their own
 * schema would have satisfied the field checks and CERTIFIED. 047 §8.4 is the
 * authority — "`grader` and `cert_number` are copy facts in EVERY vertical …
 * a slabbed card is the same edition as a raw one, held by a different copy in a
 * different condition at a different price" — and a grader's own name in front
 * of a grade word does not change which of those three the key names.
 */
export const GRADER_NAMESPACES: readonly string[] = [
  "psa",
  "bgs",
  "cgc",
  "sgc",
  "cbcs",
  "pgx",
  "tcgplayer",
  "beckett",
];

/**
 * Words that make a grader-namespaced key a copy fact when they OPEN the
 * remainder, so `cgcCertNumber` and `psaGradeLabel` are caught along with
 * `cgcCert` and `psaGrade`.
 *
 * These are long enough that a prefix match is safe: no plausible EDITION
 * attribute of a comic or a card begins with them. `grad` is deliberate and
 * catches `psaGrading` / `bgsGrader`; its known cost is that a hypothetical
 * `bgsGraduation` would also be refused, which is the direction to be wrong in.
 */
const GRADER_WORDS_PREFIX: readonly string[] = ["grade", "grad", "cert", "serial", "slab", "label", "score"];

/**
 * Words too SHORT to match as a prefix without catching innocent English, so
 * they must be the WHOLE remainder.
 *
 * ⚠ THIS IS THE BOUNDARY, AND IT IS THE POINT OF THE RULE (047 §8.4).
 * A grader namespace followed by a NON-grade word is an ordinary key and MUST
 * PASS: `psalm` (`psa` + `lm`), `bgsTitle`, `psaNormalized`, `bgsIdeal`,
 * `cgcIndex`. Were `no`/`num`/`id` prefix-matched, the last three would be
 * refused as copy facts, and a denylist that refuses ordinary words is a
 * denylist pack authors learn to work around. Exact-remainder matching keeps
 * `psaNumber`, `cgcNo`, `bgs_num` and `psaId` refused while leaving the
 * innocent ones alone.
 *
 * `<namespace>_id` in its exact form is ALREADY the provider rule's (030 §4
 * rule 2) and is checked first, so `psa_id` keeps raising
 * `ProviderKeyInAttributesError` and this rule never sees it. The overlap is
 * intentional: both classes are one refusal code at the manifest (051 §4.1's
 * `COPY_FACT_OR_PROVIDER_FIELD`), so a pack author cannot cross the line by
 * choosing which error they trip.
 */
const GRADER_WORDS_EXACT: readonly string[] = ["number", "num", "no", "id"];

/**
 * Case- and separator-insensitive comparison form.
 *
 * ⚠ EVERY non-alphanumeric character is stripped, not just `_` and `-`
 * (E04-D05). Stripping only those two left `psa.grade`, `psa grade` and
 * `psa/grade` as three keys the rules had never heard of — and a jsonb
 * `attributes` object accepts all three, so the escape was reachable and not
 * theoretical. The wider strip is strictly MORE refusing: it can only fold two
 * spellings together, never separate one that already matched.
 */
export function canonicalKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The grader namespace a key is written in, or `undefined` if it is not a
 * grader-namespaced copy fact.
 *
 * Case-insensitive and separator-blind by construction, because it works on
 * `canonicalKey`'s form: `psaGrade`, `PSA_GRADE`, `psa-grade` and `psagrade`
 * are one key. Exported so a caller can ASK, and so the rule is testable
 * without constructing a payload.
 */
export function graderNamespaceOf(key: string): string | undefined {
  const canonical = canonicalKey(key);
  for (const namespace of GRADER_NAMESPACES) {
    if (!canonical.startsWith(namespace)) continue;
    const rest = canonical.slice(namespace.length);
    if (rest.length === 0) continue; // the bare grader name is not a key of ours
    if (GRADER_WORDS_PREFIX.some((word) => rest.startsWith(word))) return namespace;
    if (GRADER_WORDS_EXACT.includes(rest)) return namespace;
  }
  return undefined;
}

/** Thrown when an attribute payload names a copy fact (047 §2.3, A6; 036; 037). */
export class CopyFactInEditionError extends Error {
  /**
   * `graderNamespace` is set when the key was caught by the NAMESPACE rule
   * rather than by `COPY_FACT_KEYS`, so the message can name the grader the
   * author wrote instead of leaving them to compare their key against a list it
   * is deliberately not on.
   */
  constructor(
    readonly key: string,
    readonly graderNamespace?: string
  ) {
    super(
      (graderNamespace === undefined
        ? ""
        : `attribute ${JSON.stringify(key)} is namespaced to the grading company ` +
          `${JSON.stringify(graderNamespace.toUpperCase())} and names a grade, a certification, a ` +
          `serial or a slab label. A grader's name in front of a key does not make the key an ` +
          `edition fact (047 §8.4). `) +
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
    const canonical = canonicalKey(key);
    if (COPY_FACT_KEYS.includes(canonical)) throw new CopyFactInEditionError(key);
    // ⚠ ORDER IS LOAD-BEARING, AND IT IS ONE LINE OF BEHAVIOUR.
    // `psa_id` / `cgcId` are BOTH a provider name (030 §4 rule 2) and a
    // grader namespace, and the exact `<namespace>_id` shape belonged to the
    // provider rule before E04-D05 existed. Testing the provider rule first
    // keeps that error, so the namespace rule only ever ADDS refusals and
    // never re-labels one. Both are the same code at the manifest (051 §4.1).
    if (PROVIDER_KEY_RE.test(canonical)) throw new ProviderKeyInAttributesError(key);
    const namespace = graderNamespaceOf(key);
    if (namespace !== undefined) throw new CopyFactInEditionError(key, namespace);
  }
}

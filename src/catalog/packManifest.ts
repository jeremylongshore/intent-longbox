// THE VERTICAL-PACK MANIFEST AND ITS CERTIFICATION (E04-B04).
//
// 030 §5.1 sketched a TypeScript interface and §5.2 gave it a home — one
// `vertical_pack` row per registered vertical and one immutable
// `vertical_pack_version` row per version of its manifest. This module is that
// sketch as shipped code: the Zod schema a manifest validates against, and
// `certify()`, the gate a manifest must pass before a row is written.
//
// ⚠ WHAT CERTIFICATION IS FOR, IN ONE SENTENCE. A registered pack is a row that
// governs how every later `collectible_definition` and `edition` in that vertical
// is read (030 §5.2: "the schema that governed it is still on disk, addressable,
// unchanged"), the row can never be updated (the append-only trigger), and so a
// manifest that is wrong is wrong FOREVER for every row that cites it. Everything
// below refuses at registration what could not be repaired afterwards.
//
// ⚠ FOWLER F1 IS THE RULE THIS FILE WAS WRITTEN UNDER, AND IT COST FIELDS.
// 030 A3: "a manifest field is added when a pack needs it, not before", and the
// bead restates it harder — a manifest field that nothing exercises is not
// declared. Every field below names its consumer in its own doc comment. The
// slots 030 §5.1 sketched that are NOT here, and why:
//
//   * `normalizedSignature` as a FUNCTION — a function cannot live in a jsonb
//     column (030 §5.2 says so in terms). The manifest carries `signatureFnRef`,
//     the module path the registry resolves; the function itself stays in
//     `packRegistry.ts`. The manifest's `inSignature` flags are checked AGAINST
//     that function by perturbation (`certifySignaturePositions`), which is a
//     stronger consumer than a copy of the function would have been.
//   * `providerCrosswalk[].normalize` — same reason, and no caller.
//   * `providerCrosswalk[].capabilities` — 014 §4.2's capability vocabulary has
//     no consumer in this tree and belongs to E04-B05/E04-B07. Declaring a shape
//     for it now is the guess A3 forbids freezing into an immutable row.
//   * `listingTemplate` and `evalSlices` — still RESERVED NAMES, not fields
//     (030 §5.1's table). The draft-creation block is still inline in the route
//     and the CI static eval set is still a Phase-2 exit item, so there is still
//     nothing to describe.
//
// ⚠ AND `packVersion` IS AN INTEGER, NOT SEMVER. 030 §5.1's comment says semver;
// `migrations/016_catalog_core.sql:103` says `pack_version integer NOT NULL CHECK
// (pack_version > 0)`. The shipped column wins, and the manifest matches the
// column rather than the comment — a manifest that could not be written to the
// row it exists to fill would be a contract with itself.

import { z } from "zod";
import { COPY_FACT_KEYS, assertNoForbiddenKeys } from "./copyFacts.js";
import { REGISTERED_VERTICALS, packFor } from "./packRegistry.js";

/**
 * The version of the MANIFEST SCHEMA below — what shape a stored `manifest jsonb`
 * payload was written against. Distinct from a pack's own `packVersion` (which
 * versions one pack's content, single-rate, 030 A5) and from
 * `COMIC_IDENTITY_SCHEMA_VERSION` / `CARD_IDENTITY_SCHEMA_VERSION` (which version
 * one vertical's attribute shape).
 */
export const MANIFEST_SCHEMA_VERSION = 1;

/**
 * The closed capture-shot vocabulary a manifest may draw on.
 *
 * ⚠ IT IS DELIBERATELY WIDER THAN `scan_photo.kind`, WHICH TODAY IS
 * `cover|barcode|defect` (`migrations/001_init.sql:77`). A card's back and a
 * slab's label are shots the DOMAIN has and the DATABASE cannot yet store, and
 * writing the card recipe as `cover` + `defect` to fit the enum would be a lie
 * about the recipe rather than a fact about the schema. So the vocabulary is the
 * pack's, and the gap is stated: **no pack may be capture-enabled until every
 * kind in its recipe is storable in `scan_photo.kind`** — an acceptance line
 * handed to E05-B06, which is blocked on this bead.
 */
export const CAPTURE_SHOT_KINDS = [
  "cover",
  "front",
  "back",
  "barcode",
  "defect",
  "slab_label",
  "interior",
] as const;
export type CaptureShotKind = (typeof CAPTURE_SHOT_KINDS)[number];

/**
 * Blocklist rows from 021 that EVERY pack must carry, whatever it sells.
 *
 * The field holds 021 row IDs, never copy — see `prohibitedClaims` below. These
 * seven are the ones that are about the CATEGORY rather than about comics: a
 * number as a Longbox grade (B17), "Longbox grade" (B18), "AI" anywhere near
 * condition (B19), borrowed certification words (B20), a Longbox range printed
 * beside a slab's number (B22), "Pressed" as a defect option (B24) and the
 * adjacency/naming rule (B25), plus the listing-provenance rule (B14). A pack
 * that omitted one would be a vertical in which a non-waivable line (019 T7,
 * locked decision 5) had quietly been switched off.
 */
export const UNIVERSAL_PROHIBITED_CLAIMS: readonly string[] = [
  "B14",
  "B17",
  "B18",
  "B19",
  "B20",
  "B22",
  "B24",
  "B25",
];

/** Grade-band words no pack may offer, whatever its vertical. */
const FORBIDDEN_GRADE_LABELS = ["MINT", "GEM", "GEMMINT", "GEMMT"];

/** Defect-vocabulary words no pack may offer (021 B24). */
const FORBIDDEN_DEFECTS = ["pressed", "pressing"];

/** Third-party grader namespaces, which are COPY facts and never crosswalk edges (047 §8.4). */
const CERT_NAMESPACES = ["psa", "bgs", "cgc", "sgc", "cbcs"];

const nonBlank = z.string().refine((v) => v.trim().length > 0, { message: "must not be blank" });

/**
 * One declared field of one identity schema.
 *
 * CONSUMER: `certifyIdentitySchema` cross-checks the declared set against the
 * pack module's Zod schema in BOTH directions, and `certifySignaturePositions`
 * proves the two `in*Signature` flags against the pack's own signature functions
 * by perturbation.
 * A declaration that drifts from the code fails certification; a declaration that
 * claims a signature position the function does not have fails too — which is the
 * defect 030 §5.4 shipped for a day when it listed `parallel` as a card edition
 * attribute and left it out of the sketched key (049 §5.2).
 */
export const manifestField = z
  .object({
    name: nonBlank,
    required: z.boolean(),
    /**
     * In the WORK's dedupe key (`collectible_definition.signature`). Only a
     * definition field can be, and certification says so rather than trusting it.
     */
    inDefinitionSignature: z.boolean(),
    /** In the PRINTING's dedupe key (`edition_signature.signature`). */
    inEditionSignature: z.boolean(),
  })
  .strict();

export type ManifestField = z.infer<typeof manifestField>;

export const verticalPackManifest = z
  .object({
    /** CONSUMER: `vertical_pack.vertical` (the PK) and `packFor()`. */
    vertical: nonBlank,
    /**
     * CONSUMER: `vertical_pack.vertical_code`, and through it every LCID minted
     * in this vertical (`mintLcidString(kind, verticalCode)`, 047 §3.3: "assigned
     * in the pack row, never invented per LCID"). THIS FIELD IS WHY E04-B04 OWNS
     * the authoritative code assignment 049 §8 declined to make.
     */
    verticalCode: z.string().regex(/^[a-z]{3}$/, "three lowercase letters (016_catalog_core.sql:88)"),
    /**
     * CONSUMER: the registration script's operator output, and the certification
     * report. It is the thinnest consumer in this file and it is named as such:
     * 030 §5.1 ratified `displayName` as pack metadata, and an operator confirming
     * which pack they just registered is a real reader, but nothing else reads it.
     */
    displayName: nonBlank,
    /**
     * CONSUMER: `vertical_pack_version.pack_version`, and `assertVersionMoved`,
     * which refuses a re-registration whose manifest changed without it (030 A5,
     * single-rate: schema, signature, recipe, condition, crosswalk, valuation and
     * prohibited claims all move under this ONE number).
     */
    packVersion: z.number().int().positive(),
    /**
     * CONSUMER: `vertical_pack_version.signature_fn_ref`, which is NOT NULL, and
     * `certify`'s check that the path is inside the catalog module. 030 §5.2:
     * "the pack registry resolves it at boot and FAILS CLOSED if it is missing".
     */
    signatureFnRef: nonBlank,
    /** CONSUMER: `certifyIdentitySchema` + `certifySignaturePositions`. */
    identitySchema: z
      .object({
        definition: z.array(manifestField).min(1),
        edition: z.array(manifestField).min(1),
      })
      .strict(),
    /**
     * CONSUMER: `certifyCaptureRecipe` (closed vocabulary, no duplicates, at
     * least one required shot) and, at E05-B06, the capture UI itself. The core
     * never hard-codes "photograph the cover" (030 §5.1).
     */
    captureRecipe: z
      .object({
        required: z.array(z.enum(CAPTURE_SHOT_KINDS)).min(1),
        conditional: z
          .array(z.object({ when: nonBlank, shot: z.enum(CAPTURE_SHOT_KINDS) }).strict())
          .default([]),
      })
      .strict(),
    /**
     * CONSUMER: `certifyConditionSchema` — the numeric refusal (030 I12, 022 P1,
     * 019 T7, locked decision 5), 021 B21's forbidden bands and 021 B24's
     * forbidden defect option. E08-B02 consumes it next.
     *
     * ⚠ THERE IS NO NUMERIC FIELD IN THIS TYPE AND THERE MUST NEVER BE ONE.
     * `graderLabelMap` maps a third-party grader's own label onto a Longbox
     * RANGE; the number never travels.
     */
    conditionSchema: z
      .object({
        gradeLabels: z.array(nonBlank).min(2),
        defectVocabulary: z.array(nonBlank),
        graderLabelMap: z.record(z.object({ low: nonBlank, high: nonBlank }).strict()).default({}),
      })
      .strict(),
    /**
     * CONSUMER: 030 I1/A6's DERIVED provider deny-list ("union every `provider`
     * declared in any registered pack's `providerCrosswalk`"), and
     * `certifyProviderCrosswalk`, which refuses a cert namespace (047 §8.4: a
     * cert-number edge would make one shop's slab a property of the shared
     * catalog).
     */
    providerCrosswalk: z.array(z.object({ provider: nonBlank, idKind: nonBlank }).strict()).min(1),
    /**
     * CONSUMER: `certifyValuation` (the grade basis is a range or a grader's
     * label, never a number; the currency is ISO-4217-shaped) and, at E09, the
     * pricing seam that must know which basis a source quotes.
     */
    valuationNormalization: z
      .object({
        gradeBasis: z.enum(["range", "grader_label"]),
        currency: z.string().regex(/^[A-Z]{3}$/, "ISO 4217, three uppercase letters"),
        sourceAdapters: z
          .array(z.object({ source: nonBlank, quoteKind: z.enum(["live_asks", "historical_fmv"]) }).strict())
          .min(1),
      })
      .strict(),
    /**
     * CONSUMER: `certifyProhibitedClaims`, which requires every row in
     * `UNIVERSAL_PROHIBITED_CLAIMS`; and T26's pre-send check at E11.
     *
     * ⚠ ROW IDs, NOT COPY. 021 is the registry of what may and may not be said,
     * and a manifest holding the SENTENCES would be a second copy of it that
     * drifts silently the day 021 takes an amend-by-a-row — which it did on
     * 2026-09-04, when B17–B25 arrived from 037. A pointer cannot drift.
     */
    prohibitedClaims: z.array(z.string().regex(/^B\d+[a-z]?$/, "a 021 blocklist row id, e.g. B17")).min(1),
  })
  .strict();

export type VerticalPackManifest = z.infer<typeof verticalPackManifest>;

/** One reason a manifest is not certifiable. */
export interface CertificationFinding {
  readonly code: string;
  readonly message: string;
}

export class PackCertificationError extends Error {
  constructor(
    readonly vertical: string,
    readonly findings: readonly CertificationFinding[]
  ) {
    super(
      `pack manifest for ${JSON.stringify(vertical)} FAILS certification (030 §5.4, E04-B04):\n` +
        findings.map((f) => `  [${f.code}] ${f.message}`).join("\n")
    );
    this.name = "PackCertificationError";
  }
}

/** Canonical JSON with object keys sorted, so two equal manifests compare equal. */
export function canonicalManifest(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, walk((v as Record<string, unknown>)[k])])
      );
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/**
 * The manifest's CONTENT, with `packVersion` removed — the "parts" 030 A5 says
 * the single version number governs.
 */
export function manifestParts(value: unknown): string {
  if (value === null || typeof value !== "object") return canonicalManifest(value);
  const { packVersion: _ignored, ...parts } = value as Record<string, unknown>;
  return canonicalManifest(parts);
}

/** The keys and optionality a pack's Zod object actually declares. */
function shapeOf(schema: unknown): Map<string, boolean> | undefined {
  const shape = (schema as { shape?: Record<string, { isOptional(): boolean }> }).shape;
  if (shape === undefined || typeof shape !== "object") return undefined;
  return new Map(Object.entries(shape).map(([k, v]) => [k, !v.isOptional()]));
}

function sorted(values: Iterable<string>): string {
  return [...values].sort().join(", ");
}

/**
 * The identity schema the manifest DECLARES must be the one the pack module
 * VALIDATES with — in both directions, key by key and required-flag by
 * required-flag.
 *
 * ⚠ THIS IS THE CHECK THAT MAKES THE DECLARATION SAFE TO DUPLICATE. A manifest
 * field list is a second copy of a pack's Zod object, and a second copy is a
 * drift hazard (047 §9.3's whole argument). It is worth having anyway, because
 * the stored `manifest jsonb` is the only readable answer to "what shape was this
 * `attributes` payload written against" after the code has moved on — and the
 * duplication is safe precisely because certification refuses to register a copy
 * that does not match.
 */
export function certifyIdentitySchema(manifest: VerticalPackManifest): CertificationFinding[] {
  const findings: CertificationFinding[] = [];
  let pack;
  try {
    pack = packFor(manifest.vertical);
  } catch {
    return findings; // `certifyVertical` already reported it.
  }

  for (const level of ["definition", "edition"] as const) {
    const declared = manifest.identitySchema[level];
    const actual = shapeOf(pack.schemas[level]);
    if (actual === undefined) {
      findings.push({
        code: "PACK_SCHEMA_NOT_AN_OBJECT",
        message: `the ${level} schema of pack ${JSON.stringify(manifest.vertical)} is not a Zod object, so its declared field list cannot be checked against it`,
      });
      continue;
    }

    const declaredNames = new Set(declared.map((f) => f.name));
    if (declaredNames.size !== declared.length) {
      findings.push({
        code: "DUPLICATE_FIELD",
        message: `the ${level} identity schema declares the same field name twice`,
      });
    }

    const undeclared = [...actual.keys()].filter((k) => !declaredNames.has(k));
    if (undeclared.length > 0) {
      findings.push({
        code: "FIELD_NOT_DECLARED",
        message:
          `the pack's ${level} schema validates [${sorted(undeclared)}], which the manifest does not ` +
          `declare. A field the manifest does not declare is a field no future reader of the stored ` +
          `manifest can interpret, and the row can never be updated to add it.`,
      });
    }

    const invented = [...declaredNames].filter((k) => !actual.has(k));
    if (invented.length > 0) {
      findings.push({
        code: "FIELD_NOT_IN_SCHEMA",
        message:
          `the manifest declares [${sorted(invented)}] on the ${level}, which the pack's schema does ` +
          `not validate. A declared field the code refuses is a promise the catalog cannot keep.`,
      });
    }

    for (const field of declared) {
      const required = actual.get(field.name);
      if (required !== undefined && required !== field.required) {
        findings.push({
          code: "REQUIRED_FLAG_DRIFT",
          message:
            `the manifest declares ${level}.${field.name} as ${field.required ? "required" : "optional"} ` +
            `and the pack's schema treats it as ${required ? "required" : "optional"}`,
        });
      }
    }
  }

  return findings;
}

/**
 * Copy facts and provider names may not be identity fields, in ANY vertical.
 *
 * ⚠ THIS IS 030 §5.4's SECOND HALF, THE ONE 049 §7 LEFT AS C10's ONLY ASSERTED
 * INVARIANT: "a pack manifest declaring either as an edition field FAILS pack
 * certification". E04-B03 discharged the exclusion in the shipped Zod schemas;
 * this discharges it in the manifest, which is the surface a future pack author
 * writes and the surface that could otherwise have re-admitted a grader by
 * declaring it in a row nobody type-checks.
 *
 * It is checked at BOTH levels rather than only the edition, because a grader on
 * the DEFINITION would be the same category error one level worse — a slab as a
 * property of the abstract work.
 */
export function certifyNoCopyFacts(manifest: VerticalPackManifest): CertificationFinding[] {
  const findings: CertificationFinding[] = [];
  for (const level of ["definition", "edition"] as const) {
    for (const field of manifest.identitySchema[level]) {
      try {
        assertNoForbiddenKeys({ [field.name]: null });
      } catch (err) {
        findings.push({
          code: "COPY_FACT_OR_PROVIDER_FIELD",
          message:
            `${level}.${field.name}: ${(err as Error).message} ` +
            `(030 §5.4, 047 A6 — the denylist is \`COPY_FACT_KEYS\`: ${COPY_FACT_KEYS.join(", ")})`,
        });
      }
    }
  }
  return findings;
}

/**
 * `inSignature` is checked against the pack's OWN signature function, by
 * perturbation: change one declared field and the signature must change if and
 * only if the manifest says that field is in the key.
 *
 * ⚠ WHY A PERTURBATION AND NOT A LIST COMPARISON. There is no list to compare
 * with — the signature is a function (030 §5.2), and the only honest question to
 * ask a function is what it does. It also makes the manifest's claim FALSIFIABLE
 * in the one place it matters: this test, run against 030 §5.4's pre-v1.3.0 card
 * sketch, would have failed on `parallel` — the defect 049 §5.2 found by reading.
 */
export function certifySignaturePositions(manifest: VerticalPackManifest): CertificationFinding[] {
  const findings: CertificationFinding[] = [];
  let pack;
  try {
    pack = packFor(manifest.vertical);
  } catch {
    return findings;
  }

  const base = (level: "definition" | "edition"): Record<string, unknown> =>
    Object.fromEntries(manifest.identitySchema[level].map((f) => [f.name, `${level[0]!}0${f.name}`]));

  const editionSignatureOf = (
    definitionAttributes: Record<string, unknown>,
    editionAttributes: Record<string, unknown>
  ): string => pack.editionSignature(pack.signatureInput(definitionAttributes, editionAttributes));

  const baselineEdition = editionSignatureOf(base("definition"), base("edition"));
  const baselineDefinition = pack.definitionSignature(base("definition"));

  const report = (what: string, declared: boolean, moved: boolean, field: string, level: string): void => {
    if (moved && !declared) {
      findings.push({
        code: "UNDECLARED_SIGNATURE_POSITION",
        message:
          `${level}.${field} CHANGES the ${what} signature but the manifest declares it out of that key. ` +
          `A field that moves a dedupe key is identity whether the manifest says so or not.`,
      });
    }
    if (!moved && declared) {
      findings.push({
        code: "PHANTOM_SIGNATURE_POSITION",
        message:
          `${level}.${field} is declared in the ${what} signature and does NOT change it. This is the ` +
          `exact shape of the defect 030 §5.4 carried until 049 §5.2: an attribute listed as identity ` +
          `that the key cannot see, so two different printings dedupe as one.`,
      });
    }
  };

  for (const field of manifest.identitySchema.definition) {
    const perturbed = base("definition");
    perturbed[field.name] = `${perturbed[field.name] as string}-perturbed`;
    report(
      "work",
      field.inDefinitionSignature,
      pack.definitionSignature(perturbed) !== baselineDefinition,
      field.name,
      "definition"
    );
    report(
      "edition",
      field.inEditionSignature,
      editionSignatureOf(perturbed, base("edition")) !== baselineEdition,
      field.name,
      "definition"
    );
  }

  for (const field of manifest.identitySchema.edition) {
    if (field.inDefinitionSignature) {
      findings.push({
        code: "EDITION_FIELD_IN_WORK_KEY",
        message:
          `edition.${field.name} is declared in the WORK's signature. The work's key is computed from ` +
          `the definition's attributes alone (\`definitionSignature\`); a printing-level fact in it ` +
          `would split one work into one work per printing.`,
      });
    }
    const perturbed = base("edition");
    perturbed[field.name] = `${perturbed[field.name] as string}-perturbed`;
    report(
      "edition",
      field.inEditionSignature,
      editionSignatureOf(base("definition"), perturbed) !== baselineEdition,
      field.name,
      "edition"
    );
  }

  return findings;
}

/** 030 I12 / 022 P1 / 019 T7 / locked decision 5, plus 021 B21 and B24. */
export function certifyConditionSchema(manifest: VerticalPackManifest): CertificationFinding[] {
  const findings: CertificationFinding[] = [];
  const { gradeLabels, defectVocabulary, graderLabelMap } = manifest.conditionSchema;

  for (const label of gradeLabels) {
    if (/\d/.test(label)) {
      findings.push({
        code: "NUMERIC_GRADE",
        message:
          `grade label ${JSON.stringify(label)} contains a digit. Condition is NEVER numeric — locked ` +
          `decision 5, 022 P1 and 019 T7 (non-waivable), and 021 B17 forbids "any number as a Longbox ` +
          `grade — a digit, a decimal, a percentage".`,
      });
    }
    const folded = label.toUpperCase().replace(/[^A-Z]/g, "");
    if (FORBIDDEN_GRADE_LABELS.includes(folded)) {
      findings.push({
        code: "FORBIDDEN_GRADE_BAND",
        message:
          `grade label ${JSON.stringify(label)} is forbidden by 021 B21 — "'Mint' is a standard that is ` +
          `too difficult to define" (037 §2.0.5), and a word the trade's own publishers decline to pin ` +
          `down invites its misuse. 030 §5.4's card sketch offered MINT and GEM; the blocklist row that ` +
          `retires them arrived after it (021 v1.3.0, 2026-09-04), and the authoritative card vocabulary ` +
          `is E08-B02's.`,
      });
    }
  }
  if (new Set(gradeLabels).size !== gradeLabels.length) {
    findings.push({
      code: "DUPLICATE_GRADE_LABEL",
      message: "grade labels must be unique and ordered worst to best",
    });
  }

  for (const defect of defectVocabulary) {
    if (FORBIDDEN_DEFECTS.includes(defect.toLowerCase().replace(/[^a-z]/g, ""))) {
      findings.push({
        code: "FORBIDDEN_DEFECT_OPTION",
        message:
          `defect option ${JSON.stringify(defect)} is forbidden by 021 B24: "the tap is cheap and the ` +
          `evidence is invisible, so an option that exists gets used falsely". Pressing reaches a ` +
          `listing only through the condition notes, and only when the shop knows (037 §2.4 rule 1).`,
      });
    }
  }

  for (const [graderLabel, range] of Object.entries(graderLabelMap)) {
    for (const [end, value] of [
      ["low", range.low],
      ["high", range.high],
    ] as const) {
      if (!gradeLabels.includes(value)) {
        findings.push({
          code: "GRADER_MAP_OUTSIDE_LADDER",
          message:
            `graderLabelMap[${JSON.stringify(graderLabel)}].${end} is ${JSON.stringify(value)}, which is ` +
            `not one of this pack's grade labels. A grader's label maps ONTO our ladder or not at all — ` +
            `it never carries its own number through (022 P1, 019 T7).`,
        });
      }
    }
    if (gradeLabels.includes(range.low) && gradeLabels.includes(range.high)) {
      if (gradeLabels.indexOf(range.low) > gradeLabels.indexOf(range.high)) {
        findings.push({
          code: "GRADER_MAP_INVERTED",
          message: `graderLabelMap[${JSON.stringify(graderLabel)}] maps to a range whose low is above its high`,
        });
      }
    }
  }

  return findings;
}

/** 047 §8.4 — a cert namespace is a COPY fact and is never a crosswalk edge. */
export function certifyProviderCrosswalk(manifest: VerticalPackManifest): CertificationFinding[] {
  const findings: CertificationFinding[] = [];
  const seen = new Set<string>();
  for (const edge of manifest.providerCrosswalk) {
    const provider = edge.provider.toLowerCase();
    if (seen.has(provider)) {
      findings.push({
        code: "DUPLICATE_PROVIDER",
        message: `provider ${JSON.stringify(edge.provider)} is declared twice`,
      });
    }
    seen.add(provider);
    if (edge.provider !== provider) {
      findings.push({
        code: "PROVIDER_NOT_LOWERCASE",
        message: `provider ${JSON.stringify(edge.provider)} must be lowercase — it is a namespace, and two spellings are two namespaces`,
      });
    }
    if (CERT_NAMESPACES.includes(provider)) {
      findings.push({
        code: "CERT_NAMESPACE_IN_CROSSWALK",
        message:
          `provider ${JSON.stringify(edge.provider)} is a third-party GRADER. 047 §8.4 excludes cert ` +
          `namespaces from \`edition_external_id\` entirely: a cert-number edge would make one shop's ` +
          `slab a property of the shared catalog. A cert belongs on the copy (036) and its condition ` +
          `record (037).`,
      });
    }
  }
  return findings;
}

/**
 * Two valuation sources may not share a name.
 *
 * The grade basis and the currency are checked by the Zod schema above — a
 * `z.enum(["range","grader_label"])` and an ISO-4217 regex — and NOT by this
 * function, which does one thing. An earlier version of this comment claimed
 * both, which is the kind of sentence that survives long after the body stops
 * matching it.
 */
export function certifyValuation(manifest: VerticalPackManifest): CertificationFinding[] {
  const findings: CertificationFinding[] = [];
  const seen = new Set<string>();
  for (const adapter of manifest.valuationNormalization.sourceAdapters) {
    if (seen.has(adapter.source)) {
      findings.push({
        code: "DUPLICATE_SOURCE",
        message: `valuation source ${JSON.stringify(adapter.source)} is declared twice`,
      });
    }
    seen.add(adapter.source);
  }
  return findings;
}

/** Every pack carries the category-level 021 rows, whatever it sells. */
export function certifyProhibitedClaims(manifest: VerticalPackManifest): CertificationFinding[] {
  const declared = new Set(manifest.prohibitedClaims);
  const missing = UNIVERSAL_PROHIBITED_CLAIMS.filter((row) => !declared.has(row));
  if (missing.length === 0) return [];
  return [
    {
      code: "MISSING_UNIVERSAL_PROHIBITED_CLAIM",
      message:
        `the manifest omits 021 blocklist rows [${missing.join(", ")}], which are not comic rows but ` +
        `category rows — a number as a Longbox grade, "Longbox grade", "AI" near condition, borrowed ` +
        `certification words, a range beside a slab's number, "Pressed" as a defect option, and the ` +
        `adjacency/naming rule. A pack that omitted one would be a vertical in which a non-waivable ` +
        `line (019 T7, locked decision 5) had quietly been switched off.`,
    },
  ];
}

/** Shot kinds come from the closed vocabulary and are not repeated. */
export function certifyCaptureRecipe(manifest: VerticalPackManifest): CertificationFinding[] {
  const findings: CertificationFinding[] = [];
  const required = manifest.captureRecipe.required;
  if (new Set(required).size !== required.length) {
    findings.push({
      code: "DUPLICATE_CAPTURE_SHOT",
      message: "the same required capture shot is declared twice; a recipe is a set of shots, not a count",
    });
  }
  for (const conditional of manifest.captureRecipe.conditional) {
    if (required.includes(conditional.shot)) {
      findings.push({
        code: "CONDITIONAL_SHOT_ALREADY_REQUIRED",
        message:
          `capture shot ${JSON.stringify(conditional.shot)} is both required and conditional, so its ` +
          `condition can never be false in a way anyone can observe`,
      });
    }
  }
  return findings;
}

/** The vertical must be one this build can actually resolve (030 §6 rule 3). */
export function certifyVertical(manifest: VerticalPackManifest): CertificationFinding[] {
  if (REGISTERED_VERTICALS.includes(manifest.vertical)) return [];
  return [
    {
      code: "UNREGISTERED_VERTICAL",
      message:
        `${JSON.stringify(manifest.vertical)} is not a registered vertical — this build resolves ` +
        `[${REGISTERED_VERTICALS.join(", ")}]. 030 §6 rule 3: an unregistered vertical is rejected at the ` +
        `boundary, never defaulted to "comic". Registering a manifest whose functions do not exist would ` +
        `write a row that every later write cites and no code can honour.`,
    },
  ];
}

/** `signature_fn_ref` names a module inside the catalog, and only inside it. */
export function certifySignatureFnRef(manifest: VerticalPackManifest): CertificationFinding[] {
  if (/^src\/catalog\/[\w/-]+\.ts$/.test(manifest.signatureFnRef)) return [];
  return [
    {
      code: "SIGNATURE_FN_REF_OUTSIDE_CATALOG",
      message:
        `signatureFnRef ${JSON.stringify(manifest.signatureFnRef)} must be a \`src/catalog/**.ts\` path. ` +
        `The signature function is the pack's one executable surface (030 §5.1) and it is a catalog ` +
        `member; a path outside the module would put the dedupe rule where \`catalog-is-a-leaf\` cannot ` +
        `see it.`,
    },
  ];
}

/**
 * Certify a manifest. An empty array is a pass.
 *
 * Pure: it reads the manifest and the in-process pack registry, never the
 * database and never the filesystem. The registration script does the two checks
 * that need I/O (the module path resolves; the version moved with the parts).
 */
export function certify(candidate: unknown): CertificationFinding[] {
  const parsed = verticalPackManifest.safeParse(candidate);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      code: "MANIFEST_SHAPE",
      message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    }));
  }
  const manifest = parsed.data;
  return [
    ...certifyVertical(manifest),
    ...certifySignatureFnRef(manifest),
    ...certifyIdentitySchema(manifest),
    ...certifyNoCopyFacts(manifest),
    ...certifySignaturePositions(manifest),
    ...certifyCaptureRecipe(manifest),
    ...certifyConditionSchema(manifest),
    ...certifyProviderCrosswalk(manifest),
    ...certifyValuation(manifest),
    ...certifyProhibitedClaims(manifest),
  ];
}

/** `certify`, as a fail-closed assertion. */
export function assertCertified(candidate: unknown): VerticalPackManifest {
  const findings = certify(candidate);
  const vertical =
    candidate !== null && typeof candidate === "object"
      ? String((candidate as { vertical?: unknown }).vertical ?? "(unnamed)")
      : "(unnamed)";
  if (findings.length > 0) throw new PackCertificationError(vertical, findings);
  return verticalPackManifest.parse(candidate);
}

/**
 * 030 A5, the single-rate rule, enforced where it can actually be enforced: at
 * REGISTRATION, against what is already on disk.
 *
 * A manifest whose content changed must carry a HIGHER `packVersion`; a manifest
 * re-registered at the same version must be byte-identical after canonicalisation.
 * The rule cannot be checked from a manifest alone — "the version moved" is a
 * statement about two versions — which is why this takes the previously
 * registered pair and why the registration script is where it runs.
 */
export function assertVersionMoved(
  previous: { readonly packVersion: number; readonly manifest: unknown } | undefined,
  next: VerticalPackManifest
): void {
  if (previous === undefined) return;
  // ⚠ THE COMPARISON EXCLUDES `packVersion` ITSELF, AND THAT IS THE WHOLE RULE.
  // A5 is "the version moves when the PARTS move", so the parts are what is
  // compared. Comparing the whole manifest would make every version bump look
  // like a change, so a bump that changed nothing else would pass — and a bump is
  // exactly what a careless author reaches for.
  const changed = manifestParts(previous.manifest) !== manifestParts(next);
  if (changed && next.packVersion <= previous.packVersion) {
    throw new PackCertificationError(next.vertical, [
      {
        code: "VERSION_DID_NOT_MOVE",
        message:
          `the manifest changed and packVersion is still ${next.packVersion} (already registered at ` +
          `${previous.packVersion}). 030 A5 makes the pack version SINGLE-RATE: a change to the identity ` +
          `schema, OR the signature function, OR the capture recipe, OR the condition schema, OR the ` +
          `crosswalk, OR the valuation normalisation, OR the prohibited claims bumps THIS number and ` +
          `produces a NEW immutable row. The version is what makes an old \`edition\` readable — it names ` +
          `the one manifest its attributes validated against — so a changed manifest under an unchanged ` +
          `version would silently re-answer a question thousands of rows already cite.`,
      },
    ]);
  }
  if (!changed && next.packVersion !== previous.packVersion) {
    throw new PackCertificationError(next.vertical, [
      {
        code: "VERSION_MOVED_WITHOUT_A_CHANGE",
        message:
          `packVersion moved from ${previous.packVersion} to ${next.packVersion} with an identical ` +
          `manifest. A version row that changes nothing splits the rows citing it across two answers ` +
          `that are the same answer, for no reason a reader can recover.`,
      },
    ]);
  }
}

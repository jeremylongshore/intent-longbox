// The event catalogue: nine names, AUTHORED, never generated.
//
// 043 §3.3 and §3.4 are the record. Two things about this file matter more than
// its contents:
//
// 1. IT IS AUTHORED. It does not derive itself from `src/db/appendOnlyTables.ts`
//    and it must not be changed to. 042 A2 struck a GENERATED catalogue on the
//    ground that generation cannot be wrong, and a list that cannot be wrong
//    cannot be reviewed. Someone signs each name. The `why` field below is that
//    signature: it says which consumer OUTSIDE the writing module needs the
//    event, and a name with no such consumer does not belong here.
//
// 2. THE EXCLUSIONS ARE THE ARGUMENT. Fourteen append-only tables produce nine
//    events, and every omission cites the rule that omits it (see EXCLUSIONS
//    below). That is the falsifiability 043 §0 claims for this list: a reader
//    who thinks `llm_rerank` needs an event has a specific sentence to attack.
//
// NAMING RULE: `longbox.<module>.<past-tense verb phrase>`, where <module> is
// 029 §2's owning module for the referenced table. The module segment is not
// decoration — it is what makes the consumer-routing rule in 043 §4.1 checkable.
//
// CHANGE RULE (042 §2.3, applied to the same class of object for the same
// reason): adding a name is ADDITIVE within v1 and is the rule working. A rename
// or a removal is a v2 change, and a retired name is retired forever.

/** 029 §2's module names, as used by the middle segment of every event name. */
export type EventModule = "workflow" | "resolution" | "condition" | "valuation" | "commerce";

export interface CatalogueEntry {
  /** The wire name. Written out in full rather than composed, so a grep finds it. */
  readonly event: string;
  readonly module: EventModule;
  /** The committed witness row the event references (043 §3.1). */
  readonly refTable: string;
  /**
   * TRUE for the one command-shaped entry, whose subject has NOT happened yet
   * and which therefore self-references (`ref_table = 'outbox'`, `ref_id = id`).
   *
   * 043 §3.4 ratifies EXACTLY ONE. The hazard the count guards against is not
   * this entry — it is "commands are fine, actually" becoming a habit. Adding a
   * second requires a decision record, and
   * `tests/contract/event-catalogue.test.ts` fails the build with a message that
   * points at the argument rather than reporting a number, because the person
   * who trips it is adding the second command and needs the reason.
   */
  readonly command?: true;
  /** Why a consumer OUTSIDE the writing module needs it. The signature on the name. */
  readonly why: string;
}

export const EVENT_CATALOGUE: readonly CatalogueEntry[] = [
  {
    event: "longbox.workflow.photo_captured",
    module: "workflow",
    refTable: "scan_photo",
    why:
      "Retention anchors. 022 P7 Q6 counts originals from draft creation with a ceiling " +
      "from capture; platform owns the sweep (029 §2.9) and cannot see workflow's write. " +
      "Also E13-B06's derivative pipeline.",
  },
  {
    event: "longbox.resolution.candidate_set_written",
    module: "resolution",
    refTable: "candidate_set",
    why:
      "Reporting's funnel and the eval set (R19). 029 §2.8 makes reporting strictly " +
      "downstream and forbids it from any write path, so an event is the only way it learns.",
  },
  {
    event: "longbox.workflow.confirmation_recorded",
    module: "workflow",
    refTable: "human_confirmation",
    why: "Commerce consumes it (029 §2.7 lists it under Consumes), and it is a T3 numerator input.",
  },
  {
    event: "longbox.condition.condition_recorded",
    module: "condition",
    refTable: "condition_assessment",
    why: "Commerce's draft gate — 040 F6 refuses a draft with no condition.",
  },
  {
    event: "longbox.valuation.pricing_recorded",
    module: "valuation",
    refTable: "pricing_snapshot",
    why:
      "Commerce consumes it (029 §2.7); 029 §2.6 forbids commerce from re-deriving a price, " +
      "so it must be told one.",
  },
  {
    event: "longbox.commerce.draft_requested",
    module: "commerce",
    refTable: "outbox",
    command: true,
    why:
      "043 §4's job. The one event whose consumer is a JOB rather than a reader, and the " +
      "one whose subject has not happened yet — which is what a saga step is. It " +
      "self-references because the two alternatives are worse: referencing the " +
      "human_confirmation that justifies the draft would say a confirmation happened " +
      "(confirmation_recorded's job, and two events referencing one row with different " +
      "meanings is how a catalogue starts lying), and a payload carrying the session id " +
      "is the values-in-events shape 043 §2.5 forbids.",
  },
  {
    event: "longbox.commerce.draft_recorded",
    module: "commerce",
    refTable: "shopify_draft",
    why:
      "Platform's retention anchor (029 §2.9 consumes it: originals count from draft " +
      "creation). Also 019 T17's numerator.",
  },
  {
    event: "longbox.commerce.listing_status_observed",
    module: "commerce",
    refTable: "listing_status_observation",
    why:
      "The 019 T19 detector and the derivative retention anchor (040 §4.4; 022 P7 Q6's " +
      "life of the listing).",
  },
  {
    event: "longbox.workflow.transition_recorded",
    module: "workflow",
    refTable: "scan_session_transition",
    why:
      "040 §3.3's explicit transitions; reporting's funnel and E05's resumable list read " +
      "them. The table landed with E02-B10's migration 010, so every entry in this " +
      "catalogue now references a table that exists.",
  },
];

/**
 * The nine exclusions, each naming the rule that excludes it (043 §3.3).
 *
 * This is not documentation-for-its-own-sake: it is what makes the catalogue
 * falsifiable. A reader who disagrees with an entry here has one sentence to
 * attack, rather than an absence to argue about.
 */
export const CATALOGUE_EXCLUSIONS: ReadonlyArray<{ table: string; rule: string }> = [
  {
    table: "cost_log",
    rule:
      "029 §2.8 makes reporting the SINK that owns the table. An event telling reporting " +
      "about a row reporting wrote is a loop.",
  },
  {
    table: "llm_rerank",
    rule:
      "Written in the same transaction as its candidate_set (029 §12.1 point 4's worked " +
      "example). A consumer that wants it reads it through the reference.",
  },
  {
    table: "corpus_version",
    rule: "Nothing writes it (041 §10.1).",
  },
  {
    table: "media_deletion",
    rule: "Platform's own table; 029 §2.9 makes platform the graph's leaf — it publishes to nobody inside it.",
  },
  {
    table: "retention_policy",
    rule: "Platform's own table (029 §2.9, as above).",
  },
  {
    table: "retention_hold",
    rule: "Platform's own table (029 §2.9, as above).",
  },
  {
    table: "retention_hold_release",
    rule: "Platform's own table (029 §2.9, as above).",
  },
  {
    table: "outbox",
    rule:
      "The outbox is the transport, not a subject. An event about an outbox row would be " +
      "the queue reporting on itself. (draft_requested's ref_table is 'outbox' because it " +
      "self-references, which is a different fact — 043 §3.4.)",
  },
  {
    table: "outbox_attempt",
    rule: "As above: delivery machinery, not a witness a consumer outside platform acts on.",
  },
];

export const EVENT_NAMES: readonly string[] = EVENT_CATALOGUE.map((e) => e.event);

const BY_NAME = new Map(EVENT_CATALOGUE.map((e) => [e.event, e]));

export function catalogueEntry(event: string): CatalogueEntry | undefined {
  return BY_NAME.get(event);
}

/** True for a name the catalogue declares. Enqueue refuses anything else. */
export function isCatalogueEvent(event: string): boolean {
  return BY_NAME.has(event);
}

/** The one command-shaped event, by name, for callers that would otherwise re-derive it. */
export const DRAFT_REQUESTED = "longbox.commerce.draft_requested";

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

  // ---------------------------------------------------------------------------
  // E03-D09 — THE IDENTITY CLUSTER (048 §10.1, migrations 018/019). Seven tables,
  // ONE rule, stated once and cited by each row:
  //
  //   AN AUTHENTICATION FACT IS NOT A SUBJECT OF THE SESSION EVENT STREAM.
  //
  // 043 §3.3's catalogue names the nine events one SCAN SESSION produces, and
  // every consumer of them is downstream of a shop's pipeline. A grant, a session
  // issuance and a failed PIN are not steps in a book's journey: they carry no
  // `scan_session_id`, they happen between sessions as often as during one, and
  // no consumer could act on one without becoming a surface 022 P3 forbids.
  //
  // **And the strong form, which is why this is a rule rather than a shrug**: an
  // event carrying an operator identifier out of the identity module and into a
  // consumer registry would be a per-operator surface arriving through the outbox
  // — 019 T35 signs that at zero, NON-WAIVABLE, and 034 §3.3's accessor rule
  // exists precisely so those columns have ONE reader. An event bus is many.
  // ---------------------------------------------------------------------------
  {
    table: "membership",
    rule:
      "048 §10.1 / 034 §3.3: an authentication fact is not a subject of the session event stream. " +
      "A grant carries no scan_session_id and names a person — an event about it would carry an " +
      "operator identifier past the audited accessor (019 T35, non-waivable).",
  },
  {
    table: "membership_revocation",
    rule:
      "As `membership`: the ending of a grant is the same kind of fact as the grant. Its EFFECT " +
      "on live sessions is synchronous and in the same transaction (048 §3.4, K3), not eventual — " +
      "a fired employee's phone must stop at the next request, not at the next poll.",
  },
  {
    table: "device_credential",
    rule:
      "048 §7.3 / 034 §2.8: minting a credential is an act on a PHONE, with no session in scope. " +
      "Its consumers are the authentication hook and nothing else.",
  },
  {
    table: "device_credential_revocation",
    rule:
      "As `device_credential`. Revocation takes effect by DERIVATION at the next request " +
      "(048 §3.3, §7.3) — there is no sweep to trigger and therefore no event to trigger it.",
  },
  {
    table: "app_session",
    rule:
      "048 §3.3: an issuance fact. Emitting one would publish a per-operator sign-in log to every " +
      "consumer in the registry, which is the surface 022 P3 forbids and 019 T35(c) explicitly " +
      "reconciles FROM this table rather than from a stream.",
  },
  {
    table: "app_session_revocation",
    rule: "As `app_session`. A chain ending is read by the liveness predicate and by nothing else.",
  },
  {
    table: "auth_attempt",
    rule:
      "048 §9.1 (R17): SUBSTRATE, not surface. It is read ONLY by the single-pair lockout " +
      "derivation and by an audited break-glass query; any other read is an architecture-gate " +
      "failure. An event about a failed PIN is, by construction, one of those other reads.",
  },
  {
    table: "authorization_decision",
    rule:
      "E03-B03 / 054 §4: the SAME rule one step further — an authorization fact is not a subject " +
      "of the session event stream, and this one would be the worst offender of the set. Every " +
      "row names a membership and a session chain, so publishing it would put the authority " +
      "structure of every shop on a bus whose consumers are, by design, many (019 T35 " +
      "non-waivable; 022 P3). It has exactly two readers by construction: the retention sweep " +
      "(E03-B09) and an audited review, and neither is a consumer.",
  },

  // ---------------------------------------------------------------------------
  // E03-D07 — INVITATIONS, DEVICE ENROLLMENT AND THE PIN RETIREMENT (048 §7,
  // §3.5), landed by migration 024. Five tables, and they fall under the SAME
  // rule the seven above state:
  //
  //   AN AUTHENTICATION FACT IS NOT A SUBJECT OF THE SESSION EVENT STREAM.
  //
  // Each row cites it rather than restating it. What is worth adding once, here,
  // is the shape that makes these five a particularly bad fit: an event about a
  // redemption would carry a shop, a person and a phone into every consumer in
  // the registry — three of the four identifiers 034 §3.3's accessor exists to
  // give ONE reader — in exchange for telling a consumer something with no
  // `scan_session_id`, which means `outbox.session_seq` would be permanently
  // NULL on it and 043 §3.2's within-session delivery order would not apply.
  // ---------------------------------------------------------------------------
  {
    table: "invitation",
    rule:
      "048 §7.1 / 034 §3.3: an authentication fact. An invitation names a person and a shop and " +
      "carries no scan_session_id; an event about one would carry an operator identifier past the " +
      "audited accessor (019 T35, non-waivable) to tell a consumer about a code it must never see.",
  },
  {
    table: "invitation_use",
    rule:
      "As `invitation`. Its EFFECT — the membership — is written in the SAME transaction " +
      "(048 §7.1), so there is nothing eventual for a consumer to react to: by the time a poller " +
      "saw the event, the grant it announces would already be what every request reads.",
  },
  {
    table: "device_enrollment_code",
    rule:
      "048 §7.3: as `device_credential` — issuing a code is an act on a PHONE that does not exist " +
      "yet, with no session in scope. Its only reader is the redemption path.",
  },
  {
    table: "device_enrollment_code_use",
    rule:
      "As `device_enrollment_code`. The `device` and `device_credential` it names are written in " +
      "the same transaction (048 §7.3), and the phone learns the outcome from the response that " +
      "sets its cookie — not from a bus.",
  },
  {
    table: "operator_pin_retirement",
    rule:
      "048 §3.5: as `membership_revocation`, whose consequence it is. It takes effect by " +
      "DERIVATION at the next PIN verification — liveness is a predicate over this table " +
      "(`src/services/auth/pin.ts`) — so there is no sweep to trigger and therefore no event to " +
      "trigger it, and an event would publish 'this named person's PIN was taken away on this " +
      "phone' to every consumer in the registry.",
  },

  // ---------------------------------------------------------------------------
  // E03-D06 — THE SECOND FACTOR (048 §4, §8), landed by migration 025. Four
  // tables, under the SAME rule the twelve above state:
  //
  //   AN AUTHENTICATION FACT IS NOT A SUBJECT OF THE SESSION EVENT STREAM.
  //
  // What is worth adding once, here, is that these four are the WORST fit in the
  // cluster rather than merely a poor one: an event about any of them would tell
  // every consumer in the registry that a NAMED PERSON'S second factor was
  // enrolled, spent, lost or recovered — which is not only 019 T35's per-operator
  // surface arriving through the outbox, it is a live map of which owners
  // currently cannot get in.
  // ---------------------------------------------------------------------------
  {
    table: "user_authenticator_retirement",
    rule:
      "048 §4.3 / §8.1: an authentication fact with no scan_session_id. It takes effect by " +
      "DERIVATION at the next verification — liveness is a predicate over this table " +
      "(`src/services/auth/authenticator.ts`) — so there is no sweep to trigger and no event to " +
      "trigger it, and an event would announce that a named person's second factor is gone.",
  },
  {
    table: "recovery_code",
    rule:
      "048 §8.1: an issuance fact about a credential shown once. Its only reader is the " +
      "redemption path, and an event about it would carry a person past the audited accessor " +
      "(034 §3.3, 019 T35 non-waivable) to tell a consumer about codes it must never see.",
  },
  {
    table: "recovery_code_use",
    rule:
      "As `recovery_code`. Its EFFECT — the retirement that forces re-enrollment — is written in " +
      "the SAME transaction (048 §8.1), so there is nothing eventual to react to; and the event " +
      "would say 'this named owner has lost their phone', which is the one fact an attacker " +
      "watching a bus would most want.",
  },
  {
    table: "shop_recovery_nomination",
    rule:
      "048 §8.2: a statement about a shop's people, read by E11-B09's break-glass runbook out of " +
      "band and by nothing in the pipeline. It carries no scan_session_id, and a named contact is " +
      "not a credential — publishing one to every consumer would widen a personal datum's " +
      "audience for no consumer that wants it.",
  },

  // ---------------------------------------------------------------------------
  // E03-B05 — THE CREDENTIAL LIFECYCLE (050 §4), landed by migrations 021/022.
  // Two tables, ONE rule:
  //
  //   A CREDENTIAL'S LIFE IS NOT A SUBJECT OF THE SESSION EVENT STREAM.
  //
  // A rotation carries no `scan_session_id`, happens between sessions rather than
  // during one, and changes state that the resolver reads DIRECTLY at every call
  // (050 §12: the per-process cache is deliberately not taken, because a cached
  // credential is a retired credential still working). So there is nothing an
  // event could usefully tell a consumer: by the time a poller saw it, the
  // resolver would already have acted on the row itself.
  //
  // **And the strong form.** An event about a retirement would carry a
  // `key_ref` — an environment variable NAME — out of the credential module and
  // into every consumer in the registry, widening the surface 019 T31's six
  // uncovered surfaces are already the problem on. The one place a retirement is
  // announced is the OFFBOARDING RECEIPT (050 §5,
  // `src/providers/credentialOffboarding.ts`), which is addressed to a person and
  // is not a bus message.
  // ---------------------------------------------------------------------------
  {
    table: "shop_credential_version",
    rule:
      "050 §4: an introduction is configuration state with no session in scope, read directly by " +
      "the resolver on every call rather than cached — so an event could only tell a consumer " +
      "something the resolver has already acted on. Its only reader is the credential seam.",
  },
  {
    table: "shop_credential_retirement",
    rule:
      "As `shop_credential_version`. A retirement takes effect by DERIVATION at the next " +
      "resolution (050 §5(a), §9 I7) — there is no sweep to trigger and therefore no event to " +
      "trigger it — and an event about one would carry a key_ref past the credential seam.",
  },

  // ---------------------------------------------------------------------------
  // E03-B06 — THE CONNECTOR LIFECYCLE (053 §5), landed by migration 026. Five
  // tables, under the SAME rule the two above state:
  //
  //   A CREDENTIAL'S LIFE IS NOT A SUBJECT OF THE SESSION EVENT STREAM.
  //
  // The reasoning transfers whole and one line has to be added to it, because a
  // reader will ask: **an uninstall DOES have a consumer** — the draft consumer
  // stops being able to work — and that is precisely why there is no event. The
  // client resolver reads liveness DIRECTLY on every draft
  // (`src/consumers/index.ts`), with no cache, for 050 §12's stated reason, so by
  // the time a poller saw an `app_uninstalled` event the resolver would already
  // have refused. An event here could only ever arrive LATE and tell a consumer
  // something it had already acted on — which is the definition of an event that
  // is a second, weaker copy of a predicate.
  //
  // **And the strong form.** An event about a token version would carry a
  // credential's identity out of the connector module and into every consumer in
  // the registry; an event about a webhook receipt would carry a store's
  // `shop/redact` or `customers/redact` — a privacy request — onto a bus, when
  // 041 §8.4's whole rule is that the log holds references and never personal
  // values. The one place an ending IS announced is the OFFBOARDING RECEIPT
  // (053 §7.3), which is addressed to a person and is not a bus message.
  // ---------------------------------------------------------------------------
  {
    table: "connector_install_state",
    rule:
      "053 §5.1: a CSRF token's issuance, with no session in scope and no scan_session_id. Its " +
      "only reader is the callback that spends it, and it is spent within fifteen minutes of " +
      "being minted — an event about it could not reach a consumer in time to be about anything.",
  },
  {
    table: "connector_install_state_use",
    rule:
      "As `connector_install_state`. The token version it names is written in the SAME " +
      "transaction (053 §5.2), so there is nothing eventual to react to, and the merchant learns " +
      "the outcome from the response to their own redirect rather than from a bus.",
  },
  {
    table: "connector_token_version",
    rule:
      "053 §5.3 / 050 §4: an introduction is configuration state read DIRECTLY by the client " +
      "resolver on every draft, with no cache (050 §12), so an event could only tell a consumer " +
      "something the resolver has already acted on. An event would also carry a credential's " +
      "identity out of the connector module and into every consumer in the registry.",
  },
  {
    table: "connector_token_retirement",
    rule:
      "As `connector_token_version`. A retirement takes effect by DERIVATION at the next draft " +
      "(053 §7.4) — the resolver REFUSES rather than falling back — so an event would arrive " +
      "after the effect it announced.",
  },
  {
    table: "connector_webhook_receipt",
    rule:
      "053 §5.5: Longbox's record that a signed provider message arrived (041 §2.5). Its EFFECT, " +
      "when it has one, is written in the same transaction as the receipt; and three of the four " +
      "topics it records are PRIVACY REQUESTS, so an event would put a `customers/redact` on a " +
      "bus that 041 §8.4 keeps personal values off entirely. E03-B09 reads the table.",
  },

  // ---------------------------------------------------------------------------
  // E04-D01 — THE CATALOG CLUSTER (030 §7, 047 §4–§9), landed by migrations
  // 014/015. Twelve tables, ONE rule, stated once and cited by each row so that a
  // reader does not have to reconstruct it twelve times:
  //
  //   THE CATALOG IS NOT A SUBJECT OF THE SESSION EVENT STREAM.
  //
  // 043 §3.3's catalogue names the nine events one SCAN SESSION produces, and
  // every consumer of them is downstream of a shop's pipeline. A catalog row is
  // the opposite kind of fact: it carries no `shop_id` (030 §2.1), it is written
  // by a batch importer or a catalog author with NO SESSION IN SCOPE, and 029
  // §2.3 requires it to be readable "by a batch importer with no pipeline
  // present". An event about a `vertical_pack` registration or a GCD import batch
  // would have to name a session that does not exist, and `outbox.session_seq` —
  // the column that makes 043 §3.2's within-session delivery ORDER real — would
  // be permanently NULL on every one of them.
  //
  // WHAT WOULD CHANGE THIS, so the rule is falsifiable rather than a shrug: a
  // consumer outside `catalog` that must react to a catalog CHANGE rather than
  // read the catalog on demand. E06-B02's exact-lookup cache is the first
  // candidate, and 047 A2 has already ruled on it — that cache is invalidated
  // TRANSACTIONALLY by inserts into the three lifecycle tables, NEVER by TTL and
  // never by an eventually-delivered event. So the first plausible subscriber is
  // decided AGAINST subscribing, which is why these rows say "no event" rather
  // than "no event yet".
  // ---------------------------------------------------------------------------
  {
    table: "vertical_pack",
    rule:
      "Catalog cluster (E04-D01): a pack registration has no session and no shop. See the " +
      "block comment above — the rule is that the catalog is not a subject of the session " +
      "event stream, and 047 A2 already rules its first plausible subscriber out.",
  },
  {
    table: "vertical_pack_version",
    rule: "Catalog cluster (E04-D01): as vertical_pack. A pack version is a manifest, not an episode.",
  },
  {
    table: "data_source",
    rule:
      "Catalog cluster (E04-D01): a rights row (019 T25) registered by an operator, not " +
      "produced by a session.",
  },
  {
    table: "lcid_registry",
    rule:
      "Catalog cluster (E04-D01): a mint is atomic with the citing catalog row or the " +
      "import-batch fact (047 §4.4). A consumer that wants the LCID reads it through that " +
      "row — the same construction llm_rerank's exclusion uses.",
  },
  {
    table: "collectible_definition",
    rule: "Catalog cluster (E04-D01): a corpus-versioned catalog VALUE with no session and no shop.",
  },
  {
    table: "edition",
    rule: "Catalog cluster (E04-D01): as collectible_definition.",
  },
  {
    table: "edition_signature",
    rule:
      "Catalog cluster (E04-D01): a dedupe lookup row written in the same transaction as its " +
      "edition. Read through the reference.",
  },
  {
    table: "edition_external_id",
    rule:
      "Catalog cluster (E04-D01): a crosswalk edge. Its review workflow is E04-B06's queue, " +
      "which is a QUERY over edges awaiting certification (047 §5.2 item 3) — a derived " +
      "worklist, not a delivered event.",
  },
  {
    table: "lcid_merge",
    rule:
      "Catalog cluster (E04-D01): 047 A2 rules that the one downstream reader of a merge — " +
      "E06-B02's resolution cache — is invalidated TRANSACTIONALLY by this INSERT and never " +
      "by TTL or by an eventually-delivered event. An event here would be the weaker " +
      "mechanism the record refused.",
  },
  {
    table: "lcid_split",
    rule: "Catalog cluster (E04-D01): as lcid_merge. The review obligation it creates is a query (047 §7.3).",
  },
  {
    table: "lcid_split_outcome",
    rule: "Catalog cluster (E04-D01): a child of lcid_split, written in the same transaction.",
  },
  {
    table: "lcid_retirement",
    rule: "Catalog cluster (E04-D01): as lcid_merge.",
  },
  {
    table: "identity_resolution",
    rule:
      "Catalog cluster (E04-D01), and the one SHOP-SCOPED member. It is the catalog's " +
      "statement ABOUT a human_confirmation, written by E06's resolution ladder in the same " +
      "transaction as the confirmation it describes — so a consumer that wants it reads it " +
      "through `longbox.workflow.confirmed`'s reference rather than through a tenth event " +
      "(043 §3.3: the catalogue is AUTHORED, nine names, never generated).",
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

  // ---------------------------------------------------------------------------
  // E03-D14 — THE LONGBOX-ORIGIN DESIGNATION (000-docs/058), landed by migration
  // 032. The identity cluster's rule, at its sharpest:
  //
  //   AN AUTHENTICATION FACT IS NOT A SUBJECT OF THE SESSION EVENT STREAM.
  //
  // A designation names a PERSON and nothing else — no shop, no session, no
  // book — so an event about one would carry an operator identifier past 034
  // §3.3's audited accessor and into every consumer in the registry, and it
  // would carry the single most sensitive fact this schema holds about a
  // colleague: that they are watched. Its only reader is the schema-owner audit.
  // ---------------------------------------------------------------------------
  {
    table: "app_user_origin",
    rule:
      "048 §10.1 / 034 §3.3 / 058 §3: a designation is an authentication-adjacent fact about a " +
      "PERSON with no scan_session_id, and publishing it would tell every consumer which " +
      "colleagues 019 T35(c) watches (T35 non-waivable; 022 P3). Its one reader is " +
      "`pnpm audit:break-glass`, run by the schema owner.",
  },
  {
    table: "app_user_origin_retirement",
    rule:
      "As `app_user_origin`. The ending of a designation is the same kind of fact as the " +
      "designation, and it takes effect by DERIVATION at the next audit run rather than by a " +
      "sweep something would have to trigger.",
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

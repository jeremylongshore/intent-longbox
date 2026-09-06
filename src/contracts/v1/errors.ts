// The v1 error-code registry (042 §4.2, executed by E02-D08).
//
// 042 §4.2 places the registry in `src/contracts/v1/errors.ts` and the envelope
// machinery in the HTTP edge; `src/http/errors.ts` holds the second half and
// re-exports this one, so there is ONE list and two readers (the handler that
// throws, and the OpenAPI emitter that describes).
//
// EACH ENTRY DECLARES FOUR THINGS, exactly as 042 §4.2 requires: its HTTP
// status, whether it is retryable, whether it is operator-renderable, and the
// 021 registered-copy row the CLIENT uses when it is. **The copy row is a
// pointer, never the copy**: 042 §4.3 rules that the server emits no operator
// prose at all, so a string a person reads is selected by the client from
// `code` and lives in 021, not here.
//
// `message` — the developer-facing English that travels in the envelope — is
// NOT written at the throw site. It is a plain string literal in `MESSAGES`
// below, keyed by code, and `LongboxError` takes no message argument at all.
//
// THAT IS A CHANGE OF MECHANISM, NOT OF STYLE, and the reason is that the first
// version could not be checked. When a message was an argument, the guard was a
// regex over `new LongboxError("CODE", "…")` call sites — which sees a
// double-quoted literal and misses a template literal, a concatenation, a
// variable and every `envelope()` call site. **A guard that a refactor can walk
// out of is not a guard.** With one keyed map the check is total by
// construction: the map IS the set of strings the server can emit, so
// `tests/contract/server-emits-no-operator-copy.test.ts` scans a closed list
// rather than hoping its pattern matched every writer, and a lint asserts no
// handler passes a message at all.
//
// Context that used to live in a bespoke message goes in `details`, which is
// structured and typed — which is where 042 §4.1 puts it anyway.
//
// ADDING A CODE IS ADDITIVE and stays within `v1` (042 §2.3). CHANGING a code's
// status or meaning is a `v2` change, and **a retired code is retired forever**
// (042 §4.2) — never reused with a new meaning.

export interface ErrorCodeSpec {
  /** The HTTP status this code maps to. Changing it is a `v2` change (042 §2.3). */
  readonly status: number;
  /**
   * 042 §4.4: a fact the server knows and states, never an inference the client
   * re-derives from the status. Two 409s disagree — `STALE_WORLD_VIEW` is not
   * retryable (someone else won; a person must resolve it) and
   * `WRITE_CONFLICT_RETRY_EXHAUSTED` is (nobody won yet).
   */
  readonly retryable: boolean;
  /**
   * Whether the CLIENT may show a person something for this code. It never means
   * "render `message`" — it means "select 021 copy from `code`".
   */
  readonly operatorRenderable: boolean;
  /** The 021 registered-copy row a client selects when `operatorRenderable`. */
  readonly copyRow: string | null;
  /** Why the code exists: the §1 finding or ratified rule it implements. */
  readonly implements: string;
}

export const ERROR_CODES = {
  VALIDATION_FAILED: {
    status: 400,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements: "042 §4.2 — the eleven Zod flatten() sends (E9); the flatten output moves to `details`",
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    status: 400,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements:
      "042 §5.1 — 'Every mutating route REQUIRES an Idempotency-Key header'. The registry is " +
      "designed to grow (042 §14) and a required header with no code for its absence would be a " +
      "requirement no client could diagnose.",
  },
  PHOTO_FIELD_REQUIRED: {
    status: 400,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements:
      "042 §3.1 R4 — the multipart file field, previously `{error:'multipart file field required'}`",
  },
  SHOP_NOT_FOUND: {
    status: 404,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements: "042 §4.2 — routes:96",
  },
  SESSION_NOT_FOUND: {
    status: 404,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements: "042 §4.2 — the seven `scan session not found` sends",
  },
  PHOTO_NOT_FOUND: {
    status: 404,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements:
      "046 §6 Q5 / E03-D05 — the photo-fetch route. It is 404 and NEVER 403, deliberately: 019 " +
      "T24 signs cross-tenant access at zero, and a 403 would confirm that a photo id exists in " +
      "some other shop. A photo belonging to another shop, to another session, or whose bytes " +
      "are missing are ONE answer from outside.",
  },
  ROUTE_NOT_FOUND: {
    status: 404,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements:
      "042 §4.5 / I10 — Fastify's default 404 is its own shape, and I10 drives EVERY route into " +
      "every failure it can produce. An unrouted path is one of them.",
  },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements:
      "042 §4.5 — `FST_INVALID_MULTIPART_CONTENT_TYPE`, which Fastify answers 406. The registry " +
      "states 415: the condition is that the request's media type is not one the route accepts, " +
      "and a framework's status is not a contract. Adding the code is additive under §2.3.",
  },
  PHOTO_TOO_LARGE: {
    status: 413,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string (042 §4.5)",
    implements: "042 §4.5 — routes:44-49's accidental envelope (E8), now deliberate",
  },
  /**
   * E03-B07. The bytes are not one of the three accepted image types.
   *
   * 415 and NOT 400: the request is well-formed, and the condition is exactly
   * what 415 names — the payload's media type is not one this route accepts.
   * It is a SIBLING of `UNSUPPORTED_MEDIA_TYPE` rather than a reuse, because
   * that code means "this route takes multipart/form-data" and this one means
   * "the FILE inside your multipart body is not a JPEG, PNG or WebP". A client
   * that cannot tell them apart cannot tell a person which thing to fix.
   *
   * The verdict comes from the MAGIC BYTES. A caller who declares `image/png`
   * and sends a PDF, an SVG or an HTML document lands here whatever the
   * `Content-Type` part said (046 E6).
   */
  UNSUPPORTED_IMAGE_TYPE: {
    status: 415,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string (a re-take, not a retry)",
    implements: "046 E6 / G-5 — the type is detected, never declared",
  },
  /**
   * E03-B07. The bytes ARE one of the three types and the container is not
   * valid: a chunk or segment outside the closed allowlist, a second document
   * appended after the terminator (the polyglot), a truncated structure, or an
   * animated WebP.
   *
   * 422 and not 400: the syntax of the REQUEST is fine — the multipart parse
   * succeeded, the fields validated — and it is the CONTENT that cannot be
   * processed, which is the distinction 422 exists to make.
   */
  MALFORMED_IMAGE: {
    status: 422,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string (a re-take, not a retry)",
    implements: "046 G-5 — container walk against a closed allowlist; no trailing bytes",
  },
  /**
   * E03-B07. The header declares more pixels than the ceiling allows — the
   * decompression bomb, refused from the header by arithmetic with no decoder
   * ever asked to open the file. 422 for the same reason as `MALFORMED_IMAGE`:
   * the request is well-formed and its content is not processable.
   */
  IMAGE_DIMENSIONS_TOO_LARGE: {
    status: 422,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "046 §5 / G-5 — the pixel ceiling is a PROVISIONAL floor (src/services/media.ts)",
  },
  /**
   * E03-B07. A per-session or per-shop storage ceiling is already reached.
   *
   * 409 and not 429: 429 is a RATE, and retrying later is the honest advice it
   * carries. This is a STATE — a session or a shop holding more photographs
   * than the policy allows — and it does not clear by waiting; it clears when
   * the retention sweep (E03-B09) or an operator removes something. `details`
   * carries `{scope, limit_kind}` so a client can say which, without the server
   * writing prose.
   */
  PHOTO_QUOTA_EXCEEDED: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "046 §4 B4 — 'no per-tenant quota'; the ceilings are PROVISIONAL floors",
  },
  SHOP_HAS_NO_PRICING_POLICY: {
    status: 409,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements: "042 §4.2 — routes:319",
  },
  SESSION_HAS_NO_CONFIRMATION: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "042 §4.2 — routes:367",
  },
  SESSION_HAS_NO_PRICING: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "042 §4.2 — routes:371",
  },
  SESSION_HAS_NO_CONDITION: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "042 §4.2 / 040 F6 — a draft with no condition is refused. NOT WIRED by E02-D08",
  },
  CONTRADICTION_BLOCKS_ONE_TAP: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 C3 — the contradiction sentence",
    implements: "042 §4.6 / 040 F3 / locked decision 7",
  },
  /**
   * E06-D01, under 040 v1.3.0 F3.
   *
   * F3 keyed the one-tap refusal on `llm_rerank.contradiction`, which was right
   * while the contradiction verdict was the only thing that could take a band
   * off `high`. It is now one of five ceilings, so a payload with NO evidence and
   * NO contradiction derives `low` and would still have passed a
   * contradiction-only check. The refusal now keys on the BAND — the server's
   * own conclusion — and this code names the causes that are not a contradiction:
   * absent evidence, a disagreeing barcode, an ambiguous candidate set, an
   * unsure model, or no re-rank at all.
   *
   * It is a SIBLING rather than a widening of `CONTRADICTION_BLOCKS_ONE_TAP`
   * because 021 C3's registered copy is specifically the contradiction sentence —
   * "something on the cover disagrees" is the wrong thing to tell an operator
   * when the truth is "we could not read enough of the cover to be sure".
   */
  ONE_TAP_NOT_CORROBORATED: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string (NOT C3: this is not a contradiction)",
    implements: "042 §4.6 / 040 v1.3.0 F3 / locked decision 7",
  },
  STALE_WORLD_VIEW: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes 040 A9's 'Someone else answered this one.'",
    implements: "042 §6 / 040 §5.1 — the second device",
  },
  SESSION_IS_TERMINAL: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "042 §4.2 / 040 I5 — nothing follows a `voided` transition",
  },
  BLOCKED_BY_RETENTION_HOLD: {
    status: 409,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements: "042 §4.2 / 040 G-c / 022 P7 Q6. NOT WIRED by E02-D08 — no hold table exists (E13/E03)",
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements: "042 §5.4 — same key, different request hash",
  },
  IDENTIFY_FAILED: {
    status: 502,
    retryable: true,
    operatorRenderable: true,
    copyRow: "021 C3 — the manual-search path",
    implements: "042 §4.2 — routes:192, and the 502 stops being a success body (E10)",
  },
  IDENTIFY_PROVIDER_UNAVAILABLE: {
    status: 503,
    retryable: true,
    operatorRenderable: true,
    copyRow: "021 C3 — the manual-search path",
    implements: "042 §4.2 — routes:182, and the adapter's exception message stops being the body (E10)",
  },
  // -------------------------------------------------------------------------
  // E03-D09 (048 §6.5, §9.3). THREE CODES, AND NO FORBIDDEN CODE (048 E10, §6.5).
  //
  // A distinct "you may not access this shop" answer would confirm the shop
  // exists, which is an enumeration oracle over exactly the table `GET
  // /api/v1/shops` enumerates today — and 019 T24 signs cross-tenant access at
  // zero, NON-WAIVABLE. **A wrong tenant keeps answering `SHOP_NOT_FOUND`, with
  // no `details`**, byte-identical to a shop id that was never issued. The cost is
  // stated: an operator who mistypes a shop id gets "no shop with that id" rather
  // than "you are not a member of that shop", and a support conversation is
  // cheaper than an oracle.
  //
  // The three below are about the CALLER's own state, which the caller already
  // knows, so none of them tells anybody anything they could not already see.
  // -------------------------------------------------------------------------
  SESSION_REQUIRED: {
    status: 401,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "048 §6.1 / I1 — every route not on the AUTH allowlist refuses an anonymous request. It is " +
      "also the answer to a REFUSED cookie (unknown, revoked, expired, reused, mismatched pair) " +
      "and to a cross-site-shaped request (§5.1's Sec-Fetch-Site check), and that sameness is " +
      "the point: §9.3 requires every failure at this boundary to answer the same thing, so a " +
      "caller cannot tell a stolen cookie from a missing one from a cross-site attempt.",
  },
  OPERATOR_REQUIRED: {
    status: 401,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "048 §3.5 / R8 / I1 — a live DEVICE session with no live OPERATOR session reaches exactly " +
      "the operator picker and the shops route, and every other route refuses it. Distinct from " +
      "SESSION_REQUIRED because the ACTION differs and the client must be able to choose it " +
      "without parsing prose: this one means 'tap your name', that one means 'this phone is not " +
      "signed in to a shop'.",
  },
  INVITATION_REFUSED: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "048 §7.1a (E03-D11) — the shop already holds the maximum number of outstanding " +
      "invitations. **Distinct from INVITATION_INVALID, and the pair is the same distinction " +
      "PIN_REFUSED and PIN_INVALID draw**: INVITATION_INVALID answers a credential TEST and is " +
      "deliberately indistinguishable across every cause (048 §9.3), while this answers a fact " +
      "about the caller's OWN shop that the caller may act on — let one expire, or have it " +
      "redeemed. It carries no `details` and in particular no count, because how many codes are " +
      "outstanding is not a number a refusal needs to publish.",
  },
  ENROLLMENT_CODE_REFUSED: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "048 §7.1a / §7.3 (E03-D11) — the enrollment code was not issued. **ONE code for two " +
      "causes, deliberately**: the shop's outstanding-code ceiling is reached, OR the location " +
      "named is not this shop's. Separating them would make the route an oracle over which " +
      "location ids exist, which is 019 T24's boundary reached through a 409 instead of a 404 — " +
      "and a caller who holds a privileged session at this shop already knows its own locations, " +
      "so the merge costs them nothing.",
  },
  PRIVILEGED_SESSION_REQUIRED: {
    status: 401,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "048 §4.1 / §12.4 row 3a (E03-D11) — the route requires a session established by password " +
      "AND a second factor, and the caller presented none. **Distinct from SESSION_REQUIRED and " +
      "from OPERATOR_REQUIRED for OPERATOR_REQUIRED's own stated reason: the ACTION differs and " +
      "the client must be able to choose it without parsing prose.** This one means 'sign in with " +
      "your password and your authenticator'; OPERATOR_REQUIRED means 'tap your name'; " +
      "SESSION_REQUIRED means 'this phone is not signed in to a shop'. It is deliberately NOT the " +
      "answer to a WRONG password or a wrong code — every credential test on the sign-in route " +
      "answers SESSION_REQUIRED, because 048 §9.3 requires a credential boundary to answer the " +
      "same thing however it failed, and this code is a statement about the SHAPE of the request " +
      "rather than about a secret the caller submitted.",
  },
  FRESH_SECOND_FACTOR_REQUIRED: {
    status: 403,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "057 §4.4b (E03-D11, the security lens's F1), WIDENED BY E03-D24 to a CLASS of acts " +
      "(063 §3.3, §3.4). ⚠ **THIS CODE NO LONGER MEANS ONLY 'you named an owner'**: three acts now " +
      "re-present the factor rather than inheriting it — naming a second OWNER, REPLACING a " +
      "password, and REPLACING a live second factor — and the rule that puts an act in the class is " +
      "one sentence: the damage OUTLIVES the session it was done from, so 048 §4.1's freshness " +
      "window (which 057 §4.3 makes the session's own absolute expiry) does not bound it. A " +
      "membership is permanent; a replaced password locks the person out until somebody with " +
      "database access intervenes; a replaced authenticator does the same to the second factor. " +
      "The original act, and the sentence that argued it: the act names a second OWNER, and that is the " +
      "one privileged act whose damage the session's expiry does not bound: the membership is " +
      "PERMANENT and carries the power to grant it again, so a copied cookie spent here outlives " +
      "every session in the system. 048 §4.1's freshness window is therefore re-presented rather " +
      "than inherited — a code from the person's own authenticator, in the request. **ONE code for " +
      "an absent factor and for a wrong one**, and that sameness is not §9.3's constant-answer rule " +
      "arriving somewhere new: the caller already holds a privileged session, so nothing about who " +
      "exists is disclosed either way, and the merge is here because 'you did not send a code' and " +
      "'that code was not accepted' lead to the same next action. It carries no `details` and in " +
      "particular no retry-after, for PIN_INVALID's reason.",
  },
  MFA_REENROLLMENT_REQUIRED: {
    status: 403,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "048 §8.1 (E03-D11) — the person used a RECOVERY CODE, which retires the authenticator it " +
      "substituted for in the same transaction, so the session they now hold *'can reach NOTHING " +
      "else until it has'* enrolled a new second factor. It is a PREDICATE over facts and not a " +
      "flag: `mfaState` reads 'no live authenticator, and a recovery-code use exists', so the " +
      "state cannot be left stale and cannot be escaped by anything except an enrollment. **THE " +
      "ENROLLMENT ROUTE NOW EXISTS AND THIS CODE'S MEANING CHANGED WITH IT** (E03-D24, 063 §3.4): " +
      "the session may reach `POST /api/v1/authenticators/offers`, `POST /api/v1/authenticators` " +
      "and its own sign-out, and nothing else — a CLOSED set the route table declares row by row " +
      "(`reachableWhileReenrolling`) rather than a condition somebody has to remember. So the " +
      "code means 'enrol a new second factor, here, now' and a screen may promise the button. " +
      "The state still lifts BY PREDICATE and never by a mutation: `mfaState` reads the new " +
      "authenticator on the next request and the gate is simply no longer true. 000-docs/057 §9 " +
      "R2 is discharged by that route; the CLI remains as break-glass and as the ONLY path for a " +
      "FIRST enrolment, which no privileged session can reach (063 §5 R1).",
  },
  PERMISSION_DENIED: {
    status: 403,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "E03-B03 / 054 §3.3 — the caller holds a live membership at this shop and their role does " +
      "not carry the permission the route requires. **403 and not 404, and the difference is " +
      "argued rather than defaulted**: a tenancy refusal must be indistinguishable from absence " +
      "(019 T24, 048 §6.5) because it would otherwise tell a stranger which shops exist, whereas " +
      "a ROLE refusal tells the caller a fact about their own membership that they can already " +
      "read off their own screen. The refusal that could leak — the wrong LOCATION, or a " +
      "location-scoped grant against a shop-scoped permission — is deliberately NOT this code: " +
      "it answers SHOP_NOT_FOUND, byte-identically to a shop that was never issued.",
  },
  PIN_INVALID: {
    status: 401,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "048 §9.1 / §9.3 — ONE code for every PIN outcome that is not success: an unknown pair, a " +
      "retired PIN, a wrong PIN, and a pair still inside its growing lockout delay. It carries " +
      "NO `details` and, in particular, no retry-after: the delay is real (§9.1, R5) and " +
      "publishing it would tell a caller that THIS pair has recent failures, which is a " +
      "per-operator fact leaking out of an authentication boundary (022 P3). The delay is " +
      "enforced by refusing until it passes, which is what R5's 'refused UNTIL' means.",
  },
  PIN_REFUSED: {
    status: 400,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "048 §3.5 (E03-D07) — the PIN POLICY, refused at SET time and never at verify time. Distinct " +
      "from PIN_INVALID and the distinction is the whole reason it exists: PIN_INVALID answers a " +
      "credential TEST and is deliberately indistinguishable across every cause (§9.3), while this " +
      "answers a value the caller just invented and discloses nothing about this system — no " +
      "person, no device, no code, no shop. It carries NO `details`: naming which rule the chosen " +
      "PIN broke would publish the denylist, and 048 §3.5 keeps that check at set time precisely " +
      "so a verify-time attacker cannot learn which PINs are impossible.",
  },
  CREDENTIAL_REFUSED: {
    status: 400,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "057 §4.1 / 063 §3.3 (E03-D24) — the PASSWORD POLICY, refused at SET time, and PIN_REFUSED's " +
      "twin one factor up: it answers a value the caller just invented and discloses nothing about " +
      "this system — no person, no shop, no credential. The only rule is a MINIMUM LENGTH, because " +
      "048 §3.5 fixes the PIN's shape and says nothing at all about a password's composition, and " +
      "057 §4.1 refuses to invent a composition rule that shortens real passwords and lengthens " +
      "nobody's. It carries NO `details`: the floor is in the client's own copy, and returning " +
      "'you need N characters' from a credential route is a rule published one refusal at a time.",
  },
  CREDENTIAL_ALREADY_SET: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "063 §3.3 (E03-D24) — `POST /api/v1/credentials` provisions a FIRST password and never " +
      "replaces one. **The refusal exists because of who can reach that route**: it runs on an " +
      "operator session, which 048 §3.5 states plainly is NOT non-repudiable — a coworker who " +
      "watches a PIN can open it — so a route that could overwrite a live password would let that " +
      "coworker lock an owner out of the privileged surface. Replacing a password is " +
      "`POST /api/v1/credentials/rotations`, which needs the privileged session and a fresh code. " +
      "**409 and not 403, and separate from CREDENTIAL_REFUSED**: the caller is not forbidden and " +
      "the value they chose is not wrong — the world is not in the state the act assumes, and the " +
      "next action differs (042 §4.3: a client must be able to choose the recovery without " +
      "parsing prose). The DISCLOSURE is stated rather than glossed: it tells the caller that the " +
      "person whose operator session they hold already has a password. That is a fact about the " +
      "identity they just authenticated as, not about a stranger, and the alternative — a 201 that " +
      "wrote nothing — is a screen that lies.",
  },
  AUTHENTICATOR_ENROLLMENT_REFUSED: {
    status: 400,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "048 §4.3 / 063 §3.4 (E03-D24) — ONE answer for every way an enrolment can fail that is not " +
      "a missing factor: a ticket that has expired, a ticket that does not authenticate (a wrong " +
      "ring version, an edited byte, or one minted for a DIFFERENT PERSON — 048 R18's AAD binding " +
      "doing its job), a confirmation code that does not verify against the secret inside it, and " +
      "a person whose live roles do not include one of 048 §4.1's three. NO `details`, on " +
      "PIN_REFUSED's reasoning: every cause leads to the same next action — ask for a new secret " +
      "and scan it again — and distinguishing them would tell a caller holding a ticket which " +
      "half of it the server disliked.",
  },
  INVITATION_INVALID: {
    status: 401,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "048 §7.1a / §9.3 (E03-D07) — ONE code for every invitation-redemption outcome that is not " +
      "success: an unknown code, a spent one, an expired one, one naming a DIFFERENT SHOP than the " +
      "device this phone is enrolled at (R15, and 019 T24's non-waivable line), the loser of a " +
      "concurrent redemption refused by `UNIQUE (invitation_id)`, and a shop still inside its " +
      "per-shop redemption delay. NO `details`: a helpful answer here is a query interface over " +
      "which codes exist and which shop each belongs to.",
  },
  ENROLLMENT_CODE_INVALID: {
    status: 401,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "048 §7.3 / §9.3 (E03-D07) — the same constant answer for a device-enrollment redemption: " +
      "unknown, spent, expired, inside the shop's delay, or the loser of a concurrent redemption " +
      "refused by `UNIQUE (code_id)`. SEPARATE from INVITATION_INVALID because the two are reached " +
      "from different screens by different people — a phone being enrolled by an owner, and an " +
      "employee joining on a phone that already exists — and the client must be able to choose " +
      "which recovery to offer without parsing prose (042 §4.3). Neither code discloses which of " +
      "its causes fired.",
  },
  /**
   * E03-B06 (053 §8.3). The ONE answer every install-callback refusal produces.
   *
   * `CallbackRefusal` in `src/services/connectors/shopify/api.ts` distinguishes
   * ten causes and NONE of them reaches the wire, on 048 §9.3's constant-answer
   * reasoning applied one connector over: a caller who could tell `unknown_state`
   * from `state_expired` from `domain_mismatch` would hold an oracle over which
   * install states exist, and one who could tell `bad_signature` from
   * `scope_excessive` would learn whether their forged signature was the thing
   * that failed. `details` is empty for the same reason.
   *
   * **400 and not 401.** The caller is a merchant's browser mid-redirect, not a
   * principal that could authenticate: there is no credential to supply and no
   * `WWW-Authenticate` that would mean anything. What failed is the REQUEST —
   * its signature, its state or its grant — which is what 400 names.
   */
  CONNECTOR_CALLBACK_REFUSED: {
    status: 400,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements:
      "000-docs/053 §8.3 — one constant answer for every OAuth-callback refusal. NOT operator " +
      "renderable: the reader of this response is a browser at the end of a provider redirect, " +
      "and the person's next step is the operator console the install was started from, not a " +
      "string on a page nobody designed.",
  },
  /**
   * E03-B06 (053 §8.2). A webhook whose HMAC did not verify.
   *
   * **401, and it is a provider requirement as well as the right code.** Shopify
   * expects an unauthenticated webhook to be refused with 401 on the mandatory
   * compliance topics; answering 200 to a bad signature is how an app passes a
   * review it should fail. The refusal happens BEFORE any row is read or
   * written, so a forged message costs one HMAC and leaves no trace.
   */
  WEBHOOK_SIGNATURE_INVALID: {
    status: 401,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements:
      "000-docs/053 §8.2; 046 §5 A13 (a forged webhook) — the surface that did not exist when 046 " +
      "was written. No `details`: an unsigned caller learns nothing about which header, which " +
      "topic or which store would have been accepted.",
  },
  RATE_LIMITED: {
    status: 429,
    retryable: true,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "042 §8.2 — the ordinary class only; the METERED class degrades to manual (§8.3). THREE KEYS " +
      "share this code and the message names none of them: the shop (042 §8.1), the device and the " +
      "route itself (048 R14, E03-D09 — `POST /api/v1/device-sessions` is bucketed before any " +
      "session exists, so there is no shop to name). `message` is developer English no client " +
      "renders (§4.3); naming the key in it would be both wrong on two of the three paths and a " +
      "statement about WHICH bucket fired, which is closer to a per-operator surface than a " +
      "developer needs (019 T35).",
  },
  WRITE_CONFLICT_RETRY_EXHAUSTED: {
    status: 409,
    retryable: true,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "042 A6 — the transaction exhausted `tx_max_retries` on 40001 or 40P01. Distinct from " +
      "STALE_WORLD_VIEW: this one means NOBODY won yet, that one means SOMEONE ELSE won.",
  },
  INTERNAL_ERROR: {
    status: 500,
    retryable: true,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "042 §4.2 — today an unhandled throw, serialized by Fastify",
  },
} as const satisfies Record<string, ErrorCodeSpec>;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * The developer-facing message for each code — the COMPLETE set of strings this
 * server can put in an error body. Never rendered to an operator (042 §4.3): a
 * person's screen selects 021 registered copy from `code`.
 *
 * Every entry is a plain literal, so the guard can read them all. No model name,
 * no provider id, no percentage, no cost, no second person, and nothing
 * interpolated from a request — a reflected URL or a provider's exception text
 * is exactly the class of leak 042 E10 and E12 recorded.
 */
export const MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "the request body or path parameters failed schema validation",
  IDEMPOTENCY_KEY_REQUIRED: "a non-empty Idempotency-Key header is required on every mutating route",
  PHOTO_FIELD_REQUIRED: "a multipart file field is required",
  SHOP_NOT_FOUND: "no shop with that id",
  SESSION_NOT_FOUND: "no scan session with that id in this shop",
  PHOTO_NOT_FOUND: "no photo with that id in this session",
  ROUTE_NOT_FOUND: "no route matches this request",
  UNSUPPORTED_MEDIA_TYPE: "this route accepts multipart/form-data only",
  PHOTO_TOO_LARGE: "the uploaded file exceeds the configured multipart limit",
  UNSUPPORTED_IMAGE_TYPE: "the uploaded bytes are not a jpeg, png or webp image",
  MALFORMED_IMAGE: "the uploaded image is not a well-formed file of its own type",
  IMAGE_DIMENSIONS_TOO_LARGE: "the uploaded image declares more pixels than the configured ceiling",
  PHOTO_QUOTA_EXCEEDED: "a photo storage ceiling for this session or shop is already reached",
  SHOP_HAS_NO_PRICING_POLICY: "this shop has no pricing policy row",
  SESSION_HAS_NO_CONFIRMATION: "this session has no current human_confirmation",
  SESSION_HAS_NO_PRICING: "this session has no current pricing_snapshot",
  SESSION_HAS_NO_CONDITION: "this session has no current condition_assessment",
  CONTRADICTION_BLOCKS_ONE_TAP:
    "the driving re-rank carries a contradiction; a one-tap confirmation is refused",
  ONE_TAP_NOT_CORROBORATED:
    "the driving re-rank did not reach the high band; a one-tap confirmation is refused",
  STALE_WORLD_VIEW: "the referenced record is no longer this session's current world",
  SESSION_IS_TERMINAL: "this session is terminal and takes no further records",
  BLOCKED_BY_RETENTION_HOLD: "an open retention hold blocks this write",
  IDEMPOTENCY_KEY_REUSED: "this idempotency key was already used for a different request body",
  IDENTIFY_FAILED: "the vision provider returned no usable answer",
  IDENTIFY_PROVIDER_UNAVAILABLE: "no vision provider is configured for this shop",
  SESSION_REQUIRED: "this route requires a session and none resolved",
  OPERATOR_REQUIRED: "this route requires the second of the two session chains",
  PRIVILEGED_SESSION_REQUIRED: "this route requires a session established by password and a second factor",
  INVITATION_REFUSED: "this shop has the maximum number of outstanding invitations",
  ENROLLMENT_CODE_REFUSED: "the enrollment code was not issued",
  MFA_REENROLLMENT_REQUIRED: "this session may only enrol a new second factor",
  FRESH_SECOND_FACTOR_REQUIRED: "this act requires a fresh second-factor code in the request",
  PERMISSION_DENIED: "the role held at this shop does not carry the permission this route requires",
  PIN_INVALID: "the submitted credential was not accepted",
  PIN_REFUSED: "the chosen PIN does not satisfy the PIN policy",
  CREDENTIAL_REFUSED: "the chosen password does not meet the minimum length",
  CREDENTIAL_ALREADY_SET: "this person already has a password; replace it in a privileged session",
  AUTHENTICATOR_ENROLLMENT_REFUSED: "the enrollment offer or its confirming code was not accepted",
  INVITATION_INVALID: "the submitted invitation code was not accepted",
  ENROLLMENT_CODE_INVALID: "the submitted enrollment code was not accepted",
  CONNECTOR_CALLBACK_REFUSED: "the connector authorization callback was not accepted",
  WEBHOOK_SIGNATURE_INVALID: "the request signature did not verify",
  RATE_LIMITED: "a provisional rate floor was exceeded for the key this route is bucketed on",
  WRITE_CONFLICT_RETRY_EXHAUSTED: "a write conflict survived the transaction retry budget",
  INTERNAL_ERROR: "an unhandled error occurred",
};

export const ERROR_CODE_NAMES = Object.keys(ERROR_CODES) as ErrorCode[];

export function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}

/** The wire shape of every non-2xx response, in every version (042 §4.1). */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    /** Developer-facing English. NEVER rendered to an operator (042 §4.3). */
    message: string;
    /** Structured and code-specific; never free prose (042 §4.1). */
    details: Record<string, unknown>;
    /** 034 §3.1's spelling, not a second one (042 §4.7). */
    correlation_id: string;
    /** 042 §4.4 — what a client and the offline queue may do next. */
    retryable: boolean;
  };
}

/**
 * A failure with a registry code. Every handler and every service throws one of
 * these instead of composing a body, so the envelope has exactly one author.
 *
 * It lives beside the registry rather than in the HTTP edge so a SERVICE can
 * refuse in the contract's vocabulary without importing Fastify — the staleness
 * check (§6) and the idempotency replay (§5) both refuse from inside a
 * transaction, several layers below a reply.
 */
export class LongboxError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  /**
   * **There is no message parameter, deliberately.** The message is the
   * registry's; anything a caller wants to add is structured and goes in
   * `details`. A handler that could pass a string is a handler that can leak one.
   */
  constructor(code: ErrorCode, details: Record<string, unknown> = {}) {
    super(MESSAGES[code]);
    this.name = "LongboxError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_CODES[this.code].status;
  }

  get retryable(): boolean {
    return ERROR_CODES[this.code].retryable;
  }
}

export function envelope(
  code: ErrorCode,
  correlationId: string,
  details: Record<string, unknown> = {}
): ErrorEnvelope {
  return {
    error: {
      code,
      message: MESSAGES[code],
      details,
      correlation_id: correlationId,
      retryable: ERROR_CODES[code].retryable,
    },
  };
}

// The connector token's CUSTODY and LIFECYCLE: where the value lives, how a
// version is introduced, when it is live, how it ends, and what the receipt for
// its ending may say.
//
// Bead: longbox-e5b.3.6 (alias E03-B06). Docs: 000-docs/053 §3 (the custody
// ruling and the two predicates it turns on), §5 (the tables), §7 (the
// lifecycle); 050 §2 Q1/Q2/Q3 (the ruling this one is DIFFERENT from, and the
// rotation idiom it borrows whole), §4, §5, §8's G-14 row; 048 §4.2 / R18 (the
// AEAD envelope); 041 §8 (an ending is an appended fact and its receipt), §8.2
// (a receipt may not contain a false statement); 018 (an unverified third-party
// act is not a fact); CLAUDE.md locked decisions 2 and 4.
//
// ============================================================================
// ONE SENTENCE
// ============================================================================
//
// A connector token version is LIVE when it has an introduction row and no
// retirement row; the newest live version for a `(shop, connector)` is the one
// that authorises a call; and that is computed at read time, every time, from
// two tables — never from a status column and never from a cache.
//
// ============================================================================
// WHY THE VALUE IS IN A COLUMN HERE AND IS FORBIDDEN IN ONE NEXT DOOR
// ============================================================================
//
// 050 §2 Q1 rejects an encrypted column for a BYOK provider key and CLOSES that
// question. This module does not reopen it. 050 §13 item 3 hands the connector
// token's lifecycle to this bead explicitly, and 053 §3 rules on it against two
// predicates a BYOK key fails:
//
//   (i)  the value is MINTED BY THE MACHINE — it exists first inside an HTTP
//        response from Shopify, so the SOPS→tmpfs→environment path 050 §3 rules
//        for a key a person types cannot carry it without a human reading a
//        secret off a screen;
//   (ii) it is REVOCABLE AT ITS ISSUER without a Longbox act — an uninstall
//        kills it at Shopify — which defuses 050's decisive ground, the
//        Object-Lock backup that a revocation cannot reach. A ciphertext in a
//        30-day immutable copy is a ciphertext of a credential that is already
//        dead. 050 says the opposite of the BYOK key in as many words: *"the
//        only complete revocation is at the provider and it is the shop's act"*.
//
// ⚠ THE SCOPE OF (ii) IS NARROWER THAN IT READS, AND v1.0.1 SAYS SO HERE RATHER
// THAN ONLY IN THE RECORD (the security lens's S2). An uninstall is the
// MERCHANT's act. Until one happens, an offline token in the wrong hands works
// for as long as nobody looks — so predicate (ii) describes what is available
// at the END of a relationship and NOT a kill switch Longbox holds during one.
// `revokeAtProvider` in `./api.ts` is the nearest thing to one, and what it
// produces is an OBSERVATION rather than a fact about Shopify's state.
//
// ⚠ AND THE RESIDUAL IS NARROWER STILL (S1). The first version of this comment
// said this encryption defends "the database or a backup". **The backup half was
// not shown and is not true of the estate as it stands**: the borg include set
// carries `/etc` — where the age key lives — and the database dump in the SAME
// archive, so one archive can hold the ciphertext, the SOPS source of the ring
// and the key that opens it, for the Object-Lock window. **The honest scope is a
// stolen DATABASE DUMP IN ISOLATION.** Separating the two is E13-D01
// (`longbox-e5b.13.11`). The counterweight 050 §2 Q3 supplies is real and is not
// a rebuttal: a BYOK key sits in every SOPS revision and every backup too, so
// the column loses nothing on backup exposure and gains a destruction primitive
// the variable does not have. Lens S's dissent is preserved verbatim in 053 §14,
// and the sentence "the token is encrypted" may never mean more than this
// paragraph says (021 B15/B16).
//
// ============================================================================
// WHAT THIS MODULE NEVER DOES
// ============================================================================
//
// It never logs a token, never returns one in an error, never puts one in a
// receipt, and never derives anything printable from one — no prefix, no
// last-four, no digest offered as a "hint". `tests/contract/secret-surfaces.test.ts`
// plants a canary inside a real token, seals it with the real function and greps
// every surface, which is the assertion 050 §9 I1 specifies: on the VALUE, never
// on a redaction rule.
import { randomUUID } from "node:crypto";
import {
  AeadOpenError,
  AUTHENTICATOR_KEY_BYTES,
  open as aeadOpen,
  seal as aeadSeal,
  type AuthenticatorKeyring,
} from "../../auth/aead.js";
import type { Queryable } from "../../../db.js";

/**
 * The connector key ring.
 *
 * A TYPE ALIAS rather than a second shape: the envelope is 048 R18's, unchanged,
 * so reusing its primitives is the point — one implementation of AES-256-GCM in
 * this repository, tested once, with two rings under two names.
 */
export type ConnectorKeyring = AuthenticatorKeyring;

/** `LONGBOX_CONNECTOR_KEY_V<n>` — the name of the connector key at version `n`. */
export function connectorKeyEnv(version: number): string {
  return `LONGBOX_CONNECTOR_KEY_V${String(version)}`;
}

const KEY_ENV_PATTERN = /^LONGBOX_CONNECTOR_KEY_V([1-9][0-9]?)$/;

/** Thrown at boot when the connector key is absent, malformed, or the wrong length. */
export class ConnectorKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorKeyError";
  }
}

/** Thrown when a connector token cannot be resolved, and the reason is not "absent". */
export class ConnectorTokenRefusedError extends Error {
  readonly code = "CONNECTOR_TOKEN_REFUSED";
  constructor(message: string) {
    super(message);
    this.name = "ConnectorTokenRefusedError";
  }
}

/**
 * **The server does not serve without a connector key.**
 *
 * Fail-closed and unconditional, exactly as `requireAuthenticatorKey` and
 * `requirePinPepper` are, and for their reason: a check that only bites in
 * production is a check no developer ever sees fail. There is no plaintext mode
 * and no generate-on-boot mode — a ring minted at startup would seal every
 * install made in that process and open none of them after a restart, which is a
 * subsystem that appears to work and silently disconnects every shop.
 *
 * **It is a SEPARATE ring from the authenticator's, and that is a decision.**
 * Sharing one key would mean one compromise is two compromises, and would make
 * the one destruction Longbox can actually perform — destroying a key version so
 * that a stored ciphertext can never be opened again (041 §8.3's pattern) — an
 * act that also takes every owner's second factor with it.
 */
export function requireConnectorKey(env: NodeJS.ProcessEnv = process.env): ConnectorKeyring {
  const keys = new Map<number, Buffer>();
  for (const [name, raw] of Object.entries(env)) {
    const match = KEY_ENV_PATTERN.exec(name);
    if (!match || raw === undefined || raw.length === 0) continue;
    const key = Buffer.from(raw.trim(), "base64");
    if (key.length !== AUTHENTICATOR_KEY_BYTES) {
      throw new ConnectorKeyError(
        `${name} decodes to ${String(key.length)} bytes; AES-256-GCM needs exactly ` +
          `${String(AUTHENTICATOR_KEY_BYTES)}. Generate one with \`openssl rand -base64 32\` and ` +
          `put it in SOPS. (The value is never printed by this process, here or anywhere else.)`
      );
    }
    keys.set(Number(match[1]), key);
  }

  if (keys.size === 0) {
    throw new ConnectorKeyError(
      `${connectorKeyEnv(1)} is not set. Every connector access token is stored as AES-256-GCM ` +
        `ciphertext with a per-row nonce and the row's id as additional authenticated data ` +
        `(000-docs/053 §3, 048 R18), and the key lives in the process environment and never in ` +
        `the database. There is no plaintext mode and no generate-on-boot mode: a ring minted at ` +
        `startup would open nothing after a restart and would silently disconnect every shop. ` +
        `Generate one with \`openssl rand -base64 32\` and put it in SOPS. It is DELIBERATELY a ` +
        `different variable from LONGBOX_AUTHENTICATOR_KEY_V1 — one key for two subsystems means ` +
        `one compromise is two.`
    );
  }

  return { keys, current: Math.max(...keys.keys()) };
}

// ---------------------------------------------------------------------------
// 053 §5.3 / §7.2 — introducing a version.
// ---------------------------------------------------------------------------

/** 041 §2.3's envelope value. An attribution of record, never a proof (048 §3.5). */
export type AuthoredBy = "human" | "system" | "provider";

export interface IntroduceTokenArgs {
  readonly shopId: string;
  readonly connector: "shopify";
  readonly shopDomain: string;
  /** The OAuth state this grant came back on, or null for an operator-supplied token. */
  readonly installStateId: string | null;
  readonly grantedScopes: readonly string[];
  /** The access token. It is sealed here and reaches no other statement. */
  readonly accessToken: string;
  readonly versionNo: number;
  readonly authoredBy?: AuthoredBy;
}

/**
 * Introduce a connector token version, sealing the value on the way in.
 *
 * `versionNo` is chosen by the caller from `nextTokenVersionNo` rather than
 * computed by a `max()+1` here, for 050 §4's reason verbatim:
 * `UNIQUE (shop_id, connector, version_no)` is what makes a concurrent
 * double-introduction fail loudly, and a helper that silently retried it would
 * turn a race into a duplicate.
 *
 * The row `id` is generated HERE, before the seal, because it is the AAD.
 */
export async function introduceTokenVersion(
  db: Queryable,
  ring: ConnectorKeyring,
  args: IntroduceTokenArgs
): Promise<string> {
  const id = randomUUID();
  const sealed = aeadSeal(ring, Buffer.from(args.accessToken, "utf8"), id);
  await db.query(
    `INSERT INTO connector_token_version
       (id, shop_id, connector, shop_domain, install_state_id, granted_scopes,
        token_ciphertext, token_nonce, key_version, version_no, authored_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      args.shopId,
      args.connector,
      args.shopDomain,
      args.installStateId,
      [...args.grantedScopes],
      sealed.ciphertext,
      sealed.nonce,
      sealed.keyVersion,
      args.versionNo,
      args.authoredBy ?? "provider",
    ]
  );
  return id;
}

/** The next free version number for a `(shop, connector)`; 1 when none exists. */
export async function nextTokenVersionNo(
  db: Queryable,
  shopId: string,
  connector: "shopify"
): Promise<number> {
  const res = await db.query(
    `SELECT coalesce(max(version_no), 0) AS highest
       FROM connector_token_version WHERE shop_id = $1 AND connector = $2`,
    [shopId, connector]
  );
  return Number((res.rows[0] as { highest: number | string }).highest) + 1;
}

// ---------------------------------------------------------------------------
// 053 §7.1 — liveness, as a predicate over two tables.
// ---------------------------------------------------------------------------

/** One `connector_token_version` row, plus whether a retirement names it. */
export interface TokenVersionRow {
  readonly id: string;
  readonly connector: string;
  readonly shopDomain: string;
  readonly grantedScopes: readonly string[];
  readonly versionNo: number;
  readonly keyVersion: number;
  readonly introducedAt: Date;
  /** True when a `connector_token_retirement` row names this version. */
  readonly retired: boolean;
  readonly retiredReason: string | null;
}

/**
 * **Liveness. The predicate, and the only definition of it in this subsystem.**
 *
 * One line on purpose, for `credentialVersions.ts`'s reason: a second spelling
 * of the rule — a `WHERE r.id IS NULL` inlined in one query and a `.filter()` in
 * another — is how a resolver ends up serving an uninstalled shop's token while
 * a report says the app was removed.
 */
export function isLive(version: TokenVersionRow): boolean {
  return !version.retired;
}

/** The three outcomes of asking "which token authorises this call?" */
export type TokenOutcome =
  | { readonly outcome: "live"; readonly chosen: TokenVersionRow; readonly live: readonly TokenVersionRow[] }
  /** Versions exist and every one is retired — an uninstall, a revocation, or both. */
  | { readonly outcome: "all_retired"; readonly retired: readonly TokenVersionRow[] }
  /** This shop has never installed the connector. */
  | { readonly outcome: "no_versions" };

/** 050 §4's resolution rule as a PURE function, so the four cases test without a database. */
export function pickLiveToken(versions: readonly TokenVersionRow[]): TokenOutcome {
  if (versions.length === 0) return { outcome: "no_versions" };
  const live = versions
    .filter(isLive)
    .slice()
    .sort((a, b) => b.versionNo - a.versionNo);
  if (live.length === 0) return { outcome: "all_retired", retired: versions };
  return { outcome: "live", chosen: live[0]!, live };
}

interface TokenQueryRow {
  id: string;
  connector: string;
  shop_domain: string;
  granted_scopes: string[];
  version_no: number | string;
  key_version: number | string;
  introduced_at: Date | string;
  retired: boolean;
  retired_reason: string | null;
}

/**
 * Every declared version of one `(shop, connector)`, newest first, each carrying
 * whether a retirement names it.
 *
 * ONE QUERY, TWO TABLES, EVERY COLUMN NAMED (042 I5) — and NOT the ciphertext.
 * The bytes are fetched separately by `openTokenValue`, so the common read (is
 * this shop connected, and with what scopes?) never puts a sealed credential on
 * the wire between Postgres and this process at all.
 */
export async function loadTokenVersions(
  db: Queryable,
  shopId: string,
  connector: "shopify"
): Promise<TokenVersionRow[]> {
  const res = await db.query(
    `SELECT v.id, v.connector, v.shop_domain, v.granted_scopes, v.version_no, v.key_version,
            v.introduced_at, (r.id IS NOT NULL) AS retired, r.reason_code AS retired_reason
       FROM connector_token_version v
       LEFT JOIN connector_token_retirement r ON r.connector_token_version_id = v.id
      WHERE v.shop_id = $1 AND v.connector = $2
      ORDER BY v.version_no DESC`,
    [shopId, connector]
  );
  return (res.rows as TokenQueryRow[]).map((r) => ({
    id: r.id,
    connector: r.connector,
    shopDomain: r.shop_domain,
    grantedScopes: r.granted_scopes,
    versionNo: Number(r.version_no),
    keyVersion: Number(r.key_version),
    introducedAt: r.introduced_at instanceof Date ? r.introduced_at : new Date(r.introduced_at),
    retired: r.retired === true,
    retiredReason: r.retired_reason,
  }));
}

/** 053 §7.1's resolution rule against the live database. */
export async function resolveTokenVersion(
  db: Queryable,
  shopId: string,
  connector: "shopify"
): Promise<TokenOutcome> {
  return pickLiveToken(await loadTokenVersions(db, shopId, connector));
}

/**
 * Open one version's sealed token.
 *
 * Separate from the liveness read on purpose (see `loadTokenVersions`), and it
 * REFUSES a retired version rather than trusting its caller: 050 §5(a)'s rule is
 * that the refusal is what makes the ending true, and a helper that would open a
 * retired row for a caller who forgot to check is a helper that makes the rule a
 * convention.
 *
 * ⚠ **`shopId` IS REQUIRED AND IS IN THE `WHERE` CLAUSE, ADDED BY THE SECURITY
 * LENS'S S4 AT 053 v1.0.1.** The first version took `(db, ring, versionId)` and
 * opened ANY live row by id, with no row↔shop binding at all — so the only thing
 * standing between one shop's token and another was that every caller happened
 * to pass an id it had just read for the right shop. **That is a convention, and
 * a convention is what 019 T24 is not.** The AAD binding in §3.1 defends the
 * ciphertext against being MOVED between rows; it says nothing about a caller
 * asking for the wrong row, and the two are different attacks. A `shop_id` in
 * the predicate makes the cross-tenant case a zero-row read rather than a
 * successful decryption, which is structural rather than careful.
 *
 * **A wrong shop is answered exactly as an absent version**, on 048 §9.3's
 * constant-answer rule: a caller who could tell "that version belongs to another
 * shop" from "no such version" holds an enumeration oracle over ids.
 *
 * The `AeadOpenError` from the shared envelope names the AUTHENTICATOR variable,
 * because that is the ring it was written for. It is caught and restated here so
 * an operator is told which variable is actually missing — a message that names
 * the wrong environment variable is worse than no message, because it sends the
 * person to the wrong file at the wrong hour.
 */
export async function openTokenValue(
  db: Queryable,
  ring: ConnectorKeyring,
  shopId: string,
  versionId: string
): Promise<string> {
  const res = await db.query(
    `SELECT v.id, v.token_ciphertext, v.token_nonce, v.key_version,
            (r.id IS NOT NULL) AS retired
       FROM connector_token_version v
       LEFT JOIN connector_token_retirement r ON r.connector_token_version_id = v.id
      WHERE v.id = $1 AND v.shop_id = $2`,
    [versionId, shopId]
  );
  const row = res.rows[0] as
    | { id: string; token_ciphertext: Buffer; token_nonce: Buffer; key_version: number; retired: boolean }
    | undefined;
  // One answer for "no such version" and "not this shop's version" (048 §9.3).
  if (!row) throw new ConnectorTokenRefusedError(`no connector token version ${versionId}`);
  if (row.retired) {
    throw new ConnectorTokenRefusedError(
      `connector token version ${versionId} is retired; a retired token is never opened, ` +
        `whatever the caller believes about it`
    );
  }
  try {
    return aeadOpen(ring, {
      ciphertext: row.token_ciphertext,
      nonce: row.token_nonce,
      keyVersion: Number(row.key_version),
      aad: row.id,
    }).toString("utf8");
  } catch (err) {
    if (err instanceof AeadOpenError) {
      throw new ConnectorTokenRefusedError(
        `connector token version ${versionId} did not open: ${err.message} — for THIS subsystem ` +
          `the variable is ${connectorKeyEnv(Number(row.key_version))}, not the authenticator's. ` +
          `Restore it, or re-install the connector; a key removed before its rows are re-sealed ` +
          `takes those installs with it.`
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 053 §7.3 — the ending, and its receipt.
// ---------------------------------------------------------------------------

/** The three endings a connector token has (`migrations/026`'s CHECK). */
export type RetirementReason = "uninstall" | "rotation" | "revocation";

/**
 * What this system DID about the provider side, and what it OBSERVED in reply.
 *
 * 053 §7.3a (v1.0.1, the security lens's S2). **Neither field says the token is
 * dead at Shopify**, and neither ever will: a 200 is evidence that a request
 * succeeded, not a fact about another system's present state, and 018's rung
 * rules forbid recording an unverified third-party state as a fact.
 *
 * `httpStatus === null` with an `attemptedAt` is a transport failure — the call
 * did not complete — which is a different thing from a call that returned an
 * error, and the two are stored differently on purpose.
 */
export interface ProviderRevocationObservation {
  readonly attemptedAt: Date;
  readonly httpStatus: number | null;
}

export interface RetireTokenArgs {
  readonly shopId: string;
  readonly connectorTokenVersionId: string;
  readonly reasonCode: RetirementReason;
  /** The signed message that caused it. REQUIRED for `uninstall` by CHECK. */
  readonly webhookReceiptId?: string | null;
  /** What Longbox did about the provider side, when it did anything. */
  readonly providerRevocation?: ProviderRevocationObservation | null;
  readonly authoredBy?: AuthoredBy;
}

/** Retire a token version. A SECOND ROW, never an edit (050 §2 Q2). */
export async function retireTokenVersion(db: Queryable, args: RetireTokenArgs): Promise<string> {
  const res = await db.query(
    `INSERT INTO connector_token_retirement
       (shop_id, connector_token_version_id, reason_code, webhook_receipt_id,
        provider_revocation_attempted_at, provider_revocation_http_status, authored_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      args.shopId,
      args.connectorTokenVersionId,
      args.reasonCode,
      args.webhookReceiptId ?? null,
      args.providerRevocation?.attemptedAt ?? null,
      args.providerRevocation?.httpStatus ?? null,
      args.authoredBy ?? "system",
    ]
  );
  return (res.rows[0] as { id: string }).id;
}

/**
 * What each ending actually achieved, in the words a receipt may use.
 *
 * 041 §8.2's rule is that a receipt must not say something untrue, and the
 * untrue sentence available here is the mirror image of 050's. THERE, Longbox
 * could not revoke and a receipt claiming otherwise would lie.
 *
 * ⚠ **`revocation` USED TO CONTAIN A FALSE SENTENCE, AND THE SECURITY LENS'S S2
 * IS WHY IT NO LONGER DOES** (053 v1.0.1). It read *"only the merchant can end it
 * there, by uninstalling the app"* — which is 050's true sentence about a BYOK
 * key transplanted onto a credential it does not describe. An app holding an
 * offline token can call Shopify's own app-uninstall endpoint WITH THAT TOKEN, so
 * "only the merchant can" was a claim this record had not checked, stated in the
 * one artifact 041 §8.2 forbids untrue statements in. The sentence now says what
 * the receipt's own columns say — whether this system CALLED, and what it
 * OBSERVED — and `revocationOutcome` renders that per receipt.
 *
 * **What none of the three says, and none ever will, is that the token is dead
 * at Shopify by Longbox's act.** A 200 is evidence a request succeeded, not a
 * fact about another system's present state (018).
 */
export const RETIREMENT_MEANING: Record<RetirementReason, string> = {
  uninstall:
    "the merchant removed the app in their own Shopify admin, which Shopify reported in a " +
    "signed message this receipt cites by id. The access token is dead at Shopify by that act " +
    "and not by anything this system did.",
  rotation:
    "a successor version was introduced and this one was ended. This system will never present " +
    "the old token again. Whether it still works at Shopify depends on whether anything revoked " +
    "it there, which this ending did not attempt.",
  revocation:
    "this system was told to stop using the token, and stopped: it refuses to open or present it " +
    "from the next read onward. Whether the token is also dead AT SHOPIFY depends on the " +
    "provider-side attempt recorded beside this reason, which states what was called and what " +
    "came back — and states nothing about the provider's present state.",
};

/**
 * The provider-side half of a receipt, rendered from what was recorded.
 *
 * Four cases, and the fourth is the one the security lens made this record
 * write down: **no attempt at all**. A revocation with no provider call is a
 * revocation that ended nothing at Shopify, and a receipt that did not say so
 * would be back where S2 found it.
 */
export function revocationOutcome(observation: ProviderRevocationObservation | null | undefined): string {
  if (!observation) {
    return (
      "No provider-side revocation was attempted by this system. The token may remain usable at " +
      "Shopify until the merchant uninstalls the app there."
    );
  }
  const at = observation.attemptedAt.toISOString();
  if (observation.httpStatus === null) {
    return (
      `A provider-side revocation was attempted at ${at} and the call did not complete — no ` +
      `status was observed. This system cannot tell whether the request reached Shopify, so it ` +
      `claims nothing about the token's state there.`
    );
  }
  if (observation.httpStatus >= 200 && observation.httpStatus < 300) {
    return (
      `A provider-side revocation was attempted at ${at} and Shopify answered ` +
      `${String(observation.httpStatus)}. That is what this system OBSERVED; it is evidence the ` +
      `request succeeded and is not, by itself, a statement about the token's present state at ` +
      `Shopify, which only Shopify can make.`
    );
  }
  return (
    `A provider-side revocation was attempted at ${at} and Shopify answered ` +
    `${String(observation.httpStatus)}. The token should be treated as still usable at Shopify ` +
    `until the merchant uninstalls the app there.`
  );
}

/**
 * The steps a connector offboarding performs, in order, as text a receipt quotes.
 *
 * **THREE, and the middle one is the one 050 does not have.** For a BYOK key the
 * middle step is an operations act (edit SOPS, restart). Here it is a row: the
 * value lives in the database under a key the process holds, so ending it is one
 * append and the resolver refuses on the next read. There is no deploy in this
 * path and therefore no deploy to forget.
 */
export const CONNECTOR_OFFBOARDING_STEPS: readonly [string, string, string] = [
  "the reason for the ending was established — a signed uninstall message, a rotation, or a " +
    "deliberate revocation — and recorded as the retirement's reason code",
  "a retirement row was appended naming the token version, after which this system refuses to " +
    "open or present that token at all, on every code path, from the next read onward",
  "no successor was created by this act: reconnecting is a new install, which mints a new state, " +
    "obtains a new grant and introduces a new version",
];

/**
 * What the receipt says about what it did NOT achieve.
 *
 * Stated rather than mitigated, in the receipt rather than a footnote, because
 * the shop's next action depends on it — and stated PER REASON, because the
 * three endings differ in exactly this respect and one sentence covering all
 * three would be false for one of them.
 */
export function connectorResidual(reason: RetirementReason): string {
  // ⚠ THE BACKUP SENTENCE IS NARROWED AT v1.0.1 (the security lens's S1). It used
  // to imply that a backup copy of the ciphertext is a defended copy. It is not:
  // the estate's borg include set carries `/etc` — where the age key lives — and
  // the database dump in the SAME archive, so one archive holds the ciphertext,
  // the SOPS source of the ring and the key that opens it, for the Object-Lock
  // window. Separating them is E13-D01 (`longbox-e5b.13.11`); until it lands,
  // the honest sentence is the one below and no receipt may say more.
  const backup =
    "The sealed ciphertext remains in this database and in every backup taken before now. Until " +
    "E13-D01 separates the key material from the database archive, a backup of the estate is not " +
    "a copy this encryption defends — it is a copy that may also contain the key.";
  return reason === "uninstall"
    ? "The token is dead at Shopify because the merchant uninstalled the app. Nothing in this " +
        `system caused that and nothing in this system could undo it. ${backup} It is ciphertext ` +
        "of a credential the provider has already invalidated."
    : "This system will not present the token again, from the next read onward. What it means " +
        "for the token at SHOPIFY is stated separately in this receipt, from what was actually " +
        `called and observed. ${backup} It stops being openable if this key version is destroyed ` +
        "(E03-D13 `longbox-e5b.3.23` builds the re-sealing tool that makes that a usable act).";
}

/**
 * A minimal receipt (041 §8.7(c)): what was ended, by which steps, and what it
 * did not achieve.
 *
 * ⚠ WHAT IS ABSENT IS THE DESIGN. No token value, no ciphertext, no digest of a
 * value, no prefix. `shop_domain` is a store's public address and `granted_scopes`
 * is what the merchant approved — neither is a credential.
 *
 * ⚠ THIS IS OPERATOR TEXT, NOT SHOP-FACING COPY. 050 §5 routes the wording a
 * shop receives at offboarding to a candidate C-row for `000-docs/021` under the
 * T26 pre-send, and 053 §9 does the same for the connector's. Nothing in this
 * module may be pasted into a shop-facing surface without that step.
 */
export interface ConnectorOffboardingReceipt {
  readonly shop_id: string;
  readonly connector: string;
  readonly connector_token_version_id: string;
  readonly version_no: number;
  readonly shop_domain: string;
  readonly granted_scopes: readonly string[];
  readonly reason_code: RetirementReason;
  readonly retired_at: string;
  /** The signed message that caused it, when one did. Never invented. */
  readonly webhook_receipt_id: string | null;
  /**
   * What THIS SYSTEM did about the provider side and what it OBSERVED (S2).
   * `null` means no attempt was made, which the rendered sentence says outright
   * rather than leaving to a reader's inference.
   */
  readonly provider_revocation: { readonly attempted_at: string; readonly http_status: number | null } | null;
  readonly meaning: string;
  /** The rendered provider-side sentence for `provider_revocation`. */
  readonly provider_outcome: string;
  readonly steps: readonly [string, string, string];
  readonly residual: string;
}

/** Retire a token version and return the receipt for it. */
export async function offboardTokenVersion(
  db: Queryable,
  args: RetireTokenArgs & {
    readonly connector: string;
    readonly versionNo: number;
    readonly shopDomain: string;
    readonly grantedScopes: readonly string[];
  }
): Promise<ConnectorOffboardingReceipt> {
  await retireTokenVersion(db, args);
  const res = await db.query(
    `SELECT retired_at, webhook_receipt_id,
            provider_revocation_attempted_at, provider_revocation_http_status
       FROM connector_token_retirement
      WHERE connector_token_version_id = $1`,
    [args.connectorTokenVersionId]
  );
  const row = res.rows[0] as
    | {
        retired_at: Date | string;
        webhook_receipt_id: string | null;
        provider_revocation_attempted_at: Date | string | null;
        provider_revocation_http_status: number | null;
      }
    | undefined;
  const attempted = row?.provider_revocation_attempted_at ?? null;
  const observation: ProviderRevocationObservation | null =
    attempted === null
      ? null
      : {
          attemptedAt: new Date(attempted),
          httpStatus:
            row?.provider_revocation_http_status === null ||
            row?.provider_revocation_http_status === undefined
              ? null
              : Number(row.provider_revocation_http_status),
        };
  return {
    shop_id: args.shopId,
    connector: args.connector,
    connector_token_version_id: args.connectorTokenVersionId,
    version_no: args.versionNo,
    shop_domain: args.shopDomain,
    granted_scopes: args.grantedScopes,
    reason_code: args.reasonCode,
    retired_at: new Date(row?.retired_at ?? Date.now()).toISOString(),
    webhook_receipt_id: row?.webhook_receipt_id ?? null,
    provider_revocation:
      observation === null
        ? null
        : { attempted_at: observation.attemptedAt.toISOString(), http_status: observation.httpStatus },
    meaning: RETIREMENT_MEANING[args.reasonCode],
    provider_outcome: revocationOutcome(observation),
    steps: CONNECTOR_OFFBOARDING_STEPS,
    residual: connectorResidual(args.reasonCode),
  };
}

/** The receipt as plain text, for a 006 row or an operator's console. */
export function renderConnectorReceipt(receipt: ConnectorOffboardingReceipt): string {
  return [
    `Connector authority ended — shop ${receipt.shop_id}, connector ${receipt.connector}, ` +
      `store ${receipt.shop_domain}, token version ${receipt.version_no} ` +
      `(${receipt.connector_token_version_id}).`,
    `Retired at ${receipt.retired_at}, reason ${receipt.reason_code}.`,
    `Scopes it held: ${receipt.granted_scopes.join(", ")}.`,
    `What that means: ${receipt.meaning}`,
    `Provider side: ${receipt.provider_outcome}`,
    ...receipt.steps.map((s, i) => `Step ${i + 1}: ${s}.`),
    receipt.webhook_receipt_id === null
      ? "No signed provider message caused this ending."
      : `Caused by signed provider message ${receipt.webhook_receipt_id}.`,
    receipt.residual,
  ].join("\n");
}

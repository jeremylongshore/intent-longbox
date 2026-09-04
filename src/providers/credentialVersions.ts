// Credential rotation as two facts, and liveness as a predicate over them.
//
// Bead: longbox-e5b.3.5 (alias E03-B05), the code half. Docs: 050 §2 Q2/Q3, §4,
// §5, §9 I2/I3/I7/I10, §10; 041 §8 (a deletion is an appended fact), §8.7(c)
// (the receipt is minimal); 048 §3.5 (the RULE on attribution); 018 (an
// unverified third-party act is not a fact); CLAUDE.md locked decisions 2 and 4.
//
// ONE SENTENCE. A credential version is LIVE when it has an introduction row and
// no retirement row; the resolver takes the newest live version for a
// `(shop, kind)`; and that is computed at read time, every time, from the two
// tables — never from a status column and never from a cache.
//
// WHY THERE IS NO CACHE, STATED AS A DECISION RATHER THAN AN OVERSIGHT (050 §12).
// The read path gains a join, on the request path, for a value that changes
// perhaps twice a year. That is a real cost, and the obvious mitigation — a
// per-process cache — is deliberately NOT taken: **a cached credential is a
// retired credential still working**, which is the exact failure 050 §5(a)
// exists to prevent. The same argument 048 makes about session liveness and 043
// makes about the outbox, arriving a third time.
//
// THIS MODULE NEVER SEES A KEY VALUE. It reads and writes NAMES (`key_ref`),
// version numbers and timestamps. `resolveKeyRef` in `./credentialPolicy.ts` is
// the only thing that touches `process.env`, and it is handed a name this module
// selected. Nothing here logs, returns, formats or hashes a value.
import type { Queryable } from "../db.js";

/** The credential kinds a version may be declared for — the `014` closed set. */
export type CredentialKind = "anthropic" | "openai_compat" | "shopify" | "pricecharting" | "ebay";

/** One `shop_credential_version` row, plus whether a retirement names it. */
export interface CredentialVersionRow {
  readonly id: string;
  readonly kind: CredentialKind;
  /** An environment variable NAME. Never a value — see the module comment. */
  readonly keyRef: string;
  readonly versionNo: number;
  readonly introducedAt: Date;
  /** True when a `shop_credential_retirement` row names this version. */
  readonly retired: boolean;
}

/**
 * **Liveness. The predicate, and the only definition of it in the system.**
 *
 * 050 §2 Q2: *"a version is live when it has an introduction and no retirement"*.
 * It is a one-line function on purpose. A second spelling of this rule — a
 * `WHERE r.id IS NULL` inlined in one query and a `.filter()` in another — is
 * how a resolver ends up serving a rotated-out key while a report says the
 * credential is retired, which is worse than no rotation at all because the shop
 * believes it rotated.
 */
export function isLive(version: CredentialVersionRow): boolean {
  return !version.retired;
}

/** The three outcomes of asking "which credential version pays for this call?" */
export type CredentialVersionOutcome =
  /** At least one live version. `chosen` is the greatest `version_no` among them. */
  | {
      readonly outcome: "live";
      readonly chosen: CredentialVersionRow;
      readonly live: readonly CredentialVersionRow[];
    }
  /** The shop has declared versions and every one of them is retired. */
  | { readonly outcome: "all_retired"; readonly retired: readonly CredentialVersionRow[] }
  /** The shop has declared no version of this kind at all. */
  | { readonly outcome: "no_versions" };

/**
 * 050 §4's resolution rule, as a PURE function over rows.
 *
 * Kept separate from the query so the four cases in §9 I3 are testable without a
 * database, and so the query has nothing to decide.
 */
export function pickLiveVersion(versions: readonly CredentialVersionRow[]): CredentialVersionOutcome {
  if (versions.length === 0) return { outcome: "no_versions" };
  const live = versions
    .filter(isLive)
    .slice()
    .sort((a, b) => b.versionNo - a.versionNo);
  if (live.length === 0) return { outcome: "all_retired", retired: versions };
  return { outcome: "live", chosen: live[0]!, live };
}

/**
 * **The overlap window is real, is bounded by a PROVISIONAL floor, and is never
 * closed automatically** (050 §2 Q2).
 *
 * Introducing version N+1 does not retire version N; a person or an offboarding
 * does. An overlap older than this is a `000-docs/006` row and a report line —
 * **never an auto-retirement**, because auto-retiring a credential is how a shop
 * stops working at 09:00 on a Tuesday with nobody watching, and the whole point
 * of an overlap is that the old key keeps working while the new one is proven.
 *
 * ⚠ PROVISIONAL, in 042 §8.4's class. It is not a measurement, it is never
 * quoted as capacity, cost or reliability in any artifact at any class (021
 * B16), and 018 C3's red line applies: it may be RAISED freely; lowering it
 * after seeing a result it would change requires a 006 row saying so in those
 * words.
 */
export const PROVISIONAL_CREDENTIAL_OVERLAP_DAYS = 7;

/**
 * A report line about an overlap, carrying a shop, a kind and two version
 * NUMBERS — no `key_ref` and, obviously, no value.
 */
export interface CredentialOverlapEvent {
  readonly event: "credential.overlap_exceeded_floor";
  readonly shop_id: string;
  readonly kind: CredentialKind;
  readonly live_version_nos: readonly number[];
  readonly oldest_overlap_days: number;
  readonly floor_days: number;
}

let overlapSink: (e: CredentialOverlapEvent) => void = (e) => {
  console.warn(JSON.stringify(e));
};

/** Install a sink; returns the previous one so a test can restore it. */
export function setCredentialOverlapSink(
  sink: (e: CredentialOverlapEvent) => void
): (e: CredentialOverlapEvent) => void {
  const prev = overlapSink;
  overlapSink = sink;
  return prev;
}

/**
 * Report an overlap that has outlived the floor. **Reports; never acts.**
 *
 * Returns the emitted event (or `undefined`) rather than nothing, so a caller
 * that wants to include the finding in a report does not have to install a sink
 * to see it.
 */
export function reportOverlap(
  shopId: string,
  kind: CredentialKind,
  live: readonly CredentialVersionRow[],
  now: Date = new Date()
): CredentialOverlapEvent | undefined {
  if (live.length < 2) return undefined;
  const oldest = live.reduce((a, b) => (a.introducedAt <= b.introducedAt ? a : b));
  const days = (now.getTime() - oldest.introducedAt.getTime()) / 86_400_000;
  if (days <= PROVISIONAL_CREDENTIAL_OVERLAP_DAYS) return undefined;
  const event: CredentialOverlapEvent = {
    event: "credential.overlap_exceeded_floor",
    shop_id: shopId,
    kind,
    live_version_nos: live.map((v) => v.versionNo),
    oldest_overlap_days: Math.floor(days),
    floor_days: PROVISIONAL_CREDENTIAL_OVERLAP_DAYS,
  };
  overlapSink(event);
  return event;
}

interface VersionQueryRow {
  id: string;
  kind: CredentialKind;
  key_ref: string;
  version_no: number | string;
  introduced_at: Date | string;
  retired: boolean;
}

/**
 * Every declared version of one `(shop, kind)`, newest first, each carrying
 * whether a retirement names it.
 *
 * ONE QUERY, TWO TABLES, EVERY COLUMN NAMED (042 I5). The `LEFT JOIN` is what makes
 * liveness derivable in a single round trip; the predicate itself stays in
 * `isLive` so there is exactly one definition of it (see the module comment).
 */
export async function loadCredentialVersions(
  db: Queryable,
  shopId: string,
  kind: CredentialKind
): Promise<CredentialVersionRow[]> {
  const res = await db.query(
    `SELECT v.id, v.kind, v.key_ref, v.version_no, v.introduced_at,
            (r.id IS NOT NULL) AS retired
       FROM shop_credential_version v
       LEFT JOIN shop_credential_retirement r ON r.credential_version_id = v.id
      WHERE v.shop_id = $1 AND v.kind = $2
      ORDER BY v.version_no DESC`,
    [shopId, kind]
  );
  return (res.rows as VersionQueryRow[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    keyRef: r.key_ref,
    versionNo: Number(r.version_no),
    introducedAt: r.introduced_at instanceof Date ? r.introduced_at : new Date(r.introduced_at),
    retired: r.retired === true,
  }));
}

/**
 * 050 §4's resolution rule against the live database, with the overlap reported.
 *
 * The overlap is reported HERE rather than by the caller because reporting it is
 * not optional: the ruling is that an overlap past the floor produces a report
 * line, and a report that only happens when a caller remembers to ask is a
 * report that stops happening.
 */
export async function resolveCredentialVersion(
  db: Queryable,
  shopId: string,
  kind: CredentialKind,
  now: Date = new Date()
): Promise<CredentialVersionOutcome> {
  const outcome = pickLiveVersion(await loadCredentialVersions(db, shopId, kind));
  if (outcome.outcome === "live") reportOverlap(shopId, kind, outcome.live, now);
  return outcome;
}

// ---------------------------------------------------------------------------
// The writers. Two INSERTs and nothing else — there is no update path here by
// construction, and the append-only trigger would refuse one anyway.
// ---------------------------------------------------------------------------

/** 041 §2.3's envelope value. An attribution of record, never a proof (048 §3.5). */
export type AuthoredBy = "human" | "system" | "provider";

/**
 * Introduce a credential version.
 *
 * `versionNo` is chosen by the caller from `nextVersionNo` rather than computed
 * inside a `max()+1` here, because `UNIQUE (shop_id, kind, version_no)` is what
 * makes a concurrent double-introduction fail loudly, and a helper that silently
 * retried it would turn a race into a duplicate.
 */
export async function introduceCredentialVersion(
  db: Queryable,
  args: {
    shopId: string;
    kind: CredentialKind;
    /** An environment variable NAME, already checked against the shop's namespace. */
    keyRef: string;
    versionNo: number;
    authoredBy?: AuthoredBy;
  }
): Promise<string> {
  const res = await db.query(
    `INSERT INTO shop_credential_version (shop_id, kind, key_ref, version_no, authored_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [args.shopId, args.kind, args.keyRef, args.versionNo, args.authoredBy ?? "human"]
  );
  return (res.rows[0] as { id: string }).id;
}

/** The next free version number for a `(shop, kind)`; 1 when none exists. */
export async function nextVersionNo(db: Queryable, shopId: string, kind: CredentialKind): Promise<number> {
  const res = await db.query(
    `SELECT coalesce(max(version_no), 0) AS highest
       FROM shop_credential_version WHERE shop_id = $1 AND kind = $2`,
    [shopId, kind]
  );
  return Number((res.rows[0] as { highest: number | string }).highest) + 1;
}

/**
 * Retire a credential version. A SECOND ROW, never an edit (050 §2 Q2).
 *
 * `providerRevocationInstructedAt` records when the shop was TOLD to revoke at
 * the provider. **There is no parameter asserting that the shop revoked**, and
 * there will not be: that is a claim about somebody else's system this one
 * cannot check (050 §2 Q3, 018).
 */
export async function retireCredentialVersion(
  db: Queryable,
  args: {
    shopId: string;
    credentialVersionId: string;
    reasonCode: string;
    providerRevocationInstructedAt?: Date | null;
    authoredBy?: AuthoredBy;
  }
): Promise<string> {
  const res = await db.query(
    `INSERT INTO shop_credential_retirement
       (shop_id, credential_version_id, reason_code, provider_revocation_instructed_at, authored_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      args.shopId,
      args.credentialVersionId,
      args.reasonCode,
      args.providerRevocationInstructedAt ?? null,
      args.authoredBy ?? "human",
    ]
  );
  return (res.rows[0] as { id: string }).id;
}

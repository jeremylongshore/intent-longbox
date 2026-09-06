// The fact every accessor writes, and the one place `identity_access` is written.
//
// Bead: longbox-e5b.3.27 (alias E03-D17). Docs: 000-docs/060 §3, §5;
// 019 T35(b); 034 §3.3; 022 P3; 041 §2.1; 054 §4.5 (the audit-write ordering
// argument this file follows and departs from, and where it departs).
import { buildCommit } from "../config.js";
import type { Queryable } from "../db.js";
import type { IdentityKeyKind, IdentityPurpose } from "./purposes.js";

/**
 * WHERE a resolution was asked for, and WHY.
 *
 * Supplied by the CALLER and never derived here, for `authorization_decision`'s
 * reason one table over: a module that guessed its own caller would record the
 * accessor it was written for rather than the one that reached it.
 */
export interface IdentityAccessContext {
  /** HTTP method, or the literal `CLI`. */
  readonly method: string;
  /** The route TEMPLATE, or the script path. **Never a URL** (022 P3). */
  readonly path: string;
  readonly purpose: IdentityPurpose;
  /**
   * The tenant this access happened in, or `null` for a CLI.
   *
   * `migrations/035`'s CHECK ties the null to `method === "CLI"`, and the
   * `tenant_isolation` policy makes it unwritable by the application at all — so
   * a null here from a running server is refused by the database rather than
   * recorded as an unscoped fact.
   */
  readonly shopId: string | null;
}

// **THE RULE `resolved_count` OBEYS, WRITTEN DOWN** (the data-model lens's
// first finding).
//
// The lens accepted the column and refused that it was unargued: a number on an
// audit row is the shape that quietly becomes a metric, and "how many people did
// this read produce" had no stated boundary separating it from "how many people
// has this accessor produced this week".
//
//   **A fact may carry the CARDINALITY OF ITS OWN RESULT. It may never carry a
//   duration, a rate, or anything computed across rows.**
//
// `resolved_count` is the first: a property of the single read the row records,
// known at write time, and what makes a BULK access visible without naming
// anybody in it — one roster read of eleven people is one row saying eleven, not
// eleven rows and not an average. A duration would be a timing about somebody's
// work; a rate or a running total would be an aggregate the writer computed by
// reading other rows, which is a read model in a write path and a per-operator
// metric one join from existing. The rule is here rather than in the record
// alone, because the next column somebody wants to add is decided at this file.

/**
 * **Append the access fact. The ONE writer of `identity_access`** — enforced by
 * `pnpm arch`'s `identity-access-has-one-writer`, on `authorizationAudit.ts`'s
 * precedent (054 §4.4) and for a sharper reason: a second writer is a second
 * definition of what counts as resolving a person, and the audit that reconciles
 * this table against the declared accessor inventory would be reconciling one of
 * two vocabularies.
 *
 * ⚠ **NOTHING ABOUT THE SUBJECT CROSSES THIS BOUNDARY.** The signature takes a
 * `keyKind` and a `count`. There is no parameter for an `app_user_id`, an email
 * or a display name, and there is no column for one — 022 P3 and 000-docs/060 §5.
 * A caller cannot record who it looked up even by mistake.
 *
 * **ON THE SAME HANDLE THE READ USES, WHICH IS WHERE THIS DEPARTS FROM 054 §4.5.**
 * `authorization_decision` is written OUTSIDE the request transaction, because a
 * refused request has no transaction to join and an authorization that happened
 * must survive a rolled-back effect. Neither applies here: a person-resolution
 * only happens on a path that got far enough to read, and **the fact is lost for
 * a read whose EFFECT was undone** — which is over-recording in reverse, and the
 * direction this table can afford. (v1.0.0 wrote *"a read that rolls back
 * disclosed nothing"*, and the security lens's F7 is right that this is not the
 * same statement: the read HAPPENED and the value existed in this process. What
 * a rollback undoes is the effect, not the disclosure.) So the fact travels on
 * the CALLER'S handle — inside its
 * transaction when it has one (`redeemInvitation`), in its own statement when it
 * does not (`tenantDb`, which runs each statement in its own small transaction).
 * **The consequence is stated rather than discovered: on a `tenantDb` handle the
 * read and the fact are two transactions, so a process that dies between them
 * loses the fact for a read that DID happen.** 000-docs/060 §11 R6
 * carries it as a residual; the cheap fix — one transaction — would put this
 * INSERT into the request's write set, which is the cost 048 §12.2 already
 * measures for the session row.
 */
export async function recordIdentityAccess(
  db: Queryable,
  context: IdentityAccessContext,
  keyKind: IdentityKeyKind,
  count: number
): Promise<void> {
  await db.query(
    `INSERT INTO identity_access
       (shop_id, purpose, accessor_method, accessor_path, key_kind, resolved_count, build_commit)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [context.shopId, context.purpose, context.method, context.path, keyKind, count, buildCommit()]
  );
}

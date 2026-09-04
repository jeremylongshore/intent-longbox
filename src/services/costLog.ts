// Per-call cost logging (R13): every model call appends a cost_log row.
//
// E02-D07 widens the handle and adds the job dimension (043 §8.1, §11 I19).
//
// THE HANDLE. `db` was `pg.Pool`, so a cost row could not commit with the fact
// it describes (043 §1 E11). It is now a `Queryable`, which a held `Tx` also
// satisfies — 029 §12.1 point 3's "any module function that writes takes the
// handle as its first parameter", which 043 §8.1 is explicit is E02-D04's shape
// and not a new rule. Existing pool callers are unchanged and still correct: a
// request that has no transaction to join passes the pool, and the row is the
// meter reading it always was.
import { estimateUsd } from "../config.js";
import type { Queryable } from "../db.js";

export async function appendCostLog(
  db: Queryable,
  args: {
    shopId: string;
    scanSessionId?: string;
    provider: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    /**
     * The job that spent this, or omitted when a REQUEST did — ONE meaning, not
     * two (043 §8.1; 030 A1). A replayed job that spends again appends a SECOND
     * row rather than reusing the first: the row is a meter reading, and
     * replaying it would be falsifying a ledger (043 §6.1).
     *
     * Nothing passes it yet, and that is deliberate: the Shopify draft job costs
     * no money, and writing a zero-dollar row to prove the seam works would put
     * a figure in a ledger that is not a measurement (022 P8, 019 T13a both read
     * this table). The seam exists for E10-B04's staged media upload.
     */
    outboxId?: string | null;
    /**
     * The credential VERSION that paid, or null/absent when Longbox's own
     * account did — the global environment or the gateway override.
     *
     * ⚠ IT IS A REFERENCE, AND THE OWNER IS DERIVED FROM IT (050 §6.2). There is
     * deliberately NO `spendOwner` parameter: a caller that can pass an owner in
     * is a caller that can attribute a Longbox call to a shop, and 019 T13a
     * (cost per verified draft) and T15 (the variable-cost line) are both
     * measured from this table. `resolveVisionProvider` returns this id beside
     * the provider precisely so the attribution follows the resolution rather
     * than a caller's belief about it.
     *
     * 041 §8.4's move, applied here: **the log holds references, not values.**
     * There is no `key_ref` on this row and there is certainly no key.
     */
    credentialVersionId?: string | null;
  }
): Promise<number> {
  const usd = estimateUsd(args.model, args.tokensIn, args.tokensOut);
  const credentialVersionId = args.credentialVersionId ?? null;
  await db.query(
    `INSERT INTO cost_log
       (shop_id, scan_session_id, provider, model, tokens_in, tokens_out, estimated_usd, outbox_id,
        credential_version_id, spend_owner)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      args.shopId,
      args.scanSessionId ?? null,
      args.provider,
      args.model,
      args.tokensIn,
      args.tokensOut,
      usd,
      args.outboxId ?? null,
      credentialVersionId,
      deriveSpendOwner(credentialVersionId),
    ]
  );
  return usd;
}

/**
 * **Who paid, derived and never declared** (050 §2 Q4(a), §6.2).
 *
 * Two values and no third. `shop` when a live per-shop credential version
 * resolved the call; `longbox` when the global environment or the gateway
 * override did. There is no `unknown`, because a call whose owner cannot be
 * determined is a call that should not have been made — and there is nothing to
 * be unsure about here: either a version id came back from the resolver or one
 * did not.
 *
 * Exported so the rule is testable on its own and so `pnpm arch`'s single-writer
 * check (029 §2.8 / §5 move 7 (V5)) keeps guarding the one INSERT above rather
 * than a rule spread across callers.
 */
export function deriveSpendOwner(credentialVersionId: string | null): "shop" | "longbox" {
  return credentialVersionId === null ? "longbox" : "shop";
}

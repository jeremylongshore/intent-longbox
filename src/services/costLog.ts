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
  }
): Promise<number> {
  const usd = estimateUsd(args.model, args.tokensIn, args.tokensOut);
  await db.query(
    `INSERT INTO cost_log
       (shop_id, scan_session_id, provider, model, tokens_in, tokens_out, estimated_usd, outbox_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      args.shopId,
      args.scanSessionId ?? null,
      args.provider,
      args.model,
      args.tokensIn,
      args.tokensOut,
      usd,
      args.outboxId ?? null,
    ]
  );
  return usd;
}

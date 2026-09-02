// Per-call cost logging (R13): every model call appends a cost_log row.
import type pg from "pg";
import { estimateUsd } from "../config.js";

export async function appendCostLog(
  db: pg.Pool,
  args: {
    shopId: string;
    scanSessionId?: string;
    provider: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
  }
): Promise<number> {
  const usd = estimateUsd(args.model, args.tokensIn, args.tokensOut);
  await db.query(
    `INSERT INTO cost_log (shop_id, scan_session_id, provider, model, tokens_in, tokens_out, estimated_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [args.shopId, args.scanSessionId ?? null, args.provider, args.model, args.tokensIn, args.tokensOut, usd]
  );
  return usd;
}

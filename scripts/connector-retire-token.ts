// End a connector's authority deliberately, and print the receipt.
//
//   pnpm connector-retire-token --shop <shop-uuid> --reason rotation|revocation
//
// ⚠ `uninstall` IS NOT OFFERED HERE, AND THE ABSENCE IS THE CONTROL. An
// `uninstall` retirement asserts that the merchant removed the app at Shopify,
// and `migrations/026`'s CHECK requires it to cite the signed message that says
// so. A human typing `--reason uninstall` would be recording a third party's act
// with no evidence attached, which is exactly what 018's rung rules forbid and
// what 041 §8.2 calls a receipt that contains a false statement. That reason
// code is written by one caller — `receiveWebhook`, holding the receipt id.
//
// WHAT IT ACHIEVES, STATED PRECISELY (053 §7.3). It stops THIS SYSTEM from ever
// presenting the token again, from the next read onward, while the sealed
// ciphertext is still in the row — 050 §5(a)'s inversion, one connector over:
// the software stops being able to use the credential before any operations work
// removes it. It does NOT reach Shopify. Only the merchant can end a token there,
// by uninstalling the app, and the receipt says so in those words.
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { resolveMigrateUrl } from "./migrateUrl.js";
import { withTransaction } from "../src/db.js";
import {
  CONNECTOR,
  SHOPIFY_APP_ENV,
  loadTokenVersions,
  offboardTokenVersion,
  openTokenValue,
  renderConnectorReceipt,
  requireConnectorKey,
  resolveAppCredentials,
  revokeAtProvider,
  type ProviderRevocationObservation,
  type RetirementReason,
} from "../src/services/connectors/shopify/index.js";

/** The two a person may assert. `uninstall` is the provider's and is not here. */
const OPERATOR_REASONS: readonly RetirementReason[] = ["rotation", "revocation"];

const { values } = parseArgs({
  options: { shop: { type: "string" }, reason: { type: "string" } },
});

async function main(): Promise<void> {
  const shopId = values.shop;
  const reason = values.reason as RetirementReason | undefined;
  if (!shopId || !reason || !OPERATOR_REASONS.includes(reason)) {
    throw new Error(
      `usage: pnpm connector-retire-token --shop <shop-uuid> --reason ${OPERATOR_REASONS.join("|")}` +
        ` (uninstall is written only by the signed webhook that reports it)`
    );
  }

  const pool = new pg.Pool({ connectionString: resolveMigrateUrl() });
  const app = resolveAppCredentials();
  try {
    // ⚠ THE PROVIDER CALL HAPPENS BEFORE THE TRANSACTION, AND THE ORDER IS 041
    // §8.2's, applied to a credential instead of to a photograph: *"where an
    // operation spans a transactional store and a non-transactional one, the
    // non-transactional side goes first and the transactional side is the record
    // of it."* Append the retirement first and the call fails, and the row is a
    // permanent statement the append-only trigger forbids repairing. Call first
    // and the append fails, and the operator re-runs — the observation is
    // re-derived and nothing was recorded untruthfully.
    //
    // **The retirement is NOT contingent on the call succeeding.** This system
    // stopping is not something a provider gets a vote on, so a 4xx, a 5xx or a
    // transport failure still ends the token here and the receipt says what
    // happened.
    const live = (await loadTokenVersions(pool, shopId, CONNECTOR)).filter((v) => !v.retired);
    const observations = new Map<string, ProviderRevocationObservation>();
    if (reason === "revocation") {
      if (!app) {
        console.warn(
          `no connector app is configured (${SHOPIFY_APP_ENV.clientId} / ` +
            `${SHOPIFY_APP_ENV.clientSecret}), so NO provider-side revocation is attempted. The ` +
            `token is ended HERE only, and the receipt says so.`
        );
      } else {
        const ring = requireConnectorKey();
        for (const version of live) {
          // Opened for exactly as long as the call takes, and never printed.
          const token = await openTokenValue(pool, ring, shopId, version.id);
          observations.set(
            version.id,
            await revokeAtProvider({
              shopDomain: version.shopDomain,
              accessToken: token,
              apiVersion: app.apiVersion,
            })
          );
        }
      }
    }

    const receipts = await withTransaction(pool, async (tx) =>
      Promise.all(
        live.map((version) =>
          offboardTokenVersion(tx, {
            shopId,
            connectorTokenVersionId: version.id,
            reasonCode: reason,
            connector: CONNECTOR,
            versionNo: version.versionNo,
            shopDomain: version.shopDomain,
            grantedScopes: version.grantedScopes,
            providerRevocation: observations.get(version.id) ?? null,
            authoredBy: "human",
          })
        )
      )
    );

    if (receipts.length === 0) {
      console.log(
        "nothing to retire: this shop holds no live connector token version. An ending is written " +
          "once per version (UNIQUE), so this is a no-op rather than a second row."
      );
      return;
    }
    // EVERY live version, not just the newest: an overlap window is legal while
    // a rotation is proven, and leaving one behind would leave authority this
    // command was run to remove.
    for (const receipt of receipts) console.log(`${renderConnectorReceipt(receipt)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

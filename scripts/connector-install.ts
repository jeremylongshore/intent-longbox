// Start a Shopify connector install: mint the single-use state, print the URL.
//
//   pnpm connector-install --shop <shop-uuid> --domain <store>.myshopify.com
//
// ⚠ IT IS A CLI AND NOT A ROUTE, AND THAT IS THE E03-D06/E03-D07 PRECEDENT
// RATHER THAN A SHORTCUT. Starting an install is an OWNER act; 048 §7.3 puts
// owner acts in a privileged session; privileged sessions DO NOT EXIST (048
// §12.4 row 3a — this schema has no row shape for a person on their own laptop,
// because both session kinds are bound to an enrolled phone). A route that
// called itself privileged while nothing enforced privilege would be a worse
// artifact than an honest CLI, so the SERVICE is real and the door is this file.
// The merchant-facing landing an unlisted public app needs is declared and NOT
// registered in `AUTH_ALLOWLIST`, with E10-B02 named.
//
// WHAT IT PRINTS AND WHAT IT DOES NOT. It prints the authorization URL, which
// carries the `state` in the clear — because that is what a `state` parameter
// IS, a value the client round-trips. It prints no token: there is no token yet
// and there never will be one on this path, since the grant comes back to the
// callback route. The DATABASE holds `sha256(state)` and nothing else, so a
// database reader cannot mint a callback this server would accept.
//
// It connects with MIGRATE_DATABASE_URL for the reason `register-shop` does
// (E02-D06): it seeds a configuration row as the schema owner, and the app role
// owns nothing.
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { resolveMigrateUrl } from "./migrateUrl.js";
import {
  SHOPIFY_APP_ENV,
  SHOPIFY_FORBIDDEN_SCOPES,
  mintInstallState,
  resolveAppCredentials,
} from "../src/services/connectors/shopify/index.js";

const { values } = parseArgs({
  options: { shop: { type: "string" }, domain: { type: "string" } },
});

async function main(): Promise<void> {
  const shopId = values.shop;
  const shopDomain = values.domain;
  if (!shopId || !shopDomain) {
    throw new Error("usage: pnpm connector-install --shop <shop-uuid> --domain <store>.myshopify.com");
  }

  const app = resolveAppCredentials();
  if (!app) {
    throw new Error(
      `no connector app is configured. Set ${SHOPIFY_APP_ENV.clientId}, ` +
        `${SHOPIFY_APP_ENV.clientSecret} and ${SHOPIFY_APP_ENV.redirectUri} (values live in SOPS; ` +
        `the client secret is a value a PERSON obtains from a dashboard, so it stays under 050 §3's ` +
        `rule — an environment variable, never a column). Without the secret this deployment can ` +
        `verify no callback and no webhook, and it refuses rather than degrading.`
    );
  }

  const pool = new pg.Pool({ connectionString: resolveMigrateUrl() });
  try {
    const minted = await mintInstallState(pool, { shopId, shopDomain, app });
    console.log(
      [
        `Install state minted for shop ${shopId}, store ${shopDomain}.`,
        `Scope list version ${String(minted.scopeListVersion)} (this repository's count of how ` +
          `many times the authority it asks a merchant for has changed — not Shopify's API version).`,
        `Requesting: ${minted.requestedScopes.join(", ")}`,
        `NEVER requested: ${SHOPIFY_FORBIDDEN_SCOPES.map((s) => s.scope).join(", ")}`,
        `Valid until ${minted.expiresAt.toISOString()} — single use, and a replay is refused by a ` +
          `UNIQUE index rather than by a check somebody could forget.`,
        "",
        "Open this as the shop's owner, in a browser signed in to that Shopify admin:",
        minted.authorizeUrl,
        "",
        "Shopify will show the consent screen and redirect back to " +
          `${app.redirectUri}. The callback verifies the signature, spends the state and ` +
          "introduces the token version. Nothing publishes at any point.",
      ].join("\n")
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

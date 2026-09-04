// Onboard a shop in one command (multi-shop is real, not latent):
//   pnpm register-shop --name "Gotham City Limit" --slug gotham \
//     [--shopify-domain gotham-city-limit.myshopify.com] \
//     [--comp-percent 90] [--floor-cents 300] [--rounding nearest_99]
//
// Creates: shop row + credential key_refs (env var NAMES derived from the slug,
// never raw keys) + a default pricing policy. Prints the env vars to set.
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { DEFAULT_RETENTION } from "./retention-defaults.js";
import { resolveMigrateUrl } from "./migrateUrl.js";
import {
  deriveKeyRef,
  envSlug,
  findNamespaceClash,
  keyRefNamespace,
} from "../src/providers/credentialPolicy.js";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    slug: { type: "string" },
    "shopify-domain": { type: "string" },
    "comp-percent": { type: "string", default: "90" },
    "floor-cents": { type: "string", default: "300" },
    rounding: { type: "string", default: "nearest_99" },
  },
});

async function main(): Promise<void> {
  const name = values.name;
  const slug = values.slug;
  if (!name || !slug || !/^[a-z0-9-]+$/.test(slug)) {
    console.error(
      'usage: pnpm register-shop --name "Shop Name" --slug shop-slug [--shopify-domain x.myshopify.com]'
    );
    process.exit(1);
  }
  // Onboarding is an operator act, not an application request: it seeds config
  // rows and (once E03-B04's RLS lands) writes rows no tenant context covers. It
  // connects as the schema owner for the same reason `migrate.ts` does — see
  // scripts/migrateUrl.ts (E02-D06).
  const url = resolveMigrateUrl();

  // E03-D01 (046 §5 A7/A15): key_refs are derived, never typed, and they carry
  // the shop's own namespace — `LONGBOX_<SLUG>_<PROVIDER>_KEY`. The rows this
  // script writes are the ones `migrations/014`'s CHECK and
  // `resolveKeyRef(keyRef, shopSlug)` both accept; the older `SHOP_<SLUG>_<KIND>`
  // convention is gone, and a database still holding one fails migration 014
  // loudly rather than resolving a variable outside its shop.
  const refs = {
    anthropic: deriveKeyRef(slug, "anthropic"),
    shopify: deriveKeyRef(slug, "shopify"),
    pricecharting: deriveKeyRef(slug, "pricecharting"),
  } as const;

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    // ⚠ THE FOLD IS NOT INJECTIVE, AND THIS IS WHERE THAT IS PAID FOR (E03-D01,
    // invariant review). `envSlug` strips separators — `gotham-city` and
    // `gothamcity` both become `GOTHAMCITY` — because a fold that could not
    // collide would need to encode the separator, and a multi-segment env name is
    // exactly what let one shop read a sibling's variable. Collisions are
    // therefore refused at the ONE place a second colliding slug can be created,
    // rather than tolerated and then explained. Two shops sharing a namespace
    // would each satisfy every check in the system while reading each other's
    // keys, which is the defect this whole bead exists to remove.
    const existing = await client.query(`SELECT slug FROM shop`);
    const clash = findNamespaceClash(
      slug,
      (existing.rows as Array<{ slug: string }>).map((row) => row.slug)
    );
    if (clash) {
      await client.query("ROLLBACK");
      console.error(
        `refusing: shop '${clash}' already owns the credential namespace ` +
          `${keyRefNamespace(slug)} (both slugs fold to '${envSlug(slug)}'). ` +
          `Pick a slug that does not collide once separators are stripped.`
      );
      process.exit(1);
    }
    const shopRes = await client.query(
      `INSERT INTO shop (name, slug, shopify_domain) VALUES ($1, $2, $3) RETURNING id`,
      [name, slug, values["shopify-domain"] ?? null]
    );
    const shopId = (shopRes.rows[0] as { id: string }).id;
    for (const [kind, keyRef] of Object.entries(refs)) {
      await client.query(`INSERT INTO shop_credentials (shop_id, kind, key_ref) VALUES ($1, $2, $3)`, [
        shopId,
        kind,
        keyRef,
      ]);
    }
    await client.query(
      `INSERT INTO shop_pricing_policy (shop_id, comp_percent, floor_cents, rounding_rule)
       VALUES ($1, $2, $3, $4)`,
      [shopId, Number(values["comp-percent"]), Number(values["floor-cents"]), values.rounding]
    );
    // Default retention policies (022 P7 Q6, seeded by migration 003 for shops
    // that already existed; new shops get them here). A policy change is a NEW
    // row for the same (shop, class) pair — these are the first rows, not the
    // only ones.
    for (const policy of DEFAULT_RETENTION) {
      await client.query(
        `INSERT INTO retention_policy (shop_id, artifact_class, anchor, window_days, ceiling_days)
         VALUES ($1, $2, $3, $4, $5)`,
        [shopId, policy.artifactClass, policy.anchor, policy.windowDays, policy.ceilingDays]
      );
    }
    await client.query("COMMIT");
    console.log(`shop registered: ${name} (${slug})`);
    console.log(`shop_id: ${shopId}`);
    console.log("\nSet these env vars (via SOPS/.env, never committed) to give this shop its own keys.");
    console.log(
      "There is NO global fallback for a shop that has credential rows (E03-D01): leaving one unset\n" +
        "means the vision provider REFUSES for this shop and the Shopify/PriceCharting clients STUB —\n" +
        "the estate's global key is never silently substituted for a shop's own."
    );
    for (const ref of Object.values(refs)) console.log(`  ${ref}=`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

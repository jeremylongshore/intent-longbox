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
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const envSlug = slug.toUpperCase().replace(/-/g, "_");
  const refs = {
    anthropic: `SHOP_${envSlug}_ANTHROPIC_API_KEY`,
    shopify: `SHOP_${envSlug}_SHOPIFY_ADMIN_TOKEN`,
    pricecharting: `SHOP_${envSlug}_PRICECHARTING_TOKEN`,
  };

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
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
    console.log("\nSet these env vars (via SOPS/.env, never committed) to give this shop its own keys;");
    console.log(
      "leave them unset to fall back to the global ANTHROPIC_API_KEY / SHOPIFY_ADMIN_TOKEN / PRICECHARTING_TOKEN:"
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

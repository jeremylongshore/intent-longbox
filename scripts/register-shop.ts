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
import type { Tx } from "../src/db.js";
import {
  mintDeviceCredential,
  pinRefusal,
  recordRecoveryNomination,
  requirePinPepper,
  setOperatorPin,
} from "../src/services/auth/index.js";

/** 048 §8.2's three answers, as the shape this script resolves its flags into. */
type Nomination =
  | { kind: "second_owner"; email: string; name: string }
  | { kind: "named_contact"; name: string; note?: string }
  | { kind: "declined" };

/**
 * **The ASK is mandatory; the NOMINATION is not** (048 §8.2, E03-D06).
 *
 * The record is explicit that "a shop that declines proceeds", so this never
 * refuses a shop for having one person. What it refuses is SILENCE — a run with
 * none of the three flags — and the reason is the sentence the whole clause exists
 * for: *"the difference between 'this owner has no second person' and 'nobody
 * asked' is the difference between a known residual and a surprise during an
 * outage."* A flag that could be omitted would make every shop's row read "nobody
 * asked", which is the blank field the record refuses.
 *
 * The CHARTER wording — how the question is put to an owner, and what they are
 * told it is for — is E01-B05's (048 §12.4 row 4c) and is not invented here. This
 * is the technical capture that wording will fill in.
 */
function nominationFrom(): Nomination {
  const secondEmail = values["second-owner-email"];
  const contact = values["recovery-contact"];
  const declined = values["no-recovery-contact"] === true;
  const chosen = [secondEmail !== undefined, contact !== undefined, declined].filter(Boolean).length;

  if (chosen !== 1) {
    console.error(
      "048 §8.2: a shop's recovery nomination is ASKED at registration and may be DECLINED, but " +
        "it may not be skipped. Pass exactly one of:\n" +
        '  --second-owner-email <addr> --second-owner-name "<name>"   (the strictly better answer:\n' +
        "        a second person with their own factors, who can restore the first without Longbox)\n" +
        '  --recovery-contact "<name>" [--recovery-note "<how to reach them out of band>"]\n' +
        "        (not a credential and grants nothing — the identity check E11-B09's break-glass\n" +
        "        runbook performs against, so it stops being 'the person who emailed sounds right')\n" +
        "  --no-recovery-contact\n" +
        "        (a recorded DECLINE. The shop proceeds; the residual is known rather than a\n" +
        "        surprise during an outage.)"
    );
    process.exit(1);
  }

  if (declined) return { kind: "declined" };
  if (secondEmail !== undefined) {
    const secondName = values["second-owner-name"];
    if (!secondName) {
      console.error("--second-owner-email also needs --second-owner-name");
      process.exit(1);
    }
    return { kind: "second_owner", email: secondEmail, name: secondName };
  }
  const note = values["recovery-note"];
  return { kind: "named_contact", name: contact!, ...(note === undefined ? {} : { note }) };
}

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    slug: { type: "string" },
    "shopify-domain": { type: "string" },
    "comp-percent": { type: "string", default: "90" },
    "floor-cents": { type: "string", default: "300" },
    rounding: { type: "string", default: "nearest_99" },
    // 034 §4.5 — the four rows E03-D09's schema makes onboarding responsible for.
    org: { type: "string" },
    "owner-email": { type: "string" },
    timezone: { type: "string", default: "UTC" },
    // 048 §8.2 — the ASK is mandatory, the NOMINATION is not (E03-D06). Exactly
    // one of these three is required; see `nominationFrom` below for the argument.
    "second-owner-email": { type: "string" },
    "second-owner-name": { type: "string" },
    "recovery-contact": { type: "string" },
    "recovery-note": { type: "string" },
    "no-recovery-contact": { type: "boolean" },
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
  // 048 §8.2's ask, resolved BEFORE the database is touched: a shop that would be
  // refused for silence should be refused before it half-exists.
  const nomination = nominationFrom();
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
    // 034 §4.5 steps 1–5, inside the SAME transaction as everything below.
    //
    // ONE ORGANIZATION PER SHOP, 1:1, ALWAYS (034 §4.5, A4). This script never
    // reuses an existing organization row and offers no `--existing-org` flag:
    // grouping two shops under one legal entity is a deliberate, later, manual
    // act with its own consent consequences, and it is not something an
    // onboarding script does by matching a name string.
    const orgRes = await client.query(`INSERT INTO organization (name) VALUES ($1) RETURNING id`, [
      values.org ?? name,
    ]);
    const organizationId = (orgRes.rows[0] as { id: string }).id;

    const shopRes = await client.query(
      `INSERT INTO shop (name, slug, shopify_domain, organization_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, slug, values["shopify-domain"] ?? null, organizationId]
    );
    const shopId = (shopRes.rows[0] as { id: string }).id;

    // One `store` location. A shop with one storefront never sees the concept
    // (034 §2.4); the online store, when a shop has one, is a SECOND location
    // rather than a boolean, because a draft created against it has different
    // custody than one created at the counter.
    const locationRes = await client.query(
      `INSERT INTO location (shop_id, kind, name, timezone) VALUES ($1,'store',$2,$3) RETURNING id`,
      [shopId, name, values.timezone]
    );
    const locationId = (locationRes.rows[0] as { id: string }).id;

    // The owner, as a SUBJECT with no credential (034 §2.5, §4.5 step 4). Until
    // E03-D06's password flow lands there is nothing here to log in WITH, and
    // that is the honest state rather than a gap: the operator PIN below is a
    // different credential for a different principal.
    //
    // The default address is under `.invalid` — the reserved TLD that can never
    // resolve — so an operator who does not pass `--owner-email` gets an address
    // that is visibly a placeholder instead of one that looks like a real inbox.
    const ownerEmail = (values["owner-email"] ?? `owner+${slug}@longbox.invalid`).toLowerCase();
    const userRes = await client.query(
      `INSERT INTO app_user (email, display_name) VALUES ($1,$2)
       ON CONFLICT (email) DO UPDATE SET display_name = app_user.display_name
       RETURNING id`,
      [ownerEmail, values.org ?? name]
    );
    const ownerId = (userRes.rows[0] as { id: string }).id;

    // The bootstrap grant — the ONE permitted `granted_by IS NULL` (034 §2.7).
    await client.query(
      `INSERT INTO membership (app_user_id, shop_id, scope_kind, organization_id, role, granted_by)
       VALUES ($1,$2,'organization',$3,'owner',NULL)`,
      [ownerId, shopId, organizationId]
    );
    // TWO ROWS PER CREDENTIAL, AND THE SECOND ONE IS THE AUTHORITY (E03-B05,
    // 050 §4). `shop_credentials` is still written because it is where
    // `base_url` lives and because migration 021 keeps it as the record of what
    // the shop was configured with; `shop_credential_version` is what the
    // resolver READS. Writing only the first would produce a shop that
    // `declaredCredential` refuses — deliberately, because the alternative is a
    // shop silently spending the estate's key (050 §1 E4).
    //
    // `authored_by` is 'system': this seed is authored by the onboarding script,
    // not by a person, and 048 §3.5's RULE means the column would be an
    // attribution of record either way.
    for (const [kind, keyRef] of Object.entries(refs)) {
      await client.query(`INSERT INTO shop_credentials (shop_id, kind, key_ref) VALUES ($1, $2, $3)`, [
        shopId,
        kind,
        keyRef,
      ]);
      await client.query(
        `INSERT INTO shop_credential_version (shop_id, kind, key_ref, version_no, authored_by)
         VALUES ($1, $2, $3, 1, 'system')`,
        [shopId, kind, keyRef]
      );
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
    // 048 §8.2 — the answer, recorded as a fact including when it is "no".
    //
    // A SECOND OWNER is the strictly better answer and is the one this script can
    // actually deliver: it is a person with their own factors who can restore the
    // first without Longbox touching anything, and 034 §2.6's "the 19% with a
    // second storefront" is about `manager`, not about whether a shop has a second
    // human — a spouse, a partner or a business co-owner is not a storefront.
    const nominatedBy = ownerId;
    if (nomination.kind === "second_owner") {
      const second = await client.query(
        `INSERT INTO app_user (email, display_name) VALUES ($1,$2)
         ON CONFLICT (email) DO UPDATE SET display_name = app_user.display_name
         RETURNING id`,
        [nomination.email.toLowerCase(), nomination.name]
      );
      const secondOwnerId = (second.rows[0] as { id: string }).id;
      // A SECOND bootstrap grant, and the only other one this script writes. 034
      // §2.7 permits `granted_by IS NULL` for a bootstrap; this one names the first
      // owner instead, because there is somebody to name.
      await client.query(
        `INSERT INTO membership (app_user_id, shop_id, scope_kind, organization_id, role, granted_by)
         VALUES ($1,$2,'organization',$3,'owner',$4)`,
        [secondOwnerId, shopId, organizationId, ownerId]
      );
    }
    await recordRecoveryNomination(client as unknown as Tx, {
      shopId,
      kind: nomination.kind,
      contactName: nomination.kind === "named_contact" ? nomination.name : null,
      contactNote: nomination.kind === "named_contact" ? (nomination.note ?? null) : null,
      nominatedBy,
    });

    const bootstrap = await bootstrapDevice(client, { shopId, locationId, ownerId, ownerEmail });

    await client.query("COMMIT");
    console.log(`shop registered: ${name} (${slug})`);
    console.log(`shop_id: ${shopId}`);
    console.log(`organization_id: ${organizationId}   location_id: ${locationId}`);
    console.log(`owner: ${ownerEmail} (${ownerId}) — membership: owner @ organization scope`);
    console.log(
      nomination.kind === "second_owner"
        ? `recovery: a SECOND OWNER (${nomination.email}) holds their own factors and can restore ` +
            `the first without Longbox touching anything (048 §8.2)`
        : nomination.kind === "named_contact"
          ? `recovery: a NAMED CONTACT is recorded. It is not a credential and grants nothing — it ` +
            `is what E11-B09's break-glass runbook verifies against (048 §8.2)`
          : `recovery: DECLINED, and recorded as a decline rather than a blank field. This shop has ` +
            `one person; if they lose their factors and their codes, the only path is 048 §8.2's ` +
            `Longbox-operated break-glass under E11-B09's runbook`
    );
    if (bootstrap) {
      console.log("\n--- LOCAL BOOTSTRAP (development only) ---");
      console.log("One phone was enrolled and the owner given an operator PIN, so the local flow");
      console.log("is usable end to end. Give the phone its device session ONCE:");
      console.log(
        `  curl -i -X POST http://localhost:3000/api/v1/device-sessions \\\n` +
          `    -H 'content-type: application/json' -H 'idempotency-key: bootstrap-1' \\\n` +
          `    -H 'sec-fetch-site: same-origin' \\\n` +
          `    -d '{"device_secret":"${bootstrap.secret}"}'`
      );
      console.log("The response's Set-Cookie is the device session. It is shown ONCE and stored");
      console.log("only as a sha256 digest; losing it means enrolling the phone again.");
    } else {
      console.log(
        "\nNo device was enrolled (034 §4.5: seeding a fake counter phone would put rows in a " +
          "shop's data\nthat nobody at the shop made). For LOCAL development set " +
          `${BOOTSTRAP_PIN_ENV} to a six-digit PIN\nand re-run with NODE_ENV unset or 'development'.`
      );
    }
    console.log("\nSet these env vars (via SOPS/.env, never committed) to give this shop its own keys.");
    console.log(
      // E03-B05 (050 §4) MOVED THE CONDITION. The rule used to key on "has
      // credential rows" (E03-D01); it now keys on "has a LIVE credential
      // version", which is the same rule one step stronger: retiring a shop's
      // last version also stops the estate's key being substituted, so a
      // deletion makes the shop refuse rather than quietly spend somebody
      // else's money. This run wrote version 1 of each name below.
      "There is NO global fallback for a shop that has a LIVE credential version (050 §4, extending\n" +
        "E03-D01's rule from 'has a row'): leaving one unset means the vision provider REFUSES for this\n" +
        "shop and the Shopify/PriceCharting clients STUB — the estate's global key is never silently\n" +
        "substituted for a shop's own. Retiring every version refuses too, and never falls back."
    );
    for (const ref of Object.values(refs)) console.log(`  ${ref}=`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

/** The env var that opts a LOCAL run into enrolling one phone. */
const BOOTSTRAP_PIN_ENV = "LONGBOX_BOOTSTRAP_PIN";
/** Optional; a label for the enrolled phone so a developer can tell it apart. */
const BOOTSTRAP_LABEL_ENV = "LONGBOX_BOOTSTRAP_DEVICE_LABEL";

/**
 * Enrol ONE phone and give the owner a PIN — **development only**.
 *
 * 034 §4.5 is explicit that onboarding creates "no `device`, no `bin`, no
 * `batch`": those are created in the flow by the people who own them, and
 * seeding a fake "counter phone" would put rows in a shop's data that nobody at
 * the shop made. That rule is kept — this runs only when a developer sets
 * `LONGBOX_BOOTSTRAP_PIN` and `NODE_ENV` is not `production`, and it exists for
 * one reason: after E03-D09 every shop-scoped route is behind a device session
 * plus an operator session, so without it a fresh local database cannot run the
 * scan flow at all and the first thing anybody would do is comment out the hook.
 *
 * **A convenience that is unavailable in production is a convenience; one that
 * merely defaults off is a foot-gun with a comment.** Hence both conditions.
 *
 * The real enrollment flow — a one-time, short-lived, shop-scoped code an owner
 * generates in a privileged session and an employee redeems ON THE DEVICE — is
 * E03-D07's (048 §7.3, §7.1a). This is the seam it replaces, not a shape it has
 * to undo.
 */
async function bootstrapDevice(
  client: pg.Client,
  args: { shopId: string; locationId: string; ownerId: string; ownerEmail: string }
): Promise<{ secret: string } | undefined> {
  const pin = process.env[BOOTSTRAP_PIN_ENV] ?? "";
  if (pin === "") return undefined;
  if ((process.env.NODE_ENV ?? "development") === "production") {
    throw new Error(
      `${BOOTSTRAP_PIN_ENV} is set and NODE_ENV is production. This flag enrols a phone and ` +
        `writes an operator PIN, which in production would be a credential nobody at the shop ` +
        `chose. Unset it, and enrol the phone through E03-D07's flow.`
    );
  }
  const refusal = pinRefusal(pin);
  if (refusal) {
    throw new Error(
      `${BOOTSTRAP_PIN_ENV} is refused (${refusal}). The rule is the shop's rule: six digits, ` +
        `not a sequence, not a repeat, not the shop's own published digits (048 §3.5). A ` +
        `bootstrap that skipped the policy would be testing a flow the pilot does not have.`
    );
  }
  const pepper = requirePinPepper();

  // `pg.Client` is not the `PoolClient` the `Tx` type names, and the difference
  // is `release()` — which a script that owns its own connection has no use for.
  // Every statement below runs on this one connection inside the one BEGIN above,
  // which is the property 041 §4.1's `Tx` exists to guarantee.
  const tx = client as unknown as Tx;

  const deviceRes = await client.query(
    `INSERT INTO device (shop_id, location_id, label, kind) VALUES ($1,$2,$3,'phone') RETURNING id`,
    [args.shopId, args.locationId, process.env[BOOTSTRAP_LABEL_ENV] ?? "local bootstrap phone"]
  );
  const deviceId = (deviceRes.rows[0] as { id: string }).id;

  const credential = await mintDeviceCredential(tx, {
    shopId: args.shopId,
    deviceId,
    enrolledBy: args.ownerId,
  });
  const set = await setOperatorPin(tx, {
    shopId: args.shopId,
    deviceId,
    appUserId: args.ownerId,
    pin,
    pepper,
  });
  if (!set.ok) throw new Error(`refusing the bootstrap PIN: ${set.refusal}`);
  return { secret: credential.secret };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

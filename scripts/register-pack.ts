// Register one vertical pack in one command (E04-B04):
//   pnpm register-pack --vertical comic
//   pnpm register-pack --vertical comic --dry-run
//
// ⚠ THERE IS NO MIGRATION FOR THIS, AND THAT IS THE DESIGN, NOT A SHORTCUT.
// 030 §3.2 reason 1: *"'Add a vertical' must not mean 'change the database.'"*
// `vertical_pack` and `vertical_pack_version` are shipped tables with a text
// primary key (`migrations/016_catalog_core.sql:82`), so registering a pack is an
// INSERT of DATA. 049 §6.5 already proved the whole card path against a real
// database "without one line of DDL"; putting a pack row in a migration would
// make every future vertical a deploy, a rollback plan and an entry in the
// migration ledger — the exact cost option (a) was chosen to avoid.
//
// ⚠ AND IT IS AN OPERATOR SCRIPT, NOT A SEED AT BOOT. Two reasons, and the second
// is the load-bearing one:
//
//   1. THE APP ROLE IS REFUSED, BY A CHECK AND NOT BY A CONVENTION. E02-D06 gives
//      migrations `MIGRATE_DATABASE_URL` and the application `DATABASE_URL`, and
//      the server refuses to boot on a connection whose role owns an append-only
//      table. **`resolveMigrateUrl` FALLS BACK to `DATABASE_URL` outside
//      production, and the app role has `INSERT` on every table through
//      `pnpm grant-app-role`** — so calling it alone would let this script seed as
//      the app role and succeed, writing rows indistinguishable from the owner's.
//      `assertSchemaOwnerOrThrow` closes that: it is the boot assertion read from
//      the other end, refusing a connection that owns NONE of the declared
//      append-only tables. A boot-time seed inside the server could never pass it,
//      because the serving connection must fail it by construction.
//   2. REGISTRATION IS NOT AUTHORISATION, AND A SEED WOULD BLUR THAT. 030 §5.4:
//      "architectural possibility is not market permission", and E19-B06 gates
//      any second vertical on reuse, rights, accuracy, economics and demand
//      evidence. A boot seed that inserted every shipped manifest would register
//      two card verticals in production on the next deploy, silently, as a side
//      effect of shipping code that only proves the core is not comic-shaped.
//      So `--vertical` is REQUIRED and has no default: registering a card
//      vertical is a typed act by a person who meant it.
//
// The script is idempotent. Re-running it with an unchanged manifest is a no-op;
// re-running it with a CHANGED manifest at the same `packVersion` is REFUSED,
// which is 030 A5's single-rate rule enforced where it can be — against what is
// already on disk (`assertVersionMoved`).
import "dotenv/config";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { join } from "node:path";
import pg from "pg";
import { resolveMigrateUrl } from "./migrateUrl.js";
import { REPO_ROOT } from "./architectureRules.js";
import { assertSchemaOwnerOrThrow } from "../src/services/roleSeparation.js";
import {
  MANIFESTS,
  assertCertified,
  assertVersionMoved,
  canonicalManifest,
  certify,
  manifestFor,
} from "../src/catalog/index.js";

const { values } = parseArgs({
  options: {
    vertical: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

async function main(): Promise<void> {
  const vertical = values.vertical;
  if (!vertical) {
    console.error(
      `usage: pnpm register-pack --vertical <name> [--dry-run]\n` +
        `manifests shipped in this build: ${[...MANIFESTS.keys()].join(", ")}\n\n` +
        `There is deliberately no default. Registering a vertical other than "comic" is gated by\n` +
        `E19-B06 on reuse, rights, accuracy, economics and demand evidence — "architectural\n` +
        `possibility is not market permission" (030 §5.4).`
    );
    process.exit(1);
  }

  const manifest = manifestFor(vertical);
  if (manifest === undefined) {
    console.error(
      `no manifest ships for vertical ${JSON.stringify(vertical)}. ` +
        `This build ships: ${[...MANIFESTS.keys()].join(", ")}.`
    );
    process.exit(1);
  }

  // CERTIFY BEFORE ANYTHING ELSE. A `vertical_pack_version` row can never be
  // updated, and every later `collectible_definition` and `edition` in this
  // vertical cites it, so a manifest that is wrong is wrong forever for every row
  // that names it.
  const findings = certify(manifest);
  if (findings.length > 0) {
    console.error(`pack manifest for ${JSON.stringify(vertical)} FAILS certification:`);
    for (const f of findings) console.error(`  [${f.code}] ${f.message}`);
    process.exit(1);
  }
  assertCertified(manifest);

  // The one certification check that needs the filesystem: 030 §5.2's
  // "the pack registry resolves it at boot and FAILS CLOSED if it is missing".
  if (!existsSync(join(REPO_ROOT, manifest.signatureFnRef))) {
    console.error(
      `signatureFnRef ${JSON.stringify(manifest.signatureFnRef)} does not exist. 030 §5.2: a registered ` +
        `pack whose signature function has been deleted must stop the process, not silently mis-dedupe.`
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: resolveMigrateUrl() });
  await client.connect();
  // BEFORE ANY WRITE, AND OUTSIDE THE TRANSACTION so a refusal never issues a
  // ROLLBACK with nothing to roll back. `resolveMigrateUrl` falls back to
  // DATABASE_URL outside production, so without this the app role — which has
  // INSERT through `pnpm grant-app-role` — would seed the pack rows and succeed
  // silently. This is `assertRoleSeparationOrThrow` inverted.
  try {
    await assertSchemaOwnerOrThrow(client);
  } catch (err) {
    await client.end();
    throw err;
  }
  try {
    await client.query("BEGIN");

    // `vertical_pack` is INSERT-ONLY (030 §7): a pack is registered once and
    // evolves by a new `vertical_pack_version` row. So a re-run must not attempt
    // a second INSERT, and a DIFFERENT code for an already-registered vertical
    // must be refused rather than ignored — the code is inside every LCID already
    // minted in this vertical (047 §3.1) and cannot be changed by re-registering.
    const existingPack = await client.query<{ vertical_code: string }>(
      `SELECT vertical_code FROM vertical_pack WHERE vertical = $1`,
      [vertical]
    );
    if (existingPack.rowCount === 0) {
      await client.query(`INSERT INTO vertical_pack (vertical, vertical_code) VALUES ($1, $2)`, [
        vertical,
        manifest.verticalCode,
      ]);
    } else if (existingPack.rows[0]!.vertical_code !== manifest.verticalCode) {
      await client.query("ROLLBACK");
      console.error(
        `refusing: ${JSON.stringify(vertical)} is registered with vertical_code ` +
          `${JSON.stringify(existingPack.rows[0]!.vertical_code)} and the manifest says ` +
          `${JSON.stringify(manifest.verticalCode)}. The code is a segment of every LCID already minted ` +
          `in this vertical (047 §3.1) and "the prefix may encode a fact if and only if that fact can ` +
          `never be corrected" (047 §2). Changing it is a retire-and-re-mint of every affected LCID ` +
          `(049 §4), not an UPDATE.`
      );
      process.exit(1);
    }

    const latest = await client.query<{ pack_version: number; manifest: unknown }>(
      `SELECT pack_version, manifest FROM vertical_pack_version
        WHERE vertical = $1 ORDER BY pack_version DESC LIMIT 1`,
      [vertical]
    );
    const previous = latest.rowCount === 0 ? undefined : latest.rows[0]!;

    if (previous !== undefined) {
      assertVersionMoved({ packVersion: previous.pack_version, manifest: previous.manifest }, manifest);
    }

    const unchanged =
      previous !== undefined &&
      previous.pack_version === manifest.packVersion &&
      canonicalManifest(previous.manifest) === canonicalManifest(manifest);

    if (unchanged) {
      await client.query(values["dry-run"] ? "ROLLBACK" : "COMMIT");
      console.log(
        `pack ${manifest.displayName} (${vertical}, ${manifest.verticalCode}) already registered at ` +
          `version ${manifest.packVersion}; nothing to do.`
      );
      return;
    }

    if (values["dry-run"]) {
      await client.query("ROLLBACK");
      console.log(
        `dry run: would register ${manifest.displayName} (${vertical}, ${manifest.verticalCode}) at ` +
          `pack version ${manifest.packVersion}. Nothing was written.`
      );
      return;
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO vertical_pack_version (vertical, pack_version, manifest, signature_fn_ref, supersedes_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        vertical,
        manifest.packVersion,
        JSON.stringify(manifest),
        manifest.signatureFnRef,
        previous === undefined
          ? null
          : (
              await client.query<{ id: string }>(
                `SELECT id FROM vertical_pack_version WHERE vertical = $1 AND pack_version = $2`,
                [vertical, previous.pack_version]
              )
            ).rows[0]!.id,
      ]
    );

    await client.query("COMMIT");
    console.log(`pack registered: ${manifest.displayName} (${vertical}, code ${manifest.verticalCode})`);
    console.log(`vertical_pack_version.id: ${inserted.rows[0]!.id} (pack_version ${manifest.packVersion})`);
    // Printed unconditionally rather than only for a second vertical. A message
    // that appeared only for cards would be a vertical branch in an operator
    // tool, and the sentence is true of every pack anyway.
    console.log(
      `\nRegistering a vertical is not launching one. E19-B06 gates a second vertical on reuse,\n` +
        `rights, accuracy, economics and demand evidence, and no corpus, provider or shop for this\n` +
        `vertical exists because a row does.`
    );
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

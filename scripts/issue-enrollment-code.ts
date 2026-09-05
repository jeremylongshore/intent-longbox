// Issue a device enrollment code for one phone at one location, printed ONCE.
//
//   pnpm issue-enrollment-code --shop <uuid> --location <uuid> \
//     --by <owner-or-manager-app-user-uuid> --label "counter phone" \
//     [--kind phone|kiosk|tablet]
//
// **Why this is a script and not a route** is the same reason
// `issue-invitation.ts` gives at length and is not repeated here: 048 §7.3 makes
// this an owner-or-manager act IN A PRIVILEGED SESSION, privileged sessions are
// E03-D06's, and a route that called itself privileged while nothing enforced
// privilege would be worse than an honest CLI. The role and the location are
// both checked by `issueEnrollmentCode`; the session is not attempted.
//
// **The code is 128 bits and is meant to be scanned or pasted, not typed.**
// 048 §7.1a permits a short code only with the device binding, and the caller of
// a device enrollment IS the phone being enrolled — it holds no session, which
// is what enrollment means — so the binding is unavailable and the long form is
// the only permitted one. `src/services/auth/enrollment.ts` argues it in full.
//
// It is shown once and stored nowhere (`migrations/024` holds `sha256` and
// nothing else). Do not add a way to see it again.
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { resolveMigrateUrl } from "./migrateUrl.js";
import { withTransaction } from "../src/db.js";
import { issueEnrollmentCode, type DeviceKind } from "../src/services/auth/index.js";

const KINDS: readonly DeviceKind[] = ["phone", "kiosk", "tablet"];

const { values } = parseArgs({
  options: {
    shop: { type: "string" },
    location: { type: "string" },
    by: { type: "string" },
    label: { type: "string" },
    kind: { type: "string", default: "phone" },
  },
});

async function main(): Promise<void> {
  const { shop, location, by, label } = values;
  const kind = values.kind as DeviceKind;
  if (!shop || !location || !by || !label) {
    throw new Error(
      "usage: pnpm issue-enrollment-code --shop <uuid> --location <uuid> --by <app-user-uuid> " +
        '--label "<phone label>" [--kind phone|kiosk|tablet]'
    );
  }
  if (!KINDS.includes(kind)) throw new Error(`--kind must be one of ${KINDS.join(", ")}`);

  const pool = new pg.Pool({ connectionString: resolveMigrateUrl() });
  try {
    const out = await withTransaction(pool, (tx) =>
      issueEnrollmentCode(tx, {
        shopId: shop,
        locationId: location,
        deviceLabel: label,
        deviceKind: kind,
        issuedBy: by,
        now: new Date(),
      })
    );

    if (!out.ok) {
      const why = {
        not_permitted:
          "the issuer's live role at that shop does not carry `device.enrollment.issue`, or " +
          "carries it at another location (048 §7.3, 054 §3)",
        unknown_location: "that location does not belong to that shop (034 I7)",
        too_many_outstanding:
          "that shop already has the maximum number of outstanding enrollment codes (048 §7.1a)",
      }[out.refusal];
      throw new Error(why);
    }

    console.log("");
    console.log("Enrollment code (shown ONCE, and stored nowhere):");
    console.log(`  ${out.enrollment.code}`);
    console.log("");
    console.log(`  expires:  ${out.enrollment.expiresAt.toISOString()}`);
    console.log(`  location: ${location}`);
    console.log(`  label:    ${label} (${kind})`);
    console.log("");
    console.log("Scan or paste it on the phone being set up. It is long on purpose: this");
    console.log("code cannot be bound to a device that does not exist yet, so its entropy is");
    console.log("what bounds guessing it (048 §7.1a).");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

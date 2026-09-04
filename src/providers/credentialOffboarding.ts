// The offboarding receipt: what was made unreachable, by which steps, and the
// sentence it may never contain.
//
// Bead: longbox-e5b.3.5 (alias E03-B05), the code half. Docs: 050 §2 Q1 (the
// tmpfs custody ruling), §2 Q3 (the three steps and the receipt), §5, §9 I10;
// 041 §8 (offboarding), §8.2 (a receipt may not contain a false statement),
// §8.7(c) (a receipt is minimal); 018 (an unverified third-party act is not a
// fact); 021 §2 and B15/B16 (what may be SAID about any of this).
//
// WHAT A RECEIPT IS FOR. 041 §8.2's rule is that a receipt must not say
// something untrue. The untrue sentence available here is *"your credential has
// been revoked"* — because Longbox cannot revoke a BYOK key. The key is the
// shop's, held at the provider, and it stays valid there whether or not this
// repository ever mentions it again. So the receipt states the three steps that
// were actually performed, names the file the restart re-derived, and stops.
//
// ⚠ THIS IS DEVELOPER/OPERATOR TEXT, NOT SHOP-FACING COPY. 050 §5 routes the
// wording a shop receives at offboarding to a candidate C-row for `000-docs/021`
// under the T26 pre-send, drafted with the pilot paperwork — *"it is not written
// here"*. Nothing in this module may be pasted into a shop-facing surface
// without going through that step.
import { retireCredentialVersion, type AuthoredBy } from "./credentialVersions.js";
import type { Queryable } from "../db.js";

/**
 * **The rendered environment file lives on TMPFS, and the path is part of the
 * receipt** (050 §2 Q1 as amended at v1.0.1, §3).
 *
 * A mode-0600 root-owned file is still a file, and the property that matters is
 * not its mode — it is that a persistent one survives a reboot, a snapshot and a
 * backup pass. Under `/etc` or `/var` the plaintext reaches the borg repository,
 * then the VPS replica, then Backblaze B2 under Object Lock, which is the same
 * 30-day-undeletable trap that condemns the encrypted-column design. `/run` and
 * `/dev/shm` are outside every backup source root by construction, so no exclude
 * rule has to be maintained for them.
 *
 * ⚠ THE UNIT FILE IS NOT THIS BEAD'S (050 §13 item 7). The `RuntimeDirectory=`,
 * the `ExecStartPre=` decrypt, the mandatory `EnvironmentFile=` with no leading
 * `-`, and the boundary check that every `LONGBOX_*` name in the rendered file is
 * declared in the SOPS file are all **E13**'s. This constant is the PATH the
 * receipt names, so the code half and the operations half cannot disagree about
 * which file a restart re-derived.
 */
export const TMPFS_ENV_FILE_PATH = "/run/intentsolutions/longbox.env";

/** `reason_code` for an offboarding retirement (the `022` registry). */
export const OFFBOARDING_REASON_CODE = "offboarding";

/**
 * The three steps of 050 §2 Q3, in order, as text a receipt quotes verbatim.
 *
 * **THREE, not four.** v1.0.0 of the record had a fourth — a person editing a
 * file on the host — and the tmpfs amendment removed it, because
 * `ExecStartPre` re-derives the rendered file from the SOPS source at every
 * start. *A step removed is a step that cannot be skipped.*
 */
export const OFFBOARDING_STEPS: readonly [string, string, string] = [
  "the LONGBOX_* line was removed from the SOPS-encrypted source file and the file re-encrypted",
  `the service was restarted, which re-derived ${TMPFS_ENV_FILE_PATH} from that source and ` +
    "therefore both dropped the variable and destroyed the previous rendered plaintext",
  "a retirement row was appended, after which this system refuses to resolve that credential",
];

/**
 * What the receipt says about what it did NOT achieve (050 §2 Q3, §5(b)).
 *
 * Stated rather than mitigated, and in the receipt rather than in a footnote,
 * because the shop's next action depends on it.
 */
export const OFFBOARDING_RESIDUAL =
  "This does not reach the provider. The value remains in every prior revision of the " +
  "SOPS-encrypted source file, in version control and in every backup of it, and the " +
  "credential stays valid at the provider until it is revoked there. Revoking at the " +
  "provider is the shop's act and only the shop can perform it.";

/**
 * A minimal receipt (041 §8.7(c)): what was made unreachable, by which steps.
 *
 * ⚠ WHAT IS ABSENT IS THE DESIGN. There is no key value, no ciphertext, no
 * digest of a value, and **no field asserting that the provider-side credential
 * was revoked** — only `provider_revocation_instructed_at`, which is a fact
 * about a Longbox act (050 §2 Q3). `key_ref` is an environment variable NAME.
 */
export interface OffboardingReceipt {
  readonly shop_id: string;
  readonly credential_version_id: string;
  readonly kind: string;
  /** A NAME, never a value. */
  readonly key_ref: string;
  readonly reason_code: typeof OFFBOARDING_REASON_CODE;
  readonly retired_at: string;
  /** When the shop was TOLD to revoke at the provider, or null. Never "did revoke". */
  readonly provider_revocation_instructed_at: string | null;
  readonly steps: readonly [string, string, string];
  readonly rendered_env_file: typeof TMPFS_ENV_FILE_PATH;
  readonly residual: string;
}

/**
 * Retire a credential as part of an offboarding and return the receipt.
 *
 * **The refusal is what makes the receipt true** (050 §5(a), §9 I7). The
 * retirement row takes effect at the RESOLVER immediately, while the environment
 * variable is still set — which inverts the usual order deliberately: the
 * software stops being able to use the key *before* the operations work removes
 * it. An offboarding whose SOPS edit slips a day is then a shop that cannot make
 * calls — visible, loud, fixable — rather than a shop whose key is quietly still
 * live.
 *
 * `providerRevocationInstructedAt` is passed by the caller and is NOT defaulted
 * to `now()`: defaulting it would record an instruction that may not have been
 * given, which is the false statement this module exists to avoid.
 */
export async function offboardCredentialVersion(
  db: Queryable,
  args: {
    shopId: string;
    credentialVersionId: string;
    kind: string;
    /** The NAME the retired version pointed at, for the receipt. */
    keyRef: string;
    providerRevocationInstructedAt?: Date | null;
    authoredBy?: AuthoredBy;
  }
): Promise<OffboardingReceipt> {
  await retireCredentialVersion(db, {
    shopId: args.shopId,
    credentialVersionId: args.credentialVersionId,
    reasonCode: OFFBOARDING_REASON_CODE,
    providerRevocationInstructedAt: args.providerRevocationInstructedAt ?? null,
    ...(args.authoredBy !== undefined ? { authoredBy: args.authoredBy } : {}),
  });
  const res = await db.query(
    `SELECT retired_at, provider_revocation_instructed_at
       FROM shop_credential_retirement WHERE credential_version_id = $1`,
    [args.credentialVersionId]
  );
  const row = res.rows[0] as
    { retired_at: Date | string; provider_revocation_instructed_at: Date | string | null } | undefined;
  const instructed = row?.provider_revocation_instructed_at ?? null;
  return {
    shop_id: args.shopId,
    credential_version_id: args.credentialVersionId,
    kind: args.kind,
    key_ref: args.keyRef,
    reason_code: OFFBOARDING_REASON_CODE,
    retired_at: new Date(row?.retired_at ?? Date.now()).toISOString(),
    provider_revocation_instructed_at: instructed === null ? null : new Date(instructed).toISOString(),
    steps: OFFBOARDING_STEPS,
    rendered_env_file: TMPFS_ENV_FILE_PATH,
    residual: OFFBOARDING_RESIDUAL,
  };
}

/** The receipt as plain text, for a 006 row or an operator's console. */
export function renderOffboardingReceipt(receipt: OffboardingReceipt): string {
  return [
    `Credential made unreachable to Longbox — shop ${receipt.shop_id}, kind ${receipt.kind}, ` +
      `version ${receipt.credential_version_id} (environment variable ${receipt.key_ref}).`,
    `Retired at ${receipt.retired_at}, reason ${receipt.reason_code}.`,
    ...receipt.steps.map((s, i) => `Step ${i + 1}: ${s}.`),
    receipt.provider_revocation_instructed_at === null
      ? "The shop has not yet been instructed to revoke at the provider."
      : `The shop was instructed to revoke at the provider at ${receipt.provider_revocation_instructed_at}.`,
    receipt.residual,
  ].join("\n");
}

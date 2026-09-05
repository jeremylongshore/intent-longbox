// THE TWO SCHEMA-OWNER ACTS BEHIND `pnpm designate-staff` AND
// `pnpm retire-staff-designation` (E03-D14; 000-docs/058 §5).
//
// **WHY THE LOGIC LIVES HERE AND NOT IN THE CLI FILE.** `scripts/crossTenantAudit.ts`
// set the precedent one bead over: logic a CLI runs and a test asserts on lives
// beside the CLI, so `depcruise`'s no-orphans rule over `src/` keeps meaning what
// it says — and so the ROLE CHECK is testable. A guard that only exists inside a
// `main()` nobody can call is a guard nobody has seen fail.
//
// **WHY THESE ARE CLIs AT ALL.** 048 §12.4 row 3a: issuing anything privileged
// needs the privileged session, the FIRST factor has no bead until E03-D11
// (`longbox-e5b.3.21`), and every other privileged issuance in this system is a
// CLI for exactly that reason (`issue-invitation`, `issue-enrollment-code`,
// `enroll-authenticator`, `connector-install`). Designating a colleague is a
// stronger act than any of them: it decides who 019 T35(c)'s audit watches.
//
// **AND WHY THEY RUN AS THE SCHEMA OWNER.** Not convenience — the application
// role holds NO privilege on either table (058 §3(c), `appGrant: "none"`), so
// there is no other role that can write one. `assertSchemaOwnerOrThrow` refuses
// the application connection loudly, so an operator who reached for
// `DATABASE_URL` gets a refusal rather than a permission error they might read as
// a bug.
import { assertSchemaOwnerOrThrow } from "../src/services/roleSeparation.js";
import {
  designateOrigin,
  originDesignationsOf,
  retireAllOriginsOf,
  type OriginDesignation,
} from "../src/services/auth/index.js";

/** The client surface these two acts need — `pg.Client` and `pg.Pool` both satisfy it. */
export interface DesignationClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface DesignateArgs {
  readonly appUserId: string;
  readonly reason: string;
  readonly designatedBy?: string | null;
  readonly effectiveFrom?: Date | null;
}

/**
 * Designate one person Longbox-origin. Schema owner only.
 *
 * Returns every designation that person now holds, so the receipt shows a
 * SECOND designation as a second row rather than reading like an edit.
 */
export async function designateStaff(
  client: DesignationClient,
  args: DesignateArgs
): Promise<OriginDesignation[]> {
  await assertSchemaOwnerOrThrow(client);
  await designateOrigin(client, {
    appUserId: args.appUserId,
    reason: args.reason,
    designatedBy: args.designatedBy ?? null,
    effectiveFrom: args.effectiveFrom ?? null,
  });
  return originDesignationsOf(client, args.appUserId);
}

export interface RetireArgs {
  readonly appUserId: string;
  readonly reason: string;
  readonly retiredBy?: string | null;
}

/**
 * End every LIVE designation this person holds, as facts. Schema owner only.
 *
 * Keyed on the PERSON rather than on a designation id because that is the
 * question an operator has ("this person has left"), and because a designation
 * id is not something anybody has written down. An already-retired designation
 * is skipped rather than re-retired: `UNIQUE (origin_id)` would refuse the second
 * row anyway, and a refusal is the wrong answer to "make sure they are not
 * staff".
 */
export async function retireStaffDesignation(
  client: DesignationClient,
  args: RetireArgs
): Promise<{ retired: number; remaining: OriginDesignation[] }> {
  await assertSchemaOwnerOrThrow(client);
  // ONE statement (the invariant review's NOTE4). The first version read the
  // designations, then looped `retireOrigin` outside any transaction — so a
  // failure partway through left the person half-retired while the receipt below
  // printed a count that had never been true. `retireAllOriginsOf` is atomic
  // without needing a connection, which matters because callers hand this a
  // `pg.Pool` as often as a `pg.Client`.
  const retired = await retireAllOriginsOf(client, {
    appUserId: args.appUserId,
    reason: args.reason,
    retiredBy: args.retiredBy ?? null,
  });
  return { retired, remaining: await originDesignationsOf(client, args.appUserId) };
}

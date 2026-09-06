// The row-level-security plan: ONE rule, driven by the live schema, with the
// tables that carry no tenant declared as ROWS rather than as absences.
//
// WHY THIS FILE EXISTS, AND WHY IT IS NOT JUST THE MIGRATION (E03-B04).
// `migrations/029` enables row-level security and writes the policies for every
// table that carried a `shop_id` column the day it ran. A migration runs ONCE.
// **A policy is not inherited: `CREATE TABLE` produces a table with row-level
// security disabled and no policy at all** — so a shop-scoped table added three
// migrations later would silently be outside the boundary, in exactly the way
// `src/db/appRoleGrants.ts` records for privileges:
//
//   "A GRANT IS NOT PERMANENT THE WAY A TRIGGER IS … that is why this plan is
//    re-derived and re-applied at the END of every `pnpm migrate` run."
//
// The same sentence is true of a policy, so the same answer is used: this module
// re-derives the plan from the catalog and re-applies it after every migration
// run, immediately after the grant step. Belt (the migration, auditable in the
// file where it landed) and braces (this, self-healing for every table that comes
// later), with `tests/integration/rls-tenant-isolation.test.ts` asserting both
// directions against the live database so the two cannot drift apart in silence.
//
// EXEMPTIONS ARE ROWS WITH A REASON, NEVER ABSENCES (041 §9.2 item 4's rule,
// applied to a second property). The interesting question is not "which tables
// are exempt" but "did anyone decide". Every table without a `shop_id` is
// therefore listed below with the sentence that justifies it, and a live table
// that appears in neither class fails the step LOUDLY. An absence is
// indistinguishable from an oversight; a declared exemption is a decision a
// reviewer can argue with.
//
// ⚠ **"NO `shop_id` COLUMN" AND "NO TENANT" ARE DIFFERENT THINGS, AND THIS FILE
// USED TO CONFLATE THEM.** Until E03-D21 this paragraph read *"a table with no
// `shop_id` column CANNOT carry a tenant policy — there is nothing to compare"*,
// and that sentence is false: a predicate can reach the tenant through a join.
// `shop` was already the first counter-example (its tenant is its own `id`) and
// `app_user` is now the second (its tenant is a LIVE MEMBERSHIP one join away —
// `TENANT_PREDICATES`, 000-docs/062). So a shop-less table has THREE possible
// answers rather than two: a tenant column of another name, a predicate that
// joins, or a declared exemption. What has not changed is that the third is a
// decision somebody writes down.

import type { ServiceScope } from "./tenantContext.js";

/** The policy every shop-scoped table gets. Named so a test can assert on it. */
export const TENANT_POLICY = "tenant_isolation";

/** The second policy the pre-tenant identity tables get. */
export const SERVICE_POLICY = "service_context";

/** The policy that lets a declared scope WRITE — narrower, and on fewer tables. */
export const SERVICE_WRITE_POLICY = "service_write";

/**
 * The predicate both halves of `TENANT_POLICY` use on an ordinary shop-scoped table.
 *
 * ⚠ **THE OUTER PARENTHESES ARE NOT DECORATION — THEY ARE THE DEPARSER'S, AND
 * MATCHING THEM IS WHAT MAKES THE BOOT CHECK SOUND** (E03-D21; security lens F2 =
 * consistency lens K3). Postgres does not store a policy's text: it stores a
 * parse tree and re-renders it, FULLY PARENTHESISED, when `pg_policies` is read.
 * The boot assertion compares the live rendering against this declaration through
 * `policyTokens()`, which tags every token with its parenthesis DEPTH — because a
 * comparison that erases parentheses erases operator precedence, and the cannon
 * reproduced a policy relaxed by removing ONE pair of brackets that compared
 * EQUAL to the declared text and booted green while returning every person in the
 * estate.
 *
 * Depth only compares if both sides are shaped alike, so **every predicate in
 * this file is written the way the deparser renders it**. That is a real cost and
 * it is stated rather than hidden: it is a hand-kept shape, and the thing that
 * stops it going stale is that the integration lane compares EVERY live policy
 * against EVERY declared one — a mis-shaped declaration fails the lane and the
 * boot immediately, loudly, on the first run. The repair that removes the hand
 * work entirely is to round-trip the declaration through Postgres's own deparser
 * (000-docs/062 §8 A3, PROPOSED alias **E03-D32**).
 */
export const TENANT_PREDICATE = "(shop_id = current_shop_id())";

/**
 * Tables whose tenant column is NOT `shop_id`.
 *
 * ⚠ **`shop` IS ONE OF THEM, AND IT USED TO BE AN EXEMPTION.** The first version
 * of this bead left the tenant table unpolicied and gave two reasons: that a
 * policy would break the one read whose answer spans shops (048 §6.4's my-shops),
 * and that `membership` bounds it anyway. The invariant review found the first
 * reason had stopped being true the moment this bead created a `my-shops` SCOPE —
 * a scope-scoped read policy serves that query exactly — and the second is an
 * argument about the ROUTE, not about the table. So the tenant table is policied
 * on its own primary key.
 *
 * **The consequence is a property worth having, not a cost:** an INSERT into
 * `shop` can never satisfy `id = current_shop_id()`, because the tenant IS the row
 * being created — so **creating a shop is a schema-owner act, enforced by the
 * database**, which is exactly what `pnpm register-shop` already was by
 * convention (E02-D06).
 */
export const TENANT_COLUMNS: Readonly<Record<string, string>> = { shop: "id" };

/**
 * *Works here*, as ONE definition rather than a sixth hand copy.
 *
 * ⚠ **THIS USED TO BE THE TRIPLE SPELLED OUT, AND THE CONSISTENCY LENS WAS RIGHT
 * TO REFUSE THAT (K2).** Four copies of `effective_from <= now() AND
 * (effective_until IS NULL OR …) AND NOT EXISTS (… membership_revocation …)` live
 * in `src/services/auth/memberships.ts` and a fifth in
 * `src/identity/accessors.ts`; writing a sixth here — even a character-faithful
 * one — would make the BOUNDARY a second definition of the predicate the
 * application already believes, and the two would drift the first time either was
 * corrected. `migrations/036` creates `membership_is_live(membership)` and every
 * one of those readers now calls it, so there is one definition and six callers.
 *
 * **The rendering is `m.*` and not `m`**, because that is how Postgres deparses a
 * whole-row argument back out of `pg_policies`, and the declared side of the boot
 * assertion is compared against exactly that text.
 *
 * **It is not a per-row cost, and that was REPRODUCED rather than predicted.**
 * The planner turns the correlated `EXISTS` into a hashed SubPlan: the set of
 * people who work at `current_shop_id()` is built ONCE PER QUERY through a bitmap
 * index scan on `membership_shop_idx`, and this function is a filter inside that
 * one scan. The first version of this comment guessed `membership_user_shop_idx`
 * and the invariant review corrected it; the lane now asserts the plan positively
 * on a scaled fixture rather than asserting the absence of a seq scan on an empty
 * table.
 *
 * `membership_revocation` is inside the function's `NOT EXISTS` and it is itself
 * policied, which is 056 §6.1's trap read one table over: a guard expressed as an
 * ABSENCE over a table the caller cannot see PASSES, so a revoked grant would keep
 * answering with the shop it no longer reaches. Under an ordinary tenant context
 * both tables carry `shop_id = current_shop_id()` and both are visible, which is
 * what makes the revocation half real rather than decorative.
 */
export const LIVE_MEMBERSHIP = "membership_is_live(m.*)";

/**
 * Tables policied by a predicate that is NOT a column comparison at all.
 *
 * ⚠ **`app_user` IS THE ONLY ONE, AND IT USED TO BE AN EXEMPTION** (E03-D21,
 * 000-docs/062; 056 §11 R9). 056 §7 left the person table outside the boundary and
 * its stated ground was that *the grant and the read happen in the SAME
 * transaction* — `grantInvitation` writes the membership and then reads the
 * person, so a newcomer would be refused during the act of admitting them. Half of
 * that turned out to be about code this repository does not have: redemption
 * INSERTs the membership FIRST, so the row the policy looks for is already there
 * when it looks. The other half is real and is answered by a declared scope rather
 * than by a hole — an invitation NAMES its person before any code is minted
 * (048 §7.1), which is what `person-admission` exists for.
 *
 * **The tenant is one join away because there must be no tenant column here.**
 * 034 §2.6 makes a person able to hold memberships at more than one shop; a
 * `shop_id` on `app_user` would make that two people with two passwords. So the
 * predicate is the parent-EXISTS shape 056 §7 already names for
 * `retention_hold_release`, and the invariant review of E03-B04 was right that it
 * does NOT encode *a person belongs to one shop*: it admits every shop the person
 * holds a live grant at, and no other.
 *
 * **It is deliberately blind to `scope_kind` and to `role`** (the security lens's
 * F6): a location-scoped grant and a `support_break_glass` grant both admit the
 * person to the shop's roster, because row-level security is the TENANT boundary
 * and 054 is the location-and-permission boundary — a policy that narrowed by
 * location would be a second authorization system in SQL, which 056 §13 already
 * refused once. Break-glass being VISIBLE here is the correct direction for
 * 022 P7: the roster query excludes that role itself, and a holder who could not
 * be resolved to a name at all would be an invisible super-admin.
 */
export const TENANT_PREDICATES: Readonly<Record<string, string>> = {
  // Written in the deparser's shape (see `TENANT_PREDICATE`): every conjunct
  // parenthesised, the whole `EXISTS` wrapped, `m.*` rather than `m`.
  app_user:
    "(EXISTS (SELECT 1 FROM membership m WHERE ((m.app_user_id = app_user.id) " +
    `AND (m.shop_id = current_shop_id()) AND ${LIVE_MEMBERSHIP})))`,
};

/**
 * Every table policied despite carrying no `shop_id` column — the tenant-column
 * overrides and the predicate overrides together.
 *
 * One export rather than two `Object.keys` calls at four call sites: the boot
 * assertion, the migrate-time plan and two lane assertions all ask the same
 * question ("which shop-less tables are nevertheless inside the boundary?"), and
 * a second answer is how `029`'s hardcoded list came to disagree with this
 * module's in the first place (056 §4, F4/K6).
 */
export const POLICIED_WITHOUT_SHOP_ID: readonly string[] = [
  ...Object.keys(TENANT_COLUMNS),
  ...Object.keys(TENANT_PREDICATES),
].sort();

/** The tenant column for a table: `shop_id` unless it is one of the overrides. */
export function tenantColumn(table: string): string {
  return TENANT_COLUMNS[table] ?? "shop_id";
}

/** The `tenant_isolation` predicate for one table. */
export function tenantPredicate(table: string): string {
  return TENANT_PREDICATES[table] ?? `(${tenantColumn(table)} = current_shop_id())`;
}

/**
 * A table read (and sometimes written) inside a declared cross-tenant scope.
 *
 * ⚠ **THE SHAPE OF THIS DECLARATION IS THE SECURITY LENS'S F1, AND IT REPLACES A
 * WEAKER ONE.** The first version of this bead gave every one of these tables a
 * single `service_context` policy — `FOR ALL USING (longbox_service()) WITH CHECK
 * (longbox_service())` — over a SCOPE-AGNOSTIC boolean. The lens reproduced what
 * that means: inside `my-shops`, which exists to answer a READ about which shops
 * a person may act at, the application role **inserted an owner membership at
 * another shop**. One scope was therefore a cross-tenant read AND write grant on
 * every table in the set. §5.2 argued the exception was countable and it was; it
 * did not argue that its blast radius was bounded, and it was not.
 *
 * So a row now says three things instead of one:
 *
 *   * **which scopes may READ it** — emitted as `service_context`, `FOR SELECT`
 *     only, over `longbox_service_scope() = ANY (…)` rather than a boolean;
 *   * **whether any scope may WRITE it, and under what predicate** — emitted as a
 *     separate `service_write`, `FOR INSERT` only, whose check is the scope list
 *     AND a condition about the row itself. FOUR tables have one; the other
 *     fifteen are readable and not writable inside any scope;
 *   * **why**, in a sentence a reviewer can disagree with.
 *
 * **029's objection to this — "a policy that switched on WHICH scope was set
 * would be a second authorization system living in SQL" — did not survive the
 * demonstration.** It is answered in 000-docs/056 §13: the scope list in a policy
 * is not an authorization system, it is the same closed union the TypeScript side
 * already holds, written where the enforcement is.
 */
export interface ServiceTable {
  readonly table: string;
  /** Scopes permitted to SELECT. Never empty — a row with no reader is not a row. */
  readonly readScopes: readonly ServiceScope[];
  /**
   * Scopes permitted to INSERT, and the extra condition each written row must
   * satisfy. Absent means: no scope may write this table, and every write to it
   * happens under an ordinary tenant context.
   */
  readonly write?: {
    readonly scopes: readonly ServiceScope[];
    /**
     * SQL over the NEW row. `AND`-ed with the scope list; never `true`.
     *
     * Written PARENTHESISED as Postgres's deparser renders it — see
     * `TENANT_PREDICATE` for why the shape and not just the tokens has to match.
     */
    readonly check: string;
    readonly reason: string;
  };
  readonly reason: string;
}

/**
 * The NINETEEN tables reached inside a scope, with what each scope may do to them.
 *
 * ⚠ **THIS LIST IS THE ONLY ONE.** `migrations/029` used to carry a hardcoded
 * copy of it, and the two had already drifted — the migration's array named ten
 * tables while this one named fourteen and the runner applied seventeen. Both
 * lenses called it (security F4, consistency K6, its one blocking finding), and
 * the consistency lens named the failure precisely: the only thing keeping the
 * drift from being an outage was that `pnpm migrate` happens to run both halves
 * together, which a disaster-recovery script or a hand-run of the SQL file — a
 * re-runnability 000-docs/044 §7 explicitly wants — would not honour. The
 * migration now carries no list at all and says so; `tests/contract/` asserts that
 * no migration file names one.
 */
export const SERVICE_TABLES: readonly ServiceTable[] = [
  {
    table: "app_user",
    readScopes: ["person-admission", "second-factor"],
    write: {
      scopes: ["person-admission"],
      // NOT `true`, and the difference is a property worth having. The admission
      // may create an ACTIVE person and nothing else; combined with the absence of
      // any UPDATE or DELETE reachable inside the scope, **the running server can
      // admit a person and can never rename, suspend or deactivate one** — those
      // are schema-owner acts, enforced rather than conventional.
      check: "(status = 'active')",
      reason:
        "An invitation NAMES its person before any code is minted (048 §7.1), so `upsertPerson` " +
        "runs for somebody who may hold no grant anywhere yet. That is the one moment the " +
        "membership-EXISTS policy cannot serve, and 056 §7 gave it as the reason for having no " +
        "policy at all (§11 R9). E03-D21 answers it with a declared scope: the INSERT happens " +
        "inside `person-admission` and nowhere else.",
    },
    reason:
      "THE PERSON TABLE, policied on a live membership since E03-D21 (000-docs/062) — so these are " +
      "the two reads that legitimately precede a membership. **`person-admission`**: the invitation " +
      "route must find, by email, a person who may already work at ANOTHER shop (034 §2.6), and no " +
      "tenant context can see them. **`second-factor`**: `findPersonIdByEmail` is the FIRST " +
      "statement of an unauthenticated sign-in (048 §4.1), so no shop is known yet — the same shape " +
      "as a cookie's digest lookup. Everything else that resolves a person does so under an " +
      "ordinary tenant context, through `src/identity/`'s audited accessor (060 §3).",
  },
  {
    table: "shop",
    readScopes: ["my-shops", "outbox-sweep"],
    reason:
      "The tenant table, policied on its own `id` (see TENANT_COLUMNS). Two reads legitimately span " +
      "shops and both are declared: `my-shops` answers WHICH tenants a session may act on (048 §6.4), " +
      "and `outbox-sweep` asks which shops exist so the poller can drain them ONE AT A TIME. Nothing " +
      "writes it inside a scope — creating a shop is a schema-owner act, and the policy makes that " +
      "true rather than conventional.",
  },
  {
    table: "app_session",
    readScopes: ["session-resolution"],
    reason:
      "A `__Host-` cookie is resolved to a session row by digest; the row it finds IS the tenant " +
      "(048 §6.1). Issuance and rotation are WRITES and they happen under the shop the row names, " +
      "so no scope writes here.",
  },
  {
    table: "app_session_revocation",
    readScopes: ["session-resolution"],
    reason:
      "The liveness half of the same lookup — a `NOT EXISTS` over the chain just found. It is read " +
      "in the scope for §6.1's reason: a guard expressed as an absence, over a table the context " +
      "cannot see, passes.",
  },
  {
    table: "auth_attempt",
    readScopes: ["session-resolution", "device-session-open", "code-redemption", "second-factor"],
    write: {
      scopes: ["session-resolution", "device-session-open", "code-redemption", "second-factor"],
      // The two session scopes and the second factor append a row for a shop
      // NOBODY HAS IDENTIFIED — a NULL `shop_id`, which no tenant policy can ever
      // match. `code-redemption` is the one scope that knows a shop (the device's,
      // 048 R15) and records the per-shop delay against it, so it is named
      // explicitly rather than covered by widening the NULL case for everyone.
      check: "((shop_id IS NULL) OR (longbox_service_scope() = 'code-redemption'))",
      reason:
        "A refusal recorded before a tenant exists. 048 §9.1 derives the growing delay from these " +
        "rows, so a scope that could not write one would hand a flooder an unbounded budget.",
    },
    reason: "The lockout window is read in the same scope that appends to it.",
  },
  {
    table: "device",
    readScopes: ["session-resolution", "device-session-open"],
    reason:
      "JOINED by the credential lookup, which is the only reason it is here: " +
      "`resolveDeviceCredential` reads the phone's `location_id` from `device` in the same statement " +
      "that finds the credential (048 §3.2), before any tenant exists.",
  },
  {
    table: "device_credential",
    readScopes: ["device-session-open"],
    reason: "A phone presents its secret; the credential names the shop (048 §3.2, §7.4).",
  },
  {
    table: "device_credential_revocation",
    readScopes: ["device-session-open"],
    reason: "The liveness half of that lookup — the same `NOT EXISTS` reasoning as the session's.",
  },
  {
    table: "device_enrollment_code",
    readScopes: ["code-redemption"],
    reason: "Presented by a phone with no session at all; the code identifies the shop (048 §7.3).",
  },
  {
    table: "device_enrollment_code_use",
    readScopes: ["code-redemption"],
    reason:
      "Read as the `EXISTS` that decides whether the code is spent. The use row itself is WRITTEN " +
      "under the shop the code named, in `enrollDevice`'s tenant transaction.",
  },
  {
    table: "invitation",
    readScopes: ["code-redemption"],
    reason:
      "Presented on a phone that holds a device session at another shop, or at this one; the record " +
      "compares the two shops itself so a lifted code records `cross_shop_invitation` (048 §7.2).",
  },
  {
    table: "invitation_use",
    readScopes: ["code-redemption"],
    reason:
      "The `EXISTS` that decides whether the invitation is spent; the use row is written under a tenant.",
  },
  {
    table: "membership",
    readScopes: ["my-shops", "second-factor"],
    reason:
      "`GET /api/v1/shops` answers WHICH tenants this session may act on (048 §6.4) — the one read " +
      "whose correct answer spans shops, because a person may hold memberships at more than one " +
      "(034 §2.6). Every grant is WRITTEN under the shop it grants at. **`second-factor` reads it " +
      "too**, and for the same shape of reason: 048 §4.1 enrols a second factor for a PRIVILEGED " +
      "person, and `liveRolesOf` asks which roles they hold ANYWHERE — a question about a person " +
      "rather than about a shop, which no tenant context can ask.",
  },
  {
    table: "membership_revocation",
    readScopes: ["my-shops", "second-factor"],
    reason:
      "⚠ The sharpest edge of the whole mechanism. `my-shops` asks for memberships that NO revocation " +
      'names — a `NOT EXISTS` — and a subquery over a table the context cannot see returns "nothing ' +
      'there". With `membership` scoped and this not, a revoked grant kept answering with the shop it ' +
      "no longer reached: a filter that fails OPEN because it is expressed as an absence (056 §6.1). " +
      "**It carries `second-factor` for exactly the same reason**: `liveRolesOf` excludes revoked " +
      "grants with a `NOT EXISTS`, so a scope that could not see revocations would read a revoked " +
      "owner as privileged — the same trap, one caller over, and found by the rule rather than by luck.",
  },
  {
    table: "connector_install_state",
    readScopes: ["connector-inbound"],
    reason:
      "The OAuth callback is resolved by `state_digest` (053 §7.2) — the same shape as a cookie. The " +
      "state is MINTED by the shop's owner, under that shop's tenant context.",
  },
  {
    table: "connector_install_state_use",
    readScopes: ["connector-inbound"],
    reason: "The `LEFT JOIN` that decides whether the state is spent; the use row is written under a tenant.",
  },
  {
    table: "connector_token_version",
    readScopes: ["connector-inbound"],
    reason:
      "A webhook identifies its store by DOMAIN, and which shop that is — if any — is what the read " +
      "over this table answers (053 §7.3). A version is INTRODUCED under the shop the state named.",
  },
  {
    table: "connector_token_retirement",
    readScopes: ["connector-inbound"],
    write: {
      scopes: ["connector-inbound"],
      // 026's CHECK already requires an uninstall retirement to cite the signed
      // message that caused it. Requiring the citation IN THE POLICY means the
      // scope can only write the ending a webhook actually reported — a
      // deliberate `--reason rotation` retirement runs as the owner, elsewhere.
      check: "(webhook_receipt_id IS NOT NULL)",
      reason:
        "An uninstall ends EVERY live token granted for that store, whichever shop holds it " +
        "(053 §7.3), so the write cannot name one tenant — but it can be required to cite the " +
        "receipt that caused it, which is what bounds it.",
    },
    reason: "Read in the same transaction that writes it, to decide which versions are already ended.",
  },
  {
    table: "connector_webhook_receipt",
    readScopes: ["connector-inbound"],
    write: {
      scopes: ["connector-inbound"],
      // The receipt is the ONE row in the system whose `shop_id` may legitimately
      // be NULL after the write (053 §5.5): a webhook matching no install, or
      // matching two, names no tenant. `topic` is required so a scope cannot
      // write a receipt for an act nobody reported.
      check: "(topic IS NOT NULL)",
      reason:
        "A webhook that matches no install writes a receipt with a NULL `shop_id` (053 §5.5), which " +
        "matches no tenant policy at all — so this write has nowhere else to happen.",
    },
    reason: "The duplicate check reads it in the same breath (`ON CONFLICT … DO NOTHING`, then read back).",
  },
];

/** The table names, for the readers that only need the set. */
export const SERVICE_CONTEXT_TABLES: readonly string[] = SERVICE_TABLES.map((t) => t.table);

/** The tables a scope may INSERT into, which is a much shorter list. */
export const SERVICE_WRITE_TABLES: readonly string[] = SERVICE_TABLES.filter(
  (t) => t.write !== undefined
).map((t) => t.table);

/**
 * `(longbox_service_scope() = ANY (ARRAY['a', 'b']))`, built from a scope list.
 *
 * Parenthesised for `TENANT_PREDICATE`'s reason: the boot check compares
 * depth-annotated tokens, and this is the shape Postgres renders back.
 */
export function scopePredicate(scopes: readonly ServiceScope[]): string {
  const list = [...scopes]
    .sort()
    .map((s) => `'${s}'`)
    .join(", ");
  return `(longbox_service_scope() = ANY (ARRAY[${list}]))`;
}

/** The `service_context` (read) predicate for one declared table. */
export function serviceReadPredicate(table: ServiceTable): string {
  return scopePredicate(table.readScopes);
}

/** The `service_write` (INSERT) predicate for one declared table. */
export function serviceWritePredicate(table: ServiceTable): string {
  if (table.write === undefined) throw new Error(`${table.table} declares no service write`);
  // The row condition is declared ALREADY PARENTHESISED as the deparser renders
  // it, so this adds the `AND`'s own pair and no more.
  return `(${scopePredicate(table.write.scopes)} AND ${table.write.check})`;
}

/** A table with no `shop_id` column, and the reason it has none. */
export interface RlsExemption {
  readonly table: string;
  /** Why this table carries no tenant, and what bounds it instead. */
  readonly reason: string;
}

/**
 * Every table in the schema that carries no `shop_id`, with its reason.
 *
 * Read the classes rather than the rows: **the catalog** (a corpus is the same
 * facts for every shop — 030 §7 says so explicitly and gives them no `shop_id`),
 * **the party above a shop** (`organization`), **a person's CREDENTIALS** (the
 * two authentication factors and the recovery codes — the person themself is
 * policied since E03-D21, and each of these now stands on its own ground rather
 * than on `app_user`'s), **the origin facts** (`appGrant: "none"`, and a
 * tenant-keyed policy would hide the row 019 T35(c) exists to find), **a child of
 * a policied parent**, and **the runner's own bookkeeping**.
 */
export const RLS_EXEMPTIONS: readonly RlsExemption[] = [
  {
    table: "organization",
    reason:
      "Above the shop (034 §2.2): the legal party a charter and a consent bind to. It has no " +
      "`shop_id` by design — it is what a `shop` points AT — and carries a name and a billing email, " +
      "not a shop's data.",
  },
  // ⚠ **`app_user` IS NO LONGER HERE — E03-D21, 000-docs/062.** It is policied on
  // a live membership (`TENANT_PREDICATES`), which is why every row below had to
  // be RE-DECIDED rather than left saying "same reason as `app_user`". A reason
  // that points at a row which has moved is a reason nobody has checked.
  {
    table: "user_credential",
    reason:
      "The FIRST factor, keyed on `app_user_id` (048 §4.1, E03-D11). ⚠ **This row used to say " +
      "`same reason as app_user`, and that reason has moved** (E03-D21): the ground now stands on " +
      "its own, and it is two things. **(1) It holds no attribute of a person** — one argon2id " +
      "digest over `password ‖ pepper`, so a row read cross-tenant returns something that opens " +
      "nothing without a value this database does not hold. **(2) Every application-role path to " +
      "it is INSIDE the `second-factor` scope**, where a tenant predicate is vacuous by " +
      "construction (no shop is known: it is the first statement of an unauthenticated sign-in). " +
      "A policy here would therefore be in force on no path the running server takes — decoration " +
      "on a boundary, which is worse than a declared absence because it makes the boundary look " +
      "denser than it is. What bounds it is the pepper, the module graph, and every read being by " +
      "the authenticated person's own id or by a lowercased email in the same statement.",
  },
  {
    table: "user_authenticator",
    reason:
      "The second factor (048 §4). Everything `user_credential` says applies, plus ONE that is " +
      "specific to this table and is the decisive one (E03-D21): 048 R19 consumes a TOTP step " +
      "exactly once by `UPDATE … WHERE last_used_step < $2`, and **THE AFFECTED-ROW COUNT IS THE " +
      "AUTHORIZATION**. A policy over that statement turns any misconfiguration into a zero-row " +
      "UPDATE, which this system reads as `this code was already used` — a refusal " +
      "indistinguishable from a replay, on the path a person uses to get in. A row filter does not " +
      "belong over a statement whose row count is a verdict. The sealed secret is additionally " +
      "AEAD-bound to the row's own id, so a row read cross-tenant is not a usable factor.",
  },
  {
    table: "user_authenticator_retirement",
    reason:
      "The retirement fact for the row above; it carries no tenant for the same reason its subject " +
      "does, and it is appended inside the same `second-factor` scope.",
  },
  {
    table: "recovery_code",
    reason:
      "Issued per person, hashed argon2id with the pepper, single-use by constraint (048 §8). " +
      "Re-decided at E03-D21 on `user_credential`'s two grounds and not on `app_user`'s: it holds " +
      "no attribute of a person, and its only application-role reader is inside `second-factor`. " +
      "A cross-tenant read returns a hash that opens nothing.",
  },
  {
    table: "recovery_code_use",
    reason:
      "The use fact for the row above; same grounds. Single use is `UNIQUE (code_id)` — a " +
      "constraint the database decides — and not a row a policy filters.",
  },
  {
    table: "authenticator_offer_use",
    reason:
      "E03-D24 / 000-docs/063 §3.4: the spent-ticket fact for a sealed enrolment offer, keyed on " +
      "the ticket's DIGEST and naming a PERSON. Person-scoped exactly like `recovery_code_use` two " +
      "rows up, and for the same reason its subject is: a second factor belongs to a person who " +
      "may hold memberships at more than one shop (034 §2.6), so there is no tenant to key a " +
      "policy on. What bounds it is narrower than a policy would be: the only writer is " +
      "`enrolOwnAuthenticator`, inside a privileged session for the person the ticket's AAD names, " +
      "and the row holds a digest that inverts to nothing.",
  },
  {
    table: "user_credential_clearance",
    reason:
      "E03-D24 / 000-docs/063 §3.8: the break-glass clearance fact for `user_credential`, which " +
      "carries no tenant for the reason stated on that table. It is written by a SCHEMA-OWNER CLI " +
      "and by nothing else — the app role is not the writer and does not need to be — so the " +
      "boundary that matters here is the privilege, not a policy.",
  },
  {
    table: "app_user_origin",
    reason:
      "E03-D14 / 000-docs/058: whether a person is LONGBOX-ORIGIN is a fact about them and follows " +
      "them to every shop — which is the property 019 T35(c)'s reconciliation needs, since the " +
      "session worth finding is the one at a shop the person holds nothing at. A `shop_id` here " +
      "would make the predicate answer per tenant and hide exactly that row. ⚠ **AND THAT IS WHY " +
      "IT DID NOT MOVE WITH `app_user` AT E03-D21**: a membership-EXISTS policy is exactly a " +
      "per-tenant answer, so it would hide the origin fact for the one session 019 T35(c) is " +
      "looking for. It is bounded more tightly than a policy anyway: the app role holds NO " +
      'privilege on this table at all (`appGrant: "none"`, 058 §3(c)), so the only reader is the ' +
      "schema-owner audit and the boot assertion refuses a port on any stray grant.",
  },
  {
    table: "app_user_origin_retirement",
    reason:
      "The ending fact for the row above; it carries no tenant for the same reason its subject " +
      'does, and it is `appGrant: "none"` for the same reason too.',
  },
  {
    table: "retention_hold_release",
    reason:
      "A child of `retention_hold`, which IS policied. It carries the hold's id and a timestamp and " +
      "nothing else, so the tenant is one join away. A parent-EXISTS policy is available if a reader " +
      "outside the retention sweep ever appears; there is none today (041 §8).",
  },
  {
    table: "collectible_definition",
    reason:
      "Catalog. 030 §7: a corpus is the same facts for every shop, so no catalog table carries a tenant.",
  },
  { table: "edition", reason: "Catalog (030 §7): an edition is a fact about a book, not about a shop." },
  {
    table: "edition_external_id",
    reason: "Catalog crosswalk (030 §7, §8): a provider's id for a catalog thing.",
  },
  {
    table: "edition_signature",
    reason: "Catalog (049, 052): a normalized signature is a fact about a book.",
  },
  { table: "corpus_version", reason: "Catalog: an immutable versioned snapshot, shared by every shop." },
  { table: "data_source", reason: "Catalog provenance: which corpus a fact came from." },
  {
    table: "lcid_registry",
    reason: "Catalog identity (047): an LCID names a catalog thing, never a tenant's row.",
  },
  { table: "lcid_merge", reason: "Catalog lifecycle fact (047 §4): two catalog names turned out to be one." },
  { table: "lcid_split", reason: "Catalog lifecycle fact (047 §4): one catalog name turned out to be two." },
  { table: "lcid_split_outcome", reason: "Catalog lifecycle fact (047 §4): where a split sent each side." },
  { table: "lcid_retirement", reason: "Catalog lifecycle fact (047 §4): a catalog name that names nothing." },
  {
    table: "lcid_current_survivor",
    reason: "The catalog's survivor projection, rebuilt from the facts above.",
  },
  {
    table: "vertical_pack",
    reason: "A vertical pack is estate-wide configuration (051), not a shop's data.",
  },
  { table: "vertical_pack_version", reason: "The versioned manifest of the row above (051 §3)." },
  {
    table: "schema_migrations",
    reason:
      'The migration runner\'s own ledger. It is `appGrant: "none"` for the same reason it is exempt ' +
      "here: the application never names it (044 §4).",
  },
];

const EXEMPT_TABLE_NAMES: readonly string[] = RLS_EXEMPTIONS.map((e) => e.table);

/**
 * The declared exemptions, for the boot assertion (E03-D21, security lens F3).
 *
 * Exported so `roleSeparation.ts` can ask the DATABASE whether each of them is
 * actually exempt — row-level security off, no policy of any kind — rather than
 * trusting that the list here and the schema agree. §4's argument that a policy
 * over `user_authenticator` would be HARMFUL rested on nobody having written one.
 */
export const RLS_EXEMPT_TABLE_NAMES: readonly string[] = [...EXEMPT_TABLE_NAMES].sort();

/** The classification of the live schema into policy tables and declared exemptions. */
export interface RlsPlan {
  /** Live tables carrying a `shop_id` column → `ENABLE ROW LEVEL SECURITY` + `tenant_isolation`. */
  readonly policied: readonly string[];
  /** Of those, the ones that also get `service_context`. */
  readonly serviceScoped: readonly string[];
  /** Live tables with no `shop_id`, each matched to a declared reason. */
  readonly exempt: readonly string[];
  /** Views, which get `security_invoker = true` — see `migrations/029` §5. */
  readonly views: readonly string[];
}

/**
 * Thrown when a live table carries no `shop_id` and no declared exemption.
 *
 * The loud failure. Defaulting an unknown table to "exempt" would mean a new
 * shop-scoped table whose author forgot the column silently lands outside the
 * tenant boundary — which is the exact defect 034 §1 E10 recorded and this bead
 * closes. Defaulting it to "policied" is not available either: a table with no
 * `shop_id` column cannot carry the predicate.
 */
export class UndeclaredTenancyError extends Error {
  constructor(readonly tables: readonly string[]) {
    super(
      `refusing to apply row-level security: ${tables.length} table(s) carry no shop_id and are not ` +
        `declared exempt in src/db/rowLevelSecurity.ts — ${tables.join(", ")}. ` +
        `Add the shop_id column (locked decision 4: every shop-scoped table carries one) or add an ` +
        `RLS_EXEMPTIONS row stating why this table has no tenant, in the same PR that created it.`
    );
    this.name = "UndeclaredTenancyError";
  }
}

/**
 * A live relation as the catalog reports it.
 *
 * `relkind` is carried rather than filtered away, and the security lens's F3 is
 * why: the previous version asked the catalog for `relkind = 'r'` and classified
 * what came back, so a MATERIALIZED VIEW (`'m'`) or a PARTITIONED table (`'p'`)
 * was invisible to this plan while the GRANT plan beside it already handed the
 * application role `SELECT` on materialized views. The first materialized view in
 * any future migration would have been granted, unpolicied, and green at boot.
 */
export interface LiveRelation {
  readonly name: string;
  /** `pg_class.relkind`. */
  readonly relkind: string;
  readonly hasShopId: boolean;
}

/** Kept for the callers that only know about ordinary tables. */
export type LiveTable = LiveRelation;

/** Relation kinds this plan can protect: an ordinary table and a partitioned one. */
export const POLICIABLE_RELKINDS = ["r", "p"] as const;

/**
 * Thrown when the schema holds a relation this design cannot protect.
 *
 * **A materialized view cannot carry row-level security at all** — Postgres
 * refuses `ENABLE ROW LEVEL SECURITY` on one, and it is a stored copy of rows a
 * policy filtered when the copy was made, which is worse than an unfiltered read
 * because it looks like a table. A foreign table's rows are not ours to police.
 * Both are refused LOUDLY rather than skipped, because skipping is how the grant
 * plan and this plan came to disagree in the first place.
 */
export class UnsupportedRelkindError extends Error {
  constructor(readonly relations: ReadonlyArray<{ name: string; relkind: string }>) {
    super(
      `refusing to apply row-level security: ${relations.length} relation(s) in the live schema are ` +
        `of a kind this boundary cannot protect — ` +
        relations.map((r) => `${r.name} (relkind '${r.relkind}')`).join(", ") +
        `. A materialized view cannot carry RLS; make it a security_invoker view, or give it a ` +
        `shop_id and a refresh that runs under a tenant context. A foreign table's rows belong to ` +
        `another server and cannot be policied here at all.`
    );
    this.name = "UnsupportedRelkindError";
  }
}

export function planRowLevelSecurity(
  relations: readonly LiveRelation[],
  views: readonly string[] = []
): RlsPlan {
  const policied: string[] = [];
  const exempt: string[] = [];
  const undeclared: string[] = [];
  const unsupported: Array<{ name: string; relkind: string }> = [];

  for (const rel of [...relations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!(POLICIABLE_RELKINDS as readonly string[]).includes(rel.relkind)) {
      unsupported.push({ name: rel.name, relkind: rel.relkind });
      continue;
    }
    // A table with a `shop_id`, OR one this module policies anyway: `shop`, whose
    // tenant is its own `id`, and `app_user`, whose tenant is a live membership
    // one join away (E03-D21 — `TENANT_PREDICATES`).
    if (rel.hasShopId || POLICIED_WITHOUT_SHOP_ID.includes(rel.name)) policied.push(rel.name);
    else if (EXEMPT_TABLE_NAMES.includes(rel.name)) exempt.push(rel.name);
    else undeclared.push(rel.name);
  }
  // The unsupported kind is raised FIRST: a materialized view with a `shop_id`
  // would otherwise be reported as an undeclared table, which names the wrong
  // problem and suggests the wrong fix.
  if (unsupported.length > 0) throw new UnsupportedRelkindError(unsupported);
  if (undeclared.length > 0) throw new UndeclaredTenancyError(undeclared);

  return {
    policied,
    serviceScoped: policied.filter((t) => SERVICE_CONTEXT_TABLES.includes(t)),
    exempt,
    views: [...views].sort(),
  };
}

/** Postgres identifiers we are willing to interpolate: lowercase, unquoted, no injection surface. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertSafeIdentifier(name: string): string {
  if (!SAFE_IDENTIFIER.test(name)) throw new Error(`unsafe table name: ${JSON.stringify(name)}`);
  return name;
}

/**
 * The exact statements applied to the database, in order.
 *
 * Data rather than execution, for `appRoleGrants.ts`'s reason: a test can assert
 * the whole plan without a database, and a reviewer can read the entire boundary
 * in one place. `DROP POLICY IF EXISTS` before each `CREATE POLICY` makes the step
 * idempotent AND corrective — a policy whose predicate was edited by hand on a
 * live database is replaced by the declared one on the next run, rather than
 * surviving because something already existed under that name.
 *
 * **THREE policies per table at most, and each is narrower than the one it
 * replaced** (security lens F1): the tenant policy `FOR ALL`; the service READ
 * policy `FOR SELECT` over the scopes declared for that table; and, on three
 * tables, a service WRITE policy `FOR INSERT` whose check is those scopes AND a
 * condition about the row. All three are dropped on every table on every run,
 * including tables that carry none, so the declaration can NARROW as well as
 * widen — a table removed from `SERVICE_TABLES` loses its policies on the next run.
 */
export function buildRlsStatements(plan: RlsPlan): string[] {
  const statements: string[] = [];
  for (const table of plan.policied) {
    assertSafeIdentifier(table);
    statements.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    statements.push(`DROP POLICY IF EXISTS ${TENANT_POLICY} ON ${table}`);
    const tenant = tenantPredicate(table);
    statements.push(
      `CREATE POLICY ${TENANT_POLICY} ON ${table} FOR ALL USING (${tenant}) WITH CHECK (${tenant})`
    );
    statements.push(`DROP POLICY IF EXISTS ${SERVICE_POLICY} ON ${table}`);
    statements.push(`DROP POLICY IF EXISTS ${SERVICE_WRITE_POLICY} ON ${table}`);
    const declared = SERVICE_TABLES.find((t) => t.table === table);
    if (declared === undefined) continue;
    statements.push(
      `CREATE POLICY ${SERVICE_POLICY} ON ${table} FOR SELECT USING (${serviceReadPredicate(declared)})`
    );
    if (declared.write !== undefined) {
      statements.push(
        `CREATE POLICY ${SERVICE_WRITE_POLICY} ON ${table} FOR INSERT ` +
          `WITH CHECK (${serviceWritePredicate(declared)})`
      );
    }
  }
  for (const view of plan.views) {
    assertSafeIdentifier(view);
    // Without this a view reads its base tables as the VIEW OWNER — the schema
    // owner, which is exempt from these policies — and returns every shop's rows.
    // See `migrations/029` §5; it is the half of this design that is easy to miss.
    statements.push(`ALTER VIEW ${view} SET (security_invoker = true)`);
  }
  return statements;
}

/** The minimum client surface this module needs; `pg.Client` and `pg.Pool` both satisfy it. */
export interface RlsClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * EVERY relation kind that is not a plain view, so an unprotectable one is seen
 * rather than filtered out of the question (F3).
 */
const RELATIONS_SQL = `
  SELECT c.relname AS name,
         c.relkind::text AS relkind,
         EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attname = 'shop_id' AND NOT a.attisdropped
         ) AS has_shop_id
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'm', 'f')
`;

const VIEWS_SQL = `
  SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'v'
`;

/**
 * Re-derive and re-apply the row-level-security plan against the live schema.
 *
 * Run by `pnpm migrate` BEFORE the grant step, and by `pnpm grant-app-role` on
 * its own, so a table added by a later migration is inside the boundary from the
 * run that created it rather than from whenever somebody remembers.
 *
 * **The order is the security lens's F6 and it is not cosmetic.** This step is
 * DESIGNED to throw — on an undeclared table, on an unprotectable relation kind —
 * and the grant step is what makes a new table readable at all. Granting first
 * meant a run that failed here left a table GRANTED and UNPOLICIED, with a
 * process already serving from it. Policies first, privileges second: a failed
 * run then leaves the new table unreadable, which is the direction to fail in.
 */
export async function applyRowLevelSecurity(
  client: RlsClient
): Promise<{ plan: RlsPlan; statements: string[] }> {
  const rows = (await client.query(RELATIONS_SQL)).rows as Array<{
    name: string;
    relkind: string;
    has_shop_id: boolean;
  }>;
  const views = ((await client.query(VIEWS_SQL)).rows as Array<{ name: string }>).map((r) => r.name);
  const plan = planRowLevelSecurity(
    rows.map((r) => ({ name: r.name, relkind: r.relkind, hasShopId: r.has_shop_id })),
    views
  );
  const statements = buildRlsStatements(plan);
  for (const sql of statements) await client.query(sql);
  return { plan, statements };
}

# Standard — Migration Discipline: Expand/Contract, the Ledger Checksum, Prior-Snapshot Upgrades, Compatible Rollback, and the Architecture Gate

**Version:** 1.1.0
**Status:** OPERATING STANDARD (not a decision record)
**Bead:** `longbox-e5b.2.10` (E02-B10) · **amended at v1.1.0 by** E03-D20 `longbox-e5b.3.30`
**Date:** 2026-09-04 · **Last amended:** 2026-09-05

---

## Change log

**Version convention** (006 `:6`): a **minor** bump means the content of a rule changed; a **patch** means a statement of fact was repaired with no rule changing. **This section was added at v1.1.0**; the two rows below it reconstruct what the file's own `Version:` line already recorded, and no earlier text is edited to make them fit.

**How this standard is amended.** By ROWS and APPENDED sections, never by rewriting a rule in place. An author reading §2 must be able to see the four shapes as E02-B10 shipped them AND the fifth beside them, because the difference is the record of what was learned. That is the same idiom the ratified decision records use (054 §6's `AMENDMENT` block, 058 §8), applied to a standard.

| Version | Date | What changed | Authority |
|---|---|---|---|
| **1.1.0** | **2026-09-05** | **MINOR — two rules added, none reversed** (E03-D20 `longbox-e5b.3.30`, from the 056 gate audit's N2/N9 and the consistency lens's K8). **A1 (§2, §4):** `ENABLE`/`FORCE ROW LEVEL SECURITY` and `CREATE POLICY` become a **FIFTH contracting shape**, with the deploy-order rule 056 §14 could state for one bead and not generalise — schema and code that introduce a tenant boundary are ONE deploy unit and roll back **both or neither** — and a header half that fits a step which retires nothing: `-- contract: deploy unit …; 006 row: …`. **A2 (§9):** any `CREATE INDEX` without `CONCURRENTLY` on a table the file did not create must carry `-- index lock: …`; the lint **WARNS** while `G3_LIVE_SHOP_ROWS` is false (034:421 — the first live shop item is a G3 event) and **REFUSES** after. **§10 (new):** the grandfather allowlist, its one entry (`029`) and what an entry means. **Three misses are recorded rather than left to be discovered** — `ALTER POLICY`/`DROP POLICY` (§2 A1), the create-populate-then-index file and `ALTER TABLE … ADD CONSTRAINT … UNIQUE`/`ADD PRIMARY KEY` (§9) — each with the reason it is not matched and, where one exists, the mechanism that does see it. The four shapes in §2's table, §4's three reasons and §6's gate are unchanged and are not re-worded. | E03-D20 → acting head |
| 1.0.1 | 2026-09-04 | PATCH — §3's fixture parenthesis repaired to describe what `pnpm fixture:schema` actually does after E03-D04 (`--schema-only`, the target refusal, the seed emitted from a constant). No rule changed. | E03-D04 |
| 1.0.0 | 2026-09-04 | Initial standard: the expand/contract lint and its four shapes, the ledger checksum, prior-snapshot upgrade tests, compatible rollback, the architecture gate and its exemption rows. | E02-B10 |

---

## 0. What this document is, and what it is not

**This is a standard, not a decision record.** Every decision it depends on is already ratified elsewhere and is cited rather than re-argued:

| Rule here | Ratified in |
|---|---|
| Migrations are expand-only; a shipped migration is never edited | 041 §10, 040 §8, 029 §5 |
| The contract step waits until the last writer is gone | 040 §8.2 |
| `authored_by` is `NOT NULL` with a per-table derivation | 041 §2.3, §10.1 (A10, Q1) |
| The supersession scope FK is mandatory, not preferred | 041 §3.2 (A2) |
| `session_seq` is a per-session counter assigned under the anchor lock | 041 §5.3 |
| `request_idempotency` exists, is exempt from the trigger set, and is UPDATEd | 042 §5.2, §5.3; 041 §8.5 (A11) |
| `scan_session_transition`'s shape and its four CHECKs | 040 §3.3, §8.1 |
| The module dependency rule and its machine-checkable config | 029 §3.1, §3.3, §5 move 8 |
| No `SELECT *` outside a declared exemption list | 042 I5 |
| One fixed lock order in every mutating handler | 042 §5.3(b), I22 (A6) |
| Allowlist rows carry `kind ∈ {exemption, defect}`, and no defect row may exist at G2 | 042 §3.4 (A8) |

What this document adds is **the operating procedure**: what an author must do, what the machine now refuses, and where the evidence lives. If it ever disagrees with one of the records above, the record wins and this file is the defect.

---

## 1. The problem, in one paragraph

Three ratified records tell the next author to write expand-only migrations. All three say it in prose, and **prose is enforced by review only** — the same weakness 029 §3.3 names for the module boundary, with the same answer: the rule becomes a check that runs, or it erodes. Worse, nothing kept the *contents* of a shipped migration honest. A migration file is never renamed once applied, because the runner's ledger keys on the filename — but the ledger recorded nothing about the bytes, so editing an already-applied file gave a fresh database one schema and every existing database another, and `pnpm migrate` printed `skip` in both cases. And the only upgrade path ever tested was the empty one, which is the path production never takes.

---

## 2. Expand/contract, as a checked rule

> **Every migration is expand-only and re-runnable by hand, unless it declares itself a contract step.**

`scripts/migrate.ts` runs `lintMigration` over every file **before it opens a connection**, so a bad file is refused without a database and `--dry-run` reports it too. Four statement shapes are *contracting*, because each can break a running deploy when it lands before the last writer is gone:

| Kind | Why it contracts |
|---|---|
| `DROP TABLE` | a reader still selects from it |
| `DROP COLUMN` | a writer still names it |
| `ALTER COLUMN … TYPE` | values are rewritten under a reader compiled against the old type |
| `ALTER COLUMN … SET NOT NULL` | a writer that omits the column starts failing |

`ADD COLUMN … NOT NULL DEFAULT …` is **expand** and is deliberately not matched; so are `DROP CONSTRAINT IF EXISTS`, `DROP TRIGGER IF EXISTS` and `DROP INDEX IF EXISTS`, which are the DROP-then-ADD idiom `003` established for re-runnability.

**Declaring a contract step costs one comment line:**

```sql
-- contract: retires 010_scan_session_transition.sql; 006 row: 2026-09-XX E02-B08 drops scan_session.status
```

Both halves are required, and the lint refuses either alone. A contract step with no expand step to retire is not a contract step — it is a schema change nobody planned — and one with no `000-docs/006` decision-log row is one nobody signed. A header on a file that contracts nothing is also refused: it is a claim the file does not support.

**The lint does not parse SQL.** A SQL parser here would be a second, weaker Postgres, and every false positive it produced would train an author to reach for an escape hatch. It strips comments (necessary: `003` and `006` quote `ALTER TABLE … DISABLE TRIGGER` and `UPDATE … SET` at length in their headers) and matches four shapes. It is naive about string literals, and that naivety costs a *missed* detection, never a false one — the right direction for a rule whose false positives would teach people to route around it.

> ### AMENDMENT A1 (v1.1.0, 2026-09-05 — E03-D20 `longbox-e5b.3.30`; grounds: 056 §14, §9). THE FOUR SHAPES ABOVE STAND VERBATIM. A FIFTH IS ADDED BESIDE THEM.
>
> **The fifth shape is `ENABLE ROW LEVEL SECURITY` — and `FORCE`, and `CREATE POLICY` on a table that had no policy before.**
>
> | Kind | Why it contracts |
> |---|---|
> | `ENABLE ROW LEVEL SECURITY` | a reader with no tenant context stops seeing rows that are still there |
> | `FORCE ROW LEVEL SECURITY` | the same, and it binds the table OWNER too — the role every migration and CLI runs as (E02-D06) |
> | `CREATE POLICY` | an enabled table with no policy denies everything, so the policy is what makes it readable at all; RESHAPING one changes what a live reader sees without touching a column (056 F1 is exactly that failure, caught in review) |
>
> **It contracts in the OPPOSITE DIRECTION from the four above, which is why it needed its own row rather than a wider regex.** The four shapes remove something a live reader or writer still names, so the danger is the NEW schema under OLD code and the answer is 040 §8.2's — land the contract step after the last writer is gone. A tenant boundary removes nothing and breaks a running deploy anyway: after `migrations/029`, the application role **with no transaction-local context reads zero rows from every policied table** (056 §3, §6). So the dangerous state is **old code against the new schema**, and it fails **silently** — an empty result, not an error. 056 §14 states it for one bead in the words this amendment generalises: *"a database with the policies removed and this code deployed is a system where every statement still carries its `SET LOCAL` and nothing enforces it — silent, not loud."*
>
> **What the lint does, in the mechanism §2 already has.** A migration containing the shape must carry a `-- contract:` header. It carries a different HALF, because the existing half asks the wrong question: a boundary step **retires nothing**, so `retires <file>` would be a false claim, and forcing an author to invent one is how a declaration becomes ceremony. The form is:
>
> ```sql
> -- contract: deploy unit 031 + src/db/tenantContext.ts + the boot assertion; roll back the code first, then the policy; 006 row: 2026-09-XX E03-XXX
> ```
>
> Both halves are required and the lint refuses either alone, exactly as for `retires`. A `deploy unit` header on a file that enables no row-level security and creates no policy is refused for the same reason a `retires` header on an expand migration is: **it is a claim the file does not support.** A file that does both carries both lines.
>
> **The deploy-order rule the header is asking the author to have thought about:** *schema and code that introduce a tenant boundary deploy as ONE unit, and the rollback is BOTH or NEITHER.* §4's amendment states the two failure modes.
>
> **`029` is grandfathered, by name, with its reason** — §10. It landed under 056 before this rule existed, and **a shipped migration is never edited** (§4), so the rule applies forward and the old bytes are named rather than rewritten.
>
> **Naive in the same direction, and it matters here.** `029` builds its policies inside `format()` calls in a `DO` block, so the match lands on a string literal rather than on the executed statement — and the file is still correctly identified as the one that turns the boundary on. **`ALTER POLICY` and `DROP POLICY` are deliberately NOT matched:** every policy in this repository is written DROP-then-CREATE for the re-runnability §7 requires (`029:220`, because `CREATE POLICY` has no `IF NOT EXISTS`), so the CREATE half is already caught and matching the DROP would double every count — but a bare `ALTER POLICY` in some future file WOULD slip past this lint, and what sees a reshape is not a regex: the boot assertion compares every live policy's normalised `qual` and `with_check` against the declared set (`src/services/roleSeparation.ts:343–346`), so a reshaped policy fails to bind a port. The lint also cannot see a policy created by TypeScript: the second and third policies are emitted from `src/db/rowLevelSecurity.ts` and never appear in a migration at all (056 §4). **That half is not this lint's to hold** and no reader should think it is — the boot assertion's SET comparison is what catches a policy that exists and should not, or does not exist and should (056 F2), and it is the only mechanism that sees both sources.

---

## 3. Prior-snapshot upgrade tests

> **A migration must apply clean to an empty database AND to the previous released snapshot, with that snapshot's rows in it.**

Fixtures live in `tests/fixtures/schema/`, one per released schema, generated by `pnpm fixture:schema --upto NNN --out …` (a **`pg_dump --schema-only`** of a database migrated to that point, plus a small fixed-uuid seed written from the generator's own constant — never dumped) and **checked in**. **E03-D04 (`longbox-e5b.3.14`) made both halves of that parenthesis true.** The dump previously carried no `--schema-only` and no table filter, so its contents were whatever database `TEST_DATABASE_ADMIN_URL` happened to name — safe only because the target was usually right, when the target is an environment variable, and the output lands inside the repository. The generator now refuses any target that is not the local throwaway cluster (loopback host, that cluster's own superuser, non-production `NODE_ENV`), and the seed is emitted from `FIXTURE_SEED` with its tables named in each fixture's header, so a fixture can only ever carry rows this repository authored. `tests/integration/prior-snapshot-upgrade.test.ts` restores each, runs `pnpm migrate` forward, and asserts:

1. **Every append-only trigger is back at `ENABLE ALWAYS` (`tgenabled='A'`).** This is the E02-D05 downgrade hazard and it is not hypothetical: `003`'s trigger loop is DROP-then-CREATE, and `CREATE TRIGGER` always lands at the bypassable `'O'` default, so any upgrade path that re-runs a pre-`006` migration silently downgrades the sole enforcement of locked decision 4.
2. **The grant step succeeded** — proved from the *app* connection, not from the log line: the least-privileged role can read a table that did not exist in the fixture, and is still refused an UPDATE on an append-only one at the privilege layer.
3. **The derivations landed on rows that already existed** — `authored_by` per 041 §10.1, including both branches of `candidate_set`'s column-derivation; and `session_seq` is **still NULL**, because it is never backfilled.
4. **A second run is a clean skip** — no adoption, no re-apply, no drift.

The fixtures carry a `schema_migrations` table with **no `checksum` column**, which is the shape every real database has today. That makes this the only place the runner's `adopt-checksum` path is exercised, and it is the path every existing database takes exactly once.

**When a release adds migrations, add the fixture for the previous head in the same PR.** The test asserts the newest fixture is within four migrations of head, so letting the set go stale is a red build rather than a quiet erosion.

---

## 4. The ledger checksum, and compatible rollback

`schema_migrations` gains a `checksum` column — **added by the runner, not by a migration file**, because the ledger is the runner's own bookkeeping (it is `appGrant: "none"` for exactly that reason) and a migration that altered it would be a migration whose success depended on itself having run.

- An **unapplied** file is applied and its SHA-256 recorded.
- An **applied** file whose bytes still match is skipped.
- An applied file with `checksum IS NULL` **adopts** the on-disk digest, loudly, once. There is no honest baseline to compare against, so the adoption is printed rather than inferred from its absence.
- An applied file whose bytes have **changed** fails the whole run, before anything executes.

> **The fix for a checksum failure is never to force the checksum.** The old bytes already ran on every database that applied it, so editing them makes a fresh database diverge silently from an existing one. Revert the edit and add a NEW migration.

### Compatible rollback

> **A rollback is a new expand migration that reverses the visible effect. It is never a down-migration, and it never deletes rows.**

Three reasons, and only the first is about tooling:

1. **There are no down-migrations.** The runner has never had them and will not get them. A down-migration is a second, less-tested code path that runs exactly when things are already going wrong.
2. **Deleting rows is forbidden by the data model.** Locked decision 4 and 036 D5 — *"nothing is ever deleted"* — mean a rollback that removed rows would be corrupting history to undo a schema change. 041 §8's purge is the single designed exception and it removes bytes and referenced values, never rows.
3. **The contract half is not reversible anyway** (040 §8.3). Re-adding a dropped column does not restore its *values*: the derived state can be recomputed, the historical column value cannot. That is why the contract step lands only after the expand half has soaked with both paths live.

So: to undo an expand migration, ship a new expand migration that stops the column being read and leaves it in place; to undo a *constraint*, ship a new migration that drops it (a `DROP CONSTRAINT` is not on §2's contracting list precisely because it widens rather than narrows). The evidence that the ledger refuses an unknown checksum is `tests/migration-discipline.test.ts`.

> ### AMENDMENT A1 (v1.1.0, 2026-09-05 — E03-D20 `longbox-e5b.3.30`; grounds: 056 §14). THE THREE REASONS ABOVE STAND VERBATIM. A TENANT BOUNDARY ADDS A COUPLING THEY DO NOT EXPRESS.
>
> **The rule: schema and code that introduce a tenant boundary deploy as ONE unit, and the rollback is BOTH or NEITHER.** Not because a half-rollback is untidy, but because each half fails differently and one of them fails without saying anything:
>
> - **Code rolled back, policy still applied → a silent TOTAL READ OUTAGE.** The old build sets no transaction-local tenant, and no policy contains `OR … IS NULL` (056 §3), so every scoped read returns zero rows. Nothing raises; the application looks like a shop with no data.
> - **Schema rolled back, code still deployed → a BOOT REFUSAL.** `assertTenantIsolationOrThrow` compares the set of policies that exists against the set the design emits and refuses to bind a port when they differ (056 §4). Loud, and therefore the safer of the two.
>
> **Which makes the order asymmetric, and 056 §14 already wrote it down:** *"The compatible rollback is to redeploy the previous application build first and drop the policies second, in that order."* That sentence is a property of tenant boundaries generally, not of that one bead, and generalising it is why this amendment exists — 056 §14 says so in its own last clause.
>
> **The `-- contract: deploy unit` header (§2 A1) is where an author records which artifacts that unit contains** — the migration, the module that sets the context, the boot assertion, and the rollback order. The header does not enforce the deploy; nothing here can. It makes the unit **nameable at the moment somebody is holding a rollback decision at an hour when they will not be reading a decision record.**
>
> **This does not weaken §4's headline.** A rollback is still a new expand migration and never a down-migration, and it still never deletes rows. Dropping a policy is not a data change: it is the one shape where "undo the schema" is genuinely available, which is exactly why the ORDER has to be written down.

---

## 5. The schema this bead landed

Four migrations, all expand-only, all idempotent by hand, all proved in the integration lane.

| File | What | Record |
|---|---|---|
| `007_observation_envelope.sql` | `authored_by NOT NULL` on all fourteen append-only tables, each table's DEFAULT **being** 041 §10.1's derivation; `condition_assessment` and `human_confirmation` constrained to `'human'`; `session_seq bigint` + `UNIQUE (scan_session_id, session_seq)` on the eight session-scoped tables | 041 §2.3, §5.3, §10 row 2, §10.1 |
| `008_supersession_integrity.sql` | R1's **composite FK** `(supersedes_id, shop_id, scan_session_id)` on the three session-scoped tables, each with its redundant `UNIQUE (id, shop_id, scan_session_id)` target; R3's `CHECK (supersedes_id IS DISTINCT FROM id)` | 041 §3.2 (A2), I3, I4; 019 T24 |
| `009_request_idempotency.sql` | 042 §5.2's table, **table only** — no route wiring | 042 §5.2; 041 §8.5 (A11) |
| `010_scan_session_transition.sql` | 040 §3.3's table with all four CHECKs, three indexes, append-only trigger created **`ENABLE ALWAYS` in the same breath** | 040 §3.3, §8.1 item 1 |

**One** derivation is `GENERATED ALWAYS … STORED`: `candidate_set.authored_by` from `method` — 041 §10.1's "one column-derivation rather than path-derivation, and it is exact", exact because the CHECK at `001:89` **closes** `method`'s domain. There a generated column *is* the derivation rather than a copy of it: it cannot drift, needs no writer, and a writer that tries to contradict it is refused by Postgres.

`media_deletion.authored_by` takes a **DEFAULT**, not a generated column, and the difference is the point. Its rule reads `reason_code`, which `003:75` makes deliberately **open-world**; a generated expression over an open domain would decide authorship for every reason code that does not exist yet and would make `'provider'` unrepresentable on that table forever — exactly the guess 041 §10.1 refuses. The constant is `'system'`, because the only writer any ratified record specifies is E13-B01's retention sweep; a person-requested deletion arrives through a route that states its actor anyway (022 P7).

> **The DEFAULT's forward consequence, stated because it is not obvious.** A future writer that *omits* `authored_by` is **silently authored by the default rather than refused**. That is the price of not breaking the writers that exist today, and it is bounded rather than open: `condition_assessment` and `human_confirmation` carry the `= 'human'` CHECK, so the one class of wrong answer that matters — a machine authoring a human act (037 §1.1, 019 T7) — is refused whether the writer names the column or not.

`scan_session_transition.session_seq` is **`NOT NULL`**, unlike the eight columns `007` adds. 041 §5.3 says exactly that: `session_seq` is "NOT NULL on tables created after this record and nullable on the existing witness tables, never backfilled". `010`'s table is created after the record and starts empty, so there is no legacy row to accommodate and a nullable column there would permanently admit a writer that bypasses the assignment helper.

`request_idempotency`'s two response columns are **NULLABLE**, which departs from 042 §5.2's column list — and is the one place this bead changed a ratified shape. §5.2 wrote them `NOT NULL`; §5.3 step 1 requires the row to be INSERTed *before* the work is done. Both cannot hold. **042 → v1.2.0** records the correction: a NULL response means *in flight*, which reintroduces nothing, because §5.3's own argument is that such a row is unobservable outside the writing transaction.

`session_seq` is assigned by `assignSessionSeq` (`src/services/scanSession.ts`) inside `withTransaction`, immediately after `lockScanSession`, on the two wrapped routes. It takes `max() + 1` **across** the declared session-scoped tables, because the counter orders two rows about one session whichever tables they sit in. Postgres has no cross-table unique constraint, so what makes it correct across the set is the anchor lock; the per-table unique index is the loud failure if that ever stops being true.

**Not built here, deliberately:** 040 §8.2's contract step (`scan_session.status` still has a writer), 041 §10 row 2's `observed_at` / `definition_version` / `against_*` columns (their writers are E02-B08's), `operator_id`'s FK (its target `app_user` is E03's), R4's forward-ordering trigger (it belongs with 041 §3.3's `supersede()` helper, E02-B07's), and 034/036's tenancy and physical-item tables. **No composite-FK target forced a column from either of those records.**

---

## 6. The architecture gate

Two halves, because one cannot do the job.

**Half one — `pnpm depcruise`.** 029 §3.3's config, installed verbatim except for three defect fixes: **N1** (the `$1` backreference, without which the module-surface rule forbids every sibling import and is unsatisfiable), **N2** (a second rule forbidding the route layer from reaching the platform persistence module), and **N3**, found here — the specified `to: { path: "^pg$" }` never matches, because dependency-cruiser matches `to.path` against a dependency's RESOLVED path, which for an npm module is `node_modules/pg/…` under npm's flat layout and `node_modules/.pnpm/pg@8.23.0/node_modules/pg/…` under pnpm's virtual store — this repo resolves to the latter. The installed pattern is `(^|/)node_modules/pg/`, which covers both; `.dependency-cruiser.cjs` states it the same way, in the same words. That rule was green **by construction**; a negative fixture is what surfaced it, which is 029 §5 move 8's "prove the gate can fail" doing exactly its job on its first outing.

**Half two — `pnpm arch`.** The rules an import graph provably cannot express, as pure functions with negative fixtures:

| Rule | Record |
|---|---|
| No `SELECT *` under `src/` outside a declared row | 042 I5(b) |
| Exact inventory of `db.query` / `INSERT INTO` / provider imports / `pg` imports under `src/routes/` | 029 §5 move 8 (N2) |
| `cost_log` has exactly one writer | 029 §2.8, §5 move 7 (V5) |
| The idempotency INSERT precedes the anchor `FOR UPDATE` in every mutating handler | 042 §5.3(b), I22 (A6) |
| Exact inventory of `UPDATE scan_session` writers | 040 §8.2 step 1 |

The lock-order lint **passes vacuously today** — `009` landed the table and no handler writes it yet. That is the point: the rule exists for "a handler written six months from now by someone who has not read this section", so it has to be in place before the first handler that could violate it, and its negative fixture is what distinguishes a rule that has never failed from one that cannot.

### Every exemption is a row with a reason and a `kind`

042 §3.4 (A8) rules that allowlist rows carry `kind ∈ {exemption, defect}` and that **no defect-kind row may exist at G2**. Applying that honestly, **four defect rows exist at G2** — three that this gate declares, plus one 042 itself declared and that no gate here can see. Together they are the list of what G2 is waiting on:

| # | Row | Count today | Closing bead |
|---|---|---|---|
| 1 | `src/services/scanSession.ts` — 3 `SELECT *` (one legitimate: the trail read; two are 042 I5's named defect) | 3 | **E02-D08** `longbox-e5b.2.18` |
| 2 | `src/routes/scanSessions.ts` — 4 `db.query`, 1 `INSERT INTO`, 1 provider import, 1 `pg` import | measured, not quoted | **E02-D08** `longbox-e5b.2.18`; the draft INSERT is **E02-D09** `longbox-e5b.2.19` |
| 3 | `.dependency-cruiser.cjs` — `scanSessions.ts` named in three `pathNot` lists | 3 exemptions | same as row 2 |
| 4 | `GET /api/v1/shops` — returns **every shop in the database**, on 042 §3.4's route-table allowlist as `kind: defect` because pre-G2 there is no caller identity (042 §3.1 R1, A8) | 1 route | **E03-B02 / E03-B03** (authn, RBAC) |

**Why the closing beads are E02-D08 and E02-D09 and not E02-B07/E02-B08.** Those two are **closed decision beads** — they produced records 041 and 042 — and a closed bead cannot close a defect row: naming one would make rows 1–3 unclosable by construction while looking, in the table, as if they had an owner. The gate audit of E02-B10 caught that. Two discovered beads carry the work instead, and 015 carries their rows:

- **E02-D08** `longbox-e5b.2.18` — execute 042's contracts in the routes: response DTOs replacing `SELECT *`, routes off `db.query` into services, idempotency and causal-reference wiring, the identify DTO with its client change, and one error envelope.
- **E02-D09** `longbox-e5b.2.19` — land 041 §3.3's `supersede()` helper, R4's forward-ordering trigger, and move the draft INSERT service-side.

**Row 4 is included precisely because this bead's gate cannot see it.** 042 §3.4's route-table walk is E02-D08's to build; until it exists, the only place that defect is counted is here. Leaving it out would have made "four" read as "three" and let G2 look one row closer than it is.

Every count is **exact, never a ceiling**. A new occurrence fails the gate; a removed one *also* fails it until someone lowers the number — which is what makes the inventory shrink deliberately instead of drifting. Rows 1–3 are asserted by `tests/contract/architecture-gate.test.ts`, including row 3's exemption count, which was prose here and nothing anywhere else until the same audit.

**Staging (029 §5 move 8, F3).** `src/modules/` does not exist yet (E02-B03 creates it), so every module-boundary rule matches nothing today. That is F3's argument applied to the whole tree: a rule over an empty barrel is ceremony. The rules that bite today are the ones keyed on real paths, and those are the ones the gate-test proves can fail.

---

## 7. What an author does now

1. **Adding a table:** new migration, `CREATE TABLE IF NOT EXISTS`, `shop_id` FK, `created_at`, no `updated_at`. If it is a witness table, create the append-only trigger **and `ENABLE ALWAYS` it in the same statement block**, add the row to `src/db/appendOnlyTables.ts` with `ordersByObservedAt` and `sessionSeq`, and add an insert recipe to `tests/integration/append-only.test.ts`. If it is not, add an `APPEND_ONLY_EXEMPTIONS` row with a reason. The gate-test fails on either omission, in both directions.
2. **Adding a column:** `ADD COLUMN IF NOT EXISTS`, with a DEFAULT that *is* the derivation for existing rows, or nullable when 041 says the value is not derivable. Never a guess.
3. **Removing anything:** it is a contract step. Prove zero writers with the `pnpm arch` inventory first, then write the migration with its `-- contract:` header and its `000-docs/006` row.
4. **Before pushing:** `pnpm migrate --dry-run` (plan + lint, no database writes), `pnpm typecheck`, `pnpm test`, `pnpm depcruise`, `pnpm arch`, then the integration lane.

> **AMENDMENT A1/A2 (v1.1.0, 2026-09-05 — E03-D20). Items 1–4 stand verbatim; two more join them.**
>
> 5. **Enabling row-level security, forcing it, or creating a policy:** it is a contract step of the fifth kind (§2 A1). Write the `-- contract: deploy unit …; 006 row: …` header naming what ships with it and the rollback order, and read §4 A1 before you decide the deploy sequence — the two halves fail differently and one of them fails silently.
> 6. **Building an index on a table this migration did not create:** use `CONCURRENTLY` (outside a transaction; an interrupted build leaves an INVALID index to drop and rebuild), or write `-- index lock: <why the lock is free, or why the outage is acceptable and who agreed it>`. Today the lint WARNS and `pnpm migrate --dry-run` prints the line without a database; after the G3 cut-over it refuses (§9).

## 8. Required CI checks

The `Architecture gate` job is **new and must be added to branch protection on `main`**, taking the required-check count from 7 to 8. It runs `pnpm depcruise` and `pnpm arch`. Until it is added by the repository owner it runs and reports but does not block, which is the one gap this document cannot close by itself.

---

## 9. Index builds, `CONCURRENTLY`, and the G3 cut-over

**ADDED at v1.1.0 (E03-D20 `longbox-e5b.3.30`). Nothing above this line is edited by it.** The rule generalises what 056 §9 decided for one migration, in the consistency lens's own words, quoted there rather than paraphrased:

> none use CONCURRENTLY, so on a populated production table this migration takes ACCESS EXCLUSIVE for the duration of the index build — fine for a pre-launch pilot, worth a line in 044 or the deploy runbook before the estate has real row counts.

**The rule.** A `CREATE INDEX` without `CONCURRENTLY`, on a table the same migration did not create, must carry:

```sql
-- index lock: cost_log holds no live shop row before G3 (034:421); the build is instantaneous
```

**When it binds, and why that is a flag rather than a date.** `G3_LIVE_SHOP_ROWS` in `scripts/migrationDiscipline.ts` is **PROVISIONAL** and `false` today, so the lint **WARNS**. When it is `true`, the identical file is **REFUSED**. The trigger is 034:421 — *"019 §5 puts T24 in CI at G2 as a Core Safe criterion, and places Pilot A behind G3. RLS (E03-B04) is a G2 deliverable; the first live shop item is a G3 event."* Before that event every table this rule can reach is empty or synthetic and the lock costs nothing.

**It is a flag and NOT a hardcoded date because no ratified record schedules G3** — 014 **§5**, the gate frame (014:245–258), gives G3 its *required proof* and what it *unlocks* at 014:254 (*"Identity/condition/pricing/Shopify quality, ops, delivery and restore gates"* → *"25-item live batch"*), which is a set of conditions and not a calendar — and a guessed date compiled into a lint would start refusing migrations on a day nobody chose. Flipping it is a deliberate act with three parts: set the constant, write the 000-docs/006 row that records the date, and answer the warnings the flip turns into refusals.

**The same-file exemption, which is what makes the rule usable rather than ceremony.** Almost every migration here creates a table and indexes it three lines later. That table holds no rows, the lock is instantaneous, and asking for a declaration would teach the author that the declaration means nothing. So the lint skips an index whose target table appears in a `CREATE TABLE` in the same file. **One case is missed and is stated rather than hidden:** a file that creates a table, populates it, then indexes it. That is a missed detection, never a false one — §2's stated direction for every naive rule in this lint. A second: a build whose target is unreadable (`format('… ON %I')`, which is how `007` and `008` write theirs) is reported with the table as `«unread»` rather than assumed safe. **A third, and it is the one a future author is most likely to walk into:** `ALTER TABLE … ADD CONSTRAINT … UNIQUE` and `… ADD PRIMARY KEY` **build an index under `ACCESS EXCLUSIVE` exactly as a plain `CREATE INDEX` does, and are NOT matched.** Matching them would mean telling the `USING INDEX` form (which adopts an index already built `CONCURRENTLY`) from the building form, and that is parsing — the second, weaker Postgres §2 refuses. It is recorded here so the gap is a known one rather than a discovered one.

**What the tree looks like today.** Eleven shipped migrations carry the warning — `003`, `004`, `007`, `008`, `011`, `012`, `023`, `025`, `026`, `030`, `034` — and `029`'s eighteen do not, because it is grandfathered (§10). The count is asserted **exactly** in `tests/migration-discipline.test.ts`, on §6's precedent: a new occurrence fails the test, and a removed one also fails it until someone lowers the number.

**The eleventh arrived while this rule was being written, and that is the first evidence the rule works on somebody else's file.** `034_scan_session_composite_tenant_keys.sql` (E03-D19) landed on `main` mid-flight with `CREATE UNIQUE INDEX IF NOT EXISTS scan_session_scope_key ON scan_session (id, shop_id)` — a build on a table it did not create, which is exactly the shape §9 exists for. The exact-count assertion **failed at the rebase** and named the file, which is the mechanism doing its job rather than a nuisance. It **warns and does not refuse**, because the flag is false and `scan_session` cannot hold a live shop row yet; after the G3 cut-over the same statement would have had to declare itself. `034` is **not** added to §10's allowlist: it is a shipped file like the other ten, and the allowlist is for the one file that would otherwise REFUSE today.

**Two things this rule deliberately does not claim.** It does not know which tables hold rows — nothing static can — so `CONCURRENTLY` is required by the FILE's shape and not by a row count. And it does not make an already-applied migration dangerous: the runner skips an applied file by checksum and never re-runs its index builds, which is exactly what a §10 entry asserts on a human's authority.

---

## 10. The grandfather allowlist

**ADDED at v1.1.0 (E03-D20).** `MIGRATION_LINT_GRANDFATHER` in `scripts/migrationDiscipline.ts` names migrations that predate a rule they would otherwise fail. It exists because **a shipped migration is never edited** (§4): applying a new rule to old bytes can only be done by naming them.

**What an entry MEANS, precisely.** *This file has already been applied everywhere it will ever be applied, so the statement the rule guards against has already happened and cannot happen again.* It is **not** a waiver for a file that has yet to reach a database, and it is not a way to avoid writing a header.

**Every entry carries a filename, the shapes it covers, and a reason.** A contract test asserts that the list names an existing migration, that every entry's reason is substantive, and — today — that it names **exactly one file**.

| File | Shapes | Why |
|---|---|---|
| `029_row_level_security.sql` | `tenant boundary`, `non-concurrent index` | It landed under 056 (E03-B04, merged to `main` as `a451de8`) **before this rule existed**. Both halves are already argued in the record it landed under: the deploy unit, the rollback order and the silent-empty-read failure are 056 §14; the eighteen non-`CONCURRENTLY` builds are 056 §9's stated decision, free because 034:421 puts the first live shop item behind G3. **029 is never rewritten.** |

**Proving the row is load-bearing rather than decorative.** The test feeds `029`'s exact bytes to the lint under a **different filename** and asserts that both rules fire — the deploy-unit refusal and the index refusal — then feeds them under the real name and asserts silence. A grandfather row nobody can see working is indistinguishable from a rule that never applied.

**At the G3 cut-over, this list is where the shipped set is answered.** The ten files in §9 will refuse when `G3_LIVE_SHOP_ROWS` flips. The two honest answers, both recorded in the 006 row that accompanies the flip: add an entry per file with the reason above (it is true of every one of them — they were applied long before the first live shop), or, for any file still pending on some database, ship the index `CONCURRENTLY` in a new migration and leave the old one refused. **What is not an answer is deleting the rule, lowering it to a warning permanently, or editing the shipped bytes.**

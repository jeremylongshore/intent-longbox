<!-- TESTING.md schema v1 (see audit-tests/references/testing-md-spec.md) -->

# Testing Context — intent-longbox

<!-- Managed by audit-tests + implement-tests. Policy sections engineer-owned. -->

## Classification (policy)

Repo type: service + api (Fastify HTTP API over Postgres, static phone UI)
Primary language(s): typescript
Applicable layers: L1, L2, L3, L4-integration, L6-smoke
Waived layers: L5-perf (v0 pilot, no SLO yet), L5-chaos (single-node v0), L7-UAT (the Gotham City Limit pilot IS the UAT, per 000-docs/008)
Compliance overlay: none

## Thresholds (policy, hash-pinned)

<!-- DEFAULTS set by implement-tests 2026-09-01 — engineer review requested.
     coverage.line 80 is the handoff-specified floor; re-pin after any edit. -->

coverage.line: 80 # scoped to src/services + src/providers + src/consumers + src/catalog (routes/db glue → L4 lane)
flaky.tolerance: 0/3runs
<!-- mutation testing not installed in v0 (no mutation.kill_rate threshold); revisit post-pilot -->

## Installed gates (observational)

L0: @intentsolutions/audit-harness@1.3.1 (devDep, hash manifest initialized)
L1: husky@9 + lint-staged (pre-commit: conflict-marker refusal → lint-staged → typecheck → unit tests → escape-scan → verify; beads hooks chained). The conflict-marker step is the REPO'S OWN (`scripts/conflictMarkers.ts`, first lint-staged entry, refusing `<<<<<<< / ||||||| / ======= / >>>>>>>` at line start in staged .ts/.md/.sql/.json/.js) rather than a pattern added to the harness's escape-scan, because the harness's policy files are hash-pinned and this repository does not edit them. It exists because the class already escaped once: a three-way rebase left all four diff3 markers inside `000-docs/000-INDEX.md` and the commit was made — prettier reformats markdown without parsing it, eslint and tsc do not read `.md`, and no test asserted about a file nobody had changed. `tests/conflict-markers.test.ts` proves the refusal against a fixture and proves the near-misses (`=====`, `---`, `>>>`) are not flagged.
L2: eslint@10 flat config (typescript-eslint) + prettier@3 (pnpm lint / pnpm format:check, CI-enforced)
L3: vitest@3 + @vitest/coverage-v8, line-80 floor on src/services + src/providers + src/consumers + src/catalog (pnpm test:coverage, CI-enforced)
L4-integration: docker-compose.test.yml (postgres:16) + vitest.integration.config.ts — migration runner, append-only triggers, role separation, scan-session event flow (pnpm test:integration; skips cleanly without a DB; CI runs a postgres service container)
L6-smoke: fastify-inject HTTP smoke (tests/integration/smoke.http.test.ts): register shop → session → confirm → condition → price (dual sources: stub PriceCharting + stub eBay, one snapshot per source) → draft → drafted, stub Shopify client
L6-bdd: features/scan-session.feature (engineer-owned template; no runner wired yet)
CI harness gates: verify + escape-scan BLOCKING (`harness-verify` job, promoted 2026-09-02 PR #9); conform advisory (`harness-conform`, continue-on-error, per gate-promotion policy)

## Frameworks (observational)

unit: vitest 3.2.x
coverage: @vitest/coverage-v8 3.2.x
integration: vitest 3.2.x + pg against postgres:16 (docker compose / CI service container)
e2e-smoke: fastify inject (no browser layer in v0)
lint: eslint 10.x (typescript-eslint 8.x) + prettier 3.x
hooks: husky 9.x + lint-staged 17.x

## Last audit (observational)

date: 2026-09-02
grade: B+ (84/100) — strict service/api matrix applied; see TEST_AUDIT.md
auditor: audit-tests (handed off to implement-tests same day)
p0_gaps: 3 (L5-sec scanning absent; L4-contract absent; R19 MUST uncovered → beads longbox-e5b.7.1 / .14.7)
p1_gaps: 7 (main unprotected; Actions floating tags; integration skip-not-fail in CI; harness verify/escape-scan advisory; release.yml `npm test || true`; R3/R20 SHOULD; owner persona 33%)
p2_gaps: 7 (mutation, branches floor, arch rules, property tests, BDD runner, commitlint, CRAP unmeasured)
measured: unit 118/118, 99.67% lines / 89.75% branches; integration 14/14 vs postgres:16; bias LOW; gherkin-lint clean; escape-scan clean

## Traceability (observational, updated by audit-tests)

rtm.total_requirements: 20
rtm.by_moscow:
must: 16 (12 covered, 1 partial R5, 2 pilot-manual R2/R15, 1 uncovered R19 → beads longbox-e5b.7.1 eval set + longbox-e5b.14.7 CI regression)
should: 2 (0 covered — R3 resumable UI, R20 corpus freshness not built yet)
could: 0
wont: 1 (R16 Whatnot CSV, excluded)
rtm.orphaned_tests: 0 (providers-shared.test.ts traced to R7/R18 on 2026-09-02)
personas.declared: 2
personas.under_threshold: 1 (owner 1/3 — draft review is Shopify-side; weekly correction rollup not built)
journeys.declared: 3
journeys.fully_covered: 0
journeys.partial: 3 (scanning 6/7, reviewing-drafts 2/3, correcting 3/4; only build-closable P0 is R19)

## Operational notes (observational)

### Never build cases from a live `readdir` of `src/` (E02-D14, 2026-09-04)

`pnpm test` reported **1049 on some runs and 1050 on others, on a byte-identical
tree**, and every run was green. The whole difference was
`tests/contract/outbox-declarations.test.ts`, which emitted 18 or 19 cases.

The mechanism, because it will recur in any suite written the same way:
`tests/contract/architecture-gate.test.ts` proves the Architecture gate can
actually fail by WRITING `src/routes/__arch_fixture_violation__.ts` into the real
tree, running depcruise, and deleting it in a `finally` — the fixture has to live
there, because the rule it violates is scoped to `src/routes/**`. Vitest runs
test FILES in parallel workers and evaluates a `describe` body at collection, so
that write window overlapped another file's collection. Its `readdirSync` of
`src/routes` saw two entries or three, and `it.each` sized itself accordingly.

**That file writes TWO fixtures into the live tree, and both are hazards.** The
second is `src/modules/__arch_fixture__/{index,sibling}.ts`, written to prove the
`module-public-surface-only` rule stays green on a sibling import. Nothing sizes
cases off `src/modules` today, so it has never bitten — but it is the same
window, and the next suite to enumerate that directory inherits the same bug.
(Written as of E02-D14. **E02-D15 has since moved both fixtures out of the tree
entirely** — see the next note; the paragraph stays as the record of why.)

Nothing failed, which is the point: **a case count that moves on its own turns a
green suite into a claim it cannot support** — it says some case ran somewhere,
not that a named case ran here.

The rule that follows: a test may not turn a live directory listing under `src/`
into cases. Enumerate from **`git ls-files`**, which reads the index — it is
deterministic against any concurrent untracked write, and it is not a narrower
sweep, because a new file is in the index the moment it is staged, which is when
the pre-commit lane and CI both see it.
`tests/contract/secret-fixture-convention.test.ts` already did it this way.

Two guards now exist: the enumeration itself, and a case-count assertion in
`outbox-declarations.test.ts` that pins the file's own total to a literal.

**The count it compares against is DERIVED FROM THAT FILE'S OWN SOURCE TEXT** —
comment-stripped, every `it(` call site counted, every `it.each(…)` expanded by
the length of the array it names — and it throws rather than guesses when it
meets an `it` form it cannot read. That detail is the whole guard. The first
version added up two hand-maintained constants, so a new `it()` anywhere in the
file made it report one more case and the assertion still passed: the guard was
blind to exactly the change it exists to catch. A guard that a human has to
remember to update is not a guard; it is a comment that runs.

So today: a new test, a new file under `src/routes`, or a re-broken enumeration
all fail one named assertion with a message saying which case you are in.

**The conversion list this note used to carry is CLOSED (E02-D15, below).** It
named `tests/contract/catalog-surface.test.ts`,
`tests/contract/server-emits-no-operator-copy.test.ts` (both via
`collectSources`) and `tests/contract/consumer-write-shape.test.ts` (a
`readdirSync` of `src/consumers`) as suites worth converting if they ever flaked.
They still read the live tree, and that is now safe rather than lucky: no test
writes into `src/` at all, and a contract test fails if one starts.

### No test writes into `src/` any more (E02-D15, 2026-09-04)

E02-D14 fixed the READER. This fixes the WRITER, which is the half that made the
reader's problem possible.

`tests/contract/architecture-gate.test.ts` now runs both negative fixtures
against a SCRATCH COPY: `src/` is copied into a `mkdtemp` directory under
`os.tmpdir()`, the violating route file and the `__arch_fixture__` module pair
are written into the copy, and depcruise runs with that directory as its cwd.
The repository's tree is never touched, so the parallel-worker window that made
`pnpm test` report 1049 or 1050 cases no longer exists.

**The config is REFERENCED, never duplicated, and that is asserted.** A negative
fixture run against a copied `.dependency-cruiser.cjs` proves the copy can fail
and says nothing about the gate. So `.dependency-cruiser.cjs`, `tsconfig.json`,
`package.json` and `node_modules` are SYMLINKED into the scratch cwd, and a named
test asserts the link is a link, that its realpath is the repository's file, and
that the bytes read through it hash to the same sha-256. A further test asserts
the scratch copy cruises to the same `(modules, dependencies)` census as the real
tree — an untested fixture harness is worth what an untested gate is worth.
(`scripts/architectureRules.ts` needs none of this: the non-graph rules are pure
functions over in-memory records, so the test imports the real module.)

**The rule is now enforced, not written down.**
`tests/contract/no-test-writes-into-src.test.ts` sweeps every tracked `.ts` file
under `tests/` (from `git ls-files`, for the reason above) and checks **two
families** of call site, expanding local `const`s, exported constants, same-file
helper bodies and rename bindings:

- **a filesystem mutator** — its subject is the DESTINATION argument, argument 2
  for `cpSync`/`renameSync`/`symlinkSync`/`linkSync`/`copyFileSync` and argument 1
  for the rest, which is exactly what keeps `cpSync(<repo src>, <scratch src>)`
  legal;
- **a process spawn** — `execSync`, `spawnSync`, `execFile`, a promisified alias
  of one — where the subject is the WHOLE argument list, because
  `execSync("touch src/x.ts")` hides the path in a command string and there is no
  destination position to read.

Either way the subject must not name a `src` path segment unless it is rooted at
a `mkdtemp` scratch, or — for a spawn only — the command is a **named read-only
tool** (`git ls-files`, `git show`/`cat-file`/`rev-parse`, `depcruise` without
`--output-to`). That escape is a list of TOOLS, not of files: an unknown command
naming a `src` path fails closed, and clearing it means naming a command in a
diff a reviewer can see.

Reading `src/` stays free. Comments and string literals are blanked before call
detection, which is why the sweep can include the file that quotes violating
fixtures rather than exempt it. **Twenty-four fixtures** pin the rule — fifteen
that must fail and nine that must not, because a rule that fires on the honest
fix is an exemption waiting to be written — including the exact
`const fixture = join(repoRoot, "src/routes/…")` shape E02-D15 deleted.

The `src`-segment test uses a PATH boundary (quote, slash, bracket, comma,
whitespace) rather than "any non-identifier character", which would have matched
a hyphen and read `user-src-token.json` as a write into the source tree. And the
gate test has **no `inScratchTree(async (scratch) => …)` helper**: behind a lambda
the sweep resolved the scratch root only because the callback parameter happened
to share a name with the constant inside the helper, so a rename would have
blinded the rule on the file it polices, guarded by nothing but a comment. Each
case makes its own scratch tree and removes it in a `finally`.

**Three misses were closed rather than documented**, from the invariant review of
PR #84: `execSync("touch src/x.ts")` (the spawn family above), `createWriteStream`
and `openSync` (a descriptor writes as well as `writeFileSync` does), and
`import { writeFileSync as wfs }` (rename bindings, which inherit the original's
destination index). Four limits remain and are stated in the file: a path built
in one `tests/` module and mutated in another is caught only when the constant is
exported; string arithmetic is invisible; a spawn that mutates `src/` without
naming it (`execSync("make")`) is invisible for the same reason; and an
unlisted read-only tool produces a loud false positive rather than a hole.

### A slow-by-nature case carries its own timeout; the default stays 5s (E02-D16, 2026-09-04)

`vitest.config.ts` sets **no `testTimeout`**, so the unit lane's default is
vitest's 5s, and it stays there. That default is a tripwire for a hung promise,
not a performance budget: raising it globally would blunt the deadlock it exists
to catch, and it is a hash-pinned harness artifact this repository does not edit
anyway.

The consequence is the pattern: **a case whose work is expensive by nature
declares its own ceiling as `it(name, fn, 30000)`, and nothing else does.**
Sixteen cases in the unit lane carry one as this note lands: the four in
`tests/contract/architecture-gate.test.ts`, which each spawn `depcruise` over a
copy of the whole tree (60s/120s, predating this note); seven that arrived with
E03-D06 on the same day and independently of this bead — six in
`tests/authenticator-service.test.ts` and one in
`tests/contract/secret-surfaces.test.ts`, all of them running real argon2id over
recovery codes at the parameters `secrets.ts` sets; and the five this note is
about:

| Case                                                               | File                         | Why the work is slow                                                       |
| ------------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------------- |
| `A HOSTILE CANDIDATE RENDERS AS TEXT`                              | `tests/public-copy.test.ts`  | `mountApp`: jsdom import, first parse, `runScripts: "dangerously"`         |
| `A HOSTILE BAND VALUE cannot escape the class attribute`           | `tests/public-copy.test.ts`  | the same `mountApp` render                                                 |
| `ONE-TAP POSTS THE BOUNDED SHAPE`                                  | `tests/public-copy.test.ts`  | the same `mountApp` render                                                 |
| `stores an argon2id digest and clears any retirement on a re-set`  | `tests/auth-service.test.ts` | one REAL argon2id at 64 MiB x 3, which 048 §9.2 makes expensive on purpose |
| `refuses an unknown pair and a retired PIN with their own reasons` | `tests/auth-service.test.ts` | the decoy digest plus two verifies, for the same reason                    |

Two of those five had a ceiling before E02-D16, and the two attributions are
easy to run together, so: **E03-D07 gave the argon2 sibling
(`refuses an unknown pair and a retired PIN`) its ceiling in PR #77**, in this
same file; **E03-D06's seven are elsewhere** — `tests/authenticator-service.test.ts`
and `tests/contract/secret-surfaces.test.ts`, landed in PR #82. Different beads,
different files, the same rule reached three times in a week, which is the
argument for writing it down here rather than in one file's comments. The three that did not are added
here: `A HOSTILE BAND VALUE` and `ONE-TAP` are the cases that actually flaked —
bead `longbox-e5b.2.26` records them as found by the E03-D10 review of PR #81
and hit independently by three builders and a reviewer running worktrees in
parallel at load average 20–31 — and
`stores an argon2id digest` has not been seen to fail but does the same real
argon2id work as the sibling that did, which makes "has not failed yet" the only
argument for leaving it on the default. Its cost, with the command that
reproduces it: **612ms** run alone at load 28
(`pnpm vitest run tests/auth-service.test.ts -t "stores an argon2id digest"`),
and **~1.0s** inside a full run — one argon2id at the parameters `secrets.ts`
sets. The code comment on that case points here rather than carrying a number of
its own.

**The reason the two flaky cases looked cheap is the trap worth writing down.**
Whichever `mountApp` case runs FIRST pays the `jsdom` import and the first parse;
the ones behind it inherit a warm module and cost a few hundred milliseconds.
Four observations, each with the condition it was taken under, because none of
these numbers is comparable to another without one:

| Condition                                                                                                     | First `mountApp` case |
| ------------------------------------------------------------------------------------------------------------- | --------------------- |
| whole suite, `pnpm test`, 79 files in parallel workers, load 35                                               | **4.9s**              |
| this file alone, `pnpm vitest run tests/public-copy.test.ts --reporter=verbose`, load 31                      | **2.1s**              |
| this file alone, the same command **`--coverage`**, load 31                                                   | **2.0s**              |
| the E02-D16 invariant review's own pair, this file alone, no coverage at load 28 then `--coverage` at load 33 | **1.6s → 2.4s**       |

**Load dominates; coverage adds.** It adds clearly in the review's pair
(1.6s → 2.4s) and sits inside run-to-run noise in the file-alone pair, where it
measured 0.1s FASTER — which is the honest reading of four points and the reason
this note does not say "never subtracts": on these numbers it never materially
subtracts, and one 0.1s step inside noise is not evidence that instrumentation
is free either. The first draft of this note
wrote "4.9s (2.9s under v8 coverage)" from two runs taken at different loads,
which reads as instrumentation making the case faster — it does not, and two
measurements taken under different conditions do not belong in one parenthesis.

**The position effect is the one that reproduces**: run under
`-t "A HOSTILE BAND VALUE"`, where it becomes the first, `A HOSTILE BAND VALUE`
takes **2771ms** against the **285ms** it reports from its usual third position
in the same suite — same assertions, same tree, **9.7x from position alone**,
and the E02-D16 invariant review reproduced the same effect independently at
**21.7x** — that figure comes from the review's own log and is NOT reproducible
from this repository, unlike the 9.7x pair, which the command above produces.
2771ms against a 5000ms default is a margin of 1.8x, and the table above is the
size of the swing that margin has to absorb. Which case runs first is decided by
`-t` filtering, `.only`, retries and file order — not by the case itself — so a
per-case duration read off a full green run is not evidence that the case is
fast. The ceiling belongs on every case that could be first.

**What was deliberately NOT done:** no assertion changed; no argon2id parameter
was lowered to suit a test runner, which would be tuning a security floor
(048 §9.2); no blanket timeout was applied to files or suites;
`vitest.config.ts` was not touched. The parameters and durations above are
engineering facts about a test suite and are written down here for the next
person who has to judge a slow case — **021 B16 governs what leaves the
repository, and none of these numbers may go out as a performance claim.** The Postgres lane is unaffected and needs none of this:
`vitest.integration.config.ts` already sets `testTimeout: 30_000` for every case,
because provisioning a database is slow by definition.

The `30000` figures are CEILINGS, not measurements: they say "if this takes half
a minute, something is wrong", and nothing at all about how fast the suite is.

`.harness-hash` was re-pinned with `pnpm exec audit-harness init` AFTER this
edit. Nothing in the Thresholds or Classification sections moved: this is an
observational note about two test files, not a policy change, and no threshold,
waiver or coverage floor was touched.

### A rule only the type checker can see: `noPropertyAccessFromIndexSignature` and its scratch-compile contract test (E02-D13, 2026-09-04)

`tsconfig.json` now sets `noPropertyAccessFromIndexSignature: true`, and
`tsconfig.check.json` — which is what `pnpm typecheck` runs — inherits it by
`extends`, so the flag governs `src/`, `scripts/` and `tests/` alike.

**Why it is a testing note and not just a compiler setting.** The rule it
enforces is a DOMAIN rule: `SignatureFields` is a bare index signature, and
049 §6.2 recorded in terms that removing comic's four field names from that type
removed _"the advertisement, not the error"_ — `fields.series` on a card claim
still compiled, resolved to `string | null | undefined`, and evaluated to
`undefined`. A core-code caller would have read a real claim as an empty one with
no exception, no type error and no failing test. That is 030 §6 rule 1's
forbidden `if (vertical === "comic")` wearing a field name, and `pnpm arch`'s
rule 8 cannot see it because there is no vertical literal to match.

**Why the gate is a COMPILE and not a text rule in `scripts/architectureRules.ts`.**
Every rule in that file is a property of what a file SAYS. This one is a property
of what a TYPE MEANS: whether `fields.series` is legal depends on the declared
type of `fields`. A regex for `\.series\b` would fire on `ComicEditionFields.series`
— a genuinely declared property, read legitimately inside the pack — and miss
`claim.set` on a `Record<string, unknown>` alias. So the assertion is the
compiler's.

**The test is `tests/contract/signature-fields-are-not-dot-accessed.test.ts`**,
**six cases in two describes, of which THREE run a compiler.** The cases are
named rather than numbered below, and that is a correction rather than a style:
the first version of this note counted them across two `describe` blocks and got
the count wrong twice, which the MiniMax adversarial review of PR #89 caught. A
number that spans two blocks is a number nobody can check against the file.

_First describe, no compiler._ **`is set in the repository's tsconfig`** reads
`tsconfig.json` and asserts the flag. **`reaches scripts/ and tests/ by
inheritance, with no override`** reads `tsconfig.check.json` and asserts it
`extends` the base, declares no `noPropertyAccessFromIndexSignature` of its own,
and still includes all three source roots.

_Second describe._ **`compiles the scratch tree against the repository's own
tsconfig`** invokes no compiler at all: it asserts the harness is honest — the
config is a symlink whose `realpath` and sha-256 match the repository's file, and
`src/` is a copy rather than a link back. The other three follow E02-D15's rule to
the letter, because the negative fixture is a `.ts` file under `src/`: `src/` is
COPIED under `os.tmpdir()` and the fixture is written into the copy, while
`tsconfig.json`, `package.json` and `node_modules` are SYMLINKED back, so the
compile that judges the fixture is governed by the repository's real config.
**`compiles clean with no fixture`** exits 0 over the untouched copy, so a red
negative is the fixture and not a broken harness. **`refuses fields.series in
src/services with TS4111`** is the negative. **`accepts the same read through
brackets`** writes the identical read with `["series"]` and asserts it still
compiles, so what the negative proves is the DOT and not the file, the import or
the type.

**The gate was proven able to fail before it was believed — and the rung that
claim reached is worth naming, because it is not the one CI reaches.** What CI
runs on every push is the flag-ON state: the flag is set, the dot is refused, the
bracket twin compiles. Together those establish that the DOT is what the compiler
rejects. They do NOT, by themselves, establish that the FLAG is why. That was
established by a LOCAL REPRODUCTION, and the command is written down so the next
reader re-runs it rather than trusting this sentence:

```
sed -i 's/"noPropertyAccessFromIndexSignature": true/"noPropertyAccessFromIndexSignature": false/' tsconfig.json
pnpm vitest run tests/contract/signature-fields-are-not-dot-accessed.test.ts   # 2 failed | 4 passed
# then restore tsconfig.json from HEAD
```

The two that fail are `is set in the repository's tsconfig` and `refuses
fields.series in src/services with TS4111`. The other four stay green, including
the symlink case, which has no flag to read and could not go red on that
manipulation. That is the shape a working negative should have, and it is the
reason the bracket-access case exists.

**No CI job performs that flip, deliberately.** A test that rewrites the
`tsconfig.json` every other test is judged by is a worse trade than a reproducible
manual step: it would have to mutate the repository's own config (the same hazard
E02-D15 forbids for `src/`, one level up), or compile against a MODIFIED COPY —
and the copy is exactly what `compiles the scratch tree against the repository's
own tsconfig` exists to rule out. 018 §2 is the rule being followed: a claim may
not use a stronger rung than its artifact reached, so the flip is recorded as
REPRODUCED with its command rather than as TESTED in CI. The MiniMax adversarial
review of PR #89 was right to press on the word "proved" when the only linked runs
were flag-ON.

**Its cost, and its ceilings, which the E02-D16 note above governs.** Three of
the six cases spawn a real `tsc` over a copy of the whole tree, so this file adds
real time to `pnpm test`, and the honest range is wide because the work is
CPU-bound and this box runs several worktrees at once: **24.6s** run alone,
**29.1s** inside a full run, **64.9s** inside a full run that also spawned the
four `depcruise` cases from the pre-commit hook. The three carry `120_000` ceilings for exactly the reason that
note gives — a ceiling is not a measurement, it says "if this takes two minutes
something is wrong" — and the default 5s stays untouched, as does
`vitest.config.ts`. This makes it the second-slowest file in the unit lane after
`tests/authenticator-service.test.ts`, and that cost is the price of an assertion
no cheaper mechanism can make. **021 B16 governs what leaves the repository: none
of these durations may go out as a performance claim.**

`.harness-hash` was re-pinned with `pnpm exec audit-harness init` AFTER this
edit. Nothing in the Thresholds or Classification sections moved: this is an
observational note about a new contract test and a compiler flag, not a policy
change, and no threshold, waiver or coverage floor was touched.

### The coverage include gained `src/consumers/**` (E02-D07, 2026-09-04)

The floor is unchanged at 80. What changed is its SCOPE: `src/consumers/` now
counts alongside `src/services/` and `src/providers/`.

It is not glue, which is the test the original scope comment applies. A job
handler in that directory holds the fail-closed listing guard (043 §4.3, A3 —
the most costly amendment in that record) and the draft-composition rules that
019 T7 and locked decision 5 bind, and both are pure decisions a unit test
reaches without a database. Leaving the directory outside the include would have
meant the one function whose POLARITY the cannon inverted contributed nothing to
the number anyone looks at.

Measured after the change: **91.46% lines**, against the 80 floor.

⚠ ONE STALE PHRASE WAS DELIBERATELY NOT EDITED HERE, AND E04-D06 HAS SINCE
EDITED IT. The policy line then named two directories where four were floored.
It was flagged rather than quietly corrected by a build agent, because the block
is hash-pinned and engineer-owned; the correction was made by the next bead with
a mandate to change that block — see the note below, which brings the phrase up
to all four directories and re-pins the manifest.

### The coverage include gained `src/catalog/**` (E04-D06, 2026-09-04)

The floor is unchanged at 80 — again. What changed is the SCOPE, for the second
time and on the same test the E02-D07 note applies: does the directory hold
DECISIONS, or does it hold glue the Postgres lane already exercises?

`src/catalog/` is the least glue-like directory in the tree.

- `certify()` is ~790 lines of refusals (27 distinct finding codes) standing
  between a mistaken pack manifest and an IMMUTABLE `vertical_pack_version` row
  that every later `collectible_definition` and `edition` in that vertical cites.
  There is no repair path for such a row — the append-only trigger refuses the
  UPDATE — so certification is the only place those mistakes can be caught at all.
- `resolve()` is TOTAL over five outcomes and never throws past its caller. A
  sixth shape, or a throw on an anomalous chain, turns a catalog anomaly into a
  500 on a pricing lookup.
- `mint()` reconciles two retry policies on one INSERT: `23505` is absorbed on a
  savepoint with a fresh payload, `40001`/`40P01` propagate to the caller's
  `withTransaction`. Getting that backwards is silent in both directions.
- `rebuildSurvivorProjection()` decides what to do with a merge chain the
  write-time trigger says cannot exist, which is the only condition it was
  written for.

None of those is reachable from the integration lane, and that is the argument
rather than a convenience. `tests/integration/lcid-lifecycle.test.ts`,
`lcid-registry.test.ts`, `catalog-edition-write.test.ts` and
`crosswalk-catalog-authority.test.ts` assert what the DATABASE guarantees — the
triggers, the CHECKs, the index-only plan, the deliberately-absent UNIQUE. No
trigger has an opinion about a READ, and a cycle cannot be inserted into a
database whose no-cycle trigger is the thing under test, so the rebuild's own
anomaly path can only be reached with the merge edges supplied directly.

Seven unit files were added (`tests/catalog-{resolve,lifecycle,projection,mint,write,dedupe,manifest-registry}.test.ts`,
+88 cases) and they are asserted as CONTRACTS — which outcome, which refusal,
which columns a statement carries, in what order — not as line-hitting. The pg
seam is faked by `fakeTx` in `tests/fakes.ts`, which passes the module the REAL
SQL and records the REAL parameter list, so nothing about a query is invented by
the fake.

Measured: `src/catalog` went **70.68% → 98.76% lines** (1085/1535 → 1516/1535).
The whole floored set is **90.14% lines**, against the 80 floor. Nothing was
excluded, no threshold moved, and no ignore pragma was added.

⚠ TWO OBSERVATIONS WERE RECORDED RATHER THAN FIXED, because a coverage bead does
not edit shipped modules. **BOTH ARE NOW DISCHARGED (PR #83).** The observations
are kept as written — they are what E04-D06 saw, and a discharge is a discharge
kept, not an observation to overwrite — each followed by the clause that closed
it:

1. `projection.ts`'s `if (survivor === loser) continue` guard is UNREACHABLE. A
   self-pointing merge edge is a one-node cycle, so the bounded walk exhausts
   `READ_CHAIN_BOUND` and reports the LCID as an ANOMALY before the guard is
   consulted. The outcome where it matters is the same (no row written, no
   survivor guessed), and `migrations/017`'s `lcid_merge_not_self` CHECK refuses
   the edge at write time anyway. Asserted as it behaves; filed as **E04-D08**
   (`longbox-e5b.4.20`).
   **DISCHARGED by E04-D08 (PR #83): the guard is DELETED** — 047 A2's "a
   database that took writes outside the triggers" argues for deleting it, since
   in exactly that database a silent `continue` would DROP the self-edge while
   the anomaly branch NAMES it — and the anomaly branch now carries the
   unreachability proof plus the two write-time constraints that are the real
   defence. The file's last uncovered branch (the in-loop memo hit) gained a
   converging-chain case, taking `projection.ts` to 100% statements, branches,
   functions and lines and `src/catalog` to **98.89% lines**.
2. `manifestFor("toString")` returns `Object.prototype.toString` — a bare index
   into an object literal, from a signature promising
   `VerticalPackManifest | undefined`. The only caller,
   `scripts/register-pack.ts`, passes its `=== undefined` guard and is then
   stopped by `certify()`/`assertCertified()`, so the blast radius is a confusing
   error message and not a bad row. The test says so, and says that fixing the
   lookup with `Object.hasOwn` should delete the case — filed as **E04-D07**
   (`longbox-e5b.4.19`).
   **DISCHARGED by E04-D07 (PR #83), and by a `Map` rather than the
   `Object.hasOwn` that case named** — `MANIFESTS` is EXPORTED, so a guard inside
   `manifestFor` would leave every future `MANIFESTS[x]` site holding the trap;
   `PACKS` took the same fix because `packFor("toString")` was the worse half,
   failing with a `TypeError` where 030 §6 rule 3 requires
   `UnregisteredVerticalError` at the boundary. **The pinning case is deleted as
   it instructed**, replaced by `it.each` over eight inherited names at both
   entry points asserting `undefined` from one and the refusal CLASS from the
   other.

`.harness-hash` was re-pinned with `pnpm exec audit-harness init` AFTER this
edit, per the L0 rule that the manifest follows a reviewed policy change and is
never hand-edited.

### Running the integration lane locally with two database roles (E02-D06)

The lane now needs the two roles the server and the migration runner use in
production, because the properties it asserts are properties OF those roles: an
app role that could disable a trigger would pass every append-only test and still
leave locked decision 4 unenforced.

```bash
docker compose -f docker-compose.test.yml up -d   # provisions longbox_migrate + longbox_app
pnpm test:integration
docker compose -f docker-compose.test.yml down -v  # -v matters: roles are created on FIRST init only
```

`docker/postgres-init/00-roles.sql` creates both roles; the compose file mounts it
into `/docker-entrypoint-initdb.d`, and CI pipes the same file through `psql`
(a service container cannot mount it). **If the lane fails with `role
"longbox_migrate" does not exist`, the volume predates this change — `down -v`
and bring it back up.** The passwords in that file are throwaway values for a
loopback-bound container and are not secrets; production roles come from the
deploy contract with values in SOPS.

Which role each suite uses, and why:

| Connection              | Used by                                                       | Why                                                                                                                     |
| ----------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| superuser (`ADMIN_URL`) | `createFreshDb`, the `session_replication_role` bypass probes | only a superuser can reach replica role now, so the ENABLE ALWAYS proof runs against the strongest attacker             |
| `longbox_migrate`       | `runMigrations`, seeding, owner-side trigger assertions       | owns the schema; the trigger's own refusal is only observable here                                                      |
| `longbox_app`           | `role-separation.test.ts`, the HTTP smoke pass                | the least-privileged connection the server actually uses — the smoke pass doubles as proof the grant plan is sufficient |

Two properties `longbox_app` must hold in **every** environment, local and production, because the boot assertion enforces exactly these:

- it must be **NOSUPERUSER** — a superuser can `SET session_replication_role` and bypass even an `ENABLE ALWAYS` trigger;
- it must hold **no membership in `longbox_migrate` in any form — inheriting or not.** `GRANT longbox_migrate TO longbox_app WITH INHERIT FALSE` leaves the app able to `SET ROLE longbox_migrate` and then `DISABLE TRIGGER`; the check uses `pg_has_role(..., 'MEMBER')` rather than `'USAGE'` precisely so a non-inheriting grant cannot hide, and `role-separation.test.ts` reproduces that grant against a real cluster.

## Hash manifest

version: 2
last_init: 2026-09-01 by implement-tests (engineer re-pin requested after threshold review)
protected_files: # actual manifest: .harness-hash (+ repo patterns in .harness-hash-extra-patterns)

- features/scan-session.feature
- tests/TESTING.md
- eslint.config.js
- .prettierrc.json
- vitest.config.ts
- vitest.integration.config.ts

// .dependency-cruiser.cjs — SPECIFIED by 000-docs/029 v1.1.1 §3.3 (E02-B02,
// RATIFIED 2026-09-03), INSTALLED here by E02-B10 (bead longbox-e5b.2.10) per
// 029 §5 move 8. Encodes the layer stack in 029 §3.1. Every rule is an error, not
// a warning: a boundary that warns is a boundary that erodes, and the repo's own
// escape-scan treats a downgraded architecture rule as a REFUSE.
//
// THREE DEFECTS IN THE SPECIFIED BLOCK ARE FIXED HERE — two 029 §5 move 8 names,
// and a third the negative fixture caught while proving the gate can fail:
//   N1 — `module-public-surface-only` needs the `$1` backreference in `pathNot`, or
//        it forbids every intra-module sibling import and is unsatisfiable. Present
//        below; `tests/contract/architecture-gate.test.ts` proves a sibling import
//        keeps the gate green.
//   N2 — `routes-do-not-touch-the-database` as specified catches only the
//        `import type pg` proxy. The real damage is `db.query` on a Pool passed as
//        a PARAMETER, which no import-graph rule can see. Two things close it: the
//        second rule below (`routes-do-not-import-the-db-module`) and the
//        NON-GRAPH assertion in `scripts/architectureRules.ts`, which counts
//        `db.query` and `INSERT INTO` under `src/routes/` against a declared,
//        dated defect inventory. Import-graph analysis alone cannot close this,
//        and 029 says so.
//   N3 — NEW, found here: `routes-do-not-touch-the-database` as specified matched
//        `^pg$`, and dependency-cruiser matches `to.path` against a dependency's
//        RESOLVED path, which for an npm module is `node_modules/pg/lib/index.js`.
//        The rule was therefore green BY CONSTRUCTION — it could not fail — which
//        is precisely what 029 §5 move 8's "prove the gate can fail" exists to
//        surface, and a negative fixture is what surfaced it.

/** Modules that may be imported by a given module, keyed by owning module.
 *  There are NO L2->L2 edges (029 §3.1, cannon amendment H2): valuation does NOT
 *  import condition — workflow passes gradeRange in as a plain argument. */
const ALLOWED = {
  platform: [],
  identity: ["platform"],
  catalog: ["platform"],
  resolution: ["platform", "catalog"],
  condition: ["platform", "catalog"],
  valuation: ["platform", "catalog"],
  commerce: ["platform", "identity", "catalog"],
  workflow: ["platform", "identity", "catalog", "resolution", "condition", "valuation", "commerce"],
  reporting: ["platform"],
};

/** Modules permitted to import the BYOK provider seam (029 §4, locked decision 2). */
const PROVIDER_CONSUMERS = ["resolution", "valuation", "commerce"];

/** STAGED ENFORCEMENT (029 §5 move 8, cannon amendment F3).
 *  At E02-B10 only modules that hold real code are enforced. A rule over an empty
 *  barrel cannot be violated, so it proves nothing and costs review attention.
 *  Add a name here in the SAME PR that lands that module's first real file:
 *    catalog                      -> E04 (LCID, crosswalk, ingest)
 *    identity's location/user/role-> E03 (authn, RBAC)
 *    platform's retention trio    -> E13 / E03-B09 (sweep, object store)
 *  NOTE (E02-B10): `src/modules/` does not exist yet — E02-B03 move 1 creates the
 *  barrels and move 3 relocates the files. Until then every rule below that is
 *  keyed on `^src/modules/` matches nothing, which is exactly F3's staging
 *  argument applied to the whole tree: the rules that BITE today are the four that
 *  are keyed on real paths (`src/routes/`, `src/providers/`, `no-circular`,
 *  `no-orphans`), and those are the ones the gate-test proves can fail. */
const ENFORCED_MODULES = [
  "workflow",
  "resolution",
  "condition",
  "valuation",
  "commerce",
  "platform",
  "identity",
  // reporting holds real code today (src/services/costLog.ts:18), so it meets F3's
  // own criterion and is enforced from E02-B10.
  "reporting",
];

const ALL = Object.keys(ALLOWED).filter((m) => ENFORCED_MODULES.includes(m));

/** One "may-only-reach" rule per ENFORCED module, generated from the table above. */
const layerRules = ALL.map((mod) => ({
  name: `module-${mod}-boundary`,
  severity: "error",
  comment: `029 §3.1: src/modules/${mod} may import only [${ALLOWED[mod].join(", ") || "nothing"}].`,
  from: { path: `^src/modules/${mod}/` },
  to: {
    path: "^src/modules/([^/]+)/",
    pathNot: [
      `^src/modules/${mod}/`,
      ...(ALLOWED[mod].length ? [`^src/modules/(${ALLOWED[mod].join("|")})/`] : []),
    ],
  },
}));

module.exports = {
  forbidden: [
    ...layerRules,

    {
      name: "no-circular",
      severity: "error",
      comment: "029 §3.1: the module graph is a DAG. A cycle means a boundary was drawn wrong.",
      from: {},
      to: { circular: true },
    },

    {
      name: "module-public-surface-only",
      severity: "error",
      comment:
        "029 §2: a module's only public surface is its index.ts. Reaching into another " +
        "module's internals defeats the boundary without tripping the layer rule.",
      from: { path: "^src/modules/([^/]+)/" },
      to: {
        path: "^src/modules/([^/]+)/.+",
        // The $1 backreference is LOAD-BEARING (defect N1): it resolves to the
        // capture group in `from`, exempting same-module sibling imports. Without
        // it the rule forbids every intra-module import and is unsatisfiable.
        pathNot: ["^src/modules/$1/", "^src/modules/([^/]+)/index\\.ts$"],
      },
    },

    {
      name: "providers-are-contained",
      severity: "error",
      comment:
        "029 §4 / CLAUDE.md locked decision 2: only resolution, valuation and commerce may " +
        "import the BYOK provider seam. Routes, workflow, identity, catalog, condition, " +
        "reporting and platform must not. The ingest worker is exempted narrowly by the " +
        "next two rules: it may reach src/providers/catalog/** and nothing else there. " +
        "STAGED (E02-B10): `src/services/**` is exempt until E02-B03 move 3 relocates those " +
        "files into their modules — identify.ts and pricingService.ts import the seam today " +
        "and are resolution's and valuation's code sitting in the flat layout. `src/routes/` " +
        "is NOT exempt: 029 §5 move 6 (V1) is the route's provider import, and this rule is " +
        "what keeps a second one from appearing.",
      from: {
        path: "^src/",
        pathNot: [
          `^src/modules/(${PROVIDER_CONSUMERS.join("|")})/`,
          "^src/providers/",
          "^src/workers/ingest/",
          "^src/services/",
          // DESIGN, NOT A DEFECT, and scoped by a rule of its own rather than
          // waved through here (E02-D07, 043 §4.1). `src/consumers/` holds
          // COMMERCE's outbox job handlers — and commerce is one of the three
          // modules 029 §4 permits to import the provider seam, so this is the
          // rule working, not an exception to it. The directory is commerce's
          // code in the flat layout exactly as `src/services/` is resolution's
          // and valuation's, and it moves under `src/modules/commerce/` with
          // E02-B03 move 3, at which point this line and the `^src/services/`
          // line above are deleted together.
          //
          // ⚠ The exemption is not a blank cheque: `consumers-provider-scope`
          // below narrows it to the per-shop credential REGISTRY only. A vision
          // or pricing adapter imported directly by a job handler is still an
          // error, which is a tighter boundary than the flat exemption alone.
          "^src/consumers/",
          // THE ROUTE EXEMPTION IS GONE (E02-D08, 029 §5 move 6). It read
          // "`src/routes/scanSessions.ts:14` imports `providers/registry.js`
          // today", kind=defect. The provider resolution moved into
          // `src/services/sessionApi.ts`, so `^src/routes/` is covered by this
          // rule with no exception at all — which is what 042 A8's "no
          // defect-kind row may exist at G2" asks for, one row at a time.
        ],
      },
      to: { path: "^src/providers/" },
    },

    {
      name: "consumers-provider-scope",
      severity: "error",
      comment:
        "E02-D07 (043 §4.1): an outbox job handler may reach the per-shop credential " +
        "REGISTRY and nothing else under src/providers/. The registry resolves " +
        "`shop_credentials.key_ref` → env var (locked decision 2) and is the seam a " +
        "handler legitimately needs to build a channel client. A vision or pricing " +
        "adapter imported directly by a job handler means a commerce job grew a " +
        "resolution or valuation concern — the same shape `ingest-worker-provider-scope` " +
        "forbids one directory over. Written as its own rule rather than as a wider " +
        "hole in `providers-are-contained`, so the boundary is stated and testable " +
        "instead of merely absent.",
      from: { path: "^src/consumers/" },
      to: { path: "^src/providers/", pathNot: ["^src/providers/registry\\.ts$"] },
    },

    {
      name: "ingest-worker-boundary",
      severity: "error",
      comment:
        "029 §3.1 (H3): src/workers/ingest is a composition root, not a module. It may " +
        "reach catalog and platform only — never another domain module.",
      from: { path: "^src/workers/ingest/" },
      to: {
        path: "^src/modules/",
        pathNot: ["^src/modules/(catalog|platform)/"],
      },
    },

    {
      name: "ingest-worker-provider-scope",
      severity: "error",
      comment:
        "029 §3.1 (H3): the ingest worker's provider access is scoped to the catalog seam. " +
        "A vision or pricing adapter in an ingest worker means catalog ingest grew a " +
        "pipeline concern.",
      from: { path: "^src/workers/ingest/" },
      to: { path: "^src/providers/", pathNot: ["^src/providers/catalog/"] },
    },

    {
      name: "providers-import-platform-only",
      severity: "error",
      comment: "029 §3.1: the provider seam is a leaf. It may reach platform and nothing else.",
      from: { path: "^src/providers/" },
      to: { path: "^src/modules/", pathNot: ["^src/modules/platform/"] },
    },

    {
      name: "no-reporting-on-a-write-path",
      severity: "error",
      comment:
        "029 §2.8: reporting is strictly downstream. Nothing but the HTTP edge may import it. " +
        "The COST-LOG half of this rule — that src/services/costLog.ts is the only writer of " +
        "cost_log — is a non-graph assertion in scripts/architectureRules.ts, because 'who " +
        "issues this INSERT' is not an import edge (029 §5 move 7, V5).",
      from: { path: "^src/", pathNot: ["^src/routes/", "^src/modules/reporting/"] },
      to: { path: "^src/modules/reporting/" },
    },

    {
      name: "routes-do-not-touch-the-database",
      severity: "error",
      comment:
        "029 §3.1: the HTTP edge is thin. Raw pg in a route is how src/routes/scanSessions.ts " +
        "came to own five tables it does not own. THE DEFECT EXEMPTION IS GONE (E02-D08): that " +
        "file's `import type pg` moved into src/services/sessionApi.ts with the statements that " +
        "needed it, so the rule now covers every route file with no exception, and the exact " +
        "`pgImports` count in scripts/architectureRules.ts is zero for the same reason.",
      from: { path: "^src/routes/" },
      // DEFECT N3, found by E02-B10 while installing this file and fixed here: the
      // specified `path: "^pg$"` never matches. dependency-cruiser matches `to.path`
      // against a dependency's RESOLVED path, which for an npm module is
      // `node_modules/pg/lib/index.js`. As specified this rule was green by
      // construction — the exact failure mode 029 §5 move 8 demands be disproved
      // ("prove the gate can fail"), and the negative fixture in
      // tests/contract/architecture-gate.test.ts is what caught it.
      // The alternation covers both layouts: npm's flat `node_modules/pg/…` and
      // pnpm's virtual store `node_modules/.pnpm/pg@8.23.0/node_modules/pg/…`,
      // which is what this repo actually resolves to.
      to: { path: "(^|/)node_modules/pg/", dependencyTypes: ["npm"] },
    },

    {
      name: "routes-do-not-import-the-db-module",
      severity: "error",
      comment:
        "029 §5 move 8, defect N2 — the SECOND rule E02-B10 owed. The specified rule above " +
        "catches only `import type pg`; this one forbids the route layer from reaching the " +
        "platform persistence module at all, which is the edge an author would actually " +
        "write. IT IS NOW A CLEAN PASS (E02-D08): src/routes/scanSessions.ts imported " +
        "`withTransaction` from ../db.js and no longer does — the request transaction, the " +
        "idempotency INSERT and the anchor lock all live in src/services/sessionApi.ts, and a " +
        "handler that wants one calls a service. The by-name exemption that stood here is " +
        "deleted, which is the sentence 042 A8 wanted someone to be able to write.",
      from: { path: "^src/routes/" },
      to: { path: "^src/(db\\.ts|db/|modules/platform/)" },
    },

    {
      name: "platform-is-a-leaf",
      severity: "error",
      comment: "029 §2.9: if platform needs a domain fact, the design is wrong.",
      from: { path: "^src/modules/platform/" },
      to: { path: "^src/modules/", pathNot: ["^src/modules/platform/"] },
    },

    {
      name: "no-orphans",
      severity: "error",
      comment:
        "An unreachable module file is either dead or wired wrong. Error, not warn: " +
        "every rule in this file is an error on purpose, and the repo's escape-scan " +
        "treats a downgraded architecture rule as a refusal.",
      from: {
        orphan: true,
        pathNot: ["\\.d\\.ts$", "^src/server\\.ts$", "^src/modules/[^/]+/index\\.ts$"],
      },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^(dist|coverage|tests)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node"] },
    reporterOptions: { archi: { collapsePattern: "^src/(modules/[^/]+|providers|routes)" } },
  },
};

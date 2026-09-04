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
          // DECLARED DEFECT, kind=defect, closing bead E02-D08 `longbox-e5b.2.18` (029 §5 move 6, V1).
          // `src/routes/scanSessions.ts:14` imports `providers/registry.js` today. The
          // route is supposed to reach it behind workflow's public API; move 6 does
          // that. Exempted BY NAME so the rule still catches a SECOND route doing it,
          // and inventoried with an exact count in scripts/architectureRules.ts so a
          // second import inside THIS file is caught too. 042 A8: no defect-kind row
          // may exist at G2.
          "^src/routes/scanSessions\\.ts$",
        ],
      },
      to: { path: "^src/providers/" },
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
        "came to own five tables it does not own. DECLARED DEFECT: that file imports pg " +
        "(`import type pg` at :8) today and is exempted BY NAME, kind=defect, closing bead " +
        "E02-D08 `longbox-e5b.2.18` (029 §5 move 6) — with an exact `pgImports` count in " +
        "scripts/architectureRules.ts so a SECOND import inside that same file is still caught. " +
        "042 A8: no defect-kind row may exist at G2.",
      from: { path: "^src/routes/", pathNot: ["^src/routes/scanSessions\\.ts$"] },
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
        "029 §5 move 8, defect N2 — the SECOND rule this bead owes. The specified rule above " +
        "catches only `import type pg`; this one forbids the route layer from reaching the " +
        "platform persistence module at all, which is the edge an author would actually " +
        "write. DECLARED DEFECT, not a clean pass: src/routes/scanSessions.ts imports " +
        "`withTransaction` from ../db.js today and is exempted BY NAME below. That exemption " +
        "is kind=defect with closing bead E02-D08 `longbox-e5b.2.18` (029 §5 move 6), it is inventoried with an " +
        "exact count in scripts/architectureRules.ts, and 042 A8 rules that no defect-kind " +
        "row may exist at G2 — so this comment is also the statement that G2 does not close " +
        "until it is deleted.",
      from: { path: "^src/routes/", pathNot: ["^src/routes/scanSessions\\.ts$"] },
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

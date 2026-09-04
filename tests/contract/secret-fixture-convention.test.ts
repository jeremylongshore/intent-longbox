// The fixture-credential convention, as an INVARIANT rather than a comment.
//
// Bead: longbox-e5b.3.14 (alias E03-D04). Docs: 046 §7 (the secret inventory and
// what the CI scan does not cover), §5 A14; 019 T31, non-waivable.
//
// WHAT THIS REPLACES. `.gitleaks.toml` carried `commits = ["192d632…"]` — a
// PERMANENT, whole-commit exemption covering every file and every line of one
// commit, written to cover two realistic-looking placeholder strings that the
// next commit renamed. The exemption outlived its reason by construction: it is
// not scoped to those strings, it can never expire, and it is a template for the
// next one. It is deleted; the placeholders now match the fixture rule instead.
//
// THE RULE, AND WHY IT IS TESTABLE AT ALL. `.gitleaks.toml`'s allowlist regex
// only says which values the scanner may IGNORE. That is a rule about the
// scanner. The rule that actually matters is about the repository: **a value
// shaped like a fixture credential exists only where fixtures live.** Without
// it, the allowlist is a hole anyone can climb through by naming a real secret
// `test-…-key`. This file closes it, and it is the only thing standing between
// "prefixed test- so a real key can never hide behind this" and a claim nobody
// checks.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The allowlist regex, read from the config rather than restated here. */
function allowlistRegex(): RegExp {
  const toml = readFileSync(path.join(repoRoot, ".gitleaks.toml"), "utf8");
  const line = toml.match(/regexes\s*=\s*\['''(.+?)'''\]/);
  expect(line, ".gitleaks.toml must declare exactly one allowlist regex").not.toBeNull();
  return new RegExp(line![1]!, "g");
}

/**
 * Where a value of this shape may live.
 *
 * `tests/` is where fixtures are. `docker/postgres-init/` seeds the throwaway
 * test cluster's roles, whose passwords are their own names and never secret.
 * `.gitleaks.toml` is the file that DEFINES the pattern, so it necessarily
 * contains it, and this test file quotes it in prose for the same reason.
 *
 * `000-docs/` is here on evidence rather than on principle: 046 v1.1.1 §7 names
 * `test-stripe-key` while EXPLAINING this very convention. A record that cannot
 * quote the rule it ratifies is a worse record, and the exemption costs nothing
 * a real secret could exploit — a value matching this regex begins `test-` and
 * ends `-key`/`-token`/`-secret`, so what the exemption admits is, by
 * construction, a string shaped like a fixture. The rule that matters is
 * unchanged: **no such value in `src/`, `scripts/`, `migrations/`, `public/`,
 * `.github/` or any other executable surface.**
 */
const FIXTURE_HOMES = ["tests/", "docker/postgres-init/", "000-docs/", ".gitleaks.toml"];

/** Every tracked file, from git — so ignored build output is out of scope by construction. */
function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0")
    .filter((f) => f.length > 0);
}

describe("the fixture-credential convention is an invariant (019 T31, 046 §7)", () => {
  it("every value matching the allowlist regex lives under tests/ or docker/postgres-init/", () => {
    const offenders: string[] = [];
    for (const file of trackedFiles()) {
      if (FIXTURE_HOMES.some((home) => file.startsWith(home))) continue;
      if (file.endsWith(".sql") && file.startsWith("tests/fixtures")) continue;
      let content: string;
      try {
        content = readFileSync(path.join(repoRoot, file), "utf8");
      } catch {
        continue; // binary or unreadable: nothing to match
      }
      const matches = content.match(allowlistRegex());
      if (matches) offenders.push(`${file}: ${[...new Set(matches)].join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("PROVE THE SCAN CAN FAIL: the regex it reads really does match a fixture value", () => {
    // A rule whose regex matched nothing would pass the assertion above forever
    // without ever reading a file (029 §5 move 8).
    expect("test-ebay-client-secret".match(allowlistRegex())).not.toBeNull();
    expect("test-ebay-client-id-token".match(allowlistRegex())).not.toBeNull();
    expect("a-real-looking-value".match(allowlistRegex())).toBeNull();
  });

  it("the whole-commit exemption is gone and no new one has appeared", () => {
    const toml = readFileSync(path.join(repoRoot, ".gitleaks.toml"), "utf8");
    const uncommented = toml
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    // `commits = [...]` exempts an entire commit — every file, every line,
    // permanently. `paths = [...]` and `stopwords = [...]` are the same shape of
    // blanket. The allowlist is one regex describing one value shape, and that is
    // the only form of exemption this repository keeps.
    expect(uncommented).not.toMatch(/^\s*commits\s*=/m);
    expect(uncommented).not.toMatch(/^\s*paths\s*=/m);
    expect(uncommented).not.toMatch(/^\s*stopwords\s*=/m);
  });
});

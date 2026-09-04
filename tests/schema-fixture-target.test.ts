// `pnpm fixture:schema` runs only against the local throwaway test cluster.
//
// Bead: longbox-e5b.3.14 (alias E03-D04). Docs: 046 §5 A4/A14, §7.2 (the
// connection strings this repository passes through the environment).
//
// THE HAZARD, PLAINLY. `scripts/makeSchemaFixture.ts` reads a connection URL from
// `TEST_DATABASE_ADMIN_URL`, then `DROP DATABASE … WITH (FORCE)`s, `CREATE`s, and
// `pg_dump`s — writing the result INSIDE the repository, where the next thing
// that happens to it is `git add`. Aimed at a real database by an exported
// variable in the wrong shell, that is a destructive operation followed by live
// rows landing in a file somebody commits. Nothing checked the target.
//
// Three conditions now do, and each is independently sufficient: a loopback host
// (production is not on this machine), the local cluster's throwaway superuser
// (a loopback port can be a tunnel), and a non-production `NODE_ENV`.
import { describe, expect, it } from "vitest";
import {
  SEEDED_TABLES,
  UnsafeFixtureTargetError,
  assertLocalTestCluster,
} from "../scripts/makeSchemaFixture.js";

const LOCAL = "postgres://longbox:longbox@127.0.0.1:54329/postgres";

describe("assertLocalTestCluster (E03-D04)", () => {
  it("accepts the local test cluster, on either loopback spelling", () => {
    expect(() => assertLocalTestCluster(LOCAL, {} as NodeJS.ProcessEnv)).not.toThrow();
    expect(() =>
      assertLocalTestCluster("postgres://longbox:longbox@localhost:54329/postgres", {} as NodeJS.ProcessEnv)
    ).not.toThrow();
  });

  it("REFUSES a remote host — the accident this exists to prevent", () => {
    expect(() =>
      assertLocalTestCluster("postgres://longbox:pw@db.prod.example:5432/longbox", {} as NodeJS.ProcessEnv)
    ).toThrow(UnsafeFixtureTargetError);
    expect(() =>
      assertLocalTestCluster("postgres://longbox:pw@10.0.0.5:5432/longbox", {} as NodeJS.ProcessEnv)
    ).toThrow(/not loopback/);
  });

  it("REFUSES a loopback port that is not the throwaway cluster's superuser (a tunnel)", () => {
    expect(() =>
      assertLocalTestCluster("postgres://app_prod:pw@127.0.0.1:5432/longbox", {} as NodeJS.ProcessEnv)
    ).toThrow(/not the local test cluster's 'longbox'/);
  });

  it("REFUSES under NODE_ENV=production even when everything else looks local", () => {
    expect(() => assertLocalTestCluster(LOCAL, { NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(
      /NODE_ENV is production/
    );
  });

  it("REFUSES a value that is not a URL at all", () => {
    expect(() => assertLocalTestCluster("not-a-url", {} as NodeJS.ProcessEnv)).toThrow(/not a URL/);
  });

  it("never repeats the connection string's password in its refusal", () => {
    try {
      assertLocalTestCluster(
        "postgres://longbox:hunter2@db.prod.example:5432/longbox",
        {} as NodeJS.ProcessEnv
      );
      throw new Error("expected a refusal");
    } catch (err) {
      expect((err as Error).message).not.toContain("hunter2");
    }
  });

  it("names the seeded tables explicitly, so a fixture's contents are declared not discovered", () => {
    // The generator writes this list into every fixture's header. A dump with no
    // table filter could carry anything the target database held; a declared list
    // is the thing a reviewer can check a fixture against.
    expect(SEEDED_TABLES).toContain("shop");
    expect(SEEDED_TABLES).toContain("human_confirmation");
    expect(SEEDED_TABLES).not.toContain("shop_credentials"); // no credential rows in a fixture, ever
  });
});

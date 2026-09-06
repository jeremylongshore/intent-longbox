// L3 unit: the FIRST factor's statements, and the third session's shape.
//
// Bead: longbox-e5b.3.21 (alias E03-D11). Docs: 000-docs/057 §4.1–§4.5; 048
// §4.1, §9.1, §9.2, §9.3, §10.1, §12.4 rows 3/3a.
//
// The division is `auth-service.test.ts`'s, verbatim: a fake connection cannot
// tell you whether `FOR UPDATE` serialises two writers — `tests/integration/`
// proves that against a real Postgres — but it can tell you the clause is there,
// that the anchor is taken BEFORE the count, that a blocked attempt does no
// cryptography and writes nothing, and that an unknown address costs what a
// wrong password costs. Those are the properties 048 §9.1 and §9.3 turn on, and
// three of them are about the ORDER of statements rather than their results.
import { describe, expect, it } from "vitest";
import type { Queryable, Tx } from "../src/db.js";
import {
  MIN_PASSWORD_LENGTH,
  PRIVILEGED_ABSOLUTE_MS,
  PRIVILEGED_COOKIE,
  PRIVILEGED_IDLE_MS,
  PRIVILEGED_ROTATE_MS,
  asDeviceBound,
  issuePrivilegedSession,
  personIdForEmail,
  personWait,
  readCredential,
  provisionPassword,
  replacePassword,
  upsertPerson,
  verifyPassword,
  type SessionRow,
} from "../src/services/auth/index.js";
import { TEST_PIN_PEPPER } from "./testConfig.js";

interface Call {
  text: string;
  values: unknown[] | undefined;
}

function fakeDb(answer: (text: string, values: unknown[] | undefined) => unknown[] | undefined = () => []): {
  db: Tx & Queryable;
  calls: Call[];
} {
  const calls: Call[] = [];
  const db = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: answer(text, values) ?? [] };
    },
  };
  return { db: db as unknown as Tx & Queryable, calls };
}

const NOW = new Date(1_700_000_000_000);
const PERSON = "person-1";
const EMAIL = "somebody@example.invalid";
/** Long enough to satisfy the floor, and obviously synthetic (048 §7.1's rule). */
const PASSWORD = "not-a-real-password-0000";

/** No failures in the window, so nothing is owed. */
const NO_FAILURES = [{ failures: 0, age: null }];

function credentialRow(hash: string): Record<string, unknown> {
  return { id: "credential-1", app_user_id: PERSON, password_hash: hash, pepper_version: 1 };
}

describe("provisionPassword / replacePassword (048 §10.1; 063 §3.3's H4 split)", () => {
  it("PROVISIONS with `DO NOTHING`, so the ROW COUNT is what refuses an existing credential", async () => {
    // ⚠ **THIS CASE ASSERTED AN UPSERT AND E03-D24 CHANGED THE DECISION IT
    // GUARDS** (the data-model lens's H4). `setPassword` was one
    // `ON CONFLICT … DO UPDATE` willing to overwrite, shared by the route that
    // may only CREATE and the route that may only REPLACE, and told apart by an
    // `if` in one of them — so 063 §3.3's central claim was a fact about which
    // call site an author remembered. It is now two statements whose row count
    // is the enforcement, which is 048 R19's idiom one factor down.
    let insert: Call | undefined;
    const { db } = fakeDb((text, values) => {
      if (text.includes("INSERT INTO user_credential")) {
        insert = { text, values };
        return [{ id: "credential-1" }];
      }
      return [];
    });
    const out = await provisionPassword(db, {
      appUserId: PERSON,
      password: PASSWORD,
      pepper: TEST_PIN_PEPPER,
    });
    expect(out).toEqual({ ok: true, credentialId: "credential-1" });
    // One row per person is what makes 048 §9.1's anchor exist at all: there has
    // to be exactly one thing to lock — and `DO NOTHING` is what makes a second
    // provisioning a refusal rather than an overwrite.
    expect(insert?.text).toContain("ON CONFLICT (app_user_id) DO NOTHING");
    expect(insert?.text).not.toContain("DO UPDATE");
  });

  it("refuses `already_set` when the INSERT returns no row, without a SELECT first", async () => {
    const { db, calls } = fakeDb(() => []);
    const out = await provisionPassword(db, {
      appUserId: PERSON,
      password: PASSWORD,
      pepper: TEST_PIN_PEPPER,
    });
    expect(out).toEqual({ ok: false, refusal: "already_set" });
    // No existence check: the database decided, which is the whole of H4.
    expect(calls.filter((c) => c.text.includes("SELECT")).length).toBe(0);
  });

  it("REPLACES with an UPDATE that can never create, and refuses when it matches nothing", async () => {
    let update: Call | undefined;
    const { db } = fakeDb((text, values) => {
      if (text.includes("UPDATE user_credential")) {
        update = { text, values };
        return [];
      }
      return [];
    });
    const out = await replacePassword(db, { appUserId: PERSON, password: PASSWORD, pepper: TEST_PIN_PEPPER });
    expect(out).toEqual({ ok: false, refusal: "no_credential" });
    expect(update?.text).toContain("WHERE app_user_id = $1");
    expect(update?.text).toContain("RETURNING id");
  });

  it("stores an argon2id digest that is not the password and not reproducible without the pepper", async () => {
    let stored: string | undefined;
    const { db } = fakeDb((text, values) => {
      if (text.includes("INSERT INTO user_credential")) {
        stored = values![2] as string;
        return [{ id: "credential-1" }];
      }
      return [];
    });
    await provisionPassword(db, { appUserId: PERSON, password: PASSWORD, pepper: TEST_PIN_PEPPER });
    expect(stored).toMatch(/^\$argon2id\$/);
    expect(stored).not.toContain(PASSWORD);
    // 048 §9.2 / I9: the digest is over `password ‖ pepper`, so a `pg_dump` alone
    // is not an offline verifier. Two digests of the SAME password under
    // DIFFERENT peppers must not match, which is the only cheap way to show the
    // pepper actually reached the hash.
    let other: string | undefined;
    const second = fakeDb((text, values) => {
      if (text.includes("INSERT INTO user_credential")) {
        other = values![2] as string;
        return [{ id: "credential-2" }];
      }
      return [];
    });
    await provisionPassword(second.db, {
      appUserId: PERSON,
      password: PASSWORD,
      pepper: `${TEST_PIN_PEPPER}-different`,
    });
    expect(other).not.toBe(stored);
  });

  it("refuses a password below the floor BEFORE it writes anything", async () => {
    const { db, calls } = fakeDb();
    const out = await provisionPassword(db, {
      appUserId: PERSON,
      password: "short",
      pepper: TEST_PIN_PEPPER,
    });
    expect(out).toEqual({ ok: false, refusal: "too_short" });
    expect(calls).toHaveLength(0);
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThan(8);
  });
});

describe("verifyPassword (048 §9.1, §9.3)", () => {
  it("takes the ANCHOR before it counts anything (the write-skew order)", async () => {
    const { db, calls } = fakeDb((text) => {
      if (text.includes("FROM app_user u")) return [{ id: PERSON }];
      if (text.includes("FROM user_credential c")) return [credentialRow("$argon2id$not-a-match")];
      if (text.includes("FROM auth_attempt")) return NO_FAILURES;
      return [];
    });
    await verifyPassword(db, { email: EMAIL, password: PASSWORD, pepper: TEST_PIN_PEPPER, now: NOW });
    const anchor = calls.findIndex((c) => c.text.includes("FOR UPDATE OF c"));
    const count = calls.findIndex((c) => c.text.includes("FROM auth_attempt"));
    expect(anchor).toBeGreaterThanOrEqual(0);
    // 048 §9.1: every reader of the count is a writer of the row the count is
    // about. Counting first is the write-skew that gives N attempts N budgets.
    expect(anchor).toBeLessThan(count);
  });

  it("refuses BEFORE any cryptography when the person owes a wait, and records nothing", async () => {
    const { db, calls } = fakeDb((text) => {
      if (text.includes("FROM app_user u")) return [{ id: PERSON }];
      if (text.includes("FROM user_credential c")) return [credentialRow("$argon2id$whatever")];
      if (text.includes("FROM auth_attempt")) return [{ failures: 9, age: "0" }];
      return [];
    });
    const out = await verifyPassword(db, {
      email: EMAIL,
      password: PASSWORD,
      pepper: TEST_PIN_PEPPER,
      now: NOW,
    });
    expect(out).toEqual({ ok: false, reason: "wait" });
    // A blocked attempt tests no credential, so there IS no credential test to
    // record — and recording one would let a griefer ratchet the delay.
    expect(calls.some((c) => c.text.includes("INSERT INTO auth_attempt"))).toBe(false);
  });

  it("does the SAME WORK for an unknown address, and records a failure with a NULL person", async () => {
    const { db, calls } = fakeDb((text) => {
      if (text.includes("FROM app_user u")) return [];
      return [];
    });
    const out = await verifyPassword(db, {
      email: EMAIL,
      password: PASSWORD,
      pepper: TEST_PIN_PEPPER,
      now: NOW,
    });
    expect(out).toEqual({ ok: false, reason: "unknown_person" });
    // 048 §9.3's constant answer has a TIMING half, and this is it: the decoy is
    // verified so an unknown address costs what a wrong password costs. Without
    // it the body withholds "this address is unknown" and the clock publishes it.
    const failure = calls.find((c) => c.text.includes("INSERT INTO auth_attempt"));
    expect(failure?.values).toEqual([null, null, null, "password", "unknown_identifier"]);
    // No anchor was taken, because there is nothing to lock and nobody to key a
    // budget on — the asymmetry 057 §4.5 states rather than hides.
    expect(calls.some((c) => c.text.includes("FOR UPDATE OF c"))).toBe(false);
  });

  it("does the same work for a person with NO credential, and says so only inwardly", async () => {
    const { db, calls } = fakeDb((text) => {
      if (text.includes("FROM app_user u")) return [{ id: PERSON }];
      if (text.includes("FROM user_credential c")) return [];
      if (text.includes("FROM auth_attempt")) return NO_FAILURES;
      return [];
    });
    const out = await verifyPassword(db, {
      email: EMAIL,
      password: PASSWORD,
      pepper: TEST_PIN_PEPPER,
      now: NOW,
    });
    expect(out).toEqual({ ok: false, reason: "no_credential" });
    const failure = calls.find((c) => c.text.includes("INSERT INTO auth_attempt"));
    expect(failure?.values).toEqual([null, null, PERSON, "password", "no_credential"]);
  });

  it("accepts the right password and records nothing at all", async () => {
    // 048 R16: a SUCCESS is deliberately recorded nowhere. A success row would be
    // a per-person log of when each person signed in, which is the surface 022 P3
    // forbids, built to serve a reconciliation that derives from `app_session`.
    let hash: string | undefined;
    const setter = fakeDb((text, values) => {
      if (text.includes("INSERT INTO user_credential")) {
        hash = values![2] as string;
        return [{ id: "credential-1" }];
      }
      return [];
    });
    await provisionPassword(setter.db, { appUserId: PERSON, password: PASSWORD, pepper: TEST_PIN_PEPPER });

    const { db, calls } = fakeDb((text) => {
      if (text.includes("FROM app_user u")) return [{ id: PERSON }];
      if (text.includes("FROM user_credential c")) return [credentialRow(hash!)];
      if (text.includes("FROM auth_attempt")) return NO_FAILURES;
      return [];
    });
    const out = await verifyPassword(db, {
      email: EMAIL,
      password: PASSWORD,
      pepper: TEST_PIN_PEPPER,
      now: NOW,
    });
    expect(out).toEqual({ ok: true, appUserId: PERSON });
    expect(calls.some((c) => c.text.includes("INSERT INTO auth_attempt"))).toBe(false);
  });

  it("refuses the WRONG password and records the class inwardly", async () => {
    let hash: string | undefined;
    const setter = fakeDb((text, values) => {
      if (text.includes("INSERT INTO user_credential")) {
        hash = values![2] as string;
        return [{ id: "credential-1" }];
      }
      return [];
    });
    await provisionPassword(setter.db, { appUserId: PERSON, password: PASSWORD, pepper: TEST_PIN_PEPPER });

    const { db, calls } = fakeDb((text) => {
      if (text.includes("FROM app_user u")) return [{ id: PERSON }];
      if (text.includes("FROM user_credential c")) return [credentialRow(hash!)];
      if (text.includes("FROM auth_attempt")) return NO_FAILURES;
      return [];
    });
    const out = await verifyPassword(db, {
      email: EMAIL,
      password: `${PASSWORD}-wrong`,
      pepper: TEST_PIN_PEPPER,
      now: NOW,
    });
    expect(out).toEqual({ ok: false, reason: "wrong_password" });
    const failure = calls.find((c) => c.text.includes("INSERT INTO auth_attempt"));
    expect(failure?.values).toEqual([null, null, PERSON, "password", "wrong_password"]);
  });

  it("looks the person up by a LOWERCASED address, so capitalisation is not a second account", async () => {
    let lookup: Call | undefined;
    const { db } = fakeDb((text, values) => {
      if (text.includes("FROM app_user u")) {
        lookup = { text, values };
        return [];
      }
      return [];
    });
    await verifyPassword(db, {
      email: "SomeBody@Example.Invalid",
      password: PASSWORD,
      pepper: TEST_PIN_PEPPER,
      now: NOW,
    });
    expect(lookup?.text).toContain("u.email = lower($1)");
  });
});

describe("personWait — ONE budget, three factors (048 §4.3, 057 §4.5)", () => {
  it("counts password, TOTP and recovery-code failures together, per PERSON", async () => {
    let count: Call | undefined;
    const { db } = fakeDb((text, values) => {
      if (text.includes("FROM auth_attempt")) {
        count = { text, values };
        return [{ failures: 5, age: "0" }];
      }
      return [];
    });
    const wait = await personWait(db, PERSON, NOW);
    expect(wait).toBeGreaterThan(0);
    // 048 §4.3's reason, one factor lower: two forms of one factor with two
    // budgets is one budget an attacker doubles by alternating, and three forms
    // would triple it.
    expect(count?.text).toContain("method IN ('password','totp','recovery_code')");
    // Per PERSON and never per device: a password is not a possession-bound
    // credential and there is no device to key on (048 §9.1's own split).
    expect(count?.text).toContain("app_user_id = $1");
    expect(count?.text).not.toContain("device_id");
  });
});

describe("readCredential / personIdForEmail / upsertPerson", () => {
  it("names its columns and never selects a star (042 I5(b))", async () => {
    const { db, calls } = fakeDb(() => []);
    await readCredential(db, PERSON);
    expect(calls[0]!.text).not.toContain("SELECT *");
    expect(calls[0]!.text).toContain("c.password_hash");
  });

  it("does not overwrite an existing person's display name — and no longer UPDATES at all", async () => {
    // ⚠ **E03-D21 CHANGED THE MECHANISM AND KEPT THE PROPERTY.** The statement was
    // `ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email`, a no-op UPDATE
    // whose only job was to make `RETURNING id` produce a row on the conflicting
    // path. `migrations/036` policies `app_user`, and an `ON CONFLICT DO UPDATE`
    // is an UPDATE to row-level security — so keeping it would have meant granting
    // the admission scope the right to update ANY person's row, cross-tenant,
    // including their login identifier. `DO NOTHING` plus a read leaves the scope
    // holding SELECT and INSERT and nothing more, and the display name is now
    // preserved by construction. 000-docs/062 §3.2.
    const calls: Call[] = [];
    const { db } = fakeDb((text, values) => {
      calls.push({ text, values });
      // The address is already there: the INSERT returns nothing and the read
      // beside it resolves the id.
      if (text.includes("INSERT INTO app_user")) return [];
      return [{ id: PERSON }];
    });
    expect(await upsertPerson(db, { email: EMAIL, displayName: "Somebody Else" })).toBe(PERSON);
    const insert = calls.find((c) => c.text.includes("INSERT INTO app_user"));
    expect(insert?.text).toContain("ON CONFLICT (email) DO NOTHING");
    expect(insert?.text).not.toContain("DO UPDATE");
    expect(insert?.text).not.toContain("display_name = EXCLUDED");
    // The fallback projects the id ALONE — the declared `pnpm arch` exemption's
    // whole ground (000-docs/062 §3.3).
    const read = calls.find((c) => c.text.includes("SELECT u.id FROM app_user"));
    expect(read?.text).toBe("SELECT u.id FROM app_user u WHERE u.email = lower($1)");
    expect(read?.text).not.toContain("display_name");
  });

  it("returns the INSERTED id without a second read when the address is new", async () => {
    // The ordinary path costs one statement, exactly as it did before.
    const calls: Call[] = [];
    const { db } = fakeDb((text, values) => {
      calls.push({ text, values });
      return [{ id: PERSON }];
    });
    expect(await upsertPerson(db, { email: EMAIL, displayName: "Somebody" })).toBe(PERSON);
    expect(calls).toHaveLength(1);
  });

  it("REFUSES loudly when the address collided and the read came back empty", async () => {
    // Unreachable inside the admission scope, where the read spans tenants; it is
    // exactly what an ordinary tenant context produces, because the policy hides
    // the person the INSERT just collided with. A silent `undefined` there would
    // have become an invitation naming nobody.
    const { db } = fakeDb(() => []);
    await expect(upsertPerson(db, { email: EMAIL, displayName: "Somebody" })).rejects.toThrow(
      /could not be read back/
    );
  });

  it("lowercases on the way in, matching the sign-in lookup", async () => {
    let insert: Call | undefined;
    const { db } = fakeDb((text, values) => {
      if (text.includes("INSERT INTO app_user")) {
        insert = { text, values };
        return [{ id: PERSON }];
      }
      return [];
    });
    await upsertPerson(db, { email: "SomeBody@Example.Invalid", displayName: "Somebody" });
    expect(insert?.text).toContain("VALUES (lower($1), $2)");
    const { db: db2, calls } = fakeDb(() => []);
    await personIdForEmail(db2, EMAIL);
    expect(calls[0]!.text).toContain("lower($1)");
  });
});

describe("the privileged session's shape (048 §4.1, §12.4 row 3a)", () => {
  it("names a shop and a person, and names NO device, credential or parent", async () => {
    let insert: Call | undefined;
    const { db } = fakeDb((text, values) => {
      if (text.includes("INSERT INTO app_session")) {
        insert = { text, values };
        return [{ id: "session-1" }];
      }
      return [];
    });
    await issuePrivilegedSession(db, {
      shopId: "shop-1",
      locationId: null,
      appUserId: PERSON,
      now: NOW,
    });
    const values = insert!.values!;
    expect(values[1]).toBe("privileged");
    expect(values[2]).toBe("shop-1");
    // location, device, device credential: all NULL. 048 §4.1 puts this session
    // on "any device", and the device it will be on is a laptop this system has
    // never enrolled.
    expect(values[3]).toBeNull();
    expect(values[4]).toBeNull();
    expect(values[5]).toBeNull();
    expect(values[6]).toBe(PERSON);
    // No parent: a privileged session sits on nothing, so there is no pair to
    // mismatch and §3.6's pairing rule does not reach it.
    expect(values[7]).toBeNull();
    expect(values[8]).toBeNull();
  });

  it("carries the OPTIONAL location when the person named one", async () => {
    let insert: Call | undefined;
    const { db } = fakeDb((text, values) => {
      if (text.includes("INSERT INTO app_session")) {
        insert = { text, values };
        return [{ id: "session-1" }];
      }
      return [];
    });
    await issuePrivilegedSession(db, {
      shopId: "shop-1",
      locationId: "location-1",
      appUserId: PERSON,
      now: NOW,
    });
    // 057 §4.4: without it, a location-scoped manager reaches no location-scoped
    // permission from a desk at all — `authorize()` refuses a location grant when
    // the session stands nowhere.
    expect(insert!.values![3]).toBe("location-1");
  });

  it("uses its OWN lifetimes, and the absolute expiry IS the freshness window", async () => {
    let insert: Call | undefined;
    const { db } = fakeDb((text, values) => {
      if (text.includes("INSERT INTO app_session")) {
        insert = { text, values };
        return [{ id: "session-1" }];
      }
      return [];
    });
    await issuePrivilegedSession(db, {
      shopId: "shop-1",
      locationId: null,
      appUserId: PERSON,
      now: NOW,
    });
    const values = insert!.values!;
    expect(values[11]).toEqual(new Date(NOW.getTime() + PRIVILEGED_ROTATE_MS));
    expect(values[12]).toEqual(new Date(NOW.getTime() + PRIVILEGED_IDLE_MS));
    expect(values[13]).toEqual(new Date(NOW.getTime() + PRIVILEGED_ABSOLUTE_MS));
    // 048 §4.1's freshness window is this number and there is no second one
    // (057 §4.3): a `mfa_verified_at` column would be a second thing that could
    // disagree with the first.
    expect(PRIVILEGED_ABSOLUTE_MS).toBeLessThan(60 * 60 * 1000);
  });

  it("gets its own `__Host-` cookie, which is not either of the other two", () => {
    expect(PRIVILEGED_COOKIE).toBe("__Host-lb_priv");
    expect(PRIVILEGED_COOKIE).not.toBe("__Host-lb_device");
    expect(PRIVILEGED_COOKIE).not.toBe("__Host-lb_op");
  });
});

describe("asDeviceBound — the cookie slot is not the kind (057 §4.2)", () => {
  function row(over: Partial<SessionRow>): SessionRow {
    return {
      id: "s",
      chain_id: "c",
      kind: "device",
      shop_id: "shop-1",
      location_id: "location-1",
      device_id: "device-1",
      device_credential_id: "credential-1",
      app_user_id: null,
      parent_session_id: null,
      parent_chain_id: null,
      issued_at: NOW,
      rotate_after: NOW,
      idle_expires_at: NOW,
      absolute_expires_at: NOW,
      ...over,
    };
  }

  it("accepts a device row and an operator row", () => {
    expect(asDeviceBound(row({ kind: "device" }))).toBeDefined();
    expect(asDeviceBound(row({ kind: "operator", app_user_id: PERSON }))).toBeDefined();
  });

  it("REFUSES a privileged row presented in a device-bound slot", () => {
    // The hole this closes: a privileged token pasted into `__Host-lb_device`
    // resolves perfectly well — one table, one digest — and would then be a
    // "device session" whose device is NULL, with the rate bucket keyed on
    // undefined and every downstream fact carrying a device that does not exist.
    const privileged = row({
      kind: "privileged",
      app_user_id: PERSON,
      device_id: null,
      device_credential_id: null,
      location_id: null,
    });
    expect(asDeviceBound(privileged)).toBeUndefined();
  });

  it("REFUSES a row of the right kind whose columns are null anyway", () => {
    // The kind is what the DESIGN says; the columns are what the DATABASE
    // guarantees. A predicate that trusted one of them would be trusting a CHECK
    // constraint it cannot see from here.
    expect(asDeviceBound(row({ kind: "device", device_id: null }))).toBeUndefined();
    expect(asDeviceBound(row({ kind: "operator", app_user_id: PERSON, location_id: null }))).toBeUndefined();
  });
});

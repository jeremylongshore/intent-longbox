// The `AppConfig` every suite that builds an app needs, in one place.
//
// It exists because E03-D09 added two fields — `pinPepper` and `publicOrigins`
// (048 §9.2 R6, §5.1 R9) — and thirteen suites were each spelling the config
// literal out. A shape declared thirteen times is a shape that disagrees with
// itself the first time it grows, and this one is going to grow again at
// E03-D06 (the authenticator key) and E13-B02 (validated startup).
//
// **The pepper here is a FIXTURE, not a secret.** It is a fixed, obviously-fake
// string, checked in on purpose: 048 I9's canary asserts that no real pepper
// reaches a log, a fixture or a test output, and the way to keep that assertion
// meaningful is for the test pepper to be something no deployment would ever set.
import type { AppConfig } from "../src/config.js";
import { requireAuthenticatorKey, type AuthenticatorKeyring } from "../src/services/auth/index.js";
import { requireConnectorKey, type ConnectorKeyring } from "../src/services/connectors/shopify/index.js";

/** Long enough to pass `requirePinPepper`'s floor, and unmistakably not a secret. */
export const TEST_PIN_PEPPER = "test-pepper-not-a-secret-0000000000000000";

/**
 * The authenticator key ring the suites seal test TOTP secrets under (E03-D06).
 *
 * **A FIXTURE, not a secret**, on the pepper's reasoning above and one more of its
 * own: it is thirty-two bytes of a repeating, obviously-synthetic pattern, so a
 * value that ever appears in a log or an artifact is recognisably this and not a
 * deployment's. `tests/contract/secret-surfaces.test.ts` plants a canary INSIDE a
 * sealed secret and asserts the plaintext reaches no surface; that assertion only
 * means something if the key it is sealed under is one no deployment would hold.
 */
export const TEST_AUTHENTICATOR_KEY_V1 = Buffer.alloc(32, 0x11).toString("base64");

/** A second version, so a suite can prove a `key_version` rotation end to end. */
export const TEST_AUTHENTICATOR_KEY_V2 = Buffer.alloc(32, 0x22).toString("base64");

/** The ring `testConfig` carries: V1 only, so adding V2 is a visible act in a test. */
export function testKeyring(): AuthenticatorKeyring {
  return requireAuthenticatorKey({ LONGBOX_AUTHENTICATOR_KEY_V1: TEST_AUTHENTICATOR_KEY_V1 });
}

/**
 * The CONNECTOR key ring (E03-B06, 053 §3) — a FIXTURE, not a secret, on the
 * pepper's and the authenticator key's reasoning.
 *
 * Deliberately a DIFFERENT byte pattern from `TEST_AUTHENTICATOR_KEY_V1`: the
 * two rings are separate in production for a stated reason, and a test fixture
 * that made them equal would let a bug that used the wrong ring pass every
 * suite in this repository.
 */
export const TEST_CONNECTOR_KEY_V1 = Buffer.alloc(32, 0x33).toString("base64");

/** A second version, so a suite can prove a connector `key_version` rotation. */
export const TEST_CONNECTOR_KEY_V2 = Buffer.alloc(32, 0x44).toString("base64");

export function testConnectorKeyring(): ConnectorKeyring {
  return requireConnectorKey({ LONGBOX_CONNECTOR_KEY_V1: TEST_CONNECTOR_KEY_V1 });
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    databaseUrl: "",
    uploadsDir: "uploads",
    bands: { high: 0.85, medium: 0.5 },
    pinPepper: TEST_PIN_PEPPER,
    authenticatorKeys: testKeyring(),
    connectorKeys: testConnectorKeyring(),
    publicOrigins: ["http://localhost:3000"],
    ...overrides,
  };
}

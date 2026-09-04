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

/** Long enough to pass `requirePinPepper`'s floor, and unmistakably not a secret. */
export const TEST_PIN_PEPPER = "test-pepper-not-a-secret-0000000000000000";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    databaseUrl: "",
    uploadsDir: "uploads",
    bands: { high: 0.85, medium: 0.5 },
    pinPepper: TEST_PIN_PEPPER,
    publicOrigins: ["http://localhost:3000"],
    ...overrides,
  };
}

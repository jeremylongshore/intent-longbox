// A media ceiling raised past the point where it protects is refused at boot
// (E03-B07; invariant review of `1c25749`, item 5).
//
// The bug this closes was silent: `MEDIA_MAX_PIXELS=99999999999` disabled the
// decompression-bomb guard and nothing said so — the process started, the
// ceiling was arithmetic no image could exceed, and every later reader of
// `.env` would have believed a bomb was still refused. Refusing to boot is the
// same posture `assertGatewayConfigOrThrow` takes for `LLM_BASE_URL`, and for
// the same reason: a clamp with a log line is a control whose failure lives in
// a file nobody reads.
import { describe, expect, it } from "vitest";
import {
  MEDIA_CEILING_HEADROOM,
  MediaPolicyError,
  assertMediaPolicyOrThrow,
  mediaPolicy,
} from "../src/config.js";
import { DEFAULT_MEDIA_POLICY, type MediaPolicy } from "../src/services/media.js";

const KEYS = Object.keys(DEFAULT_MEDIA_POLICY) as Array<keyof MediaPolicy>;

describe("assertMediaPolicyOrThrow", () => {
  it("accepts the defaults", () => {
    expect(assertMediaPolicyOrThrow(DEFAULT_MEDIA_POLICY)).toEqual(DEFAULT_MEDIA_POLICY);
  });

  it("accepts a value at the headroom limit and refuses one above it, for every ceiling", () => {
    for (const key of KEYS) {
      const atLimit = { ...DEFAULT_MEDIA_POLICY, [key]: DEFAULT_MEDIA_POLICY[key] * MEDIA_CEILING_HEADROOM };
      expect(() => assertMediaPolicyOrThrow(atLimit)).not.toThrow();

      const over = { ...DEFAULT_MEDIA_POLICY, [key]: DEFAULT_MEDIA_POLICY[key] * MEDIA_CEILING_HEADROOM + 1 };
      expect(() => assertMediaPolicyOrThrow(over)).toThrow(MediaPolicyError);
      // The message names the offending key, because an operator fixing this is
      // looking at six variables.
      expect(() => assertMediaPolicyOrThrow(over)).toThrow(new RegExp(key));
    }
  });

  it("refuses the specific value that used to disable the bomb ceiling in silence", () => {
    expect(() => assertMediaPolicyOrThrow({ ...DEFAULT_MEDIA_POLICY, maxPixels: 99_999_999_999 })).toThrow(
      MediaPolicyError
    );
  });

  it("allows any ceiling to be LOWERED without limit — tightening is always allowed", () => {
    for (const key of KEYS) {
      expect(() => assertMediaPolicyOrThrow({ ...DEFAULT_MEDIA_POLICY, [key]: 1 })).not.toThrow();
    }
  });

  it("refuses a zero, a negative and a non-finite ceiling", () => {
    for (const bad of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => assertMediaPolicyOrThrow({ ...DEFAULT_MEDIA_POLICY, maxDimension: bad })).toThrow(
        MediaPolicyError
      );
    }
  });
});

describe("mediaPolicy", () => {
  it("falls back to the SAFE default, so an omitted policy tightens rather than opens", () => {
    expect(mediaPolicy({})).toEqual(DEFAULT_MEDIA_POLICY);
    expect(mediaPolicy({ media: { ...DEFAULT_MEDIA_POLICY, maxPixels: 10 } }).maxPixels).toBe(10);
  });
});

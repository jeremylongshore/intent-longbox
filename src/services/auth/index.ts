// The authentication module's door.
//
// Everything else in `src/services/auth/` is reached through this file, for the
// reason 029 §2 gives every module boundary: a subsystem whose internals are
// importable from anywhere has no boundary, only a directory. It matters more
// here than elsewhere — `verifyOperatorPin` is correct ONLY when it is called
// inside the transaction that holds its anchor lock, and `resolveToken` is
// correct only when its refusals reach the hook rather than a handler. A door
// makes those the only shapes a caller can reach for.
export {
  BACKOFF_BASE_MS,
  BACKOFF_CEILING_MS,
  DEVICE_COOKIE,
  DEVICE_FREE_ATTEMPTS,
  OPERATOR_COOKIE,
  PAIR_FREE_ATTEMPTS,
  DEVICE_ABSOLUTE_MS,
  DEVICE_IDLE_MS,
  DEVICE_ROTATE_MS,
  OPERATOR_ABSOLUTE_MS,
  OPERATOR_IDLE_MS,
  OPERATOR_ROTATE_MS,
  ROTATION_GRACE_MS,
  LOCKOUT_WINDOW_MS,
  PIN_LENGTH,
  clearCookie,
  isSameOriginRequest,
  lockoutWaitMs,
  pinRefusal,
  readCookie,
  requiredWaitMs,
  setCookie,
  shouldRotate,
  spentTokenVerdict,
  timingVerdict,
} from "./policy.js";
export type { LivenessVerdict, PinRefusal, SessionTiming, SpentTokenVerdict } from "./policy.js";

export { PIN_PEPPER_ENV, PepperConfigError, mintToken, requirePinPepper, tokenHash } from "./secrets.js";

export {
  chainHead,
  chainIsRevoked,
  issueDeviceSession,
  issueOperatorSession,
  lockAndRotate,
  lockLiveSessionsOf,
  lockSession,
  parentChainIsLive,
  readSessionById,
  resolveToken,
  revokeChain,
  revokeForReuse,
  revokeSessionsOf,
} from "./sessions.js";
export type { IssuedSession, SessionKind, SessionRefusal, SessionRow } from "./sessions.js";

export { mintDeviceCredential, resolveDeviceCredential } from "./devices.js";
export type { DeviceCredentialRow } from "./devices.js";

export {
  FREE_ATTEMPTS,
  lockoutWait,
  readOperatorPin,
  recordFailure,
  retireOperatorPins,
  setOperatorPin,
  verifyOperatorPin,
} from "./pin.js";
export type { AuthMethod, OperatorPinRow, PinVerdict } from "./pin.js";

export { resolvePrincipal } from "./principal.js";
export type { Principal, PrincipalOutcome } from "./principal.js";

export { liveMembershipShopIds, membershipAt, shopRoster } from "./memberships.js";
export type { MembershipScope, Role, RosterEntry } from "./memberships.js";

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
  ENROLLMENT_TTL_MS,
  INVITATION_TTL_MS,
  MAX_OUTSTANDING_ENROLLMENT_CODES_PER_SHOP,
  MAX_OUTSTANDING_INVITATIONS_PER_SHOP,
  SHOP_REDEMPTION_FREE_ATTEMPTS,
  SECOND_FACTOR_FREE_ATTEMPTS,
  redemptionWaitMs,
  secondFactorWaitMs,
  PIN_LENGTH,
  PRIVILEGED_COOKIE,
  PRIVILEGED_ABSOLUTE_MS,
  PRIVILEGED_IDLE_MS,
  PRIVILEGED_ROTATE_MS,
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

// E03-D06 — the second factor. The door is the same one, for the same reason:
// `verifyTotp` is correct ONLY inside the transaction that holds its anchor lock
// and that COMMITS whatever the verdict, and `redeemRecoveryCode` is correct only
// when its caller has already verified a first factor (048 R20).
export {
  AUTHENTICATOR_KEY_BYTES,
  AeadOpenError,
  AuthenticatorKeyError,
  authenticatorKeyEnv,
  requireAuthenticatorKey,
} from "./aead.js";
export type { AuthenticatorKeyring, SealedSecret } from "./aead.js";

export {
  MFA_REQUIRED_ROLES,
  RECOVERY_CODE_COUNT,
  enrollAuthenticator,
  issueRecoveryCodes,
  liveAuthenticator,
  mfaState,
  retireAuthenticator,
  secondFactorWait,
  verifyTotp,
} from "./authenticator.js";
export type {
  AuthenticatorRow,
  EnrolledAuthenticator,
  EnrollmentRefusal,
  RetirementReason,
  TotpVerdict,
} from "./authenticator.js";

// E03-D17 (security lens F1): `currentRecoveryNomination` is GONE. It projected
// a named human's name and contact note with no audit fact and no caller — the
// shape `readPerson` was deleted for, one file over.
export {
  RecoveryCodeAlreadyUsed,
  liveRecoveryCodeCount,
  recordRecoveryNomination,
  redeemRecoveryCode,
} from "./recovery.js";
export type { RecoveryNomination, RecoveryNominationKind, RecoveryVerdict } from "./recovery.js";

export {
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  TOTP_SECRET_BYTES,
  TOTP_STEP_WINDOW,
  base32Encode,
  mintTotpSecret,
  otpauthUri,
  stepAt,
  totpCode,
  verifyTotpCode,
} from "./totp.js";

export {
  asDeviceBound,
  chainHead,
  chainIsRevoked,
  issueDeviceSession,
  issueOperatorSession,
  issuePrivilegedSession,
  lockAndRotate,
  lockLiveSessionsOf,
  lockSession,
  parentChainIsLive,
  readSessionById,
  resolveToken,
  revokeChain,
  revokeForReuse,
  revokePrivilegedChainsOf,
  revokeSessionsOf,
} from "./sessions.js";
export type {
  DeviceBoundSession,
  IssuedSession,
  SessionKind,
  SessionRefusal,
  SessionRow,
} from "./sessions.js";

// E03-D11 — the FIRST factor and the third session's shape. The door is the same
// one for the same reason: `verifyPassword` is correct ONLY inside a transaction
// that holds its anchor lock AND that commits whatever the verdict, and
// `personWait` is the ONE budget three factors share (048 §4.3, 057 §4.5).
export {
  MIN_PASSWORD_LENGTH,
  lockCredential,
  personIdForEmail,
  personWait,
  readCredential,
  setPassword,
  verifyPassword,
} from "./credentials.js";
export type { PasswordRefusal, PasswordVerdict, UserCredentialRow } from "./credentials.js";

// E03-D17: `readPerson` is GONE and `Person` moved. Turning a key into a person
// is `src/identity/`'s, behind its own barrel and its own audit fact (034 §3.3,
// 019 T35(b)); this module keeps the WRITE that creates one, which returns an id.
export { upsertPerson } from "./people.js";

export { authenticatorsBelowVersion, resealAuthenticator } from "./authenticator.js";

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

export {
  CODE_ALPHABET,
  ENROLLMENT_CODE_LENGTH,
  INVITATION_CODE_LENGTH,
  RECOVERY_CODE_LENGTH,
  digestOf,
  mintEnrollmentCode,
  mintInvitationCode,
  mintRecoveryCode,
  normaliseCode,
} from "./codes.js";

export {
  InvitationAlreadySpent,
  countOutstandingInvitations,
  grantInvitation,
  issueInvitation,
  mayIssueInvitation,
  redemptionWait,
  verifyInvitation,
} from "./invitations.js";
export type {
  InvitableRole,
  InvitationRow,
  InvitationVerdict,
  IssuedInvitation,
  RedemptionRefusal,
} from "./invitations.js";

export {
  EnrollmentCodeAlreadySpent,
  countOutstandingEnrollmentCodes,
  enrollDevice,
  issueEnrollmentCode,
  verifyEnrollmentCode,
} from "./enrollment.js";
export type {
  DeviceKind,
  EnrolledDevice,
  EnrollmentCodeRow,
  EnrollmentVerdict,
  IssuedEnrollmentCode,
} from "./enrollment.js";

export { resolvePrincipal, resolvePrivileged } from "./principal.js";
export type { Principal, PrincipalOutcome, PrivilegedOutcome } from "./principal.js";

export {
  highestRole,
  liveMembershipShopIds,
  liveRolesOf,
  membershipAt,
  membershipsAt,
  revokeMembership,
  shopsForSession,
} from "./memberships.js";
// `shopRoster` / `RosterEntry` are GONE from this barrel — E03-D17 moved the
// picker's roster to `src/identity/`'s `resolveShopRoster`, the only `JOIN
// app_user` in the tree.
export type { MembershipRow, MembershipScope, Role, ShopSummary } from "./memberships.js";

// E03-B03 — the permission matrix and the one decision that reads it. The door
// matters here for the same reason it matters for `verifyOperatorPin`: an
// `authorize()` reached from outside this module would be a permission decision
// taken against memberships nothing guaranteed were live.
export {
  GRANTED_PERMISSIONS,
  PERMISSION_MATRIX_VERSION,
  ROLE_GRANTABLE,
  ROLE_GRANTS,
  authorize,
  mayGrantRole,
} from "./permissions.js";
export type { AuthorizationVerdict, RefusalReason } from "./permissions.js";

// E03-D14 — the Longbox-origin predicate (000-docs/058). The door matters here
// for a reason of its own: `designateOrigin` widens what 019 T35(c)'s audit can
// SEE and `retireOrigin` narrows it, so both belong behind the same boundary as
// the query that reads them, and neither is reachable from a route.
export {
  LONGBOX_STAFF_ORIGIN,
  ORIGIN_PREDICATE_FUNCTION,
  OriginDesignationRefused,
  designateOrigin,
  isLongboxOrigin,
  liveOriginDesignationCount,
  originDesignationsOf,
  retireAllOriginsOf,
  retireOrigin,
} from "./origin.js";
export type { DesignateOriginInput, OriginDesignation, RetireOriginInput } from "./origin.js";

export {
  decisionsByUnreconciledSessions,
  recordAuthorizationDecision,
  shouldRecord,
  unreconciledBreakGlassSessions,
} from "./authorizationAudit.js";
// `AuthorizationDecisionCount` is exported deliberately and not inlined: 059 §5
// makes the reader's RETURN TYPE the boundary that keeps a count of decisions
// from being read as a count of acts, and a type nobody can name is a boundary
// nobody can be held to. `pnpm arch` rule 3d refuses a numeric `acts`, `effects`
// or `requests` field in any file that reads this table.
export type {
  AuthorizationDecisionCount,
  AuthorizationDecisionRecord,
  UnreconciledSession,
} from "./authorizationAudit.js";

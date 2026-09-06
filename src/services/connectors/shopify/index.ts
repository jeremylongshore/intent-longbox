// The Shopify connector's public surface.
//
// Bead: longbox-e5b.3.6 (alias E03-B06). Docs: 000-docs/053.
//
// ONE DOOR, for the reason `src/services/auth/index.ts` has one and
// `src/catalog/index.ts` has one: the correctness of several functions here
// depends on the order they are called in and the transaction they are called
// inside. `completeInstall` writes the token version and the state's use row in
// ONE transaction because `UNIQUE (state_id)` is what settles a replay race;
// `receiveWebhook` records the receipt before it acts because the receipt is the
// dedupe key. A caller reaching past this barrel could take either half alone,
// and both halves alone are wrong.
//
// What is DELIBERATELY not exported: `retireEveryLiveToken` (it is only correct
// inside `receiveWebhook`'s transaction, after the receipt exists),
// `claimStoreDomain` (E03-D22 — correct only inside `completeInstall`'s
// transaction, under the tenant context of the shop the install state named;
// anywhere else it is an unguarded write to another tenant's configuration),
// `introduceTokenVersion` (see below) and the module-internal query row shapes.
// What IS exported beside them are the PREDICATES over the two refusals those
// paths raise, which are pure and safe.
//
// ⚠ **`introduceTokenVersion` WAS EXPORTED HERE AND IS NOT ANY MORE (E03-D22,
// the security lens's F1), and the reason is the one this barrel exists for.**
//
// It writes a `connector_token_version` and NOTHING ELSE: no claim on `shop`, no
// one-shop check, and `installStateId: string | null` because 053 §5.3 allows a
// version with no OAuth grant behind it (the pilot's Dev Dashboard token). So a
// caller reaching past this barrel could give shop B a live token for a store
// shop A has claimed — **two shops holding one store with no race at all**,
// which is the state 053 §7.3 makes dangerous and E03-D22 exists to prevent.
// The claim is a route-scoped guarantee (000-docs/061 §9 R5); un-exporting the
// one function that can bypass it is what keeps the scope honest instead of
// leaving a hole beside the fix.
//
// **It stays exported from `custody.ts` and the tests import the deep path**, on
// `claimStoreDomain`'s own precedent: this is a barrier against a casual caller
// in `src/`, not a claim that the function is unreachable. `completeInstall` is
// its only production caller.
export {
  CONNECTOR,
  ConnectorCallbackError,
  DECLARED_TOPICS,
  PROVISIONAL_INSTALL_STATE_TTL_MS,
  RECORDED_ONLY_TOPICS,
  SHOPIFY_APP_ENV,
  STATE_USE_INDEX,
  STORE_CLAIM_INDEX,
  isStateUseConflict,
  isStoreClaimConflict,
  WebhookRateLimitedError,
  WebhookRefusedError,
  completeInstall,
  exchangeCodeForToken,
  revokeAtProvider,
  mintInstallState,
  receiveWebhook,
  resolveAppCredentials,
  stateDigest,
  type CallbackRefusal,
  type CallbackResult,
  type ConnectorDeps,
  type MintedInstall,
  type ProviderRevoke,
  type ShopifyAppCredentials,
  type TokenExchange,
  type WebhookHeaders,
  type WebhookOutcome,
} from "./api.js";

export {
  CONNECTOR_OFFBOARDING_STEPS,
  ConnectorKeyError,
  ConnectorTokenRefusedError,
  RETIREMENT_MEANING,
  connectorKeyEnv,
  connectorResidual,
  isLive,
  loadTokenVersions,
  nextTokenVersionNo,
  offboardTokenVersion,
  openTokenValue,
  pickLiveToken,
  renderConnectorReceipt,
  revocationOutcome,
  requireConnectorKey,
  resolveTokenVersion,
  retireTokenVersion,
  type ConnectorKeyring,
  type ConnectorOffboardingReceipt,
  type ProviderRevocationObservation,
  type RetirementReason,
  type TokenOutcome,
  type TokenVersionRow,
} from "./custody.js";

export {
  COMPLIANCE_TOPICS,
  KNOWN_TOPICS,
  SHOPIFY_FORBIDDEN_SCOPES,
  SHOPIFY_MAX_SCOPES,
  SHOPIFY_REQUIRED_SCOPES,
  SHOPIFY_SCOPE_LIST_VERSION,
  TOPIC_APP_UNINSTALLED,
  // E03-B08 (000-docs/064). The replay and ordering predicates, and the two
  // PROVISIONAL floors the composition root resolves once.
  CUSTOMER_BEARING_SCOPES,
  PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS,
  PRIVACY_UNRESOLVED_DOMAIN_CEILING,
  TOPIC_DOMAIN_FIELD,
  TOPIC_POLICY,
  WEBHOOK_CLOCK_SKEW_SECONDS,
  WEBHOOK_RECEIPT_WINDOW_SECONDS,
  checkSignedDomain,
  classifyDelivery,
  domainInSignedBody,
  expandGrantedScopes,
  grantCouldReachACustomer,
  isAutoFulfillableTopic,
  isComplianceTopic,
  isShopifyShopDomain,
  loadWebhookWindows,
  parseScopeList,
  parseTriggeredAt,
  retirementCutoff,
  scopeSatisfies,
  topicPolicy,
  usableTriggeredAt,
  verifyQueryHmac,
  verifyWebhookHmac,
  type ReplayLookback,
  type ScopeVerdict,
  type SignedDomainVerdict,
  type TopicOrdering,
  type TopicPolicy,
  type WebhookDisposition,
  type WebhookWindowConfig,
} from "./policy.js";

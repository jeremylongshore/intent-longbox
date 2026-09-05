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
// inside `receiveWebhook`'s transaction, after the receipt exists) and the
// module-internal query row shapes.
export {
  CONNECTOR,
  ConnectorCallbackError,
  DECLARED_TOPICS,
  PROVISIONAL_INSTALL_STATE_TTL_MS,
  RECORDED_ONLY_TOPICS,
  SHOPIFY_APP_ENV,
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
  introduceTokenVersion,
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
  expandGrantedScopes,
  isShopifyShopDomain,
  parseScopeList,
  scopeSatisfies,
  verifyQueryHmac,
  verifyWebhookHmac,
  type ScopeVerdict,
} from "./policy.js";

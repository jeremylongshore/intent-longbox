-- 002 — dual pricing providers: allow kind='ebay' in shop_credentials so a
-- shop can carry its own eBay app credential key_ref (client ID env-var name;
-- secret at `${key_ref}_SECRET`). pricing_snapshot already has source +
-- fetched_at, so no event-table change is needed. Never edit 001.

BEGIN;

ALTER TABLE shop_credentials DROP CONSTRAINT shop_credentials_kind_check;
ALTER TABLE shop_credentials ADD CONSTRAINT shop_credentials_kind_check
  CHECK (kind IN ('anthropic','openai_compat','shopify','pricecharting','ebay'));

COMMIT;

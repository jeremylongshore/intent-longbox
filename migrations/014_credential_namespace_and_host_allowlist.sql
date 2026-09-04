-- 014_credential_namespace_and_host_allowlist.sql — E03-D01 (bead longbox-e5b.3.11)
--
-- 046 §5 A7 and A15, the two faces of one credential design, closed at the
-- column. Docs: 046 §4 B7, §5 A7/A15, §9.3 row 1, §11 I4; 034 §3; 019 T24/T31;
-- CLAUDE.md locked decision 2; 000-docs/044 §2 (expand-only), §7 rule 2.
--
-- THE PRIMITIVE THIS CLOSES, IN TWO COLUMN VALUES. `resolveKeyRef` was
-- `process.env[keyRef]` with no namespace rule (`registry.ts:34`) and `base_url`
-- became the request host with the resolved value sent as `x-api-key`
-- (`anthropic.ts:10,23,27`). A single `shop_credentials` row reading
-- (`key_ref = 'ANTHROPIC_API_KEY'`, `base_url = 'https://attacker.example'`)
-- therefore sends any secret the process holds to any server on the internet.
-- Nothing exploits it today for one reason only — 046 §5 A15's words — "E13 is
-- the only control: nothing over HTTP writes that table. That is an accident of
-- scope, not a decision." E03-B02/B03/B05 end that accident, so the constraint
-- lands BEFORE the first writer, not with it.
--
-- WHY A CHECK AND ALSO A FUNCTION. The Kleppmann amendment on this bead is that
-- the resolver is the control and the constraint is defence in depth, not the
-- other way round: a CHECK sees one column of one row and can never know which
-- shop owns it, while `resolveKeyRef(keyRef, shopSlug)` refuses a name that does
-- not carry that shop's derived prefix and refuses it BEFORE `process.env` is
-- read. So the split is deliberate and stated:
--
--   * the DATABASE enforces the SHAPE — `LONGBOX_<SEGMENT>_<REST>` — which is
--     what kills the exfiltration primitive, because every global secret this
--     process holds (`ANTHROPIC_API_KEY`, `DATABASE_URL`, `LLM_API_KEY`, an
--     operator's `AWS_*`) is unnameable by a row that satisfies it;
--   * the RESOLVER enforces the SHOP BINDING — `LONGBOX_GOTHAM_…` for the shop
--     whose slug is `gotham` — which is the cross-tenant half (046 §5 A7) and is
--     a two-table fact no CHECK constraint may express.
--
-- A trigger could have joined `shop` and enforced the binding in the database.
-- It is deliberately not used here: 041 §1 E14/E15 is the record that a trigger
-- is switchable off by the table owner, and a control whose stronger half can be
-- disabled by the principal that runs migrations is a weaker control than a
-- function every caller must pass through. The CHECK cannot be disabled at all,
-- which is why the un-disable-able half is the half that carries the shape rule.
--
-- SHAPE: EXPAND ONLY. Two constraints added, nothing dropped, nothing retyped,
-- no column made NOT NULL. Re-runnable by hand (DROP IF EXISTS then ADD — the
-- idiom `003` established, and `DROP CONSTRAINT IF EXISTS` is expressly not on
-- 044 §2's contracting list).
--
-- ⚠ OPERATIONAL IMPACT, STATED RATHER THAN DISCOVERED. This migration FAILS
-- LOUDLY on any database holding a `shop_credentials` row written under the old
-- `SHOP_<SLUG>_<KIND>` convention (`.env.example:114-125`, 046 §7.2 row 10).
-- That is the intended behaviour and not an oversight: such a row names a
-- variable outside the shop's namespace by construction, which is the defect.
-- The fix is to re-register the shop's credential rows under
-- `LONGBOX_<SLUG>_<PROVIDER>_KEY` (`scripts/register-shop.ts`, updated in this
-- same commit) and re-point the environment; it is never to weaken the CHECK.
-- No shop has been onboarded to a live database at the time of writing, and the
-- checked-in schema fixtures carry zero `shop_credentials` rows
-- (`tests/fixtures/schema/after-010.sql:712`), so the upgrade path is proved
-- empty rather than assumed empty.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. key_ref must be shop-namespaced BY SHAPE (046 §5 A7/A15, §11 I4)
--
--    `^LONGBOX_[A-Z0-9]+_(ANTHROPIC|OPENAI|SHOPIFY|PRICECHARTING|EBAY)_KEY(_SECRET)?$`
--    — the `LONGBOX_` prefix, exactly ONE slug segment carrying no underscore,
--    and one of six closed suffixes. `register-shop` derives exactly these.
--
--    ⚠ THE SINGLE-SEGMENT RULE IS LOAD-BEARING, AND IT IS A CORRECTION. The
--    first version of this constraint read `^LONGBOX_[A-Z0-9]+_[A-Z0-9_]+$`, and
--    an invariant review found the hole: shop `gotham` could name
--    `LONGBOX_GOTHAM_CITY_ANTHROPIC_KEY` — the SIBLING shop `gotham-city`'s own
--    variable — and both this CHECK and the resolver's `startsWith` accepted it.
--    That is 046 §5 A7's cross-shop confusion surviving inside the control built
--    to stop it. A CHECK cannot look up which shop owns a row, so it could never
--    refuse the sibling by comparing slugs; what it CAN do is make the sibling
--    name unrepresentable, by leaving no second slug segment for `CITY` to hide
--    in. `LONGBOX_GOTHAM_CITY_ANTHROPIC_KEY` now fails because `CITY` is not a
--    legal suffix. `scripts/register-shop.ts` folds `gotham-city` to
--    `LONGBOX_GOTHAMCITY_…` accordingly — separators are STRIPPED, not replaced.
--
--    The eBay pair's secret is the NAMED member `EBAY_KEY_SECRET` rather than a
--    `${key_ref}_SECRET` consequence, because deriving a second name by appending
--    to a validated one is how a prefix rule re-enters through the back door.
-- ---------------------------------------------------------------------------
ALTER TABLE shop_credentials DROP CONSTRAINT IF EXISTS shop_credentials_key_ref_namespaced;
ALTER TABLE shop_credentials ADD CONSTRAINT shop_credentials_key_ref_namespaced
  CHECK (key_ref ~ '^LONGBOX_[A-Z0-9]+_(ANTHROPIC|OPENAI|SHOPIFY|PRICECHARTING|EBAY)_KEY(_SECRET)?$');

-- ---------------------------------------------------------------------------
-- 1b. shop.slug has a charset, so the set of possible env folds is checkable
--
--    `001:25` gave `slug` a UNIQUE constraint and no charset at all, and every
--    key_ref's namespace is derived from it. A slug containing `_`, `.` or a
--    space would fold into a name whose segmentation nobody intended — the same
--    class of defect as the sibling case above, entered from the other end.
--
--    Restricting to `^[a-z0-9-]+$` matches what `scripts/register-shop.ts` has
--    always validated at the CLI (`/^[a-z0-9-]+$/`), so this constraint makes an
--    existing convention un-bypassable rather than introducing a new rule. The
--    fold is still not injective (`gotham-city` and `gothamcity` both give
--    `GOTHAMCITY`); that collision is refused by `register-shop`, which is the
--    only place a second colliding slug can be created.
--
--    EXPAND: a new constraint on a config table, no column touched, no row
--    rewritten, `DROP CONSTRAINT IF EXISTS` first for hand re-runnability.
-- ---------------------------------------------------------------------------
ALTER TABLE shop DROP CONSTRAINT IF EXISTS shop_slug_charset;
ALTER TABLE shop ADD CONSTRAINT shop_slug_charset
  CHECK (slug ~ '^[a-z0-9-]+$');

-- ---------------------------------------------------------------------------
-- 2. base_url must be NULL or a registered provider host (046 §5 A15)
--
--    The list is the four hosts the shipped adapters actually speak to:
--    `api.anthropic.com` (`anthropic.ts:7`), `api.openai.com` (`openaiCompat.ts:8`)
--    and eBay's two (`ebay.ts`). It is duplicated in `src/config.ts`
--    (`REGISTERED_PROVIDER_HOSTS`) and the two are asserted equal by
--    `tests/contract/credential-namespace.test.ts`, so this list cannot drift
--    from the one the resolver enforces without a red build.
--
--    THE GATEWAY IS NOT ON THIS LIST, and that is the point. `LLM_BASE_URL`
--    outranks every per-shop credential (046 §7.3) and is an OPERATOR-set
--    environment pair, never a row — so it is validated at BOOT against the same
--    allowlist plus `LONGBOX_GATEWAY_HOST_ALLOWLIST` (`assertGatewayConfigOrThrow`,
--    046 §11 I5). A row may not name it, because a row is the thing an attacker
--    with a future write surface controls and the environment is not.
--
--    `https` is required in the pattern. A registered host reached over cleartext
--    is a downgrade this column has no reason to represent.
-- ---------------------------------------------------------------------------
ALTER TABLE shop_credentials DROP CONSTRAINT IF EXISTS shop_credentials_base_url_registered;
ALTER TABLE shop_credentials ADD CONSTRAINT shop_credentials_base_url_registered
  CHECK (
    base_url IS NULL
    OR base_url ~ '^https://(api\.anthropic\.com|api\.openai\.com|api\.ebay\.com|api\.sandbox\.ebay\.com)(/[A-Za-z0-9._~/-]*)?$'
  );

COMMIT;

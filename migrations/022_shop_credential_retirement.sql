-- 022_shop_credential_retirement.sql — E03-B05 (bead longbox-e5b.3.5), the code half.
--
-- 050 §2 Q2 and Q3, §4, §5, §10 row 2: **a retirement is a second row, and the
-- receipt is that row.** Docs: 050 §2 Q2/Q3, §4, §5, §9 I2/I7/I10, §10; 041 §8
-- (deletion as an appended fact), §8.7(c) (the receipt is minimal), §8.2 (a
-- receipt may not contain a false statement); 018 (an unverified third-party act
-- is not a fact); 044 §2, §7.
--
-- THE ONE SENTENCE. A version is LIVE when it has an introduction in
-- `shop_credential_version` and NO row here. There is no status column anywhere,
-- and there is deliberately no `un-retire`: a credential that comes back is a new
-- version, because "it was retired and then it was not" is not something that
-- happened.
--
-- `UNIQUE (credential_version_id)` IS `003:149`'s MOVE APPLIED TO A CREDENTIAL.
-- `media_deletion.storage_key` is UNIQUE so a second deletion attempt for one
-- object fails loudly instead of writing a duplicate tombstone. The same holds
-- here: retiring a version twice is either a bug or two people acting on stale
-- information, and both are worth an error rather than a second row that makes
-- "when was this retired" ambiguous.
--
-- `reason_code` IS OPEN-WORLD TEXT WITH NO CHECK ENUM, deliberately and for
-- `003:134-143`'s reason: a reason nobody has thought of must never be blocked by
-- a schema constraint at the moment somebody is retiring a compromised key. The
-- initial registry — extend by adding a row and a line here, never a CHECK
-- (050 §4):
--   rotation             — an ordinary planned replacement
--   compromise_suspected — the value may have been seen by somebody it should not
--   offboarding          — the shop is leaving (050 §5's three-step receipt)
--   provider_change      — the shop moved to a different provider account
--
-- ⚠ `provider_revocation_instructed_at` IS THE ONLY HONEST COLUMN OF ITS KIND,
-- AND ITS NAME IS THE ARGUMENT (050 §2 Q3). It records the moment the shop was
-- TOLD to revoke at the provider — a fact about a Longbox act, which Longbox can
-- check. There is no column asserting that the shop DID revoke, and there never
-- will be: that is a claim about somebody else's system, 018's rung rules forbid
-- recording an unverified third-party act as a fact, and 041 §8.2 spends a
-- section preventing exactly this false statement in a receipt.
--
-- AND THE RESIDUAL, STATED RATHER THAN MITIGATED (050 §5(b), §12). Longbox
-- cannot revoke a BYOK key. Every prior revision of the SOPS file that ever held
-- it still holds it, in git and in every backup, and the key stays valid at the
-- provider until the shop revokes it there. **This design makes a credential
-- unreachable to Longbox and claims exactly that much.**
--
-- SHAPE: EXPAND ONLY. One new table, two indexes, its trigger. No column
-- retyped, nothing dropped, no `-- contract:` header (044 §2).

BEGIN;

CREATE TABLE IF NOT EXISTS shop_credential_retirement (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               uuid NOT NULL REFERENCES shop(id),   -- locked decision 4
  credential_version_id uuid NOT NULL UNIQUE REFERENCES shop_credential_version(id),
  reason_code           text NOT NULL,
  retired_at            timestamptz NOT NULL DEFAULT now(),
  -- NULLABLE, and NULL has ONE meaning (030 A1's rule, as 012 applies it): the
  -- shop has not been instructed yet. It does not also mean "we do not know" or
  -- "instruction tracking was off".
  provider_revocation_instructed_at timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  authored_by           text NOT NULL DEFAULT 'human'
                          CHECK (authored_by IN ('human','system','provider'))
);

COMMENT ON TABLE shop_credential_retirement IS
  'A RETIREMENT of one credential version (050 §2 Q2/Q3, §4). Append-only, one per version. '
  'Its existence is the whole of "not live" — there is no status column. Says WHY, never WHAT: '
  'no key value, no ciphertext, no digest of a value.';

COMMENT ON COLUMN shop_credential_retirement.provider_revocation_instructed_at IS
  'When the shop was TOLD to revoke at the provider — a fact about a Longbox act. There is NO '
  'column asserting the shop revoked: that is a third-party act this system cannot verify, and '
  '018 forbids recording one as a fact (050 §2 Q3).';

CREATE INDEX IF NOT EXISTS shop_credential_retirement_version_idx
  ON shop_credential_retirement (credential_version_id);
CREATE INDEX IF NOT EXISTS shop_credential_retirement_shop_idx
  ON shop_credential_retirement (shop_id, retired_at DESC);

-- ---------------------------------------------------------------------------
-- Append-only, `ENABLE ALWAYS` in the same breath (041 §9.2 item 1, 044 §7).
-- Both of this bead's tables are done here, in one loop, because `021` creates
-- the parent and this file creates the child: a trigger loop split across two
-- files would leave `021` momentarily mutable on any database that applied it
-- and stopped. The declared set is `src/db/appendOnlyTables.ts`, and
-- `tests/integration/migrations.test.ts` asserts this loop and that list agree
-- in BOTH directions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shop_credential_version','shop_credential_retirement'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

COMMIT;

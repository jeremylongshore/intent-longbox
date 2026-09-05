-- 033_origin_designation_time_integrity.sql — E03-D14, the cannon's F1
-- (bead longbox-e5b.3.24)
--
-- **THE ASYMMETRY 058 §3(b) CLAIMED, ENFORCED.** Docs: 000-docs/058 §3(b), §13,
-- §14; the security lens's F1 in 058 §2.1; 034 §2.7; 019 T35(c) (non-waivable);
-- 022 P3; 041 §9.2; 000-docs/044 §2, §7 (expand-only, idempotent by hand).
--
-- ⚠ **NUMBERED 033.** `032` is this bead's own and is on this branch; E03-D11
-- holds `031`; `027` has been a gap since E03-B06 reserved and never wrote it.
-- The runner's ledger keys on FILENAME and applies unseen files in sorted order,
-- so a gap is legal and self-healing and nothing reads contiguity.
--
-- ============================================================================
-- WHAT WAS TRUE AT `635aabe`, AND WHY IT NEEDED ITS OWN FILE
-- ============================================================================
--
-- 058 §3(b) said the retirement *"ends the designation at its own `created_at`,
-- which the writer does not choose"*, and §9 A5 called a writer-chosen ending
-- *"the sharpest rejection in the record"*. **Neither was enforced.**
-- `created_at timestamptz NOT NULL DEFAULT now()` is a DEFAULT: it applies when
-- the writer omits the column and does nothing at all when the writer supplies
-- it. The security lens reproduced the consequence on a live schema — one INSERT
-- naming `created_at` removes a person from 019 T35(c)'s population **for the
-- past** — and found a stronger form the record had not imagined: a retirement
-- dated BEFORE its designation's own `effective_from` makes the predicate false
-- at every instant, erasing the designation for all of history rather than
-- ending it.
--
-- 058's contract test asserted the ABSENCE of the columns `effective_from`,
-- `effective_until` and `retired_at` from the retirement table. That is a test
-- of column NAMES, and the attack needed none of them: it used the column the
-- design put there on purpose. **A test that names what must not exist cannot
-- see a property that fails through what must.** The replacement ATTEMPTS the
-- back-dated INSERT, as the schema owner, and asserts the refusal.
--
-- ============================================================================
-- THREE CHECKS, AND EACH FAILS DIFFERENTLY (034 §3.2's rule)
-- ============================================================================
--
-- **(1) A retirement's `created_at` is FORCED, not defaulted.** A `BEFORE INSERT`
-- trigger overwrites whatever the writer supplied with `now()`. It does not
-- REFUSE a supplied value, deliberately: a refusal would make `INSERT … (origin_id,
-- reason, created_at)` an error for a caller that meant nothing by it, while
-- forcing makes the column unwritable by construction and leaves every honest
-- caller working. There is no `session_replication_role` escape either — the
-- trigger is `ENABLE ALWAYS`, like every append-only trigger in this schema.
--
-- **(2) A designation may not START IN THE FUTURE.** At `635aabe` this lived in
-- TypeScript alone (`src/services/auth/origin.ts`), which is a check the database
-- does not have: a future start hides every session opened between now and then,
-- which is the same retroactive narrowing (1) exists to prevent, arrived at from
-- the other side. It cannot be a CHECK — `now()` is not immutable and Postgres
-- refuses it in a constraint — so it is the same `BEFORE INSERT` trigger shape,
-- and it REFUSES rather than clamps: a caller asking for a future start has a
-- wrong intention, not a sloppy one.
--
-- **(3) A retirement may not PREDATE its designation.** With (1) in force this is
-- implied — `now()` is never before a start that (2) keeps in the past — and it
-- is here anyway, because the failure it guards against is **(1) being dropped by
-- a future migration**, which no default and no application check can notice.
-- That is 054 §6's argument for the third break-glass bound, one table over.
--
-- Nothing here CONTRACTS: no column is dropped, narrowed or made NOT NULL. The
-- triggers are new objects and every statement is idempotent by hand.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (1) The retirement's timestamp is the DATABASE's, not the writer's.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION force_origin_retirement_now()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Unconditional. A comparison ("only overwrite when it differs from now()")
  -- would leave a window the width of the clock's resolution, and there is no
  -- legitimate caller whose value must survive: the fact this row records is
  -- "the designation ended", and when it ended is when this statement ran.
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION force_origin_retirement_now() IS
  'E03-D14 F1: a retirement ends a designation at the database''s now(), never at a time the writer chose.';

-- ---------------------------------------------------------------------------
-- (2) A designation may not start in the future, and (3) a retirement may not
--     predate the designation it ends.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_origin_designation_window()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE started timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'app_user_origin' THEN
    IF NEW.effective_from > now() THEN
      RAISE EXCEPTION
        'app_user_origin.effective_from is in the future (%): a designation that has not begun leaves '
        'every session opened before it outside 019 T35(c) (000-docs/058 §3(b))', NEW.effective_from
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT o.effective_from INTO started FROM app_user_origin o WHERE o.id = NEW.origin_id;
  IF started IS NOT NULL AND NEW.created_at < started THEN
    RAISE EXCEPTION
      'a retirement at % predates its designation (started %): that does not END a designation, it '
      'ERASES it for all of history (000-docs/058 §3(b), the cannon''s F1)', NEW.created_at, started
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION check_origin_designation_window() IS
  'E03-D14 F1: no future start, and no retirement that predates the designation it ends.';

-- ---------------------------------------------------------------------------
-- `ENABLE ALWAYS`, in the same breath, for `041 §9.2 item 1`'s reason: `CREATE
-- TRIGGER` lands at the bypassable 'O' default, and a control that a
-- `session_replication_role` switch turns off is not one.
--
-- ORDER MATTERS ON THE RETIREMENT. Postgres fires `BEFORE` triggers in NAME
-- order, and (3) compares the value (1) forces — so the forcing trigger's name
-- sorts first (`a_…` / `b_…`) and the comparison sees the real timestamp rather
-- than the writer's. Named rather than left to luck, because alphabetical
-- ordering is exactly the kind of dependency that survives review and not a
-- rename.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS a_app_user_origin_retirement_forces_now ON app_user_origin_retirement;
CREATE TRIGGER a_app_user_origin_retirement_forces_now
  BEFORE INSERT ON app_user_origin_retirement
  FOR EACH ROW EXECUTE FUNCTION force_origin_retirement_now();
ALTER TABLE app_user_origin_retirement
  ENABLE ALWAYS TRIGGER a_app_user_origin_retirement_forces_now;

DROP TRIGGER IF EXISTS b_app_user_origin_retirement_not_before_start ON app_user_origin_retirement;
CREATE TRIGGER b_app_user_origin_retirement_not_before_start
  BEFORE INSERT ON app_user_origin_retirement
  FOR EACH ROW EXECUTE FUNCTION check_origin_designation_window();
ALTER TABLE app_user_origin_retirement
  ENABLE ALWAYS TRIGGER b_app_user_origin_retirement_not_before_start;

DROP TRIGGER IF EXISTS a_app_user_origin_not_future ON app_user_origin;
CREATE TRIGGER a_app_user_origin_not_future
  BEFORE INSERT ON app_user_origin
  FOR EACH ROW EXECUTE FUNCTION check_origin_designation_window();
ALTER TABLE app_user_origin ENABLE ALWAYS TRIGGER a_app_user_origin_not_future;

COMMIT;

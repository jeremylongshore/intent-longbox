-- 018 — the photo row binds to the bytes it names (E03-B07)
--
-- EXPAND ONLY: one nullable column. No existing writer changes shape, no value
-- is rewritten, and a deploy running 017 keeps working against this schema
-- (000-docs/044 §2).
--
-- WHY THIS EXISTS. 003 reserved `scan_photo.storage_key` and
-- `scan_photo.content_hash` (003 §1) and nothing ever wrote them. 046 §4 B4's
-- ratification amendment K-1 is the finding, in its own words: "`content_hash`
-- is computed on the stream and used only inside the idempotency request hash;
-- `addScanPhoto` writes `storage_url` and not the digest … a digest that is
-- computed and discarded is not non-repudiation; it is the cost of
-- non-repudiation paid without the benefit." The digest is in the process's
-- hands at the moment the row is written. E03-B07 writes it, along with the
-- storage key the deletion path (E03-B09) and the restore validation (046 I11)
-- both address objects by.
--
-- The column this file ADDS is `byte_size`, and it is here because the quota is
-- not answerable without it. 046 §4 B4 records "no per-tenant quota" beside the
-- 25 MiB per-file limit; a ceiling on stored BYTES has to read a stored byte
-- count, and `stat`-ing every file in a session on every upload is a filesystem
-- walk on a request path. One integer per row, written by the same writer that
-- writes the hash, makes the ceiling a single aggregate query.
--
-- NULLABLE, AND NEVER BACKFILLED, for the reason 003 gives for its own two
-- columns: rows written before this migration do not have the fact, and 022 P3
-- forbids retro-attributing a row with a value nobody measured. A NULL reads as
-- "unknown", and the quota sums `coalesce(byte_size, 0)` — which under-counts
-- legacy rows rather than inventing sizes for them. The CHECK is the honest
-- half: a size, when present, is a size.
--
-- NO `NOT NULL` ON `content_hash` EITHER, and that is deliberate rather than
-- unfinished. 003's `scan_photo_storage_key_hashed` CHECK already states the
-- rule that matters — a row may not name a storage key without naming the hash
-- of its bytes — and it states it for legacy rows too, because it permits the
-- (NULL, NULL) shape and forbids only the (key, NULL) one. Adding NOT NULL to a
-- column with existing NULLs is a contract step against rows this migration has
-- no authority to rewrite.

BEGIN;

ALTER TABLE scan_photo ADD COLUMN IF NOT EXISTS byte_size bigint;

ALTER TABLE scan_photo DROP CONSTRAINT IF EXISTS scan_photo_byte_size_nonnegative;
ALTER TABLE scan_photo ADD CONSTRAINT scan_photo_byte_size_nonnegative
  CHECK (byte_size IS NULL OR byte_size >= 0);

COMMIT;

-- Two additive corrections found by the production-readiness review. Neither
-- drops a table or column, narrows an existing policy, deletes a row, or
-- changes any RLS/grant. Re-runnable end to end, matching the idempotency
-- contract scripts/test_rls.mjs asserts against the newest migration file.
--
--   1. `app_documents.scan_verdict` did not permit 'TRUSTED', the verdict the
--      gateway actually emits for a clean document. Clean uploads therefore
--      failed the CHECK on PostgreSQL while suspicious/malicious ones
--      succeeded -- inverted, and invisible to the SQLite test suite (the
--      SQLAlchemy Core mirror in app/db_platform.py carries no CHECKs).
--
--   2. `app_vitals` had no uniqueness on a device reading, so an Android
--      retry after a network failure created a duplicate reading, a duplicate
--      risk assessment and a duplicate alert.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Allow the gateway's real verdict vocabulary.
--
-- 'TRUSTED' is added; 'CLEAN', 'SUSPICIOUS', 'MALICIOUS' and 'PENDING' are all
-- retained so existing rows (the seed writes 'PENDING') stay valid and no
-- historical value becomes unrepresentable. The application keeps emitting
-- 'TRUSTED' -- see app/gateway.py `analyze` and the frontend's
-- DocumentScan.scan_verdict type; the constraint was the outlier, not the code.
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_documents
    DROP CONSTRAINT IF EXISTS app_documents_scan_verdict_check;
ALTER TABLE public.app_documents
    ADD CONSTRAINT app_documents_scan_verdict_check
    CHECK (scan_verdict IS NULL OR scan_verdict IN
        ('TRUSTED', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS', 'PENDING'));

-- ---------------------------------------------------------------------------
-- 2. One reading per (patient, device, instant).
--
-- SQL treats NULLs as distinct, so this constrains only readings that carry a
-- device_id: rows written by hand by a clinician (device_id IS NULL) are
-- completely unaffected and can still share a timestamp.
--
-- Guarded, because a database that already contains duplicate device readings
-- would otherwise fail this migration outright. Historical data is never
-- deleted or rewritten here; if duplicates already exist the index is skipped
-- with a warning and app-level idempotency (app/api_v1/router.py
-- `_record_vitals`) remains in force. De-duplicating historical rows, if ever
-- wanted, is a deliberate separate decision -- not a silent side effect of a
-- schema migration.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS app_vitals_device_reading_key
            ON public.app_vitals (patient_id, device_id, recorded_at);
    EXCEPTION WHEN unique_violation THEN
        RAISE WARNING 'app_vitals already contains duplicate (patient_id, device_id, recorded_at) rows; skipping app_vitals_device_reading_key. Application-level idempotency still applies. Resolve the duplicates and re-run this migration to gain the database guarantee.';
    END;
END $$;

COMMIT;

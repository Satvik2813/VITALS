-- Permanent VITALIS Bridge Code + Android bridge-device pairing.
--
-- Fully additive: two new tables, no existing table/column/policy is dropped,
-- narrowed or rewritten, and no existing row is touched. Every patient keeps
-- working exactly as before until they first open their Bridge Code.
--
-- Why two new tables rather than columns on app_patients (the "smallest"
-- change): column privileges in PostgreSQL are table-wide, while RLS is
-- row-wide. `authenticated` already holds SELECT on every column of
-- app_patients so that a patient's own doctor can read their record, so a
-- bridge_code column there would be readable by that doctor through the Data
-- API -- i.e. the doctor could pair a device as their patient. Separate
-- tables let the pairing secret carry its own, strictly narrower policy:
-- readable by the patient the record belongs to, and by nobody else.
--
-- Re-runnable end to end (IF NOT EXISTS / DROP POLICY IF EXISTS), matching the
-- idempotency contract scripts/test_rls.mjs asserts against the newest file.
--
-- As everywhere else in this schema, the backend's privileged SQL connection
-- is the only writer; these grants/policies are defense-in-depth for the
-- Data API. See docs/BRIDGE.md for the HTTP contract.
BEGIN;

-- ---------------------------------------------------------------------------
-- One permanent code per patient. `code` is stored in readable form because
-- the patient must be able to display and re-read it indefinitely (it is a
-- pairing code shown in their own dashboard, like a router's WiFi key, not a
-- password digest). `code_hash` is the lookup key used by POST /bridge/pair
-- so the submitted plaintext never appears in a query predicate or in
-- statement logs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_patient_bridge_codes (
    patient_id UUID PRIMARY KEY REFERENCES public.app_patients (id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    code_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at TIMESTAMPTZ,
    -- Crockford-style base32 minus I/L/O/U: unambiguous when read aloud or
    -- typed on a phone keyboard. 32^8 = 2^40 codes for the 8-character body.
    CONSTRAINT app_patient_bridge_codes_format
        CHECK (code ~ '^VTL-[0-9A-HJKMNP-TVWXYZ]{4}-[0-9A-HJKMNP-TVWXYZ]{4}$')
);

-- ---------------------------------------------------------------------------
-- Devices paired to a patient via that code. The bearer credential handed to
-- the Android app is stored only as a SHA-256 digest; the plaintext exists
-- exactly once, in the pairing response.
--
-- UNIQUE (patient_id, device_id) makes re-pairing the same handset rotate its
-- credential in place instead of accumulating rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_bridge_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.app_patients (id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_name TEXT,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    UNIQUE (patient_id, device_id)
);

CREATE INDEX IF NOT EXISTS app_bridge_devices_patient ON public.app_bridge_devices (patient_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row Level Security: deny by default, then the patient -- and only the
-- patient -- may read their own pairing state. No INSERT/UPDATE/DELETE
-- policy or grant for `authenticated`: pairing, rotation and revocation all
-- go through the backend API, like vitals/risk/document provenance already
-- does.
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_patient_bridge_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_bridge_devices ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.app_patient_bridge_codes, public.app_bridge_devices
    FROM PUBLIC, anon, authenticated;

-- Column-scoped SELECT: the digests are never readable through the Data API
-- even by the row's owner.
GRANT SELECT (patient_id, code, created_at, rotated_at)
    ON public.app_patient_bridge_codes TO authenticated;
GRANT SELECT (id, patient_id, device_id, device_name, created_at, last_seen_at, revoked_at)
    ON public.app_bridge_devices TO authenticated;

DROP POLICY IF EXISTS app_bridge_codes_self_read ON public.app_patient_bridge_codes;
CREATE POLICY app_bridge_codes_self_read ON public.app_patient_bridge_codes
    FOR SELECT TO authenticated
    USING (public.app_is_own_patient(patient_id));

DROP POLICY IF EXISTS app_bridge_devices_self_read ON public.app_bridge_devices;
CREATE POLICY app_bridge_devices_self_read ON public.app_bridge_devices
    FOR SELECT TO authenticated
    USING (public.app_is_own_patient(patient_id));

-- Match the existing restrictive guard: Supabase anonymous sign-ins also
-- carry the `authenticated` database role (see 20260909110804).
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['app_patient_bridge_codes','app_bridge_devices']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS app_require_permanent_user ON public.%I', t);
        EXECUTE format('CREATE POLICY app_require_permanent_user ON public.%I AS RESTRICTIVE
            FOR ALL TO authenticated USING
            ((SELECT auth.uid()) IS NOT NULL AND
             (SELECT auth.jwt()->>''is_anonymous'') IS DISTINCT FROM ''true'')
            WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND
             (SELECT auth.jwt()->>''is_anonymous'') IS DISTINCT FROM ''true'')', t);
    END LOOP;
END $$;

COMMIT;

-- Enable Supabase Realtime (Postgres Changes) for the tables the doctor
-- dashboard and patient-detail views need to update live: vitals, alerts,
-- and risk-state changes. No new grants are required beyond publication
-- membership -- Postgres Changes re-checks the existing RLS SELECT policies
-- per subscriber, so a doctor/patient only ever receives change events for
-- rows they could already SELECT (see 20260909062424_auth_platform.sql and
-- 20260909131446_patient_doctor_roles.sql for those policies).
--
-- Written as a guarded DO block (not a bare ALTER PUBLICATION) so this is
-- safe to re-run: ALTER PUBLICATION ... ADD TABLE errors if the table is
-- already a publication member. Also guarded on the publication itself
-- existing at all: every real Supabase project provisions `supabase_realtime`
-- automatically, but a bare local/test Postgres (e.g. this repo's
-- scripts/test_rls.mjs, run against disposable PGlite) does not -- skip
-- rather than error in that case.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'app_vitals'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.app_vitals;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'app_alerts'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.app_alerts;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'app_risk_assessments'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.app_risk_assessments;
    END IF;
END $$;

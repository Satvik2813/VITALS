-- Generated with Supabase CLI, ordered after the existing 12:00 recursion fix.
-- APPLIED to the hosted project 2026-09-09 (recorded as version 20260909110804).
-- No new tables. Backend SQL writes remain authoritative and preserve /api/v1 contracts.
BEGIN;

-- RLS does not govern TRUNCATE. Remove inherited default grants explicitly.
REVOKE ALL ON public.app_profiles, public.app_patients, public.app_doctor_patients,
    public.app_vitals, public.app_alerts, public.app_risk_assessments,
    public.app_documents, public.app_audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.app_profiles, public.app_patients, public.app_doctor_patients,
    public.app_vitals, public.app_alerts, public.app_risk_assessments,
    public.app_documents, public.app_audit_events TO authenticated;
-- Users may edit display fields, never self-promote to admin or change identity.
GRANT UPDATE (full_name, avatar_url) ON public.app_profiles TO authenticated;
GRANT INSERT, DELETE ON public.app_patients TO authenticated;
GRANT UPDATE (mrn, full_name, date_of_birth, sex, notes, updated_at)
    ON public.app_patients TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.app_doctor_patients TO authenticated;
-- Vitals/risk/scan/audit provenance and alert acknowledgement go through the API.
-- Existing service-role/SQL backend privileges are unaffected.

CREATE SCHEMA IF NOT EXISTS vitalis_private;
REVOKE ALL ON SCHEMA vitalis_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA vitalis_private TO authenticated;

-- A narrowly scoped boolean definer breaks recursive patient/assignment RLS.
-- Keep it outside PostgREST's exposed public schema; never accept a caller user ID.
CREATE OR REPLACE FUNCTION vitalis_private.has_patient_access(target UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT auth.uid() IS NOT NULL AND (
        EXISTS (SELECT 1 FROM public.app_patients p
                WHERE p.id = target AND p.owner_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.app_doctor_patients dp
                   WHERE dp.patient_id = target AND dp.doctor_id = auth.uid())
    );
$$;
REVOKE ALL ON FUNCTION vitalis_private.has_patient_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION vitalis_private.has_patient_access(uuid) TO authenticated;

-- Preserve the existing helper contract and dependent policies.
CREATE OR REPLACE FUNCTION public.app_has_patient_access(target UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT vitalis_private.has_patient_access(target); $$;
REVOKE ALL ON FUNCTION public.app_has_patient_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_has_patient_access(uuid) TO authenticated;

-- Supabase anonymous sign-ins also carry the authenticated database role.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['app_profiles','app_patients','app_doctor_patients',
        'app_vitals','app_alerts','app_risk_assessments','app_documents','app_audit_events']
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS app_require_permanent_user ON public.%I', t);
        EXECUTE format('CREATE POLICY app_require_permanent_user ON public.%I AS RESTRICTIVE
            FOR ALL TO authenticated USING
            ((SELECT auth.uid()) IS NOT NULL AND
             (SELECT auth.jwt()->>''is_anonymous'') IS DISTINCT FROM ''true'')
            WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND
             (SELECT auth.jwt()->>''is_anonymous'') IS DISTINCT FROM ''true'')', t);
    END LOOP;
    -- Supabase-provided event trigger, when present, has no public RPC use.
    IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
    END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.app_handle_new_user() FROM PUBLIC, anon, authenticated;

-- Sharing and role administration can occur directly through SQL/the Data API.
-- Audit them in the same transaction: failure rolls the sensitive change back.
CREATE OR REPLACE FUNCTION vitalis_private.audit_access_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    actor uuid;
    patient uuid;
    target uuid;
    event_name text;
    metadata jsonb;
BEGIN
    SELECT id INTO actor FROM public.app_profiles WHERE id = auth.uid();
    IF TG_TABLE_NAME = 'app_profiles' THEN
        IF OLD.role IS NOT DISTINCT FROM NEW.role THEN RETURN NULL; END IF;
        event_name := 'USER_ROLE_CHANGED';
        metadata := jsonb_build_object('resource_id', NEW.id, 'old_role', OLD.role, 'new_role', NEW.role);
    ELSE
        IF TG_OP = 'DELETE' THEN
            target := OLD.patient_id;
            metadata := jsonb_build_object('doctor_id', OLD.doctor_id);
        ELSE
            target := NEW.patient_id;
            metadata := jsonb_build_object('doctor_id', NEW.doctor_id);
            IF TG_OP = 'UPDATE' THEN
                metadata := metadata || jsonb_build_object('previous_doctor_id', OLD.doctor_id,
                                                          'previous_patient_id', OLD.patient_id);
            END IF;
        END IF;
        SELECT id INTO patient FROM public.app_patients WHERE id = target;
        event_name := CASE TG_OP WHEN 'INSERT' THEN 'PATIENT_ACCESS_GRANTED'
            WHEN 'UPDATE' THEN 'PATIENT_ACCESS_CHANGED' ELSE 'PATIENT_ACCESS_REVOKED' END;
        metadata := metadata || jsonb_build_object('resource_id', target);
    END IF;
    INSERT INTO public.app_audit_events(actor_id, patient_id, event_type, details)
    VALUES (actor, patient, event_name, metadata || jsonb_build_object('outcome','success','source','database'));
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION vitalis_private.audit_access_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS app_audit_access_change ON public.app_doctor_patients;
CREATE TRIGGER app_audit_access_change AFTER INSERT OR UPDATE OR DELETE ON public.app_doctor_patients
    FOR EACH ROW EXECUTE FUNCTION vitalis_private.audit_access_change();
DROP TRIGGER IF EXISTS app_audit_role_change ON public.app_profiles;
CREATE TRIGGER app_audit_role_change AFTER UPDATE OF role ON public.app_profiles
    FOR EACH ROW EXECUTE FUNCTION vitalis_private.audit_access_change();
COMMIT;

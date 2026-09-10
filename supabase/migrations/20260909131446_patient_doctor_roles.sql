-- Patient and Doctor become separate authenticated roles with their own
-- onboarding, instead of the patient UI being a "view mode" of a doctor
-- session. Fully additive: no table is dropped, no existing column is
-- narrowed or removed, no existing row is deleted. Backend SQL writes
-- (service-role-equivalent connection) remain the authoritative mutation
-- path; these RLS changes are defense-in-depth for the Data API, matching
-- the existing architecture.
BEGIN;

-- ---------------------------------------------------------------------------
-- app_profiles: allow role='patient', make role nullable until onboarding
-- assigns one, add doctor-facing profile fields, and track onboarding state.
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_profiles ALTER COLUMN role DROP NOT NULL;
ALTER TABLE public.app_profiles ALTER COLUMN role DROP DEFAULT;
ALTER TABLE public.app_profiles DROP CONSTRAINT IF EXISTS app_profiles_role_check;
ALTER TABLE public.app_profiles
    ADD CONSTRAINT app_profiles_role_check CHECK (role IS NULL OR role IN ('doctor', 'patient', 'admin'));

ALTER TABLE public.app_profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.app_profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.app_profiles ADD COLUMN IF NOT EXISTS specialization TEXT;
ALTER TABLE public.app_profiles ADD COLUMN IF NOT EXISTS hospital TEXT;
ALTER TABLE public.app_profiles ADD COLUMN IF NOT EXISTS medical_registration TEXT;

-- Existing profiles (the real hosted doctor included) already have a role:
-- treat them as already onboarded so this migration never forces anyone
-- already using the product back into an onboarding flow.
UPDATE public.app_profiles SET onboarding_completed = true WHERE role IS NOT NULL;

GRANT UPDATE (phone) ON public.app_profiles TO authenticated;
-- specialization/hospital/medical_registration/role/onboarding_completed are
-- written only by the backend's onboarding endpoints (privileged connection),
-- matching how the rest of the platform already handles sensitive writes.

-- ---------------------------------------------------------------------------
-- app_patients: link a patient's own login to their clinical record, and add
-- the minimal onboarding fields a patient fills in themselves. `owner_id`
-- keeps its existing meaning (the assigned/managing doctor) -- a
-- self-registering patient's row is created with owner_id = the doctor they
-- chose, so all existing doctor-side RLS/ownership logic applies unchanged.
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_patients ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.app_profiles (id);
ALTER TABLE public.app_patients ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.app_patients ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE public.app_patients ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
ALTER TABLE public.app_patients ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'app_patients_user_id_key'
    ) THEN
        ALTER TABLE public.app_patients ADD CONSTRAINT app_patients_user_id_key UNIQUE (user_id);
    END IF;
END $$;

-- A patient may read their own clinical record in addition to the existing
-- owner/assigned-doctor read path.
DROP POLICY IF EXISTS app_patients_read ON public.app_patients;
CREATE POLICY app_patients_read ON public.app_patients
    FOR SELECT TO authenticated
    USING (public.app_has_patient_access(id) OR user_id = auth.uid());

-- A patient may update only their own safe contact fields on their own row.
-- Identity/clinical fields (full_name, mrn, dob, sex, notes, owner_id) remain
-- doctor-controlled via the existing app_patients_owner_write policy.
DROP POLICY IF EXISTS app_patients_self_update ON public.app_patients;
CREATE POLICY app_patients_self_update ON public.app_patients
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

GRANT UPDATE (phone, emergency_contact_name, emergency_contact_phone, updated_at)
    ON public.app_patients TO authenticated;

-- Column grants are table-wide, not policy-scoped: `full_name`/`mrn`/etc. are
-- already granted to `authenticated` for the doctor-owner UPDATE path, and
-- app_patients_self_update above (correctly) lets a patient's own row match
-- for UPDATE too. Without this, a patient going directly at the Data API
-- (bypassing the backend's own field check) could pass the grant+RLS-row
-- check and edit their own clinical/identity fields. Enforce the actual
-- column boundary with a trigger keyed on the real actor/row relationship,
-- which grants and row policies alone cannot express. Backend writes are
-- unaffected: the service connection has no auth.uid(), so this never fires.
CREATE OR REPLACE FUNCTION vitalis_private.enforce_patient_self_update_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NEW.user_id = auth.uid() AND OLD.owner_id IS DISTINCT FROM auth.uid() THEN
        IF NEW.full_name IS DISTINCT FROM OLD.full_name
            OR NEW.mrn IS DISTINCT FROM OLD.mrn
            OR NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
            OR NEW.sex IS DISTINCT FROM OLD.sex
            OR NEW.notes IS DISTINCT FROM OLD.notes
            OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
            OR NEW.user_id IS DISTINCT FROM OLD.user_id
        THEN
            RAISE EXCEPTION 'Patients may only update their own contact fields' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION vitalis_private.enforce_patient_self_update_scope() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS app_patients_self_update_scope ON public.app_patients;
CREATE TRIGGER app_patients_self_update_scope BEFORE UPDATE ON public.app_patients
    FOR EACH ROW EXECUTE FUNCTION vitalis_private.enforce_patient_self_update_scope();

-- ---------------------------------------------------------------------------
-- Patient self-access to their own vitals/alerts/risk/documents. Read-only:
-- ingestion continues through the backend API (the same path the upcoming
-- wearable pipeline will use), so this does not grant direct-write access.
-- Kept as a separate helper/policy rather than widening the existing
-- app_has_patient_access-based FOR ALL policies, which are for doctors.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vitalis_private.is_own_patient(target UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.app_patients p WHERE p.id = target AND p.user_id = auth.uid()
    );
$$;
REVOKE ALL ON FUNCTION vitalis_private.is_own_patient(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION vitalis_private.is_own_patient(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.app_is_own_patient(target UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT vitalis_private.is_own_patient(target); $$;
REVOKE ALL ON FUNCTION public.app_is_own_patient(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_is_own_patient(uuid) TO authenticated;

DROP POLICY IF EXISTS app_vitals_patient_read ON public.app_vitals;
CREATE POLICY app_vitals_patient_read ON public.app_vitals
    FOR SELECT TO authenticated USING (public.app_is_own_patient(patient_id));

DROP POLICY IF EXISTS app_alerts_patient_read ON public.app_alerts;
CREATE POLICY app_alerts_patient_read ON public.app_alerts
    FOR SELECT TO authenticated USING (public.app_is_own_patient(patient_id));

DROP POLICY IF EXISTS app_risk_patient_read ON public.app_risk_assessments;
CREATE POLICY app_risk_patient_read ON public.app_risk_assessments
    FOR SELECT TO authenticated USING (public.app_is_own_patient(patient_id));

DROP POLICY IF EXISTS app_documents_patient_read ON public.app_documents;
CREATE POLICY app_documents_patient_read ON public.app_documents
    FOR SELECT TO authenticated USING (public.app_is_own_patient(patient_id));

COMMIT;

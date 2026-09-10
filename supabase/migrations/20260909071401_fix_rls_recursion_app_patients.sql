-- Fix 42P17: infinite recursion between app_patients_read and
-- app_doctor_patients_read RLS policies.
--
-- app_patients_read inlined EXISTS(app_doctor_patients ...). Reading
-- app_doctor_patients triggers app_doctor_patients_read, which inlines
-- EXISTS(app_patients ...), which re-triggers app_patients_read → recursion.
--
-- Fix: route the sharing check through a SECURITY DEFINER helper that
-- bypasses RLS on the two tables it inspects. Inputs are already id-bound;
-- the function only returns a boolean and is EXECUTE-restricted to
-- authenticated.

BEGIN;

CREATE OR REPLACE FUNCTION public.app_has_patient_access(target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.app_patients p
        WHERE p.id = target AND p.owner_id = auth.uid()
    ) OR EXISTS (
        SELECT 1 FROM public.app_doctor_patients dp
        WHERE dp.patient_id = target AND dp.doctor_id = auth.uid()
    );
$$;

REVOKE EXECUTE ON FUNCTION public.app_has_patient_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_has_patient_access(uuid) TO authenticated;

DROP POLICY IF EXISTS app_patients_read ON public.app_patients;
CREATE POLICY app_patients_read ON public.app_patients
    FOR SELECT TO authenticated
    USING (public.app_has_patient_access(id));

COMMIT;

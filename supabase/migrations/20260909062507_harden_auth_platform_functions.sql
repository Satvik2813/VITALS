-- Harden SECURITY DEFINER helper: it only exists to power the auth.users
-- trigger, so no PostgREST caller should be able to invoke it via
-- /rest/v1/rpc/app_handle_new_user. Revoke EXECUTE from every REST role.
--
-- app_has_patient_access is SECURITY INVOKER; it is called from RLS policies
-- so authenticated must retain EXECUTE.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.app_handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_has_patient_access(uuid) TO authenticated;

COMMIT;

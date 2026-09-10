import { redirect } from 'next/navigation';
import { getUser } from '../../../lib/supabase/server';
import { getMe } from '../../../lib/server-me';
import { PatientShell } from '../../../components/vitalis/patient-shell';

export const dynamic = 'force-dynamic';

export default async function PatientLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  const me = await getMe();

  // Enforced server-side: a doctor cannot use the patient route tree as a
  // "preview mode" -- it is a separate, role-gated experience. Every branch
  // is a POSITIVE match on the server-verified role so a null/unknown role
  // (e.g. transient backend hiccup) NEVER silently lets someone into a
  // portal they are not authorized for. Unknown states fall back to the
  // neutral role picker at /get-started rather than defaulting to a role.
  if (!me) {
    redirect('/get-started');
  }
  if (!me.onboarding_completed) {
    if (me.role === 'patient') redirect('/onboarding/patient');
    if (me.role === 'doctor') redirect('/onboarding/doctor');
    redirect('/get-started');
  }
  if (me.role === 'doctor' || me.role === 'admin') {
    redirect('/app/doctor');
  }
  if (me.role !== 'patient') {
    redirect('/get-started');
  }

  const name =
    me.full_name ||
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    (user?.email ? user.email.split('@')[0] : 'there');
  return <PatientShell name={name}>{children}</PatientShell>;
}

import { redirect } from 'next/navigation';
import { getUser } from '../../../lib/supabase/server';
import { getMe } from '../../../lib/server-me';
import { DoctorShell } from '../../../components/vitalis/doctor-shell';

export const dynamic = 'force-dynamic';

export default async function DoctorLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  const me = await getMe();

  // Enforced server-side: a patient (or anyone who hasn't finished doctor
  // onboarding) cannot reach the doctor route tree by direct URL. Every
  // branch is a POSITIVE match on the server-verified role so a null/unknown
  // role (e.g. transient backend hiccup) NEVER silently funnels a Patient
  // into the Doctor portal or doctor-onboarding flow. Unknown states fall
  // back to the neutral role picker rather than defaulting to "doctor".
  if (!me) {
    redirect('/get-started');
  }
  if (!me.onboarding_completed) {
    if (me.role === 'doctor') redirect('/onboarding/doctor');
    if (me.role === 'patient') redirect('/onboarding/patient');
    redirect('/get-started');
  }
  if (me.role === 'patient') {
    redirect('/app/patient');
  }
  if (me.role !== 'doctor' && me.role !== 'admin') {
    redirect('/get-started');
  }

  const name =
    me.full_name ||
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    (user?.email ? user.email.split('@')[0] : 'Clinician');
  return (
    <DoctorShell user={{ name, email: user?.email || me.email }}>{children}</DoctorShell>
  );
}

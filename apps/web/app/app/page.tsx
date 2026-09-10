import { redirect } from 'next/navigation';
import { getMe } from '../../lib/server-me';

export const dynamic = 'force-dynamic';

// /app is a router shim: send the caller to their actual role's dashboard,
// or to onboarding if they haven't picked/finished one yet. Every branch
// requires a POSITIVE role match -- a null/unknown role from a transient
// backend hiccup must never silently route a Patient into the Doctor portal
// (or vice-versa). Anything unrecognized falls back to the neutral role
// picker at /get-started.
export default async function AppEntry() {
  const me = await getMe();
  if (me?.onboarding_completed) {
    if (me.role === 'patient') redirect('/app/patient');
    if (me.role === 'doctor' || me.role === 'admin') redirect('/app/doctor');
  }
  redirect('/get-started');
}

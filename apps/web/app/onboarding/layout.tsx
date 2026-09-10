import { redirect } from 'next/navigation';
import { getUser } from '../../lib/supabase/server';
import { supabaseConfigured } from '../../lib/supabase/env';

export const dynamic = 'force-dynamic';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured()) redirect('/login');
  const user = await getUser();
  if (!user) redirect('/login');
  return <>{children}</>;
}

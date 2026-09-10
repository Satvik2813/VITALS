'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, ShieldCheck, HeartPulse, LockKeyhole } from 'lucide-react';
import { createClient } from '../../lib/supabase/client';
import { VitalisLogo } from '../../components/vitalis/brand';
import { ThemeToggle } from '../../components/vitalis/theme-toggle';

const CALLBACK_ERRORS: Record<string, string> = {
  oauth_failed: 'Google sign-in failed. Please try again.',
  missing_code: 'Sign-in link was incomplete or expired. Please try again.',
  signout_failed: 'Sign-out did not fully complete, but your local session was cleared.',
};

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    if (code) setError(CALLBACK_ERRORS[code] || 'Sign-in failed. Please try again.');
  }, []);

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const params = new URLSearchParams(window.location.search);
      // `next` (an explicit deep link, e.g. from a redirected protected
      // route) wins if present. Otherwise a role chosen on /get-started picks
      // which onboarding flow to land on. The callback route independently
      // re-validates the caller's actual profile state before honoring
      // either -- this is a UX hint, not an authorization decision.
      const role = params.get('role');
      const next =
        params.get('next') ||
        (role === 'patient' ? '/onboarding/patient' : role === 'doctor' ? '/onboarding/doctor' : '/app');
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, queryParams: { access_type: 'offline', prompt: 'consent' } },
      });
      if (error) throw error;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--v-bg)',
        color: 'var(--v-text)',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
      }}
      className="v-login-grid"
    >
      <section
        style={{
          padding: 48,
          background: 'var(--v-brand-gradient)',
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(600px 300px at 20% 10%, rgba(255,255,255,0.18), transparent 60%), radial-gradient(500px 300px at 80% 90%, rgba(0,0,0,0.18), transparent 60%)',
          }}
        />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
          <VitalisLogo size="md" />
          <span style={{ fontWeight: 700, letterSpacing: '-0.02em', fontSize: 20 }}>VITALIS</span>
        </div>
        <div style={{ position: 'relative', marginTop: 'auto', maxWidth: 460 }}>
          <p
            style={{
              fontSize: 12,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              opacity: 0.85,
            }}
          >
            Clinical AI · Zero-Trust
          </p>
          <h1
            style={{
              fontSize: 40,
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
              fontWeight: 640,
              marginTop: 12,
            }}
          >
            Sign in to your clinical command center.
          </h1>
          <p style={{ marginTop: 14, fontSize: 16, opacity: 0.9, lineHeight: 1.55 }}>
            Real-time monitoring, AI risk detection, and a zero-trust document gateway that keeps
            clinical AI safe.
          </p>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              marginTop: 26,
              display: 'grid',
              gap: 10,
              fontSize: 14,
            }}
          >
            <li style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <HeartPulse size={16} /> Continuous vitals, streaming alerts
            </li>
            <li style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <ShieldCheck size={16} /> Prompt-injection detection on every document
            </li>
            <li style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <LockKeyhole size={16} /> RLS-enforced access, immutable audit trail
            </li>
          </ul>
        </div>
      </section>

      <section
        style={{
          padding: 40,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <ThemeToggle compact />
          <Link href="/" className="v-btn v-btn-ghost" style={{ fontSize: 13 }}>
            ← Back to landing
          </Link>
        </div>
        <div style={{ maxWidth: 420, width: '100%', margin: '0 auto' }}>
          <span className="v-eyebrow">Welcome</span>
          <h2 className="v-h2" style={{ marginTop: 8 }}>
            Continue with Google
          </h2>
          <p className="v-muted" style={{ marginTop: 8, fontSize: 15 }}>
            We only use Google to verify your identity — no passwords, no email lists.
          </p>

          <button
            onClick={signInWithGoogle}
            disabled={busy}
            className="v-btn v-btn-secondary"
            style={{
              width: '100%',
              marginTop: 28,
              padding: '14px 16px',
              fontSize: 15,
              justifyContent: 'center',
              minHeight: 52,
              background: 'var(--v-surface)',
              border: '1px solid var(--v-border)',
            }}
          >
            {busy ? (
              <>
                <Loader2 className="v-spin" size={18} /> Redirecting…
              </>
            ) : (
              <>
                <GoogleIcon /> Continue with Google
              </>
            )}
          </button>

          {error && (
            <div
              role="alert"
              className="v-badge critical"
              style={{
                display: 'flex',
                marginTop: 16,
                padding: '10px 14px',
                fontSize: 13,
                width: '100%',
                borderRadius: 10,
              }}
            >
              {error}
            </div>
          )}

          <p style={{ marginTop: 28, fontSize: 12, color: 'var(--v-text-soft)', lineHeight: 1.6 }}>
            By continuing you acknowledge that VITALIS is clinical decision support only; clinician
            judgment remains final.
          </p>
        </div>
      </section>
      <style jsx>{`
        @media (max-width: 900px) {
          main {
            grid-template-columns: 1fr !important;
          }
          main > section:first-child {
            display: none;
          }
        }
        .v-spin {
          animation: v-spin 0.9s linear infinite;
        }
        @keyframes v-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Stethoscope } from 'lucide-react';
import { api, ApiError } from '../../../lib/api-v1';
import { VitalisBrand } from '../../../components/vitalis/brand';
import { ThemeToggle } from '../../../components/vitalis/theme-toggle';

export default function DoctorOnboardingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [hospital, setHospital] = useState('');
  const [medicalRegistration, setMedicalRegistration] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.me();
        if (!alive) return;
        if (me.role && me.onboarding_completed) {
          // Positive role match only -- never default to "doctor" for a
          // null/unknown role, which would silently cross-route the user.
          if (me.role === 'patient') router.replace('/app/patient');
          else if (me.role === 'doctor' || me.role === 'admin') router.replace('/app/doctor');
          else router.replace('/get-started');
          return;
        }
        setFullName(me.full_name || '');
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : 'Could not load onboarding.');
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!fullName.trim()) return setError('Please enter your full name.');
    setSubmitting(true);
    try {
      await api.onboarding.doctor({
        full_name: fullName.trim(),
        phone: phone || null,
        specialization: specialization || null,
        hospital: hospital || null,
        medical_registration: medicalRegistration || null,
      });
      router.replace('/app/doctor');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete onboarding.');
      setSubmitting(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--v-bg)', color: 'var(--v-text)' }}>
      <header
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px' }}
      >
        <VitalisBrand size="md" />
        <ThemeToggle compact />
      </header>

      <div className="v-container" style={{ maxWidth: 640, padding: '16px 24px 64px' }}>
        <span className="v-eyebrow">Doctor setup</span>
        <h1 className="v-h2" style={{ marginTop: 8 }}>
          Set up your clinical workspace
        </h1>
        <p className="v-muted" style={{ marginTop: 8, fontSize: 15 }}>
          Patients will see this information when they choose you as their doctor.
        </p>

        {!ready ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 40, color: 'var(--v-text-muted)' }}>
            <Loader2 size={18} className="v-onboard-spin" /> Loading…
          </div>
        ) : (
          <form onSubmit={submit} className="v-card-lg" style={{ padding: 24, marginTop: 24, display: 'grid', gap: 16 }}>
            {error && (
              <div role="alert" className="v-badge critical" style={{ padding: '10px 14px', borderRadius: 10 }}>
                {error}
              </div>
            )}

            <Field label="Full name" required>
              <input className="v-input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </Field>

            <Field label="Phone number">
              <input className="v-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 010 0000" />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Specialization">
                <input className="v-input" value={specialization} onChange={(e) => setSpecialization(e.target.value)} placeholder="Cardiology" />
              </Field>
              <Field label="Hospital / Clinic">
                <input className="v-input" value={hospital} onChange={(e) => setHospital(e.target.value)} placeholder="Synthetic General" />
              </Field>
            </div>

            <Field label="Medical registration ID" hint="Optional for this prototype.">
              <input
                className="v-input"
                value={medicalRegistration}
                onChange={(e) => setMedicalRegistration(e.target.value)}
              />
            </Field>

            <button
              type="submit"
              disabled={submitting}
              className="v-btn v-btn-primary"
              style={{ justifyContent: 'center', minHeight: 48, marginTop: 4 }}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="v-onboard-spin" /> Setting up your workspace…
                </>
              ) : (
                <>
                  <Stethoscope size={16} /> Finish setup
                </>
              )}
            </button>
          </form>
        )}

        <p style={{ marginTop: 20, fontSize: 12, color: 'var(--v-text-soft)', textAlign: 'center' }}>
          Onboarding as a patient instead? <Link href="/onboarding/patient">Switch here</Link>.
        </p>
      </div>
      <style jsx>{`
        .v-onboard-spin {
          animation: v-onboard-spin 0.9s linear infinite;
        }
        @keyframes v-onboard-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </main>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
      <span style={{ color: 'var(--v-text-muted)', fontWeight: 550 }}>
        {label}
        {required && <span style={{ color: 'var(--v-critical)' }}> *</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--v-text-soft)' }}>{hint}</span>}
    </label>
  );
}

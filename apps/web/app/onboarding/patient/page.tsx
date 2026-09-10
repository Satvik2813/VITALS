'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { HeartPulse, Loader2 } from 'lucide-react';
import { api, ApiError, type DoctorSummary } from '../../../lib/api-v1';
import { VitalisBrand } from '../../../components/vitalis/brand';
import { ThemeToggle } from '../../../components/vitalis/theme-toggle';

export default function PatientOnboardingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [doctors, setDoctors] = useState<DoctorSummary[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [sex, setSex] = useState('');
  const [phone, setPhone] = useState('');
  const [emName, setEmName] = useState('');
  const [emPhone, setEmPhone] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [consent, setConsent] = useState(false);

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
        const list = await api.doctors.list();
        if (!alive) return;
        setDoctors(list);
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
    if (!doctorId) return setError('Please select your doctor.');
    if (!consent) return setError('Please accept the consent statement to continue.');
    setSubmitting(true);
    try {
      await api.onboarding.patient({
        full_name: fullName.trim(),
        date_of_birth: dob || null,
        sex: sex || null,
        phone: phone || null,
        emergency_contact_name: emName || null,
        emergency_contact_phone: emPhone || null,
        assigned_doctor_id: doctorId,
        consent_accepted: consent,
      });
      router.replace('/app/patient');
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
        <span className="v-eyebrow">Patient setup</span>
        <h1 className="v-h2" style={{ marginTop: 8 }}>
          Tell us a little about you
        </h1>
        <p className="v-muted" style={{ marginTop: 8, fontSize: 15 }}>
          This helps your doctor understand your care needs. You can update most of this later.
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Date of birth">
                <input type="date" className="v-input" value={dob} onChange={(e) => setDob(e.target.value)} />
              </Field>
              <Field label="Sex">
                <select className="v-input" value={sex} onChange={(e) => setSex(e.target.value)}>
                  <option value="">Prefer not to say</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                  <option value="unknown">Unknown</option>
                </select>
              </Field>
            </div>

            <Field label="Phone number">
              <input className="v-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 010 0000" />
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Emergency contact name">
                <input className="v-input" value={emName} onChange={(e) => setEmName(e.target.value)} />
              </Field>
              <Field label="Emergency contact phone">
                <input className="v-input" type="tel" value={emPhone} onChange={(e) => setEmPhone(e.target.value)} />
              </Field>
            </div>

            <Field label="Assigned doctor" required hint={doctors.length === 0 ? 'No doctors are available to select yet.' : undefined}>
              <select className="v-input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} required>
                <option value="">Select a doctor…</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name || 'Doctor'}
                    {d.specialization ? ` · ${d.specialization}` : ''}
                    {d.hospital ? ` · ${d.hospital}` : ''}
                  </option>
                ))}
              </select>
            </Field>

            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                style={{ marginTop: 3, width: 16, height: 16 }}
              />
              <span className="v-muted">
                I consent to VITALIS sharing my vitals, alerts, and profile with my assigned doctor for
                the purpose of my care. This is a synthetic/demo product; do not enter real medical data.
              </span>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="v-btn v-btn-primary"
              style={{ justifyContent: 'center', minHeight: 48, marginTop: 4 }}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="v-onboard-spin" /> Setting up your account…
                </>
              ) : (
                <>
                  <HeartPulse size={16} /> Finish setup
                </>
              )}
            </button>
          </form>
        )}

        <p style={{ marginTop: 20, fontSize: 12, color: 'var(--v-text-soft)', textAlign: 'center' }}>
          Onboarding as a doctor instead? <Link href="/onboarding/doctor">Switch here</Link>.
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

'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, LogOut, Save, Stethoscope } from 'lucide-react';
import { api, ApiError, type Me, type Patient } from '../../../../lib/api-v1';
import { ErrorBanner, Loading } from '../../../../components/vitalis/ui';
import { ThemeToggle } from '../../../../components/vitalis/theme-toggle';
import { BridgeCodeCard } from '../../../../components/vitalis/bridge-code';

export default function PatientProfile() {
  const [me, setMe] = useState<Me | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState('');
  const [emName, setEmName] = useState('');
  const [emPhone, setEmPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [meResp, list] = await Promise.all([api.me(), api.patients.list()]);
        if (!alive) return;
        setMe(meResp);
        const p = list[0] || null;
        setPatient(p);
        if (p) {
          setPhone(p.phone || '');
          setEmName(p.emergency_contact_name || '');
          setEmPhone(p.emergency_contact_phone || '');
        }
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : (e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function saveContact() {
    if (!patient) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await api.patients.update(patient.id, {
        phone: phone || undefined,
        emergency_contact_name: emName || undefined,
        emergency_contact_phone: emPhone || undefined,
      });
      setPatient(updated);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <span className="v-eyebrow">Account</span>
        <h1 className="v-h2" style={{ marginTop: 6, fontSize: 22 }}>
          Profile
        </h1>
      </div>
      {error && <ErrorBanner message={error} />}
      {!me && !error && <Loading />}
      {me && (
        <section className="v-card-lg" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              aria-hidden="true"
              style={{
                width: 46,
                height: 46,
                borderRadius: 999,
                background: 'var(--v-brand-gradient)',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 700,
                color: '#fff',
              }}
            >
              {(me.full_name || me.email).slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{me.full_name || me.email}</div>
              <div style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>{me.email}</div>
            </div>
          </div>
        </section>
      )}

      {/* Gated on `patient` so the card never leaves an empty shell behind for
          an account with no patient record; BridgeCodeCard also self-hides. */}
      {patient && (
        <section className="v-card-lg" style={{ padding: 18 }}>
          <BridgeCodeCard />
        </section>
      )}

      {patient && (
        <section className="v-card-lg" style={{ padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Contact information</div>
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--v-text-muted)' }}>
              Phone number
              <input className="v-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--v-text-muted)' }}>
              Emergency contact name
              <input className="v-input" value={emName} onChange={(e) => setEmName(e.target.value)} />
            </label>
            <label style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--v-text-muted)' }}>
              Emergency contact phone
              <input className="v-input" type="tel" value={emPhone} onChange={(e) => setEmPhone(e.target.value)} />
            </label>
            <button
              onClick={saveContact}
              disabled={saving}
              className="v-btn v-btn-secondary"
              style={{ justifySelf: 'start' }}
            >
              <Save size={14} /> {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
            </button>
          </div>
        </section>
      )}

      <section className="v-card-lg" style={{ padding: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>My doctor</div>
        <Link
          href="/app/patient/doctor"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: 12,
            borderRadius: 10,
            background: 'var(--v-surface-2)',
            border: '1px solid var(--v-border)',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <Stethoscope size={18} style={{ color: 'var(--v-brand-2)' }} />
          <span style={{ flex: 1, fontSize: 13 }}>View assigned doctor</span>
          <ArrowRight size={14} style={{ color: 'var(--v-text-muted)' }} />
        </Link>
      </section>

      <section className="v-card-lg" style={{ padding: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Appearance</div>
        <ThemeToggle />
      </section>

      <section className="v-card-lg" style={{ padding: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Session</div>
        <form action="/auth/signout" method="post">
          <button type="submit" className="v-btn v-btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>
            <LogOut size={14} /> Sign out
          </button>
        </form>
      </section>

      <p style={{ fontSize: 11, color: 'var(--v-text-soft)', textAlign: 'center', marginTop: 4 }}>
        VITALIS is clinical decision support. Your care team's judgment is final.
      </p>
    </div>
  );
}

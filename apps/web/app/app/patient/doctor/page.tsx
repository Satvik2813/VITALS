'use client';
import { useEffect, useState } from 'react';
import { Building2, Stethoscope } from 'lucide-react';
import { api, ApiError, type DoctorSummary } from '../../../../lib/api-v1';
import { Empty, ErrorBanner, Loading } from '../../../../components/vitalis/ui';

export default function PatientDoctorPage() {
  const [doctor, setDoctor] = useState<DoctorSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const patients = await api.patients.list();
        const mine = patients[0];
        if (!mine) {
          if (alive) setStatus('empty');
          return;
        }
        const doctors = await api.doctors.list();
        if (!alive) return;
        const match = doctors.find((d) => d.id === mine.owner_id) || null;
        setDoctor(match);
        setStatus(match ? 'ok' : 'empty');
      } catch (e) {
        if (!alive) return;
        setError(e instanceof ApiError ? e.message : (e as Error).message);
        setStatus('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <span className="v-eyebrow">Care team</span>
        <h1 className="v-h2" style={{ marginTop: 6, fontSize: 22 }}>
          My doctor
        </h1>
      </div>
      {status === 'loading' && <Loading label="Loading" />}
      {status === 'error' && <ErrorBanner message={error} />}
      {status === 'empty' && (
        <div className="v-card-lg" style={{ padding: 20 }}>
          <Empty icon={<Stethoscope size={22} />} title="No doctor on file" hint="Contact support if this looks wrong." />
        </div>
      )}
      {status === 'ok' && doctor && (
        <section className="v-card-lg" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              aria-hidden="true"
              style={{
                width: 52,
                height: 52,
                borderRadius: 999,
                background: 'var(--v-brand-gradient)',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 700,
                color: '#fff',
                fontSize: 18,
              }}
            >
              {(doctor.full_name || 'Dr').slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{doctor.full_name || 'Your doctor'}</div>
              {doctor.specialization && (
                <div style={{ fontSize: 13, color: 'var(--v-text-muted)' }}>{doctor.specialization}</div>
              )}
            </div>
          </div>
          {doctor.hospital && (
            <div
              style={{
                marginTop: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: 12,
                borderRadius: 10,
                background: 'var(--v-surface-2)',
                border: '1px solid var(--v-border)',
                fontSize: 13,
              }}
            >
              <Building2 size={16} style={{ color: 'var(--v-text-muted)' }} />
              {doctor.hospital}
            </div>
          )}
          <p className="v-muted" style={{ marginTop: 16, fontSize: 12 }}>
            Your doctor can see your vitals, alerts, and profile to support your care. To change
            doctors, contact support.
          </p>
        </section>
      )}
    </div>
  );
}

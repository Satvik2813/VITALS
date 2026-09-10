'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Bell,
  Bluetooth,
  HeartPulse,
  Stethoscope,
  Thermometer,
  Waves,
  Wind,
} from 'lucide-react';
import { api, ApiError, type DoctorSummary, type History } from '../../../lib/api-v1';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '../../../lib/supabase/client';
import { supabaseConfigured } from '../../../lib/supabase/env';
import { Empty, ErrorBanner, Loading, StateBadge } from '../../../components/vitalis/ui';

export default function PatientHome() {
  const [data, setData] = useState<History | null>(null);
  const [doctor, setDoctor] = useState<DoctorSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');
  const [error, setError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    let supabase: ReturnType<typeof createClient> | null = null;
    let channel: RealtimeChannel | null = null;

    async function refresh(patientId: string, owner_id: string, doctors: DoctorSummary[]) {
      try {
        const h = await api.patients.history(patientId, 1);
        if (!alive) return;
        setData(h);
        setDoctor(doctors.find((d) => d.id === owner_id) || null);
        setStatus('ok');
      } catch (e) {
        if (!alive) return;
        setError(e instanceof ApiError ? e.message : (e as Error).message);
        setStatus('error');
      }
    }

    (async () => {
      try {
        const list = await api.patients.list();
        if (!alive) return;
        if (list.length === 0) {
          setStatus('empty');
          return;
        }
        const mine = list[0];
        const doctors = await api.doctors.list().catch(() => []);
        await refresh(mine.id, mine.owner_id, doctors);
        if (!alive || !supabaseConfigured()) return;
        supabase = createClient();
        const debouncedRefresh = () => {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => refresh(mine.id, mine.owner_id, doctors), 400);
        };
        channel = supabase
          .channel(`patient-home-${mine.id}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'app_vitals', filter: `patient_id=eq.${mine.id}` },
            debouncedRefresh,
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'app_alerts', filter: `patient_id=eq.${mine.id}` },
            debouncedRefresh,
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'app_risk_assessments',
              filter: `patient_id=eq.${mine.id}`,
            },
            debouncedRefresh,
          )
          .subscribe();
      } catch (e) {
        if (!alive) return;
        setError(e instanceof ApiError ? e.message : (e as Error).message);
        setStatus('error');
      }
    })();
    return () => {
      alive = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (supabase && channel) supabase.removeChannel(channel);
    };
  }, []);

  if (status === 'loading') return <Loading label="Loading your health" />;
  if (status === 'error') return <ErrorBanner message={error} />;
  if (status === 'empty' || !data) {
    return (
      <div className="v-card-lg" style={{ padding: 24 }}>
        <Empty
          icon={<HeartPulse size={22} />}
          title="Your health profile isn't set up yet"
          hint="Complete onboarding to link your record with your doctor."
          action={
            <Link href="/onboarding/patient" className="v-btn v-btn-primary">
              Finish setup
            </Link>
          }
        />
      </div>
    );
  }

  const latest = data.vitals[0];
  const state = data.risk[0]?.state ?? 'NORMAL';
  const stable = state === 'NORMAL';
  const lastSeen = latest ? new Date(latest.recorded_at) : null;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section
        className="v-card-lg"
        style={{
          padding: 20,
          background:
            'linear-gradient(135deg, color-mix(in oklab, var(--v-brand-1) 12%, var(--v-surface)), color-mix(in oklab, var(--v-brand-2) 8%, var(--v-surface)))',
        }}
      >
        <StateBadge state={state} />
        <h1 className="v-h2" style={{ marginTop: 10, fontSize: 22 }}>
          {stable ? 'Everything looks stable.' : 'Some readings need attention.'}
        </h1>
        <p className="v-muted" style={{ marginTop: 4, fontSize: 13 }}>
          {lastSeen
            ? `Last update ${lastSeen.toLocaleString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'No readings yet.'}
        </p>
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10,
        }}
      >
        <PatientVital icon={<HeartPulse size={16} />} label="Heart rate" unit="bpm" value={latest?.heart_rate} />
        <PatientVital icon={<Activity size={16} />} label="SpO₂" unit="%" value={latest?.spo2} />
        <PatientVital icon={<Wind size={16} />} label="Respiratory" unit="rpm" value={latest?.respiratory_rate} />
        <PatientVital icon={<Thermometer size={16} />} label="Temperature" unit="°C" value={latest?.temperature_c ?? undefined} decimals={1} />
        <PatientVital icon={<Waves size={16} />} label="BP" unit="" value={latest?.systolic_bp} suffix={latest?.diastolic_bp ? ` / ${latest.diastolic_bp}` : ''} />
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <Link
          href="/app/patient/doctor"
          className="v-card"
          style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}
        >
          <Stethoscope size={18} style={{ color: 'var(--v-brand-2)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>My doctor</div>
            <div style={{ fontSize: 12, color: 'var(--v-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {doctor?.full_name || 'View assigned doctor'}
            </div>
          </div>
          <ArrowRight size={14} style={{ color: 'var(--v-text-muted)', flexShrink: 0 }} />
        </Link>

        <Link
          href="/app/patient/device"
          className="v-card"
          style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}
        >
          <Bluetooth size={18} style={{ color: 'var(--v-brand-2)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Device</div>
            <div style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>Not connected yet</div>
          </div>
          <ArrowRight size={14} style={{ color: 'var(--v-text-muted)', flexShrink: 0 }} />
        </Link>
      </section>

      <section className="v-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Bell size={16} style={{ color: 'var(--v-brand-2)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {data.alerts.filter((a) => !a.acknowledged_at).length} open alert(s)
            </div>
            <div style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
              We'll notify you if a reading needs attention.
            </div>
          </div>
          <Link href="/app/patient/alerts" className="v-btn v-btn-ghost" style={{ fontSize: 12 }}>
            View
          </Link>
        </div>
      </section>
    </div>
  );
}

function PatientVital({
  icon,
  label,
  unit,
  value,
  suffix = '',
  decimals = 0,
}: {
  icon: React.ReactNode;
  label: string;
  unit: string;
  value?: number | null;
  suffix?: string;
  decimals?: number;
}) {
  const display =
    value == null || Number.isNaN(value) ? '—' : decimals ? value.toFixed(decimals) : Math.round(value);
  return (
    <div className="v-card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--v-text-muted)', fontSize: 11 }}>
        <span style={{ color: 'var(--v-brand-2)', display: 'inline-flex' }}>{icon}</span>
        {label}
      </div>
      <div
        style={{
          marginTop: 6,
          display: 'flex',
          alignItems: 'baseline',
          gap: 4,
          fontSize: 24,
          fontWeight: 620,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {display}
        {suffix}
        {unit && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--v-text-muted)' }}>{unit}</span>}
      </div>
    </div>
  );
}

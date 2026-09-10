'use client';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowLeft,
  Bell,
  CheckCheck,
  HeartPulse,
  Thermometer,
  Waves,
  Wind,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, ApiError, type History } from '../../../../../lib/api-v1';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '../../../../../lib/supabase/client';
import { supabaseConfigured } from '../../../../../lib/supabase/env';
import {
  Empty,
  ErrorBanner,
  Loading,
  PageHeader,
  Panel,
  StateBadge,
} from '../../../../../components/vitalis/ui';

export default function PatientDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  async function refresh() {
    try {
      const h = await api.patients.history(id, 100);
      setData(h);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    refresh();
    // Realtime pushes updates for this patient within ~1s; polling stays on
    // as a fallback in case the socket drops, at a longer interval.
    const t = setInterval(refresh, 30000);

    let supabase: ReturnType<typeof createClient> | null = null;
    let channel: RealtimeChannel | null = null;
    if (supabaseConfigured()) {
      supabase = createClient();
      const debouncedRefresh = () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(refresh, 400);
      };
      channel = supabase
        .channel(`doctor-patient-${id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'app_vitals', filter: `patient_id=eq.${id}` },
          debouncedRefresh,
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'app_alerts', filter: `patient_id=eq.${id}` },
          debouncedRefresh,
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'app_risk_assessments', filter: `patient_id=eq.${id}` },
          debouncedRefresh,
        )
        .subscribe();
    }

    return () => {
      clearInterval(t);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (supabase && channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function ack(alertId: string) {
    setBusy(alertId);
    try {
      await api.patients.ackAlert(id, alertId);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const chartData = useMemo(() => {
    if (!data) return [] as { t: string; hr: number | null; spo2: number | null; rr: number | null }[];
    return [...data.vitals]
      .reverse()
      .map((v) => ({
        t: new Date(v.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        hr: v.heart_rate,
        spo2: v.spo2,
        rr: v.respiratory_rate,
      }));
  }, [data]);

  const latest = data?.vitals[0];
  const risk = data?.risk[0];
  const openAlerts = data?.alerts.filter((a) => !a.acknowledged_at) ?? [];

  if (loading && !data) return <Loading label="Loading patient" />;
  if (error && !data) return <ErrorBanner message={error} />;
  if (!data) return null;

  const p = data.patient;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link href="/app/doctor/patients" className="v-btn v-btn-ghost" style={{ padding: '6px 10px' }}>
          <ArrowLeft size={14} /> Patients
        </Link>
      </div>
      <PageHeader
        eyebrow={p.mrn ? `MRN ${p.mrn}` : 'Patient'}
        title={p.full_name}
        description={[p.sex, p.date_of_birth].filter(Boolean).join(' · ') || 'No demographics recorded.'}
        actions={<StateBadge state={risk?.state ?? null} />}
      />
      {error && <ErrorBanner message={error} />}

      <section
        aria-label="Latest vitals"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <VitalTile
          icon={<HeartPulse size={16} />}
          label="Heart rate"
          value={latest?.heart_rate}
          unit="bpm"
        />
        <VitalTile icon={<Activity size={16} />} label="SpO₂" value={latest?.spo2} unit="%" />
        <VitalTile
          icon={<Wind size={16} />}
          label="Respiratory"
          value={latest?.respiratory_rate}
          unit="rpm"
        />
        <VitalTile
          icon={<Thermometer size={16} />}
          label="Temperature"
          value={latest?.temperature_c}
          unit="°C"
          decimals={1}
        />
        <VitalTile
          icon={<Waves size={16} />}
          label="BP"
          value={latest?.systolic_bp}
          unit={latest?.diastolic_bp ? ` / ${latest.diastolic_bp}` : ''}
        />
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
          gap: 20,
        }}
        className="v-two-col"
      >
        <Panel title="Vitals trend (recent)" padding={12}>
          {chartData.length === 0 ? (
            <Empty title="Waiting for readings" hint="No vitals recorded yet." />
          ) : (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="v-hr-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="var(--v-brand-2)" stopOpacity={0.35} />
                      <stop offset="1" stopColor="var(--v-brand-2)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--v-border)" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="t" stroke="var(--v-text-soft)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--v-text-soft)" fontSize={11} tickLine={false} axisLine={false} width={30} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--v-surface)',
                      border: '1px solid var(--v-border)',
                      borderRadius: 8,
                      color: 'var(--v-text)',
                      fontSize: 12,
                    }}
                    labelStyle={{ color: 'var(--v-text-muted)' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="hr"
                    stroke="var(--v-brand-2)"
                    strokeWidth={2}
                    fill="url(#v-hr-fill)"
                    name="Heart rate"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel
          title={`Open alerts (${openAlerts.length})`}
          padding={0}
          action={
            <Link href="/app/doctor/alerts" className="v-btn v-btn-ghost" style={{ fontSize: 13 }}>
              All alerts →
            </Link>
          }
        >
          {openAlerts.length === 0 ? (
            <Empty icon={<Bell size={20} />} title="No open alerts" hint="Everything is quiet." />
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {openAlerts.map((a) => (
                <li
                  key={a.id}
                  style={{
                    padding: 14,
                    borderTop: '1px solid var(--v-border)',
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span className={`v-badge ${sev(a.severity)}`}>{a.severity.toUpperCase()}</span>
                    <span style={{ fontSize: 11, color: 'var(--v-text-soft)' }}>
                      {new Date(a.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 13 }}>{a.message}</div>
                  <button
                    disabled={busy === a.id}
                    className="v-btn v-btn-secondary"
                    style={{ justifySelf: 'start', fontSize: 12, padding: '6px 12px', minHeight: 32 }}
                    onClick={() => ack(a.id)}
                  >
                    <CheckCheck size={13} /> Acknowledge
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <style jsx>{`
        @media (max-width: 900px) {
          :global(.v-two-col) {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

function sev(severity: string) {
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'warning';
  return 'info';
}

function VitalTile({
  icon,
  label,
  value,
  unit,
  decimals = 0,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null | undefined;
  unit: string;
  decimals?: number;
}) {
  const display =
    value == null || Number.isNaN(value)
      ? '—'
      : decimals
        ? value.toFixed(decimals)
        : Math.round(value).toString();
  return (
    <div className="v-card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--v-text-muted)', fontSize: 12 }}>
        <span style={{ color: 'var(--v-brand-2)', display: 'inline-flex' }}>{icon}</span>
        {label}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 4, alignItems: 'baseline' }}>
        <span style={{ fontSize: 26, fontWeight: 620, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
          {display}
        </span>
        <span style={{ fontSize: 11, color: 'var(--v-text-muted)' }}>{unit}</span>
      </div>
    </div>
  );
}

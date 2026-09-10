'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Bell,
  HeartPulse,
  Plus,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { api, ApiError, type Patient } from '../../../lib/api-v1';
import {
  Empty,
  ErrorBanner,
  Loading,
  PageHeader,
  Panel,
  StatCard,
  StateBadge,
} from '../../../components/vitalis/ui';

type PatientRow = Patient & {
  risk_state?: 'NORMAL' | 'WATCH' | 'WARNING' | 'CRITICAL' | null;
  open_alerts?: number;
  last_hr?: number | null;
  last_seen?: string | null;
};

export default function DoctorOverview() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const list = await api.patients.list();
        if (!alive) return;
        // Fan out for latest vitals + open alerts so the overview looks live.
        const enriched = await Promise.all(
          list.map(async (p): Promise<PatientRow> => {
            try {
              const [vitals, alerts, history] = await Promise.all([
                api.patients.vitals(p.id, 1).catch(() => []),
                api.patients.alerts(p.id, true).catch(() => []),
                api.patients.history(p.id, 1).catch(() => null),
              ]);
              const latest = vitals[0];
              const risk = history?.risk?.[0]?.state ?? null;
              return {
                ...p,
                risk_state: risk,
                open_alerts: alerts.length,
                last_hr: latest?.heart_rate ?? null,
                last_seen: latest?.recorded_at ?? null,
              };
            } catch {
              return { ...p };
            }
          }),
        );
        if (alive) setPatients(enriched);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : (e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  const critical = patients.filter((p) => p.risk_state === 'CRITICAL').length;
  const attention = patients.filter(
    (p) => p.risk_state === 'WATCH' || p.risk_state === 'WARNING',
  ).length;
  const openAlerts = patients.reduce((n, p) => n + (p.open_alerts || 0), 0);
  const monitored = patients.length;

  return (
    <div>
      <PageHeader
        eyebrow="Clinical command center"
        title="Overview"
        description="A clear view of who needs you now — real physiological evidence, correlated attention events, and a protected AI context."
        actions={
          <>
            <Link href="/app/doctor/patients" className="v-btn v-btn-secondary">
              <Users size={15} /> Patients
            </Link>
            <Link href="/app/doctor/patients?new=1" className="v-btn v-btn-primary">
              <UserPlus size={15} /> Add patient
            </Link>
          </>
        }
      />

      {error && <ErrorBanner message={error} />}

      <section
        aria-label="Monitoring summary"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard
          label="Monitored patients"
          value={monitored}
          hint={`${monitored - critical - attention} stable`}
          icon={<Users size={18} />}
        />
        <StatCard
          label="Needs attention"
          value={attention}
          tone={attention ? 'warning' : 'default'}
          hint="Watch or Warning state"
          icon={<Activity size={18} />}
        />
        <StatCard
          label="Critical patients"
          value={critical}
          tone={critical ? 'critical' : 'default'}
          hint={`${openAlerts} open alert${openAlerts === 1 ? '' : 's'}`}
          icon={<HeartPulse size={18} />}
        />
        <StatCard
          label="Security posture"
          value="Active"
          tone="success"
          hint="Zero-trust gateway monitoring"
          icon={<ShieldCheck size={18} />}
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
        <Panel
          title="Patient risk overview"
          action={
            <Link href="/app/doctor/patients" className="v-btn v-btn-ghost" style={{ fontSize: 13 }}>
              View all →
            </Link>
          }
          padding={0}
        >
          {loading ? (
            <Loading label="Loading patients" />
          ) : patients.length === 0 ? (
            <Empty
              icon={<Users size={22} />}
              title="No patients yet"
              hint="Add a patient to start monitoring."
              action={
                <Link href="/app/doctor/patients?new=1" className="v-btn v-btn-primary">
                  <Plus size={15} /> Add patient
                </Link>
              }
            />
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {patients.slice(0, 8).map((p) => (
                <li
                  key={p.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '36px minmax(0, 1fr) auto auto',
                    gap: 12,
                    alignItems: 'center',
                    padding: '14px 20px',
                    borderTop: '1px solid var(--v-border)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'var(--v-surface-2)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      color: 'var(--v-brand-2)',
                    }}
                  >
                    {initials(p.full_name)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <Link
                      href={`/app/doctor/patients/${p.id}`}
                      style={{ fontWeight: 550, fontSize: 14 }}
                    >
                      {p.full_name}
                    </Link>
                    <div style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
                      {p.mrn ? `MRN ${p.mrn}` : 'No MRN'}
                      {p.sex ? ` · ${p.sex}` : ''}
                    </div>
                  </div>
                  <div
                    style={{ fontSize: 12, color: 'var(--v-text-muted)', fontVariantNumeric: 'tabular-nums' }}
                    aria-label="Latest heart rate"
                  >
                    {p.last_hr != null ? (
                      <>
                        HR <strong style={{ color: 'var(--v-text)' }}>{p.last_hr}</strong>
                      </>
                    ) : (
                      '—'
                    )}
                  </div>
                  <StateBadge state={p.risk_state || null} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="AI risk insights" padding={20}>
          <p className="v-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
            VITALIS scores every vitals reading with the current risk model and correlates
            escalations across parameters so you see attention events, not raw threshold noise.
          </p>
          <div
            style={{
              marginTop: 16,
              display: 'grid',
              gap: 8,
              padding: 12,
              borderRadius: 10,
              background: 'var(--v-surface-2)',
              border: '1px solid var(--v-border)',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>Model</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>NEWS2-aligned baseline</div>
            <div style={{ fontSize: 11, color: 'var(--v-text-soft)' }}>
              Physiological evidence only. Documents cannot alter this state.
            </div>
          </div>
          <Link
            href="/app/doctor/alerts"
            className="v-btn v-btn-secondary"
            style={{ width: '100%', marginTop: 16, justifyContent: 'center' }}
          >
            <Bell size={15} /> Recent alerts
          </Link>
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

function initials(name: string) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');
}

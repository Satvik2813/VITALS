'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { HeartPulse, Radio } from 'lucide-react';
import { api, ApiError, type Patient } from '../../../../lib/api-v1';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '../../../../lib/supabase/client';
import { supabaseConfigured } from '../../../../lib/supabase/env';
import {
  Empty,
  ErrorBanner,
  Loading,
  PageHeader,
  Panel,
  StateBadge,
} from '../../../../components/vitalis/ui';

type Live = Patient & {
  last_hr?: number | null;
  last_spo2?: number | null;
  last_seen?: string | null;
  state?: 'NORMAL' | 'WATCH' | 'WARNING' | 'CRITICAL' | null;
};

export default function DoctorMonitoring() {
  const [rows, setRows] = useState<Live[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    try {
      const list = await api.patients.list();
      const rich = await Promise.all(
        list.map(async (p): Promise<Live> => {
          const [vitals, history] = await Promise.all([
            api.patients.vitals(p.id, 1).catch(() => []),
            api.patients.history(p.id, 1).catch(() => null),
          ]);
          return {
            ...p,
            last_hr: vitals[0]?.heart_rate ?? null,
            last_spo2: vitals[0]?.spo2 ?? null,
            last_seen: vitals[0]?.recorded_at ?? null,
            state: history?.risk?.[0]?.state ?? null,
          };
        }),
      );
      setRows(rich);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    load();
    // Realtime pushes updates within ~1s; polling stays on as a fallback in
    // case the socket drops, at a much longer interval than before.
    const t = setInterval(load, 25000);

    let supabase: ReturnType<typeof createClient> | null = null;
    let channel: RealtimeChannel | null = null;
    if (supabaseConfigured()) {
      supabase = createClient();
      const debouncedLoad = () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(load, 400);
      };
      channel = supabase
        .channel('doctor-monitoring')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_vitals' }, debouncedLoad)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_risk_assessments' }, debouncedLoad)
        .subscribe();
    }

    return () => {
      clearInterval(t);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (supabase && channel) supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div>
      <PageHeader
        eyebrow="Streaming"
        title="Live monitoring"
        description="A tile per monitored patient. Cards refresh every few seconds and stay honest about staleness."
      />
      {error && <ErrorBanner message={error} />}
      {loading && rows.length === 0 ? (
        <Loading label="Loading live tiles" />
      ) : rows.length === 0 ? (
        <Empty
          icon={<Radio size={22} />}
          title="No patients streaming yet"
          hint="Add a patient and start ingesting vitals to populate this view."
          action={
            <Link href="/app/doctor/patients?new=1" className="v-btn v-btn-primary">
              Add patient
            </Link>
          }
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 14,
          }}
        >
          {rows.map((p) => {
            const staleSec = p.last_seen
              ? Math.round((Date.now() - new Date(p.last_seen).getTime()) / 1000)
              : null;
            const live = staleSec != null && staleSec < 60;
            return (
              <Link
                href={`/app/doctor/patients/${p.id}`}
                key={p.id}
                className="v-card-lg"
                style={{ padding: 16, display: 'block', textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{p.full_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--v-text-muted)' }}>
                      {p.mrn ? `MRN ${p.mrn}` : 'No MRN'}
                    </div>
                  </div>
                  <StateBadge state={p.state ?? null} />
                </div>
                <div style={{ marginTop: 14, display: 'flex', gap: 16, alignItems: 'baseline' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--v-text-muted)' }}>Heart rate</div>
                    <div style={{ fontSize: 24, fontWeight: 620, fontVariantNumeric: 'tabular-nums' }}>
                      {p.last_hr ?? '—'}
                      <span style={{ fontSize: 11, color: 'var(--v-text-muted)' }}> bpm</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--v-text-muted)' }}>SpO₂</div>
                    <div style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>
                      {p.last_spo2 ?? '—'}
                      <span style={{ fontSize: 11, color: 'var(--v-text-muted)' }}> %</span>
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    color: live ? 'var(--v-success)' : 'var(--v-text-soft)',
                  }}
                >
                  {live ? <span className="v-pulse-dot" /> : <HeartPulse size={11} />}
                  {p.last_seen
                    ? `Last reading ${new Date(p.last_seen).toLocaleTimeString()}`
                    : 'No readings yet'}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

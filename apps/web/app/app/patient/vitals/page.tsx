'use client';
import { useEffect, useRef, useState } from 'react';
import { HeartPulse } from 'lucide-react';
import { api, type Vitals } from '../../../../lib/api-v1';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '../../../../lib/supabase/client';
import { supabaseConfigured } from '../../../../lib/supabase/env';
import { Empty, ErrorBanner, Loading } from '../../../../components/vitalis/ui';

export default function PatientVitals() {
  const [rows, setRows] = useState<Vitals[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    let supabase: ReturnType<typeof createClient> | null = null;
    let channel: RealtimeChannel | null = null;

    async function load(patientId: string) {
      try {
        const vitals = await api.patients.vitals(patientId, 30);
        if (!alive) return;
        setRows(vitals);
        setStatus(vitals.length ? 'ok' : 'empty');
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
        setStatus('error');
      }
    }

    (async () => {
      try {
        const list = await api.patients.list();
        if (!alive) return;
        if (!list.length) {
          setStatus('empty');
          return;
        }
        const patientId = list[0].id;
        await load(patientId);
        if (!alive || !supabaseConfigured()) return;
        supabase = createClient();
        const debouncedLoad = () => {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => load(patientId), 400);
        };
        channel = supabase
          .channel(`patient-vitals-${patientId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'app_vitals', filter: `patient_id=eq.${patientId}` },
            debouncedLoad,
          )
          .subscribe();
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
        setStatus('error');
      }
    })();
    return () => {
      alive = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (supabase && channel) supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <span className="v-eyebrow">My readings</span>
        <h1 className="v-h2" style={{ marginTop: 6, fontSize: 22 }}>
          Vitals
        </h1>
      </div>
      {status === 'error' && <ErrorBanner message={error} />}
      {status === 'loading' && <Loading label="Loading readings" />}
      {status === 'empty' && (
        <div className="v-card-lg" style={{ padding: 20 }}>
          <Empty icon={<HeartPulse size={22} />} title="Waiting for readings" hint="Your device hasn't sent any measurements yet." />
        </div>
      )}
      {status === 'ok' && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          {rows.map((v) => (
            <li key={v.id} className="v-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
                {new Date(v.recorded_at).toLocaleString()}
              </div>
              <div
                style={{
                  marginTop: 8,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))',
                  gap: 8,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <Mini label="HR" value={v.heart_rate} unit="bpm" />
                <Mini label="SpO₂" value={v.spo2} unit="%" />
                <Mini label="Resp" value={v.respiratory_rate} unit="rpm" />
                <Mini label="Temp" value={v.temperature_c} unit="°C" decimals={1} />
                <Mini label="BP" value={v.systolic_bp} unit={v.diastolic_bp ? ` /${v.diastolic_bp}` : ''} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Mini({ label, value, unit, decimals = 0 }: { label: string; value: number | null; unit: string; decimals?: number }) {
  const display = value == null ? '—' : decimals ? value.toFixed(decimals) : Math.round(value).toString();
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--v-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>
        {display}
        <span style={{ fontSize: 10, color: 'var(--v-text-muted)', marginLeft: 2 }}>{unit}</span>
      </div>
    </div>
  );
}

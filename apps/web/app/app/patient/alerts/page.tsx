'use client';
import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { api, type Alert } from '../../../../lib/api-v1';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '../../../../lib/supabase/client';
import { supabaseConfigured } from '../../../../lib/supabase/env';
import { Empty, ErrorBanner, Loading } from '../../../../components/vitalis/ui';

const friendly: Record<string, string> = {
  critical: 'Your doctor should look at this soon.',
  warning: 'Something is a little outside the normal range.',
  info: 'Nothing urgent — just a heads-up.',
};

export default function PatientAlerts() {
  const [rows, setRows] = useState<Alert[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');
  const [error, setError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    let supabase: ReturnType<typeof createClient> | null = null;
    let channel: RealtimeChannel | null = null;

    async function load(patientId: string) {
      try {
        const alerts = await api.patients.alerts(patientId, false);
        if (!alive) return;
        setRows(alerts);
        setStatus(alerts.length ? 'ok' : 'empty');
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
          .channel(`patient-alerts-${patientId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'app_alerts', filter: `patient_id=eq.${patientId}` },
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
        <span className="v-eyebrow">Notices</span>
        <h1 className="v-h2" style={{ marginTop: 6, fontSize: 22 }}>
          Alerts & guidance
        </h1>
        <p className="v-muted" style={{ marginTop: 6, fontSize: 13 }}>
          Simple explanations of anything that looks unusual.
        </p>
      </div>
      {status === 'loading' && <Loading label="Loading alerts" />}
      {status === 'error' && <ErrorBanner message={error} />}
      {status === 'empty' && (
        <div className="v-card-lg" style={{ padding: 20 }}>
          <Empty icon={<Bell size={22} />} title="No alerts" hint="Everything looks good right now." />
        </div>
      )}
      {status === 'ok' && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          {rows.map((a) => (
            <li key={a.id} className="v-card-lg" style={{ padding: 16 }}>
              <span className={`v-badge ${a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info'}`}>
                {a.severity === 'critical' ? 'Attention needed' : a.severity === 'warning' ? 'Watch' : 'FYI'}
              </span>
              <p style={{ marginTop: 10, fontSize: 14, lineHeight: 1.55 }}>{friendly[a.severity] || 'Please check your readings.'}</p>
              <p style={{ marginTop: 8, fontSize: 12, color: 'var(--v-text-muted)' }}>
                {new Date(a.created_at).toLocaleString()}
                {a.acknowledged_at ? ' · Reviewed by your care team' : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

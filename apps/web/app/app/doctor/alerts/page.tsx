'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, Filter } from 'lucide-react';
import { api, ApiError, type Alert, type Patient } from '../../../../lib/api-v1';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '../../../../lib/supabase/client';
import { supabaseConfigured } from '../../../../lib/supabase/env';
import {
  Empty,
  ErrorBanner,
  Loading,
  PageHeader,
  Panel,
} from '../../../../components/vitalis/ui';

type Row = Alert & { patient_name?: string };

export default function DoctorAlerts() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const [busy, setBusy] = useState('');

  async function load() {
    setLoading(true);
    try {
      const list: Patient[] = await api.patients.list();
      const nested = await Promise.all(
        list.map(async (p) => {
          const alerts = await api.patients.alerts(p.id, openOnly).catch(() => []);
          return alerts.map((a) => ({ ...a, patient_name: p.full_name }));
        }),
      );
      const flat = nested.flat().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      setRows(flat);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    load();

    let supabase: ReturnType<typeof createClient> | null = null;
    let channel: RealtimeChannel | null = null;
    if (supabaseConfigured()) {
      supabase = createClient();
      const debouncedLoad = () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(load, 400);
      };
      channel = supabase
        .channel('doctor-alerts')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_alerts' }, debouncedLoad)
        .subscribe();
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (supabase && channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOnly]);

  async function ack(a: Row) {
    setBusy(a.id);
    try {
      await api.patients.ackAlert(a.patient_id, a.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Priority queue"
        title="Alerts"
        description="Physiological escalations across all patients, sorted by recency."
        actions={
          <button
            className="v-btn v-btn-secondary"
            onClick={() => setOpenOnly((v) => !v)}
            aria-pressed={openOnly}
          >
            <Filter size={14} /> {openOnly ? 'Showing open only' : 'Showing all'}
          </button>
        }
      />
      {error && <ErrorBanner message={error} />}
      <Panel padding={0}>
        {loading ? (
          <Loading label="Loading alerts" />
        ) : rows.length === 0 ? (
          <Empty
            icon={<Bell size={22} />}
            title="No active alerts"
            hint="Everything is quiet across your monitored patients."
          />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((a) => (
              <li
                key={a.id}
                style={{
                  padding: 16,
                  borderTop: '1px solid var(--v-border)',
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: 14,
                  alignItems: 'center',
                }}
              >
                <span className={`v-badge ${sev(a.severity)}`}>{a.severity.toUpperCase()}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 550 }}>
                    <Link href={`/app/doctor/patients/${a.patient_id}`}>{a.patient_name}</Link>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--v-text-muted)', marginTop: 2 }}>
                    {a.message}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--v-text-soft)', marginTop: 4 }}>
                    {new Date(a.created_at).toLocaleString()}
                    {a.acknowledged_at ? ` · acknowledged ${new Date(a.acknowledged_at).toLocaleString()}` : ''}
                  </div>
                </div>
                {!a.acknowledged_at && (
                  <button
                    onClick={() => ack(a)}
                    disabled={busy === a.id}
                    className="v-btn v-btn-secondary"
                    style={{ fontSize: 12, padding: '6px 10px', minHeight: 32 }}
                  >
                    <CheckCheck size={14} /> Acknowledge
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function sev(severity: string) {
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'warning';
  return 'info';
}

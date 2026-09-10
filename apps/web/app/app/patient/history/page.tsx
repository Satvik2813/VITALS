'use client';
import { useEffect, useMemo, useState } from 'react';
import { LineChart } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, type Vitals } from '../../../../lib/api-v1';
import { Empty, ErrorBanner, Loading } from '../../../../components/vitalis/ui';

type Metric = 'heart_rate' | 'spo2' | 'respiratory_rate' | 'temperature_c';
const labels: Record<Metric, { name: string; unit: string; decimals: number }> = {
  heart_rate: { name: 'Heart rate', unit: 'bpm', decimals: 0 },
  spo2: { name: 'SpO₂', unit: '%', decimals: 0 },
  respiratory_rate: { name: 'Respiratory', unit: 'rpm', decimals: 0 },
  temperature_c: { name: 'Temperature', unit: '°C', decimals: 1 },
};

export default function PatientHistory() {
  const [rows, setRows] = useState<Vitals[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');
  const [metric, setMetric] = useState<Metric>('heart_rate');

  useEffect(() => {
    (async () => {
      try {
        const list = await api.patients.list();
        if (!list.length) {
          setStatus('empty');
          return;
        }
        const vitals = await api.patients.vitals(list[0].id, 40);
        setRows(vitals);
        setStatus(vitals.length ? 'ok' : 'empty');
      } catch (e) {
        setError((e as Error).message);
        setStatus('error');
      }
    })();
  }, []);

  const data = useMemo(
    () =>
      [...rows]
        .reverse()
        .map((v) => ({
          t: new Date(v.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          value: v[metric],
        }))
        .filter((d) => d.value != null),
    [rows, metric],
  );
  const meta = labels[metric];
  const latest = data[data.length - 1]?.value ?? null;

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <span className="v-eyebrow">History</span>
        <h1 className="v-h2" style={{ marginTop: 6, fontSize: 22 }}>
          Health trends
        </h1>
      </div>

      <div
        role="tablist"
        aria-label="Metric"
        style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          padding: 4,
          background: 'var(--v-surface-2)',
          borderRadius: 10,
          border: '1px solid var(--v-border)',
          marginBottom: 12,
        }}
      >
        {(Object.keys(labels) as Metric[]).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={metric === m}
            onClick={() => setMetric(m)}
            style={{
              flex: 1,
              minWidth: 96,
              padding: '8px 10px',
              borderRadius: 8,
              border: 0,
              background: metric === m ? 'var(--v-surface)' : 'transparent',
              color: metric === m ? 'var(--v-text)' : 'var(--v-text-muted)',
              fontSize: 12,
              fontWeight: 600,
              boxShadow: metric === m ? 'var(--v-shadow-sm)' : 'none',
              cursor: 'pointer',
            }}
          >
            {labels[m].name}
          </button>
        ))}
      </div>

      {status === 'error' && <ErrorBanner message={error} />}
      {status === 'loading' && <Loading label="Loading history" />}
      {status === 'empty' && (
        <div className="v-card-lg" style={{ padding: 20 }}>
          <Empty icon={<LineChart size={22} />} title="No history yet" hint="Trends appear as your device sends more readings." />
        </div>
      )}
      {status === 'ok' && (
        <div className="v-card-lg" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 30, fontWeight: 620, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              {latest == null
                ? '—'
                : meta.decimals
                  ? (latest as number).toFixed(meta.decimals)
                  : Math.round(latest as number)}
            </span>
            <span style={{ fontSize: 13, color: 'var(--v-text-muted)' }}>{meta.unit}</span>
            <span style={{ fontSize: 12, color: 'var(--v-text-muted)', marginLeft: 'auto' }}>{data.length} readings</span>
          </div>
          <div style={{ width: '100%', height: 240, marginTop: 8 }}>
            <ResponsiveContainer>
              <AreaChart data={data} margin={{ top: 8, right: 4, left: -14, bottom: 0 }}>
                <defs>
                  <linearGradient id="p-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="var(--v-brand-2)" stopOpacity={0.36} />
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
                />
                <Area type="monotone" dataKey="value" stroke="var(--v-brand-2)" strokeWidth={2} fill="url(#p-fill)" name={meta.name} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

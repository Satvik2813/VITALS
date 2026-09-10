'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Users, X } from 'lucide-react';
import { api, ApiError, type Patient } from '../../../../lib/api-v1';
import {
  Empty,
  ErrorBanner,
  Loading,
  PageHeader,
  Panel,
  StateBadge,
} from '../../../../components/vitalis/ui';

type Row = Patient & {
  risk_state?: 'NORMAL' | 'WATCH' | 'WARNING' | 'CRITICAL' | null;
  last_hr?: number | null;
  last_seen?: string | null;
};

export default function DoctorPatients() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') === '1') setShowNew(true);
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const list = await api.patients.list();
      const enriched = await Promise.all(
        list.map(async (p): Promise<Row> => {
          const [vitals, history] = await Promise.all([
            api.patients.vitals(p.id, 1).catch(() => []),
            api.patients.history(p.id, 1).catch(() => null),
          ]);
          return {
            ...p,
            risk_state: history?.risk?.[0]?.state ?? null,
            last_hr: vitals[0]?.heart_rate ?? null,
            last_seen: vitals[0]?.recorded_at ?? null,
          };
        }),
      );
      setRows(enriched);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const filtered = rows.filter((p) =>
    (p.full_name + ' ' + (p.mrn || '')).toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div>
      <PageHeader
        eyebrow="Panel"
        title="Patients"
        description="Search, filter, and open detailed monitoring for anyone under your care."
        actions={
          <button className="v-btn v-btn-primary" onClick={() => setShowNew(true)}>
            <Plus size={15} /> Add patient
          </button>
        }
      />

      {error && <ErrorBanner message={error} />}

      <Panel padding={0}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: 16,
            borderBottom: '1px solid var(--v-border)',
          }}
        >
          <Search size={16} style={{ color: 'var(--v-text-soft)' }} />
          <input
            aria-label="Search patients"
            placeholder="Search by name or MRN…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="v-input"
            style={{ padding: '6px 8px', border: 0, background: 'transparent' }}
          />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--v-text-muted)' }}>
            {filtered.length} of {rows.length}
          </span>
        </div>
        {loading ? (
          <Loading label="Loading patients" />
        ) : filtered.length === 0 ? (
          <Empty
            icon={<Users size={22} />}
            title={rows.length === 0 ? 'No patients yet' : 'No matches'}
            hint={rows.length === 0 ? 'Add your first patient to begin monitoring.' : 'Try a different search.'}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ textAlign: 'left', fontSize: 11, color: 'var(--v-text-muted)' }}>
                  <th style={th}>Patient</th>
                  <th style={th}>MRN</th>
                  <th style={th}>Sex</th>
                  <th style={th}>Latest HR</th>
                  <th style={th}>Last reading</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    style={{ borderTop: '1px solid var(--v-border)', fontSize: 14 }}
                  >
                    <td style={td}>
                      <Link href={`/app/doctor/patients/${p.id}`} style={{ fontWeight: 550 }}>
                        {p.full_name}
                      </Link>
                    </td>
                    <td style={{ ...td, color: 'var(--v-text-muted)' }}>{p.mrn || '—'}</td>
                    <td style={{ ...td, color: 'var(--v-text-muted)' }}>{p.sex || '—'}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
                      {p.last_hr ?? '—'}
                    </td>
                    <td style={{ ...td, color: 'var(--v-text-muted)', fontSize: 12 }}>
                      {p.last_seen ? new Date(p.last_seen).toLocaleString() : '—'}
                    </td>
                    <td style={td}>
                      <StateBadge state={p.risk_state || null} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {showNew && <NewPatientDialog onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 16px', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 };
const td: React.CSSProperties = { padding: '14px 16px' };

function NewPatientDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [mrn, setMrn] = useState('');
  const [dob, setDob] = useState('');
  const [sex, setSex] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.patients.create({
        full_name: name.trim(),
        mrn: mrn.trim() || undefined,
        date_of_birth: dob || undefined,
        sex: sex || undefined,
      } as Partial<import('../../../../lib/api-v1').Patient> & { full_name: string });
      onCreated();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Add patient"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50,
        padding: 20,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="v-card-lg"
        style={{ padding: 24, width: '100%', maxWidth: 460 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 className="v-h3">Add patient</h2>
          <button type="button" className="v-btn v-btn-ghost" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {err && <ErrorBanner message={err} />}
        <label style={label}>Full name
          <input required className="v-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label style={label}>MRN
          <input className="v-input" value={mrn} onChange={(e) => setMrn(e.target.value)} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={label}>Date of birth
            <input type="date" className="v-input" value={dob} onChange={(e) => setDob(e.target.value)} />
          </label>
          <label style={label}>Sex
            <select className="v-input" value={sex} onChange={(e) => setSex(e.target.value)}>
              <option value="">—</option>
              <option value="F">F</option>
              <option value="M">M</option>
              <option value="X">Other / X</option>
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button type="button" className="v-btn v-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!name.trim() || busy} className="v-btn v-btn-primary">
            {busy ? 'Adding…' : 'Add patient'}
          </button>
        </div>
      </form>
    </div>
  );
}

const label: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  fontSize: 12,
  color: 'var(--v-text-muted)',
  marginBottom: 12,
};

'use client';
import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { api, type Me } from '../../../../lib/api-v1';
import { PageHeader, Panel, Loading, ErrorBanner } from '../../../../components/vitalis/ui';
import { ThemeToggle } from '../../../../components/vitalis/theme-toggle';

export default function DoctorSettings() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.me()
      .then((m) => setMe(m))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader eyebrow="Account" title="Settings" description="Your profile, preferences, and session." />
      {error && <ErrorBanner message={error} />}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 20,
        }}
      >
        <Panel title="Profile">
          {loading ? (
            <Loading />
          ) : me ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 14 }}>
              <Row label="Name" value={me.full_name || '—'} />
              <Row label="Email" value={me.email} />
              <Row label="Role" value={me.role || '—'} />
              {me.specialization && <Row label="Specialization" value={me.specialization} />}
              {me.hospital && <Row label="Hospital / Clinic" value={me.hospital} />}
              <Row label="User ID" value={me.id} mono />
            </ul>
          ) : null}
        </Panel>
        <Panel title="Appearance">
          <p className="v-muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Choose light, dark, or match your system.
          </p>
          <ThemeToggle />
        </Panel>
        <Panel title="Session">
          <p className="v-muted" style={{ fontSize: 13, marginBottom: 12 }}>
            End your session on this device.
          </p>
          <form action="/auth/signout" method="post">
            <button type="submit" className="v-btn v-btn-secondary">
              <LogOut size={14} /> Sign out
            </button>
          </form>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <li style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--v-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontSize: 14, fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined }}>
        {value}
      </span>
    </li>
  );
}

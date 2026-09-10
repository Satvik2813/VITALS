'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, FileCheck2, LockKeyhole, Shield, ShieldAlert } from 'lucide-react';
import { api, ApiError, type DocumentScan, type Patient } from '../../../../lib/api-v1';
import { ErrorBanner, Loading } from '../../../../components/vitalis/ui';

type Row = DocumentScan & { patient_name?: string };

export default function SecurityCenter() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const list: Patient[] = await api.patients.list();
        const nested = await Promise.all(
          list.map(async (p) => {
            const docs = await api.patients.documents(p.id).catch(() => []);
            return docs.map((d) => ({ ...d, patient_name: p.full_name }));
          }),
        );
        setRows(nested.flat().sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1)));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : (e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const total = rows.length;
  const trusted = rows.filter((r) => r.scan_verdict === 'TRUSTED').length;
  const suspicious = rows.filter((r) => r.scan_verdict === 'SUSPICIOUS').length;
  const malicious = rows.filter((r) => r.scan_verdict === 'MALICIOUS').length;
  const quarantined = suspicious + malicious;
  const recentQuarantines = rows.filter((r) => r.scan_verdict !== 'TRUSTED').slice(0, 5);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <span className="v-eyebrow">Zero-trust healthcare AI</span>
        <h1 className="v-h2" style={{ marginTop: 6, fontSize: 26 }}>
          Security center
        </h1>
        <p className="v-muted" style={{ marginTop: 6, fontSize: 14, maxWidth: 720 }}>
          VITALIS treats every clinical document as untrusted until it passes classification. Live
          physiological evidence — never a document — decides the risk state.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <Loading label="Loading scan history" />
      ) : (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
            marginBottom: 20,
          }}
        >
          <Signal
            icon={<Shield size={18} />}
            title="Gateway"
            value="Active"
            hint={`${total} document${total === 1 ? '' : 's'} scanned across your panel.`}
            tone="success"
          />
          <Signal
            icon={<ShieldAlert size={18} />}
            title="Quarantined"
            value={String(quarantined)}
            hint={`${trusted} trusted · ${suspicious} suspicious · ${malicious} malicious.`}
            tone={malicious > 0 ? 'critical' : quarantined > 0 ? 'warning' : 'success'}
          />
          <Signal
            icon={<LockKeyhole size={18} />}
            title="Physiological override"
            value="Enforced"
            hint="Documents cannot alter the risk engine."
            tone="success"
          />
        </section>
      )}

      <section className="v-card-lg" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <span
            aria-hidden="true"
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'color-mix(in oklab, var(--v-brand-2) 14%, transparent)',
              color: 'var(--v-brand-2)',
              flexShrink: 0,
            }}
          >
            <FileCheck2 size={22} />
          </span>
          <div style={{ minWidth: 0, width: '100%' }}>
            <h2 className="v-h3">Recent quarantines</h2>
            {recentQuarantines.length === 0 ? (
              <p className="v-muted" style={{ marginTop: 6, fontSize: 14 }}>
                Nothing quarantined yet. Upload a document from the{' '}
                <Link href="/app/doctor/documents">documents</Link> page to see it classified here.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, marginTop: 12, display: 'grid', gap: 10 }}>
                {recentQuarantines.map((d) => (
                  <li
                    key={d.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                      fontSize: 13,
                      borderTop: '1px solid var(--v-border)',
                      paddingTop: 10,
                    }}
                  >
                    <span>
                      <span
                        className={`v-badge ${d.scan_verdict === 'MALICIOUS' ? 'critical' : 'suspicious'}`}
                        style={{ marginRight: 8 }}
                      >
                        {d.scan_verdict}
                      </span>
                      {d.filename} — {d.patient_name}
                    </span>
                    <Link href="/app/doctor/documents" className="v-btn v-btn-ghost" style={{ fontSize: 12 }}>
                      Review <ArrowRight size={12} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section
        style={{
          marginTop: 20,
          padding: 20,
          border: '1px solid var(--v-border)',
          borderRadius: 14,
          background: 'var(--v-surface-2)',
        }}
      >
        <h3 className="v-h3">How verdicts map to action</h3>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 12, display: 'grid', gap: 10, fontSize: 14 }}>
          <li>
            <span className="v-badge success" style={{ marginRight: 8 }}>
              Trusted
            </span>
            Numeric allowlisted facts may enter the AI context.
          </li>
          <li>
            <span className="v-badge suspicious" style={{ marginRight: 8 }}>
              Suspicious
            </span>
            Sanitized; instructions stripped; requires clinician review.
          </li>
          <li>
            <span className="v-badge critical" style={{ marginRight: 8 }}>
              Malicious
            </span>
            Quarantined; original preserved; nothing enters context.
          </li>
        </ul>
      </section>
    </div>
  );
}

function Signal({
  icon,
  title,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  hint: string;
  tone: 'success' | 'warning' | 'critical';
}) {
  const color = tone === 'success' ? 'var(--v-success)' : tone === 'warning' ? 'var(--v-warning)' : 'var(--v-critical)';
  return (
    <div className="v-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color }}>
        {icon}
        <div style={{ fontSize: 12, color: 'var(--v-text-muted)', fontWeight: 550 }}>{title}</div>
      </div>
      <div style={{ marginTop: 10, fontSize: 20, fontWeight: 620 }}>{value}</div>
      <p style={{ fontSize: 12, color: 'var(--v-text-muted)', marginTop: 4 }}>{hint}</p>
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FileCheck2, ShieldAlert, Upload } from 'lucide-react';
import { api, ApiError, type DocumentScan, type Patient } from '../../../../lib/api-v1';
import {
  Empty,
  ErrorBanner,
  Loading,
  PageHeader,
  Panel,
} from '../../../../components/vitalis/ui';

type Row = DocumentScan & { patient_name?: string };

export default function DoctorDocuments() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadPatient, setUploadPatient] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const list = await api.patients.list();
      setPatients(list);
      if (!uploadPatient && list[0]) setUploadPatient(list[0].id);
      const nested = await Promise.all(
        list.map(async (p) => {
          const docs = await api.patients.documents(p.id).catch(() => []);
          return docs.map((d) => ({ ...d, patient_name: p.full_name }));
        }),
      );
      const flat = nested.flat().sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1));
      setRows(flat);
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file || !uploadPatient) return;
    setBusy(true);
    try {
      await api.patients.uploadDocument(uploadPatient, file);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Ingested records"
        title="Documents"
        description="Recent scans across the panel. Verdict, sanitization, and audit trail per file."
      />

      <Panel title="Upload a document for scanning" padding={16}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={uploadPatient}
            onChange={(e) => setUploadPatient(e.target.value)}
            className="v-input"
            style={{ minWidth: 200 }}
          >
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
          <input ref={fileRef} type="file" accept=".pdf,.txt" />
          <button className="v-btn v-btn-primary" onClick={upload} disabled={busy || !uploadPatient}>
            <Upload size={14} /> {busy ? 'Scanning…' : 'Upload & scan'}
          </button>
        </div>
        <p className="v-muted" style={{ marginTop: 10, fontSize: 12 }}>
          PDF or UTF-8 text, up to 5 MB. Every document is quarantined until the gateway classifies
          it — see the{' '}
          <Link href="/app/doctor/security">security center</Link> for how verdicts map to action.
        </p>
      </Panel>

      {error && (
        <div style={{ marginTop: 16 }}>
          <ErrorBanner message={error} />
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <Panel padding={0}>
          {loading ? (
            <Loading label="Loading scans" />
          ) : rows.length === 0 ? (
            <Empty
              icon={<FileCheck2 size={22} />}
              title="No scans yet"
              hint="Upload a document above to run it through the gateway."
            />
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {rows.map((d) => (
                <li
                  key={d.id}
                  style={{
                    padding: 16,
                    borderTop: '1px solid var(--v-border)',
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    gap: 14,
                    alignItems: 'center',
                  }}
                >
                  <span className={`v-badge ${verdictTone(d.scan_verdict)}`}>
                    {d.scan_verdict ?? 'UNKNOWN'}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 550 }}>{d.filename}</div>
                    <div style={{ fontSize: 12, color: 'var(--v-text-muted)', marginTop: 2 }}>
                      {d.patient_name} · {(d.size_bytes / 1024).toFixed(1)} KB ·{' '}
                      {new Date(d.uploaded_at).toLocaleString()}
                    </div>
                    {(d.scan_payload.signals?.length ?? 0) > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--v-text-soft)', marginTop: 4 }}>
                        {d.scan_payload.signals!.map((s) => s.reason).join(' · ')}
                      </div>
                    )}
                  </div>
                  {d.scan_verdict !== 'TRUSTED' && (
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11,
                        color: 'var(--v-text-soft)',
                      }}
                    >
                      <ShieldAlert size={13} /> Quarantined
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function verdictTone(verdict: string | null) {
  if (verdict === 'TRUSTED') return 'success';
  if (verdict === 'SUSPICIOUS') return 'suspicious';
  if (verdict === 'MALICIOUS') return 'critical';
  return 'info';
}

'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Download,
  FileCheck2,
  FileText,
  LoaderCircle,
  LockKeyhole,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import type { Document, Patient } from '../lib/types';
import { request, time } from './shared';
export function DocumentGateway({
  patient,
  refresh,
  notify,
}: {
  patient: Patient;
  refresh: () => Promise<void>;
  notify: (text: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<Document | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setResult(null);
    setError('');
  }, [patient.id]);
  async function upload(file: File) {
    if (uploading) return;
    if (file.size > 5 * 1024 * 1024 || !/\.(pdf|txt)$/i.test(file.name)) {
      setError('Choose a PDF or UTF-8 text file up to 5 MB.');
      return;
    }
    setUploading(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const value: Document = await (
        await request(`patients/${patient.id}/documents`, { method: 'POST', body: form })
      ).json();
      setResult(value);
      await refresh();
      notify(
        value.scan.quarantined
          ? `Security quarantine. ${patient.name}’s physiological assessment is preserved.`
          : 'Scan passed. Numeric facts retained with provenance.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }
  async function attackDemo() {
    try {
      const r = await request('fixtures/attack');
      await upload(new File([await r.blob()], 'attack-report.pdf', { type: 'application/pdf' }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="gateway-content">
      <div
        className={`upload-zone ${uploading ? 'scanning' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]);
        }}
      >
        <span className="upload-icon">
          {uploading ? <LoaderCircle className="spin" size={25} /> : <Upload size={25} />}
        </span>
        <h3>{uploading ? 'Parsing, screening and protecting context…' : 'Add a clinical document'}</h3>
        <p>Drop a PDF or note here. Original files are always preserved.</p>
        <input
          ref={input}
          type="file"
          accept=".pdf,.txt"
          aria-label="Upload clinical document"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          disabled={uploading}
        />
        <button className="secondary-button" disabled={uploading} onClick={() => input.current?.click()}>
          Choose document
        </button>
        <small>PDF or UTF-8 text · up to 5 MB · up to 20 PDF pages</small>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="demo-attack">
        <div>
          <ShieldAlert size={18} />
          <div>
            <strong>Test the poisoned-record scenario</strong>
            <p>Real PDF with embedded suppression instructions.</p>
          </div>
        </div>
        <button className="secondary-button" disabled={uploading} onClick={attackDemo}>
          Run attack demo <ArrowRight size={14} />
        </button>
      </div>
      <div className="fixture-links">
        <a href="/api/fixtures/attack" download>
          <Download size={14} />
          Attack PDF
        </a>
        <a href="/api/fixtures/clean" download>
          <Download size={14} />
          Clean PDF
        </a>
      </div>
      {result?.scan.quarantined && (
        <div className="quarantine-result">
          <ShieldAlert size={23} />
          <div>
            <strong>SECURITY QUARANTINE</strong>
            <p>Manipulation detected. Unsafe content excluded. Original preserved.</p>
          </div>
        </div>
      )}
      <div className="document-list">
        {patient.documents.length ? (
          patient.documents.map((d) => <DocumentCard key={d.id} document={d} />)
        ) : (
          <div className="empty-small">
            <FileText size={18} />
            No clinical documents for this patient yet.
          </div>
        )}
      </div>
      <div className="gateway-policy">
        <LockKeyhole size={15} />
        <p>
          “Trusted” means this scan passed. It does not verify clinical truth. Suspicious and malicious
          documents are both excluded.
        </p>
      </div>
    </div>
  );
}
function DocumentCard({ document: d }: { document: Document }) {
  return (
    <details className="document-card" open={d.scan.quarantined}>
      <summary>
        <span className={`document-icon ${d.scan.quarantined ? 'unsafe' : ''}`}>
          {d.scan.quarantined ? <ShieldAlert size={20} /> : <FileCheck2 size={20} />}
        </span>
        <span>
          <strong>{d.filename}</strong>
          <small>{time(d.uploaded_at)} · original preserved</small>
        </span>
        <span className={`verdict ${d.scan.verdict.toLowerCase()}`}>{d.scan.verdict}</span>
      </summary>
      <div className="document-body">
        {d.scan.signals.map((s, i) => (
          <div className="security-signal" key={i}>
            <strong>{s.reason}</strong>
            {s.excerpt && <blockquote>{s.excerpt}</blockquote>}
          </div>
        ))}
        {!d.scan.signals.length && <p>No configured manipulation signals detected.</p>}
        <p className="quiet-label">
          {d.facts.length} numeric facts retained ·{' '}
          {d.scan.quarantined ? 'quarantined; excluded from context' : 'screened; clinically unverified'}
        </p>
        <details className="provenance">
          <summary>Provenance & integrity</summary>
          <code>SHA-256 {d.sha256}</code>
          {d.facts.map((f, i) => (
            <p key={i}>
              {f.fact_type}: {f.value} {f.provenance.unit} · page {f.provenance.page}, line{' '}
              {f.provenance.line} · {f.trust_status}
            </p>
          ))}
        </details>
        <a className="text-button" href={`/api/documents/${d.id}/original`} download>
          <Download size={14} />
          Download original
        </a>
      </div>
    </details>
  );
}

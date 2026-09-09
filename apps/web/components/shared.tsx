import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Check,
  Heart,
  LockKeyhole,
  ShieldAlert,
  CheckCheck,
} from 'lucide-react';
import type { AuditEvent, Metrics, Patient, State } from '../lib/types';
export const stateLabels: Record<State, string> = {
  NORMAL: 'Normal',
  WATCH: 'Watch',
  WARNING: 'Warning',
  CRITICAL: 'Critical',
};
export function time(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function Badge({ state }: { state: State }) {
  return (
    <span className={`badge ${state.toLowerCase()}`}>
      <i />
      {stateLabels[state]}
    </span>
  );
}
export async function request(path: string, options?: RequestInit) {
  const response = await fetch(`/api/${path}`, { cache: 'no-store', ...options });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(typeof data?.detail === 'string' ? data.detail : `Request failed (${response.status})`);
  }
  return response;
}
export function Stat({
  label,
  value,
  icon,
  note,
  tone = '',
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  note: string;
  tone?: string;
}) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong className="stat-value">{value}</strong>
      <p>{note}</p>
    </div>
  );
}
export function ChartLegend() {
  return (
    <div className="chart-legend">
      <span>
        <i className="naive" />
        Naive
      </span>
      <span>
        <i />
        VITALIS
      </span>
    </div>
  );
}
export function BurdenPanel({ metrics, onExpand }: { metrics: Metrics; onExpand: () => void }) {
  return (
    <section className="panel burden-panel">
      <div className="section-heading">
        <div>
          <h2>Quiet the noise. Keep the signal.</h2>
          <p>Alert burden · same synthetic stream</p>
        </div>
        <button className="text-button" onClick={onExpand}>
          Explore <ArrowRight size={14} />
        </button>
      </div>
      <div className="burden-summary">
        <div>
          <span className="quiet-label">Naive alerts</span>
          <strong>{metrics.raw_threshold_alerts}</strong>
        </div>
        <ArrowRight size={20} />
        <div>
          <span className="quiet-label">VITALIS events</span>
          <strong className="green-text">{metrics.actionable_alerts}</strong>
        </div>
        <span className="reduction">
          <ArrowDownRight size={16} />
          {metrics.reduction_pct}% fewer
        </span>
      </div>
      <div className="burden-bars">
        <div style={{ width: '100%' }} />
        <div
          style={{
            width: `${metrics.raw_threshold_alerts ? Math.max(1, (metrics.actionable_alerts / metrics.raw_threshold_alerts) * 100) : 0}%`,
          }}
        />
      </div>
      <div className="burden-foot">
        <span>
          {metrics.episodes_detected}/{metrics.known_episodes} known episodes detected
        </span>
        <ChartLegend />
      </div>
    </section>
  );
}
export function Conflict({ patient }: { patient: Patient }) {
  return (
    <div className="conflict-banner" role="alert">
      <div className="conflict-top">
        <ShieldAlert size={23} />
        <div>
          <strong>Trust conflict detected</strong>
          <p>An untrusted record attempted to suppress or alter an active clinical interpretation.</p>
        </div>
        <span className="conflict-tag">CONTEXT PROTECTED</span>
      </div>
      <div className="conflict-evidence">
        <div>
          <small>PHYSIOLOGICAL EVIDENCE</small>
          <strong>
            {stateLabels[patient.risk.state]} deterioration · NEWS2 {patient.risk.news2_score}
          </strong>
        </div>
        <div>
          <small>UNTRUSTED DOCUMENT</small>
          <strong>Manipulation attempt excluded from reasoning</strong>
        </div>
        <div>
          <small>PROTECTIVE ACTION</small>
          <strong>
            <LockKeyhole size={14} /> Document quarantined · unsafe instructions excluded
          </strong>
          <span>
            <CheckCheck size={15} /> {stateLabels[patient.risk.state]} alert preserved
          </span>
        </div>
      </div>
    </div>
  );
}
export function AuditList({ events, compact = false }: { events: AuditEvent[]; compact?: boolean }) {
  return (
    <div className={`audit-list ${compact ? 'compact' : ''}`}>
      {events.length ? (
        events.map((e) => {
          const security = /QUARANTINE|TRUST_CONFLICT|SECURITY_SIGNAL/.test(e.event_type);
          return (
            <div className={`audit-event ${security ? 'security' : ''}`} key={e.id}>
              <span className="audit-icon">
                {security ? (
                  <ShieldAlert size={16} />
                ) : e.event_type.includes('CLINICAL') ? (
                  <Heart size={16} />
                ) : (
                  <Check size={16} />
                )}
              </span>
              <div>
                <div className="audit-title">
                  <strong>{e.event_type.toLowerCase().replaceAll('_', ' ')}</strong>
                  <time>{time(e.created_at)}</time>
                </div>
                <p>{e.details.message}</p>
                {!compact && (
                  <small>
                    {e.actor}
                    {e.patient_id ? ` · Patient ${e.patient_id.toUpperCase()}` : ''}
                    {e.details.document_id ? ` · Document ${e.details.document_id.slice(0, 8)}` : ''}
                  </small>
                )}
              </div>
            </div>
          );
        })
      ) : (
        <div className="empty-small">
          <Activity size={16} />
          No events in this run.
        </div>
      )}
    </div>
  );
}

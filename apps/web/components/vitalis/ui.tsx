'use client';
import { ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 20,
        marginBottom: 24,
        flexWrap: 'wrap',
      }}
    >
      <div>
        {eyebrow && <span className="v-eyebrow">{eyebrow}</span>}
        <h1 className="v-h2" style={{ marginTop: eyebrow ? 6 : 0, fontSize: 26, fontWeight: 620 }}>
          {title}
        </h1>
        {description && (
          <p className="v-muted" style={{ marginTop: 6, fontSize: 14, maxWidth: 640 }}>
            {description}
          </p>
        )}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'success' | 'warning' | 'critical' | 'info';
  icon?: ReactNode;
}) {
  const toneColor: Record<string, string> = {
    default: 'var(--v-text)',
    success: 'var(--v-success)',
    warning: 'var(--v-warning)',
    critical: 'var(--v-critical)',
    info: 'var(--v-info)',
  };
  return (
    <div className="v-card" style={{ padding: 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>{label}</span>
        {icon && (
          <span aria-hidden="true" style={{ color: 'var(--v-brand-2)', display: 'inline-flex' }}>
            {icon}
          </span>
        )}
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 30,
          fontWeight: 620,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          color: toneColor[tone],
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
      {hint && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--v-text-muted)' }}>{hint}</div>}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
  padding = 20,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  padding?: number;
}) {
  return (
    <section className="v-card-lg">
      {title && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '16px 20px',
            borderBottom: '1px solid var(--v-border)',
          }}
        >
          <h2 className="v-h3">{title}</h2>
          {action}
        </header>
      )}
      <div style={{ padding }}>{children}</div>
    </section>
  );
}

export function Empty({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '40px 20px',
        color: 'var(--v-text-muted)',
      }}
    >
      {icon && <div style={{ display: 'grid', placeItems: 'center', marginBottom: 12 }}>{icon}</div>}
      <div style={{ color: 'var(--v-text)', fontSize: 15, fontWeight: 600 }}>{title}</div>
      {hint && <p style={{ marginTop: 6, fontSize: 13 }}>{hint}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 40,
        color: 'var(--v-text-muted)',
      }}
    >
      <Loader2 size={18} className="v-spin" aria-hidden="true" />
      <span style={{ fontSize: 14 }}>{label}…</span>
      <style jsx>{`
        .v-spin {
          animation: v-spin 0.9s linear infinite;
        }
        @keyframes v-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="v-badge critical"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 14px',
        fontSize: 13,
        borderRadius: 10,
        marginBottom: 16,
        width: '100%',
      }}
    >
      <AlertTriangle size={16} aria-hidden="true" />
      {message}
    </div>
  );
}

const RISK_STATE_BADGES: Record<string, { cls: string; label: string }> = {
  NORMAL: { cls: 'success', label: 'Stable' },
  WATCH: { cls: 'info', label: 'Watch' },
  WARNING: { cls: 'warning', label: 'Warning' },
  CRITICAL: { cls: 'critical', label: 'Critical' },
};

const UNKNOWN_RISK_STATE = { cls: 'info', label: 'Unknown' } as const;

/**
 * Renders a risk state. The backend normalizes every predictor's output to the
 * four canonical states (see apps/api/app/ml.py `canonical_state`), but this
 * accepts an arbitrary string and falls back to "Unknown" rather than
 * crashing: an unrecognized value is a backend/config problem, and a
 * clinician's dashboard must not white-screen because of one.
 */
export function StateBadge({ state }: { state?: string | null }) {
  const s = (state && RISK_STATE_BADGES[state]) || UNKNOWN_RISK_STATE;
  return <span className={`v-badge ${s.cls} v-badge-dot`}>{s.label}</span>;
}

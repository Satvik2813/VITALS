'use client';
import { useState } from 'react';
import { Bell, Check, CheckCheck, ShieldCheck, Sparkles } from 'lucide-react';
import type { Patient, Snapshot, VitalKey } from '../lib/types';
import { Badge, Conflict, time } from './shared';
import { TrendChart } from './charts';
import { DocumentGateway } from './documents';
const vitalInfo: { key: VitalKey; label: string; unit: string }[] = [
  { key: 'spo2', label: 'SpO₂', unit: '%' },
  { key: 'heart_rate', label: 'Heart rate', unit: 'bpm' },
  { key: 'respiratory_rate', label: 'Respiration', unit: '/min' },
  { key: 'temperature', label: 'Temperature', unit: '°C' },
  { key: 'systolic_bp', label: 'Systolic BP', unit: 'mmHg' },
];
const labels: Record<string, string> = {
  spo2: 'SpO₂',
  heart_rate: 'Pulse',
  respiratory_rate: 'Respiration',
  temperature: 'Temp.',
  systolic_bp: 'BP',
  oxygen: 'Oxygen',
  consciousness: 'ACVPU',
};
export function PatientDetail({
  patient,
  data,
  refresh,
  notify,
  acknowledge,
}: {
  patient: Patient;
  data: Snapshot;
  refresh: () => Promise<void>;
  notify: (text: string) => void;
  acknowledge: (id: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<'overview' | 'documents' | 'alerts'>('overview');
  const [vital, setVital] = useState<VitalKey>('spo2');
  const alerts = data.alerts.filter((a) => a.patient_id === patient.id);
  return (
    <section className={`panel patient-detail ${patient.risk.state === 'CRITICAL' ? 'critical-detail' : ''}`}>
      <div className="detail-header">
        <div>
          <div className="eyebrow">
            PATIENT FOCUS <span>· {patient.room}</span>
          </div>
          <h2>
            {patient.name} <Badge state={patient.risk.state} />
          </h2>
          <p>
            {patient.age} years · {patient.sex === 'M' ? 'Male' : 'Female'} · {patient.condition}
          </p>
        </div>
        <div className="news-total">
          <span>NEWS2</span>
          <strong>{patient.risk.news2_score}</strong>
          <small>Scale 1</small>
        </div>
      </div>
      <div className="detail-tabs" role="tablist" aria-label="Patient details">
        {(
          [
            { id: 'overview', name: 'Clinical overview' },
            { id: 'documents', name: `Documents (${patient.documents.length})` },
            { id: 'alerts', name: `Alerts (${alerts.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={tab === t.id ? 'active' : ''}
          >
            {t.name}
          </button>
        ))}
      </div>
      {patient.trust_conflict && <Conflict patient={patient} />}
      {tab === 'overview' && (
        <div className="detail-content">
          <div className="vitals-grid">
            {vitalInfo.map((v) => (
              <button
                key={v.key}
                className={`vital-tile ${vital === v.key ? 'chosen' : ''}`}
                onClick={() => setVital(v.key)}
              >
                <span>{v.label}</span>
                <strong className={patient.risk.components[v.key] >= 3 ? 'red-text' : ''}>
                  {patient.vitals[v.key]}
                  <small>{v.unit}</small>
                </strong>
                <span className="vital-baseline">Baseline {patient.risk.baseline[v.key].value}</span>
              </button>
            ))}
          </div>
          <div className="trend-heading">
            <h3>{vitalInfo.find((v) => v.key === vital)?.label} trend</h3>
            <span>
              <i className="baseline-dash" />
              Personal baseline · last 30 min
            </span>
          </div>
          <TrendChart patient={patient} vital={vital} />
          <div className="reasoning">
            <div className="reasoning-title">
              <span className="reason-icon">
                <Sparkles size={16} />
              </span>
              <h3>
                {patient.risk.state === 'NORMAL'
                  ? patient.risk.factors.length
                    ? 'Transient change under observation'
                    : 'Within the current observation range'
                  : 'Why this patient needs attention'}
              </h3>
              <span>DETERMINISTIC</span>
            </div>
            {patient.risk.factors.length ? (
              <ul>
                {patient.risk.factors.slice(0, 5).map((f, i) => (
                  <li key={`${f.kind}-${i}`}>
                    <span className={`factor-dot ${f.kind}`} />
                    {f.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No NEWS2 points or sustained personal-baseline deviations in this observation.</p>
            )}
            {patient.risk.factors.length > 5 && (
              <details>
                <summary>{patient.risk.factors.length - 5} more contributing factors</summary>
                <ul>
                  {patient.risk.factors.slice(5).map((f, i) => (
                    <li key={i}>{f.text}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <div className="news-breakdown">
            <div className="trend-heading">
              <h3>NEWS2 contribution</h3>
              <span>
                {patient.vitals.consciousness === 'A' ? 'Alert' : patient.vitals.consciousness} ·{' '}
                {patient.vitals.supplemental_oxygen ? 'supplemental oxygen' : 'room air'} · Scale 1
              </span>
            </div>
            <div className="component-grid">
              {Object.entries(patient.risk.components).map(([key, value]) => (
                <div key={key}>
                  <span>{labels[key]}</span>
                  <b className={value >= 3 ? 'points-red' : value ? 'points-amber' : ''}>{value}</b>
                </div>
              ))}
            </div>
          </div>
          <div className="detail-foot">
            <ShieldCheck size={14} />
            {patient.risk.rule} ·{' '}
            {patient.risk.baseline_ready ? 'Personal baseline established' : 'Baseline warming up'}
          </div>
        </div>
      )}
      {tab === 'documents' && <DocumentGateway patient={patient} refresh={refresh} notify={notify} />}
      {tab === 'alerts' && (
        <div className="alert-list">
          {alerts.length ? (
            alerts.map((a) => (
              <div className="alert-item" key={a.id}>
                <div>
                  <Badge state={a.severity} />
                  <span className="quiet-label">{time(a.created_at)}</span>
                </div>
                <strong>
                  NEWS2 {a.payload.news2_score} · {a.payload.rule}
                </strong>
                <p>
                  {a.payload.factors
                    .slice(0, 2)
                    .map((f) => f.text)
                    .join(' ')}
                </p>
                <button
                  className="secondary-button"
                  disabled={!!a.acknowledged_at}
                  onClick={() => acknowledge(a.id)}
                >
                  {a.acknowledged_at ? (
                    <>
                      <CheckCheck size={15} />
                      Acknowledged
                    </>
                  ) : (
                    <>
                      <Check size={15} />
                      Acknowledge
                    </>
                  )}
                </button>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <Bell size={28} />
              <h3>No attention events</h3>
              <p>Sustained changes will appear here with their contributing factors.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export type State = 'NORMAL' | 'WATCH' | 'WARNING' | 'CRITICAL';
export type VitalKey = 'heart_rate' | 'spo2' | 'respiratory_rate' | 'temperature' | 'systolic_bp';
export type Vitals = Record<VitalKey, number> & {
  timestamp: string;
  consciousness: string;
  supplemental_oxygen: boolean;
};
export type Factor = { kind: string; text: string; vital?: string };
export type Risk = {
  state: State;
  news2_score: number;
  components: Record<string, number>;
  factors: Factor[];
  baseline: Record<VitalKey, { value: number; spread: number; z: number; samples: number }>;
  rule: string;
  baseline_ready: boolean;
};
export type ClinicalFact = {
  fact_type: string;
  value: number;
  trust_status: string;
  provenance: { page: number; line: number; unit: string; document_id: string };
};
export type Document = {
  id: string;
  patient_id: string;
  filename: string;
  uploaded_at: string;
  sha256: string;
  scan: {
    verdict: 'TRUSTED' | 'SUSPICIOUS' | 'MALICIOUS';
    quarantined: boolean;
    signals: { code: string; severity: string; reason: string; excerpt: string }[];
  };
  facts: ClinicalFact[];
};
export type Patient = {
  id: string;
  name: string;
  age: number;
  sex: string;
  condition: string;
  room: string;
  initials: string;
  vitals: Vitals;
  risk: Risk;
  history: Vitals[];
  trust_conflict: boolean;
  documents: Document[];
  context: { screened_historical_facts: ClinicalFact[]; excluded_documents: number; policy: string };
};
export type Alert = {
  id: string;
  patient_id: string;
  severity: State;
  created_at: string;
  acknowledged_at: string | null;
  payload: Risk;
};
export type AuditEvent = {
  id: string;
  patient_id: string | null;
  event_type: string;
  created_at: string;
  actor: string;
  details: {
    message: string;
    document_id?: string;
    sha256?: string;
    state_before?: string;
    state_after?: string;
  };
};
export type Metrics = {
  raw_threshold_alerts: number;
  naive_alerting_samples: number;
  actionable_alerts: number;
  reduction_pct: number;
  samples: number;
  known_episodes: number;
  episodes_detected: number;
  detection_delay_minutes: number | null;
  false_positive_events: number;
  processing_p95_ms: number;
  history: { minute: number; naive: number; vitalis: number }[];
};
export type Snapshot = {
  patients: Patient[];
  documents: Document[];
  alerts: Alert[];
  audit: AuditEvent[];
  metrics: Metrics;
  demo: {
    run_id: string;
    minute: number;
    playing: boolean;
    deteriorating: boolean;
    last_ingested_at: string;
    storage: string;
    error: string | null;
  };
};

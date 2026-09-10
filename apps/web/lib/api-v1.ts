/**
 * VITALIS v1 API client — thin wrapper around fetch that forwards through the
 * /api/v1/[...path] Next route (which injects the Supabase JWT). All calls are
 * relative so they work in both server and client components.
 */

export type Role = 'doctor' | 'patient' | 'admin';

export type Me = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: Role | null;
  onboarding_completed: boolean;
  phone: string | null;
  specialization: string | null;
  hospital: string | null;
};

export type Patient = {
  id: string;
  owner_id: string;
  user_id: string | null;
  full_name: string;
  mrn: string | null;
  date_of_birth: string | null;
  sex: string | null;
  notes: string | null;
  phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  created_at: string;
  updated_at: string;
};

export type DoctorSummary = {
  id: string;
  full_name: string | null;
  specialization: string | null;
  hospital: string | null;
};

export type Vitals = {
  id: string;
  patient_id: string;
  recorded_at: string;
  heart_rate: number | null;
  spo2: number | null;
  respiratory_rate: number | null;
  temperature_c: number | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  consciousness: string | null;
  supplemental_oxygen: boolean | null;
  source: string | null;
  device_id: string | null;
  created_at: string;
};

export type Alert = {
  id: string;
  patient_id: string;
  severity: 'info' | 'warning' | 'critical';
  kind: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
};

export type Risk = {
  id: string;
  patient_id: string;
  vitals_id: string | null;
  model_version: string;
  score: number;
  state: 'NORMAL' | 'WATCH' | 'WARNING' | 'CRITICAL';
  is_mock: boolean;
  features: Record<string, unknown>;
  created_at: string;
};

export type History = {
  patient: Patient;
  vitals: Vitals[];
  alerts: Alert[];
  risk: Risk[];
};

export type DocumentScan = {
  id: string;
  patient_id: string;
  filename: string;
  sha256: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_at: string;
  scan_verdict: 'TRUSTED' | 'SUSPICIOUS' | 'MALICIOUS' | null;
  scan_payload: {
    verdict?: string;
    signals?: { code: string; severity: string; reason: string; excerpt?: string }[];
    quarantined?: boolean;
    extracted_facts?: { fact_type: string; value: number; trust_status: string }[];
  };
};

export type BridgeDevice = {
  id: string;
  device_id: string;
  device_name: string | null;
  paired_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export type BridgeCode = {
  bridge_code: string;
  created_at: string;
  rotated_at: string | null;
  devices: BridgeDevice[];
};

export type PatientOnboardingInput = {
  full_name: string;
  date_of_birth?: string | null;
  sex?: string | null;
  phone?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  assigned_doctor_id: string;
  consent_accepted: boolean;
};

export type DoctorOnboardingInput = {
  full_name: string;
  phone?: string | null;
  specialization?: string | null;
  hospital?: string | null;
  medical_registration?: string | null;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/${path.replace(/^\//, '')}`, {
    cache: 'no-store',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, (data && (data.detail as string)) || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  me: () => req<Me>('me'),
  doctors: {
    list: () => req<DoctorSummary[]>('doctors'),
  },
  onboarding: {
    patient: (body: PatientOnboardingInput) =>
      req<Patient>('onboarding/patient', { method: 'POST', body: JSON.stringify(body) }),
    doctor: (body: DoctorOnboardingInput) =>
      req<Me>('onboarding/doctor', { method: 'POST', body: JSON.stringify(body) }),
  },
  bridge: {
    // The patient's own permanent VITALIS Bridge Code, minted on first read.
    // 404 is the normal answer for anyone without a patient record of their
    // own (a doctor, say), so callers treat it as "not applicable", not an
    // error. The Android app never touches these routes -- it pairs with the
    // code through /api/bridge/pair. See docs/BRIDGE.md.
    code: () => req<BridgeCode>('bridge/code'),
    regenerate: () => req<BridgeCode>('bridge/code/regenerate', { method: 'POST' }),
    revokeDevice: (deviceId: string) =>
      req<void>(`bridge/devices/${deviceId}`, { method: 'DELETE' }),
  },
  patients: {
    list: () => req<Patient[]>('patients'),
    create: (body: Partial<Patient> & { full_name: string }) =>
      req<Patient>('patients', { method: 'POST', body: JSON.stringify(body) }),
    get: (id: string) => req<Patient>(`patients/${id}`),
    update: (id: string, body: Partial<Pick<Patient, 'phone' | 'emergency_contact_name' | 'emergency_contact_phone'>>) =>
      req<Patient>(`patients/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    history: (id: string, limit = 100) =>
      req<History>(`patients/${id}/history?limit=${limit}`),
    vitals: (id: string, limit = 100) =>
      req<Vitals[]>(`patients/${id}/vitals?limit=${limit}`),
    ingestVitals: (id: string, body: Partial<Vitals>) =>
      req<Vitals>(`patients/${id}/vitals`, { method: 'POST', body: JSON.stringify(body) }),
    alerts: (id: string, openOnly = false) =>
      req<Alert[]>(`patients/${id}/alerts${openOnly ? '?open_only=true' : ''}`),
    ackAlert: (patientId: string, alertId: string) =>
      req<Alert>(`patients/${patientId}/alerts/${alertId}/acknowledge`, { method: 'POST' }),
    documents: (id: string) => req<DocumentScan[]>(`patients/${id}/documents`),
    uploadDocument: async (id: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/v1/patients/${id}/documents`, {
        method: 'POST',
        cache: 'no-store',
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(res.status, (data && (data.detail as string)) || `Request failed (${res.status})`);
      }
      return (await res.json()) as DocumentScan;
    },
  },
};

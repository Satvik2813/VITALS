-- VITALIS auth platform: doctor-owned patients, vitals, alerts, risk, documents, audit.
-- Namespaced `app_*` to coexist with the existing single-clinician demo schema.
-- Every table: authenticated-only, RLS on, deny-by-default. Service role bypasses RLS.
--
-- Access model:
--   * A `app_profile` row is created for every auth.users id (id = auth.users.id).
--   * A patient is owned by exactly one doctor (app_patients.owner_id).
--   * Additional doctors may be granted access via app_doctor_patients rows.
--   * All patient-scoped tables (vitals, alerts, risk, documents, audit) are
--     readable/writable only by doctors with access to the parent patient.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles (mirror of auth.users, augmented with app-level fields).
-- ---------------------------------------------------------------------------
CREATE TABLE public.app_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'doctor' CHECK (role IN ('doctor', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX app_profiles_email ON public.app_profiles (email);

-- ---------------------------------------------------------------------------
-- Patients owned by a doctor.
-- ---------------------------------------------------------------------------
CREATE TABLE public.app_patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES public.app_profiles (id) ON DELETE RESTRICT,
    mrn TEXT,
    full_name TEXT NOT NULL,
    date_of_birth DATE,
    sex TEXT CHECK (sex IN ('female', 'male', 'other', 'unknown')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_id, mrn)
);

CREATE INDEX app_patients_owner ON public.app_patients (owner_id);

-- Optional cross-doctor sharing.
CREATE TABLE public.app_doctor_patients (
    doctor_id UUID NOT NULL REFERENCES public.app_profiles (id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.app_patients (id) ON DELETE CASCADE,
    granted_by UUID REFERENCES public.app_profiles (id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (doctor_id, patient_id)
);

CREATE INDEX app_doctor_patients_patient ON public.app_doctor_patients (patient_id);

-- Helper: does the current auth.uid() have access to a given patient?
CREATE OR REPLACE FUNCTION public.app_has_patient_access(target UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.app_patients p
        WHERE p.id = target AND p.owner_id = auth.uid()
    ) OR EXISTS (
        SELECT 1 FROM public.app_doctor_patients dp
        WHERE dp.patient_id = target AND dp.doctor_id = auth.uid()
    );
$$;

-- ---------------------------------------------------------------------------
-- Vitals (one row per measurement, per-metric columns).
-- ---------------------------------------------------------------------------
CREATE TABLE public.app_vitals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.app_patients (id) ON DELETE CASCADE,
    recorded_at TIMESTAMPTZ NOT NULL,
    heart_rate INT CHECK (heart_rate BETWEEN 20 AND 250),
    spo2 INT CHECK (spo2 BETWEEN 50 AND 100),
    respiratory_rate INT CHECK (respiratory_rate BETWEEN 4 AND 60),
    temperature_c NUMERIC(4,1) CHECK (temperature_c BETWEEN 30 AND 43),
    systolic_bp INT CHECK (systolic_bp BETWEEN 50 AND 260),
    diastolic_bp INT CHECK (diastolic_bp BETWEEN 20 AND 200),
    consciousness TEXT CHECK (consciousness IN ('A', 'C', 'V', 'P', 'U')),
    supplemental_oxygen BOOLEAN,
    source TEXT,
    device_id TEXT,
    created_by UUID REFERENCES public.app_profiles (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX app_vitals_patient_time ON public.app_vitals (patient_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Alerts.
-- ---------------------------------------------------------------------------
CREATE TABLE public.app_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.app_patients (id) ON DELETE CASCADE,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'watch', 'warning', 'critical')),
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES public.app_profiles (id)
);

CREATE INDEX app_alerts_patient_time ON public.app_alerts (patient_id, created_at DESC);
CREATE INDEX app_alerts_open ON public.app_alerts (patient_id) WHERE acknowledged_at IS NULL;

-- ---------------------------------------------------------------------------
-- Risk assessments (populated by ML service or mock).
-- ---------------------------------------------------------------------------
CREATE TABLE public.app_risk_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.app_patients (id) ON DELETE CASCADE,
    vitals_id UUID REFERENCES public.app_vitals (id) ON DELETE SET NULL,
    model_version TEXT NOT NULL,
    score NUMERIC NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('NORMAL', 'WATCH', 'WARNING', 'CRITICAL')),
    features JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX app_risk_patient_time ON public.app_risk_assessments (patient_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Documents.
-- ---------------------------------------------------------------------------
CREATE TABLE public.app_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.app_patients (id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    size_bytes INT NOT NULL,
    uploaded_by UUID REFERENCES public.app_profiles (id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    scan_verdict TEXT CHECK (scan_verdict IN ('CLEAN', 'SUSPICIOUS', 'MALICIOUS', 'PENDING')),
    scan_payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX app_documents_patient ON public.app_documents (patient_id, uploaded_at DESC);

-- ---------------------------------------------------------------------------
-- Audit events.
-- ---------------------------------------------------------------------------
CREATE TABLE public.app_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.app_profiles (id),
    patient_id UUID REFERENCES public.app_patients (id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX app_audit_actor_time ON public.app_audit_events (actor_id, created_at DESC);
CREATE INDEX app_audit_patient_time ON public.app_audit_events (patient_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Auto-provision a profile on signup.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.app_profiles (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
        NEW.raw_user_meta_data ->> 'avatar_url'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_on_auth_user_created ON auth.users;
CREATE TRIGGER app_on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.app_handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security.
-- Deny-by-default, then grant per-role policies. Service role bypasses RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_doctor_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_vitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
    public.app_profiles,
    public.app_patients,
    public.app_doctor_patients,
    public.app_vitals,
    public.app_alerts,
    public.app_risk_assessments,
    public.app_documents,
    public.app_audit_events
    FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.app_profiles,
    public.app_patients,
    public.app_doctor_patients,
    public.app_vitals,
    public.app_alerts,
    public.app_risk_assessments,
    public.app_documents,
    public.app_audit_events
    TO authenticated;

-- Profiles: user reads/updates own; admins read all.
CREATE POLICY app_profiles_self_read ON public.app_profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid());

CREATE POLICY app_profiles_self_update ON public.app_profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- Patients: owner or shared doctor.
CREATE POLICY app_patients_read ON public.app_patients
    FOR SELECT TO authenticated
    USING (owner_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.app_doctor_patients dp
        WHERE dp.patient_id = id AND dp.doctor_id = auth.uid()
    ));

CREATE POLICY app_patients_insert ON public.app_patients
    FOR INSERT TO authenticated
    WITH CHECK (owner_id = auth.uid());

CREATE POLICY app_patients_owner_write ON public.app_patients
    FOR UPDATE TO authenticated
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

CREATE POLICY app_patients_owner_delete ON public.app_patients
    FOR DELETE TO authenticated
    USING (owner_id = auth.uid());

-- Doctor-patient grants: patient owner manages; grantee sees own grants.
CREATE POLICY app_doctor_patients_read ON public.app_doctor_patients
    FOR SELECT TO authenticated
    USING (doctor_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.app_patients p
        WHERE p.id = patient_id AND p.owner_id = auth.uid()
    ));

CREATE POLICY app_doctor_patients_write ON public.app_doctor_patients
    FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.app_patients p
        WHERE p.id = patient_id AND p.owner_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.app_patients p
        WHERE p.id = patient_id AND p.owner_id = auth.uid()
    ));

-- Vitals / alerts / risk / documents / audit: access follows patient access.
CREATE POLICY app_vitals_rw ON public.app_vitals
    FOR ALL TO authenticated
    USING (public.app_has_patient_access(patient_id))
    WITH CHECK (public.app_has_patient_access(patient_id));

CREATE POLICY app_alerts_rw ON public.app_alerts
    FOR ALL TO authenticated
    USING (public.app_has_patient_access(patient_id))
    WITH CHECK (public.app_has_patient_access(patient_id));

CREATE POLICY app_risk_rw ON public.app_risk_assessments
    FOR ALL TO authenticated
    USING (public.app_has_patient_access(patient_id))
    WITH CHECK (public.app_has_patient_access(patient_id));

CREATE POLICY app_documents_rw ON public.app_documents
    FOR ALL TO authenticated
    USING (public.app_has_patient_access(patient_id))
    WITH CHECK (public.app_has_patient_access(patient_id));

CREATE POLICY app_audit_read ON public.app_audit_events
    FOR SELECT TO authenticated
    USING (
        actor_id = auth.uid() OR
        (patient_id IS NOT NULL AND public.app_has_patient_access(patient_id))
    );

-- Audit rows are inserted by the service role only (backend writes).
-- No INSERT/UPDATE/DELETE policy for `authenticated` intentionally.

COMMIT;

-- VITALIS: private backend access only; no browser grants.
BEGIN;

CREATE TABLE demo_runs (
	id VARCHAR NOT NULL, 
	created_at VARCHAR NOT NULL, 
	active BOOLEAN NOT NULL, 
	checkpoint JSONB NOT NULL, 
	PRIMARY KEY (id)
);

ALTER TABLE public.demo_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.demo_runs FROM anon, authenticated;

CREATE TABLE patients (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	profile JSONB NOT NULL, 
	PRIMARY KEY (id)
);

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.patients FROM anon, authenticated;

CREATE TABLE alerts (
	id VARCHAR NOT NULL, 
	run_id VARCHAR NOT NULL, 
	patient_id VARCHAR NOT NULL, 
	severity VARCHAR NOT NULL, 
	created_at VARCHAR NOT NULL, 
	acknowledged_at VARCHAR, 
	payload JSONB NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(run_id) REFERENCES demo_runs (id), 
	FOREIGN KEY(patient_id) REFERENCES patients (id)
);

CREATE INDEX alerts_run_patient ON alerts (run_id, patient_id);

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.alerts FROM anon, authenticated;

CREATE TABLE audit_events (
	id VARCHAR NOT NULL, 
	run_id VARCHAR NOT NULL, 
	patient_id VARCHAR, 
	event_type VARCHAR NOT NULL, 
	actor VARCHAR NOT NULL, 
	created_at VARCHAR NOT NULL, 
	details JSONB NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(run_id) REFERENCES demo_runs (id), 
	FOREIGN KEY(patient_id) REFERENCES patients (id)
);

CREATE INDEX audit_run_time ON audit_events (run_id, created_at);

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.audit_events FROM anon, authenticated;

CREATE TABLE documents (
	id VARCHAR NOT NULL, 
	run_id VARCHAR NOT NULL, 
	patient_id VARCHAR NOT NULL, 
	filename VARCHAR NOT NULL, 
	storage_path VARCHAR NOT NULL, 
	sha256 VARCHAR NOT NULL, 
	uploaded_at VARCHAR NOT NULL, 
	size_bytes INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(run_id) REFERENCES demo_runs (id), 
	FOREIGN KEY(patient_id) REFERENCES patients (id)
);

CREATE INDEX documents_patient ON documents (run_id, patient_id);

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.documents FROM anon, authenticated;

CREATE TABLE patient_baselines (
	id VARCHAR NOT NULL, 
	run_id VARCHAR NOT NULL, 
	patient_id VARCHAR NOT NULL, 
	payload JSONB NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(run_id) REFERENCES demo_runs (id), 
	FOREIGN KEY(patient_id) REFERENCES patients (id)
);

CREATE INDEX baselines_run_patient ON patient_baselines (run_id, patient_id);

ALTER TABLE public.patient_baselines ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.patient_baselines FROM anon, authenticated;

CREATE TABLE vitals_readings (
	id VARCHAR NOT NULL, 
	run_id VARCHAR NOT NULL, 
	patient_id VARCHAR NOT NULL, 
	timestamp VARCHAR NOT NULL, 
	payload JSONB NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(run_id) REFERENCES demo_runs (id), 
	FOREIGN KEY(patient_id) REFERENCES patients (id)
);

CREATE UNIQUE INDEX vitals_patient_time ON vitals_readings (run_id, patient_id, timestamp);

ALTER TABLE public.vitals_readings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.vitals_readings FROM anon, authenticated;

CREATE TABLE document_raw_text (
	document_id VARCHAR NOT NULL, 
	text TEXT NOT NULL, 
	PRIMARY KEY (document_id), 
	FOREIGN KEY(document_id) REFERENCES documents (id)
);

ALTER TABLE public.document_raw_text ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.document_raw_text FROM anon, authenticated;

CREATE TABLE document_scans (
	document_id VARCHAR NOT NULL, 
	verdict VARCHAR NOT NULL, 
	payload JSONB NOT NULL, 
	scanned_at VARCHAR NOT NULL, 
	PRIMARY KEY (document_id), 
	FOREIGN KEY(document_id) REFERENCES documents (id)
);

ALTER TABLE public.document_scans ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.document_scans FROM anon, authenticated;

CREATE TABLE extracted_clinical_facts (
	id VARCHAR NOT NULL, 
	document_id VARCHAR NOT NULL, 
	fact_type VARCHAR NOT NULL, 
	value FLOAT NOT NULL, 
	trust_status VARCHAR NOT NULL, 
	provenance JSONB NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(document_id) REFERENCES documents (id)
);

CREATE INDEX facts_document ON extracted_clinical_facts (document_id);

ALTER TABLE public.extracted_clinical_facts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.extracted_clinical_facts FROM anon, authenticated;

CREATE TABLE risk_assessments (
	id VARCHAR NOT NULL, 
	reading_id VARCHAR NOT NULL, 
	news2_score INTEGER NOT NULL, 
	attention_state VARCHAR NOT NULL, 
	payload JSONB NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(reading_id) REFERENCES vitals_readings (id)
);

CREATE INDEX risk_reading ON risk_assessments (reading_id);

ALTER TABLE public.risk_assessments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.risk_assessments FROM anon, authenticated;

CREATE UNIQUE INDEX one_active_demo_run ON public.demo_runs (active) WHERE active = true;

-- No permissive RLS policies: anon/authenticated cannot access any rows.

-- Backend uses a server-only PostgreSQL connection; never put credentials in NEXT_PUBLIC_.

COMMIT;

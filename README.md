# VITALIS

**Integrated Healthcare AI Platform: Remote Patient Monitoring, Wearable Ingestion & Zero-Trust Clinical Intelligence**

VITALIS is a doctor-centric healthcare AI platform designed to protect clinical workflows while delivering continuous, proactive patient monitoring. It pairs real-time wearable telemetry and medical record ingestion with trained machine-learning risk assessment, deterministic physiological safety floors (NEWS2), instant alerts, and zero-trust document security.

> **Disclaimer:** VITALIS is a hackathon prototype developed for clinical decision support evaluation. It is **not clinically validated** and is not certified for diagnosis, treatment planning, or direct patient care. No automated security control provides guaranteed protection against all possible adversarial manipulation or prompt-injection attacks.

---

## Architecture & Product Flow

```
                      [ Galaxy Watch / Health Connect ]
                                      │
                                      ▼
                        [ VITALIS-Bridge Android App ]
                         (Separate Native Repository)
                                      │
                                      │  HTTPS: POST /api/bridge/vitals
                                      ▼
                     ┌───────────────────────────────────┐
                     │     Next.js Web Proxy (Vercel)    │
                     │          apps/web                │
                     └─────────────────┬─────────────────┘
                                       │  Reverse Proxy
                                       ▼
                     ┌───────────────────────────────────┐
                     │       FastAPI Backend Service     │
                     │          apps/api                │
                     └─────────┬───────────────────┬─────┘
                               │                   │
                     SQL / RLS │                   │ 16 Features
                               ▼                   ▼
                     ┌───────────────────┐       ┌────────────────────────┐
                     │ Supabase Postgres │       │     VITALIS_ENGINE     │
                     │   (app_* tables)  │       │ Calibrated XGBoost ML  │
                     └─────────┬─────────┘       └───────────┬────────────┘
                               │                             │
                               │   Postgres Realtime Pub     │ Canonical State
                               │ ◄───────────────────────────┘ + NEWS2 Floor
                               ▼
               ┌───────────────────────────────┐
               │    Realtime Alert Dispatch    │
               │         (app_alerts)          │
               └───────┬───────────────┬───────┘
                       │               │
                       ▼               ▼
             ┌──────────────────┐    ┌──────────────────┐
             │  Doctor Portal   │    │  Patient Portal  │
             │   /app/doctor    │    │   /app/patient   │
             └──────────────────┘    └──────────────────┘
```

### Document Security Gateway Flow

Medical records, referral summaries, and lab reports submitted through the document gateway undergo zero-trust isolation:

```
Medical Document (PDF / UTF-8)
  │
  ▼
Gatekeeper Subprocess & Parser Sandbox (Size, structure, invisible text, font anomalies)
  │
  ▼
Adversarial & Prompt-Injection Analyzer (Hidden instructions, goal hijacking, tone shifts)
  │
  ▼
Scan Verdict Assigned: [ TRUSTED | CLEAN | SUSPICIOUS | MALICIOUS | PENDING ]
  │
  ├──► MALICIOUS / SUSPICIOUS: Quarantined, SHA-256 locked, isolated from AI context
  └──► TRUSTED / CLEAN: Structured numeric facts extracted with provenance metadata
        (Clinical alerts and NEWS2 scoring remain unpoisoned and strictly preserved)
```

---

## Authentication & Role-Based Access Control

Authentication is managed through **Supabase Auth** backed by **Google OAuth** (PKCE authorization code flow with secure HTTP-only cookies).

- **First-Class Roles:** Users register and onboard as either a `doctor` (clinician command center) or a `patient` (personal health portal).
- **Onboarding Pipelines:**
  - `/onboarding/doctor`: Clinician registration, license/specialty profile setup.
  - `/onboarding/patient`: Patient demographic intake, assignment to an onboarded doctor.
- **Server-Authoritative Routing:**
  - `/login` — Google OAuth authentication entry point.
  - `/get-started` — Role-selection hub for authenticated profiles awaiting onboarding.
  - `/auth/callback` — Validates PKCE tokens and sanitizes return paths via `safeNext`.
  - `/app` — Server-side router inspecting verified `GET /api/v1/me` claims to route users directly to `/app/doctor` or `/app/patient`.
- **Cross-Role Protection:** Server-side route layouts (`DoctorLayout` and `PatientLayout`) perform positive role checks on every request. Patients attempting to access `/app/doctor/**` are redirected to `/app/patient`, and clinicians attempting to access `/app/patient/**` are routed back to the doctor portal.

---

## Backend API Surface

The backend is built on **FastAPI** (`apps/api`) with token-based authorization and strict schema validation:

- **Auth & Identity:**
  - `GET /api/v1/me` — Hydrates profile, active role, and onboarding completion state.
  - `GET /api/v1/doctors` — Directory of active, onboarded clinicians available for patient assignment.
  - `POST /api/v1/onboarding/doctor` & `POST /api/v1/onboarding/patient` — Profile finalization.
- **Patient Management & Clinical Data:**
  - `GET /api/v1/patients` & `POST /api/v1/patients` — Clinician patient management.
  - `GET /api/v1/patients/{id}/vitals` & `POST /api/v1/patients/{id}/vitals` — Vitals ingestion and trend retrieval.
  - `GET /api/v1/patients/{id}/alerts` & `POST /api/v1/patients/{id}/alerts/{alert_id}/acknowledge` — Alert queue management.
  - `GET /api/v1/patients/{id}/history` — Unified audit and physiological history.
  - `POST /api/v1/ml/predict` — Direct feature scoring endpoint.
- **Zero-Trust Document Gateway:**
  - `GET /api/v1/patients/{id}/documents` — List documents with security scan verdicts.
  - `POST /api/v1/patients/{id}/documents` — Upload, scan, and quarantine medical files (PDF/TXT ≤ 5 MB).
- **Bridge Device Endpoints:**
  - `POST /api/bridge/pair` (`/api/v1/bridge/pair`) — Exchange pairing code for scoped device credentials.
  - `GET /api/bridge/session` (`/api/v1/bridge/session`) — Verify device session validity and linked patient identity.
  - `POST /api/bridge/vitals` (`/api/v1/bridge/vitals`) — Ingest wearable telemetry into the core risk pipeline.
  - `POST /api/bridge/unpair` (`/api/v1/bridge/unpair`) — Revoke device credentials.
- **Security & Operational Controls:**
  - JWKS validation: Verifies Supabase ES256/RS256 JWTs with issuer, audience, and expiration constraints.
  - Client rate limiting: Enforced per-client using `VITALIS_PROXY_SECRET` constant-time header verification behind reverse proxies.
  - `/health`: Liveness and ML status endpoint returning HTTP 200 with runtime engine diagnostic metadata.

---

## Database & Supabase Integration

Persistence is built on PostgreSQL utilizing Supabase with strict **Row Level Security (RLS)**:

- **Core Tables (`app_*`):**
  - `app_profiles` — User profile metadata mirrored from `auth.users`.
  - `app_patients` — Patient records with primary doctor ownership (`owner_id`).
  - `app_doctor_patients` — Explicit cross-doctor record-sharing permissions.
  - `app_vitals` — Granular physiological records protected by unique index `(patient_id, device_id, recorded_at)` for network retry deduplication.
  - `app_alerts` — Debounced alert records triggered by risk-state transitions.
  - `app_risk_assessments` — ML inference scores, canonical risk states, and raw feature payloads.
  - `app_documents` — Uploaded file metadata, SHA-256 hashes, and security scan verdicts (`TRUSTED`, `CLEAN`, `SUSPICIOUS`, `MALICIOUS`, `PENDING`).
  - `app_audit_events` — Immutable security and clinical audit trail.
  - `app_patient_bridge_codes` — Patient pairing codes stored as SHA-256 hashes, isolated from clinicians.
  - `app_bridge_devices` — Active paired Android device tokens (hashed) and revocation status.
- **Realtime Integration:** The `supabase_realtime` publication broadcasts inserts and updates from `app_vitals`, `app_alerts`, and `app_risk_assessments` directly to subscribed doctor and patient dashboards.
- **Migration History:** Fully aligned and validated through migration `20260910150000`:
  1. `20260909062337_vitalis_foundation.sql` (Legacy foundation)
  2. `20260909062424_auth_platform.sql` (`app_*` tables & doctor RLS)
  3. `20260909062507_harden_auth_platform_functions.sql` (Function security)
  4. `20260909071401_fix_rls_recursion_app_patients.sql` (Recursion prevention)
  5. `20260909110804_finalize_platform_security.sql` (Grant hardening)
  6. `20260909131446_patient_doctor_roles.sql` (Patient role & self-access)
  7. `20260909140000_enable_realtime.sql` (Realtime publication setup)
  8. `20260910090000_bridge_pairing.sql` (Bridge pairing & token storage)
  9. `20260910150000_document_verdict_and_vitals_dedupe.sql` (`TRUSTED` verdict & vitals dedupe index)

---

## Machine Learning & Risk Engine

VITALIS executes continuous risk scoring through a hybrid inference engine combining calibrated machine learning with deterministic clinical rules:

### 1. Shipped Trained Model (`VITALIS_ENGINE/`)

- **Architecture:** Calibrated XGBoost multiclass classifier (`CalibratedClassifierCV` using sigmoid calibration, version `1.0.0-prototype`), packaged in `vitalis_risk_model.joblib`.
- **16-Feature Schema:**
  - _14 Numeric Features:_ Heart rate, SpO2, systolic BP, diastolic BP, body temperature (°C), sleep duration (hours), sleep quality score, physical activity level, daily steps, resting heart rate, baseline systolic BP, baseline diastolic BP, age, stress level.
  - _2 Categorical Features:_ Gender, BMI category.
- **Model Target Classes:** Evaluates wearable and baseline vitals against five output states: `Stable`, `Watch`, `Moderate`, `High`, `Critical`.

### 2. Canonical Application State Mapping

The application and database contract expects four canonical states. `apps/api/app/ml.py` translates model predictions:

- `Stable` → `NORMAL`
- `Watch` → `WATCH`
- `Moderate` → `WARNING`
- `High` → `WARNING`
- `Critical` → `CRITICAL`
- _Unmapped/Unknown Fallback:_ Defaults conservatively to `WATCH` (flags for clinical review without generating false high-urgency alarms).

### 3. Deterministic Safety Floor (Hybrid Logic)

To prevent statistical ML models from ever suppressing acute physiological collapse:

- If calculated NEWS2-lite score $\ge 7$, final state is locked to **`CRITICAL`**, regardless of ML confidence.
- If NEWS2-lite score $\ge 5$ and the ML model predicts `NORMAL` or `WATCH`, final state escalates to **`WARNING`**.
- Raw model outputs, confidence metrics, and probability distributions are preserved in `app_risk_assessments.features`.

### 4. Mock & Fallback Behavior

- `TrainedRiskPredictor` is the active, production-default engine.
- `MockRiskPredictor` (deterministic NEWS2-lite rule) exists solely as a fallback if explicitly requested (`VITALIS_ML_PREDICTOR=mock`) or during local demo mode (`DEMO_MODE=true`) if the model file cannot be loaded.
- In production mode (`DEMO_MODE=false`), the backend refuses to degrade silently and will fail fast at startup if `VITALIS_ENGINE/` is missing or unloadable.

---

## VITALIS-Bridge Android Integration

The wearable capture application is maintained in a separate native Android repository (**VITALIS-Bridge**). It connects to VITALIS through standardized backend API contracts:

- **Separate Repository:** The Android client is developed, built, and versioned independently; this repository provides the authoritative backend ingestion endpoints.
- **Bridge Pairing Code (`VTL-XXXX-XXXX`):**
  - Each patient profile generates a permanent, high-entropy (2⁴⁰) Crockford Base32 pairing code (`VTL-` prefix) visible in their patient dashboard.
  - The Android app submits `bridge_code` and a persistent `device_id` via `POST /api/bridge/pair` to obtain a scoped `device_token` (`vtb_...`).
- **Telemetry Ingestion:**
  - The Android client transmits Health Connect / Galaxy Watch measurements to `POST /api/bridge/vitals` using bearer token authentication.
  - Ingested vitals run through the exact same deduplication, risk scoring, alert triggering, and realtime broadcast pipelines as clinician entries.
- **Revocation Safety:** Disconnecting a paired handset flags the device as revoked. The handset cannot re-pair using the permanent code until the patient explicitly regenerates their Bridge Code in the web UI.
- _Integration Note:_ End-to-end physical hardware validation with production Samsung Galaxy Watch / Health Connect devices is completed as a post-deployment operational milestone.

---

## Verification & Test Status

All test suites and automated gates pass on the `main` branch:

| Verification Suite             | Status | Details                                                                                                    |
| ------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------- |
| **TypeScript**                 | `PASS` | Strict compilation clean across `apps/web`                                                                 |
| **Next.js Production Build**   | `PASS` | Production bundle compiled successfully                                                                    |
| **Playwright E2E**             | `PASS` | **62 / 62 tests passing** (Auth routing, patient/doctor portals, cross-role protection, document security) |
| **Ruff Linter & Formatter**    | `PASS` | Zero lint violations or formatting errors across backend & scripts                                         |
| **Backend Pytest**             | `PASS` | **205 / 205 tests passing** (API v1, auth, bridge pairing, deduplication, ML integration, security)        |
| **RLS & Migration Validation** | `PASS` | Idempotent execution and strict deny-by-default policy checks verified                                     |
| **Backend Health Endpoint**    | `PASS` | `GET /health` returns HTTP 200 with `ml_status: "loaded"`, `ml_model_loaded: true`                         |
| **Bridge Endpoint Regression** | `PASS` | Pairing, session validation, retry deduplication, unpairing                                                |
| **Document Security Suite**    | `PASS` | Multi-vector prompt injection detection, parser limits, quarantine verification                            |
| **Supabase Realtime Suite**    | `PASS` | Live table event broadcast and channel subscription validation                                             |

---

## Local Development Setup

### Prerequisites

- **Node.js:** v22 or higher
- **Python:** 3.11 or higher
- **Package Managers:** `npm` and `pip`

### 1. Installation

Clone the repository and set up environment virtual environments:

```sh
# Set up Python virtual environment
python -m venv .venv

# Windows
.venv\Scripts\python -m pip install -r apps/api/requirements.txt

# macOS/Linux
.venv/bin/python -m pip install -r apps/api/requirements.txt

# Install Node dependencies
npm install

# Generate document testing fixtures
npm run fixtures
```

### 2. Running Locally

```sh
# Launch full stack (Next.js frontend + FastAPI backend concurrently)
npm run dev
```

- **Frontend Application:** `http://localhost:3000`
- **FastAPI Backend:** `http://127.0.0.1:8000`
- **API Documentation (Demo Mode):** `http://127.0.0.1:8000/docs`

_Credential Scope Note:_ Local development can execute in offline demo mode (`DEMO_MODE=true`) using local SQLite without cloud credentials. Running the full authenticated platform locally with Google OAuth requires configuring real Supabase credentials and `PLATFORM_DATABASE_URL` in `.env`.

### 3. Running Automated Tests

```sh
# Run backend pytest suite (205 tests)
npm test

# Run code style & linting checks
npm run lint

# Validate database RLS policies
npm run test:rls

# Run Playwright end-to-end tests (requires running frontend/backend)
npm run test:e2e
```

---

## Deployment Architecture

VITALIS is architected for production deployment across specialized infrastructure tiers:

- **Frontend (Web Tier):** Deployed on **Vercel** (`apps/web` root directory) as a Next.js 16 application handling SSR, authentication callbacks, and reverse-proxying API traffic.
- **Backend (API Tier):** Deployed on **Render** (or containerized host) running a persistent single-replica FastAPI container with `VITALIS_ENGINE/` packaged into the build image.
- **Database & Auth:** Hosted **Supabase** instance providing managed PostgreSQL, Google OAuth authentication, and Realtime websocket publications.

```
[ Browser / Android Client ]
             │
             │ HTTPS (Next.js Public Origin)
             ▼
   [ Vercel: apps/web ]
             │
             │ Private Proxy (API_TOKEN + VITALIS_PROXY_SECRET)
             ▼
   [ Render: apps/api ] ──► [ Supabase Postgres & Auth ]
             │
             ▼
    [ VITALIS_ENGINE ]
```

### Production Environment Variables

#### Backend (`apps/api`)

- `DEMO_MODE=false` — Disables unauthenticated bypasses, hides interactive API docs.
- `API_TOKEN` — Minimum 32-character shared secret for proxy communication.
- `PLATFORM_DATABASE_URL` — Production PostgreSQL connection string (`postgresql+psycopg://...`).
- `SUPABASE_URL` — Supabase project endpoint for JWKS verification.
- `VITALIS_PROXY_SECRET` — Shared secret enabling constant-time per-client rate limiting behind the proxy.
- `DATA_DIR` — Path to persistent volume for original document quarantine storage.

#### Frontend (`apps/web`)

- `BACKEND_URL` — Origin of the upstream FastAPI backend.
- `API_TOKEN` — Matching backend shared secret.
- `NEXT_PUBLIC_SUPABASE_URL` — Public Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Public Supabase anonymous client key.
- `NEXT_PUBLIC_SITE_URL` — Canonical public production domain.
- `VITALIS_PROXY_SECRET` — Matching proxy rate-limiting secret.

_Deployment Readiness Note:_ Deployment infrastructure is fully configured and ready; final cloud launch is executed upon target host provisioning and OAuth redirect binding.

---

## Legacy Synthetic Scenario (`/demo`)

The early single-clinician synthetic prompt-injection demonstration is preserved at `/demo`:

- **Purpose:** Acts as an offline presentation fallback, test-harness evaluation surface, and reviewer sandbox.
- **Isolation:** Operates independently against an in-memory/SQLite scenario simulator (`apps/api/app/simulation.py`).
- **Distinction:** The legacy demo does not represent the production authenticated platform (`/app/**`) or live wearable ingestion pipeline.

---

## Project Structure

```
VITALIS/
├── apps/
│   ├── api/                     # FastAPI backend
│   │   ├── app/
│   │   │   ├── api_v1/          # REST router (vitals, patients, documents, bridge)
│   │   │   ├── bridge.py        # Android pairing & token cryptography
│   │   │   ├── gateway.py       # Zero-trust document parser & injection scanner
│   │   │   ├── ml.py            # ML inference boundary & NEWS2 safety floor
│   │   │   └── security.py      # Rate limiting & token verification
│   │   └── tests/               # 205 passing backend unit/integration tests
│   └── web/                     # Next.js 16 frontend
│       ├── app/
│       │   ├── app/             # Role-protected Doctor & Patient dashboards
│       │   ├── auth/            # OAuth callbacks & session exchange
│       │   ├── demo/            # Legacy synthetic demonstration UI
│       │   ├── get-started/     # Neutral role picker for onboarding
│       │   ├── login/           # Google Sign-In interface
│       │   └── onboarding/      # Doctor and patient onboarding workflows
│       └── components/          # Reusable design system & clinical widgets
├── VITALIS_ENGINE/              # Shipped trained ML risk package
│   ├── class_names.json         # 5-class risk vocabulary
│   ├── vitalis_feature_schema.json # 16-feature input specification
│   ├── vitalis_inference.py     # Model loader & scoring routine
│   ├── vitalis_model_metadata.json # XGBoost model hyperparameters & metrics
│   └── vitalis_risk_model.joblib # Trained calibrated model artifact
├── supabase/
│   └── migrations/              # 9 sequential PostgreSQL migrations (RLS, Realtime)
├── scripts/                     # Local test runners, generators, and seed utilities
├── docs/                        # Technical specifications & architecture handoffs
└── tests/
    └── e2e/                     # 62 passing Playwright end-to-end tests
```

---

## Documentation Index

- [Architecture Guide](docs/ARCHITECTURE.md) — Clinical rules, boundaries, and metric definitions.
- [Authentication & OAuth](docs/AUTH.md) — Google Cloud Console and Supabase Auth configuration.
- [Database & Schema](docs/DATABASE.md) — `app_*` tables, RLS policies, and migration sequence.
- [VITALIS Bridge Specification](docs/BRIDGE.md) — Android integration contract, pairing, and vitals schema.
- [Deployment Guide](docs/DEPLOYMENT.md) — Vercel, container hosting, and production checklist.
- [Build Status](docs/BUILD_STATUS.md) — Historical milestone tracking and verification notes.
- [Judge FAQ](docs/JUDGE_FAQ.md) — Technically defensible claims, boundaries, and limitations.

# VITALIS

A Zero-Trust Clinical Intelligence prototype. A poisoned medical record should never silence a patient emergency.

Synthetic adults and device streams; real scoring, persistence, document parsing and quarantine. Clinical decision support only. Not for patient care.

## Structure

- `apps/web` — Next.js doctor command center
- `apps/api` — FastAPI, deterministic risk engine, document gateway, persistence
- `supabase/migrations` — PostgreSQL schema and deny-by-default RLS
- `scripts` — local runners, stream client and reproducible PDF fixtures
- `docs` — architecture, build status, demo and limitations

## Local setup

Node 22+ and Python 3.11+ required.

```sh
python -m venv .venv
# Windows
.venv/Scripts/python -m pip install -r apps/api/requirements.txt
# macOS/Linux: .venv/bin/python -m pip install -r apps/api/requirements.txt
npm install
npm run fixtures
npm run dev
```

Open http://localhost:3000. API: http://127.0.0.1:8000. The simulator runs inside the API by default. No cloud keys needed. Copy `.env.example` to `.env` to override defaults.

```sh
npm test
npm run lint
npm run build
```

The complete demo: **Start deterioration → watch Arjun become Critical → Documents → upload the attack PDF → Trust conflict → Critical preserved → Audit trail.** Generated files are in `output/pdf`; Run attack demo in the UI uploads the same real PDF through the real gateway.

## What works

- Eight streaming synthetic adults, urgency queue, current vitals and interactive trend plots.
- NEWS2 Scale 1, rolling median/MAD baselines, slopes, persistence and recovery hysteresis.
- Immediate NEWS2 severity floor; acknowledgement never downgrades physiological state.
- Computed naive-vs-VITALIS alert counts, episode detection, false positives and processing timing.
- PDF/text upload, hidden/invisible/encoded instruction checks, quarantine, immutable originals and SHA-256.
- Unified protected context, numeric fact provenance, trust conflict and audit trail.
- Persistent run checkpoints; reset/replay preserves previous records.

## Additional commands

```sh
npm run frontend        # Next.js only
npm run backend         # FastAPI only
npm run simulator       # external clock; use SIMULATOR_AUTOSTART=false
npx playwright install chromium
npm run test:e2e        # requires npm run dev in another terminal
npm run format:check
```

Python test storage lives in `.pytest-work`, separate from the demo database. Browser tests reset the synthetic run and leave an inspected critical scenario. Use Reset afterward for a fresh presentation.

## Auth platform (v1)

The original single-clinician demo (`/demo`, legacy `/api/*`, SQLite-backed) is unchanged
and kept as a fallback/demo-only surface — see `docs/DATABASE.md` for why the two schemas
coexist. The real, judge-facing production experience is the authenticated platform that
runs alongside it:

- Frontend: `/login` (Google Sign-In), `/auth/callback`, `/auth/signout`,
  `/app/doctor/**` and `/app/patient/**` (role-gated), `/onboarding/**`.
- Backend: `/api/v1/*` — profile, patient CRUD, vitals ingest, alerts, history, document
  upload/scan (reuses the same `apps/api/app/gateway.py` classifier as the legacy demo),
  and the ML mock.
- Database: `app_*` tables, built up across `supabase/migrations/20260909062424_auth_platform.sql`
  through `20260910090000_bridge_pairing.sql` (see `docs/DATABASE.md` for the full list),
  RLS-enforced, keyed by `auth.uid()`. Both doctor and patient logins are first-class roles.
- Bridge: each patient has one permanent `VTL-XXXX-XXXX` Bridge Code (shown in their
  Profile/Device pages). The VITALIS-Bridge Android app exchanges it for a device
  credential at `POST /api/bridge/pair` and streams readings to `POST /api/bridge/vitals`,
  which run the same vitals → risk → alert → Realtime pipeline as every other reading.
  See `docs/BRIDGE.md`.
- Realtime: the doctor monitoring/alerts/patient-detail views and the patient home/vitals/alerts
  views subscribe to Supabase Realtime (`app_vitals`, `app_alerts`, `app_risk_assessments`) for
  near-instant updates, with polling kept as a fallback if the socket drops.
- ML boundary: `apps/api/app/ml.py`. Ships with `MockRiskPredictor` (deterministic,
  clearly `is_mock: true`). Set `VITALIS_ML_PREDICTOR=path.to.Class` when the
  trained model is ready — no other file needs to change.
- `PLATFORM_DATABASE_URL` must point at that real Postgres database outside local demo mode
  (`DEMO_MODE=false`); the backend now refuses to start otherwise, so the v1 platform can never
  silently fall back to the legacy SQLite demo store in production.

Seed a local demo doctor + patients + vitals:

```sh
npm run seed
```

See [docs/AUTH.md](docs/AUTH.md) for the exact Google Cloud + Supabase dashboard
steps and [docs/DATABASE.md](docs/DATABASE.md) for the schema.

## Documentation

- [Build status](docs/BUILD_STATUS.md) — milestones, evidence and pending work
- [3–5 minute demo script](DEMO_SCRIPT.md) — exact judge-facing sequence
- [Demo operator guide](docs/DEMO.md) — setup, recovery and optional clean-document flow
- [Architecture](docs/ARCHITECTURE.md) — clinical rules, boundaries and metric definitions
- [Authentication](docs/AUTH.md) — Google + Supabase Auth flow and required env vars
- [Database](docs/DATABASE.md) — auth-platform tables, RLS, and migration steps
- [Deployment](docs/DEPLOYMENT.md) — Supabase, persistent backend and Vercel configuration
- [VITALIS Bridge](docs/BRIDGE.md) — permanent patient Bridge Code and the Android pairing/upload API
- [Judge FAQ](docs/JUDGE_FAQ.md) — technically defensible claims and limits

Local mode needs no secrets. Hosted mode requires backend bearer authorization and a frontend demo access password. Cloud deployment awaits a dedicated database and backend target; existing unrelated projects are not modified.

This is a hackathon prototype for synthetic adults, using NEWS2 Scale 1 only. The clinical workflow and custom intelligence are **not clinically validated**. No diagnosis, treatment recommendation, certification or guaranteed injection protection is claimed.

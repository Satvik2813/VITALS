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

## Documentation

- [Build status](docs/BUILD_STATUS.md) — milestones, evidence and pending work
- [3–5 minute demo script](DEMO_SCRIPT.md) — exact judge-facing sequence
- [Demo operator guide](docs/DEMO.md) — setup, recovery and optional clean-document flow
- [Architecture](docs/ARCHITECTURE.md) — clinical rules, boundaries and metric definitions
- [Deployment](docs/DEPLOYMENT.md) — Supabase, persistent backend and Vercel configuration
- [Judge FAQ](docs/JUDGE_FAQ.md) — technically defensible claims and limits

Local mode needs no secrets. Hosted mode requires backend bearer authorization and a frontend demo access password. Cloud deployment awaits a dedicated database and backend target; existing unrelated projects are not modified.

This is a hackathon prototype for synthetic adults, using NEWS2 Scale 1 only. The clinical workflow and custom intelligence are **not clinically validated**. No diagnosis, treatment recommendation, certification or guaranteed injection protection is claimed.

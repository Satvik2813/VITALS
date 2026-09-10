# Deployment

## Current status

Nothing is deployed. No cloud deployment or live Supabase verification is claimed, and **no migration has been applied to any hosted project as part of this work**.

The intended production topology is:

```
Browser / Android  ──HTTPS──>  Vercel (apps/web, Next.js 16)
                                   │  server-side proxy routes only
                                   ▼
                            Backend host (apps/api, FastAPI, 1 replica)
                                   │
                                   ▼
                            Supabase Postgres  ──Realtime──>  Browser
```

The frontend is the only public host. FastAPI is reached exclusively through the Next route handlers under `apps/web/app/api/**`, including the Android client's path (`/api/bridge/*`).

`compose.yaml` is a **local container smoke-test, not this path.** It exists to check that the image boots with production-shaped settings.

## Migrations

Nine SQL files in `supabase/migrations/`, applied in filename order:

| Order | File                                                    | What it does                                                                                              |
| ----- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1     | `20260909062337_vitalis_foundation.sql`                 | Legacy synthetic demo tables (`/demo`, legacy `/api/*`). Backend-only, no browser grants.                 |
| 2     | `20260909062424_auth_platform.sql`                      | `app_*` base schema, doctor-scoped RLS, `auth.users` profile trigger.                                     |
| 3     | `20260909062507_harden_auth_platform_functions.sql`     | Function EXECUTE grants.                                                                                  |
| 4     | `20260909071401_fix_rls_recursion_app_patients.sql`     | Fixes 42P17 recursion between patient/sharing policies.                                                   |
| 5     | `20260909110804_finalize_platform_security.sql`         | Removes default grants, blocks self-promotion, private definer schema, anon-signin block, audit triggers. |
| 6     | `20260909131446_patient_doctor_roles.sql`               | `patient` as a first-class role, patient self-access, column-scope trigger.                               |
| 7     | `20260909140000_enable_realtime.sql`                    | Adds `app_vitals` / `app_alerts` / `app_risk_assessments` to the `supabase_realtime` publication.         |
| 8     | `20260910090000_bridge_pairing.sql`                     | `app_patient_bridge_codes` + `app_bridge_devices` for the permanent Bridge Code.                          |
| 9     | `20260910150000_document_verdict_and_vitals_dedupe.sql` | Allows `TRUSTED` in `scan_verdict`; adds the device-reading uniqueness index.                             |

**Before pushing anything to the existing hosted project, reconcile migration history.** `20260909062337_vitalis_foundation.sql` was renamed from `20260909003805_...`; if the hosted project recorded the old version, the renamed file looks like a new migration and its non-idempotent `CREATE TABLE` statements will fail. Run `supabase migration list` against that project first and see [SECURITY_VERIFICATION.md](SECURITY_VERIFICATION.md). Only migration 9 is written to be safely re-runnable end to end.

Against a fresh, empty database:

```sh
for f in supabase/migrations/*.sql; do psql "$PLATFORM_DATABASE_URL" -f "$f"; done
```

### Realtime

Migration 7 adds the three tables to the `supabase_realtime` publication. It is guarded on that publication existing and **silently skips when it does not** (so it works against bare local Postgres). On a hosted project, verify it actually took effect:

```sql
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public';
```

All three of `app_vitals`, `app_alerts`, `app_risk_assessments` must be listed, or the doctor and patient dashboards will never update live. No extra grants are needed: Postgres Changes re-checks the existing RLS SELECT policies per subscriber.

## Backend host

A persistent Python/container host — **not** a serverless function lifecycle, because the legacy demo simulator is an in-process loop. Keep exactly one replica (the rate limiter and simulator are per-process) and mount a persistent volume at `/app/data` for document originals.

```sh
docker build -f apps/api/Dockerfile -t vitalis-api .   # repository-root context
```

The image runs as a non-root user, one worker, port 8000.

### ML engine packaging

`VITALIS_ENGINE/` (the trained model, its metadata and `vitalis_inference.py`) **must be present in the deployment artifact.** `app.ml.TrainedRiskPredictor` is the default predictor and resolves the directory as `<repo root>/VITALIS_ENGINE`; outside demo mode `get_predictor()` raises rather than silently degrading to the mock.

- The Dockerfile copies it (`COPY VITALIS_ENGINE /app/VITALIS_ENGINE`).
- It is tracked in git, so git-based deploys include it.
- `apps/api/requirements.txt` pins the exact training-time versions (numpy 2.1.3, pandas 2.2.3, scikit-learn 1.6.1, xgboost 3.0.2, joblib 1.5.1, scipy 1.15.3). Do not float these — the artifact is a pickled sklearn/XGBoost pipeline.

Verify after deploy:

```sh
curl -s https://<backend-host>/health
```

`ml_status` must be `"loaded"` and `ml_model_loaded` must be `true`. `"unavailable"` means the engine is missing from the artifact; `"mock"` means the deterministic NEWS2-lite fallback is running, which is not production inference. `/health` deliberately answers **200 even when degraded** so a liveness probe does not kill the container in a restart loop — so check the body, not just the status code.

### Backend environment

| Variable                 | Required             | Value                                                                                                                                         |
| ------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEMO_MODE`              | yes                  | `false`. Enables bearer auth, disables `/docs` and the localhost bypass.                                                                      |
| `API_TOKEN`              | yes                  | Random secret, ≥ 32 chars. Must match Vercel's `API_TOKEN`.                                                                                   |
| `PLATFORM_DATABASE_URL`  | yes                  | `postgresql+psycopg://USER:URLENCODED_PW@HOST:5432/postgres?sslmode=require`. The app **refuses to start** without it when `DEMO_MODE=false`. |
| `SUPABASE_URL`           | yes                  | `https://<ref>.supabase.co`. Issuer and JWKS are derived only from this. Without it every `/api/v1` request 503s on auth.                     |
| `DATA_DIR`               | yes                  | `/app/data` (persistent volume).                                                                                                              |
| `DATABASE_URL`           | yes                  | Legacy synthetic demo store. SQLite on the volume is fine.                                                                                    |
| `VITALIS_PROXY_SECRET`   | strongly recommended | Shared secret, also set on Vercel. See **Rate limiting** below.                                                                               |
| `VITALIS_CORS_ORIGINS`   | recommended          | Empty is correct when only the Next proxy calls this service. Never a wildcard.                                                               |
| `SUPABASE_JWT_SECRET`    | only for HS256       | The project signs ES256; needed only for legacy HS256 tokens.                                                                                 |
| `VITALIS_ALLOWED_EMAILS` | optional             | Comma-separated backend email allowlist.                                                                                                      |
| `SIMULATOR_AUTOSTART`    | optional             | `false` in production unless you want the legacy synthetic stream running.                                                                    |

Never put any of these in a `NEXT_PUBLIC_*` variable.

### Rate limiting behind the proxy

The backend's limits are per-client, keyed on the ASGI peer address by default. **Because every request arrives via the Next proxy, that default makes them one global bucket for the entire platform** — the Bridge pairing brute-force bound becomes a denial of service against all patients, and roughly four streaming handsets exhaust the whole write allowance.

To restore per-client limits, set the **same** `VITALIS_PROXY_SECRET` on the backend and on Vercel. The proxy then declares the real client address, and the backend honours a declared identity _only_ when that secret verifies (constant-time). Absent or wrong secret ⇒ the peer address is used; an untrusted caller can never pick its own bucket by sending a header.

Only enable it when the web tier sits behind a trusted edge that overwrites `X-Forwarded-For` (Vercel does). Implementation: `apps/api/app/security.py` `client_identity`, `apps/web/lib/proxy-client-id.ts`.

Tunable per-minute, per-client limits (defaults shown):

| Variable                           | Default | Applies to                                                                                                     |
| ---------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `VITALIS_BRIDGE_VITALS_RATE_LIMIT` | 60      | `POST /api/v1/bridge/vitals`. Its own category so wearable streaming never shares the general write budget.    |
| `VITALIS_BRIDGE_PAIR_RATE_LIMIT`   | 10      | `POST /api/v1/bridge/pair`. Bridge Codes are permanent, so this is the primary brute-force bound. Keep it low. |
| `VITALIS_MUTATION_RATE_LIMIT`      | 120     | Other `/api/**` writes.                                                                                        |
| `VITALIS_UPLOAD_RATE_LIMIT`        | 20      | Document uploads.                                                                                              |
| `VITALIS_AUTH_RATE_LIMIT`          | 120     | `/api/v1/me`. Note the `/app/**` layouts call this on every render.                                            |
| `VITALIS_READ_RATE_LIMIT`          | 600     | All other `/api/v1/**` reads.                                                                                  |

Also configure hosting-level body limits and rate limiting; these in-process controls are one layer, not the only one.

## Vercel frontend

Import the repository with **Root Directory `apps/web`**, framework Next.js. Vercel installs workspace dependencies from the root lockfile. `apps/web/vercel.json` sets security headers and function durations.

| Variable                        | Required             | Value                                                                                     |
| ------------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| `BACKEND_URL`                   | yes                  | Backend HTTPS origin, no trailing slash.                                                  |
| `API_TOKEN`                     | yes                  | Same value as the backend.                                                                |
| `NEXT_PUBLIC_SUPABASE_URL`      | yes                  | Supabase project URL.                                                                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes                  | Anon/publishable key only.                                                                |
| `NEXT_PUBLIC_SITE_URL`          | yes                  | `https://<production-domain>`.                                                            |
| `VITALIS_PROXY_SECRET`          | strongly recommended | Same value as the backend.                                                                |
| `VITALIS_ACCESS_USER`           | yes                  | Legacy `/demo` gate username, defaults to `doctor`.                                       |
| `VITALIS_ACCESS_PASSWORD`       | yes                  | Strong secret. Vercel requests to gated paths **fail closed with 503** until this is set. |
| `SUPABASE_SERVICE_ROLE_KEY`     | no                   | Test-only; used by the Playwright auth fixture. Do not set it in production.              |

The `VITALIS_ACCESS_PASSWORD` Basic-Auth gate covers only `/demo` and the legacy `/api/*` proxy. The real `/app/**` and `/onboarding/**` experiences are Supabase-authenticated and must not sit behind it.

Vercel function payload limits may be lower than the 5 MB gateway limit. For larger uploads use a separately authorized direct-upload flow with private storage rather than raising serverless limits.

## Bridge (Android) routing

The Android client uses **one** public base URL — the web origin:

| Method | Public path           | Forwards to                  |
| ------ | --------------------- | ---------------------------- |
| POST   | `/api/bridge/pair`    | `POST /api/v1/bridge/pair`   |
| GET    | `/api/bridge/session` | `GET /api/v1/bridge/session` |
| POST   | `/api/bridge/vitals`  | `POST /api/v1/bridge/vitals` |
| POST   | `/api/bridge/unpair`  | `POST /api/v1/bridge/unpair` |

`apps/web/app/api/bridge/[...path]/route.ts` allowlists exactly these four. It injects no ambient credential — it forwards only the client's own `vtb_` device token — and therefore deliberately does **not** require a same-origin `Origin` header, because a native Android client sends none. The patient-authenticated routes (`/api/v1/bridge/code`, `/code/regenerate`, `/devices/{id}`) are not reachable through it and stay behind the session-authenticated v1 proxy.

`POST /api/bridge/pair` can return **403** when the device was previously disconnected by the patient and the Bridge Code has not been regenerated since. This is intentional: revocation must not be reversible by replaying the permanent code. See [BRIDGE.md](BRIDGE.md).

Do not generate the Android production base URL until the domain is final, it is in the Supabase redirect allowlist, and one real handset has completed pair → session → vitals → unpair against production.

## Google OAuth

Configured in the Google Cloud Console and the Supabase dashboard, never in this repository. The exact steps are in [AUTH.md](AUTH.md) — including the detail that the Google redirect URI must be the **Supabase** callback (`https://<ref>.supabase.co/auth/v1/callback`), not the Next.js `/auth/callback` route.

## First-run bootstrap

`GET /api/v1/doctors` lists only doctors with `onboarding_completed = true`, and patient onboarding requires selecting one. **On a fresh project no patient can onboard until at least one doctor has.** Sign in as the first doctor and complete `/onboarding/doctor` before inviting any patient.

## Verification order

1. Reconcile migration history, then apply migrations 1–9 to the target database.
2. Confirm the Realtime publication contains all three tables.
3. Run the Supabase security and performance advisors.
4. Deploy the backend. `GET /health` ⇒ `status: ok`, `ml_status: loaded`.
5. Confirm anon/authenticated Data API access is denied (`node scripts/test_rls.mjs` covers the policy logic against disposable Postgres; re-check the hosted project with the advisors).
6. Deploy a Vercel **preview**. Complete Google sign-in, doctor onboarding, patient onboarding, and a document upload of both a clean and a malicious fixture.
7. Pair a real Android handset end to end, then disconnect it and confirm the code replay is refused.
8. Promote to production only after 6 and 7 pass on the preview.

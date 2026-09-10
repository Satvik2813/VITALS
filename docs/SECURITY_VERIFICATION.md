# VITALIS backend security verification — 2026-09-09

## Result and scope

Backend changes and local policy verification are complete. **No deployment, hosted schema mutation, hosted seed, model training, or credential change was performed.** The existing project is VITALIS (`egtydpimvagdfrnndmbs`, ap-south-1), active/healthy at inspection. Frontend/backend Supabase URLs match that project. Actual application data currently uses local SQLite, not Supabase Postgres.

Frontend/UIUX files, VITALIS_ENGINE, trained model files and predictor implementations were not written by this task. The workspace already contained extensive uncommitted work. During verification the predictor and ML integration test hashes changed through concurrent work; those changes were not reverted or overwritten. Existing /api/v1 paths and successful response shapes remain compatible. Validation now rejects malformed IDs, missing JWT claims, naive timestamps, null/blank names and oversized bodies.

## Hosted Supabase findings (read-only)

- All **19 public tables** have RLS enabled: 11 legacy tables plus 8 namespaced app tables. The two sets are intentional pre-existing demo/platform architecture, not newly duplicated tables.
- Anonymous REST requests with limit=0 were made against every table; **19/19 returned 401**. No patient/document contents were retrieved.
- app_profiles maps to auth.users via FK; there is one hosted auth user/profile and no profile orphan. No real identity details were printed.
- Hosted app counts: profiles 1; patients, assignments, vitals, alerts, documents and audit events all 0. Thus a populated hosted doctor A/B scenario was not tested; it was exercised against disposable local PostgreSQL and through the backend API.
- All expected patient/profile/assignment FKs exist. Patient/time indexes support vital, alert, risk, document and audit access; sharing has a composite doctor/patient PK plus patient index, and patient MRN is unique within owner. No additional index was necessary for this bounded task.
- Existing RLS enforces owner-or-assigned-doctor reads. Doctor owners manage patient edits/sharing. app_profiles.role means clinician application role, not patient ownership; no patient-login identity mapping exists.
- **Confirmed defects:** authenticated users can update their own role column; default grants include TRUNCATE on all app tables, including audit (TRUNCATE is not governed by RLS); authenticated direct writes could forge scan/risk/provenance fields. These are fixed in the pending local migration, not yet on the hosted project.
- Security advisor: legacy tables have RLS but no policies (intentional backend-only access); public definer helper/event-trigger warnings; leaked-password protection is disabled. The new migration moves the patient-access definer into a private schema and revokes the event-trigger RPC grants when present. Password protection settings were not changed; review if password auth is used.
- Backend SQL connections are privileged and do not set per-request auth.uid(). They rely on explicit verified-user ownership filters. RLS protects the direct authenticated/anonymous Data API; it does not constrain a service-role/postgres SQL connection.

## Migration history blocker

Local and hosted migrations correspond by name but have **different versions**:

| Local filename version | Hosted version | Name |
| --- | --- | --- |
| 20260909003805 | 20260909062337 | vitalis_foundation |
| 20260909100000 | 20260909062424 | auth_platform |
| 20260909110000 | 20260909062507 | harden_auth_platform_functions |
| 20260909120000 | 20260909071401 | fix_rls_recursion_app_patients |

Do not run a blind db push or replay CREATE TABLE migrations against the hosted project. Before an authorized remote rollout, compare the four recorded migration bodies with local SQL, reconcile history using the CLI's inspected migration-repair workflow, then apply only the intended new migration. Do not mark migrations applied merely from matching names. No history was repaired in this task because deployed infrastructure was excluded from scope.

New local migration: `supabase/migrations/20260909130000_finalize_platform_security.sql`. Created using the Supabase CLI and ordered after the pre-existing 12:00 migration. Its changes are transaction-wrapped, reviewable and idempotent:

- Remove PUBLIC/anon/authenticated broad grants, including TRUNCATE.
- Grant authenticated reads, display-only profile edits, owner-scoped patient edits and sharing management. Medical/provenance/audit mutations use the existing backend API; alert acknowledgement remains available through its unchanged API endpoint.
- Prevent user-controlled role/email/identity/owner updates through column grants.
- Keep the existing public helper signature; use a private, fixed-search-path, auth.uid-bound boolean definer to avoid recursive RLS.
- Explicitly deny anonymous-signin JWTs through restrictive policies.
- Record sharing grants/changes/revocations and profile role changes into the existing audit table through private transactional triggers. Audit failure rolls the sensitive database change back.
- Revoke public execution of internal trigger functions. No new tables or extensions.

All original migrations were left untouched. No migration was deployed.

## Doctor/patient permission evidence

`scripts/test_rls.mjs` creates disposable PostgreSQL/PGlite roles, auth.uid/auth.jwt shims and synthetic records. It applies the existing migrations with real PostgreSQL RLS semantics, then the final migration twice. Only CREATE EXTENSION pgcrypto is omitted in the test bootstrap because PGlite lacks that extension and gen_random_uuid is built into PostgreSQL. Supabase auth services themselves are not emulated.

The suite verifies owner reads, assigned doctor reads, doctor A/B isolation across patient/vital/alert/risk/document/audit tables, unassigned mutation denial, no profile self-promotion, no audit insert/delete/truncate, anonymous and anonymous-signin denial, service-role access, grant revocation, admin-role audit and transactional rollback when an audit constraint fails. API tests independently exercise verified identity and owner/assignment filtering on SQLite. Local checks do not imply the pending hosted fixes are already applied.

## Seed/demo data

Ran the updated seed twice against the existing local SQLite application database: **1 synthetic doctor, 3 patients, 3 assignments, 18 vitals, 3 information alerts, 3 PENDING document metadata fixtures**. The second run added no duplicates. Names explicitly say Synthetic; no personal data or credentials were inserted.

Document rows are clearly tagged metadata_only with seed:// provenance and are not claimed to be uploaded/scanned files. Existing legacy PDF/text fixtures provide actual clean/malicious scan/quarantine demonstrations. No mock risk result was inserted or model invoked by the seed. The original script leaked remote connection URLs on refusal; the refusal now withholds the URL. Remote seeding was not performed.

## OAuth preparation

See [AUTH.md](AUTH.md) for exact callback URLs, environment boundaries, current provider status, manual Google Cloud/Supabase steps and the frontend handoff.

Google is currently enabled; anonymous sign-ins are disabled; public JWKS uses ES256. The previous HS256-only backend could not verify current Google/Supabase sessions; ES256/RS256 JWKS verification is now implemented and tested offline. The actual Google credentials, audience/consent and redirect settings still need manual confirmation and a browser login test. No Google credentials were invented, requested in logs, or added as placeholders to runtime code.

Frontend findings remain with Claude: unvalidated callback next can redirect externally, legacy Basic-Auth still gates app/v1 in production, role/profile routing is unfinished, and signout origin/error handling and refresh-cookie propagation require acceptance checks. These are real remaining release blockers; no frontend changes were made to conceal them.

## Audit and backend security changes

Platform audit reuses app_audit_events. Verified events: AUTHENTICATED (verified API requests), AUTHENTICATION_FAILED, PATIENT_CREATED/UPDATED/DELETED, VITALS_INGESTED, RISK_ASSESSMENT_CREATED, ALERT_ACKNOWLEDGED. New SQL triggers cover PATIENT_ACCESS_GRANTED/CHANGED/REVOKED and USER_ROLE_CHANGED. No device mapping service/table or device mutation endpoint currently exists; device_id is measurement metadata, so no fictional device-management API/event was added.

Legacy audit reuses audit_events and keeps its transactional rollback behavior. Upload, scan, security classification signals, quarantine, context protection, escalation and acknowledgement events already existed and passed regression checks. Explicit API vitals ingestion is now audited; arbitrary document prose is not copied into audit metadata. Nested credential fields and recognizable token text are redacted while preserving legacy messages.

Platform audit metadata is allowlisted/bounded, actor IDs come from verified identity, deleted patient references use nullable FKs with a safe resource UUID retained in metadata. SQLAlchemy SQLite FK deletion behavior was aligned with existing Postgres cascade/set-null definitions for new local databases. Existing SQLite files are not silently rebuilt.

A platform audit-write failure emits a safe error message without SQL parameters/credentials and does not turn an already committed mutation into a misleading 500/retry. There is no durable retry queue, so operators must monitor vitalis.audit errors; this hackathon implementation is not a lossless compliance archive. Legacy and SQL-trigger audit failures roll back their transaction. No recursive logging/retry path was introduced.

Security controls:

- Exact issuer/audience/signature/expiry/issued-at/UUID/role checks; bounded tokens; malformed claims fail closed; JWKS timeout/cache; no JWT-supplied URLs; service-role and anonymous tokens rejected; user metadata never grants authority.
- Local demo-auth hook requires demo mode, loopback/test peer and hostname, plus SQLite; production/hosted-Postgres bypass disabled.
- Explicit environment-configured CORS. Default development origins localhost:3000 and 127.0.0.1:3000; production default none. An explicitly empty CORS variable disables cross-origin access. Credentials disabled for bearer-header APIs; wildcard origins rejected.
- Fixed-window per-process/per-peer rate limits: auth 120/min, upload 20/min, mutations 120/min, other v1 reads 600/min. Bounded 4096-key storage, thread lock, expiry, 429 and Retry-After. Forwarded headers are not read by the limiter. Behind the current Next proxy, multiple users share its peer bucket; limits reset on restart and are not distributed.
- 64 KiB JSON/mutation bodies and existing 5 MiB file allowance; POST/PUT/PATCH/DELETE and streamed/chunked input are bounded before parsing.
- UUID checks, nonblank names, null-name rejection, timezone-aware input timestamps, existing enum/numeric/nonfinite validation retained. No clinical thresholds or ML validation rules were changed.
- PDF/text MIME/extension/signature/UTF-8 checks, binary-in-text rejection, sanitized filenames, random immutable on-disk names, download containment, original SHA-256/provenance preserved. Broken PDF parser output continues to quarantine (legacy behavior), rather than silently passing. Scanner remains heuristic, not a malware-sandbox guarantee.
- No-store/nosniff/frame/referrer headers, safe 500 responses and validation responses without rejected input values. No public exception stack traces or SQL parameters.

## Tests and scans

- Baseline: 47 passed, 3 failed, before changes.
- Latest full backend run: **92 passed, 3 failed** (95 tests); same three pre-existing assertions requiring is_mock=True while concurrent real ML is active.
- New focused security/audit/seed coverage: 45 tests; all pass in the full run.
- Legacy security + workflow + initial focused rerun: 60 passed before four additional focused cases were added.
- Local PostgreSQL migration/access suite: **93 checks passed**, including applying all migrations and reapplying the final migration.
- Ruff for all touched Python files: passes.
- Hosted anonymous REST: 19/19 denied (401).
- Configured-secret/private-key pattern scan of candidate source files and git history (165 historical objects): no findings. Only .env.example is tracked; .env remains ignored. No backend secret-variable references were found in frontend source. This is a scoped scan, not a proof that no undiscovered credential ever existed.
- git diff --check reports two pre-existing trailing spaces in the concurrently owned /health ML status block in main.py. Those lines were not edited by this task. New migration and security files have no whitespace errors.

Unchanged failing test assertions:

1. apps/api/tests/test_api_v1.py::test_vitals_ingest_and_history
2. apps/api/tests/test_api_v1.py::test_predict_endpoint_is_mock
3. apps/api/tests/test_supabase_jwt.py::test_e2e_patient_flow_with_jwt

The JWT test fixture now supplies the required issuer/project URL; its ML assertions remain unchanged. No ML tests were weakened, skipped, or marked expected-failure. Concurrent ML implementation/test edits were not made by this task.

Reproduce:

```powershell
.\.venv\Scripts\python.exe -m pytest apps/api/tests -q --basetemp=.pytest-work/security-final-all --tb=short --disable-warnings
npm install --prefix .pytest-security-tools --no-package-lock --ignore-scripts @electric-sql/pglite@0.3.14
node scripts/test_rls.mjs
```

The PGlite dependency is isolated in an ignored test directory; root package.json/package-lock.json and frontend dependencies were not changed by this task. No deployed Postgres/Docker instance is required for the local policy tests.

## Files changed by this task

- .env.example; .gitignore
- apps/api/app/auth.py; audit.py (new); security.py (new); limits.py; main.py; service.py
- apps/api/app/api_v1/router.py; schemas.py; db_platform.py
- apps/api/tests/test_backend_hardening.py (new); test_supabase_jwt.py (issuer fixture only)
- scripts/seed_demo.py; scripts/test_rls.mjs (new)
- supabase/migrations/20260909130000_finalize_platform_security.sql (new, pending)
- docs/AUTH.md; docs/DATABASE.md; docs/SECURITY_VERIFICATION.md (new)
- Ignored local data: additive synthetic seed in data/vitalis.db; isolated test artifacts.

Do not attribute other git-status changes (frontend, ML, README, requirements, package manifests, dev script, earlier migrations) to this task. They predated this work or belong to the concurrent agents.

## Remaining release blockers

1. Reconcile migration history and authorize a separate hosted rollout of the security migration; unsafe hosted grants remain until then.
2. Complete Google client/consent/redirect verification and resolve the listed frontend auth findings, then test real browser login/refresh/logout and clinician isolation.
3. Configure the intended hosted PLATFORM_DATABASE_URL separately if hosted medical storage is desired; current SQLite data is not automatically Supabase data.
4. Coordinate the three mock-expectation failures with the ML agent. Do not modify the engine or tests merely to obtain a green run.
5. Patient self-service authorization and device mapping are not implemented in the existing backend; frontend demos must not imply otherwise. Password protection should be reviewed if password auth is enabled.

Advisor references: [definer RPC exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [signed-in definer exposure](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

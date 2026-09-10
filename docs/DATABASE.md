# Database

Two schemas coexist in the same Postgres database:

- **Legacy demo** â€” the tables in `20260909062337_vitalis_foundation.sql`. They back
  the single-clinician synthetic prompt-injection demo (`/demo`, legacy `/api/*`) and
  are unchanged; RLS locks them to service-role/backend-only access (no anon/authenticated
  policies).
- **Auth platform** â€” namespaced `app_*` tables, doctor- and patient-scoped, RLS-enforced,
  with UUID PKs and per-metric vital columns. Built up across seven migrations:
  `20260909062424_auth_platform.sql` (base schema + doctor RLS),
  `20260909062507_harden_auth_platform_functions.sql` (function grants),
  `20260909071401_fix_rls_recursion_app_patients.sql` (RLS recursion fix),
  `20260909110804_finalize_platform_security.sql` (grant hardening, anon-signin block, audit triggers),
  `20260909131446_patient_doctor_roles.sql` (adds the `patient` role and patient self-access), and
  `20260909140000_enable_realtime.sql` (adds `app_vitals`/`app_alerts`/`app_risk_assessments` to the
  `supabase_realtime` publication so the doctor and patient dashboards can subscribe to live changes
  instead of relying only on polling), and
  `20260910090000_bridge_pairing.sql` (adds `app_patient_bridge_codes` and `app_bridge_devices` for
  the permanent VITALIS Bridge Code and Android device pairing; see `docs/BRIDGE.md`).

## Auth-platform tables

| Table                    | Purpose                                        | Key columns                                                                       |
| ------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `app_profiles`           | Mirror of `auth.users` + app fields            | `id` (FK auth.users), `email`, `full_name`, `role`                                |
| `app_patients`           | Patient records owned by a doctor              | `id`, `owner_id` -> profiles, `mrn`, `full_name`, `date_of_birth`, `sex`, `notes` |
| `app_doctor_patients`    | Cross-doctor access grants                     | `(doctor_id, patient_id)` composite PK                                            |
| `app_vitals`             | One row per vitals measurement                 | `heart_rate`, `spo2`, `respiratory_rate`, `temperature_c`, `systolic_bp`, ...    |
| `app_alerts`             | Alerts (open until acknowledged)               | `severity`, `kind`, `message`, `acknowledged_at`                                  |
| `app_risk_assessments`   | ML output persisted per vitals row             | `model_version`, `score`, `state`, `features` (jsonb), `is_mock` in features      |
| `app_documents`          | Uploaded medical documents + scan verdict      | `sha256`, `size_bytes`, `scan_verdict`                                            |
| `app_audit_events`       | Immutable actor/patient audit trail            | `actor_id`, `patient_id`, `event_type`, `details`                                 |
| `app_patient_bridge_codes` | One permanent Bridge Code per patient        | `patient_id` (PK), `code`, `code_hash` (unique), `rotated_at`                     |
| `app_bridge_devices`     | Android handsets paired to a patient           | `patient_id`, `device_id`, `token_hash` (unique), `last_seen_at`, `revoked_at`    |

All `app_*` tables have `created_at` / `updated_at` timestamps as applicable.

## Access model

1. A row in `app_profiles` is provisioned automatically by the `auth.users`
   insert trigger `app_on_auth_user_created`.
2. `app_patients.owner_id` identifies the doctor who created the record.
3. Additional doctors can be granted access via `app_doctor_patients`
   (only the patient owner can create these grants).
4. `public.app_has_patient_access(target uuid)` returns true if the current
   `auth.uid()` owns the patient or has a grant.
5. All patient-scoped tables (`app_vitals`, `app_alerts`, `app_risk_assessments`,
   `app_documents`) enforce read access through that helper in their RLS policy.
   The final security migration routes medical/provenance writes through the backend API.
6. `app_audit_events` is readable by the actor and by doctors who can access the
   patient. Insert/update/delete is service-role only.
7. The two bridge tables are the deliberate exception to rule 5: they are readable
   only via `public.app_is_own_patient(patient_id)` -- the patient themself, never
   their doctor. A Bridge Code is a device-enrolment credential, so a doctor able to
   read it could pair a handset as their own patient. Their digest columns
   (`code_hash`, `token_hash`) carry no `SELECT` grant at all, and all writes go
   through the backend API.

## Row Level Security policies

Every `app_*` table:

- `ENABLE ROW LEVEL SECURITY`
- `REVOKE ALL ... FROM anon` (browser without a session cannot see anything)
- Final migration: SELECT for authenticated users, scoped display/patient/sharing mutations only.
- No authenticated direct writes to vitals, alerts, risk, documents or audit; no TRUNCATE grants.
- Policies as listed in `20260909062424_auth_platform.sql`.

The service role and privileged SQL connections bypass RLS. Backend ownership checks are therefore
mandatory; RLS does not protect against an unrestricted service-role query. Current FastAPI SQL
connections do not install per-request `auth.uid()` claims. RLS protects direct anon/authenticated
Data API access; application ownership filters protect the SQL backend.

## Applying migrations

- **Local SQLite (tests, dev)** â€” `app.db_platform.connect(url)` runs
  `metadata.create_all` so tests do not need a live Postgres.
- **Supabase / Postgres** â€” apply the SQL files in `supabase/migrations/` in
  filename order on a fresh local database. **Do not blindly push to the existing hosted project:**
  its four migration versions differ from the corresponding local filenames. See
  [SECURITY_VERIFICATION.md](SECURITY_VERIFICATION.md) before reconciling/applying anything remotely.

## Reproducing the schema

```sh
# Apply all migrations against a target Postgres URL:
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -f "$f"
done
```

## Seeding demo data (dev only)

```sh
npm run seed
# or, direct:
node scripts/python.mjs scripts/seed_demo.py
```

The seed refuses non-sqlite URLs unless `SEED_ALLOW_REMOTE=true` is set, so it
cannot accidentally overwrite Supabase.

## Final verification (2026-09-09)

All 19 hosted public tables have RLS enabled. Anonymous zero-row REST queries returned 401 on all
19. The 11 legacy tables intentionally have no browser policies. Existing app tables have the
expected profile/patient FKs and patient/time indexes. No additional tables were introduced.

`20260909110804_finalize_platform_security.sql` removes dangerous default table grants, prevents
profile self-promotion, keeps the recursive RLS helper's definer implementation in a private schema,
rejects anonymous sign-ins, and audits sharing/role changes transactionally in the existing
app_audit_events table. Whether it (and the two migrations after it) have been applied to any given
hosted project is a per-environment fact this doc cannot assert — reconcile with `supabase migration list`
against that project before applying anything remotely; see [SECURITY_VERIFICATION.md](SECURITY_VERIFICATION.md).

Run `node scripts/test_rls.mjs` after installing its isolated test runtime as documented in the
script. It applies all migrations to disposable PostgreSQL/PGlite, replays the final migration,
and verifies owner/assigned/unassigned doctors, anon denial, service-role access and audit grants.
SQLite tests verify API authorization, not PostgreSQL RLS.

The local seed is idempotent for generated vitals, assignments, alerts and document metadata.
It creates 1 synthetic doctor, 3 synthetic patients, 3 assignments, 18 vitals, 3 info alerts and
3 metadata-only PENDING documents. It does not claim to run an ML model or upload/scan documents.
Real local document/scan/quarantine fixtures remain in the legacy security demo. No hosted data
was seeded. Use a dedicated synthetic identity; do not assign demo records to a real patient.
Existing older SQLite files are not rebuilt by create_all; the corrected FK deletion rules apply
to newly provisioned SQLite databases. The hosted migration already had those deletion rules.

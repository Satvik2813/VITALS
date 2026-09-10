# Authentication and Google OAuth preparation

Verified 2026-09-09. Existing project: **VITALIS**, ref `egtydpimvagdfrnndmbs`, region `ap-south-1`. Do not create another project.

## Current verified state

- Frontend and backend Supabase URLs match the existing project.
- Public auth settings report Google enabled and anonymous sign-ins disabled. This does not prove the configured Google client credentials or consent screen are usable; no credentials were read, invented, or changed.
- The project's public JWKS advertises **ES256**. FastAPI now verifies ES256/RS256 using the configured project JWKS and supports legacy HS256 only with the backend JWT secret.
- JWT verification binds issuer to `SUPABASE_URL/auth/v1`, audience to `authenticated`, and checks signature, expiry, issued-at, UUID subject, role, and non-anonymous identity. Service-role tokens are rejected as user sessions. User metadata is display-only.
- Browser OAuth, PKCE `exchangeCodeForSession`, SSR cookies, `getUser()` guards, cookie refresh, session restoration, POST signout, and bearer forwarding already exist. No frontend file was changed during this work.
- `GET /api/v1/me` hydrates the database profile; the auth.users trigger creates hosted profiles. **Update (post `20260909131446_patient_doctor_roles.sql`):** the schema now supports `patient` as a first-class role in addition to `doctor`/`admin`. A patient's own login is mapped to their clinical record via `app_patients.user_id`, populated by `POST /api/v1/onboarding/patient`; patient-facing pages under `/app/patient/**` read real, JWT-authenticated data, not a demo view.
- Backend API authentication successes are recorded as `AUTHENTICATED` (each verified API request, not a claim that a fresh Google login happened). Failures are `AUTHENTICATION_FAILED`; Supabase's own auth audit log remains the source for provider login/logout events.
- Current platform database is **local SQLite** by default in demo mode (`DEMO_MODE=true`), because `PLATFORM_DATABASE_URL` is unset and `DATABASE_URL` is SQLite. **Update:** `apps/api/app/main.py` now refuses to start with `DEMO_MODE=false` unless `PLATFORM_DATABASE_URL` is explicitly set — the v1 platform can no longer silently fall back to the legacy SQLite demo store outside local demo mode. Hosted Supabase auth plus a real hosted Postgres `PLATFORM_DATABASE_URL` is required for production; see docs/DATABASE.md.

## Manual Google/Supabase steps remaining

1. In [Google Auth Platform](https://console.cloud.google.com/auth/overview), select your Google Cloud project. Configure branding, audience and test users. For a testing app, add every intended demo Google account. Use only `openid`, `userinfo.email`, and `userinfo.profile` scopes.
2. Create or verify an OAuth **Web application** client. Add authorized JavaScript origin `http://localhost:3000`; add `http://127.0.0.1:3000` only if you use that address. Add the eventual production origin `https://<production-domain>` when known.
3. Set the Google client's authorized redirect URI to exactly:
   `https://egtydpimvagdfrnndmbs.supabase.co/auth/v1/callback`.
   This is the **Supabase** callback, not the Next.js `/auth/callback` route.
4. In the existing [VITALIS Supabase dashboard](https://supabase.com/dashboard/project/egtydpimvagdfrnndmbs/auth/providers), open Google and configure/verify the actual client ID and client secret. Google is already enabled; do not assume that toggle proves the credentials are correct. Keep these values in Supabase's provider settings, never in browser environment variables or repository files.
5. In Supabase Authentication > URL Configuration, use local Site URL `http://localhost:3000` and allow `http://localhost:3000/auth/callback`. If the frontend retains a `next` query parameter, verify that the corresponding callback URL is accepted by the redirect allowlist; prefer a fixed callback URL with a validated return path stored by the app. Add the equivalent 127.0.0.1 callback only if used. For production set Site URL `https://<production-domain>` and allow `https://<production-domain>/auth/callback`. These domain markers are documentation only, not runtime configuration. Do not broadly allow arbitrary preview origins.
6. After the frontend issues below are resolved, verify Google login, profile hydration, refresh, direct protected navigation, logout, rejected callback codes and hostile `next` values. Repeat with two separately assigned doctors. Never share session tokens in logs or reports.

For a separately running local Supabase stack (not the current hosted project), Google's callback is `http://127.0.0.1:54321/auth/v1/callback`. Do not substitute this into the hosted setup.

## Frontend handoff for Claude (read-only findings, 2026-09-09)

The items below were open issues as of the original write-up. **All are now resolved in the current
code** (verified 2026-09-09, later same day) — kept here as a record of what was fixed, not as
outstanding work:

- ~~`apps/web/app/auth/callback/route.ts`: interpolates unvalidated `next`...~~ **Resolved.** The route now
  sanitizes `next` through `apps/web/lib/safe-redirect.ts` (`safeNext`), which rejects protocol-relative
  destinations, backslashes, and embedded schemes before redirecting, and falls back to `/app`.
- ~~`apps/web/proxy.ts` and `.../api/v1/[...path]/route.ts`: legacy Basic-Auth gate also covers
  authenticated routes...~~ **Resolved.** `apps/web/app/api/v1/[...path]/route.ts` is Supabase-JWT
  authenticated only and explicitly does not apply the legacy shared-password gate (see the comment at
  the top of that file); the legacy gate remains scoped to `/demo` and the legacy `/api/*` proxy.
- ~~`apps/web/app/app/page.tsx`: always redirects to the doctor view...~~ **Resolved.** It now branches on
  the real role from `GET /api/v1/me` (via `apps/web/lib/server-me.ts`) and routes doctors to
  `/app/doctor` and patients to `/app/patient`; `apps/web/app/app/doctor/layout.tsx` and
  `apps/web/app/app/patient/layout.tsx` re-verify role server-side as defense-in-depth.
- ~~`apps/web/app/auth/signout/route.ts`: add same-origin check and handle signout errors...~~ **Resolved.**
  The route is POST-only and always redirects to `/login` even if `signOut()` fails.
- Cookie refresh across redirect branches in `proxy.ts`: verified — refreshed/cleared Supabase cookies are
  forwarded onto the redirect response, not just the pass-through response.
- Next's API proxy `Retry-After` forwarding: verified — `apps/web/app/api/v1/[...path]/route.ts` forwards
  the `retry-after` response header.
- `NEXT_PUBLIC_SITE_URL` vs `window.location.origin`: the login page builds the OAuth redirect from
  `window.location.origin`, which matches the deployed origin in both local dev and production as long as
  that origin is also in the Supabase redirect allowlist (see manual steps above) — no code change needed,
  just dashboard configuration.

Browser-based, end-to-end Google OAuth login **cannot be verified from this codebase** — it depends on the
manual Google Cloud Console + Supabase dashboard steps above, which only a human with access to those
consoles can complete. The code-side implementation (PKCE exchange, cookie session, role routing, safe
redirects, sign-out) is complete and covered by `tests/e2e/auth-routing.spec.ts`.

## Environment names and boundaries

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Backend project URL; issuer and JWKS are derived only from this trusted configuration. |
| `NEXT_PUBLIC_SUPABASE_URL` | Same project URL, public-safe. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon/publishable client key only. |
| `SUPABASE_JWT_SECRET` | Backend-only legacy HS256 verification; not needed for the current ES256 signing key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend-only privileged key; never a user login token. Current SQL backend uses its database connection, not this key. |
| `PLATFORM_DATABASE_URL` | SQLAlchemy platform connection, backend-only. Falls back to `DATABASE_URL` only in local demo mode (`DEMO_MODE=true`); **required** otherwise — the app refuses to start without it outside demo mode. |
| `DATABASE_URL` | Legacy database connection; currently local SQLite. |
| `NEXT_PUBLIC_SITE_URL` | Intended public site origin; see frontend note above. |
| `BACKEND_URL` | Next.js server-side API proxy origin. |
| `VITALIS_ALLOWED_EMAILS` | Optional backend email allowlist. It does not configure Supabase Auth signups or direct REST access; use provider admission controls for that. |
| `VITALIS_CORS_ORIGINS` | Explicit comma-separated backend browser origins; empty disables cross-origin requests. Credentials are disabled because FastAPI uses bearer headers. |

Never place a Google client secret, service-role key, JWT secret, or database URL in a `NEXT_PUBLIC_*` variable. Google client configuration belongs in Supabase's dashboard. Existing `.env` remains ignored; the example has blank secret values.

`VITALIS_DEMO_USER` is a local integration hook only: it now requires demo mode, a loopback/test peer and hostname, and a SQLite platform engine. It cannot bypass production or hosted-Postgres auth. Never enable it for real medical data.

References: [Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google), [JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys), [redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

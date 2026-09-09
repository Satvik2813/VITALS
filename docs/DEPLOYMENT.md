# Deployment

## Current status

The complete application runs locally. A deployable backend Dockerfile, Compose configuration, Vercel frontend configuration, PostgreSQL migration and CI workflow are included. No cloud deployment or live Supabase verification is claimed.

Connected Supabase projects are unrelated inactive applications. This workspace has no VITALIS cloud database credentials or backend hosting target. Git is initialized locally; the GitHub CLI is not signed in and no new remote repository was created.

## Backend

Use a persistent Python/container host. Do not place the in-process continuous simulator on a serverless function lifecycle. Build with repository-root context:

```sh
docker build -f apps/api/Dockerfile -t vitalis-api .
```

The image runs as a non-root user, one worker on port 8000. Keep exactly one replica. Mount a persistent directory at `/app/data` for immutable document originals, even when PostgreSQL stores the records. Configure an HTTPS endpoint and:

| Variable                   | Value                                       |
| -------------------------- | ------------------------------------------- |
| DEMO_MODE                  | `false` — requires bearer authentication    |
| API_TOKEN                  | Secret random value, at least 32 characters |
| DATABASE_URL               | Supabase PostgreSQL SQLAlchemy URL with TLS |
| DATA_DIR                   | `/app/data`                                 |
| SIMULATOR_AUTOSTART        | `true`                                      |
| SIMULATOR_INTERVAL_SECONDS | `2`                                         |

Liveness: `/health`. Verify authenticated `/api/snapshot`, upload, original download and restart persistence before exposing the frontend. Configure hosting-level body limits and rate limiting. Container configurations are prepared; Docker was not running on the development machine, so an image build was not verified.

## Supabase PostgreSQL

Use a dedicated empty VITALIS project. Apply `supabase/migrations/20260909003805_vitalis_foundation.sql` with the Supabase migration workflow or SQL editor. It creates eleven tables, JSONB payloads, indexes, RLS and no public access policies. Startup seeds the eight synthetic patients automatically.

Set a **server-only** database connection string, for example:

```text
postgresql+psycopg://USER:URL_ENCODED_PASSWORD@HOST:5432/postgres?sslmode=require
```

For a persistent backend prefer the direct connection or session pooler appropriate to the host’s IPv4/IPv6 support. See [Supabase connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres). Use a dedicated restricted backend role for a hosted deployment, with required table privileges and backend-only RLS policies. The application never uses a browser service-role key. Do not grant anon/authenticated access just to make the UI work; the Next.js proxy calls FastAPI.

Run Supabase security/performance advisors after applying the migration. Confirm anon/authenticated access is denied, test a parameterized insert/read transaction from the backend, then run the same acceptance flow against the cloud target. These steps remain pending credentials.

## Vercel frontend

Import the repository with **Root Directory `apps/web`**, framework Next.js. Vercel installs workspace dependencies using the root lockfile. The directory contains `vercel.json`.

Configure server-side variables in the Vercel project:

- `BACKEND_URL`: the backend’s HTTPS URL, without a trailing slash.
- `API_TOKEN`: the same backend bearer secret.
- `VITALIS_ACCESS_USER`: demo clinician username, defaults to `doctor`.
- `VITALIS_ACCESS_PASSWORD`: a strong private demo access password.

Never use `NEXT_PUBLIC_` for any secret. Vercel requests fail closed with 503 until the access password is configured. Basic authentication is a temporary single-clinician demonstration boundary, not multi-tenant clinical identity. Protect the backend as well; the frontend login is not a substitute for API authorization.

Deploy a preview only once the backend is reachable. Confirm the complete flow on the preview before production promotion. [Vercel deployment documentation](https://vercel.com/docs/deployments/overview).

Vercel function payload limits may be lower than the local 5 MB gateway limit; the demo fixtures are small. For large uploads, use a separately authorized direct upload flow with private storage rather than raising serverless limits. [Vercel function limits](https://vercel.com/docs/functions/limitations).

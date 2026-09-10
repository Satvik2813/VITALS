# VITALIS Bridge — permanent patient code and Android pairing

This is the integration contract between the VITALIS backend and the separate
**VITALIS-Bridge** Android application. The Android repository stays
independent; it talks to this backend over HTTP and nothing else.

---

## 1. The Bridge Code

Every patient account has exactly **one permanent Bridge Code**:

```
VTL-8F4K-29QX
```

| Property | Value                                                                            |
| -------- | -------------------------------------------------------------------------------- |
| Format   | `VTL-XXXX-XXXX`                                                                  |
| Alphabet | `0123456789ABCDEFGHJKMNPQRSTVWXYZ` — Crockford base32 without `I`, `L`, `O`, `U` |
| Entropy  | 8 characters × 32 symbols = **2⁴⁰** codes, drawn from `secrets`                  |
| Lifetime | Permanent. It never expires and is not rotated automatically                     |
| Scope    | Bound to exactly one patient record                                              |
| Contents | Nothing derivable. No patient id, email, or JWT material                         |

The patient reads it in the web dashboard (Profile, and Device). It is created
lazily the first time they look, so existing accounts need no backfill.

**Input handling.** The backend canonicalises whatever the user types: case is
ignored, any separators (`-`, space, `_`, none) are accepted, and the classic
confusions are repaired in the code body — `O`→`0`, `I`→`1`, `L`→`1`. The
Android app can therefore submit the raw text of the input field. It should
still uppercase and group as `VTL-XXXX-XXXX` for display.

---

## 2. Base URL

Two equivalent entry points; pick one and use it consistently.

|                 | URL                                        | When                                                            |
| --------------- | ------------------------------------------ | --------------------------------------------------------------- |
| **Recommended** | `https://<web-origin>/api/bridge/...`      | Production. One public host, the FastAPI service stays private. |
| Direct          | `https://<backend-host>/api/v1/bridge/...` | Local development, or when the backend is itself public.        |

The web passthrough forwards only `pair`, `session`, `vitals` and `unpair`. It
never injects a session and never touches the `Authorization` header beyond
passing it through. Patient-authenticated routes (`/bridge/code`, …) are not
reachable through it.

All request and response bodies are JSON (`Content-Type: application/json`).
Bodies are capped at 64 KB.

---

## 3. Pairing

### `POST /api/bridge/pair`

Unauthenticated — the handset has no credential yet. This is the only endpoint
where the Bridge Code is ever transmitted.

**Request**

```json
{
  "bridge_code": "VTL-8F4K-29QX",
  "device_id": "a3f1c9e2-0b7d-4f11-9c2e-6ad0f5b81c44",
  "device_name": "Pixel 8"
}
```

| Field         | Type   | Required | Notes                                                                                                       |
| ------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------- |
| `bridge_code` | string | yes      | As typed. Max 64 chars.                                                                                     |
| `device_id`   | string | yes      | A **stable** id the app generates once and persists (e.g. a random UUID in encrypted prefs). Max 128 chars. |
| `device_name` | string | no       | Human label shown to the patient. Max 120 chars.                                                            |

There is deliberately **no `patient_id` field**. Sending one is a `422`.

**`201 Created`**

```json
{
  "device_token": "vtb_9Xq2…",
  "token_type": "Bearer",
  "device": {
    "id": "6f1e…",
    "device_id": "a3f1c9e2-…",
    "device_name": "Pixel 8",
    "paired_at": "2026-09-10T09:12:44.512Z",
    "last_seen_at": "2026-09-10T09:12:44.512Z",
    "revoked_at": null
  },
  "patient": {
    "id": "8b0c…",
    "display_name": "Ada Patient"
  }
}
```

`device_token` is shown **once**. Store it in Android Keystore-backed
encrypted storage; it is the handset's only credential from here on. `patient`
is display-only, for the pairing-success screen — the `id` is never accepted
back as an authorization claim.

**Errors**

| Status                                                | Meaning                                                                                                                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401` `{"detail": "Invalid bridge code"}`             | Unknown or malformed code. The two cases are intentionally indistinguishable.                                                                                                                                    |
| `403` `{"detail": "This device was disconnected..."}` | The code is valid, but this `device_id` was disconnected by the patient and the code has not been regenerated since. Show the message and tell the user to generate a new Bridge Code. See **Revocation** below. |
| `422`                                                 | `device_id` missing/blank, or an unexpected field was sent.                                                                                                                                                      |
| `429`                                                 | Rate limited. Honour `Retry-After` (seconds).                                                                                                                                                                    |

**Re-pairing.** Submitting the same `device_id` again for the same patient
rotates that device's credential _in place_: the row is reused and the previous
token stops working immediately. A reinstall therefore leaves no orphaned
credential behind. If the app regenerates its `device_id` on reinstall instead,
the patient will see two devices — prefer a persisted id.

---

## 4. Authenticated bridge calls

Every call below sends:

```
Authorization: Bearer vtb_9Xq2…
```

The patient identity is derived from that credential server-side. No endpoint
accepts a patient id from the client.

A `401` means the credential is dead — revoked by the patient, superseded by a
re-pair, or never valid. The correct app response is to clear stored state and
return to the pairing screen. Do not retry.

### `GET /api/bridge/session`

Confirms the credential is live and reports who it belongs to. Useful on app
launch.

```json
{
  "device": {
    "id": "6f1e…",
    "device_id": "a3f1c9e2-…",
    "device_name": "Pixel 8",
    "paired_at": "2026-09-10T09:12:44.512Z",
    "last_seen_at": "2026-09-10T11:03:02.881Z",
    "revoked_at": null
  },
  "patient": { "id": "8b0c…", "display_name": "Ada Patient" }
}
```

### `POST /api/bridge/vitals`

One reading. Fields are all optional except `recorded_at`; send what the
wearable actually measured.

**Request**

```json
{
  "recorded_at": "2026-09-10T11:02:58Z",
  "heart_rate": 78,
  "spo2": 97,
  "respiratory_rate": 16,
  "temperature_c": 36.8,
  "systolic_bp": 118,
  "diastolic_bp": 76,
  "consciousness": "A",
  "supplemental_oxygen": false
}
```

| Field                 | Type              | Range                                                                               |
| --------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `recorded_at`         | ISO 8601 datetime | **Must include a timezone offset** (`Z` or `±hh:mm`). A naive timestamp is a `422`. |
| `heart_rate`          | int               | 20–250                                                                              |
| `spo2`                | int               | 50–100                                                                              |
| `respiratory_rate`    | int               | 4–60                                                                                |
| `temperature_c`       | float             | 30–43                                                                               |
| `systolic_bp`         | int               | 50–260                                                                              |
| `diastolic_bp`        | int               | 20–200                                                                              |
| `consciousness`       | enum              | `A`, `C`, `V`, `P`, `U`                                                             |
| `supplemental_oxygen` | bool              |                                                                                     |

`patient_id`, `source` and `device_id` are **rejected** (`422`) — the backend
stamps provenance itself (`source: "bridge"`, `device_id` from the session).

**`201 Created`** returns the stored reading, including the assigned `id`,
`patient_id`, and the server-stamped `source`/`device_id`.

Each accepted reading runs the **existing** VITALIS pipeline — the same one a
clinician's manual entry uses: it is written to `app_vitals`, scored by the ML
risk model into `app_risk_assessments`, raises an `app_alerts` row on
`WARNING`/`CRITICAL`, and fans out over Supabase Realtime to the doctor
dashboard. There is no separate bridge data path.

**Retries are safe.** A reading is keyed on
`(patient_id, device_id, recorded_at)`, so re-sending one after a network
failure returns the reading already stored (`201`, same `id`) instead of
creating a duplicate reading, risk assessment and alert. Queue and retry
freely; just keep `recorded_at` stable across retries of the same reading.

**Alerting is debounced.** A sustained `WARNING`/`CRITICAL` condition raises
one alert, not one per reading: a new alert is created only when no
equally-or-more-severe `RISK_STATE` alert is still unacknowledged, or when the
condition genuinely escalates (open `warning` -> `CRITICAL`). Every reading
still produces its own risk assessment, so trends are unaffected.

**Errors:** `401` (credential), `422` (validation), `429` (rate limited).

### `POST /api/bridge/unpair`

Device-initiated disconnect, for an in-app "forget this account" action.
Returns `204`. The credential is dead immediately, and this device cannot
re-pair by replaying the same code — pairing answers `403` until the patient
regenerates their Bridge Code (see **Revocation** in section 6). Treat that as
"ask the user for a fresh code", not as a retryable error.

---

## 5. Patient-side management (web only)

These are session-authenticated (Supabase JWT via the web app) and are **not**
part of the Android contract. Listed for completeness:

| Endpoint                              | Purpose                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/bridge/code`             | The caller's own code + active devices. Mints the code on first call. `404` if the account has no patient record. |
| `POST /api/v1/bridge/code/regenerate` | Rotate the code. Already-paired devices keep working.                                                             |
| `DELETE /api/v1/bridge/devices/{id}`  | Disconnect one device. Its credential dies immediately, and it cannot re-pair until the code is regenerated.      |

---

## 6. Security notes

- **The code is a bearer secret.** Anyone holding it can pair a device to that
  patient. Treat it like a password in the app: no logging, no analytics, no
  clipboard persistence beyond the paste.
- **Permanence is bounded by rate limiting, not expiry.** `POST /bridge/pair`
  has its own per-client limit (default 10/min,
  `VITALIS_BRIDGE_PAIR_RATE_LIMIT`), well below the ~2⁴⁰ search space. For that
  limit to be per-client rather than platform-wide, `VITALIS_PROXY_SECRET` must
  be configured on both tiers — see docs/DEPLOYMENT.md. If a code is believed compromised, the
  patient rotates it from the Device page.
- **Revocation is enforced, not advisory.** When the patient disconnects a
  device, that `device_id` cannot pair again by replaying the same permanent
  code: `POST /bridge/pair` answers `403`. Because the Bridge Code never
  changes on its own, allowing the replay would have made "Disconnect" purely
  cosmetic for any handset that had already read the code.
  Re-pairing becomes possible again only once the patient regenerates the code
  — their explicit "this enrolment secret is burned, here is a new one" action,
  already sitting next to Disconnect on the Device page. The check is
  `code.rotated_at > device.revoked_at`, and it fails closed if either
  timestamp is missing.
  Already-paired, non-revoked devices are unaffected by a rotation: they hold
  their own credential, and the code is only ever an enrolment secret.
- **Storage.** The backend stores only a SHA-256 digest of each device
  credential, and looks codes up by digest so a submitted code never reaches a
  SQL predicate. Neither codes nor tokens are ever written to logs or the audit
  trail.
- **Database exposure.** `app_patient_bridge_codes` and `app_bridge_devices`
  are RLS-protected and readable only by the patient the row belongs to — not
  by their doctor, who would otherwise be able to pair a device as them. The
  digest columns carry no `SELECT` grant at all. Writes are backend-only.
- **Audit.** `BRIDGE_CODE_ISSUED`, `BRIDGE_CODE_ROTATED`,
  `BRIDGE_DEVICE_PAIRED`, `BRIDGE_DEVICE_REVOKED`, `BRIDGE_PAIR_REJECTED` and
  the usual `VITALS_INGESTED` / `RISK_ASSESSMENT_CREATED` land in
  `app_audit_events`, with structural metadata only.

---

## 7. Suggested Android flow

1. **First run** — generate and persist a `device_id` (UUID) in encrypted
   storage.
2. **Pair screen** — the patient types the code; `POST /pair`; store
   `device_token` in Keystore-backed storage. On `401`, show "That code didn't
   work"; on `429`, back off for `Retry-After`.
3. **Launch** — `GET /session` to confirm the link and show the patient name.
   On `401`, clear state and return to the pair screen.
4. **Streaming** — `POST /vitals` per reading. Queue locally while offline and
   replay; `recorded_at` is the measurement time, so late delivery is fine.
5. **Settings** — offer "Disconnect this phone" → `POST /unpair`.

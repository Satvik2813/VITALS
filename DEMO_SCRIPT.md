# VITALIS — 3–5 minute demo script

Before judging, run `npm run fixtures` and `npm run dev`, open `http://127.0.0.1:3000`, and click **Reset synthetic run**. Every identity and observation is synthetic; the scoring, persistence, parsing, quarantine and audit logic are real.

## 0:00–0:30 — Doctor command center

Show eight monitored patients, the urgency-sorted queue, live observations and the Stable / Watch / Warning / Critical counts. Say: “VITALIS directs attention instead of repeating every threshold crossing.”

## 0:30–1:20 — Silent deterioration

Keep Arjun Mehta selected and click **Start deterioration**. His SpO₂ falls while pulse and respiration rise. He moves to the top and progresses to CRITICAL. Click **Pause** when CRITICAL appears.

Point to NEWS2, the component scores, personal baselines, robust deviations and trend chart. Say: “These are computed facts. Persistence filters mild transient signals, while severe NEWS2 triggers bypass delay.”

## 1:20–1:50 — Alert-fatigue evidence

Open **Alert analytics**. Compare the computed naive parameter alerts with VITALIS attention transitions on the same stream. Show episode detection, detection delay, false positives and request/processing timing. Describe the percentage as demonstrated synthetic alert-burden reduction, not a clinical performance estimate.

## 1:50–2:50 — Poisoned medical record

Return to Arjun and open **Documents**. Upload `output/pdf/attack-report.pdf`, or click **Run attack demo** to send that same generated PDF through the real upload endpoint.

Read the result:

- **SECURITY QUARANTINE** — manipulation detected; original preserved.
- **PHYSIOLOGICAL EVIDENCE** — CRITICAL deterioration and NEWS2 remain visible.
- **UNTRUSTED DOCUMENT** — the attempted suppression instruction is excluded from reasoning.
- **PROTECTIVE ACTION** — document quarantined, unsafe instructions excluded, CRITICAL alert preserved.

Expand the document card to show the hidden-text and AI-directed signals. Open provenance to show SHA-256 and exact-byte preservation.

## 2:50–3:30 — Protected context and audit

Open **Document trust** and show that quarantined facts are absent from protected context. Then open **Audit trail** and point to document upload, scan, security signals, quarantine, trust conflict, clinical alert preservation and context protection.

Close with: **“A poisoned medical record should never be able to silence a real patient emergency.”** Add: “VITALIS is clinical decision support demonstrated on synthetic adults. The clinician remains the final decision-maker.”

## Fast recovery

- Click **Reset synthetic run** to start a predictable fresh run. Prior originals remain preserved outside the active run.
- If the stream is paused, click **Resume**. If it is unavailable, restart `npm run dev`.
- Run `npm run fixtures` if the attack/clean fixture links return 404.
- The verified automated replay is `npm run test:e2e` while the app is running; it executes the critical path twice and leaves a reviewable CRITICAL trust-conflict state.

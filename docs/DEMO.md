# The 3–5 minute VITALIS demo

## Before the presentation

Run `npm run fixtures`, then `npm run dev`. Open `http://127.0.0.1:3000`. Let the first compile finish. A 1366×768 laptop display is verified; use a wider display when available. No internet or API key is needed after dependencies are installed. Click Reset to create a fresh run; existing originals remain preserved.

The stream is accelerated: one sample per patient every two seconds represents one clinical minute. Every patient and measurement is synthetic. Pause freezes the stream for explanation; Resume continues it.

## Live sequence

1. **Command center — 30 seconds.** Show eight patients and their personal baselines. The queue follows computed urgency, not alphabetical order. Isolated mild sensor spikes accumulate naive alerts without becoming repeated attention events.
2. **Start deterioration — about 45 seconds.** Keep Arjun Mehta selected and click Start deterioration. His saturation falls from 97 toward 89; pulse rises from 76 toward 112; respiration rises from 16 toward 28. Watch becomes Warning, then Critical. He moves to the top automatically. Pause once Critical appears to preserve the trend shape while presenting.
3. **Explain the evidence — 30 seconds.** Show the saturation chart, baseline, computed factors and NEWS2 component scores. Select Heart rate or Respiration to change the plot. The explanation is built from these calculations; no model invents reasoning.
4. **Alert analytics — 30 seconds.** Show current counts and labelled episode detection. Explain that naive counts individual violating measurements and VITALIS counts upward attention transitions. The second naive sample count and metric caveats are visible. Return to Command center.
5. **Poison the record — 45 seconds.** Open the patient’s Documents tab. Upload `output/pdf/attack-report.pdf` using Choose document or drag and drop. Alternatively use Run attack demo: it downloads that same real PDF then uploads it through the same gateway. This is not a mocked verdict.
6. **The payoff — 30 seconds.** Read SECURITY QUARANTINE, TRUST CONFLICT and CRITICAL ALERT PRESERVED. Expand the detected signals to expose the white microtext. The original medical-looking PDF is intact. Its attempted oxygen-alert suppression has no authority over the physiological score.
7. **Audit — 30 seconds.** Open Audit trail. Show original preservation, scan, hidden/instruction signals, quarantine, trust conflict, alert preservation and context protection. Optional: upload `clean-report.pdf` in Document trust; its numeric lab facts appear with provenance, while the quarantined report remains excluded and Critical remains unchanged.

Closing line: **“A poisoned medical record should never be able to silence a real patient emergency.”** Then qualify that this is clinical decision support demonstrated on synthetic data, with the clinician making the final decision.

## Recovery

- Reset creates a new run in seconds. Click Start deterioration again; no files need regeneration.
- If the browser shows Stream unavailable, restart `npm run dev`. The last persisted run resumes.
- If a fixture download returns 404, run `npm run fixtures`.
- If ports 3000/8000 are occupied, stop the earlier VITALIS process; do not run two backends against the same database.
- For deterministic accelerated testing, authenticated `POST /api/demo` with `{"action":"advance","steps":24}` processes 24 genuine simulator ticks. This is also used by the browser test, not by the displayed metrics.
- `npm run simulator` supplies an external clock through the API. Set `SIMULATOR_AUTOSTART=false` before starting the backend when using it, so there is exactly one clock owner.

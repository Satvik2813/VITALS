# Judge FAQ / defensible claims

**What is real?** The complete processing path: validated observations, persisted readings and baselines, NEWS2, robust deviation, slope calculations, state machine, counters, document parsing, detection, quarantine, context construction and audit events.

**What is simulated?** Patient identities, devices, observations, deterioration ground truth and the attack report. The timeline is accelerated and explicitly labelled.

**Where is the AI?** Patient-specific statistical intelligence uses median/MAD anomaly detection and trends. No deep learning or generative model is necessary for this prototype. There is deliberately no claim of a trained or clinically validated predictive model. A future LLM could verbalize these structured facts only; it would receive no raw document directives or authority to alter scores.

**Is NEWS2 validated here?** The prototype implements published NEWS2 Scale 1 arithmetic. The custom prioritization, personalization, remote-monitoring setting and complete product are not clinically validated. The app does not diagnose or recommend treatment/discharge.

**Could persistence suppress an emergency?** A NEWS2 aggregate of 7+ goes Critical immediately. A score of 5+ or a single component of 3 goes to at least Warning immediately. Persistence applies to the additional low-risk/experimental signals. Physiological concern and clinician judgment still take precedence in real practice.

**Are the alert numbers fake?** No. They are computed from both engines on the exact same stream. Naive alerts count violating parameters each sample, while VITALIS counts upward attention transitions. The comparison is explicitly a notification-burden demonstration. Synthetic episode detection and false positives are shown alongside it; no population performance claim is made.

**What if injection detection misses an attack?** There is no execution path from document instructions to physiological scoring. Even a document that passes scanning can contribute only bounded numeric lab facts with exact units and provenance. Those facts are historically descriptive and do not change live risk. Detection is useful, but separation is the decisive protection in this prototype.

**Is every malicious medical fact detected?** No. An incorrect but plausible lab number can pass an allowlist. Facts are labelled clinically unverified. Injection/manipulation detection does not establish medical truth.

**Why quarantine the entire record?** It avoids silently rewriting a medical document and prevents mixed benign/malicious content from crossing the context boundary. Original bytes and extracted numeric facts remain available with quarantine status and provenance. There is no unsafe “release” button in the demo.

**How is the hidden PDF attack reproducible?** `scripts/generate_documents.py` creates a believable synthetic summary with white 3pt model-directed suppression instructions. The parser discovers both hidden-text indicators and the actual instruction. `Run attack demo` uses the identical generated PDF and upload endpoint.

**Can it run offline?** Yes, after dependencies are installed. SQLite and local private originals support the full flow. PostgreSQL migration and server configuration prepare a Supabase deployment.

**What would production require?** Clinical evaluation and governance; device and patient identity; patient/tenant authorization; formal threat modeling and parser isolation; privacy/retention controls; tamper-evident logs; reliable ingestion/recovery; deployment/load testing; and applicable regulatory review. No certification or patient-harm-prevention guarantee is claimed.

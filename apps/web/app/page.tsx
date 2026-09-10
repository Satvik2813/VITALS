import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Bell,
  BrainCircuit,
  FileCheck2,
  HeartPulse,
  LineChart,
  LockKeyhole,
  ScanLine,
  Shield,
  ShieldCheck,
  Stethoscope,
  Waves,
} from 'lucide-react';
import { VitalisBrand, VitalisLogo } from '../components/vitalis/brand';
import { ThemeToggle } from '../components/vitalis/theme-toggle';
import { EcgVisual } from '../components/vitalis/ecg-visual';

export const dynamic = 'force-static';

export default function LandingPage() {
  return (
    <div style={{ background: 'var(--v-bg)', color: 'var(--v-text)' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          background: 'color-mix(in oklab, var(--v-bg) 88%, transparent)',
          borderBottom: '1px solid var(--v-border)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div
          className="v-container-wide"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 68,
          }}
        >
          <VitalisBrand size="md" />
          <nav
            aria-label="Primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 24,
            }}
            className="v-landing-nav"
          >
            <a href="#features" className="v-muted" style={{ fontSize: 14 }}>
              Features
            </a>
            <a href="#how" className="v-muted" style={{ fontSize: 14 }}>
              How it works
            </a>
            <a href="#security" className="v-muted" style={{ fontSize: 14 }}>
              Security
            </a>
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThemeToggle compact />
            <Link
              href="/login"
              className="v-btn v-btn-secondary v-header-signin"
              style={{ fontSize: 13 }}
            >
              Sign in
            </Link>
            <Link href="/get-started" className="v-btn v-btn-primary" style={{ fontSize: 13 }}>
              Get started <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section style={{ position: 'relative', overflow: 'hidden' }}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(1200px 500px at 15% -10%, rgba(32,227,194,0.15), transparent 60%), radial-gradient(1000px 400px at 90% 10%, rgba(23,60,255,0.12), transparent 60%)',
            pointerEvents: 'none',
          }}
        />
        <div
          className="v-container-wide v-hero-grid"
          style={{
            position: 'relative',
            padding: '72px 24px 40px',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1fr)',
            gap: 48,
            alignItems: 'center',
          }}
        >
          <div>
            <span className="v-eyebrow">Clinical AI · Zero-Trust</span>
            <h1 className="v-h1" style={{ marginTop: 12 }}>
              AI-powered remote patient monitoring with{' '}
              <span className="v-brand-gradient-text">zero-trust healthcare security</span>.
            </h1>
            <p
              className="v-muted"
              style={{ marginTop: 18, fontSize: 17, lineHeight: 1.55, maxWidth: 560 }}
            >
              VITALIS helps clinicians monitor patients in real time, detect health risks early,
              prioritize alerts, and protect healthcare AI workflows from unsafe or malicious
              clinical content.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
              <Link href="/get-started" className="v-btn v-btn-primary" style={{ padding: '12px 20px' }}>
                Get started <ArrowRight size={16} />
              </Link>
              <a href="#how" className="v-btn v-btn-secondary" style={{ padding: '12px 20px' }}>
                See how it works
              </a>
            </div>
            <div style={{ display: 'flex', gap: 22, marginTop: 28, flexWrap: 'wrap' }}>
              <TrustSignal icon={<ShieldCheck size={16} />} text="RLS-enforced access" />
              <TrustSignal icon={<LockKeyhole size={16} />} text="Prompt-injection detection" />
              <TrustSignal icon={<FileCheck2 size={16} />} text="Audit-logged" />
            </div>
          </div>
          <HeroPreview />
        </div>
      </section>

      {/* WHAT VITALIS DOES */}
      <section
        style={{
          padding: '72px 0',
          borderTop: '1px solid var(--v-border)',
          background: 'var(--v-surface)',
        }}
      >
        <div className="v-container-wide">
          <div style={{ maxWidth: 720, marginBottom: 40 }}>
            <span className="v-eyebrow">What VITALIS does</span>
            <h2 className="v-h2" style={{ marginTop: 10 }}>
              Two pillars, one clinical workflow.
            </h2>
            <p className="v-muted" style={{ marginTop: 10, fontSize: 16 }}>
              Real-time monitoring for early risk, and a zero-trust gateway that keeps AI
              reasoning safe from adversarial clinical content.
            </p>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 24,
            }}
          >
            <PillarCard
              icon={<HeartPulse size={24} />}
              title="Remote patient monitoring"
              text="Continuous vitals, AI risk detection, and clinician prioritization — so serious deterioration surfaces early, without alert fatigue."
              accent="teal"
            />
            <PillarCard
              icon={<Shield size={24} />}
              title="Secure healthcare AI"
              text="Every clinical document is scanned for prompt injection, adversarial instructions, and content-tampering before it can reach AI reasoning."
              accent="blue"
            />
          </div>
        </div>
      </section>

      {/* KEY FEATURES */}
      <section id="features" style={{ padding: '80px 0' }}>
        <div className="v-container-wide">
          <div style={{ maxWidth: 720, marginBottom: 40 }}>
            <span className="v-eyebrow">Key features</span>
            <h2 className="v-h2" style={{ marginTop: 10 }}>
              A clinical command center, not a template.
            </h2>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 16,
            }}
          >
            <FeatureCard icon={<Waves size={20} />} title="Live vitals monitoring" text="Streaming heart rate, SpO₂, respiratory rate, temperature, blood pressure." />
            <FeatureCard icon={<BrainCircuit size={20} />} title="AI risk detection" text="Model-scored NEWS2-aligned risk state per patient, updated per reading." />
            <FeatureCard icon={<Bell size={20} />} title="Smart clinical alerts" text="Correlated attention events — not one alert per violating parameter." />
            <FeatureCard icon={<LineChart size={20} />} title="Patient health trends" text="Personal baselines, trend charts, and simple language for patients." />
            <FeatureCard icon={<ScanLine size={20} />} title="Secure document scanner" text="Zero-trust ingestion classifies every upload before it enters context." />
            <FeatureCard icon={<Shield size={20} />} title="Prompt-injection detection" text="Adversarial instructions in documents are quarantined, never executed." />
            <FeatureCard icon={<LockKeyhole size={20} />} title="Zero-trust AI protection" text="Physiological evidence cannot be overridden by untrusted document content." />
            <FeatureCard icon={<FileCheck2 size={20} />} title="Audit & trust layer" text="Every decision leaves an immutable trace, from ingestion to clinical action." />
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section
        id="how"
        style={{
          padding: '72px 0',
          background: 'var(--v-surface)',
          borderTop: '1px solid var(--v-border)',
          borderBottom: '1px solid var(--v-border)',
        }}
      >
        <div className="v-container-wide">
          <div style={{ maxWidth: 720, marginBottom: 40 }}>
            <span className="v-eyebrow">How it works</span>
            <h2 className="v-h2" style={{ marginTop: 10 }}>
              Two streams. One protected context.
            </h2>
          </div>
          <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <FlowCard
              title="Monitoring flow"
              steps={['Wearable / patient data', 'VITALIS', 'AI risk & anomaly analysis', 'Doctor prioritization / alert', 'Clinical action']}
            />
            <FlowCard
              title="Document security flow"
              steps={['Clinical document', 'Security scan', 'Trusted / Suspicious / Malicious', 'Sanitize / quarantine', 'Safe AI processing']}
            />
          </div>
        </div>
      </section>

      {/* SECURITY */}
      <section id="security" style={{ padding: '80px 0' }}>
        <div
          className="v-container-wide v-security-grid"
          style={{
            display: 'grid',
            gap: 40,
            gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.1fr)',
            alignItems: 'center',
          }}
        >
          <div>
            <span className="v-eyebrow">Security & AI trust</span>
            <h2 className="v-h2" style={{ marginTop: 10 }}>
              Zero-trust for the AI, not just the network.
            </h2>
            <p className="v-muted" style={{ marginTop: 14, fontSize: 16, lineHeight: 1.6 }}>
              Clinical documents can carry instructions that manipulate an LLM. VITALIS treats every
              external record as untrusted until it passes classification. Physiological evidence
              from live vitals — never a document — decides the risk state.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 22, display: 'grid', gap: 12 }}>
              {[
                'Prompt-injection detection with heuristic + LLM-adversarial signals',
                'Document sanitization and quarantine — original preserved, unsafe content isolated',
                'Malicious content blocked before it enters model context',
                'Immutable audit log for every scan, verdict, and clinical action',
                'Trusted / Suspicious / Malicious classification, per document',
              ].map((line) => (
                <li key={line} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 15 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      marginTop: 6,
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: 'var(--v-brand-2)',
                      flexShrink: 0,
                    }}
                  />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <SecurityGraphic />
        </div>
      </section>

      {/* DOCTOR BENEFITS */}
      <section
        style={{
          padding: '72px 0',
          background: 'var(--v-surface-2)',
          borderTop: '1px solid var(--v-border)',
          borderBottom: '1px solid var(--v-border)',
        }}
      >
        <div className="v-container-wide">
          <div style={{ maxWidth: 720, marginBottom: 40 }}>
            <span className="v-eyebrow">Doctor benefits</span>
            <h2 className="v-h2" style={{ marginTop: 10 }}>
              Fewer alerts. Higher attention. Safer AI.
            </h2>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 16,
            }}
          >
            <BenefitCard icon={<HeartPulse size={20} />} title="Earlier risk detection" />
            <BenefitCard icon={<Bell size={20} />} title="Less alert noise" />
            <BenefitCard icon={<Stethoscope size={20} />} title="Better patient prioritization" />
            <BenefitCard icon={<Activity size={20} />} title="Remote monitoring" />
            <BenefitCard icon={<ShieldCheck size={20} />} title="Safer AI-assisted workflows" />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: '96px 24px', textAlign: 'center' }}>
        <div className="v-container">
          <VitalisLogo size="xl" />
          <h2 className="v-h2" style={{ marginTop: 16 }}>
            Enter VITALIS.
          </h2>
          <p className="v-muted" style={{ marginTop: 10, fontSize: 16 }}>
            Choose Patient or Doctor and continue with Google to reach your dashboard.
          </p>
          <Link
            href="/get-started"
            className="v-btn v-btn-primary"
            style={{ marginTop: 28, padding: '14px 28px', fontSize: 15 }}
          >
            Get started <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <footer
        style={{
          padding: '32px 0 40px',
          borderTop: '1px solid var(--v-border)',
          background: 'var(--v-surface)',
        }}
      >
        <div
          className="v-container-wide"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <VitalisBrand size="sm" />
          <p className="v-soft" style={{ fontSize: 12 }}>
            Clinical decision support. Clinician judgment remains final.
          </p>
        </div>
      </footer>
    </div>
  );
}

function TrustSignal({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        color: 'var(--v-text-muted)',
      }}
    >
      <span style={{ color: 'var(--v-brand-2)', display: 'inline-flex' }}>{icon}</span>
      {text}
    </span>
  );
}

function HeroPreview() {
  return (
    <div
      className="v-card-lg"
      style={{
        position: 'relative',
        padding: 20,
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, transparent 40%, color-mix(in oklab, var(--v-brand-2) 6%, transparent) 100%)',
        }}
      />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span className="v-badge success v-badge-dot">Live</span>
        <span className="v-badge info">6 patients</span>
        <span className="v-badge warning">1 needs attention</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--v-text-soft)' }}>
          Bed 4B · MRN 4831
        </span>
      </div>
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>Heart rate</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--v-text-muted)' }}>
            bpm
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span
            style={{
              fontSize: 44,
              fontWeight: 620,
              letterSpacing: '-0.03em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            92
          </span>
          <span className="v-badge info">Normal</span>
        </div>
        <EcgVisual height={180} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 10,
            marginTop: 8,
          }}
        >
          <MiniStat label="SpO₂" value="97%" />
          <MiniStat label="Resp" value="18" />
          <MiniStat label="Temp" value="36.9°" />
          <MiniStat label="BP" value="118/74" />
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: 'var(--v-surface-2)',
        border: '1px solid var(--v-border)',
        borderRadius: 10,
        padding: '10px 12px',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--v-text-muted)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function PillarCard({
  icon,
  title,
  text,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  accent: 'teal' | 'blue';
}) {
  const color = accent === 'teal' ? 'var(--v-brand-1)' : 'var(--v-brand-2)';
  return (
    <div className="v-card-lg" style={{ padding: 28 }}>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          width: 44,
          height: 44,
          borderRadius: 12,
          background: `color-mix(in oklab, ${color} 14%, transparent)`,
          color,
        }}
      >
        {icon}
      </span>
      <h3 className="v-h3" style={{ marginTop: 18 }}>
        {title}
      </h3>
      <p className="v-muted" style={{ marginTop: 8, fontSize: 15, lineHeight: 1.6 }}>
        {text}
      </p>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="v-card" style={{ padding: 20 }}>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          width: 36,
          height: 36,
          borderRadius: 10,
          background: 'var(--v-surface-2)',
          color: 'var(--v-brand-2)',
        }}
      >
        {icon}
      </span>
      <h3 style={{ marginTop: 12, fontSize: 15, fontWeight: 600 }}>{title}</h3>
      <p className="v-muted" style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55 }}>
        {text}
      </p>
    </div>
  );
}

function FlowCard({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="v-card-lg" style={{ padding: 24 }}>
      <h3 className="v-h3">{title}</h3>
      <ol style={{ listStyle: 'none', padding: 0, marginTop: 16, display: 'grid', gap: 10 }}>
        {steps.map((step, i) => (
          <li key={step}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                border: '1px solid var(--v-border)',
                borderRadius: 10,
                background: 'var(--v-surface-2)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 24,
                  height: 24,
                  fontSize: 12,
                  fontWeight: 600,
                  background: 'var(--v-brand-gradient)',
                  color: '#fff',
                  borderRadius: 999,
                }}
              >
                {i + 1}
              </span>
              <span style={{ fontSize: 14 }}>{step}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function BenefitCard({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="v-card" style={{ padding: 18 }}>
      <span aria-hidden="true" style={{ color: 'var(--v-brand-2)', display: 'inline-flex' }}>
        {icon}
      </span>
      <div style={{ marginTop: 12, fontSize: 15, fontWeight: 550 }}>{title}</div>
    </div>
  );
}

function SecurityGraphic() {
  const rows: { label: string; verdict: 'trusted' | 'suspicious' | 'malicious' }[] = [
    { label: 'Cardiology_consult.pdf', verdict: 'trusted' },
    { label: 'external-referral.pdf', verdict: 'suspicious' },
    { label: 'prior-labs_2024-11.pdf', verdict: 'trusted' },
    { label: 'inbox_forward.pdf', verdict: 'malicious' },
  ];
  const badge = {
    trusted: 'success',
    suspicious: 'suspicious',
    malicious: 'critical',
  } as const;
  const label = {
    trusted: 'Trusted',
    suspicious: 'Suspicious',
    malicious: 'Malicious',
  } as const;
  return (
    <div className="v-card-lg" style={{ padding: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Shield size={20} style={{ color: 'var(--v-brand-2)' }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Document security center</div>
          <div style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
            Scan → classify → isolate → assemble context
          </div>
        </div>
      </div>
      <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
        {rows.map((r) => (
          <div
            key={r.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--v-surface-2)',
              border: '1px solid var(--v-border)',
            }}
          >
            <FileCheck2 size={16} style={{ color: 'var(--v-text-muted)' }} />
            <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.label}
            </span>
            <span className={`v-badge ${badge[r.verdict]}`}>{label[r.verdict]}</span>
          </div>
        ))}
      </div>
      <p className="v-muted" style={{ marginTop: 14, fontSize: 12 }}>
        Malicious content is quarantined. The original is preserved. AI reasoning proceeds on
        allowlisted numeric facts only.
      </p>
    </div>
  );
}

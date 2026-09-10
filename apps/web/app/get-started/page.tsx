import Link from 'next/link';
import { ArrowRight, HeartPulse, Stethoscope } from 'lucide-react';
import { VitalisBrand } from '../../components/vitalis/brand';
import { ThemeToggle } from '../../components/vitalis/theme-toggle';

export const dynamic = 'force-static';

export default function GetStartedPage() {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--v-bg)', color: 'var(--v-text)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 24px',
        }}
      >
        <Link href="/" style={{ display: 'inline-flex' }}>
          <VitalisBrand size="md" />
        </Link>
        <ThemeToggle compact />
      </header>

      <div
        className="v-container"
        style={{ padding: '48px 24px 80px', textAlign: 'center', maxWidth: 880 }}
      >
        <span className="v-eyebrow">Get started</span>
        <h1 className="v-h1" style={{ marginTop: 12, fontSize: 'clamp(28px, 4vw, 40px)' }}>
          How will you use VITALIS?
        </h1>
        <p className="v-muted" style={{ marginTop: 12, fontSize: 16, maxWidth: 560, marginInline: 'auto' }}>
          Choose your role to continue with Google. Doctors and patients each get their own
          dashboard, permissions, and onboarding.
        </p>

        <div
          style={{
            marginTop: 40,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 20,
            textAlign: 'left',
          }}
        >
          <RoleCard
            href="/login?role=patient"
            icon={<HeartPulse size={26} />}
            title="I'm a Patient"
            description="Track your vitals, see your trends, and stay connected with your assigned doctor."
            accent="teal"
          />
          <RoleCard
            href="/login?role=doctor"
            icon={<Stethoscope size={26} />}
            title="I'm a Doctor"
            description="Monitor your assigned patients, review alerts, and manage your clinical workspace."
            accent="blue"
          />
        </div>

        <p style={{ marginTop: 32, fontSize: 13 }}>
          <Link href="/login" className="v-muted">
            Already onboarded? Sign in →
          </Link>
        </p>
      </div>
    </main>
  );
}

function RoleCard({
  href,
  icon,
  title,
  description,
  accent,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  accent: 'teal' | 'blue';
}) {
  const color = accent === 'teal' ? 'var(--v-brand-1)' : 'var(--v-brand-2)';
  return (
    <Link
      href={href}
      className="v-card-lg"
      style={{
        padding: 28,
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'transform 0.12s ease, box-shadow 0.12s ease',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          width: 52,
          height: 52,
          borderRadius: 14,
          background: `color-mix(in oklab, ${color} 14%, transparent)`,
          color,
        }}
      >
        {icon}
      </span>
      <h2 className="v-h3" style={{ marginTop: 18, fontSize: 19 }}>
        {title}
      </h2>
      <p className="v-muted" style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6 }}>
        {description}
      </p>
      <span
        style={{
          marginTop: 18,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          fontWeight: 600,
          color,
        }}
      >
        Continue with Google <ArrowRight size={14} />
      </span>
    </Link>
  );
}

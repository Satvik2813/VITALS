'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Bluetooth, Home, LineChart, Stethoscope, User, Waves } from 'lucide-react';
import { ReactNode } from 'react';
import { VitalisBrand, VitalisLogo } from './brand';
import { ThemeToggle } from './theme-toggle';

// The 5 primary, always-visible destinations (bottom bar on mobile, top nav
// on desktop). Device and My Doctor are one tap/click away from Home and
// Profile rather than taking their own primary slot -- matches the doctor
// shell's "don't add sections nobody needs constant access to" approach.
const tabs = [
  { href: '/app/patient', label: 'Home', icon: Home },
  { href: '/app/patient/vitals', label: 'Vitals', icon: Waves },
  { href: '/app/patient/history', label: 'History', icon: LineChart },
  { href: '/app/patient/alerts', label: 'Alerts', icon: Bell },
  { href: '/app/patient/profile', label: 'Profile', icon: User },
];

const moreLinks = [
  { href: '/app/patient/doctor', label: 'My doctor', icon: Stethoscope },
  { href: '/app/patient/device', label: 'Device', icon: Bluetooth },
];

export function PatientShell({ children, name }: { children: ReactNode; name: string }) {
  const path = usePathname() || '/app/patient';
  const active =
    [...tabs].sort((a, b) => b.href.length - a.href.length).find((t) => path === t.href || path.startsWith(t.href + '/')) || tabs[0];

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--v-bg)',
        color: 'var(--v-text)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header className="v-patient-header">
        <div className="v-patient-header-inner">
          <Link href="/app/patient" className="v-patient-brand-desktop" style={{ display: 'inline-flex' }}>
            <VitalisBrand size="sm" />
          </Link>
          <span className="v-patient-logo-mobile">
            <VitalisLogo size="sm" />
          </span>
          <div className="v-patient-greeting" style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--v-text-muted)' }}>Hi,</div>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{name}</div>
          </div>

          <nav aria-label="Patient navigation (desktop)" className="v-patient-nav-desktop">
            {tabs.map((t) => {
              const isActive = active.href === t.href;
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`v-patient-nav-link ${isActive ? 'is-active' : ''}`}
                >
                  {t.label}
                </Link>
              );
            })}
            {moreLinks.map((t) => {
              const isActive = path.startsWith(t.href);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`v-patient-nav-link ${isActive ? 'is-active' : ''}`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>

          <ThemeToggle compact />
          <Link
            href="/app/patient/alerts"
            aria-label="Alerts"
            className="v-btn v-btn-ghost v-patient-alert-btn"
            style={{ padding: 8, minHeight: 36 }}
          >
            <Bell size={16} />
          </Link>
        </div>
      </header>

      <main className="v-patient-main">{children}</main>

      <nav aria-label="Patient navigation" className="v-patient-nav-mobile">
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${tabs.length}, 1fr)`,
            maxWidth: 720,
            marginInline: 'auto',
          }}
        >
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = active.href === t.href;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={isActive ? 'page' : undefined}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    padding: '10px 6px 14px',
                    fontSize: 11,
                    color: isActive ? 'var(--v-brand-2)' : 'var(--v-text-muted)',
                    fontWeight: isActive ? 600 : 500,
                    minHeight: 56,
                  }}
                >
                  <Icon size={20} />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <style jsx>{`
        .v-patient-header {
          position: sticky;
          top: 0;
          z-index: 10;
          background: color-mix(in oklab, var(--v-bg) 92%, transparent);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid var(--v-border);
        }
        .v-patient-header-inner {
          display: flex;
          align-items: center;
          gap: 10px;
          max-width: 720px;
          margin: 0 auto;
          padding: 12px 16px;
        }
        .v-patient-brand-desktop {
          display: none;
        }
        .v-patient-nav-desktop {
          display: none;
        }
        .v-patient-nav-desktop :global(.v-patient-nav-link) {
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 550;
          color: var(--v-text-muted);
          text-decoration: none;
        }
        .v-patient-nav-desktop :global(.v-patient-nav-link:hover) {
          background: var(--v-surface-2);
          color: var(--v-text);
        }
        .v-patient-nav-desktop :global(.v-patient-nav-link.is-active) {
          background: color-mix(in oklab, var(--v-brand-2) 12%, transparent);
          color: var(--v-text);
        }
        .v-patient-main {
          flex: 1;
          width: 100%;
          max-width: 720px;
          margin: 0 auto;
          padding: 16px 16px 96px;
        }
        .v-patient-nav-mobile {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: color-mix(in oklab, var(--v-surface) 96%, transparent);
          border-top: 1px solid var(--v-border);
          backdrop-filter: blur(10px);
          padding-bottom: env(safe-area-inset-bottom);
          z-index: 20;
        }
        /* Desktop/laptop: swap the phone-style chrome for a normal top-nav
           app layout instead of just stretching the mobile column wider. */
        @media (min-width: 960px) {
          .v-patient-header-inner {
            max-width: 1180px;
            padding: 14px 32px;
          }
          .v-patient-brand-desktop {
            display: inline-flex;
          }
          .v-patient-logo-mobile,
          .v-patient-greeting {
            display: none;
          }
          .v-patient-nav-desktop {
            display: flex;
            align-items: center;
            gap: 4px;
            margin-left: 24px;
          }
          .v-patient-main {
            max-width: 1180px;
            padding: 28px 32px 48px;
          }
          .v-patient-nav-mobile {
            display: none;
          }
          .v-patient-alert-btn {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

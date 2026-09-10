'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Bell,
  ChevronRight,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  ShieldCheck,
  Stethoscope,
  Users,
  Waves,
  X,
} from 'lucide-react';
import { VitalisBrand, VitalisLogo } from './brand';
import { ThemeToggle } from './theme-toggle';

type Item = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
};

const nav: Item[] = [
  { href: '/app/doctor', label: 'Overview', icon: LayoutDashboard },
  { href: '/app/doctor/patients', label: 'Patients', icon: Users },
  { href: '/app/doctor/monitoring', label: 'Live monitoring', icon: Waves },
  { href: '/app/doctor/alerts', label: 'Alerts', icon: Bell },
  { href: '/app/doctor/documents', label: 'Documents', icon: FileCheck2 },
  { href: '/app/doctor/security', label: 'Security center', icon: ShieldCheck },
  { href: '/app/doctor/notifications', label: 'Notifications', icon: Radio },
  { href: '/app/doctor/settings', label: 'Settings', icon: Stethoscope },
];

export function DoctorShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: { name: string; email: string };
}) {
  const path = usePathname() || '/app/doctor';
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = [...nav].sort((a, b) => b.href.length - a.href.length).find((n) => path.startsWith(n.href));
  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--v-bg)', color: 'var(--v-text)' }}>
      <aside
        className={`v-doctor-sidebar ${open ? 'is-open' : ''}`}
        aria-label="Primary navigation"
      >
        <div style={{ padding: '20px 18px 12px' }}>
          <Link href="/app/doctor" style={{ display: 'inline-flex' }}>
            <VitalisBrand size="sm" />
          </Link>
        </div>
        <div style={{ padding: '0 12px 6px' }}>
          <span
            style={{
              fontSize: 10,
              letterSpacing: '0.14em',
              color: 'var(--v-text-soft)',
              textTransform: 'uppercase',
              padding: '0 8px',
            }}
          >
            Clinical workspace
          </span>
        </div>
        <nav style={{ padding: '4px 10px', display: 'grid', gap: 2 }}>
          {nav.map((item) => {
            const Icon = item.icon;
            const isActive = active?.href === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`v-nav-item ${isActive ? 'is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div style={{ marginTop: 'auto', padding: 14 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: 10,
              borderTop: '1px solid var(--v-border)',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 999,
                background: 'var(--v-brand-gradient)',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                fontSize: 12,
                fontWeight: 700,
              }}
              aria-hidden="true"
            >
              {initials(user.name)}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 550,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user.name}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--v-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                Clinician
              </div>
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                aria-label="Sign out"
                className="v-btn v-btn-ghost"
                style={{ padding: 8, minHeight: 34 }}
              >
                <LogOut size={15} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header className="v-doctor-topbar">
          <button
            aria-label="Open navigation"
            className="v-btn v-btn-ghost v-menu-btn"
            onClick={() => setOpen(true)}
          >
            <Menu size={18} />
          </button>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: 'var(--v-text-muted)',
              fontSize: 13,
            }}
          >
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong style={{ color: 'var(--v-text)', fontWeight: 550 }}>
              {active?.label ?? 'Overview'}
            </strong>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className="v-badge"
              style={{ background: 'var(--v-success-bg)', color: 'var(--v-success)', border: 'none' }}
            >
              <span className="v-pulse-dot" /> Live stream
            </span>
            <ThemeToggle compact />
            <Link
              href="/app/doctor/notifications"
              aria-label="Notifications"
              className="v-btn v-btn-ghost"
              style={{ padding: 8, minHeight: 36 }}
            >
              <Bell size={16} />
            </Link>
          </div>
        </header>
        <main style={{ padding: 24, flex: 1, minWidth: 0 }} className="v-doctor-main">
          {children}
        </main>
      </div>

      {open && (
        <div
          className="v-doctor-scrim"
          role="button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Enter') setOpen(false);
          }}
          tabIndex={0}
        >
          <button
            aria-label="Close"
            className="v-btn v-btn-ghost"
            style={{ position: 'absolute', top: 16, right: 16, background: 'var(--v-surface)' }}
            onClick={() => setOpen(false)}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <style jsx>{`
        .v-doctor-sidebar {
          width: 240px;
          flex-shrink: 0;
          background: var(--v-surface);
          border-right: 1px solid var(--v-border);
          display: flex;
          flex-direction: column;
          position: sticky;
          top: 0;
          height: 100vh;
        }
        .v-doctor-topbar {
          height: 60px;
          background: var(--v-surface);
          border-bottom: 1px solid var(--v-border);
          display: flex;
          align-items: center;
          padding: 0 20px;
          gap: 14px;
          position: sticky;
          top: 0;
          z-index: 5;
        }
        .v-menu-btn {
          display: none;
        }
        .v-doctor-scrim {
          display: none;
        }
        :global(.v-nav-item) {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 12px;
          border-radius: 9px;
          color: var(--v-text-muted);
          font-size: 14px;
          font-weight: 500;
          text-decoration: none;
          transition: background 0.15s ease, color 0.15s ease;
        }
        :global(.v-nav-item:hover) {
          background: var(--v-surface-2);
          color: var(--v-text);
        }
        :global(.v-nav-item.is-active) {
          background: color-mix(in oklab, var(--v-brand-2) 12%, transparent);
          color: var(--v-text);
          box-shadow: inset 3px 0 0 var(--v-brand-2);
        }
        @media (max-width: 960px) {
          .v-doctor-sidebar {
            position: fixed;
            top: 0;
            left: 0;
            height: 100vh;
            transform: translateX(-100%);
            transition: transform 0.2s ease;
            z-index: 40;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
          }
          .v-doctor-sidebar.is-open {
            transform: translateX(0);
          }
          .v-menu-btn {
            display: inline-flex;
          }
          .v-doctor-scrim {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.45);
            z-index: 30;
          }
        }
        @media (max-width: 600px) {
          :global(.v-doctor-main) {
            padding: 16px !important;
          }
        }
      `}</style>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('') || 'DR';
}

'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';

type Theme = 'light' | 'dark' | 'system';

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem('vitalis-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore
  }
  return 'system';
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
    try {
      localStorage.removeItem('vitalis-theme');
    } catch {
      // ignore
    }
  } else {
    root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('vitalis-theme', theme);
    } catch {
      // ignore
    }
  }
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    setTheme(readTheme());
  }, []);
  function pick(next: Theme) {
    setTheme(next);
    apply(next);
  }
  const label = { light: 'Light', dark: 'Dark', system: 'Auto' }[theme];
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  function cycle() {
    pick(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system');
  }
  return (
    <button
      type="button"
      className="v-btn v-btn-ghost"
      onClick={cycle}
      aria-label={`Theme: ${label}. Click to change.`}
      style={{ padding: compact ? '8px' : '8px 12px', minHeight: 36 }}
    >
      <Icon size={16} aria-hidden="true" />
      {!compact && <span style={{ fontSize: 13 }}>{label}</span>}
    </button>
  );
}

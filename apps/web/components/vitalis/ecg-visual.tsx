'use client';
/**
 * Small ECG waveform SVG used decoratively on the landing hero.
 * Uses CSS variable colors so it stays theme-aware.
 */
export function EcgVisual({ height = 220 }: { height?: number }) {
  return (
    <svg
      viewBox="0 0 800 240"
      role="img"
      aria-label="ECG waveform"
      style={{ width: '100%', height, display: 'block' }}
    >
      <defs>
        <linearGradient id="v-ecg-gradient" x1="0" x2="1">
          <stop offset="0" stopColor="var(--v-brand-1)" />
          <stop offset="0.5" stopColor="var(--v-brand-2)" />
          <stop offset="1" stopColor="var(--v-brand-3)" />
        </linearGradient>
        <linearGradient id="v-ecg-fade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--v-brand-2)" stopOpacity="0.18" />
          <stop offset="1" stopColor="var(--v-brand-2)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g stroke="var(--v-border)" strokeWidth="1">
        {Array.from({ length: 6 }).map((_, i) => (
          <line key={`h-${i}`} x1="0" y1={40 * (i + 1)} x2="800" y2={40 * (i + 1)} strokeDasharray="2 6" opacity="0.4" />
        ))}
      </g>
      <path
        d="M0 130 L120 130 L150 100 L180 130 L220 130 L245 60 L275 200 L305 40 L335 130 L500 130 L525 100 L555 130 L620 130 L645 60 L675 200 L705 40 L735 130 L800 130"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="v-ecg"
      />
      <path
        d="M0 130 L120 130 L150 100 L180 130 L220 130 L245 60 L275 200 L305 40 L335 130 L500 130 L525 100 L555 130 L620 130 L645 60 L675 200 L705 40 L735 130 L800 130 L800 240 L0 240 Z"
        fill="url(#v-ecg-fade)"
      />
    </svg>
  );
}

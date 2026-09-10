import Image from 'next/image';

type Size = 'sm' | 'md' | 'lg' | 'xl';
const px: Record<Size, number> = { sm: 22, md: 30, lg: 44, xl: 72 };

export function VitalisLogo({ size = 'md', alt = 'VITALIS' }: { size?: Size; alt?: string }) {
  const s = px[size];
  return (
    <Image
      src="/vitalis-logo.svg"
      alt={alt}
      width={s}
      height={s}
      priority
      style={{ display: 'block', borderRadius: Math.round(s * 0.22), boxShadow: '0 4px 12px rgba(23, 60, 255, 0.18)' }}
    />
  );
}

export function VitalisBrand({
  size = 'md',
  tone = 'auto',
}: {
  size?: Size;
  tone?: 'auto' | 'light' | 'dark';
}) {
  const fontSize = size === 'sm' ? 16 : size === 'md' ? 20 : size === 'lg' ? 28 : 40;
  const color = tone === 'auto' ? 'var(--v-text)' : tone === 'light' ? '#fff' : '#0f172a';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size === 'sm' ? 8 : 12,
        color,
      }}
    >
      <VitalisLogo size={size} />
      <span
        style={{
          fontWeight: 720,
          fontSize,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        VITALIS
      </span>
    </span>
  );
}

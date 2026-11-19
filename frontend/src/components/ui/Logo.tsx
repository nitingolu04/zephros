interface LogoProps {
  size?: number
  withWordmark?: boolean
  className?: string
}

/** Zephros mark: an ink tile with a single hand-drawn stroke ending in a marker dot. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect width="32" height="32" rx="9" fill="var(--color-ink)" />
      <path d="M8 21.5c2.6-6.4 5.2-10.5 7.4-10.5 2.4 0 1.2 9.2 3.8 9.2 1.6 0 2.9-2.4 4.2-5"
        fill="none" stroke="var(--color-ink-foreground)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="23.6" cy="14.6" r="2.4" fill="var(--color-accent)" />
    </svg>
  )
}

export default function Logo({ size = 28, withWordmark = true, className }: LogoProps) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <LogoMark size={size} />
      {withWordmark && (
        <span style={{ fontSize: Math.round(size * 0.62), fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--color-foreground)' }}>
          Zephros
        </span>
      )}
    </span>
  )
}

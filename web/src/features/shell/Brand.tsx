import { APP_NAME } from '@/config'

/** The Wealthboard mark: a rising ledger line ending in a brass dot. Drawn from tokens. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden className="shrink-0">
      <rect width="512" height="512" rx="112" style={{ fill: 'var(--accent)' }} />
      <path d="M104 360 L408 360" fill="none" style={{ stroke: 'var(--on-accent)' }} strokeOpacity=".35" strokeWidth="16" strokeLinecap="round" />
      <path d="M112 176 L176 312 L240 216 L304 296 L392 136" fill="none" style={{ stroke: 'var(--on-accent)' }} strokeWidth="36" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="392" cy="136" r="28" style={{ fill: 'var(--gold)' }} />
    </svg>
  )
}

export function BrandName({ name = APP_NAME, className }: { name?: string; className?: string }) {
  return <span className={`display text-[1.1875rem] font-medium tracking-[-0.01em] text-ink ${className ?? ''}`}>{name}</span>
}

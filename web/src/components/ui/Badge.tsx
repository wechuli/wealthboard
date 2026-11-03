import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type Tone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info' | 'accent'

const tones: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted border-line',
  positive: 'bg-positive-soft text-positive border-transparent',
  negative: 'bg-negative-soft text-negative border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  info: 'bg-info-soft text-info border-transparent',
  accent: 'bg-accent-soft text-accent border-transparent',
}

export function Badge({ tone = 'neutral', icon, children, className, title }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs font-medium', tones[tone], className)}>
      {icon}
      {children}
    </span>
  )
}

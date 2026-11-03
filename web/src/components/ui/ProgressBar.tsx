import { cn } from '@/lib/cn'

/** Goal progress. `percent` is a decimal string from the server; clamped for drawing only. */
export function ProgressBar({ percent, tone = 'accent', incomplete, label, className }: { percent: string; tone?: 'accent' | 'warning' | 'positive' | 'muted'; incomplete?: boolean; label: string; className?: string }) {
  const n = Math.max(0, Math.min(100, Number(percent) || 0))
  const fill = { accent: 'bg-accent', warning: 'bg-warning', positive: 'bg-positive', muted: 'bg-line-strong' }[tone]
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={incomplete ? undefined : n}
      aria-valuetext={incomplete ? 'Incomplete' : `${percent}%`}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-sunken', incomplete && 'outline-dashed outline-1 outline-warning', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-[var(--dur-3)] ease-out', fill, incomplete && 'opacity-50')} style={{ width: `${n}%` }} />
    </div>
  )
}

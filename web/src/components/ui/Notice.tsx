import { AlertTriangle, Info, CheckCircle2, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

const styles = {
  warning: { box: 'bg-warning-soft border-warning/30 text-ink', icon: <AlertTriangle aria-hidden size={18} className="text-warning" /> },
  info: { box: 'bg-info-soft border-info/25 text-ink', icon: <Info aria-hidden size={18} className="text-info" /> },
  positive: { box: 'bg-positive-soft border-positive/25 text-ink', icon: <CheckCircle2 aria-hidden size={18} className="text-positive" /> },
  negative: { box: 'bg-negative-soft border-negative/25 text-ink', icon: <XCircle aria-hidden size={18} className="text-negative" /> },
} as const

/** Inline notice: title plus explanation plus an optional fix action. */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
  role,
}: {
  tone?: keyof typeof styles
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
  role?: 'status' | 'alert'
}) {
  const s = styles[tone]
  return (
    <div role={role} className={cn('flex flex-wrap items-start gap-3 rounded-md border px-3.5 py-3 text-sm', s.box, className)}>
      <span className="mt-px shrink-0">{s.icon}</span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-medium">{title}</p>
        {children ? <div className="mt-0.5 text-muted">{children}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2 self-center">{action}</div> : null}
    </div>
  )
}

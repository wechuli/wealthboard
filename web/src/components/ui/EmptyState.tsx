import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Empty state that teaches: what goes here, why it matters, and the first action. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
  compact,
}: {
  icon?: ReactNode
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'px-4 py-8' : 'px-6 py-14', className)}>
      {icon ? <div className="mb-4 grid size-12 place-items-center rounded-full bg-accent-soft text-accent">{icon}</div> : null}
      <h3 className="text-md font-semibold text-ink">{title}</h3>
      {children ? <div className="mt-1.5 max-w-[46ch] text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  )
}

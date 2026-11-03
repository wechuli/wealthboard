import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Page title (Fraunces), optional supporting line, and actions that wrap below on small screens. */
export function PageHeader({ title, description, actions, back, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode; className?: string }) {
  return (
    <header className={cn('mb-6 md:mb-8', className)}>
      {back ? <div className="mb-3">{back}</div> : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="display text-xl text-ink md:text-[1.875rem] md:leading-[2.25rem]">{title}</h1>
          {description ? <div className="mt-1.5 max-w-[68ch] text-base text-muted">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}

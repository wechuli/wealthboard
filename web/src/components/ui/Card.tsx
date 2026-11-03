import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Card({ className, as: As = 'section', ...rest }: HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article' | 'aside' }) {
  return <As className={cn('card', className)} {...rest} />
}

/** Card header: a real heading (level configurable), optional description and trailing action. */
export function CardHeader({
  title,
  description,
  action,
  level = 2,
  id,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  level?: 2 | 3
  id?: string
  className?: string
}) {
  const H = level === 2 ? 'h2' : 'h3'
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 md:px-5 md:pt-5', className)}>
      <div className="min-w-0">
        <H id={id} className="text-md font-semibold text-ink">
          {title}
        </H>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  )
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 pb-4 pt-3 md:px-5 md:pb-5', className)} {...rest} />
}

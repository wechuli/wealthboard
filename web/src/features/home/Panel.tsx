import { ChevronDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { useIsMdUp } from '@/features/insights/common'

/**
 * A Home panel. Secondary panels collapse to a one-line teaser below 768 px so net worth, goals,
 * and quick actions stay at the top on phones; from tablet up they are always open.
 */
export function Panel({
  title,
  description,
  teaser,
  action,
  collapsible,
  className,
  bodyClassName,
  children,
}: {
  title: string
  description?: ReactNode
  /** One-line summary shown while collapsed on mobile. */
  teaser?: ReactNode
  action?: ReactNode
  collapsible?: boolean
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  const isMd = useIsMdUp()
  const [open, setOpen] = useState(false)
  const id = useId()
  const canCollapse = !!collapsible && !isMd
  const expanded = !canCollapse || open
  const headingId = `${id}-h`
  const bodyId = `${id}-b`
  return (
    <Card aria-labelledby={headingId} className={className}>
      <CardHeader
        id={headingId}
        className={cn(canCollapse && '[&>div:first-child]:flex-1', !expanded && 'pb-4')}
        title={
          canCollapse ? (
            <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)} className="-my-2 flex min-h-11 w-full items-center justify-between gap-3 text-left">
              <span>{title}</span>
              <ChevronDown size={18} aria-hidden className={cn('shrink-0 text-muted transition-transform duration-[var(--dur-2)]', open && 'rotate-180')} />
            </button>
          ) : (
            title
          )
        }
        description={expanded ? description : teaser ?? description}
        action={expanded ? action : undefined}
      />
      {expanded ? (
        <CardBody id={bodyId} className={bodyClassName}>
          {children}
        </CardBody>
      ) : (
        <div id={bodyId} hidden />
      )}
    </Card>
  )
}

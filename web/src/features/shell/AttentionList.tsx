import { AlertTriangle, ArrowRight, Clock, Info, Target } from 'lucide-react'
import { Link } from 'react-router'
import type { AttentionItem } from '@/api/extensions'
import { cn } from '@/lib/cn'
import { DateText } from '@/components/format'

const ICON = {
  missing_rate: AlertTriangle,
  missing_price: AlertTriangle,
  stale_price: Clock,
  stale_rate: Info,
  goal_behind: Target,
} as const

/** The "needs attention" list, shared by the top-bar popover and the Home attention panel. */
export function AttentionList({ items, compact }: { items: AttentionItem[]; compact?: boolean }) {
  if (items.length === 0)
    return (
      <p className="px-3 py-6 text-center text-sm text-muted">
        Everything is up to date. Prices, rates, and goals are all current.
      </p>
    )
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = ICON[item.kind]
        return (
          <li key={item.id}>
            <div className={cn('flex gap-3 rounded-md px-3 py-2.5', !compact && 'border border-line bg-surface')}>
              <span
                className={cn(
                  'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full',
                  item.severity === 'warning' ? 'bg-warning-soft text-warning' : item.kind === 'goal_behind' ? 'bg-accent-soft text-accent' : 'bg-info-soft text-info',
                )}
              >
                <Icon size={15} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{item.title}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {item.detail}
                  {item.since && item.kind.startsWith('missing') ? (
                    <>
                      {' '}
                      Affects values since <DateText value={item.since} />.
                    </>
                  ) : null}
                </p>
                <Link to={item.fix.href} className="mt-1.5 inline-flex min-h-8 items-center gap-1 text-sm font-medium text-accent hover:underline">
                  {item.fix.label}
                  <ArrowRight size={14} aria-hidden />
                </Link>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface HBarItem {
  id: string
  label: ReactNode
  /** 0–100 geometry width (from a server-provided percent string). */
  percent: number
  color: string
  value: ReactNode
  meta?: ReactNode
  incomplete?: boolean
  excluded?: boolean
}

/** Horizontal share bars: an accessible list that doubles as an interactive legend. */
export function HBarList({ items, onToggle, ariaLabel, onSelect }: { items: HBarItem[]; ariaLabel: string; onToggle?: (id: string) => void; onSelect?: (id: string) => void }) {
  return (
    <ul aria-label={ariaLabel} className="flex flex-col">
      {items.map((it) => (
        <li key={it.id} className={cn('group border-t border-line py-2.5 first:border-t-0', it.excluded && 'opacity-55')}>
          <div className="flex items-center gap-3">
            {onToggle ? (
              <button
                type="button"
                onClick={() => onToggle(it.id)}
                aria-pressed={!it.excluded}
                aria-label={`${it.excluded ? 'Include' : 'Exclude'} ${typeof it.label === 'string' ? it.label : 'item'}`}
                className="grid size-11 shrink-0 place-items-center rounded-md hover:bg-sunken md:size-8"
              >
                <span className={cn('size-3.5 rounded-[4px] border-2')} style={{ borderColor: it.color, background: it.excluded ? 'transparent' : it.color }} />
              </button>
            ) : (
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: it.color }} />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                {onSelect && !it.excluded ? (
                  <button type="button" onClick={() => onSelect(it.id)} className="min-w-0 truncate text-left text-sm font-medium text-ink hover:underline">
                    {it.label}
                  </button>
                ) : (
                  <span className={cn('min-w-0 truncate text-sm font-medium text-ink', it.excluded && 'line-through decoration-1')}>{it.label}</span>
                )}
                <span className="shrink-0 text-sm">{it.value}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                  <div className={cn('h-full rounded-full transition-[width] duration-[var(--dur-3)] ease-out', it.incomplete && 'opacity-50')} style={{ width: `${it.excluded ? 0 : Math.max(0.5, it.percent)}%`, background: it.color }} />
                </div>
                {it.meta ? <span className="w-14 shrink-0 text-right text-xs text-muted">{it.meta}</span> : null}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
import type { AISource } from '@/api/types'
import { IconButton } from '@/components/ui/Button'
import { inputClass } from '@/components/ui/Field'
import { cn } from '@/lib/cn'

const PAGE_SIZE = 10

/** Extracted sections with include/exclude and in-place redaction. Any change here clears consent upstream. */
export function SourceUnits({
  source,
  selected,
  disabled,
  onSelect,
  onSelectAll,
  onEdit,
}: {
  source: AISource
  selected: ReadonlySet<string>
  disabled?: boolean
  onSelect(id: string, include: boolean): void
  onSelectAll(include: boolean): void
  onEdit(id: string, text: string): void
}) {
  const [page, setPage] = useState(0)
  const baseId = useId()
  const total = source.units.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const visible = source.units.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const all = selected.size === total

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex min-h-11 items-center gap-2.5 text-sm font-medium text-ink">
          <input type="checkbox" checked={all} disabled={disabled} onChange={(e) => onSelectAll(e.target.checked)} className="size-5 accent-[var(--accent)]" />
          Include all {total} sections
        </label>
        <p className="num text-xs text-muted" aria-live="polite">
          {selected.size} selected · {total - selected.size} excluded
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {visible.map((unit) => {
          const on = selected.has(unit.id)
          const textId = `${baseId}-${unit.id}`
          return (
            <li key={unit.id} className={cn('rounded-lg border p-3 transition-colors duration-[var(--dur-1)]', on ? 'border-line bg-surface' : 'border-dashed border-line-strong/60 bg-sunken/40')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex min-h-11 min-w-0 items-center gap-2.5 text-sm md:min-h-9">
                  <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onSelect(unit.id, e.target.checked)} className="size-5 shrink-0 accent-[var(--accent)]" />
                  <span className="min-w-0 truncate font-medium text-ink">{unit.location}</span>
                  <span className="shrink-0 font-mono text-xs text-subtle">{unit.id}</span>
                </label>
                {!on ? <span className="text-xs text-muted">Not sent</span> : null}
              </div>
              <label htmlFor={textId} className="sr-only">
                Text to send for {unit.id}
              </label>
              <textarea
                id={textId}
                value={unit.text}
                disabled={disabled || !on}
                spellCheck={false}
                rows={Math.min(8, Math.max(3, unit.text.split('\n').length))}
                onChange={(e) => onEdit(unit.id, e.target.value)}
                className={cn(inputClass, 'mt-2 h-auto py-2 font-mono text-xs leading-5 md:h-auto')}
              />
            </li>
          )
        })}
      </ul>
      {pageCount > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <IconButton label="Previous sections" icon={<ChevronLeft size={18} aria-hidden />} variant="secondary" disabled={current === 0} onClick={() => setPage(current - 1)} />
          <span className="num min-w-20 text-center text-sm text-muted">
            {current + 1} of {pageCount}
          </span>
          <IconButton label="Next sections" icon={<ChevronRight size={18} aria-hidden />} variant="secondary" disabled={current + 1 >= pageCount} onClick={() => setPage(current + 1)} />
        </div>
      ) : null}
    </div>
  )
}

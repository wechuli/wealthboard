import { Table2, LineChart } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface ChartTable {
  caption: string
  columns: { label: string; align?: 'left' | 'right' }[]
  rows: ReactNode[][]
}

/**
 * Wraps every chart: a screen-reader summary, an optional visible caption, a "View as table"
 * alternative, a designed empty state for sparse history, and a fixed height (no layout shift).
 */
export function ChartFrame({
  summary,
  table,
  height,
  empty,
  children,
  toolbar,
  className,
  caption,
}: {
  /** Short text summary of what the chart shows (announced to screen readers). */
  summary: string
  table?: ChartTable
  height: number
  /** When set, replaces the chart with this designed empty state. */
  empty?: ReactNode
  children: ReactNode
  toolbar?: ReactNode
  className?: string
  caption?: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  const id = useId()
  return (
    <figure className={cn('relative m-0', className)} aria-describedby={`${id}-summary`}>
      <p id={`${id}-summary`} className="sr-only">
        {summary}
      </p>
      {(toolbar || table) && !empty ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2" data-no-print>
          <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
          {table ? (
            <button
              type="button"
              onClick={() => setAsTable((v) => !v)}
              aria-pressed={asTable}
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted hover:bg-sunken hover:text-ink"
            >
              {asTable ? <LineChart size={14} aria-hidden /> : <Table2 size={14} aria-hidden />}
              {asTable ? 'View as chart' : 'View as table'}
            </button>
          ) : null}
        </div>
      ) : null}
      {empty ? (
        <div style={{ minHeight: height }} className="grid place-items-center rounded-md border border-dashed border-line bg-sunken/40">
          {empty}
        </div>
      ) : asTable && table ? (
        <div className="scroll-x max-h-[420px] overflow-y-auto rounded-md border border-line" style={{ minHeight: height }}>
          <table className="w-full text-sm">
            <caption className="sr-only">{table.caption}</caption>
            <thead className="sticky top-0 bg-sunken text-xs text-muted">
              <tr>
                {table.columns.map((c) => (
                  <th key={c.label} scope="col" className={cn('px-3 py-2 font-medium', c.align === 'right' ? 'text-right' : 'text-left')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((cell, j) => (
                    <td key={j} className={cn('px-3 py-2', table.columns[j]?.align === 'right' ? 'text-right' : 'text-left')}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
      {caption ? <figcaption className="mt-2 text-xs text-muted">{caption}</figcaption> : null}
    </figure>
  )
}

/** Designed empty state for charts with too little history. */
export function ChartEmpty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="max-w-[40ch] px-6 py-8 text-center">
      {icon ? <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-surface text-subtle">{icon}</div> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children ? <p className="mt-1 text-xs text-muted">{children}</p> : null}
    </div>
  )
}

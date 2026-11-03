import { scaleLinear } from 'd3-scale'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { TOKENS } from './utils'

export interface BridgeStep {
  id: string
  label: string
  /** Geometry value. Totals are absolute; deltas are signed changes. */
  value: number
  kind: 'total' | 'delta'
  /** Display text re-formatted from the original minor-unit string. */
  display: ReactNode
  hint?: string
}

/**
 * Horizontal bridge (waterfall): start value → each driver → end value. Rows read top to bottom
 * so it works at 360 px. The running position is chart geometry only; displayed figures come
 * from the server's strings.
 */
export function BridgeChart({ steps, ariaLabel }: { steps: BridgeStep[]; ariaLabel: string }) {
  const bars: (BridgeStep & { from: number; to: number })[] = []
  for (const s of steps) {
    const prev = bars.at(-1)?.to ?? 0
    bars.push(s.kind === 'total' ? { ...s, from: 0, to: s.value } : { ...s, from: prev, to: prev + s.value })
  }
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)))
  const hi = Math.max(0, ...bars.map((b) => Math.max(b.from, b.to)))
  const x = scaleLinear().domain([lo, hi || 1]).range([0, 100])

  return (
    <ol aria-label={ariaLabel} className="flex flex-col gap-1.5">
      {bars.map((b, i) => {
        const left = x(Math.min(b.from, b.to))
        const w = Math.max(0.6, Math.abs(x(b.to) - x(b.from)))
        const color = b.kind === 'total' ? TOKENS.accent : b.value >= 0 ? TOKENS.positive : TOKENS.negative
        return (
          <li key={b.id} className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-center gap-3 sm:grid-cols-[11rem_1fr_auto]">
            <div className="min-w-0">
              <p className={cn('truncate text-sm', b.kind === 'total' ? 'font-semibold text-ink' : 'text-muted')}>{b.label}</p>
              <p className="text-sm sm:hidden">{b.display}</p>
            </div>
            <div className="relative h-7">
              {i > 0 ? <span aria-hidden className="absolute -top-1.5 h-1.5 border-l border-dashed" style={{ left: `${x(b.from)}%`, borderColor: TOKENS.axis }} /> : null}
              <span
                aria-hidden
                className="absolute top-1 h-5 rounded-[4px] transition-[left,width] duration-[var(--dur-3)] ease-out"
                style={{ left: `${left}%`, width: `${w}%`, background: color, opacity: b.kind === 'total' ? 0.9 : 0.85 }}
              />
            </div>
            <p className={cn('hidden text-right text-sm sm:block', b.kind === 'total' && 'font-semibold')} title={b.hint}>
              {b.display}
            </p>
          </li>
        )
      })}
    </ol>
  )
}

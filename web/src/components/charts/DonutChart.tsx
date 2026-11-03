import { arc as d3arc, pie as d3pie } from 'd3-shape'
import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { TOKENS } from './utils'

export interface DonutItem {
  id: string
  label: string
  /** Geometry only. */
  value: number
  color: string
}

/** Donut with hover/focus highlight and optional drill-down on click. */
export function DonutChart({
  items,
  size = 220,
  center,
  activeId,
  onActiveChange,
  onSelect,
  ariaLabel,
}: {
  items: DonutItem[]
  size?: number
  center?: ReactNode
  activeId?: string | null
  onActiveChange?: (id: string | null) => void
  onSelect?: (id: string) => void
  ariaLabel: string
}) {
  const [hover, setHover] = useState<string | null>(null)
  const current = activeId ?? hover
  const arcs = useMemo(() => {
    const pie = d3pie<DonutItem>()
      .value((d) => Math.max(0, d.value))
      .sort(null)
      .padAngle(items.length > 1 ? 0.012 : 0)
    return pie(items)
  }, [items])
  const r = size / 2
  const arc = d3arc<(typeof arcs)[number]>()
    .innerRadius(r * 0.64)
    .outerRadius(r - 6)
    .cornerRadius(3)
  const arcHover = d3arc<(typeof arcs)[number]>()
    .innerRadius(r * 0.62)
    .outerRadius(r - 1)
    .cornerRadius(3)
  const set = (id: string | null) => {
    setHover(id)
    onActiveChange?.(id)
  }
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`${-r} ${-r} ${size} ${size}`} role="img" aria-label={ariaLabel}>
        {arcs.length === 0 ? <circle r={r * 0.82} fill="none" style={{ stroke: TOKENS.grid }} strokeWidth={r * 0.34} /> : null}
        {arcs.map((a) => {
          const on = current === a.data.id
          const dim = current !== null && !on
          return (
            <path
              key={a.data.id}
              d={(on ? arcHover(a) : arc(a)) ?? ''}
              style={{ fill: a.data.color, transition: 'opacity var(--dur-2) var(--ease-out)' }}
              opacity={dim ? 0.35 : 1}
              className={cn(onSelect && 'cursor-pointer')}
              onPointerEnter={() => set(a.data.id)}
              onPointerLeave={() => set(null)}
              onClick={() => onSelect?.(a.data.id)}
            />
          )
        })}
      </svg>
      {center ? <div className="pointer-events-none absolute inset-0 grid place-items-center px-8 text-center">{center}</div> : null}
    </div>
  )
}

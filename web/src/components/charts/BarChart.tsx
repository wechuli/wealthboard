import { scaleBand, scaleLinear } from 'd3-scale'
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { usePrivacy } from '@/lib/privacy'
import { axisLabels, TOKENS, useElementWidth } from './utils'

export interface BarDatum {
  key: string
  label: string
  /** Stack segments in geometry units; negatives stack downward from zero. */
  segments: { seriesId: string; value: number }[]
  complete?: boolean
}

export interface BarSeries {
  id: string
  label: string
  color: string
}

/** Monthly bars: stacked and diverging around zero. Used for change bars and contribution stacks. */
export function BarChart({
  data,
  series,
  height,
  ariaLabel,
  renderTooltip,
  colorBySign,
}: {
  data: BarDatum[]
  series: BarSeries[]
  height: number
  ariaLabel: string
  renderTooltip?: (index: number) => ReactNode
  /** Single-series mode: colour each bar by its sign (gains vs losses). */
  colorBySign?: boolean
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const { hidden } = usePrivacy()
  const [active, setActive] = useState<number | null>(null)
  const left = width < 480 ? 40 : 52
  const M = { top: 10, right: 8, bottom: 26 }

  const geo = useMemo(() => {
    if (width === 0 || data.length === 0) return null
    let lo = 0
    let hi = 0
    for (const d of data) {
      let pos = 0
      let neg = 0
      for (const s of d.segments) {
        if (s.value >= 0) pos += s.value
        else neg += s.value
      }
      hi = Math.max(hi, pos)
      lo = Math.min(lo, neg)
    }
    if (lo === hi) hi = 1
    const innerW = Math.max(10, width - left - M.right)
    const innerH = height - M.top - M.bottom
    const x = scaleBand<string>()
      .domain(data.map((d) => d.key))
      .range([0, innerW])
      .padding(data.length > 18 ? 0.22 : 0.32)
    const y = scaleLinear().domain([lo, hi]).range([innerH, 0]).nice(4)
    return { x, y, innerW, innerH }
  }, [data, width, height, left, M.right, M.top, M.bottom])

  const labelEvery = geo ? Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(geo.innerW / 56)))) : 1
  const colorOf = (id: string) => series.find((s) => s.id === id)?.color ?? TOKENS.muted

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    setActive((cur) => {
      const base = cur ?? (e.key === 'ArrowRight' ? -1 : data.length)
      return Math.max(0, Math.min(data.length - 1, base + (e.key === 'ArrowRight' ? 1 : -1)))
    })
  }

  const activeX = active !== null && geo ? (geo.x(data[active]!.key) ?? 0) + left + geo.x.bandwidth() / 2 : 0

  return (
    // Keyboard-operable chart region; screen readers also get a summary and a table alternative.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={ref}
      className="relative h-full w-full touch-pan-y rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      role="group"
      aria-label={`${ariaLabel}. Use the left and right arrow keys to read values.`}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
      onPointerLeave={() => setActive(null)}
    >
      {geo ? (
        <svg width={width} height={height} aria-hidden className="block">
          <g transform={`translate(${left},${M.top})`}>
            {(() => {
              const ticks = geo.y.ticks(4)
              const labels = axisLabels(ticks, hidden)
              return ticks.map((t, i) => (
                <g key={t} transform={`translate(0,${geo.y(t)})`}>
                  <line x2={geo.innerW} style={{ stroke: t === 0 ? TOKENS.axis : TOKENS.grid }} strokeWidth={t === 0 ? 1.25 : 1} />
                  <text x={-8} dy="0.32em" textAnchor="end" className="num" style={{ fill: TOKENS.axis, fontSize: 11 }}>
                    {labels[i]}
                  </text>
                </g>
              ))
            })()}
            {data.map((d, i) => {
              const bx = geo.x(d.key) ?? 0
              const bw = geo.x.bandwidth()
              let pos = 0
              let neg = 0
              return (
                <g key={d.key} opacity={active === null || active === i ? 1 : 0.45} onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)}>
                  <rect x={bx - 2} width={bw + 4} y={0} height={geo.innerH} fill="transparent" />
                  {d.segments.map((s, j) => {
                    if (s.value === 0) return null
                    const from = s.value >= 0 ? pos : neg
                    const to = from + s.value
                    if (s.value >= 0) pos = to
                    else neg = to
                    const y1 = geo.y(Math.max(from, to))
                    const h = Math.max(1, Math.abs(geo.y(from) - geo.y(to)))
                    const fill = colorBySign ? (s.value >= 0 ? TOKENS.positive : TOKENS.negative) : colorOf(s.seriesId)
                    return (
                      <rect
                        key={j}
                        x={bx}
                        y={y1}
                        width={bw}
                        height={h}
                        rx={Math.min(3, bw / 4)}
                        style={{ fill, stroke: d.complete === false ? TOKENS.warning : undefined }}
                        strokeDasharray={d.complete === false ? '3 2' : undefined}
                        fillOpacity={d.complete === false ? 0.45 : 1}
                      />
                    )
                  })}
                  {i % labelEvery === 0 ? (
                    <text x={bx + bw / 2} y={geo.innerH + 18} textAnchor="middle" style={{ fill: TOKENS.axis, fontSize: 11 }}>
                      {d.label}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </g>
        </svg>
      ) : null}
      {active !== null && renderTooltip ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute z-10 min-w-48 max-w-[min(280px,85%)] rounded-md border border-line bg-raised px-3 py-2 text-sm shadow-e2"
          style={{ top: 0, ...(activeX > width / 2 ? { right: width - activeX + 10 } : { left: activeX + 10 }) }}
        >
          {renderTooltip(active)}
        </div>
      ) : null}
    </div>
  )
}

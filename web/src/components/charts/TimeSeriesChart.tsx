import { bisector, extent, max, min } from 'd3-array'
import { scaleLinear, scaleTime } from 'd3-scale'
import { area as d3area, curveMonotoneX, line as d3line } from 'd3-shape'
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { usePrivacy } from '@/lib/privacy'
import { cn } from '@/lib/cn'
import { axisLabels, distinctTicks, timeTickFormat, toDate, TOKENS, useElementWidth } from './utils'

export interface TSPoint {
  date: string
  /** Chart geometry only. Labels re-format from the original strings in renderTooltip. */
  value: number
  complete?: boolean
}

export interface TSSeries {
  id: string
  label: string
  color: string
  points: TSPoint[]
  area?: boolean
  dashed?: boolean
  width?: number
}

export interface TSMarker {
  date: string
  seriesId: string
  kind: 'valuation' | 'buy' | 'sell' | 'high' | 'event'
  label: string
}

export interface TimeSeriesChartProps {
  series: TSSeries[]
  height: number
  ariaLabel: string
  markers?: TSMarker[]
  /** Shaded ranges, for example stale price periods. */
  bands?: { from: string; to: string; label: string }[]
  refLines?: { value: number; label: string; color?: string }[]
  vLines?: { date: string; label: string }[]
  /** Tooltip body for the hovered index of the first series. */
  renderTooltip?: (index: number) => ReactNode
  includeZero?: boolean
  className?: string
}

const M = { top: 14, right: 14, bottom: 26 }

interface Segment {
  complete: boolean
  points: TSPoint[]
}

/** Splits a series into solid (complete) and dashed (incomplete) runs. */
export function splitSegments(points: TSPoint[]): Segment[] {
  const segs: Segment[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const complete = a.complete !== false && b.complete !== false
    const last = segs.at(-1)
    if (last && last.complete === complete) last.points.push(b)
    else segs.push({ complete, points: [a, b] })
  }
  if (points.length === 1) segs.push({ complete: points[0]!.complete !== false, points })
  return segs
}

export function TimeSeriesChart({ series, height, ariaLabel, markers = [], bands = [], refLines = [], vLines = [], renderTooltip, includeZero, className }: TimeSeriesChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const { hidden } = usePrivacy()
  const [active, setActive] = useState<number | null>(null)
  const primary = series[0]
  const left = width < 480 ? 40 : 52

  const geo = useMemo(() => {
    const all = series.flatMap((s) => s.points)
    if (!primary || all.length === 0 || width === 0) return null
    const dates = all.map((p) => toDate(p.date))
    for (const b of bands) dates.push(toDate(b.from), toDate(b.to))
    for (const v of vLines) dates.push(toDate(v.date))
    const [x0, x1] = extent(dates) as [Date, Date]
    const values = all.map((p) => p.value).concat(refLines.map((r) => r.value))
    let lo = min(values) ?? 0
    let hi = max(values) ?? 1
    if (includeZero) {
      lo = Math.min(lo, 0)
      hi = Math.max(hi, 0)
    }
    if (lo === hi) {
      lo -= Math.abs(lo) * 0.1 || 1
      hi += Math.abs(hi) * 0.1 || 1
    }
    const pad = (hi - lo) * 0.08
    const innerW = Math.max(10, width - left - M.right)
    const innerH = height - M.top - M.bottom
    const x = scaleTime().domain([x0, x1]).range([0, innerW])
    const y = scaleLinear()
      .domain([lo >= 0 && (includeZero || lo - pad < 0) ? 0 : lo - pad, hi + pad])
      .range([innerH, 0])
      .nice(4)
    const spanDays = (x1.getTime() - x0.getTime()) / 86_400_000
    return { x, y, innerW, innerH, spanDays }
  }, [series, primary, width, height, bands, vLines, refLines, includeZero, left])

  const primaryDates = useMemo(() => primary?.points.map((p) => toDate(p.date)) ?? [], [primary])

  const pickIndex = (px: number) => {
    if (!geo || primaryDates.length === 0) return null
    const d = geo.x.invert(px)
    const i = bisector((v: Date) => v).center(primaryDates, d)
    return Math.max(0, Math.min(primaryDates.length - 1, i))
  }

  const onKey = (e: KeyboardEvent) => {
    if (!primary) return
    const n = primary.points.length
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      setActive((cur) => {
        const base = cur ?? (e.key === 'ArrowRight' ? -1 : n)
        return Math.max(0, Math.min(n - 1, base + (e.key === 'ArrowRight' ? 1 : -1)))
      })
    } else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(n - 1)
    else if (e.key === 'Escape') setActive(null)
  }

  const activePoint = active !== null ? primary?.points[active] : undefined
  const ax = activePoint && geo ? geo.x(toDate(activePoint.date)) + left : 0

  return (
    // Keyboard-operable chart region; screen readers also get a summary and a table alternative.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={ref}
      className={cn('relative h-full w-full touch-pan-y select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/40', className)}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      role="group"
      aria-label={`${ariaLabel}. Use the left and right arrow keys to read values.`}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
    >
      {geo && primary ? (
        <svg width={width} height={height} aria-hidden className="block overflow-visible">
          <defs>
            {series
              .filter((s) => s.area)
              .map((s) => (
                <linearGradient key={s.id} id={`ts-grad-${s.id}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 0.2 }} />
                  <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0 }} />
                </linearGradient>
              ))}
          </defs>
          <g transform={`translate(${left},${M.top})`}>
            {bands.map((b, i) => {
              const bx = geo.x(toDate(b.from))
              const bw = Math.max(1, geo.x(toDate(b.to)) - bx)
              return <rect key={i} x={bx} y={0} width={bw} height={geo.innerH} style={{ fill: TOKENS.warningSoft }} opacity={0.85} />
            })}
            {(() => {
              const ticks = geo.y.ticks(4)
              const labels = axisLabels(ticks, hidden)
              return ticks.map((t, i) => (
                <g key={t} transform={`translate(0,${geo.y(t)})`}>
                  <line x2={geo.innerW} style={{ stroke: TOKENS.grid }} strokeWidth={1} />
                  <text x={-8} dy="0.32em" textAnchor="end" className="num" style={{ fill: TOKENS.axis, fontSize: 11 }}>
                    {labels[i]}
                  </text>
                </g>
              ))
            })()}
            {distinctTicks(geo.x.ticks(Math.max(2, Math.floor(geo.innerW / 96))), timeTickFormat(geo.spanDays)).map(({ tick, label }) => (
              <text key={tick.getTime()} x={geo.x(tick)} y={geo.innerH + 18} textAnchor="middle" style={{ fill: TOKENS.axis, fontSize: 11 }}>
                {label}
              </text>
            ))}
            {refLines.map((r) => (
              <g key={r.label}>
                <line x1={0} x2={geo.innerW} y1={geo.y(r.value)} y2={geo.y(r.value)} style={{ stroke: r.color ?? TOKENS.text }} strokeWidth={1.25} strokeDasharray="6 4" />
                <text x={geo.innerW} y={geo.y(r.value) - 6} textAnchor="end" style={{ fill: r.color ?? TOKENS.text, fontSize: 11, fontWeight: 600 }}>
                  {r.label}
                </text>
              </g>
            ))}
            {vLines.map((v) => (
              <g key={v.label} transform={`translate(${geo.x(toDate(v.date))},0)`}>
                <line y1={0} y2={geo.innerH} style={{ stroke: TOKENS.muted }} strokeWidth={1} strokeDasharray="3 3" />
                <text y={-3} textAnchor="end" dx={-4} style={{ fill: TOKENS.muted, fontSize: 11 }}>
                  {v.label}
                </text>
              </g>
            ))}
            {series.map((s) => {
              const line = d3line<TSPoint>()
                .x((p) => geo.x(toDate(p.date)))
                .y((p) => geo.y(p.value))
                .curve(curveMonotoneX)
              const areaGen = d3area<TSPoint>()
                .x((p) => geo.x(toDate(p.date)))
                .y0(geo.innerH)
                .y1((p) => geo.y(p.value))
                .curve(curveMonotoneX)
              const segs = splitSegments(s.points)
              return (
                <g key={s.id}>
                  {s.area ? <path d={areaGen(s.points) ?? ''} style={{ fill: `url(#ts-grad-${s.id})` }} /> : null}
                  {segs.map((seg, i) => (
                    <path
                      key={i}
                      d={line(seg.points) ?? ''}
                      fill="none"
                      style={{
                        stroke: s.color,
                        ...(seg.complete && !s.dashed ? { animation: 'wb-draw-line 900ms var(--ease-out) backwards' } : {}),
                      }}
                      pathLength={seg.complete && !s.dashed ? 1 : undefined}
                      strokeWidth={s.width ?? 2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={!seg.complete || s.dashed ? '5 4' : undefined}
                      opacity={seg.complete ? 1 : 0.75}
                    />
                  ))}
                  {s.points.map((p, i) =>
                    p.complete === false ? (
                      <circle key={i} cx={geo.x(toDate(p.date))} cy={geo.y(p.value)} r={3} style={{ fill: TOKENS.surface, stroke: TOKENS.warning }} strokeWidth={1.5} />
                    ) : null,
                  )}
                </g>
              )
            })}
            {markers.map((m, i) => {
              const s = series.find((x) => x.id === m.seriesId)
              if (!s) return null
              const p = [...s.points].reverse().find((pt) => pt.date <= m.date) ?? s.points[0]
              if (!p) return null
              const cx = geo.x(toDate(m.date))
              const cy = geo.y(p.value)
              if (m.kind === 'high')
                return (
                  <g key={i} transform={`translate(${cx},${cy})`}>
                    <circle r={5} style={{ fill: TOKENS.gold, stroke: TOKENS.surface }} strokeWidth={2} />
                    <text y={-10} textAnchor={cx > geo.innerW - 60 ? 'end' : 'middle'} style={{ fill: TOKENS.gold, fontSize: 11, fontWeight: 600 }}>
                      {m.label}
                    </text>
                  </g>
                )
              if (m.kind === 'buy' || m.kind === 'sell')
                return (
                  <path
                    key={i}
                    d={m.kind === 'buy' ? 'M0,-5 L5,4 L-5,4 Z' : 'M0,5 L5,-4 L-5,-4 Z'}
                    transform={`translate(${cx},${cy + (m.kind === 'buy' ? 12 : -12)})`}
                    style={{ fill: m.kind === 'buy' ? TOKENS.positive : TOKENS.negative }}
                  />
                )
              return <rect key={i} x={cx - 4} y={cy - 4} width={8} height={8} transform={`rotate(45 ${cx} ${cy})`} style={{ fill: TOKENS.surface, stroke: s.color }} strokeWidth={1.75} />
            })}
            {activePoint ? (
              <g>
                <line x1={ax - left} x2={ax - left} y1={0} y2={geo.innerH} style={{ stroke: TOKENS.crosshair }} strokeWidth={1} />
                {series.map((s) => {
                  const p = s.points.find((pt) => pt.date === activePoint.date)
                  if (!p) return null
                  return <circle key={s.id} cx={ax - left} cy={geo.y(p.value)} r={4.5} style={{ fill: p.complete === false ? TOKENS.surface : s.color, stroke: p.complete === false ? TOKENS.warning : TOKENS.surface }} strokeWidth={2} />
                })}
              </g>
            ) : null}
            <rect
              width={geo.innerW}
              height={geo.innerH}
              fill="transparent"
              onPointerMove={(e) => {
                const r = (e.currentTarget as SVGRectElement).getBoundingClientRect()
                setActive(pickIndex(e.clientX - r.left))
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === 'mouse') setActive(null)
              }}
            />
          </g>
        </svg>
      ) : null}
      {activePoint && renderTooltip && active !== null ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute z-10 min-w-44 max-w-[min(260px,80%)] rounded-md border border-line bg-raised px-3 py-2 text-sm shadow-e2"
          style={{ top: 4, ...(ax > width / 2 ? { right: width - ax + 12 } : { left: ax + 12 }) }}
        >
          {renderTooltip(active)}
        </div>
      ) : null}
    </div>
  )
}

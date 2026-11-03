import { extent } from 'd3-array'
import { scaleLinear } from 'd3-scale'
import { curveMonotoneX, line as d3line } from 'd3-shape'
import { TOKENS } from './utils'

/** Tiny trend line for lists. Decorative (aria-hidden): the list item carries the text. */
export function Sparkline({ values, incomplete, width = 96, height = 28, tone = 'accent' }: { values: number[]; incomplete?: boolean; width?: number; height?: number; tone?: 'accent' | 'positive' | 'negative' | 'muted' }) {
  if (values.length < 2)
    return (
      <svg width={width} height={height} aria-hidden>
        <line x1={2} x2={width - 2} y1={height / 2} y2={height / 2} style={{ stroke: TOKENS.grid }} strokeDasharray="3 3" />
      </svg>
    )
  const [lo, hi] = extent(values) as [number, number]
  const x = scaleLinear()
    .domain([0, values.length - 1])
    .range([2, width - 4])
  const y = scaleLinear()
    .domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi])
    .range([height - 3, 3])
  const d = d3line<number>()
    .x((_, i) => x(i))
    .y((v) => y(v))
    .curve(curveMonotoneX)(values)
  const color = tone === 'positive' ? TOKENS.positive : tone === 'negative' ? TOKENS.negative : tone === 'muted' ? TOKENS.axis : TOKENS.accent
  const last = values.at(-1)!
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <path d={d ?? ''} fill="none" style={{ stroke: color }} strokeWidth={1.5} strokeLinecap="round" strokeDasharray={incomplete ? '3 2' : undefined} />
      <circle cx={x(values.length - 1)} cy={y(last)} r={2.25} style={{ fill: color }} />
    </svg>
  )
}

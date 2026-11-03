import { useLayoutEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { parseDateOnly } from '@/lib/dates'
import { MASK } from '@/lib/money'

/** Categorical palette from design tokens (Okabe–Ito derived, CVD-safe). Never hard-code colours. */
export const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)'] as const

export function chartColor(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length]!
}

export const TOKENS = {
  accent: 'var(--accent)',
  positive: 'var(--positive)',
  negative: 'var(--negative)',
  warning: 'var(--warning)',
  warningSoft: 'var(--warning-soft)',
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  crosshair: 'var(--chart-crosshair)',
  surface: 'var(--surface)',
  text: 'var(--text)',
  muted: 'var(--text-muted)',
  gold: 'var(--gold)',
} as const

/** Measures an element's width with ResizeObserver; height is fixed by the caller to avoid layout shift. */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

const compactFormats = [1, 2, 3, 4].map((digits) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: digits }))

/** Compact axis tick ("12.4M"). Ticks are generated geometry, not data, so formatting a number is fine. */
export function axisNumber(value: number, hidden: boolean): string {
  if (hidden) return MASK.slice(0, 3)
  return compactFormats[0]!.format(value)
}

/** Labels for a set of y ticks, adding decimals until neighbouring labels differ ("4.1K", "4.12K"). */
export function axisLabels(values: number[], hidden: boolean): string[] {
  if (hidden) return values.map(() => MASK.slice(0, 3))
  for (const fmt of compactFormats) {
    const labels = values.map((v) => fmt.format(v))
    if (new Set(labels).size === labels.length) return labels
  }
  return values.map((v) => compactFormats.at(-1)!.format(v))
}

/** Drops x ticks whose label repeats the previous one (short ranges produce several ticks per day). */
export function distinctTicks<T>(ticks: T[], label: (t: T) => string): { tick: T; label: string }[] {
  const out: { tick: T; label: string }[] = []
  for (const tick of ticks) {
    const text = label(tick)
    if (out.at(-1)?.label !== text) out.push({ tick, label: text })
  }
  return out
}

export function toDate(value: string): Date {
  return value.length === 10 ? parseDateOnly(value) : new Date(value)
}

export function timeTickFormat(spanDays: number) {
  return (d: Date) => (spanDays <= 120 ? format(d, 'd MMM') : format(d, "MMM ''yy"))
}

export function usePrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

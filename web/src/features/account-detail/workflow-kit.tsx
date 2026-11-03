/** Shared pieces for the advanced investment workflows: exact-decimal inputs, validation, problem explanations, and review tables. */
import { ArrowRight } from 'lucide-react'
import { useCallback, useRef, type ReactNode } from 'react'
import { ApiProblem } from '@/api/problem'
import type { AccountPosition, Instrument } from '@/api/types'
import { FieldShell, inputClass } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { cn } from '@/lib/cn'
import { UNIT_DECIMALS, decimalToMinor, minorToDecimal } from '@/lib/money'
import { newIdempotencyKey } from '@/lib/queries'

// ---- exact decimal validation (strings only, never floats) --------------------

const UNSIGNED = /^\d+(?:\.\d+)?$/
const SIGNED = /^-?\d+(?:\.\d+)?$/

export const isNonNegativeDecimal = (v: string) => UNSIGNED.test(v)
export const isPositiveDecimal = (v: string) => UNSIGNED.test(v) && /[1-9]/.test(v)
export const isNonZeroSignedDecimal = (v: string) => SIGNED.test(v) && /[1-9]/.test(v)

/** Compares two unsigned decimal strings exactly. */
export function compareDecimal(a: string, b: string): number {
  const [aw = '0', af = ''] = a.split('.')
  const [bw = '0', bf = ''] = b.split('.')
  const places = Math.max(af.length, bf.length)
  const x = BigInt(aw + af.padEnd(places, '0'))
  const y = BigInt(bw + bf.padEnd(places, '0'))
  return x === y ? 0 : x < y ? -1 : 1
}

/** Canonical money decimal for a currency ("1500" → "1500.00"), computed exactly through minor units. */
export function moneyDecimal(value: string, currency: string): string {
  return minorToDecimal(decimalToMinor(value, currency), currency)
}

/** Drops empty optional strings so the request carries only what the user supplied. */
export function optional(value: string | undefined | null): string | undefined {
  const v = value?.trim()
  return v ? v : undefined
}

export const decimalMessage = {
  positive: 'Enter a number greater than zero, such as 12.5',
  nonNegative: 'Enter zero or a positive number',
  signed: 'Enter a non-zero number. Use a minus sign to reduce the quantity.',
}

/**
 * One idempotency key per submission attempt: retrying the identical request reuses its key (safe replay),
 * while any change to the request starts a new attempt with a fresh key.
 */
export function useAttemptKey() {
  const ref = useRef<{ body: string; key: string } | null>(null)
  const keyFor = useCallback((body: unknown) => {
    const serialized = JSON.stringify(body)
    if (!ref.current || ref.current.body !== serialized) ref.current = { body: serialized, key: newIdempotencyKey() }
    return ref.current.key
  }, [])
  const reset = useCallback(() => {
    ref.current = null
  }, [])
  return { keyFor, reset }
}

// ---- inputs ---------------------------------------------------------------------

/** Quantity, ratio, price, and rate input: exact decimal text, precision-limited, optional sign. */
export function DecimalInput({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  optional: isOptional,
  decimals = UNIT_DECIMALS,
  allowNegative,
  prefix,
  suffix,
  name,
  disabled,
  className,
}: {
  label: ReactNode
  value: string
  onChange(v: string): void
  onBlur?(): void
  error?: string
  hint?: ReactNode
  optional?: boolean
  decimals?: number
  allowNegative?: boolean
  prefix?: string
  suffix?: string
  name?: string
  disabled?: boolean
  className?: string
}) {
  const pattern = new RegExp(`^${allowNegative ? '-?' : ''}\\d*(\\.\\d{0,${decimals}})?$`)
  return (
    <FieldShell label={label} error={error} hint={hint} optional={isOptional} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          {prefix ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium tracking-wide text-subtle">{prefix}</span> : null}
          <input
            id={id}
            name={name}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            disabled={disabled}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={value}
            placeholder="0"
            onBlur={onBlur}
            onChange={(e) => {
              const v = e.target.value.replace(/[,\s]/g, '').replace('\u2212', '-')
              if (pattern.test(v)) onChange(v)
            }}
            className={cn(inputClass, 'num text-right', prefix && (prefix.length > 3 ? 'pl-20' : 'pl-14'), suffix && 'pr-16')}
          />
          {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 max-w-14 -translate-y-1/2 truncate text-sm font-medium text-subtle">{suffix}</span> : null}
        </div>
      )}
    </FieldShell>
  )
}

export function instrumentLabel(i: Pick<Instrument, 'name' | 'symbol' | 'quoteCurrency'>): string {
  return `${i.symbol ? `${i.symbol} · ` : ''}${i.name} (${i.quoteCurrency})`
}

export function positionLabel(p: AccountPosition): string {
  return `${p.instrumentSymbol ? `${p.instrumentSymbol} · ` : ''}${p.instrumentName}`
}

// ---- problems -------------------------------------------------------------------

const GENERIC_INVALID = /investment mutation is invalid/i
const GENERIC_CONFLICT = /conflicts with existing investment activity/i

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) + (/[.?]$/.test(s) ? '' : '.') : s)

export interface ExplainedProblem {
  title: string
  detail: string
  causes: string[]
}

/**
 * Turns a problem+json error into calm, specific copy. The server's investment checks replay the whole
 * history and answer with a generic message, so callers pass the likely causes for their workflow.
 */
export function explainProblem(error: unknown, causes: string[] = []): ExplainedProblem {
  if (!ApiProblem.is(error)) return { title: 'Something went wrong', detail: error instanceof Error ? error.message : 'Try again in a moment.', causes: [] }
  if (error.status === 0) return { title: error.title || 'Offline', detail: error.detail, causes: [] }
  if (error.status === 501) return { title: error.title, detail: error.detail, causes: [] }
  if (error.status === 404) return { title: 'It no longer exists', detail: 'It may have been changed or removed in another window. Close this and reload the account.', causes: [] }
  if (error.status === 409 && GENERIC_CONFLICT.test(error.detail))
    return {
      title: 'This conflicts with later activity',
      detail: 'Nothing was saved. Another recorded event depends on the units this change affects.',
      causes: ['A later corporate action (split, spin-off, merger, or transfer) uses these units. Undo that action first, make this change, then record the action again.', ...causes],
    }
  if (error.status === 422 && GENERIC_INVALID.test(error.detail))
    return { title: "Wealthboard couldn't apply this", detail: 'The server replayed the account history with this change and refused it, so nothing was saved.', causes }
  return { title: error.title || 'Could not save', detail: sentence(error.detail), causes: error.status === 422 || error.status === 409 ? causes : [] }
}

export function WorkflowProblem({ error, causes, className }: { error: unknown; causes?: string[]; className?: string }) {
  if (!error) return null
  const p = explainProblem(error, causes)
  return (
    <Notice tone="negative" role="alert" title={p.title} className={className}>
      <p>{p.detail}</p>
      {p.causes.length ? (
        <>
          <p className="mt-2 font-medium text-ink">Common reasons</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {p.causes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      ) : null}
    </Notice>
  )
}

// ---- consequence + review -------------------------------------------------------

/** A calm "what happens" block shown before a commit. */
export function Consequences({ title = 'What happens when you save', items }: { title?: string; items: ReactNode[] }) {
  return (
    <section aria-label={title} className="rounded-lg border border-line bg-sunken/60 px-4 py-3.5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <ul className="mt-2 space-y-1.5 text-sm text-muted">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-line-strong" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export interface ReviewRow {
  label: ReactNode
  before?: ReactNode
  after: ReactNode
  strong?: boolean
}

/** Before → after rows. Semantic table with right-aligned figures. */
export function ReviewTable({ caption, rows, beforeLabel = 'Before', afterLabel = 'After' }: { caption: string; rows: ReviewRow[]; beforeLabel?: string; afterLabel?: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-sunken/70 text-left text-xs text-muted">
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">Item</span>
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {beforeLabel}
            </th>
            <th scope="col" className="w-5 px-0 py-2">
              <span className="sr-only">becomes</span>
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {afterLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              <th scope="row" className={cn('px-3 py-2 text-left font-normal', r.strong ? 'font-semibold text-ink' : 'text-muted')}>
                {r.label}
              </th>
              <td className="px-3 py-2 text-right text-muted">{r.before ?? '—'}</td>
              <td className="px-0 py-2 text-subtle">
                <ArrowRight size={14} aria-hidden />
              </td>
              <td className={cn('px-3 py-2 text-right', r.strong ? 'font-semibold text-ink' : 'font-medium text-ink')}>{r.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A compact label/value list (dt/dd) for figures that have no "before". */
export function FigureList({ items }: { items: { label: ReactNode; value: ReactNode; hint?: ReactNode; strong?: boolean }[] }) {
  return (
    <dl className="divide-y divide-line rounded-md border border-line bg-surface">
      {items.map((it, i) => (
        <div key={i} className="flex items-start justify-between gap-4 px-3 py-2.5">
          <dt className="min-w-0">
            <span className={cn('block text-sm', it.strong ? 'font-semibold text-ink' : 'text-muted')}>{it.label}</span>
            {it.hint ? <span className="mt-0.5 block text-xs text-subtle">{it.hint}</span> : null}
          </dt>
          <dd className={cn('shrink-0 text-right text-sm', it.strong ? 'font-semibold text-ink' : 'font-medium text-ink')}>{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Small section heading inside a sheet form. */
export function FormSection({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn('min-w-0 space-y-4', className)}>
      <legend className="mb-1 text-sm font-semibold text-ink">{title}</legend>
      {description ? <p className="-mt-2 text-xs text-muted">{description}</p> : null}
      {children}
    </fieldset>
  )
}

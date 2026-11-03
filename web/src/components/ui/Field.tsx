import { Switch as RSwitch } from 'radix-ui'
import { ChevronDown } from 'lucide-react'
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { minorExponent } from '@/lib/money'

export const inputClass =
  'block h-11 w-full min-w-0 rounded-md border border-line-strong/80 bg-surface px-3 text-base text-ink placeholder:text-subtle transition-[border-color,box-shadow] duration-[var(--dur-1)] hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted aria-[invalid=true]:border-negative aria-[invalid=true]:focus:ring-negative/20 md:h-10'

interface FieldShellProps {
  label: ReactNode
  hint?: ReactNode
  error?: string
  optional?: boolean
  className?: string
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
}

/** Label, control, hint, and error, wired with aria-describedby. */
export function FieldShell({ label, hint, error, optional, className, children }: FieldShellProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="mb-1.5 flex items-baseline gap-1.5 text-sm font-medium text-ink">
        {label}
        {optional ? <span className="text-xs font-normal text-subtle">Optional</span> : null}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && !error ? (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-negative" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

type Common = { label: ReactNode; hint?: ReactNode; error?: string; optional?: boolean; className?: string }

export const TextField = forwardRef<HTMLInputElement, Common & InputHTMLAttributes<HTMLInputElement>>(function TextField({ label, hint, error, optional, className, ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional} className={className}>
      {({ id, describedBy, invalid }) => <input ref={ref} id={id} aria-describedby={describedBy} aria-invalid={invalid} className={inputClass} {...rest} />}
    </FieldShell>
  )
})

export const DateField = forwardRef<HTMLInputElement, Common & InputHTMLAttributes<HTMLInputElement>>(function DateField(props, ref) {
  return <TextField ref={ref} type="date" {...props} />
})

export const TextareaField = forwardRef<HTMLTextAreaElement, Common & TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextareaField({ label, hint, error, optional, className, ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional} className={className}>
      {({ id, describedBy, invalid }) => <textarea ref={ref} id={id} aria-describedby={describedBy} aria-invalid={invalid} rows={3} className={cn(inputClass, 'h-auto py-2.5 md:h-auto')} {...rest} />}
    </FieldShell>
  )
})

export const SelectField = forwardRef<HTMLSelectElement, Common & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string; disabled?: boolean }[]; placeholder?: string }>(
  function SelectField({ label, hint, error, optional, className, options, placeholder, ...rest }, ref) {
    return (
      <FieldShell label={label} hint={hint} error={error} optional={optional} className={className}>
        {({ id, describedBy, invalid }) => (
          <div className="relative">
            <select ref={ref} id={id} aria-describedby={describedBy} aria-invalid={invalid} className={cn(inputClass, 'appearance-none pr-10')} {...rest}>
              {placeholder !== undefined ? (
                <option value="" disabled>
                  {placeholder}
                </option>
              ) : null}
              {options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          </div>
        )}
      </FieldShell>
    )
  },
)

/** Sanitises typing so the value never exceeds the currency's minor-unit precision. */
export function sanitizeAmountInput(raw: string, decimals: number, allowNegative = false): string | null {
  const v = raw.replace(/[,\s]/g, '')
  const pattern = decimals === 0 ? (allowNegative ? /^-?\d*$/ : /^\d*$/) : new RegExp(`^${allowNegative ? '-?' : ''}\\d*(\\.\\d{0,${decimals}})?$`)
  return pattern.test(v) ? v : null
}

export interface AmountFieldProps extends Common {
  currency: string
  value: string
  onChange(value: string): void
  onBlur?(): void
  allowNegative?: boolean
  /** Override the precision (for unit prices and quantities). */
  decimals?: number
  placeholder?: string
  disabled?: boolean
  name?: string
  autoFocus?: boolean
  suffix?: string
}

/** Amount input: inputmode=decimal, enforces the currency's precision, shows the ISO code. */
export const AmountField = forwardRef<HTMLInputElement, AmountFieldProps>(function AmountField(
  { label, hint, error, optional, className, currency, value, onChange, onBlur, allowNegative, decimals, placeholder, disabled, name, autoFocus, suffix },
  ref,
) {
  const places = decimals ?? minorExponent(currency)
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium tracking-wide text-subtle">{currency}</span>
          <input
            ref={ref}
            id={id}
            name={name}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoFocus={autoFocus}
            disabled={disabled}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            placeholder={placeholder ?? (places ? `0.${'0'.repeat(places)}` : '0')}
            value={value}
            onBlur={onBlur}
            onChange={(e) => {
              const next = sanitizeAmountInput(e.target.value, places, allowNegative)
              if (next !== null) onChange(next)
            }}
            className={cn(inputClass, 'num text-right', currency.length > 3 ? 'pl-20' : 'pl-14', suffix && 'pr-14')}
          />
          {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-subtle">{suffix}</span> : null}
        </div>
      )}
    </FieldShell>
  )
})

export function SwitchField({ label, description, checked, onCheckedChange, disabled }: { label: ReactNode; description?: ReactNode; checked: boolean; onCheckedChange(v: boolean): void; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative mt-0.5 h-6 w-10 shrink-0 rounded-full bg-line-strong/60 transition-colors duration-[var(--dur-2)] data-[state=checked]:bg-accent disabled:opacity-50"
      >
        <RSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow-e1 transition-transform duration-[var(--dur-2)] ease-out data-[state=checked]:translate-x-[18px]" />
      </RSwitch.Root>
    </div>
  )
}

/** A radio card group for a small set of mutually exclusive, explained options. */
export function ChoiceCards<T extends string>({
  name,
  value,
  onChange,
  options,
  legend,
  columns = 2,
}: {
  name: string
  value: T
  onChange(v: T): void
  options: { value: T; title: ReactNode; description?: ReactNode; icon?: ReactNode; disabled?: boolean }[]
  legend: ReactNode
  columns?: 1 | 2 | 3
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink">{legend}</legend>
      <div className={cn('grid gap-2.5', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3')}>
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              'relative flex cursor-pointer gap-3 rounded-lg border bg-surface p-3.5 transition-[border-color,background-color,box-shadow] duration-[var(--dur-1)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]',
              value === o.value ? 'border-accent bg-accent-soft/50 shadow-[inset_0_0_0_1px_var(--accent)]' : 'border-line hover:border-line-strong',
              o.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} className="sr-only" />
            {o.icon ? <span className={cn('mt-0.5 shrink-0', value === o.value ? 'text-accent' : 'text-muted')}>{o.icon}</span> : null}
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">{o.title}</span>
              {o.description ? <span className="mt-0.5 block text-xs text-muted">{o.description}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

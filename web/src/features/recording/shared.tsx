import { useEffect, useMemo, type FormEvent, type ReactNode } from 'react'
import { WifiOff } from 'lucide-react'
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiProblem } from '@/api/problem'
import type { Account } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { inputClass, FieldShell, SelectField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { cn } from '@/lib/cn'
import { LAST_RECORDING_KEY } from '@/config'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { UNIT_DECIMALS } from '@/lib/money'
import type { RecordAction } from './recorder'

/** Maps server field names (problem.fieldErrors keys) to form field names. */
export function applyFieldErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, map: Record<string, Path<T>>): void {
  if (!ApiProblem.is(error) || !error.fieldErrors) return
  for (const [key, message] of Object.entries(error.fieldErrors)) {
    const field = map[key]
    if (field) setError(field, { type: 'server', message })
  }
}

/** Form body plus a problem notice; the submit button lives in the sheet footer via `form={id}`. */
export function RecordingForm({ id, onSubmit, error, children }: { id: string; onSubmit(e: FormEvent): void; error?: unknown; children: ReactNode }) {
  const online = useOnline()
  return (
    <form id={id} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {!online ? (
        <Notice tone="warning" title="Recording is paused">
          {OFFLINE_REASON}
        </Notice>
      ) : null}
      {ApiProblem.is(error) ? (
        <Notice tone="negative" title={error.title} role="alert">
          {error.detail}
        </Notice>
      ) : null}
      {children}
    </form>
  )
}

export function SubmitBar({ formId, label, pending, onCancel, disabled }: { formId: string; label: string; pending: boolean; onCancel(): void; disabled?: boolean }) {
  const online = useOnline()
  return (
    <>
      {!online ? (
        <span className="mr-auto flex items-center gap-1.5 text-xs text-warning">
          <WifiOff size={14} aria-hidden /> Offline
        </span>
      ) : null}
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" form={formId} variant="primary" loading={pending} disabled={!online || disabled} title={!online ? OFFLINE_REASON : undefined}>
        {label}
      </Button>
    </>
  )
}

export function AccountSelect({
  accounts,
  value,
  onChange,
  label = 'Account',
  error,
  hint,
  exclude,
  name,
}: {
  accounts: Account[]
  value: string
  onChange(id: string): void
  label?: string
  error?: string
  hint?: ReactNode
  exclude?: string
  name?: string
}) {
  const options = useMemo(
    () =>
      accounts
        .filter((a) => a.id !== exclude)
        .map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}${a.institutionName ? ` · ${a.institutionName}` : ''}` })),
    [accounts, exclude],
  )
  return <SelectField name={name} label={label} value={value} onChange={(e) => onChange(e.target.value)} options={options} placeholder="Choose an account" error={error} hint={hint} />
}

/** Decimal input for quantities and unit prices (no currency prefix), precision-limited. */
export function DecimalField({
  label,
  value,
  onChange,
  error,
  hint,
  decimals = UNIT_DECIMALS,
  suffix,
  prefix,
  name,
}: {
  label: ReactNode
  value: string
  onChange(v: string): void
  error?: string
  hint?: ReactNode
  decimals?: number
  suffix?: string
  prefix?: string
  name?: string
}) {
  return (
    <FieldShell label={label} error={error} hint={hint}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          {prefix ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-subtle">{prefix}</span> : null}
          <input
            id={id}
            name={name}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={value}
            placeholder="0"
            onChange={(e) => {
              const v = e.target.value.replace(/[,\s]/g, '')
              if (new RegExp(`^\\d*(\\.\\d{0,${decimals}})?$`).test(v)) onChange(v)
            }}
            className={cn(inputClass, 'num text-right', prefix && 'pl-14', suffix && 'pr-16')}
          />
          {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-subtle">{suffix}</span> : null}
        </div>
      )}
    </FieldShell>
  )
}

export interface LastRecording {
  action: RecordAction
  accountId?: string
}

export function readLastRecording(): LastRecording | null {
  try {
    const raw = localStorage.getItem(LAST_RECORDING_KEY)
    return raw ? (JSON.parse(raw) as LastRecording) : null
  } catch {
    return null
  }
}

export function rememberRecording(last: LastRecording): void {
  try {
    localStorage.setItem(LAST_RECORDING_KEY, JSON.stringify(last))
  } catch {
    /* ignore */
  }
}

/** Scroll the first invalid field into view after a failed submit. */
export function useFocusFirstError(errors: object, submitCount: number): void {
  useEffect(() => {
    if (!submitCount) return
    const el = document.querySelector<HTMLElement>('[aria-invalid="true"]')
    el?.focus()
  }, [errors, submitCount])
}

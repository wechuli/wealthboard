import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeftRight, Info } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { api } from '@/api'
import { Button, IconButton } from '@/components/ui/Button'
import { DateField, SelectField, TextField } from '@/components/ui/Field'
import { currencyName } from '@/lib/currency'
import { formatDecimal } from '@/lib/money'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { newIdempotencyKey, useApiMutation } from '@/lib/queries'
import { applyFieldErrors, ProblemNotice } from './settings-kit'

const RATE_RE = /^\d+(\.\d+)?$/

function makeSchema(today: string) {
  return z
    .object({
      baseCurrency: z.string().length(3, 'Choose a currency'),
      quoteCurrency: z.string().length(3, 'Choose a currency'),
      rate: z
        .string()
        .trim()
        .min(1, 'Enter the rate, for example 129.25')
        .regex(RATE_RE, 'Use digits and one decimal point, for example 129.25')
        .refine((v) => /[1-9]/.test(v), 'The rate must be greater than zero'),
      effectiveDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date this rate applies from')
        .refine((v) => v <= today, 'Rates can’t be in the future. Choose today or earlier.'),
    })
    .refine((v) => v.baseCurrency !== v.quoteCurrency, { path: ['quoteCurrency'], message: 'Choose a different currency from the base' })
}
type Values = z.infer<ReturnType<typeof makeSchema>>

/** Keeps typing to digits and a single decimal point (up to 10 places). */
function sanitizeRate(raw: string): string | null {
  const v = raw.replace(/[,\s]/g, '')
  return /^\d*(\.\d{0,10})?$/.test(v) ? v : null
}

export function AddRateForm({
  initialBase,
  initialQuote,
  currencies,
  today,
  onDone,
  onCancel,
}: {
  initialBase: string
  initialQuote: string
  /** Currency codes offered in the selects. */
  currencies: string[]
  today: string
  onDone(): void
  onCancel(): void
}) {
  const online = useOnline()
  const rootRef = useRef<HTMLDivElement>(null)
  const schema = useMemo(() => makeSchema(today), [today])
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { baseCurrency: initialBase, quoteCurrency: initialQuote, rate: '', effectiveDate: today },
  })
  const { register, control, handleSubmit, formState, setError, setValue, getValues, setFocus } = form
  const [base, quote, rate] = useWatch({ control, name: ['baseCurrency', 'quoteCurrency', 'rate'] })

  // Bring the form into view and put the cursor in the rate (deep links and "Add rate" fixes land here).
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    rootRef.current?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
    const t = window.setTimeout(() => setFocus('rate'), reduce ? 0 : 250)
    return () => window.clearTimeout(t)
  }, [setFocus])

  const create = useApiMutation({
    mutationFn: (vars: { body: Values; key: string }) => api.exchangeRates.create(vars.body, { idempotencyKey: vars.key }),
    success: (_r, vars) => `Rate saved: 1 ${vars.body.baseCurrency} = ${formatDecimal(vars.body.rate, { maxFraction: 10 })} ${vars.body.quoteCurrency}`,
    toastError: false,
    onSuccess: () => onDone(),
  })

  const onSubmit = handleSubmit((v) => {
    if (create.isPending) return
    const body = { ...v, rate: v.rate.trim() }
    create.mutate({ body, key: newIdempotencyKey() }, { onError: (err) => applyFieldErrors(err, setError, ['baseCurrency', 'quoteCurrency', 'rate', 'effectiveDate']) })
  })

  const options = currencies.map((c) => ({ value: c, label: `${c} · ${currencyName(c)}` }))
  const validRate = RATE_RE.test(rate.trim()) && /[1-9]/.test(rate) && base !== quote

  const swap = () => {
    const { baseCurrency, quoteCurrency } = getValues()
    setValue('baseCurrency', quoteCurrency, { shouldDirty: true, shouldValidate: formState.isSubmitted })
    setValue('quoteCurrency', baseCurrency, { shouldDirty: true, shouldValidate: formState.isSubmitted })
  }

  return (
    <div ref={rootRef} className="scroll-mt-24 rounded-lg border border-line bg-sunken/50 p-4 md:p-5">
      <form onSubmit={onSubmit} noValidate aria-label="Add an exchange rate">
        <h3 className="text-sm font-semibold text-ink">Add a rate</h3>
        <p className="mt-0.5 text-xs text-muted">Enter how many units of the second currency one unit of the first buys on that date.</p>
        <ProblemNotice error={create.error} className="mt-4" />
        <div className="mt-4 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <SelectField label="From" options={options} error={formState.errors.baseCurrency?.message} {...register('baseCurrency')} />
          <IconButton label="Swap currencies" icon={<ArrowLeftRight size={16} aria-hidden />} variant="secondary" onClick={swap} className="justify-self-start" />
          <SelectField label="To" options={options} error={formState.errors.quoteCurrency?.message} {...register('quoteCurrency')} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Controller
            control={control}
            name="rate"
            render={({ field, fieldState }) => (
              <TextField
                label={`Rate (${quote} per 1 ${base})`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="129.25"
                error={fieldState.error?.message}
                hint={
                  validRate ? (
                    <span className="num text-ink">
                      1 {base} = {formatDecimal(rate.trim(), { maxFraction: 10 })} {quote}
                    </span>
                  ) : (
                    `For example, 1 USD = 129.25 KES.`
                  )
                }
                name={field.name}
                ref={field.ref}
                value={field.value}
                onBlur={field.onBlur}
                onChange={(e) => {
                  const next = sanitizeRate(e.target.value)
                  if (next !== null) field.onChange(next)
                }}
              />
            )}
          />
          <DateField label="Effective from" max={today} error={formState.errors.effectiveDate?.message} {...register('effectiveDate')} />
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted">
          <Info size={13} aria-hidden className="mt-px shrink-0" />
          <span>
            The inverse ({quote} → {base}) is implied, so you only need one direction. The rate applies from this date until you add a newer one.
          </span>
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {!online ? <p className="mr-auto text-xs text-warning">{OFFLINE_REASON}</p> : null}
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!online}>
            Save rate
          </Button>
        </div>
      </form>
    </div>
  )
}


import { zodResolver } from '@hookform/resolvers/zod'
import { addMonths, format } from 'date-fns'
import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { api } from '@/api'
import type { Account } from '@/api/types'
import { AmountField, DateField, SelectField, TextField } from '@/components/ui/Field'
import { CategoryIcon } from '@/components/CategoryIcon'
import { cn } from '@/lib/cn'
import { decimalToMinor, minorToDecimal, formatBps } from '@/lib/money'
import { parseDateOnly } from '@/lib/dates'
import { usePrefs } from '@/lib/prefs'
import { newIdempotencyKey, useApiMutation } from '@/lib/queries'
import { applyFieldErrors, DecimalField, RecordingForm, useFocusFirstError } from '../shared'
import { amountRule } from './TransactionForm'

const GOAL_ICONS = ['Target', 'CarFront', 'House', 'GraduationCap', 'Plane', 'Shield', 'Globe', 'Laptop', 'Baby', 'Heart', 'BriefcaseBusiness', 'PiggyBank']

/** Create a goal: target, date, optional linked account (source of truth), plan and assumed return. */
export function GoalForm({ formId, accounts, onDone, onPendingChange }: { formId: string; accounts: Account[]; onDone(goalId: string): void; onPendingChange(p: boolean): void }) {
  const prefs = usePrefs()
  const linkable = useMemo(() => accounts.filter((a) => !a.isLiability && !a.archivedAt), [accounts])
  const currencies = useMemo(() => [...new Set([prefs.baseCurrency, ...prefs.enabledCurrencies])], [prefs.baseCurrency, prefs.enabledCurrencies])
  const [currency, setCurrency] = useState(prefs.baseCurrency)
  const schema = z.object({
    name: z.string().trim().min(1, 'Name the goal').max(80),
    icon: z.string(),
    target: amountRule(() => currency),
    targetDate: z.string().min(1, 'Choose a target date').refine((d) => d > prefs.today, 'Choose a future date'),
    linkedAccountId: z.string(),
    current: z.string(),
    planned: amountRule(() => currency, { allowZero: true }),
    frequency: z.enum(['weekly', 'monthly', 'quarterly', 'annually']),
    returnPct: z
      .string()
      .min(1, 'Enter a return, or 0')
      .refine((v) => /^\d{1,2}(\.\d{1,2})?$|^100$/.test(v), 'Use a percentage between 0 and 100 with up to two decimals'),
  })
  type Values = z.infer<typeof schema>
  const defaultReturn = formatBps(prefs.defaultGoalReturnBps).replace('%', '')
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      icon: 'Target',
      target: '',
      targetDate: format(addMonths(parseDateOnly(prefs.today), 24), 'yyyy-MM-dd'),
      linkedAccountId: '',
      current: '',
      planned: '',
      frequency: 'monthly',
      returnPct: defaultReturn,
    },
  })
  useFocusFirstError(form.formState.errors, form.formState.submitCount)
  const linked = useWatch({ control: form.control, name: 'linkedAccountId' })
  const icon = useWatch({ control: form.control, name: 'icon' })

  const mutation = useApiMutation({
    mutationFn: (v: Values & { idempotencyKey: string }) =>
      api.goals.create(
        {
          idempotencyKey: v.idempotencyKey,
          name: v.name.trim(),
          icon: v.icon,
          currency,
          targetAmount: minorToDecimal(decimalToMinor(v.target, currency), currency),
          currentAmount: !v.linkedAccountId && v.current ? minorToDecimal(decimalToMinor(v.current, currency), currency) : undefined,
          targetDate: v.targetDate,
          linkedAccountId: v.linkedAccountId || null,
          plannedContribution: minorToDecimal(decimalToMinor(v.planned || '0', currency), currency),
          frequency: v.frequency,
          // The API takes the assumed return as a percent number (0–100).
          assumedAnnualReturn: Number(v.returnPct),
          planStartDate: prefs.today,
          status: 'active',
        },
        { idempotencyKey: v.idempotencyKey },
      ),
    success: (_r, v) => `Goal “${v.name.trim()}” created`,
    toastError: false,
    onSuccess: (r) => onDone(r.id),
  })
  const submit = form.handleSubmit((v) => {
    if (mutation.isPending) return
    onPendingChange(true)
    mutation.mutate({ ...v, idempotencyKey: newIdempotencyKey() }, { onError: (e) => applyFieldErrors(e, form.setError, { name: 'name', targetAmount: 'target', targetDate: 'targetDate' }), onSettled: () => onPendingChange(false) })
  })

  return (
    <RecordingForm id={formId} onSubmit={submit} error={mutation.error}>
      <TextField label="Goal name" placeholder="For example: House deposit" autoFocus {...form.register('name')} error={form.formState.errors.name?.message} />
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">Icon</legend>
        <div className="flex flex-wrap gap-1.5">
          {GOAL_ICONS.map((name) => (
            <label key={name} className={cn('grid size-11 cursor-pointer place-items-center rounded-md border transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus-ring)]', icon === name ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:border-line-strong')}>
              <input type="radio" value={name} className="sr-only" {...form.register('icon')} aria-label={name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()} />
              <CategoryIcon name={name} size={18} />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-5 sm:grid-cols-[8rem_1fr]">
        <SelectField label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} options={currencies.map((c) => ({ value: c, label: c }))} />
        <Controller control={form.control} name="target" render={({ field, fieldState }) => <AmountField label="Target amount" currency={currency} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />} />
      </div>
      <DateField label="Target date" min={prefs.today} {...form.register('targetDate')} error={form.formState.errors.targetDate?.message} />
      <SelectField
        label="Track progress with"
        {...form.register('linkedAccountId')}
        options={[{ value: '', label: 'An amount I enter myself' }, ...linkable.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))]}
        hint={linked ? "The account's value is the source of truth. Its balance is never counted twice as goal contributions." : 'Enter what you have saved so far and update it as you go.'}
      />
      {!linked ? (
        <Controller control={form.control} name="current" render={({ field, fieldState }) => <AmountField label="Saved so far" optional currency={currency} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />} />
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Controller control={form.control} name="planned" render={({ field, fieldState }) => <AmountField label="Planned contribution" currency={currency} value={field.value} onChange={field.onChange} error={fieldState.error?.message} />} />
        <SelectField
          label="How often"
          {...form.register('frequency')}
          options={[
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
            { value: 'quarterly', label: 'Quarterly' },
            { value: 'annually', label: 'Annually' },
          ]}
        />
      </div>
      <Controller
        control={form.control}
        name="returnPct"
        render={({ field, fieldState }) => (
          <DecimalField label="Assumed annual return" decimals={2} suffix="% a year" value={field.value} onChange={field.onChange} error={fieldState.error?.message} hint="Projections compound monthly with end-of-month contributions." />
        )}
      />
    </RecordingForm>
  )
}
